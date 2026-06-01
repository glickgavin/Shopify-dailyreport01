/**
 * On-demand membership metrics computation.
 *
 * GET ?date=YYYY-MM-DD   — compute metrics for a specific date (defaults to yesterday)
 * GET ?days=N            — compute metrics for the last N dates (max 90)
 *
 * Idempotent: re-running for the same date replaces that date's row.
 */

import { NextRequest, NextResponse } from 'next/server';
import { subDays } from 'date-fns';
import { toZonedTime, format } from 'date-fns-tz';
import { computeAndSaveMembershipMetrics } from '@/lib/membership-metrics';

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
    const days = Math.min(parseInt(daysParam, 10), 90);
    for (let i = days; i >= 0; i--) {
      dates.push(format(toZonedTime(subDays(new Date(), i), tz), 'yyyy-MM-dd', { timeZone: tz }));
    }
  } else {
    dates.push(format(toZonedTime(subDays(new Date(), 1), tz), 'yyyy-MM-dd', { timeZone: tz }));
  }

  const results: Record<string, { metric_date: string; active_members: number; conservative_ltv: number; projected_ltv: number } | { error: string }> = {};

  for (const date of dates) {
    try {
      const r       = await computeAndSaveMembershipMetrics(date);
      results[date] = { metric_date: r.metric_date, active_members: r.active_members, conservative_ltv: r.conservative_ltv, projected_ltv: r.projected_ltv };
    } catch (e) {
      results[date] = { error: e instanceof Error ? e.message : String(e) };
    }
  }

  return NextResponse.json({ status: 'ok', dates_processed: dates.length, results });
}
