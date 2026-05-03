import { NextRequest, NextResponse } from 'next/server';
import { WebClient } from '@slack/web-api';
import { subDays } from 'date-fns';
import { toZonedTime, format } from 'date-fns-tz';
import { fetchOrdersForDate } from '@/lib/queries/orders';
import { processDay } from '@/lib/business-rules';
import { saveDay } from '@/lib/persistence';
import { postDailySummary } from '@/lib/slack';
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
  const yesterday = format(toZonedTime(subDays(new Date(), 1), tz), 'yyyy-MM-dd', { timeZone: tz });

  console.log(`[cron/daily] Starting for date: ${yesterday}`);

  try {
    console.log(`[cron/daily] Fetching Shopify orders…`);
    const { orderRows, paymentRows } = await fetchOrdersForDate(yesterday);
    console.log(`[cron/daily] Fetched ${orderRows.length} order rows, ${paymentRows.length} payment rows`);

    const processed = processDay(orderRows, paymentRows, yesterday);
    console.log(`[cron/daily] Processed: revenue=${processed.total.revenue}, orders=${processed.total.orders}`);

    console.log(`[cron/daily] Saving to Supabase…`);
    await saveDay(processed, orderRows, paymentRows);
    console.log(`[cron/daily] Saved`);

    const prevDate = format(toZonedTime(subDays(new Date(), 2), tz), 'yyyy-MM-dd', { timeZone: tz });
    const { data: prevSummary } = await supabaseAdmin
      .from('daily_summary')
      .select('total_revenue, total_orders, total_net_sales')
      .eq('date', prevDate)
      .single();

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://shopifydailyreport01.vercel.app';
    const dashboardUrl = `${appUrl}/dashboard/${yesterday}`;

    console.log(`[cron/daily] Posting Slack summary…`);
    await postDailySummary(processed, dashboardUrl, prevSummary ?? null);
    console.log(`[cron/daily] Slack posted`);

    return NextResponse.json({
      status: 'ok',
      date: yesterday,
      summary: {
        revenue: processed.total.revenue,
        netSales: processed.total.netSales,
        orders: processed.total.orders,
        orderRows: orderRows.length,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[cron/daily] Error: ${msg}`);

    try {
      const token = process.env.SLACK_BOT_TOKEN;
      const channel = process.env.SLACK_CHANNEL_ID;
      if (token && channel) {
        await new WebClient(token).chat.postMessage({
          channel,
          text: `🚨 *Daily cron failed* for ${yesterday}\n\`\`\`${msg}\`\`\``,
        });
      }
    } catch { /* swallow */ }

    return NextResponse.json({ error: msg, date: yesterday }, { status: 500 });
  }
}
