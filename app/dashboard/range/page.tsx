import Link from 'next/link';
import { subDays, format, parseISO, isValid } from 'date-fns';
import { supabaseAdmin } from '@/lib/supabase';
import { fetchAdsRange } from '@/lib/ads';
import { computeDerivedKPIs, memberLtv, MEMBER_LTV_VALUE } from '@/lib/business-rules';
import RevenueChart from '../_components/RevenueChart';
import DiscountsSection from './DiscountsSection';
import CountriesSection from './CountriesSection';
import RangeTabs from './Tabs';
import Highlights from './Highlights';
import {
  fmt, fmtDec, fmtPct,
  KpiCard, SegmentCard, StripeSegmentCard, PayPalSegmentCard, SectionLabel,
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

  // ── prior window (for the Highlights trend badge) ─────────────────────────
  const prevEnd   = format(subDays(parseISO(startDate), 1), 'yyyy-MM-dd');
  const prevStart = format(subDays(parseISO(startDate), days), 'yyyy-MM-dd');
  const { data: prevRows } = await supabaseAdmin
    .from('daily_summary')
    .select('total_revenue')
    .gte('date', prevStart)
    .lte('date', prevEnd);
  const prevRevenue = (prevRows ?? []).reduce((sum, r) => sum + Number(r.total_revenue ?? 0), 0);
  const revDeltaPct = prevRevenue > 0 ? ((total.revenue - prevRevenue) / prevRevenue) * 100 : null;

  const activePreset = preset ?? '7d';

  // ── shared bits ───────────────────────────────────────────────────────────
  const cardStyle: React.CSSProperties = { background: 'var(--surface)', borderRadius: 24, padding: '20px 24px' };
  const labelStyle: React.CSSProperties = { fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--neutral-600)' };

  const chip = (label: string, value: string, tone: 'green' | 'coral' | 'neutral') => {
    const bgs   = { green: 'var(--accent2-200)', coral: 'var(--accent-100)', neutral: 'var(--neutral-200)' };
    const subs  = { green: 'var(--accent2-800)', coral: 'var(--accent-800)', neutral: 'var(--neutral-700)' };
    const vals  = { green: 'var(--accent2-900)', coral: 'var(--accent-900)', neutral: 'var(--neutral-900)' };
    return (
      <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: 8, background: bgs[tone], borderRadius: 999, padding: '9px 18px', whiteSpace: 'nowrap' }}>
        <span style={{ fontSize: 12, color: subs[tone] }}>{label}</span>
        <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: vals[tone] }}>{value}</span>
      </div>
    );
  };

  const typeTag = (t: string) =>
    t === 'Physical' ? 'tag tag-accent-2' : t === 'Membership' ? 'tag tag-accent' : 'tag tag-neutral';

  // ── tab sections ──────────────────────────────────────────────────────────
  const highlightsSection = (
    <Highlights
      rangeLabel={label}
      revenue={total.revenue}
      revDeltaPct={revDeltaPct}
      orders={total.orders}
      units={total.qty}
      aov={total.aov}
      cashIn={derived.cashIn}
      marginPct={total.margin}
      grossProfit={total.profit}
      channels={[
        { name: 'Online store',  color: 'var(--chart-green)',  value: physCash.revenue },
        { name: 'Store credit',  color: 'var(--chart-blue)',   value: physNonCash.revenue },
        { name: 'Subscriptions', color: 'var(--chart-violet)', value: membership.revenue },
        { name: 'Amazon',        color: 'var(--chart-amber)',  value: amazon.revenue },
      ].filter(c => c.value > 0)}
      cogs={total.cogs}
      adSpend={derived.adCost}
      memberLtv={rangeLtv}
      contribution={rangeGpLtvMinusAds}
      funnel={ads ? { clicks: ads.link_clicks ?? null, atcs: ads.atcs ?? null, purchases: ads.purchases ?? null, cpa: ads.cpa ?? null } : null}
      mix={hasSegments ? {
        newRev: totalNewRevenue, newOrders: totalNewOrders, newAov: totalNewAov,
        retRev: totalRetRevenue, retOrders: totalRetOrders, retAov: totalRetAov,
      } : null}
      cpaAd={derived.cpaAd}
      cpaBlended={derived.cpaBlended}
      roasBlended={derived.adCost > 0 ? total.revenue / derived.adCost : null}
      gpPerOrder={total.orders > 0 ? total.profit / total.orders : null}
    />
  );

  const overviewSection = (
    <div>
      <div className="ov-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14 }}>
        <div style={{ background: 'var(--accent2-100)', borderRadius: 24, padding: '22px 24px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ ...labelStyle, color: 'var(--accent2-700)' }}>Total revenue</div>
          <div style={{ fontSize: 34, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--accent2-900)' }}>{fmt(total.revenue)}</div>
          <div style={{ fontSize: 12, color: 'var(--accent2-700)' }}>{total.orders} orders · {total.qty} units</div>
        </div>
        <KpiCard label="Gross Profit" value={fmt(total.profit)} sub="revenue − COGS"
          info={"Revenue − COGS, summed over the range.\nCOGS = Shopify's 'Cost per item' × quantity; variants with no cost set (e.g. membership) count as $0. Shipping counts as revenue with no shipping cost deducted."} />
        <KpiCard label="GP + LTV − Ads" value={fmt(rangeGpLtvMinusAds)}
          sub={`+${fmt(rangeLtv)} LTV (${memNew}×$${MEMBER_LTV_VALUE}) · −${fmt(derived.adCost)} ads`}
          info={"Gross Profit + new-member LTV − Meta ad spend, over the range.\nLTV = new membership signups × $70 assumed lifetime value."} />
        <KpiCard label="Margin" value={fmtPct(total.margin)} sub="GP ÷ revenue"
          info={"Gross Profit ÷ Total Revenue over the range."} />
        <KpiCard label="AOV" value={fmtDec(total.aov)} sub="per order"
          info={"Average order value: Total Revenue ÷ total orders over the range."} />
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14, marginBottom: 32 }}>
        {chip('Cash in', fmt(derived.cashIn), 'green')}
        {chip('Ad cost', derived.adCost > 0 ? fmt(derived.adCost) : '—', 'coral')}
        {chip('CPA — ad', derived.cpaAd !== null ? fmtDec(derived.cpaAd) : '—', 'coral')}
        {chip('CPA — blended', derived.cpaBlended !== null ? fmtDec(derived.cpaBlended) : '—', 'coral')}
        {chip('GP − ads', derived.dailyProfit < 0 ? `−${fmt(Math.abs(derived.dailyProfit))}` : fmt(derived.dailyProfit), 'neutral')}
      </div>

      <SectionLabel>Sales Segments</SectionLabel>
      <div className="segments-row" style={{ display: 'flex', gap: 14, marginBottom: 32, flexWrap: 'wrap' }}>
        <SegmentCard
          title="Cash"
          info={"Physical product orders paid with a real payment gateway (dominant gateway is anything other than Shopify store credit).\nRevenue = net sales + shipping. $0-revenue orders (comps/redos) are shown separately as Internal, not here."}
          theme="cash"
          revenue={physCash.revenue} orders={physCash.orders} qty={physCash.qty}
          netSales={physCash.netSales} shipping={physCash.shipping} cogs={physCash.cogs}
          profit={physCash.profit} margin={physCash.margin} aov={physCash.aov}
          breakdownLabel={hasSegments ? `${cashNew.orders} new · ${cashRet.orders} returning` : undefined}
        />
        <SegmentCard
          title="Non-Cash"
          info={"Physical product orders paid mostly with Shopify STORE CREDIT (dominant gateway shopify_store_credit).\nNo new money changes hands, so this segment is excluded from Cash In."}
          theme="noncash"
          revenue={physNonCash.revenue} orders={physNonCash.orders} qty={physNonCash.qty}
          netSales={physNonCash.netSales} shipping={physNonCash.shipping} cogs={physNonCash.cogs}
          profit={physNonCash.profit} margin={physNonCash.margin} aov={physNonCash.aov}
          breakdownLabel={hasSegments ? `${nonCashNew.orders} new · ${nonCashRet.orders} returning` : undefined}
        />
        <SegmentCard
          title="Membership"
          info={"Orders whose line-item title matches Membership/VIP.\nNew = first billing, Recurring = renewals. No 'Cost per item' is set on membership, so COGS is $0 and margin shows 100%."}
          theme="membership"
          revenue={membership.revenue} orders={membership.orders} qty={membership.qty}
          netSales={membership.netSales} shipping={membership.shipping} cogs={membership.cogs}
          profit={membership.profit} margin={membership.margin} aov={membership.aov}
          breakdownLabel={(memTypeRows ?? []).length > 0 ? `New: ${memNew} · Recurring: ${memRecurring}` : undefined}
        />
        {amazon.orders > 0 && (
          <SegmentCard
            title="Amazon"
            info={"Orders whose Shopify sourceName is 'amazon' (Codisto Marketplace Connect). Kept separate from Cash/Non-Cash and excluded from Cash In."}
            theme="amazon"
            revenue={amazon.revenue} orders={amazon.orders} qty={amazon.qty}
            netSales={amazon.netSales} shipping={amazon.shipping} cogs={amazon.cogs}
            profit={amazon.profit} margin={amazon.margin} aov={amazon.aov}
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

      {chartData.length > 0 && (
        <>
          <SectionLabel>Revenue by Product</SectionLabel>
          <div style={{ ...cardStyle, marginBottom: 8 }}>
            <RevenueChart data={chartData} />
          </div>
        </>
      )}
      <p style={{ margin: '18px 4px 0', fontSize: 12, color: 'var(--neutral-600)' }}>
        Cash in = cash-segment revenue + membership + Stripe net. LTV = new members × ${MEMBER_LTV_VALUE} assumed lifetime value. COGS from Shopify cost per item; shipping counts as revenue.
      </p>
    </div>
  );

  const paymentsSection = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {stripeSummary && (
        <div>
          <SectionLabel>Stripe</SectionLabel>
          <div className="pay-triplet" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            <div style={{ background: 'var(--accent2-100)', borderRadius: 24, padding: '20px 24px' }}>
              <div style={{ ...labelStyle, color: 'var(--accent2-700)', marginBottom: 6 }}>Successful (direct)</div>
              <div style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--accent2-900)' }}>{fmt(stripeSummary.direct_success_total_cents / 100)}</div>
              <div style={{ fontSize: 12, color: 'var(--accent2-700)', marginTop: 4 }}>{stripeSummary.direct_success_count} charges · {stripeSummary.direct_success_unique_customers} customers</div>
            </div>
            <div style={{ background: 'var(--accent-100)', borderRadius: 24, padding: '20px 24px' }}>
              <div style={{ ...labelStyle, color: 'var(--accent-700)', marginBottom: 6 }}>Refunds</div>
              <div style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--accent-900)' }}>{fmt(stripeSummary.refunds_total_cents / 100)}</div>
              <div style={{ fontSize: 12, color: 'var(--accent-700)', marginTop: 4 }}>{stripeSummary.refunds_count} refunds</div>
            </div>
            <div style={{ background: 'var(--neutral-200)', borderRadius: 24, padding: '20px 24px' }}>
              <div style={{ ...labelStyle, color: 'var(--neutral-700)', marginBottom: 6 }}>Failed charges</div>
              <div style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--neutral-900)' }}>{stripeSummary.failed_count}</div>
              <div style={{ fontSize: 12, color: 'var(--neutral-700)', marginTop: 4 }}>{fmt(stripeSummary.failed_total_cents / 100)} attempted</div>
            </div>
          </div>
          {stripeSummary.top_failure_reasons.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
              {stripeSummary.top_failure_reasons.map(({ reason, count }) => (
                <span key={reason} style={{ background: 'var(--neutral-100)', borderRadius: 999, padding: '6px 14px', fontSize: 12, whiteSpace: 'nowrap' }}>
                  <strong style={{ color: 'var(--accent-800)' }}>{count}×</strong> {reason}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {paypalSummary && (
        <div>
          <SectionLabel>PayPal</SectionLabel>
          <div className="pay-triplet" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
            <div style={{ background: 'var(--accent2-100)', borderRadius: 24, padding: '20px 24px' }}>
              <div style={{ ...labelStyle, color: 'var(--accent2-700)', marginBottom: 6 }}>Successful (direct)</div>
              <div style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--accent2-900)' }}>{fmt(paypalSummary.direct_success_total_cents / 100)}</div>
              <div style={{ fontSize: 12, color: 'var(--accent2-700)', marginTop: 4 }}>{paypalSummary.direct_success_count} transactions · {paypalSummary.direct_success_unique_customers} customers</div>
            </div>
            <div style={{ background: 'var(--accent-100)', borderRadius: 24, padding: '20px 24px' }}>
              <div style={{ ...labelStyle, color: 'var(--accent-700)', marginBottom: 6 }}>Refunds</div>
              <div style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--accent-900)' }}>{fmt(paypalSummary.refunds_total_cents / 100)}</div>
              <div style={{ fontSize: 12, color: 'var(--accent-700)', marginTop: 4 }}>{paypalSummary.refunds_count} refunds</div>
            </div>
            <div style={{ background: 'var(--neutral-200)', borderRadius: 24, padding: '20px 24px' }}>
              <div style={{ ...labelStyle, color: 'var(--neutral-700)', marginBottom: 6 }}>Denied</div>
              <div style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--neutral-900)' }}>{paypalSummary.denied_count}</div>
              <div style={{ fontSize: 12, color: 'var(--neutral-700)', marginTop: 4 }}>{fmt(paypalSummary.denied_total_cents / 100)} attempted</div>
            </div>
          </div>
        </div>
      )}
      {ads && (
        <div>
          <SectionLabel>Meta advertising</SectionLabel>
          <div className="meta-quad" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
            {[
              { label: 'Ad spend',    value: fmt(ads.spend) },
              { label: 'Purchases',   value: String(ads.purchases) },
              { label: 'CPA',         value: fmtDec(ads.cpa) },
              { label: 'Link clicks', value: String(ads.link_clicks ?? '—') },
            ].map(({ label: l, value }) => (
              <div key={l} style={cardStyle}>
                <div style={{ ...labelStyle, marginBottom: 6 }}>{l}</div>
                <div style={{ fontSize: 28, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 14, fontSize: 13, color: 'var(--neutral-700)', flexWrap: 'wrap' }}>
            <span style={labelStyle}>Funnel</span>
            <span>Click → ATC <strong style={{ color: 'var(--accent2-800)' }}>{ads.click_to_atc != null ? `${(ads.click_to_atc * 100).toFixed(1)}%` : '—'}</strong></span>
            <span>→</span>
            <span>ATC → Purchase <strong style={{ color: 'var(--accent2-800)' }}>{ads.atc_to_purchase != null ? `${(ads.atc_to_purchase * 100).toFixed(1)}%` : '—'}</strong></span>
            {ads.atcs != null && <span style={{ color: 'var(--neutral-600)' }}>· {ads.atcs} ATCs</span>}
          </div>
        </div>
      )}
      <p style={{ margin: '0 4px', fontSize: 12, color: 'var(--neutral-600)' }}>
        Shopify-originated charges excluded from Stripe{stripeSummary ? ` (${stripeSummary.shopify_filtered_count} filtered)` : ''} and PayPal. PayPal totals are not included in cash in.
      </p>
    </div>
  );

  const customersSection = !hasSegments ? (
    <p style={{ color: 'var(--neutral-600)', fontSize: 13 }}>No customer segment data for this range.</p>
  ) : (
    <div>
      <div className="cust-pair" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 28 }}>
        <div style={{ background: 'var(--accent2-100)', borderRadius: 28, padding: '24px 28px' }}>
          <div style={{ ...labelStyle, color: 'var(--accent2-700)', marginBottom: 12 }}>New customers</div>
          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', fontVariantNumeric: 'tabular-nums' }}>
            {[[String(totalNewOrders), 'orders'], [fmt(totalNewRevenue), 'revenue'], [fmtDec(totalNewAov), 'AOV'], [fmtPct(totalNewMargin), 'margin']].map(([v, l]) => (
              <div key={l}><div style={{ fontSize: 26, fontWeight: 700, color: 'var(--accent2-900)' }}>{v}</div><div style={{ fontSize: 12, color: 'var(--accent2-700)' }}>{l}</div></div>
            ))}
          </div>
        </div>
        <div style={{ background: 'var(--surface)', borderRadius: 28, padding: '24px 28px' }}>
          <div style={{ ...labelStyle, marginBottom: 12 }}>Returning customers</div>
          <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', fontVariantNumeric: 'tabular-nums' }}>
            {[[String(totalRetOrders), 'orders'], [fmt(totalRetRevenue), 'revenue'], [fmtDec(totalRetAov), 'AOV'], [fmtPct(totalRetMargin), 'margin']].map(([v, l]) => (
              <div key={l}><div style={{ fontSize: 26, fontWeight: 700 }}>{v}</div><div style={{ fontSize: 12, color: 'var(--neutral-600)' }}>{l}</div></div>
            ))}
          </div>
        </div>
      </div>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Segment</th><th>Type</th>
              {['Orders', 'Revenue', 'Net sales', 'Margin', 'AOV'].map(h => <th key={h} style={{ textAlign: 'right' }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {[
              { segLabel: 'Cash',     ct: 'new',       s: cashNew },
              { segLabel: 'Cash',     ct: 'returning', s: cashRet },
              { segLabel: 'Non-Cash', ct: 'new',       s: nonCashNew },
              { segLabel: 'Non-Cash', ct: 'returning', s: nonCashRet },
              { segLabel: 'Internal', ct: 'new',       s: internalNew },
              { segLabel: 'Internal', ct: 'returning', s: internalRet },
              ...(amazonNew.orders > 0 || amazonRet.orders > 0 ? [
                { segLabel: 'Amazon', ct: 'new',       s: amazonNew },
                { segLabel: 'Amazon', ct: 'returning', s: amazonRet },
              ] : []),
            ].map(({ segLabel, ct, s }) => (
              <tr key={`${segLabel}-${ct}`}>
                <td style={{ fontWeight: 500 }}>{segLabel}</td>
                <td><span className={ct === 'new' ? 'tag tag-accent-2' : 'tag tag-neutral'}>{ct}</span></td>
                <td style={{ textAlign: 'right' }}>{s.orders}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtDec(s.revenue)}</td>
                <td style={{ textAlign: 'right' }}>{fmtDec(s.netSales)}</td>
                <td style={{ textAlign: 'right' }}>{s.revenue > 0 ? fmtPct(s.margin) : '—'}</td>
                <td style={{ textAlign: 'right' }}>{s.orders > 0 ? fmtDec(s.aov) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ margin: '18px 4px 0', fontSize: 12, color: 'var(--neutral-600)' }}>
        Internal = $0-revenue comps and redos, kept out of the cash segments.
      </p>
    </div>
  );

  const productsSection = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>Product</th><th>Variant</th><th>Type</th>
              {['Qty', 'Orders', 'Net sales', 'Shipping', 'COGS', 'Revenue'].map(h => <th key={h} style={{ textAlign: 'right' }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {products.map(pr => (
              <tr key={`${pr.title}-${pr.variant}`}>
                <td style={{ fontWeight: 500 }}>{pr.title}</td>
                <td style={{ color: 'var(--neutral-600)' }}>{pr.variant || '—'}</td>
                <td><span className={typeTag(pr.item_type)}>{pr.item_type.toLowerCase()}</span></td>
                <td style={{ textAlign: 'right' }}>{pr.qty}</td>
                <td style={{ textAlign: 'right' }}>{pr.orders}</td>
                <td style={{ textAlign: 'right' }}>{fmtDec(pr.net_sales)}</td>
                <td style={{ textAlign: 'right', color: 'var(--neutral-600)' }}>{fmtDec(pr.shipping)}</td>
                <td style={{ textAlign: 'right', color: 'var(--neutral-600)' }}>{fmtDec(pr.cogs)}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtDec(pr.revenue)}</td>
              </tr>
            ))}
            <tr>
              <td style={{ fontWeight: 700 }}>Total</td><td></td><td></td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{total.qty}</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{total.orders}</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtDec(total.netSales)}</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtDec(total.shipping)}</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtDec(total.cogs)}</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmtDec(total.revenue)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <CountriesSection startDate={startDate} endDate={endDate} />
    </div>
  );

  const discountsSection = (
    <DiscountsSection
      startDate={startDate}
      endDate={endDate}
      preset={preset}
      from={from}
      to={to}
      dProduct={d_product}
      dVariant={d_variant}
    />
  );

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>

      {/* ── HEADER ────────────────────────────────────────────────────────── */}
      <header className="range-header" style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '20px 40px', flexWrap: 'wrap' }}>
        <div style={{ fontFamily: 'var(--font-heading)', fontSize: 22, lineHeight: 1 }}>
          Range <span style={{ color: 'var(--accent)' }}>Report</span>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {([
            ['today',     'Today'],
            ['yesterday', 'Yesterday'],
            ['3d',        '3 days'],
            ['7d',        '7 days'],
            ['30d',       '30 days'],
          ] as [Preset, string][]).map(([id, lbl]) => (
            <Link key={id} href={`/dashboard/range?preset=${id}`}
              className={`pill pill--sm${activePreset === id ? ' pill--active' : ''}`}>
              {lbl}
            </Link>
          ))}
          <form method="GET" action="/dashboard/range" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="hidden" name="preset" value="custom" />
            <input type="date" name="from" defaultValue={preset === 'custom' ? from : ''}
              style={{ padding: '5px 10px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-body)' }} />
            <span style={{ color: 'var(--neutral-500)', fontSize: 12 }}>–</span>
            <input type="date" name="to" defaultValue={preset === 'custom' ? to : ''}
              style={{ padding: '5px 10px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-body)' }} />
            <button type="submit" className="pill pill--sm">Go</button>
          </form>
        </div>
        <div style={{ fontSize: 13, color: 'var(--neutral-700)' }}>
          {days === 1 ? startDate : `${startDate} → ${endDate}`} · Pacific
        </div>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
          <a className="pill"
            href={preset === 'custom' && from && to
              ? `/api/export/range/pdf?preset=custom&from=${from}&to=${to}`
              : `/api/export/range/pdf?preset=${preset ?? '7d'}`}
            target="_blank" rel="noreferrer">
            PDF
          </a>
          <Link className="pill" href="/dashboard/history">History</Link>
        </div>
      </header>

      <style>{`
        @media (max-width: 900px) {
          .ov-kpis { grid-template-columns: repeat(2, 1fr) !important; }
          .pay-triplet { grid-template-columns: 1fr !important; }
          .meta-quad { grid-template-columns: 1fr 1fr !important; }
          .cust-pair { grid-template-columns: 1fr !important; }
          .segments-row { flex-direction: column !important; }
        }
        @media (max-width: 760px) {
          .range-header { padding: 12px 14px !important; gap: 10px !important; }
          .range-main { padding: 16px 12px 56px !important; }
          .range-title { font-size: 28px !important; }
          .range-main table { display: block; overflow-x: auto; white-space: nowrap; -webkit-overflow-scrolling: touch; }
        }
      `}</style>

      <main className="range-main" style={{ maxWidth: 1520, margin: '0 auto', padding: '24px 32px 72px' }}>
        {rows.length === 0 ? (
          <div style={{ color: 'var(--neutral-600)', fontSize: 14 }}>No data found for this range.</div>
        ) : (
          <RangeTabs
            title={
              <div>
                <h1 className="range-title" style={{ fontFamily: 'var(--font-heading)', fontSize: 38, fontWeight: 400, margin: '0 0 6px' }}>{label}</h1>
                <p style={{ margin: 0, fontSize: 14, color: 'var(--neutral-700)' }}>
                  {days === 1 ? `One day · ${startDate}` : `${days} days · ${startDate} → ${endDate}`} · all sales channels
                </p>
              </div>
            }
            sections={[
              { id: 'highlights', label: 'Highlights',     node: highlightsSection },
              { id: 'overview',   label: 'Overview',       node: overviewSection },
              { id: 'payments',   label: 'Payments & ads', node: paymentsSection },
              { id: 'customers',  label: 'Customers',      node: customersSection },
              { id: 'products',   label: 'Products',       node: productsSection },
              { id: 'discounts',  label: 'Discounts',      node: discountsSection },
            ]}
          />
        )}
      </main>
    </div>
  );
}
