import Link from 'next/link';
import { subDays, subMonths, startOfMonth, endOfMonth, format, parseISO, isValid } from 'date-fns';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Product Sales — per-product analysis over a selectable period (same presets
// as the Range Report), from daily_products (per product/variant per day:
// qty, orders-containing, gross revenue, net sales after discounts, cogs).
// Includes a prior-period comparison per product.

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const fmt2 = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const fmtInt = (n: number) => new Intl.NumberFormat('en-US').format(Math.round(n));

// ── date range (mirrors the Range Report presets) ─────────────────────────────

function computeRange(preset: string | undefined, from: string | undefined, to: string | undefined) {
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const yestStr  = format(subDays(new Date(), 1), 'yyyy-MM-dd');
  if (preset === 'today')     return { startDate: todayStr, endDate: todayStr, label: 'Today', days: 1 };
  if (preset === 'yesterday') return { startDate: yestStr, endDate: yestStr, label: 'Yesterday', days: 1 };
  if (preset === '3d')  return { startDate: format(subDays(new Date(), 3), 'yyyy-MM-dd'), endDate: yestStr, label: 'Past 3 Days', days: 3 };
  if (preset === '30d') return { startDate: format(subDays(new Date(), 30), 'yyyy-MM-dd'), endDate: yestStr, label: 'Past 30 Days', days: 30 };
  if (preset === 'mtd') {
    const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');
    const end = yestStr >= monthStart ? yestStr : todayStr;
    const days = Math.round((parseISO(end).getTime() - parseISO(monthStart).getTime()) / 86400000) + 1;
    return { startDate: monthStart, endDate: end, label: `${format(new Date(), 'MMMM')} MTD`, days };
  }
  if (preset === 'm1' || preset === 'm2') {
    const ref = subMonths(new Date(), preset === 'm1' ? 1 : 2);
    const s = format(startOfMonth(ref), 'yyyy-MM-dd');
    const e = format(endOfMonth(ref), 'yyyy-MM-dd');
    const days = Math.round((parseISO(e).getTime() - parseISO(s).getTime()) / 86400000) + 1;
    return { startDate: s, endDate: e, label: format(ref, 'MMMM yyyy'), days };
  }
  if (preset === 'custom' && from && to) {
    const f = parseISO(from); const t = parseISO(to);
    if (isValid(f) && isValid(t) && f <= t) {
      const days = Math.round((t.getTime() - f.getTime()) / 86400000) + 1;
      const label = from === to ? format(f, 'MMM d, yyyy') : `${format(f, 'MMM d')} – ${format(t, 'MMM d, yyyy')}`;
      return { startDate: from, endDate: to, label, days };
    }
  }
  return { startDate: format(subDays(new Date(), 7), 'yyyy-MM-dd'), endDate: yestStr, label: 'Past 7 Days', days: 7 };
}

function computePriorRange(preset: string | undefined, startDate: string, days: number) {
  if (preset === 'mtd') {
    const prevMonthStart = startOfMonth(subMonths(parseISO(startDate), 1));
    const prevMonthEnd   = endOfMonth(prevMonthStart);
    const cappedEnd = new Date(Math.min(prevMonthStart.getTime() + (days - 1) * 86400000, prevMonthEnd.getTime()));
    return { prevStart: format(prevMonthStart, 'yyyy-MM-dd'), prevEnd: format(cappedEnd, 'yyyy-MM-dd'), prevLabel: `${format(prevMonthStart, 'MMM')} 1–${format(cappedEnd, 'd')}` };
  }
  if (preset === 'm1' || preset === 'm2') {
    const ref = startOfMonth(subMonths(parseISO(startDate), 1));
    return { prevStart: format(ref, 'yyyy-MM-dd'), prevEnd: format(endOfMonth(ref), 'yyyy-MM-dd'), prevLabel: format(ref, 'MMM yyyy') };
  }
  return {
    prevStart: format(subDays(parseISO(startDate), days), 'yyyy-MM-dd'),
    prevEnd: format(subDays(parseISO(startDate), 1), 'yyyy-MM-dd'),
    prevLabel: 'prior period',
  };
}

// ── aggregation ───────────────────────────────────────────────────────────────

interface DpRow { title: string; variant: string | null; item_type: string | null; net_sales: number; cogs: number; revenue: number; qty: number; orders: number }

interface ProductAgg {
  key: string; title: string; variant: string | null; itemType: string | null;
  qty: number; orders: number; net: number; revenue: number; cogs: number; variants: Set<string>;
}

async function fetchRows(start: string, end: string): Promise<DpRow[]> {
  const out: DpRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await (supabaseAdmin as any)
      .from('daily_products')
      .select('title,variant,item_type,net_sales,cogs,revenue,qty,orders')
      .gte('date', start)
      .lte('date', end)
      .range(from, from + 999);
    const batch = (data ?? []) as DpRow[];
    out.push(...batch);
    if (batch.length < 1000) break;
  }
  return out;
}

function aggregate(rows: DpRow[], byVariant: boolean, physicalOnly: boolean): Map<string, ProductAgg> {
  const map = new Map<string, ProductAgg>();
  for (const r of rows) {
    if (physicalOnly && r.item_type === 'Membership') continue;
    const key = byVariant ? `${r.title}\u0000${r.variant ?? ''}` : r.title;
    let a = map.get(key);
    if (!a) {
      a = { key, title: r.title, variant: byVariant ? r.variant : null, itemType: r.item_type, qty: 0, orders: 0, net: 0, revenue: 0, cogs: 0, variants: new Set() };
      map.set(key, a);
    }
    a.qty     += Number(r.qty) || 0;
    a.orders  += Number(r.orders) || 0;
    a.net     += Number(r.net_sales) || 0;
    a.revenue += Number(r.revenue) || 0;
    a.cogs    += Number(r.cogs) || 0;
    if (r.variant) a.variants.add(r.variant);
  }
  return map;
}

// ── page ──────────────────────────────────────────────────────────────────────

export default async function ProductSalesPage({
  searchParams,
}: {
  searchParams: { preset?: string; from?: string; to?: string; by?: string; type?: string };
}) {
  const preset = searchParams.preset ?? '7d';
  const byVariant = searchParams.by === 'variant';
  const physicalOnly = searchParams.type !== 'all';
  const { startDate, endDate, label, days } = computeRange(preset, searchParams.from, searchParams.to);
  const { prevStart, prevEnd, prevLabel } = computePriorRange(preset, startDate, days);

  const [rows, prevRows, { data: dsRows }] = await Promise.all([
    fetchRows(startDate, endDate),
    fetchRows(prevStart, prevEnd),
    supabaseAdmin.from('daily_summary').select('total_orders').gte('date', startDate).lte('date', endDate),
  ]);

  const agg = aggregate(rows, byVariant, physicalOnly);
  const prevAgg = aggregate(prevRows, byVariant, physicalOnly);
  const products = Array.from(agg.values()).sort((a, b) => b.net - a.net);

  const totQty = products.reduce((s, p) => s + p.qty, 0);
  const totNet = products.reduce((s, p) => s + p.net, 0);
  const totRevenue = products.reduce((s, p) => s + p.revenue, 0);
  const totCogs = products.reduce((s, p) => s + p.cogs, 0);
  const totGp = totNet - totCogs;
  const storeOrders = ((dsRows ?? []) as { total_orders: number | null }[]).reduce((s, r) => s + (Number(r.total_orders) || 0), 0);
  const overallAov = storeOrders > 0 ? totNet / storeOrders : 0;

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { preset, from: searchParams.from, to: searchParams.to, by: searchParams.by, type: searchParams.type, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/dashboard/products?${p.toString()}`;
  };

  const chip = (active: boolean): React.CSSProperties => ({
    padding: '0.3rem 0.8rem', borderRadius: 7, fontSize: '0.78rem', fontFamily: 'var(--font-mono)',
    textDecoration: 'none',
    border: active ? '1px solid var(--accent)' : '1px solid var(--border)',
    background: active ? 'var(--accent)' : 'var(--neutral-100)',
    color: active ? '#fff' : 'var(--neutral-600)',
    fontWeight: active ? 600 : 400,
    whiteSpace: 'nowrap',
  });

  const th: React.CSSProperties = { padding: '0.4rem 0.7rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.64rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '0.34rem 0.7rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontSize: '0.8rem', borderTop: '1px solid var(--border)' };

  const tiles: { label: string; value: string; sub?: string }[] = [
    { label: 'Units sold', value: fmtInt(totQty) },
    { label: 'Net product sales', value: fmt(totNet), sub: 'after discounts' },
    { label: 'Gross revenue', value: fmt(totRevenue) },
    { label: 'Gross profit', value: fmt(totGp), sub: totNet > 0 ? `${((totGp / totNet) * 100).toFixed(1)}% margin` : undefined },
    { label: 'Store orders', value: fmtInt(storeOrders) },
    { label: 'AOV (net / order)', value: fmt2(overallAov) },
  ];

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      {/* Top bar */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '1rem 2rem', position: 'sticky', top: 0, zIndex: 50, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem', fontWeight: 400, margin: 0 }}>
            Product <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Sales</em>
          </h1>
          <div style={{ fontSize: '0.72rem', color: 'var(--neutral-500)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
            {label} ({startDate} {'→'} {endDate}) {'·'} vs {prevLabel}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {([['today', 'Today'], ['yesterday', 'Yesterday'], ['3d', '3D'], ['7d', '7D'], ['30d', '30D'], ['mtd', 'MTD'], ['m1', 'Last Month'], ['m2', '2 Months Ago']] as const).map(([k, l]) => (
            <Link key={k} href={qs({ preset: k, from: undefined, to: undefined })} style={chip(preset === k)}>{l}</Link>
          ))}
          <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 0.35rem' }} />
          <Link href={qs({ by: byVariant ? undefined : 'variant' })} style={chip(byVariant)}>By variant</Link>
          <Link href={qs({ type: physicalOnly ? 'all' : undefined })} style={chip(!physicalOnly)}>Incl. membership</Link>
        </div>
      </div>

      <div style={{ maxWidth: 2400, margin: '0 auto', padding: '2rem 1.5rem' }}>
        {/* Summary tiles */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.75rem', marginBottom: '1.25rem' }}>
          {tiles.map(t => (
            <div key={t.label} style={{ background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)', padding: '0.9rem 1rem' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.64rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)' }}>{t.label}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '1.25rem', fontWeight: 700, marginTop: 4 }}>{t.value}</div>
              {t.sub && <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.66rem', color: 'var(--muted)', marginTop: 2 }}>{t.sub}</div>}
            </div>
          ))}
        </div>

        {/* Product table */}
        <div style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '1.25rem 1rem', overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left', position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1 }}>{byVariant ? 'Product / Variant' : 'Product'}</th>
                {!byVariant && <th style={th}>Variants</th>}
                <th style={th}>Qty</th>
                <th style={th}>Orders</th>
                <th style={th}>Net sales</th>
                <th style={th}>Gross rev.</th>
                <th style={th}>Avg unit (net)</th>
                <th style={th}>AOV (net)</th>
                <th style={th}>COGS</th>
                <th style={th}>GP</th>
                <th style={th}>Margin %</th>
                <th style={th}>Share %</th>
                <th style={th}>Prev net</th>
                <th style={th}>{'Δ'}%</th>
              </tr>
            </thead>
            <tbody>
              {products.map(p => {
                const gp = p.net - p.cogs;
                const prev = prevAgg.get(p.key);
                const prevNet = prev?.net ?? 0;
                const delta = prevNet > 0 ? ((p.net - prevNet) / prevNet) * 100 : null;
                const deltaColor = delta === null ? 'var(--muted)' : delta >= 0 ? 'var(--accent2-900)' : '#b91c1c';
                return (
                  <tr key={p.key}>
                    <td style={{ ...td, textAlign: 'left', position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1, maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {p.title}{byVariant && p.variant ? <span style={{ color: 'var(--muted)' }}> {'·'} {p.variant}</span> : null}
                      {p.itemType === 'Membership' && <span style={{ color: 'var(--accent)', fontSize: '0.66rem', marginLeft: 6 }}>membership</span>}
                    </td>
                    {!byVariant && <td style={td}>{p.variants.size || '—'}</td>}
                    <td style={td}>{fmtInt(p.qty)}</td>
                    <td style={td}>{fmtInt(p.orders)}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{fmt(p.net)}</td>
                    <td style={td}>{fmt(p.revenue)}</td>
                    <td style={td}>{p.qty > 0 ? fmt2(p.net / p.qty) : '—'}</td>
                    <td style={td}>{p.orders > 0 ? fmt2(p.net / p.orders) : '—'}</td>
                    <td style={td}>{fmt(p.cogs)}</td>
                    <td style={{ ...td, color: gp < 0 ? '#b91c1c' : 'var(--text)' }}>{fmt(gp)}</td>
                    <td style={td}>{p.net > 0 ? `${((gp / p.net) * 100).toFixed(1)}%` : '—'}</td>
                    <td style={td}>{totNet > 0 ? `${((p.net / totNet) * 100).toFixed(1)}%` : '—'}</td>
                    <td style={{ ...td, color: 'var(--muted)' }}>{prev ? fmt(prevNet) : '—'}</td>
                    <td style={{ ...td, color: deltaColor }}>{delta === null ? (p.net > 0 ? 'new' : '—') : `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)}%`}</td>
                  </tr>
                );
              })}
              {products.length === 0 && (
                <tr><td colSpan={byVariant ? 13 : 14} style={{ ...td, textAlign: 'center', color: 'var(--muted)' }}>No product sales in this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: '0.75rem', fontSize: '0.72rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          Net sales = after discounts, before refunds. Orders = orders containing the product (an order with two products counts once for each, so the column does not sum to store orders). AOV (net) = the product&apos;s net sales per order containing it; the AOV tile uses store orders from the daily summary. {'Δ'}% compares net sales with {prevLabel}; &quot;new&quot; = no sales in the prior period. Product history starts 1 Mar 2026.
        </div>
      </div>
    </div>
  );
}
