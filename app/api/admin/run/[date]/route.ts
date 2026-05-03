import { NextRequest, NextResponse } from 'next/server';
import { WebClient } from '@slack/web-api';
import { fetchOrdersForDate } from '@/lib/queries/orders';
import { processDay } from '@/lib/business-rules';
import { saveDay } from '@/lib/persistence';
import { postDailySummary } from '@/lib/slack';
import { checkAlerts } from '@/lib/alerts';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Not registered in vercel.json crons — exempt from Vercel cron host protection.
// Requires same CRON_SECRET as the cron route.
export async function GET(req: NextRequest, { params }: { params: { date: string } }) {
  const auth = req.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { date } = params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Invalid date format' }, { status: 400 });
  }

  console.log(`[admin/run] Starting for date: ${date}`);

  try {
    const { orderRows, paymentRows } = await fetchOrdersForDate(date);
    console.log(`[admin/run] Fetched ${orderRows.length} order rows`);

    const processed = processDay(orderRows, paymentRows, date);

    await saveDay(processed, orderRows, paymentRows);
    console.log(`[admin/run] Saved`);

    // Fetch prev day and 7-day history for alerts
    const sevenDayStart = new Date(date);
    sevenDayStart.setDate(sevenDayStart.getDate() - 8);
    const sevenDayStartStr = sevenDayStart.toISOString().slice(0, 10);

    const prevDate = new Date(date);
    prevDate.setDate(prevDate.getDate() - 1);
    const prevDateStr = prevDate.toISOString().slice(0, 10);

    const [{ data: prevSummary }, { data: historySummary }, { data: todaySummary }] = await Promise.all([
      supabaseAdmin.from('daily_summary').select('total_revenue, total_orders, total_net_sales').eq('date', prevDateStr).single(),
      supabaseAdmin.from('daily_summary').select('*').gte('date', sevenDayStartStr).lt('date', date).order('date', { ascending: false }),
      supabaseAdmin.from('daily_summary').select('*').eq('date', date).single(),
    ]);

    const alerts = todaySummary ? checkAlerts(todaySummary, historySummary ?? []) : [];

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://shopifydailyreport01.vercel.app';
    const dashboardUrl = `${appUrl}/dashboard/${date}`;

    // Post Slack only if not a silent backfill
    const silent = req.nextUrl.searchParams.get('silent') === 'true';
    if (!silent) {
      await postDailySummary(processed, dashboardUrl, prevSummary ?? null, alerts);
    }

    await supabaseAdmin.from('job_logs').insert({
      date,
      job_type: silent ? 'backfill' : 'manual_run',
      status: 'success',
      message: `revenue=${processed.total.revenue} orders=${processed.total.orders} alerts=${alerts.length}`,
      meta: { orderRows: orderRows.length, paymentRows: paymentRows.length, alertCount: alerts.length },
    });

    return NextResponse.json({
      status: 'ok',
      date,
      summary: {
        revenue: processed.total.revenue,
        netSales: processed.total.netSales,
        orders: processed.total.orders,
        orderRows: orderRows.length,
        alerts: alerts.length,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[admin/run] Error: ${msg}`);

    try {
      await supabaseAdmin.from('job_logs').insert({
        date,
        job_type: 'backfill',
        status: 'error',
        message: msg,
      });
    } catch { /* swallow */ }

    try {
      const token = process.env.SLACK_BOT_TOKEN;
      const channel = process.env.SLACK_CHANNEL_ID;
      if (token && channel) {
        await new WebClient(token).chat.postMessage({
          channel,
          text: `🚨 *Admin run failed* for ${date}\n\`\`\`${msg}\`\`\``,
        });
      }
    } catch { /* swallow */ }

    return NextResponse.json({ error: msg, date }, { status: 500 });
  }
}
