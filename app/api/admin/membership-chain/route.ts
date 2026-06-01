/**
 * On-demand membership chain re-trigger.
 *
 * Consistent with the existing one-shot backfill routes
 * (admin/membership-backfill, admin/membership-snapshot).
 *
 * For each date in the requested range (oldest-first):
 *   1. Sync membership billing events from Shopify
 *   2. Write membership_status_snapshots row
 *
 * After all dates are processed, writes one membership_metrics_daily row
 * for the MOST RECENT date in the range.  (Metrics always reflect the full
 * billing history, so running them once at the end is correct.)
 *
 * Query params:
 *   ?date=YYYY-MM-DD   single date (defaults to yesterday)
 *   ?days=N            last N days, oldest-first (max 365)
 *
 * Fails per-date on Shopify/DB errors; continues to next date so a single
 * bad day doesn't abort the whole range.
 */

import { NextRequest, NextResponse } from 'next/server';
import { subDays } from 'date-fns';
import { toZonedTime, format } from 'date-fns-tz';
import { syncMembershipEventsForDate, type MembershipSyncResult } from '@/lib/membership-sync';
import { runMembershipStatusSnapshot, type MembershipSnapshotResult } from '@/lib/membership-status';
import { computeAndSaveMembershipMetrics, type MembershipMetricsResult } from '@/lib/membership-metrics';

export const runtime     = 'nodejs';
export const maxDuration = 300;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization');
  const query  = req.nextUrl.searchParams.get('secret');
  return header === `Bearer ${secret}` || query === secret;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tz         = process.env.STORE_TIMEZONE ?? 'America/Los_Angeles';
  const singleDate = req.nextUrl.searchParams.get('date');
  const daysParam  = req.nextUrl.searchParams.get('days');

  const dates: string[] = [];
  if (singleDate) {
    dates.push(singleDate);
  } else if (daysParam) {
    const days = Math.min(parseInt(daysParam, 10), 365);
    for (let i = days; i >= 1; i--) {
      dates.push(format(toZonedTime(subDays(new Date(), i), tz), 'yyyy-MM-dd', { timeZone: tz }));
    }
  } else {
    dates.push(format(toZonedTime(subDays(new Date(), 1), tz), 'yyyy-MM-dd', { timeZone: tz }));
  }

  type PerDateResult =
    | { sync: MembershipSyncResult; snapshot: MembershipSnapshotResult }
    | { error: string };

  const results: Record<string, PerDateResult> = {};

  for (const date of dates) {
    try {
      const sync     = await syncMembershipEventsForDate(date);
      const snapshot = await runMembershipStatusSnapshot(date);
      results[date]  = { sync, snapshot };
    } catch (e) {
      results[date] = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  // Metrics for the last date in the range (uses full billing history each time).
  const metricsDate = dates[dates.length - 1];
  let metrics: MembershipMetricsResult | null = null;
  let metricsError: string | null = null;
  try {
    metrics = await computeAndSaveMembershipMetrics(metricsDate);
  } catch (e) {
    metricsError = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json({
    status: 'ok',
    dates_processed: dates.length,
    metrics_date: metricsDate,
    metrics: metrics ?? { error: metricsError },
    results,
  });
}
