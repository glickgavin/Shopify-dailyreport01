import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { fetchAds } from '@/lib/ads';
import { computeDerivedKPIs } from '@/lib/business-rules';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: { date: string } }) {
  const { date } = params;

  const [
    { data: summary },
    { data: products },
    { data: memOrders },
    { data: stripeSnap },
    ads,
  ] = await Promise.all([
    supabaseAdmin.from('daily_summary').select('*').eq('date', date).single(),
    supabaseAdmin.from('daily_products').select('*').eq('date', date).order('revenue', { ascending: false }),
    supabaseAdmin.from('daily_membership_orders').select('*').eq('date', date).order('order_name'),
    supabaseAdmin.from('stripe_daily_snapshot').select('payload').eq('date', date).single(),
    fetchAds(date),
  ]);

  if (!summary) {
    return NextResponse.json({ error: 'No data for this date' }, { status: 404 });
  }

  type StripeSummary = { direct_success_total_cents: number; refunds_total_cents: number };
  const stripeSummary = stripeSnap
    ? (stripeSnap.payload as unknown as { summary: StripeSummary }).summary
    : null;

  const derived = computeDerivedKPIs(
    {
      total:      { revenue: summary.total_revenue, profit: summary.total_profit, orders: summary.total_orders },
      physCash:   { revenue: summary.phys_cash_revenue },
      membership: { revenue: summary.mem_revenue },
    } as Parameters<typeof computeDerivedKPIs>[0],
    ads?.spend     ?? null,
    ads?.purchases ?? null,
    stripeSummary?.direct_success_total_cents ?? null,
    stripeSummary?.refunds_total_cents        ?? null,
  );

  return NextResponse.json({
    date,
    summary,
    products: products ?? [],
    memOrders: memOrders ?? [],
    ads: ads ?? null,
    stripe: stripeSnap?.payload ?? null,
    derived,
  });
}
