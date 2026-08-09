import Link from 'next/link';
import { subDays, format, parseISO, isValid } from 'date-fns';
import { supabaseAdmin } from '@/lib/supabase';
import { fetchAdsRange } from '@/lib/ads';
import { computeDerivedKPIs, memberLtv, MEMBER_LTV_VALUE } from '@/lib/business-rules';
import RevenueChart from '../_components/RevenueChart';
import DiscountsSection from './DiscountsSection';
import {
  fmt, fmtDec, fmtPct,
  KpiCard, TintCard, SegmentCard, StripeSegmentCard, PayPalSegmentCard, SectionLabel,
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
  const yestStr  = format(subDays(new Date(), 1), 'yyyy-MM-dd');

  if (preset === 'today') {
    return { startDate: todayStr, endDate: todayStr, label: 'Today', days: 1 };
  }
  if (preset === 'yesterday') {
    return { startDate: yestStr, endDate: yestStr, label: 'Yesterday', days: 1 };
  }
  if (preset === '3d') {
    const s = format(subDays(new Date(), 3), 'yyyy-MM-dd');
    return { startDate: s, endDate: yestStr, label: 'Past 3 Days', days: 3 };
  }
  if (preset === '7d') {
    const s = format(subDays(new Date(), 7), 'yyyy-MM-dd');
    return { startDate: s, endDate: yestStr, label: 'Past 7 Days', days: 7 };
  }
  if (preset === '30d') {
    const s = format(subDays(new Date(), 30), 'yyyy-MM-dd');
    return { startDate: s, endDate: yestStr, label: 'Past 30 Days', days: 30 };
  }
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
  const s = format(subDays(new Date(), 7), 'yyyy-MM-dd');
  return { startDate: s, endDate: yestStr, label: 'Past 7 Days', days: 7 };
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

// ── stripe aggregation ────────────────────────────────────────────────────────

type StripeSummary = {
  direct_success_count: number;
  direct_success_total_cents: number;
  direct_success_unique_customers: number;
  refunds_count: number;
  refunds_total_cents: number;
  failed_count: number;
  failed_total_cents: number;
  shopify_filtered_count: number;
  top_failure_reasons: { reason: string; count: number }[];
};

function aggStripeSnapshots(snaps: { payload: unknown }[]): StripeSummary | null {
  if (!snaps.length) return null;
  const agg: StripeSummary = {
    direct_success_count: 0,
    direct_success_total_cents: 0,
    direct_success_unique_customers: 0,
    refunds_count: 0,
    refunds_total_cents: 0,
    failed_count: 0,
    failed_total_cents: 0,
    shopify_filtered_count: 0,
    top_failure_reasons: [],
  };
  const reasonMap = new Map<string, number>();
  for (const snap of snaps) {
    const s = (snap.payload as { summary: StripeSummary }).summary;
    if (!s) continue;
    agg.direct_success_count         += s.direct_success_count ?? 0;
    agg.direct_success_total_cents   += s.direct_success_total_cents ?? 0;
    agg.direct_success_unique_customers += s.direct_success_unique_customers ?? 0;
    agg.refunds_count                += s.refunds_count ?? 0;
    agg.refunds_total_cents          += s.refunds_total_cents ?? 0;
    agg.failed_count                 += s.failed_count ?? 0;
    agg.failed_total_cents           += s.failed_total_cents ?? 0;
    agg.shopify_filtered_count       += s.shopify_filtered_count ?? 0;
    for (const r of s.top_failure_reasons ?? []) {
      reasonMap.set(r.reason, (reasonMap.get(r.reason) ?? 0) + r.count);
    }
  }
  agg.top_failure_reasons = Array.from(reasonMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => ({ reason, count }));
  return agg;
}

// ── paypal aggregation ────────────────────────────────────────────────────────

type PayPalSummary = {
  direct_success_count: number;
  direct_success_total_cents: number;
  direct_success_unique_customers: number;
  refunds_count: number;
  refunds_total_cents: number;
  excluded_internal_transfers_count?: number;
  excluded_internal_transfers_net_cents?: number;
  denied_count: number;
  denied_total_cents: number;
  shopify_filtered_count: number;
};

function aggPaypalSnapshots(snaps: { payload: unknown }[]): PayPalSummary | null {
  if (!snaps.length) return null;
  const agg: PayPalSummary = {
    direct_success_count: 0,
    direct_success_total_cents: 0,
    direct_success_unique_customers: 0,
    refunds_count: 0,
    refunds_total_cents: 0,
    excluded_internal_transfers_count: 0,
    excluded_internal_transfers_net_cents: 0,
    denied_count: 0,
    denied_total_cents: 0,
    shopify_filtered_count: 0,
  };
  let hasData = false;
  for (const snap of snaps) {
    const s = (snap.payload as { summary: PayPalSummary }).summary;
    if (!s) continue;
    hasData = true;
    agg.direct_success_count         += s.direct_success_count ?? 0;
    agg.direct_success_total_cents   += s.direct_success_total_cents ?? 0;
    agg.direct_success_unique_customers += s.direct_success_unique_customers ?? 0;
    agg.refunds_count                += s.refunds_count ?? 0;
    agg.refunds_total_cents          += s.refunds_total_cents ?? 0;
    agg.excluded_internal_transfers_count  = (agg.excluded_internal_transfers_count ?? 0) + (s.excluded_internal_transfers_count ?? 0);
    agg.excluded_internal_transfers_net_cents = (agg.excluded_internal_transfers_net_cents ?? 0) + (s.excluded_internal_transfers_net_cents ?? 0);
    agg.denied_count                 += s.denied_count ?? 0;
    agg.denied_total_cents           += s.denied_total_cents ?? 0;
    agg.shopify_filtered_count       += s.shopify_filtered_count ?? 0;
  }
  return hasData ? agg : null;
}

// ── page ─────────────────────────────────────────────────────────────────────

export default async function RangePage({
  searchParams,
}: {
  searchParams: { preset?: string; from?: string; to?: string; d_product?: string; d_variant?: string };
}) {
  const { preset, from, to, d_product, d_variant } = searchParams;
  const { startDate, endDate, label, days } = computeRange(preset, from, to);

  const [
    { data: summaryRows },
    { data: productRows },
    { data: segmentRows },
    { data: memTypeRows },
    { data: stripeSnaps },
    { data: paypalSnaps },
    ads,
  ] = await Promise.all([
    supabaseAdmin
      .from('daily_summary')
      .select('total_revenue,total_net_sales,total_shipping,total_cogs,total_profit,total_orders,total_qty,phys_cash_revenue,phys_cash_net_sales,phys_cash_shipping,phys_cash_cogs,phys_cash_profit,phys_cash_orders,phys_cash_qty,phys_non_cash_revenue,phys_non_cash_net_sales,phys_non_cash_shipping,phys_non_cash_cogs,phys_non_cash_profit,phys_non_cash_orders,phys_non_cash_qty,mem_revenue,mem_net_sales,mem_shipping,mem_cogs,mem_profit,mem_orders,mem_qty,amazon_revenue,amazon_net_sales,amazon_shipping,amazon_cogs,amazon_profit,amazon_orders,amazon_qty')
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
    supabaseAdmin
      .from('stripe_daily_snapshot')
      .select('payload')
      .gte('date', startDate)
      .lte('date', endDate),
    supabaseAdmin
      .from('paypal_daily_snapshot')
      .select('payload')
      .gte('date', startDate)
      .lte('date', endDate),
    fetchAdsRange(startDate, endDate),
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
  const amazon = aggSummaryRows(rows as Record<string, number>[], {
    revenue: 'amazon_revenue', netSales: 'amazon_net_sales', shipping: 'amazon_shipping',
    cogs: 'amazon_cogs', profit: 'amazon_profit', orders: 'amazon_orders', qty: 'amazon_qty',
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
  const internalNew  = seg('internal', 'new');
  const internalRet  = seg('internal', 'returning');
  const amazonNew    = seg('amazon',   'new');
  const amazonRet    = seg('amazon',   'returning');

  const totalNewOrders   = cashNew.orders  + nonCashNew.orders  + amazonNew.orders;
  const totalRetOrders   = cashRet.orders  + nonCashRet.orders  + amazonRet.orders;
  const totalNewRevenue  = cashNew.revenue + nonCashNew.revenue + amazonNew.revenue;
  const totalRetRevenue  = cashRet.revenue + nonCashRet.revenue + amazonRet.revenue;
  const totalNewCogs     = cashNew.cogs + nonCashNew.cogs + amazonNew.cogs;
  const totalRetCogs     = cashRet.cogs + nonCashRet.cogs + amazonRet.cogs;
  const totalNewAov      = totalNewOrders > 0 ? totalNewRevenue / totalNewOrders : 0;
  const totalRetAov      = totalRetOrders > 0 ? totalRetRevenue / totalRetOrders : 0;
  const totalNewMargin   = totalNewRevenue > 0 ? ((totalNewRevenue - totalNewCogs) / totalNewRevenue) * 100 : 0;
  const totalRetMargin   = totalRetRevenue > 0 ? ((totalRetRevenue - totalRetCogs) / totalRetRevenue) * 100 : 0;
  const hasSegments      = (segmentRows ?? []).length > 0;

  // ── membership new/recurring ──────────────────────────────────────────────
  const memNew       = (memTypeRows ?? []).filter((m) => m.membership_type === 'new').length;
  const memRecurring = (memTypeRows ?? []).filter((m) => m.membership_type === 'recurring').length;

  // New-member LTV over the range: new members × MEMBER_LTV_VALUE. Headline
  // "GP + LTV − Ads" = gross profit + LTV − ad spend (adCost from `derived`).
  const rangeLtv = memberLtv(memNew);

  // ── stripe / paypal aggregation ───────────────────────────────────────────
  const stripeSummary  = aggStripeSnapshots((stripeSnaps  ?? []) as { payload: unknown }[]);
  const paypalSummary  = aggPaypalSnapshots((paypalSnaps  ?? []) as { payload: unknown }[]);

  // ── derived KPIs ──────────────────────────────────────────────────────────
  const productOrders = physCash.orders + physNonCash.orders + amazon.orders;

  const summaryAsProcessed = {
    total:      { revenue: total.revenue, profit: total.profit, orders: total.orders },
    physCash:   { revenue: physCash.revenue },
    membership: { revenue: membership.revenue },
  } as Parameters<typeof computeDerivedKPIs>[0];

  const derived = computeDerivedKPIs(
    summaryAsProcessed,
    ads?.spend ?? null,
    ads?.purchases ?? null,
    stripeSummary?.direct_success_total_cents ?? null,
    stripeSummary?.refunds_total_cents ?? null,
    productOrders,
  );

  // Headline: gross profit + new-member LTV − ad spend.
  const rangeGpLtvMinusAds = total.profit + rangeLtv - derived.adCost;

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
          <div style={{ width: 1, height: 20, background: 'rgba(255,255,255,0.15)' }} />
          {/* Range label in top bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.85)', fontWeight: 500 }}>{label}</span>
            {days > 1 && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'rgba(255,255,255,0.45)' }}>
                {days}d · {startDate} → {endDate}
              </span>
            )}
            {days === 1 && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'rgba(255,255,255,0.45)' }}>
                {startDate}
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <a
            href={preset === 'custom' && from && to
              ? `/api/export/range/pdf?preset=custom&from=${from}&to=${to}`
              : `/api/export/range/pdf?preset=${preset ?? '7d'}`}
            target="_blank"
            rel="noreferrer"
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
            PDF
          </a>
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

      <style>{`
        @media (max-width: 768px) {
          .desktop-only { display: none !important; }
          .segments-row { flex-direction: column !important; }
        }
      `}</style>

      {/* ── NO DATA ───────────────────────────────────────────────────────── */}
      {rows.length === 0 && (
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem 1.5rem', color: 'var(--muted)', fontSize: '0.9rem' }}>
          No data found for this range.
        </div>
      )}

      {/* ── MAIN CONTENT ──────────────────────────────────────────────────── */}
      {rows.length > 0 && (
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem 1.5rem' }}>

          {/* ── TOTAL KPIs ──────────────────────────────────────────────── */}
          <SectionLabel>Total Business</SectionLabel>

          {/* Row 1 — 5 KPI cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 10,
          }}>
            <KpiCard
              label="Total Revenue"
              info={"Net Sales + Shipping across all Shopify orders in the range, summed from the stored daily totals (Pacific-time days).\nIncludes Cash, Non-Cash, Membership and Amazon segments."}
              value={fmt(total.revenue)}
              sub={`${total.orders} orders · ${productOrders} product · ${total.qty} units`}
            />
            <KpiCard
              label="Gross Profit"
              info={"Revenue − COGS, summed over the range.\nCOGS = Shopify's 'Cost per item' × quantity; variants with no cost set (e.g. membership) count as $0. Shipping counts as revenue with no shipping cost deducted."}
              value={fmt(total.profit)}
            />
            <KpiCard
              label="GP + LTV − Ads"
              info={"Gross Profit + new-member LTV − Meta ad spend, over the range.\nLTV = new membership signups × $70 assumed lifetime value."}
              value={fmt(rangeGpLtvMinusAds)}
              sub={`+ ${fmt(rangeLtv)} LTV (${memNew}×$${MEMBER_LTV_VALUE}) − ${fmt(derived.adCost)} ads`}
            />
            <KpiCard
              label="Margin"
              info={"Gross Profit ÷ Total Revenue over the range."}
              value={fmtPct(total.margin)}
            />
            <KpiCard
              label="AOV"
              info={"Average order value: Total Revenue ÷ total orders over the range."}
              value={fmtDec(total.aov)}
            />
          </div>

          {/* Row 2 — 5 TintCards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 10,
            marginTop: 10,
            marginBottom: '2rem',
          }}>
            <TintCard
              label="Cash In"
              info={"Actual money received over the range:\nCash-segment revenue + Membership revenue + Stripe net (direct charges − refunds).\nExcludes Non-Cash (store-credit) and Amazon orders."}
              value={fmt(derived.cashIn)}
              sub="Shopify + Members + Stripe"
              bg="#E1F5EE" border="#5DCAA5" textColor="#04342C" subColor="#0F6E56"
            />
            <TintCard
              label="Ad Cost"
              info={"Meta (Facebook/Instagram) ad spend over the range, from the Meta Ads API, with Meta-attributed purchase count."}
              value={derived.adCost > 0 ? fmt(derived.adCost) : '—'}
              sub={ads ? `Meta · ${ads.purchases} purch.` : 'No data'}
              bg="#FAEEDA" border="#EF9F27" textColor="#412402" subColor="#854F0B"
            />
            <TintCard
              label="CPA — Ad"
              info={"Cost per acquisition, attributed:\nAd Cost ÷ Meta-attributed purchases."}
              value={derived.cpaAd !== null ? fmtDec(derived.cpaAd) : '—'}
              sub="attributed orders"
              bg="#FAEEDA" border="#EF9F27" textColor="#412402" subColor="#854F0B"
            />
            <TintCard
              label="CPA — Blended"
              info={"Cost per acquisition, blended:\nAd Cost ÷ ALL physical product orders (Cash + Non-Cash + Amazon), regardless of ad attribution."}
              value={derived.cpaBlended !== null ? fmtDec(derived.cpaBlended) : '—'}
              sub={`${productOrders} product orders`}
              bg="#FAEEDA" border="#EF9F27" textColor="#412402" subColor="#854F0B"
            />
            <TintCard
              label="GP − Ads"
              info={"Gross Profit − Ad Cost over the range, before the LTV credit."}
              value={derived.dailyProfit < 0
                ? `−${fmt(Math.abs(derived.dailyProfit))}`
                : fmt(derived.dailyProfit)}
              sub="GP − ad spend"
              bg="#EEEDFE" border="#AFA9EC"
              textColor={derived.dailyProfit < 0 ? '#A32D2D' : '#26215C'}
              subColor="#3C3489"
            />
          </div>

          {/* ── SALES SEGMENTS ──────────────────────────────────────────── */}
          <SectionLabel>Sales Segments</SectionLabel>
          <div className="segments-row" style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
            <SegmentCard
              title="Cash"
              info={"Physical product orders paid with a real payment gateway (dominant gateway is anything other than Shopify store credit).\nRevenue = net sales + shipping. $0-revenue orders (comps/redos) are shown separately as Internal, not here."}
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
              breakdownLabel={hasSegments ? `${cashNew.orders} new · ${cashRet.orders} returning` : undefined}
            />
            <SegmentCard
              title="Non-Cash"
              info={"Physical product orders paid mostly with Shopify STORE CREDIT (dominant gateway shopify_store_credit).\nNo new money changes hands, so this segment is excluded from Cash In."}
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
              breakdownLabel={hasSegments ? `${nonCashNew.orders} new · ${nonCashRet.orders} returning` : undefined}
            />
            <SegmentCard
              title="Membership"
              info={"Orders whose line-item title matches Membership/VIP.\nNew = first billing, Recurring = renewals. No 'Cost per item' is set on membership, so COGS is $0 and margin shows 100%."}
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
            {amazon.orders > 0 && (
              <SegmentCard
                title="Amazon"
              info={"Orders whose Shopify sourceName is 'amazon' (Codisto Marketplace Connect). Kept separate from Cash/Non-Cash and excluded from Cash In."}
                theme="amazon"
                revenue={amazon.revenue}
                orders={amazon.orders}
                qty={amazon.qty}
                netSales={amazon.netSales}
                shipping={amazon.shipping}
                cogs={amazon.cogs}
                profit={amazon.profit}
                margin={amazon.margin}
                aov={amazon.aov}
              />
            )}
            {stripeSummary && (
              <StripeSegmentCard
                info={"Stripe direct charges over the range, summed from daily Stripe snapshots.\nNet = gross successful charges − refunds. Payment-processor money, separate from Shopify order revenue; net feeds into Cash In."}
                grossCents={stripeSummary.direct_success_total_cents}
                refundCents={stripeSummary.refunds_total_cents}
                charges={stripeSummary.direct_success_count}
                refunds={stripeSummary.refunds_count}
                uniqueCustomers={stripeSummary.direct_success_unique_customers}
              />
            )}
            {paypalSummary && (
              <PayPalSegmentCard
                info={"PayPal transactions over the range, summed from daily PayPal snapshots.\nNet = gross successful transactions − refunds. Internal balance movements (payouts, transfers, conversions) are excluded and noted at the bottom of the card."}
                grossCents={paypalSummary.direct_success_total_cents}
                refundCents={paypalSummary.refunds_total_cents}
                transactions={paypalSummary.direct_success_count}
                refunds={paypalSummary.refunds_count}
                uniqueCustomers={paypalSummary.direct_success_unique_customers}
                excludedTransfersCount={paypalSummary.excluded_internal_transfers_count}
                excludedTransfersNetCents={paypalSummary.excluded_internal_transfers_net_cents}
              />
            )}
          </div>

          {/* ── CUSTOMER MIX ────────────────────────────────────────────── */}
          {hasSegments && (
            <div className="desktop-only">
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
                    {(() => {
                      const tableRows = [
                        { segLabel: 'Cash',     ct: 'new',       s: cashNew,     payAccent: 'var(--cash-blue-dark)', ctAccent: '#1d4ed8' },
                        { segLabel: 'Cash',     ct: 'returning', s: cashRet,     payAccent: 'var(--cash-blue-dark)', ctAccent: '#6b7280' },
                        { segLabel: 'Non-Cash', ct: 'new',       s: nonCashNew,  payAccent: 'var(--nc-green-dark)',  ctAccent: '#1d4ed8' },
                        { segLabel: 'Non-Cash', ct: 'returning', s: nonCashRet,  payAccent: 'var(--nc-green-dark)',  ctAccent: '#6b7280' },
                        { segLabel: 'Internal', ct: 'new',       s: internalNew, payAccent: '#92400e',               ctAccent: '#1d4ed8' },
                        { segLabel: 'Internal', ct: 'returning', s: internalRet, payAccent: '#92400e',               ctAccent: '#6b7280' },
                        ...(amazonNew.orders > 0 || amazonRet.orders > 0 ? [
                          { segLabel: 'Amazon', ct: 'new',       s: amazonNew,   payAccent: '#B26B00',               ctAccent: '#1d4ed8' },
                          { segLabel: 'Amazon', ct: 'returning', s: amazonRet,   payAccent: '#B26B00',               ctAccent: '#6b7280' },
                        ] : []),
                      ];
                      return tableRows.map(({ segLabel, ct, s, payAccent, ctAccent }, i) => (
                        <tr key={`${segLabel}-${ct}`} style={{ borderBottom: i < tableRows.length - 1 ? '1px solid rgba(0,0,0,0.04)' : 'none' }}>
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
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── STRIPE ──────────────────────────────────────────────────── */}
          {stripeSummary && (
            <div className="desktop-only">
              <SectionLabel>Stripe Payments</SectionLabel>
              <div style={{
                background: 'var(--surface)',
                borderRadius: 14,
                border: '1.5px solid #6366f1',
                padding: '1.5rem',
                marginBottom: '2rem',
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                  <div style={{ background: '#f0fdf4', borderRadius: 10, padding: '1rem 1.25rem', border: '1px solid #bbf7d0' }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#15803d', marginBottom: '0.5rem' }}>Successful (direct)</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#15803d', marginBottom: '0.25rem' }}>
                      {fmt(stripeSummary.direct_success_total_cents / 100)}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#166534' }}>
                      {stripeSummary.direct_success_count} charges · {stripeSummary.direct_success_unique_customers} customers
                    </div>
                  </div>
                  <div style={{ background: '#fffbeb', borderRadius: 10, padding: '1rem 1.25rem', border: '1px solid #fde68a' }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#b45309', marginBottom: '0.5rem' }}>Refunds</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#b45309', marginBottom: '0.25rem' }}>
                      {fmt(stripeSummary.refunds_total_cents / 100)}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#92400e' }}>
                      {stripeSummary.refunds_count} refunds
                    </div>
                  </div>
                  <div style={{ background: '#fef2f2', borderRadius: 10, padding: '1rem 1.25rem', border: '1px solid #fecaca' }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#dc2626', marginBottom: '0.5rem' }}>Failed charges</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#dc2626', marginBottom: '0.25rem' }}>
                      {stripeSummary.failed_count}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#991b1b' }}>
                      {fmt(stripeSummary.failed_total_cents / 100)} attempted
                    </div>
                  </div>
                </div>
                {stripeSummary.top_failure_reasons.length > 0 && (
                  <div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: '0.5rem' }}>Top Decline Reasons</div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {stripeSummary.top_failure_reasons.map(({ reason, count }) => (
                        <div key={reason} style={{
                          background: 'var(--surface2)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          padding: '0.3rem 0.65rem',
                          fontSize: '0.75rem',
                          display: 'flex',
                          gap: '0.4rem',
                          alignItems: 'center',
                        }}>
                          <span style={{ fontWeight: 700, color: '#dc2626', fontFamily: 'var(--font-mono)' }}>{count}×</span>
                          <span style={{ color: 'var(--fg)' }}>{reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div style={{ marginTop: '1rem', fontSize: '0.72rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                  {stripeSummary.shopify_filtered_count} Shopify-originated charges excluded
                </div>
              </div>
            </div>
          )}

          {/* ── PAYPAL ──────────────────────────────────────────────────── */}
          {paypalSummary && (
            <div className="desktop-only">
              <SectionLabel>PayPal Payments</SectionLabel>
              <div style={{
                background: 'var(--surface)',
                borderRadius: 14,
                border: '1.5px solid #003087',
                padding: '1.5rem',
                marginBottom: '2rem',
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
                  <div style={{ background: '#e8f0fe', borderRadius: 10, padding: '1rem 1.25rem', border: '1px solid #b3c6f7' }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#003087', marginBottom: '0.5rem' }}>Successful (direct)</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#003087', marginBottom: '0.25rem' }}>
                      {fmt(paypalSummary.direct_success_total_cents / 100)}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#001f5b' }}>
                      {paypalSummary.direct_success_count} transactions · {paypalSummary.direct_success_unique_customers} customers
                    </div>
                  </div>
                  <div style={{ background: '#fffbeb', borderRadius: 10, padding: '1rem 1.25rem', border: '1px solid #fde68a' }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#b45309', marginBottom: '0.5rem' }}>Refunds</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#b45309', marginBottom: '0.25rem' }}>
                      {fmt(paypalSummary.refunds_total_cents / 100)}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#92400e' }}>
                      {paypalSummary.refunds_count} refunds
                    </div>
                  </div>
                  <div style={{ background: '#fef2f2', borderRadius: 10, padding: '1rem 1.25rem', border: '1px solid #fecaca' }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#dc2626', marginBottom: '0.5rem' }}>Denied</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#dc2626', marginBottom: '0.25rem' }}>
                      {paypalSummary.denied_count}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: '#991b1b' }}>
                      {fmt(paypalSummary.denied_total_cents / 100)} attempted
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: '0.72rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                  {paypalSummary.shopify_filtered_count} Shopify-routed PayPal transactions excluded · PayPal totals not included in Cash In
                </div>
              </div>
            </div>
          )}

          {/* ── META ADS ────────────────────────────────────────────────── */}
          {ads && (
            <div className="desktop-only">
              <SectionLabel>Meta Advertising</SectionLabel>
              <div style={{
                background: 'var(--surface)',
                borderRadius: 14,
                border: '1.5px solid #3b82f6',
                padding: '1.5rem',
                marginBottom: '2rem',
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1.25rem' }}>
                  {[
                    { label: 'Ad Spend',    value: fmt(ads.spend),                   accent: '#1d4ed8' },
                    { label: 'Purchases',   value: String(ads.purchases),             accent: '#15803d' },
                    { label: 'CPA',         value: fmtDec(ads.cpa),                  accent: '#b45309' },
                    { label: 'Link Clicks', value: String(ads.link_clicks ?? '—'),    accent: '#6b7280' },
                  ].map(({ label, value, accent }) => (
                    <div key={label} style={{ background: 'var(--surface2)', borderRadius: 10, padding: '0.875rem 1rem', border: '1px solid var(--border)' }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: accent, marginBottom: '0.4rem' }}>{label}</div>
                      <div style={{ fontSize: '1.35rem', fontWeight: 700, color: accent }}>{value}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>Funnel</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--muted)' }}>Click → ATC</span>
                    <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#1d4ed8' }}>
                      {ads.click_to_atc != null ? `${(ads.click_to_atc * 100).toFixed(1)}%` : '—'}
                    </span>
                  </div>
                  <div style={{ color: 'var(--muted)' }}>→</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--muted)' }}>ATC → Purchase</span>
                    <span style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: '#15803d' }}>
                      {ads.atc_to_purchase != null ? `${(ads.atc_to_purchase * 100).toFixed(1)}%` : '—'}
                    </span>
                  </div>
                  {ads.atcs != null && (
                    <>
                      <div style={{ color: 'var(--muted)' }}>·</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>{ads.atcs} ATCs</div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── PRODUCTS TABLE ──────────────────────────────────────────── */}
          <div className="desktop-only">
          <DiscountsSection
            startDate={startDate}
            endDate={endDate}
            preset={preset}
            from={from}
            to={to}
            dProduct={d_product}
            dVariant={d_variant}
          />

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
                      background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)',
                    }}
                  >
                    <td style={{ padding: '0.625rem 1rem', fontWeight: 500 }}>{p.title}</td>
                    <td style={{ padding: '0.625rem 1rem', color: 'var(--muted)', fontSize: '0.82rem' }}>{p.variant || '—'}</td>
                    <td style={{ padding: '0.625rem 1rem' }}>
                      <span style={{
                        fontSize: '0.65rem',
                        fontFamily: 'var(--font-mono)',
                        padding: '0.15rem 0.4rem',
                        borderRadius: 5,
                        background: p.item_type === 'Physical' ? '#dbeafe' : p.item_type === 'Membership' ? '#ede9fe' : '#dcfce7',
                        color: p.item_type === 'Physical' ? '#1d4ed8' : p.item_type === 'Membership' ? '#5b21b6' : '#15803d',
                        fontWeight: 600,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}>{p.item_type}</span>
                    </td>
                    <td style={{ padding: '0.625rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{p.qty}</td>
                    <td style={{ padding: '0.625rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{p.orders}</td>
                    <td style={{ padding: '0.625rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{fmtDec(p.net_sales)}</td>
                    <td style={{ padding: '0.625rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--muted)' }}>{fmtDec(p.shipping)}</td>
                    <td style={{ padding: '0.625rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--muted)' }}>{fmtDec(p.cogs)}</td>
                    <td style={{ padding: '0.625rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 600 }}>{fmtDec(p.revenue)}</td>
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
          </div>

          {/* ── CHART ───────────────────────────────────────────────────── */}
          {chartData.length > 0 && (
            <div className="desktop-only">
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
            </div>
          )}

        </div>
      )}
    </div>
  );
}
