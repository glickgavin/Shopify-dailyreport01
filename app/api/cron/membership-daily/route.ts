/**
 * Membership daily chain cron.
 *
 * Runs three steps in strict order.  A failure in any step throws immediately
 * so subsequent steps never execute with stale or incomplete data.
 *
 *   Step 1 – sync   : fetch yesterday's Shopify orders, extract VIP Membership
 *                     line items, upsert into membership_billing_events.
 *   Step 2 – snapshot: write membership_status_snapshots rows for today,
 *                     reflecting all billing events synced through yesterday.
 *   Step 3 – metrics: compute and upsert one membership_metrics_daily row for
 *                     today (LTV, survival curve, cohort triangle, etc.).
 *
 * Scheduled at 07:20 UTC — 5 min after the main daily pipeline (07:15) so
 * any events that pipeline wrote are already present when the snapshot runs.
 *
 * Override params (for manual re-runs):
 *   ?sync_date=YYYY-MM-DD      default: yesterday (store TZ)
 *   ?snapshot_date=YYYY-MM-DD  default: today (store TZ)
 *   ?metrics_date=YYYY-MM-DD   default: today (store TZ)
 */

import { NextRequest, NextResponse } from 'next/server';
import { subDays } from 'date-fns';
import { toZonedTime, format } from 'date-fns-tz';
import { WebClient } from '@slack/web-api';
import { syncMembershipEventsForDate } from '@/lib/membership-sync';
import { runMembershipStatusSnapshot } from '@/lib/membership-status';
import { computeAndSaveMembershipMetrics } from '@/lib/membership-metrics';
import { checkMembershipAlerts } from '@/lib/membership-alerts';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime    = 'nodejs';
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const secret      = process.env.CRON_SECRET;
  const headerAuth  = req.headers.get('authorization');
  const querySecret = req.nextUrl.searchParams.get('secret');
  const authorized  = secret && (headerAuth === `Bearer ${secret}` || querySecret === secret);
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tz        = process.env.STORE_TIMEZONE ?? 'America/Los_Angeles';
  const now       = new Date();
  const today     = format(toZonedTime(now, tz), 'yyyy-MM-dd', { timeZone: tz });
  const yesterday = format(toZonedTime(subDays(now, 1), tz), 'yyyy-MM-dd', { timeZone: tz });

  const syncDate     = req.nextUrl.searchParams.get('sync_date')     ?? yesterday;
  const snapshotDate = req.nextUrl.searchParams.get('snapshot_date') ?? today;
  const metricsDate  = req.nextUrl.searchParams.get('metrics_date')  ?? today;

  try {
    // ── Step 1: sync (throws → steps 2-3 skipped) ────────────────────────────
    const sync = await syncMembershipEventsForDate(syncDate);
    console.log(
      `[membership-daily] step1/sync date=${sync.date}` +
      ` rows=${sync.rows_synced} intro=${sync.intro} recurring=${sync.recurring}`,
    );

    // ── Step 2: snapshot ──────────────────────────────────────────────────────
    const snap = await runMembershipStatusSnapshot(snapshotDate);
    console.log(
      `[membership-daily] step2/snapshot date=${snap.snapshot_date}` +
      ` total=${snap.total} active=${snap.active} new=${snap.new_members}` +
      ` intro_cancelled=${snap.intro_cancelled} suspect=${snap.involuntary_suspect}` +
      ` churned=${snap.churned} billed=${snap.billed_this_period}`,
    );

    // ── Step 3: metrics ───────────────────────────────────────────────────────
    const metrics = await computeAndSaveMembershipMetrics(metricsDate);
    console.log(
      `[membership-daily] step3/metrics date=${metrics.metric_date}` +
      ` active=${metrics.active_members} new=${metrics.new_signups}` +
      ` mrr=${metrics.mrr_net.toFixed(2)}` +
      ` churn=${(metrics.avg_monthly_churn * 100).toFixed(1)}%` +
      ` ltv_conservative=${metrics.conservative_ltv.toFixed(2)}` +
      ` ltv_projected=${metrics.projected_ltv.toFixed(2)}`,
    );

    // ── Step 4: data-quality alerts ───────────────────────────────────────────
    const memAlerts = await checkMembershipAlerts(metrics);
    if (memAlerts.length > 0) {
      console.log(
        `[membership-daily] step4/alerts count=${memAlerts.length} ` +
        memAlerts.map((a) => `${a.level}:${a.rule}`).join(', '),
      );
      const token   = process.env.SLACK_BOT_TOKEN;
      const channel = process.env.SLACK_CHANNEL_ID;
      if (token && channel && process.env.DRY_RUN !== 'true') {
        const lines = memAlerts.map((a) => `${a.level === 'red' ? '🔴' : '🟡'} ${a.message}`).join('\n');
        await new WebClient(token).chat.postMessage({
          channel,
          text: `⚠️ *Membership alert* for ${metricsDate}\n${lines}`,
        });
      }
      await supabaseAdmin.from('job_logs').insert({
        date:     metricsDate,
        job_type: 'membership_alert',
        status:   'alert',
        message:  memAlerts.map((a) => a.message).join(' | '),
        meta:     { alerts: memAlerts },
      });
    } else {
      console.log(`[membership-daily] step4/alerts none`);
    }

    return NextResponse.json({ status: 'ok', sync, snapshot: snap, metrics, alerts: memAlerts });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[membership-daily] error: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
