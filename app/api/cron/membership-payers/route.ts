import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  computeStripeMonthlyPayers,
  computePayPalMonthlyPayers,
  storeMonthlyPayers,
  monthsSinceJan2026,
} from '@/lib/membership-payers';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Hourly rollup of membership payments per calendar month, per provider.
// Each run fills the OLDEST month (since Jan 2026) that has no row yet, so the
// backfill completes over the first few hours; once nothing is missing it
// recomputes the current month so the live month stays fresh. ?month=yyyy-MM
// forces a specific month.

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization');
  const query  = req.nextUrl.searchParams.get('secret');
  return header === `Bearer ${secret}` || query === secret;
}

async function run(req: NextRequest): Promise<NextResponse> {
  const months = monthsSinceJan2026();
  const forced = req.nextUrl.searchParams.get('month');

  let target: string;
  if (forced && /^\d{4}-\d{2}$/.test(forced)) {
    target = forced;
  } else {
    const { data: haveRows, error } = await (supabaseAdmin as any)
      .from('membership_monthly_payers')
      .select('month, provider');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const have = new Set((haveRows ?? []).map((r: { month: string; provider: string }) => `${r.month.slice(0, 7)}|${r.provider}`));
    const missing = months.find(m => !have.has(`${m}|stripe`) || !have.has(`${m}|paypal`));
    target = missing ?? months[months.length - 1]; // nothing missing → refresh current month
  }

  const [stripeRow, paypalRow] = await Promise.all([
    computeStripeMonthlyPayers(target),
    computePayPalMonthlyPayers(target),
  ]);
  await storeMonthlyPayers([stripeRow, paypalRow]);

  console.log(`[membership-payers] ${target}: stripe ${stripeRow.unique_payers} payers / paypal ${paypalRow.unique_payers} payers`);
  return NextResponse.json({ status: 'ok', month: target, stripe: stripeRow, paypal: paypalRow });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run(req);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run(req);
}
