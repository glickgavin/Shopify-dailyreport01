import { NextRequest, NextResponse } from 'next/server';
import { WebClient } from '@slack/web-api';
import { subDays } from 'date-fns';
import { toZonedTime, format } from 'date-fns-tz';
import { fetchOrdersForDate } from '@/lib/queries/orders';
import { processDay } from '@/lib/business-rules';
import { saveDay } from '@/lib/persistence';
import { postDailySummary } from '@/lib/slack';
import { checkAlerts } from '@/lib/alerts';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tz = process.env.STORE_TIMEZONE ?? 'America/Los_Angeles';

  // Allow overriding date via query param (used by admin re-run)
  const dateParam = req.nextUrl.searchParams.get('date');
  const targetDate = dateParam ?? format(toZonedTime(subDays(new Date(), 1), tz), 'yyyy-MM-dd', { timeZone: tz });

  console.log(`[cron/daily] Starting for date: ${targetDate}`);

  try {
    console.log(`[cron/daily] Fetching Shopify orders…`);
    const { orderRows, paymentRows } = await fetchOrdersForDate(targetDate);
    console.log(`[cron/daily] Fetched ${orderRows.length} order rows, ${paymentRows.length} payment rows`);

    const processed = processDay(orderRows, paymentRows, targetDate);
    console.log(`[cron/daily] Processed: revenue=${processed.total.revenue}, orders=${processed.total.orders}`);

    console.log(`[cron/daily] Saving to Supabase…`);
    await saveDay(processed, orderRows, paymentRows);
    console.log(`[cron/daily] Saved`);

    // Fetch prev day for Slack delta + 7-day history for alerts
    const prevDate = format(toZonedTime(subDays(new Date(targetDate), 1), tz), 'yyyy-MM-dd', { timeZone: tz });
    const sevenDayStart = format(toZonedTime(subDays(new Date(targetDate), 8), tz), 'yyyy-MM-dd', { timeZone: tz });

    const [{ data: prevSummary }, { data: historySummary }, { data: todaySummary }] = await Promise.all([
      supabaseAdmin
        .from('daily_summary')
        .select('total_revenue, total_orders, total_net_sales')
        .eq('date', prevDate)
        .single(),
      supabaseAdmin
        .from('daily_summary')
        .select('*')
        .gte('date', sevenDayStart)
        .lt('date', targetDate)
        .order('date', { ascending: false }),
      supabaseAdmin
        .from('daily_summary')
        .select('*')
        .eq('date', targetDate)
        .single(),
    ]);

    const alerts = todaySummary ? checkAlerts(todaySummary, historySummary ?? []) : [];
    if (alerts.length > 0) {
      console.log(`[cron/daily] Alerts: ${alerts.map((a) => `${a.level}:${a.rule}`).join(', ')}`);
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://shopifydailyreport01.vercel.app';
    const dashboardUrl = `${appUrl}/dashboard/${targetDate}`;

    console.log(`[cron/daily] Posting Slack summary…`);
    await postDailySummary(processed, dashboardUrl, prevSummary ?? null, alerts);
    console.log(`[cron/daily] Slack posted`);

    // Write success to job_logs
    await supabaseAdmin.from('job_logs').insert({
      date: targetDate,
      job_type: 'daily_cron',
      status: 'success',
      message: `revenue=${processed.total.revenue} orders=${processed.total.orders} alerts=${alerts.length}`,
      meta: { orderRows: orderRows.length, paymentRows: paymentRows.length, alertCount: alerts.length },
    });

    return NextResponse.json({
      status: 'ok',
      date: targetDate,
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
    console.error(`[cron/daily] Error: ${msg}`);

    // Write error to job_logs
    try {
      await supabaseAdmin.from('job_logs').insert({
        date: targetDate,
        job_type: 'daily_cron',
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
          text: `🚨 *Daily cron failed* for ${targetDate}\n\`\`\`${msg}\`\`\``,
        });
      }
    } catch { /* swallow */ }

    return NextResponse.json({ error: msg, date: targetDate }, { status: 500 });
  }
}
