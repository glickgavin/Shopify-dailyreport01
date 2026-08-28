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

type RangePreset = '3d' | '7d' | '30d' | '60d';

function computeRange(preset: string | undefined): { startDate: string; endDate: string; preset: RangePreset; days: number } {
  const yest = format(subDays(new Date(), 1), 'yyyy-MM-dd');
  const p: RangePreset = preset === '3d' || preset === '30d' || preset === '60d' ? preset : '7d';
  const days = p === '3d' ? 3 : p === '30d' ? 30 : p === '60d' ? 60 : 7;
  return { startDate: format(subDays(new Date(), days), 'yyyy-MM-dd'), endDate: yest, preset: p, days };
}

// PostgREST caps every query at 1000 rows; wide windows exceed that and get
// silently truncated (the 30d AOV chart lost its most recent days that way).
// Page through explicitly so no window size can drop rows.
async function fetchPaged<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  for (let from = 0; from < 100_000; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

export default async function AovPage({ searchParams }: { searchParams: { preset?: string } }) {
  const { startDate, endDate, preset, days } = computeRange(searchParams.preset);

  const [{ data: summaryRows }, codeLevelRows, productLevelRows] = await Promise.all([
    supabaseAdmin
      .from('daily_summary')
      .select('date,total_revenue,total_orders,phys_cash_revenue,phys_cash_orders,phys_non_cash_revenue,phys_non_cash_orders,mem_revenue,mem_orders,amazon_revenue,amazon_orders')
      .gte('date', startDate).lte('date', endDate)
      .order('date', { ascending: true }),
    // Code-level rows only (product=ALL, variant=ALL): codes + blended.
    fetchPaged<any>((from, to) => supabaseAdmin
      .from('daily_discounts')
      .select('date,discount_code,product_title,variant_title,orders,order_value,units_primary')
      .gte('date', startDate).lte('date', endDate)
      .eq('product_title', 'ALL').eq('variant_title', 'ALL')
      .order('date', { ascending: true })
      .range(from, to)),
    // Product-level rows only (code=ALL, variant=ALL, specific product).
    fetchPaged<any>((from, to) => supabaseAdmin
      .from('daily_discounts')
      .select('date,discount_code,product_title,variant_title,orders,order_value,units_primary')
      .gte('date', startDate).lte('date', endDate)
      .eq('discount_code', 'ALL').eq('variant_title', 'ALL').neq('product_title', 'ALL')
      .order('date', { ascending: true })
      .range(from, to)),
  ]);

  const segments: SegmentDay[] = (summaryRows ?? []).map(r => ({
    date: r.date,
    totalRev: Number(r.total_revenue ?? 0),          totalOrd: Number(r.total_orders ?? 0),
    cashRev: Number(r.phys_cash_revenue ?? 0),       cashOrd: Number(r.phys_cash_orders ?? 0),
    noncashRev: Number(r.phys_non_cash_revenue ?? 0), noncashOrd: Number(r.phys_non_cash_orders ?? 0),
    memRev: Number(r.mem_revenue ?? 0),              memOrd: Number(r.mem_orders ?? 0),
    amazonRev: Number(r.amazon_revenue ?? 0),        amazonOrd: Number(r.amazon_orders ?? 0),
  }));

  type DRow = { date: string; discount_code: string; product_title: string; variant_title: string; orders: number; order_value: number; units_primary: number };
  const codeRows = codeLevelRows as DRow[];
  const prodRows = productLevelRows as DRow[];

  // Products: one row per (day, product title), full order value + own units.
  const products: DimRow[] = prodRows
    .map(r => ({ date: r.date, key: r.product_title, orders: Number(r.orders), value: Number(r.order_value), units: Number(r.units_primary ?? 0) }));

  // Discount codes, excluding the blended sentinel. '' = no discount.
  const codes: DimRow[] = codeRows
    .filter(r => r.discount_code !== 'ALL')
    .map(r => ({ date: r.date, key: r.discount_code, orders: Number(r.orders), value: Number(r.order_value), units: Number(r.units_primary ?? 0) }));

  // Blended (code=ALL) rows: overall tiles-per-order reference for Order Size.
  const blendedTiles = codeRows
    .filter(r => r.discount_code === 'ALL')
    .map(r => ({ date: r.date, orders: Number(r.orders), units: Number(r.units_primary ?? 0) }));

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '20px 40px', flexWrap: 'wrap' }}>
        <div style={{ fontFamily: 'var(--font-heading)', fontSize: 22, lineHeight: 1 }}>
          AOV <span style={{ color: 'var(--accent)' }}>Analysis</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {([['3d', '3 days'], ['7d', '7 days'], ['30d', '30 days'], ['60d', '60 days']] as [RangePreset, string][]).map(([id, lbl]) => (
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

      <main style={{ maxWidth: 1520, margin: '0 auto', padding: '24px 32px 72px' }}>
        {segments.length === 0 ? (
          <div style={{ color: 'var(--neutral-600)', fontSize: 14 }}>No data found for this range.</div>
        ) : (
          <AovClient segments={segments} products={products} codes={codes} blendedTiles={blendedTiles} days={days} />
        )}
      </main>
    </div>
  );
}
