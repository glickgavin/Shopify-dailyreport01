import Link from 'next/link';
import { subDays, format } from 'date-fns';
import { supabaseAdmin } from '@/lib/supabase';
import AovClient, { type SegmentDay, type DimRow } from './AovClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ── AOV analysis tool ─────────────────────────────────────────────────────────
// Standalone dashboard page for analysing AOV over time under three rules:
//   1. by sales segment (Cash / Non-Cash / Membership / Amazon) — exact, the
//      segments are disjoint so the selected mix's AOV is revenue ÷ orders.
//   2. by product — from the daily_discounts rollup at code=ALL, variant=ALL:
//      per product per day, distinct orders containing it and their full
//      order value → AOV = order value ÷ orders.
//   3. by discount code — same rollup at product=ALL: per code per day.
// The client component handles selection and recomputes instantly.

type RangePreset = '3d' | '7d' | '30d';

function computeRange(preset: string | undefined): { startDate: string; endDate: string; preset: RangePreset; days: number } {
  const yest = format(subDays(new Date(), 1), 'yyyy-MM-dd');
  const p: RangePreset = preset === '3d' || preset === '30d' ? preset : '7d';
  const days = p === '3d' ? 3 : p === '30d' ? 30 : 7;
  return { startDate: format(subDays(new Date(), days), 'yyyy-MM-dd'), endDate: yest, preset: p, days };
}

export default async function AovPage({ searchParams }: { searchParams: { preset?: string } }) {
  const { startDate, endDate, preset, days } = computeRange(searchParams.preset);

  const [{ data: summaryRows }, { data: discountRows }] = await Promise.all([
    supabaseAdmin
      .from('daily_summary')
      .select('date,total_revenue,total_orders,phys_cash_revenue,phys_cash_orders,phys_non_cash_revenue,phys_non_cash_orders,mem_revenue,mem_orders,amazon_revenue,amazon_orders')
      .gte('date', startDate).lte('date', endDate)
      .order('date', { ascending: true }),
    supabaseAdmin
      .from('daily_discounts')
      .select('date,discount_code,product_title,variant_title,orders,order_value')
      .gte('date', startDate).lte('date', endDate),
  ]);

  const segments: SegmentDay[] = (summaryRows ?? []).map(r => ({
    date: r.date,
    totalRev: Number(r.total_revenue ?? 0),          totalOrd: Number(r.total_orders ?? 0),
    cashRev: Number(r.phys_cash_revenue ?? 0),       cashOrd: Number(r.phys_cash_orders ?? 0),
    noncashRev: Number(r.phys_non_cash_revenue ?? 0), noncashOrd: Number(r.phys_non_cash_orders ?? 0),
    memRev: Number(r.mem_revenue ?? 0),              memOrd: Number(r.mem_orders ?? 0),
    amazonRev: Number(r.amazon_revenue ?? 0),        amazonOrd: Number(r.amazon_orders ?? 0),
  }));

  const dRows = (discountRows ?? []) as { date: string; discount_code: string; product_title: string; variant_title: string; orders: number; order_value: number }[];

  // Products: blended-code rows, title level (variant=ALL), excluding the ALL sentinel.
  const products: DimRow[] = dRows
    .filter(r => r.discount_code === 'ALL' && r.variant_title === 'ALL' && r.product_title !== 'ALL')
    .map(r => ({ date: r.date, key: r.product_title, orders: Number(r.orders), value: Number(r.order_value) }));

  // Discount codes: product=ALL rows, excluding the blended sentinel. '' = no discount.
  const codes: DimRow[] = dRows
    .filter(r => r.product_title === 'ALL' && r.variant_title === 'ALL' && r.discount_code !== 'ALL')
    .map(r => ({ date: r.date, key: r.discount_code, orders: Number(r.orders), value: Number(r.order_value) }));

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '20px 40px', flexWrap: 'wrap' }}>
        <div style={{ fontFamily: 'var(--font-heading)', fontSize: 22, lineHeight: 1 }}>
          AOV <span style={{ color: 'var(--accent)' }}>Analysis</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {([['3d', '3 days'], ['7d', '7 days'], ['30d', '30 days']] as [RangePreset, string][]).map(([id, lbl]) => (
            <Link key={id} href={`/dashboard/aov?preset=${id}`}
              className={`pill pill--sm${preset === id ? ' pill--active' : ''}`}>
              {lbl}
            </Link>
          ))}
        </div>
        <div style={{ fontSize: 13, color: 'var(--neutral-700)' }}>
          {days} days · {startDate} → {endDate} · Pacific
        </div>
      </header>

      <main style={{ maxWidth: 1160, margin: '0 auto', padding: '24px 32px 72px' }}>
        {segments.length === 0 ? (
          <div style={{ color: 'var(--neutral-600)', fontSize: 14 }}>No data found for this range.</div>
        ) : (
          <AovClient segments={segments} products={products} codes={codes} days={days} />
        )}
      </main>
    </div>
  );
}
