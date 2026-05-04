import Link from 'next/link';
import { subDays, format, parseISO, isValid } from 'date-fns';
import { supabaseAdmin } from '@/lib/supabase';
import RevenueChart from '../_components/RevenueChart';
import {
  fmt, fmtDec, fmtPct,
  KpiCard, SegmentCard, SectionLabel,
} from '../_components/cards';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// ── date range helpers ────────────────────────────────────────────────────────

type Preset = 'today' | 'yesterday' | '3d' | '7d' | '30d';

function computeRange(
  preset: string | undefined,
  from: string | undefined,
  to: string | undefined,
): { startDate: string; endDate: string; label: string; days: number } {
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  if (preset === 'today') {
    return { startDate: todayStr, endDate: todayStr, label: 'Today', days: 1 };
  }
  if (preset === 'yesterday') {
    const d = format(subDays(new Date(), 1), 'yyyy-MM-dd');
    return { startDate: d, endDate: d, label: 'Yesterday', days: 1 };
  }
  if (preset === '3d') {
    const s = format(subDays(new Date(), 2), 'yyyy-MM-dd');
    return { startDate: s, endDate: todayStr, label: 'Past 3 Days', days: 3 };
  }
  if (preset === '30d') {
    const s = format(subDays(new Date(), 29), 'yyyy-MM-dd');
    return { startDate: s, endDate: todayStr, label: 'Past 30 Days', days: 30 };
  }
  // custom range
  if (preset === 'custom' && from && to) {
    const fParsed = parseISO(from);
    const tParsed = parseISO(to);
    if (isValid(fParsed) && isValid(tParsed) && fParsed <= tParsed) {
      const days = Math.round((tParsed.getTime() - fParsed.getTime()) / 86400000) + 1;
      const label = from === to
        ? format(fParsed, 'MMM d, yyyy')
        : `${format(fParsed, 'MMM d')} – ${format(tParsed, 'MMM d, yyyy')}`;
      return { startDate: from, endDate: to, label, days };
    }
  }
  // default: 7d
  const s = format(subDays(new Date(), 6), 'yyyy-MM-dd');
  return { startDate: s, endDate: todayStr, label: 'Past 7 Days', days: 7 };
}

// ── aggregation ───────────────────────────────────────────────────────────────

interface AggBlock {
  revenue: number;
  netSales: number;
  shipping: number;
  cogs: number;
  profit: number;
  margin: number;
  orders: number;
  qty: number;
  aov: number;
}

function emptyAgg(): AggBlock {
  return { revenue: 0, netSales: 0, shipping: 0, cogs: 0, profit: 0, margin: 0, orders: 0, qty: 0, aov: 0 };
}

function finalise(a: AggBlock): AggBlock {
  a.profit = a.revenue - a.cogs;
  a.margin = a.revenue > 0 ? (a.profit / a.revenue) * 100 : 0;
  a.aov    = a.orders > 0  ? a.revenue / a.orders       : 0;
  return a;
}

function aggSummaryRows(rows: Record<string, number>[], prefixes: { revenue: string; netSales: string; shipping: string; cogs: string; profit: string; orders: string; qty: string }): AggBlock {
  const a = emptyAgg();
  for (const r of rows) {
    a.revenue  += Number(r[prefixes.revenue]  ?? 0);
    a.netSales += Number(r[prefixes.netSales] ?? 0);
    a.shipping += Number(r[prefixes.shipping] ?? 0);
    a.cogs     += Number(r[prefixes.cogs]     ?? 0);
    a.profit   += Number(r[prefixes.profit]   ?? 0);
    a.orders   += Number(r[prefixes.orders]   ?? 0);
    a.qty      += Number(r[prefixes.qty]      ?? 0);
  }
  return finalise(a);
}

// ── page ─────────────────────────────────────────────────────────────────────

export default async function RangePage({
  searchParams,
}: {
  searchParams: { preset?: string; from?: string; to?: string };
}) {
  const { preset, from, to } = searchParams;
  const { startDate, endDate, label, days } = computeRange(preset, from, to);

  const [
    { data: summaryRows },
    { data: productRows },
    { data: segmentRows },
    { data: memTypeRows },
  ] = await Promise.all([
    supabaseAdmin
      .from('daily_summary')
      .select('total_revenue,total_net_sales,total_shipping,total_cogs,total_profit,total_orders,total_qty,phys_cash_revenue,phys_cash_net_sales,phys_cash_shipping,phys_cash_cogs,phys_cash_profit,phys_cash_orders,phys_cash_qty,phys_non_cash_revenue,phys_non_cash_net_sales,phys_non_cash_shipping,phys_non_cash_cogs,phys_non_cash_profit,phys_non_cash_orders,phys_non_cash_qty,mem_revenue,mem_net_sales,mem_shipping,mem_cogs,mem_profit,mem_orders,mem_qty')
      .gte('date', startDate)
      .lte('date', endDate),
    supabaseAdmin
      .from('daily_products')
      .select('title,variant,item_type,net_sales,shipping,cogs,revenue,qty,orders')
      .gte('date', startDate)
      .lte('date', endDate),
    supabaseAdmin
      .from('daily_customer_segments')
      .select('payment_type,customer_type,revenue,net_sales,shipping,cogs,profit,orders,qty')
      .gte('date', startDate)
      .lte('date', endDate),
    supabaseAdmin
      .from('daily_membership_orders')
      .select('membership_type')
      .gte('date', startDate)
      .lte('date', endDate),
  ]);

  const rows = summaryRows ?? [];

  // ── aggregate summary blocks ──────────────────────────────────────────────
  const total = aggSummaryRows(rows as Record<string, number>[], {
    revenue: 'total_revenue', netSales: 'total_net_sales', shipping: 'total_shipping',
    cogs: 'total_cogs', profit: 'total_profit', orders: 'total_orders', qty: 'total_qty',
  });
  const physCash = aggSummaryRows(rows as Record<string, number>[], {
    revenue: 'phys_cash_revenue', netSales: 'phys_cash_net_sales', shipping: 'phys_cash_shipping',
    cogs: 'phys_cash_cogs', profit: 'phys_cash_profit', orders: 'phys_cash_orders', qty: 'phys_cash_qty',
  });
  const physNonCash = aggSummaryRows(rows as Record<string, number>[], {
    revenue: 'phys_non_cash_revenue', netSales: 'phys_non_cash_net_sales', shipping: 'phys_non_cash_shipping',
    cogs: 'phys_non_cash_cogs', profit: 'phys_non_cash_profit', orders: 'phys_non_cash_orders', qty: 'phys_non_cash_qty',
  });
  const membership = aggSummaryRows(rows as Record<string, number>[], {
    revenue: 'mem_revenue', netSales: 'mem_net_sales', shipping: 'mem_shipping',
    cogs: 'mem_cogs', profit: 'mem_profit', orders: 'mem_orders', qty: 'mem_qty',
  });

  // ── aggregate customer segments ───────────────────────────────────────────
  const seg = (pt: string, ct: string) => {
    const matching = (segmentRows ?? []).filter(
      (s) => s.payment_type === pt && s.customer_type === ct,
    );
    const a = emptyAgg();
    for (const s of matching) {
      a.revenue  += Number(s.revenue  ?? 0);
      a.netSales += Number(s.net_sales ?? 0);
      a.shipping += Number(s.shipping ?? 0);
      a.cogs     += Number(s.cogs     ?? 0);
      a.profit   += Number(s.profit   ?? 0);
      a.orders   += Number(s.orders   ?? 0);
      a.qty      += Number(s.qty      ?? 0);
    }
    return finalise(a);
  };
  const cashNew      = seg('cash',     'new');
  const cashRet      = seg('cash',     'returning');
  const nonCashNew   = seg('non_cash', 'new');
  const nonCashRet   = seg('non_cash', 'returning');

  const totalNewOrders   = cashNew.orders  + nonCashNew.orders;
  const totalRetOrders   = cashRet.orders  + nonCashRet.orders;
  const totalNewRevenue  = cashNew.revenue + nonCashNew.revenue;
  const totalRetRevenue  = cashRet.revenue + nonCashRet.revenue;
  const totalNewCogs     = (cashNew.cogs   ?? 0) + (nonCashNew.cogs ?? 0);
  const totalRetCogs     = (cashRet.cogs   ?? 0) + (nonCashRet.cogs ?? 0);
  const totalNewAov      = totalNewOrders > 0 ? totalNewRevenue / totalNewOrders : 0;
  const totalRetAov      = totalRetOrders > 0 ? totalRetRevenue / totalRetOrders : 0;
  const totalNewMargin   = totalNewRevenue > 0 ? ((totalNewRevenue - totalNewCogs) / totalNewRevenue) * 100 : 0;
  const totalRetMargin   = totalRetRevenue > 0 ? ((totalRetRevenue - totalRetCogs) / totalRetRevenue) * 100 : 0;
  const hasSegments      = (segmentRows ?? []).length > 0;

  const cashNewOrders    = cashNew.orders;
  const cashRetOrders    = cashRet.orders;
  const nonCashNewOrders = nonCashNew.orders;
  const nonCashRetOrders = nonCashRet.orders;

  // ── membership new/recurring ──────────────────────────────────────────────
  const memNew       = (memTypeRows ?? []).filter((m) => m.membership_type === 'new').length;
  const memRecurring = (memTypeRows ?? []).filter((m) => m.membership_type === 'recurring').length;

  // ── aggregate products ────────────────────────────────────────────────────
  const productMap = new Map<string, {
    title: string; variant: string; item_type: string;
    net_sales: number; shipping: number; cogs: number; revenue: number; qty: number; orders: number;
  }>();
  for (const p of productRows ?? []) {
    const key = `${p.title}||${p.variant}`;
    if (!productMap.has(key)) {
      productMap.set(key, { title: p.title, variant: p.variant, item_type: p.item_type, net_sales: 0, shipping: 0, cogs: 0, revenue: 0, qty: 0, orders: 0 });
    }
    const e = productMap.get(key)!;
    e.net_sales += Number(p.net_sales ?? 0);
    e.shipping  += Number(p.shipping  ?? 0);
    e.cogs      += Number(p.cogs      ?? 0);
    e.revenue   += Number(p.revenue   ?? 0);
    e.qty       += Number(p.qty       ?? 0);
    e.orders    += Number(p.orders    ?? 0);
  }
  const products = Array.from(productMap.values()).sort((a, b) => b.revenue - a.revenue);

  const physProducts = products.filter((p) => p.item_type === 'Physical' && p.revenue > 0);
  const chartData = physProducts.map((p) => ({
    name: p.variant ? `${p.title.replace('Magic Portrait', 'Portrait')} ${p.variant}` : p.title,
    revenue: p.revenue,
    netSales: p.net_sales,
  }));

  // ── preset tabs ──────────────────────────────────────────────────────────
  const activePreset = preset ?? '7d';
  const tabStyle = (id: string): React.CSSProperties => ({
    padding: '0.35rem 0.75rem',
    borderRadius: 7,
    fontSize: '0.78rem',
    fontFamily: 'var(--font-mono)',
    textDecoration: 'none',
    border: '1px solid rgba(255,255,255,0.15)',
    background: activePreset === id ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)',
    color: activePreset === id ? '#fff' : 'rgba(255,255,255,0.65)',
    fontWeight: activePreset === id ? 600 : 400,
  });

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>

      {/* ── TOP BAR ───────────────────────────────────────────────────────── */}
      <div style={{
        background: '#1a1a2e',
        color: '#fff',
        padding: '1rem 2rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem', fontWeight: 400 }}>
            Range <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Report</em>
          </h1>
          <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.2)' }} />
          {/* Preset tabs */}
          <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center' }}>
            {([
              ['today',     'Today'],
              ['yesterday', 'Yesterday'],
              ['3d',        '3 Days'],
              ['7d',        '7 Days'],
              ['30d',       '30 Days'],
            ] as [Preset, string][]).map(([id, lbl]) => (
              <Link key={id} href={`/dashboard/range?preset=${id}`} style={tabStyle(id)}>{lbl}</Link>
            ))}
            {/* Custom range form */}
            <form method="GET" action="/dashboard/range" style={{ display: 'flex', gap: '0.375rem', alignItems: 'center' }}>
              <input type="hidden" name="preset" value="custom" />
              <input
                type="date"
                name="from"
                defaultValue={preset === 'custom' ? from : ''}
                style={{
                  padding: '0.3rem 0.5rem',
                  borderRadius: 7,
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: 'rgba(255,255,255,0.08)',
                  color: '#fff',
                  fontSize: '0.75rem',
                  fontFamily: 'var(--font-mono)',
                  colorScheme: 'dark',
                }}
              />
              <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem' }}>–</span>
              <input
                type="date"
                name="to"
                defaultValue={preset === 'custom' ? to : ''}
                style={{
                  padding: '0.3rem 0.5rem',
                  borderRadius: 7,
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: 'rgba(255,255,255,0.08)',
                  color: '#fff',
                  fontSize: '0.75rem',
                  fontFamily: 'var(--font-mono)',
                  colorScheme: 'dark',
                }}
              />
              <button
                type="submit"
                style={{
                  padding: '0.3rem 0.6rem',
                  borderRadius: 7,
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: 'rgba(255,255,255,0.08)',
                  color: 'rgba(255,255,255,0.7)',
                  fontSize: '0.75rem',
                  fontFamily: 'var(--font-mono)',
                  cursor: 'pointer',
                }}
              >
                Go
              </button>
            </form>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <Link
            href="/dashboard/history"
            style={{
              background: 'rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.7)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 8,
              padding: '0.4rem 0.875rem',
              fontSize: '0.8rem',
              textDecoration: 'none',
              fontFamily: 'var(--font-mono)',
            }}
          >
            History
          </Link>
        </div>
      </div>

      {/* ── RANGE LABEL ───────────────────────────────────────────────────── */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '1.5rem 1.5rem 0' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginBottom: '0.25rem' }}>
          <span style={{ fontFamily: 'var(--font-serif)', fontSize: '1.5rem', fontWeight: 400 }}>
            {label}
          </span>
          {days > 1 && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)' }}>
              {days} days · {startDate} → {endDate}
            </span>
          )}
          {days === 1 && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)' }}>
              {startDate}
            </span>
          )}
        </div>
        {rows.length === 0 && (
          <div style={{ color: 'var(--muted)', fontSize: '0.9rem', marginBottom: '2rem' }}>
            No data found for this range.
          </div>
        )}
      </div>

      {/* ── MAIN CONTENT ──────────────────────────────────────────────────── */}
      {rows.length > 0 && (
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '1.5rem' }}>

          {/* ── TOTAL KPIs ──────────────────────────────────────────────── */}
          <SectionLabel>Total Business</SectionLabel>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '1rem',
            marginBottom: '2rem',
          }}>
            <KpiCard
              label="Total Revenue"
              value={fmt(total.revenue)}
              sub={`${total.orders} orders · ${total.qty} units`}
            />
            <KpiCard
              label="Gross Profit"
              value={fmt(total.profit)}
            />
            <KpiCard
              label="Margin"
              value={fmtPct(total.margin)}
            />
            <KpiCard
              label="AOV"
              value={fmtDec(total.aov)}
            />
          </div>

          {/* ── SALES SEGMENTS ──────────────────────────────────────────── */}
          <SectionLabel>Sales Segments</SectionLabel>
          <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
            <SegmentCard
              title="Physical Cash"
              theme="cash"
              revenue={physCash.revenue}
              orders={physCash.orders}
              qty={physCash.qty}
              netSales={physCash.netSales}
              shipping={physCash.shipping}
              cogs={physCash.cogs}
              profit={physCash.profit}
              margin={physCash.margin}
              aov={physCash.aov}
              breakdownLabel={hasSegments ? `${cashNewOrders} new · ${cashRetOrders} returning` : undefined}
            />
            <SegmentCard
              title="Physical Non-Cash"
              theme="noncash"
              revenue={physNonCash.revenue}
              orders={physNonCash.orders}
              qty={physNonCash.qty}
              netSales={physNonCash.netSales}
              shipping={physNonCash.shipping}
              cogs={physNonCash.cogs}
              profit={physNonCash.profit}
              margin={physNonCash.margin}
              aov={physNonCash.aov}
              breakdownLabel={hasSegments ? `${nonCashNewOrders} new · ${nonCashRetOrders} returning` : undefined}
            />
            <SegmentCard
              title="Membership"
              theme="membership"
              revenue={membership.revenue}
              orders={membership.orders}
              qty={membership.qty}
              netSales={membership.netSales}
              shipping={membership.shipping}
              cogs={membership.cogs}
              profit={membership.profit}
              margin={membership.margin}
              aov={membership.aov}
              breakdownLabel={(memTypeRows ?? []).length > 0 ? `New: ${memNew} · Recurring: ${memRecurring}` : undefined}
            />
          </div>

          {/* ── CUSTOMER MIX ────────────────────────────────────────────── */}
          {hasSegments && (
            <>
              <SectionLabel>Customer Mix</SectionLabel>
              <div style={{
                background: 'var(--surface)',
                borderRadius: 14,
                border: '1.5px solid var(--accent)',
                padding: '1.5rem',
                marginBottom: '2rem',
              }}>
                <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                  {[
                    { label: 'New Orders',       value: String(totalNewOrders),   accent: '#1d4ed8' },
                    { label: 'New Revenue',       value: fmt(totalNewRevenue),     accent: '#1d4ed8' },
                    { label: 'New AOV',           value: fmtDec(totalNewAov),      accent: '#1d4ed8' },
                    { label: 'New Margin',        value: fmtPct(totalNewMargin),   accent: '#1d4ed8' },
                    { label: 'Returning Orders',  value: String(totalRetOrders),   accent: '#6b7280' },
                    { label: 'Returning Revenue', value: fmt(totalRetRevenue),     accent: '#6b7280' },
                    { label: 'Returning AOV',     value: fmtDec(totalRetAov),      accent: '#6b7280' },
                    { label: 'Returning Margin',  value: fmtPct(totalRetMargin),   accent: '#6b7280' },
                  ].map(({ label: lbl, value, accent: ac }) => (
                    <div key={lbl} style={{ textAlign: 'center', minWidth: 90 }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: ac, marginBottom: '0.25rem' }}>{lbl}</div>
                      <div style={{ fontSize: '1.25rem', fontWeight: 700, color: ac }}>{value}</div>
                    </div>
                  ))}
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Segment', 'Type', 'Orders', 'Revenue', 'Net Sales', 'Margin', 'AOV'].map((h) => (
                        <th key={h} style={{
                          padding: '0.5rem 0.75rem',
                          textAlign: h === 'Segment' || h === 'Type' ? 'left' : 'right',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.65rem',
                          textTransform: 'uppercase',
                          letterSpacing: '0.07em',
                          color: 'var(--muted)',
                          fontWeight: 500,
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { segLabel: 'Cash',     ct: 'new',       s: cashNew,    payAccent: 'var(--cash-blue-dark)',  ctAccent: '#1d4ed8' },
                      { segLabel: 'Cash',     ct: 'returning', s: cashRet,    payAccent: 'var(--cash-blue-dark)',  ctAccent: '#6b7280' },
                      { segLabel: 'Non-Cash', ct: 'new',       s: nonCashNew, payAccent: 'var(--nc-green-dark)',   ctAccent: '#1d4ed8' },
                      { segLabel: 'Non-Cash', ct: 'returning', s: nonCashRet, payAccent: 'var(--nc-green-dark)',   ctAccent: '#6b7280' },
                    ].map(({ segLabel, ct, s, payAccent, ctAccent }, i) => (
                      <tr key={`${segLabel}-${ct}`} style={{ borderBottom: i < 3 ? '1px solid rgba(0,0,0,0.04)' : 'none' }}>
                        <td style={{ padding: '0.5rem 0.75rem', color: payAccent, fontWeight: 500 }}>{segLabel}</td>
                        <td style={{ padding: '0.5rem 0.75rem' }}>
                          <span style={{
                            fontSize: '0.65rem',
                            fontFamily: 'var(--font-mono)',
                            padding: '0.15rem 0.4rem',
                            borderRadius: 5,
                            background: ct === 'new' ? '#dbeafe' : 'var(--surface2)',
                            color: ctAccent,
                            fontWeight: 600,
                            textTransform: 'uppercase',
                            letterSpacing: '0.05em',
                          }}>{ct}</span>
                        </td>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{s.orders}</td>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{fmtDec(s.revenue)}</td>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtDec(s.netSales)}</td>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtPct(s.margin)}</td>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtDec(s.aov)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── PRODUCTS TABLE ──────────────────────────────────────────── */}
          <SectionLabel>Products</SectionLabel>
          <div style={{
            background: 'var(--surface)',
            borderRadius: 14,
            border: '1px solid var(--border)',
            overflow: 'hidden',
            marginBottom: '2rem',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                  {['Product', 'Variant', 'Type', 'Qty', 'Orders', 'Net Sales', 'Shipping', 'COGS', 'Revenue'].map((h) => (
                    <th key={h} style={{
                      padding: '0.75rem 1rem',
                      textAlign: h === 'Product' || h === 'Variant' || h === 'Type' ? 'left' : 'right',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.68rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.07em',
                      color: 'var(--muted)',
                      fontWeight: 500,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {products.map((p, i) => (
                  <tr
                    key={`${p.title}-${p.variant}`}
                    style={{
                      borderBottom: i < products.length - 1 ? '1px solid var(--border)' : 'none',
                      background: i % 2 === 1 ? 'rgba(0,0,0,0.015)' : 'transparent',
                    }}
                  >
                    <td style={{ padding: '0.75rem 1rem', fontWeight: 500 }}>{p.title}</td>
                    <td style={{ padding: '0.75rem 1rem', color: 'var(--muted)' }}>{p.variant || '—'}</td>
                    <td style={{ padding: '0.75rem 1rem' }}>
                      <span style={{
                        fontSize: '0.7rem',
                        fontFamily: 'var(--font-mono)',
                        padding: '0.2rem 0.5rem',
                        borderRadius: 6,
                        background: p.item_type === 'Membership' ? 'var(--nc-green-light)' : 'var(--cash-blue-light)',
                        color: p.item_type === 'Membership' ? 'var(--nc-green-dark)' : 'var(--cash-blue-dark)',
                        fontWeight: 500,
                      }}>
                        {p.item_type === 'Membership' ? 'MEM' : 'PHY'}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>{p.qty}</td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right' }}>{p.orders}</td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{fmtDec(p.net_sales)}</td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{fmtDec(p.shipping)}</td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{fmtDec(p.cogs)}</td>
                    <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 600 }}>{fmtDec(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface2)' }}>
                  <td colSpan={3} style={{ padding: '0.75rem 1rem', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)' }}>Total</td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 600 }}>{total.qty}</td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 600 }}>{total.orders}</td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 700 }}>{fmtDec(total.netSales)}</td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 700 }}>{fmtDec(total.shipping)}</td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 700 }}>{fmtDec(total.cogs)}</td>
                  <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 700 }}>{fmtDec(total.revenue)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* ── CHART ───────────────────────────────────────────────────── */}
          {chartData.length > 0 && (
            <>
              <SectionLabel>Revenue by Product</SectionLabel>
              <div style={{
                background: 'var(--surface)',
                borderRadius: 14,
                border: '1px solid var(--border)',
                padding: '1.5rem',
                marginBottom: '2rem',
              }}>
                <RevenueChart data={chartData} />
              </div>
            </>
          )}

        </div>
      )}
    </div>
  );
}
