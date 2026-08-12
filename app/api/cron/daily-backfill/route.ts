import { NextRequest, NextResponse } from 'next/server';
import { subDays } from 'date-fns';
import { toZonedTime, format } from 'date-fns-tz';
import { supabaseAdmin } from '@/lib/supabase';
import { runPipelineWithErrorHandling } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Self-driving pipeline catch-up. Every run looks at the last BACKFILL_DAYS
// full PT days and, if any of them has no daily_countries rows (the newest
// pipeline output — a reliable "was this day processed by current code?"
// marker), re-runs the full daily pipeline for the MOST RECENT missing day.
// One day per invocation keeps each run well inside the time limit; once no
// days are missing the route is a no-op, so it is safe to leave scheduled as
// a permanent self-healer for failed nightly runs.
//
// Note: re-running a past day recomputes it from current Shopify state, so
// historical totals can shift slightly (e.g. refunds since the original run).
// Widened 7 → 40 to backfill July 2026 discount tables (one day per 10-min
// run ≈ 5½ h for a month); harmless afterwards — it no-ops once nothing is
// missing in the window.
const BACKFILL_DAYS = 40;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization');
  const query = req.nextUrl.searchParams.get('secret');
  return header === `Bearer ${secret}` || query === secret;
}

async function run(): Promise<NextResponse> {
  const tz = process.env.STORE_TIMEZONE ?? 'America/Los_Angeles';
  // Candidate dates: yesterday back to BACKFILL_DAYS ago (PT), newest first.
  const candidates: string[] = [];
  for (let i = 1; i <= BACKFILL_DAYS; i++) {
    candidates.push(format(toZonedTime(subDays(new Date(), i), tz), 'yyyy-MM-dd', { timeZone: tz }));
  }

  const { data: doneRows, error } = await (supabaseAdmin as any)
    .from('daily_countries')
    .select('date')
    .in('date', candidates);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const done = new Set(((doneRows ?? []) as { date: string }[]).map(r => r.date));
  const missing = candidates.filter(d => !done.has(d));
  if (missing.length === 0) {
    return NextResponse.json({ status: 'ok', done: true, message: 'no missing days' });
  }

  const target = missing[0]; // most recent missing day
  console.log(`[daily-backfill] ${missing.length} day(s) missing; processing ${target}`);
  const result = await runPipelineWithErrorHandling(target, { silent: true, jobType: 'discount_backfill' });

  return NextResponse.json({
    status: 'ok',
    processed: target,
    remaining: missing.length - 1,
    summary: result.summary,
  });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run();
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run();
}
