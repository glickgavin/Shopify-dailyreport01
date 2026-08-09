import { WebClient } from '@slack/web-api';
import { subDays } from 'date-fns';
import { toZonedTime, format } from 'date-fns-tz';
import { fetchOrdersForDate } from '@/lib/queries/orders';
import { processDay, computeDerivedKPIs } from '@/lib/business-rules';
import { saveDay, upsertMembershipBillingEvents } from '@/lib/persistence';
import { computeDailyDiscountRows, saveDailyDiscounts } from '@/lib/discounts';
import { runMembershipStatusSnapshot } from '@/lib/membership-status';
import { computeAndSaveMembershipMetrics } from '@/lib/membership-metrics';
import { postDailySummary } from '@/lib/slack';
import { checkAlerts } from '@/lib/alerts';
import { checkMembershipAlerts } from '@/lib/membership-alerts';
import { supabaseAdmin } from '@/lib/supabase';
import { fetchAds } from '@/lib/ads';

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

  const { orderRows, paymentRows, membershipBillingRows } = await fetchOrdersForDate(date);
  console.log(`[pipeline] Fetched ${orderRows.length} order rows, ${paymentRows.length} payment rows, ${membershipBillingRows.length} membership billing rows`);

  const processed = processDay(orderRows, paymentRows, date);
  console.log(`[pipeline] Processed: revenue=${processed.total.revenue}, orders=${processed.total.orders}`);

  await saveDay(processed, orderRows, paymentRows);

  // Discount-code rollup — same rows, same rules, so it ties out with the rest.
  const discountRows = computeDailyDiscountRows(orderRows, date);
  await saveDailyDiscounts(date, discountRows);
  console.log(`[pipeline] Saved ${discountRows.length} daily_discounts rows`);

  const memCount = await upsertMembershipBillingEvents(membershipBillingRows);
  if (membershipBillingRows.length > 0) {
    const maxChargedAt = membershipBillingRows.reduce(
      (max, r) => (r.charged_at > max ? r.charged_at : max),
      membershipBillingRows[0].charged_at,
    );
    await supabaseAdmin
      .from('membership_sync_state')
      .update({
        last_synced_charged_at: maxChargedAt,
        last_run_at:            new Date().toISOString(),
        last_run_status:        'success',
        last_run_rows:          memCount,
      })
      .eq('id', 1);
  }
  console.log(`[pipeline] Saved (membership billing events: ${memCount})`);

  const snap = await runMembershipStatusSnapshot(date);
  console.log(`[pipeline] Membership snapshot date=${snap.snapshot_date} total=${snap.total} active=${snap.active} new=${snap.new_members} intro_cancelled=${snap.intro_cancelled} suspect=${snap.involuntary_suspect} churned=${snap.churned} billed_this_period=${snap.billed_this_period}`);

  const metrics = await computeAndSaveMembershipMetrics(date);
  console.log(`[pipeline] Membership metrics active=${metrics.active_members} new=${metrics.new_signups} mrr=${metrics.mrr_net.toFixed(2)} churn=${(metrics.avg_monthly_churn * 100).toFixed(1)}% ltv_conservative=${metrics.conservative_ltv.toFixed(2)} ltv_projected=${metrics.projected_ltv.toFixed(2)} one_and_done=${(metrics.one_and_done_rate * 100).toFixed(1)}%`);

  const memAlerts = await checkMembershipAlerts(metrics);
  if (memAlerts.length > 0) {
    console.log(`[pipeline] Membership alerts: ${memAlerts.map((a) => `${a.level}:${a.rule}`).join(', ')}`);
    const token = process.env.SLACK_BOT_TOKEN;
    const channel = process.env.SLACK_CHANNEL_ID;
    if (token && channel && process.env.DRY_RUN !== 'true') {
      const lines = memAlerts.map((a) => `${a.level === 'red' ? '🔴' : '🟡'} ${a.message}`).join('\n');
      await new WebClient(token).chat.postMessage({ channel, text: `⚠️ *Membership alert* for ${date}\n${lines}` });
    }
  }

  const prevDate = format(toZonedTime(subDays(new Date(date), 1), tz), 'yyyy-MM-dd', { timeZone: tz });
  const sevenDayStart = format(toZonedTime(subDays(new Date(date), 8), tz), 'yyyy-MM-dd', { timeZone: tz });

  const [
    { data: prevSummary },
    { data: historySummary },
    { data: todaySummary },
    { data: stripeSnap },
    adsData,
  ] = await Promise.all([
    supabaseAdmin.from('daily_summary').select('total_revenue, total_orders, total_net_sales').eq('date', prevDate).single(),
    supabaseAdmin.from('daily_summary').select('*').gte('date', sevenDayStart).lt('date', date).order('date', { ascending: false }),
    supabaseAdmin.from('daily_summary').select('*').eq('date', date).single(),
    supabaseAdmin.from('stripe_daily_snapshot').select('payload').eq('date', date).single(),
    fetchAds(date),
  ]);

  // Stripe snapshot summary (may be null if stripe cron hasn't run yet for this date)
  type StripeSummary = { direct_success_total_cents: number; refunds_total_cents: number };
  const stripeSummary = stripeSnap
    ? (stripeSnap.payload as unknown as { summary: StripeSummary }).summary
    : null;

  const derived = computeDerivedKPIs(
    processed,
    adsData?.spend ?? null,
    adsData?.purchases ?? null,
    stripeSummary?.direct_success_total_cents ?? null,
    stripeSummary?.refunds_total_cents        ?? null,
  );

  const alerts = todaySummary ? checkAlerts(todaySummary, historySummary ?? []) : [];
  if (alerts.length > 0) {
    console.log(`[pipeline] Alerts: ${alerts.map((a) => `${a.level}:${a.rule}`).join(', ')}`);
  }
  console.log(`[pipeline] Derived — cashIn=${derived.cashIn.toFixed(2)} adCost=${derived.adCost} dailyProfit=${derived.dailyProfit.toFixed(2)}`);

  if (!silent) {
    const appUrl = 'https://shopifydailyreport01.vercel.app';
    await postDailySummary(
      processed,
      `${appUrl}/dashboard/${date}`,
      prevSummary ?? null,
      alerts,
      {
        newOrders: processed.custNew.orders,
        newRevenue: processed.custNew.revenue,
        returningOrders: processed.custReturning.orders,
        returningRevenue: processed.custReturning.revenue,
      },
      derived,
    );
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
