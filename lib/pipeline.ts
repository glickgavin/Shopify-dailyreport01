import { WebClient } from '@slack/web-api';
import { subDays } from 'date-fns';
import { toZonedTime, format } from 'date-fns-tz';
import { fetchOrdersForDate } from '@/lib/queries/orders';
import { processDay } from '@/lib/business-rules';
import { saveDay } from '@/lib/persistence';
import { postDailySummary } from '@/lib/slack';
import { checkAlerts } from '@/lib/alerts';
import { supabaseAdmin } from '@/lib/supabase';

export interface PipelineResult {
  date: string;
  summary: {
    revenue: number;
    netSales: number;
    orders: number;
    orderRows: number;
    alerts: number;
  };
}

export async function runPipeline(
  date: string,
  options: { silent?: boolean; jobType?: string } = {},
): Promise<PipelineResult> {
  const tz = process.env.STORE_TIMEZONE ?? 'America/Los_Angeles';
  const silent = options.silent ?? false;
  const jobType = options.jobType ?? (silent ? 'backfill' : 'daily_cron');

  console.log(`[pipeline] Starting for date: ${date}`);

  const { orderRows, paymentRows } = await fetchOrdersForDate(date);
  console.log(`[pipeline] Fetched ${orderRows.length} order rows, ${paymentRows.length} payment rows`);

  const processed = processDay(orderRows, paymentRows, date);
  console.log(`[pipeline] Processed: revenue=${processed.total.revenue}, orders=${processed.total.orders}`);

  await saveDay(processed, orderRows, paymentRows);
  console.log(`[pipeline] Saved`);

  const prevDate = format(toZonedTime(subDays(new Date(date), 1), tz), 'yyyy-MM-dd', { timeZone: tz });
  const sevenDayStart = format(toZonedTime(subDays(new Date(date), 8), tz), 'yyyy-MM-dd', { timeZone: tz });

  const [{ data: prevSummary }, { data: historySummary }, { data: todaySummary }] = await Promise.all([
    supabaseAdmin.from('daily_summary').select('total_revenue, total_orders, total_net_sales').eq('date', prevDate).single(),
    supabaseAdmin.from('daily_summary').select('*').gte('date', sevenDayStart).lt('date', date).order('date', { ascending: false }),
    supabaseAdmin.from('daily_summary').select('*').eq('date', date).single(),
  ]);

  const alerts = todaySummary ? checkAlerts(todaySummary, historySummary ?? []) : [];
  if (alerts.length > 0) {
    console.log(`[pipeline] Alerts: ${alerts.map((a) => `${a.level}:${a.rule}`).join(', ')}`);
  }

  if (!silent) {
    // Hardcoded to production URL so Slack links always work, regardless of
    // which deployment ran the pipeline (preview, branch alias, etc.)
    const appUrl = 'https://shopifydailyreport01.vercel.app';
    await postDailySummary(processed, `${appUrl}/dashboard/${date}`, prevSummary ?? null, alerts, {
      newOrders: processed.custNew.orders,
      newRevenue: processed.custNew.revenue,
      returningOrders: processed.custReturning.orders,
      returningRevenue: processed.custReturning.revenue,
    });
    console.log(`[pipeline] Slack posted`);
  }

  await supabaseAdmin.from('job_logs').insert({
    date,
    job_type: jobType,
    status: 'success',
    message: `revenue=${processed.total.revenue} orders=${processed.total.orders} alerts=${alerts.length}`,
    meta: { orderRows: orderRows.length, paymentRows: paymentRows.length, alertCount: alerts.length },
  });

  return {
    date,
    summary: {
      revenue: processed.total.revenue,
      netSales: processed.total.netSales,
      orders: processed.total.orders,
      orderRows: orderRows.length,
      alerts: alerts.length,
    },
  };
}

export async function runPipelineWithErrorHandling(
  date: string,
  options: { silent?: boolean; jobType?: string } = {},
): Promise<PipelineResult> {
  try {
    return await runPipeline(date, options);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[pipeline] Error for ${date}: ${msg}`);

    try {
      await supabaseAdmin.from('job_logs').insert({
        date,
        job_type: options.jobType ?? (options.silent ? 'backfill' : 'daily_cron'),
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
          text: `🚨 *Pipeline failed* for ${date}\n\`\`\`${msg}\`\`\``,
        });
      }
    } catch { /* swallow */ }

    throw err;
  }
}
