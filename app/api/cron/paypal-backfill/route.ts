import { NextRequest, NextResponse } from 'next/server';
import { subDays } from 'date-fns';
import { toZonedTime, format } from 'date-fns-tz';
import { fetchAndStorePayPalSnapshot } from '@/lib/paypal-snapshot';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Fills gaps in paypal_daily_snapshot from HISTORY_START through yesterday
// (store timezone), oldest first, a few days per tick. A no-op once complete,
// so it also self-heals any day the 07:12 daily cron silently skips.

const HISTORY_START = '2026-01-01';
const DAYS_PER_TICK = 3;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization');
  const query  = req.nextUrl.searchParams.get('secret');
  return header === `Bearer ${secret}` || query === secret;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    return NextResponse.json({ error: 'PayPal credentials not configured' }, { status: 500 });
  }

  const tz = process.env.STORE_TIMEZONE ?? 'Asia/Jerusalem';
  const yesterday = format(toZonedTime(subDays(new Date(), 1), tz), 'yyyy-MM-dd', { timeZone: tz });

  const have = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('paypal_daily_snapshot')
      .select('date')
      .order('date', { ascending: true })
      .range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const row of (data ?? []) as { date: string }[]) have.add(row.date);
    if ((data ?? []).length < 1000) break;
  }

  const missing: string[] = [];
  for (let d = new Date(`${HISTORY_START}T00:00:00Z`); ; d = new Date(d.getTime() + 86400_000)) {
    const iso = d.toISOString().slice(0, 10);
    if (iso > yesterday) break;
    if (!have.has(iso)) missing.push(iso);
    if (missing.length >= DAYS_PER_TICK * 20) break; // plenty to report; we only process a few
  }

  const done: string[] = [];
  let failed: { date: string; error: string } | null = null;
  for (const date of missing.slice(0, DAYS_PER_TICK)) {
    try {
      await fetchAndStorePayPalSnapshot(date, tz);
      done.push(date);
    } catch (err) {
      failed = { date, error: (err as Error).message.slice(0, 200) };
      break; // leave the date missing; next tick retries it
    }
  }

  const result = { filled: done, remaining_missing: missing.length - done.length, ...(failed ? { failed } : {}) };
  console.log('[paypal-backfill]', JSON.stringify(result));
  return NextResponse.json({ status: 'ok', ...result });
}
