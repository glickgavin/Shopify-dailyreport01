/**
 * ONE-TIME full-history membership backfill.
 *
 * Fetches 150 days of Shopify orders to capture membership billing events
 * from the very first sign-up (February 2026), then re-writes today's
 * snapshot and metrics with the complete dataset.
 *
 * This route is TEMPORARY.  Remove from vercel.json once the backfill has
 * run successfully (check logs or query membership_billing_events for rows
 * with charged_at < '2026-03-03').
 *
 * Idempotent: safe to run multiple times; upserts are no-ops for existing rows.
 */

import { NextRequest, NextResponse } from 'next/server';
import { subDays } from 'date-fns';
import { toZonedTime, format } from 'date-fns-tz';
import { fetchOrdersForDate } from '@/lib/queries/orders';
import { upsertMembershipBillingEvents } from '@/lib/persistence';
import { supabaseAdmin } from '@/lib/supabase';
import { runMembershipStatusSnapshot } from '@/lib/membership-status';
import { computeAndSaveMembershipMetrics } from '@/lib/membership-metrics';
import { checkMembershipAlerts } from '@/lib/membership-alerts';

export const runtime     = 'nodejs';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret      = process.env.CRON_SECRET;
  const headerAuth  = req.headers.get('authorization');
  const querySecret = req.nextUrl.searchParams.get('secret');
  const authorized  = secret && (headerAuth === `Bearer ${secret}` || querySecret === secret);
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tz    = process.env.STORE_TIMEZONE ?? 'America/Los_Angeles';
  const today = format(toZonedTime(new Date(), tz), 'yyyy-MM-dd', { timeZone: tz });

  // ── Step 1: Backfill 150 days of billing events ───────────────────────────
  const BACKFILL_DAYS = 150;
  let totalRows    = 0;
  let totalIntro   = 0;
  let totalRecurring = 0;
  let maxChargedAt: string | null = null;
  const perDate: Record<string, unknown> = {};

  for (let i = BACKFILL_DAYS; i >= 1; i--) {
    const date = format(toZonedTime(subDays(new Date(), i), tz), 'yyyy-MM-dd', { timeZone: tz });
    try {
      const { membershipBillingRows } = await fetchOrdersForDate(date);
      const count    = await upsertMembershipBillingEvents(membershipBillingRows);
      const intro    = membershipBillingRows.filter(r => r.is_intro).length;
      const recurring = membershipBillingRows.length - intro;

      perDate[date]   = { rows: count, intro, recurring };
      totalRows      += count;
      totalIntro     += intro;
      totalRecurring += recurring;

      if (membershipBillingRows.length > 0) {
        const dayMax = membershipBillingRows.reduce(
          (m, r) => (r.charged_at > m ? r.charged_at : m),
          membershipBillingRows[0].charged_at,
        );
        if (!maxChargedAt || dayMax > maxChargedAt) maxChargedAt = dayMax;
      }
    } catch (e) {
      perDate[date] = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  if (maxChargedAt) {
    await supabaseAdmin
      .from('membership_sync_state')
      .update({
        last_synced_charged_at: maxChargedAt,
        last_run_at:            new Date().toISOString(),
        last_run_status:        'success',
        last_run_rows:          totalRows,
      })
      .eq('id', 1);
  }

  console.log(
    `[membership-once-full] backfill complete:` +
    ` dates=${BACKFILL_DAYS} total_rows=${totalRows}` +
    ` intro=${totalIntro} recurring=${totalRecurring}`,
  );

  // ── Step 2: Refresh today's snapshot ──────────────────────────────────────
  const snap = await runMembershipStatusSnapshot(today);
  console.log(
    `[membership-once-full] snapshot date=${snap.snapshot_date}` +
    ` total=${snap.total} active=${snap.active} new=${snap.new_members}`,
  );

  // ── Step 3: Refresh today's metrics ───────────────────────────────────────
  const metrics = await computeAndSaveMembershipMetrics(today);
  console.log(
    `[membership-once-full] metrics active=${metrics.active_members}` +
    ` conservative_ltv=${metrics.conservative_ltv.toFixed(2)}` +
    ` projected_ltv=${metrics.projected_ltv.toFixed(2)}`,
  );

  // ── Step 4: Data-quality check ────────────────────────────────────────────
  const memAlerts = await checkMembershipAlerts(metrics);
  if (memAlerts.length > 0) {
    console.log(
      `[membership-once-full] alerts count=${memAlerts.length} ` +
      memAlerts.map((a) => `${a.level}:${a.rule}`).join(', '),
    );
    await supabaseAdmin.from('job_logs').insert({
      date:     today,
      job_type: 'membership_alert',
      status:   'alert',
      message:  memAlerts.map((a) => a.message).join(' | '),
      meta:     { alerts: memAlerts },
    });
  } else {
    console.log(`[membership-once-full] alerts none`);
  }

  return NextResponse.json({
    status: 'ok',
    backfill: { dates_processed: BACKFILL_DAYS, total_rows: totalRows, intro: totalIntro, recurring: totalRecurring },
    snapshot: snap,
    metrics,
    alerts: memAlerts,
  });
}
