import { subDays, format } from 'date-fns';
import { supabaseAdmin } from '@/lib/supabase';
import { fetchAdsRangeRaw } from '@/lib/ads';

// Shared data assembly for the Man Accounts page and its CSV/PDF exports.
//   view=month: one column per month since Jan 2026 incl. the current month.
//   view=day:   one column per day for the last 7 days.
//   view=mtd:   one column per day of the current month + prev-MTD comparison.
// Day/MTD end at yesterday unless includeToday.

const HISTORY_START = '2026-01-01';

export const fmtUsd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const fmtUsd2 = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export type CellFmt = 'usd' | 'int' | 'usd2' | 'pct' | 'x';

export const cell = (n: number | null, neg = false, f: CellFmt = 'usd') => {
  if (n === null) return '—';
  if (f === 'int') return new Intl.NumberFormat('en-US').format(Math.round(n));
  if (f === 'usd2') return fmtUsd2(n);
  if (f === 'pct') return `${n.toFixed(1)}%`;
  if (f === 'x') return `${n.toFixed(1)}x`;
  return neg ? (n === 0 ? fmtUsd(0) : `(${fmtUsd(Math.abs(n))})`) : fmtUsd(n);
};

// Signed variance in the row's own unit (percentage-point / x-point deltas for
// ratio rows), and signed percent change vs the comparison value.
export const varianceCell = (v: number | null, p: number | null, f: CellFmt = 'usd') => {
  if (v === null || p === null) return '—';
  const d = v - p;
  const sign = d > 0 ? '+' : d < 0 ? '−' : '';
  const a = Math.abs(d);
  if (f === 'int') return `${sign}${new Intl.NumberFormat('en-US').format(Math.round(a))}`;
  if (f === 'usd2') return `${sign}${fmtUsd2(a)}`;
  if (f === 'pct') return `${sign}${a.toFixed(1)}pp`;
  if (f === 'x') return `${sign}${a.toFixed(1)}x`;
  return `${sign}${fmtUsd(a)}`;
};

export const pctChangeCell = (v: number | null, p: number | null) => {
  if (v === null || p === null || p === 0) return '—';
  const pct = ((v - p) / Math.abs(p)) * 100;
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  return `${sign}${Math.abs(pct).toFixed(1)}%`;
};

// ── per-period metric bucket ──────────────────────────────────────────────────

export interface Metrics {
  cashShopify: number; memSales: number; amazonSales: number; creditSales: number;
  grossSales: number; netSales: number; shippingIncome: number; cogs: number; gp: number;
  adSpend: number;
  stripeIn: number; paypalIn: number; paypalCheckoutIn: number; shopifyIn: number; amazonIn: number;
  stripeRefunds: number; paypalRefunds: number;
  orders: number; metaOrders: number; newMembers: number;
  totalMembersEnd: number | null; // point-in-time (period end), not additive
  stripePayout: number; paypalPayout: number; shopifyPayout: number;
}

function emptyMetrics(): Metrics {
  return {
    cashShopify: 0, memSales: 0, amazonSales: 0, creditSales: 0,
    grossSales: 0, netSales: 0, shippingIncome: 0, cogs: 0, gp: 0,
    adSpend: 0,
    stripeIn: 0, paypalIn: 0, paypalCheckoutIn: 0, shopifyIn: 0, amazonIn: 0,
    stripeRefunds: 0, paypalRefunds: 0,
    orders: 0, metaOrders: 0, newMembers: 0,
    totalMembersEnd: null,
    stripePayout: 0, paypalPayout: 0, shopifyPayout: 0,
  };
}

function addDerived(m: Metrics) {
  return {
    ...m,
    refundsAndDisc: m.grossSales - m.netSales,
    gpMinusAds: m.gp - m.adSpend,
    cashIn: m.stripeIn + m.paypalIn + m.paypalCheckoutIn + m.shopifyIn + m.amazonIn,
    refundsOut: m.stripeRefunds + m.paypalRefunds,
    cashOut: m.stripeRefunds + m.paypalRefunds + m.adSpend + m.cogs,
    netCash: (m.stripeIn + m.paypalIn + m.paypalCheckoutIn + m.shopifyIn + m.amazonIn)
           - (m.stripeRefunds + m.paypalRefunds + m.adSpend + m.cogs),
    aov: m.orders > 0 ? m.grossSales / m.orders : 0,
    metaCpa: m.metaOrders > 0 ? m.adSpend / m.metaOrders : 0,
    grossMarginPct: m.netSales > 0 ? (m.gp / m.netSales) * 100 : null,
    gpPerAdDollar: m.adSpend > 0 ? m.gp / m.adSpend : null,
    cashReceived: m.stripePayout + m.paypalPayout + m.shopifyPayout,
  };
}
export type Derived = ReturnType<typeof addDerived>;

// ── row layout ────────────────────────────────────────────────────────────────

export type RowDef =
  | { kind: 'head'; label: string }
  | { kind: 'line' | 'sub' | 'subtotal' | 'total'; label: string; get: (m: Derived) => number | null; neg?: boolean; fmt?: CellFmt }
  | { kind: 'gap' };

export const INCOME_ROWS: RowDef[] = [
  { kind: 'head', label: 'Income Statement' },
  { kind: 'sub', label: 'Cash sales — Shopify (card)', get: m => m.cashShopify },
  { kind: 'sub', label: 'Cash sales — Membership', get: m => m.memSales },
  { kind: 'sub', label: 'Cash sales — Amazon', get: m => m.amazonSales },
  { kind: 'sub', label: 'Credit sales (store credit)', get: m => m.creditSales },
  { kind: 'subtotal', label: 'Gross sales', get: m => m.grossSales },
  { kind: 'line', label: 'Refunds & discounts', get: m => m.refundsAndDisc, neg: true },
  { kind: 'subtotal', label: 'Net sales', get: m => m.netSales },
  { kind: 'line', label: 'Shipping income', get: m => m.shippingIncome },
  { kind: 'line', label: 'Cost of goods sold', get: m => m.cogs, neg: true },
  { kind: 'subtotal', label: 'Gross profit', get: m => m.gp },
  { kind: 'line', label: 'Advertising (Meta)', get: m => m.adSpend, neg: true },
  { kind: 'total', label: 'GP − Ads', get: m => m.gpMinusAds },
];

export const CASHFLOW_ROWS: RowDef[] = [
  { kind: 'head', label: 'Cash Flow' },
  { kind: 'sub', label: 'Stripe (memberships)', get: m => m.stripeIn },
  { kind: 'sub', label: 'PayPal (memberships)', get: m => m.paypalIn },
  { kind: 'sub', label: 'PayPal (checkout)', get: m => m.paypalCheckoutIn },
  { kind: 'sub', label: 'Shopify payments (cards)', get: m => m.shopifyIn },
  { kind: 'sub', label: 'Amazon settlements', get: m => m.amazonIn },
  { kind: 'subtotal', label: 'Total cash in', get: m => m.cashIn },
  { kind: 'sub', label: 'Refunds (Stripe + PayPal)', get: m => m.refundsOut, neg: true },
  { kind: 'sub', label: 'Advertising (Meta)', get: m => m.adSpend, neg: true },
  { kind: 'sub', label: 'Cost of goods sold', get: m => m.cogs, neg: true },
  { kind: 'subtotal', label: 'Total cash out', get: m => m.cashOut, neg: true },
  { kind: 'total', label: 'Net cash', get: m => m.netCash },
];

export function payoutRows(hasShopify: boolean): RowDef[] {
  return [
    { kind: 'head', label: 'Actual Cash Received (bank)' },
    { kind: 'sub', label: 'Stripe payouts (net of fees)', get: m => m.stripePayout },
    { kind: 'sub', label: 'PayPal withdrawals', get: m => m.paypalPayout },
    { kind: 'sub', label: 'Shopify Payments payouts', get: m => (hasShopify ? m.shopifyPayout : null) },
    { kind: 'total', label: 'Total cash received', get: m => m.cashReceived },
  ];
}

export const KPI_ROWS: RowDef[] = [
  { kind: 'head', label: 'KPIs' },
  { kind: 'line', label: 'Orders', get: m => m.orders, fmt: 'int' },
  { kind: 'line', label: 'Meta orders (attributed)', get: m => m.metaOrders, fmt: 'int' },
  { kind: 'line', label: 'New members', get: m => m.newMembers, fmt: 'int' },
  { kind: 'line', label: 'Total members (period end)', get: m => m.totalMembersEnd, fmt: 'int' },
  { kind: 'line', label: 'AOV', get: m => m.aov, fmt: 'usd2' },
  { kind: 'line', label: 'Meta CPA', get: m => m.metaCpa, fmt: 'usd2' },
  { kind: 'line', label: 'Gross margin %', get: m => m.grossMarginPct, fmt: 'pct' },
  { kind: 'line', label: 'GP per $1 ads', get: m => m.gpPerAdDollar, fmt: 'x' },
];

// ── data assembly ─────────────────────────────────────────────────────────────

export type ManAccountsView = 'month' | 'day' | 'mtd';

export interface ManAccountsData {
  view: ManAccountsView;
  includeToday: boolean;
  asOf: Date;
  cols: { key: string; label: string; m: Derived }[];
  totals: Derived;
  prevTotals: Derived | null;
  prevLabel: string;
  hasShopifyPayouts: boolean;
}

export function parseView(v: string | null | undefined): ManAccountsView {
  return v === 'day' ? 'day' : v === 'mtd' ? 'mtd' : 'month';
}

export async function buildManAccounts(view: ManAccountsView, includeToday: boolean): Promise<ManAccountsData> {
  const today = new Date();
  const asOf = includeToday ? today : subDays(today, 1);
  const monthStart = format(asOf, 'yyyy-MM-01');
  const prevCut = Math.min(asOf.getDate(), new Date(asOf.getFullYear(), asOf.getMonth(), 0).getDate());
  const prevStartD = new Date(asOf.getFullYear(), asOf.getMonth() - 1, 1);
  const prevStart = format(prevStartD, 'yyyy-MM-dd');
  const prevEnd = format(new Date(asOf.getFullYear(), asOf.getMonth() - 1, prevCut), 'yyyy-MM-dd');
  const start = view === 'day' ? format(subDays(asOf, 6), 'yyyy-MM-dd') : view === 'mtd' ? prevStart : HISTORY_START;
  const end = format(view === 'month' ? today : asOf, 'yyyy-MM-dd');

  const periods: { key: string; label: string }[] = [];
  if (view === 'day' || view === 'mtd') {
    const nDays = view === 'day' ? 7 : asOf.getDate();
    for (let i = nDays - 1; i >= 0; i--) {
      const d = subDays(asOf, i);
      periods.push({ key: format(d, 'yyyy-MM-dd'), label: format(d, 'EEE d MMM') });
    }
  } else {
    const nowAbs = today.getFullYear() * 12 + today.getMonth();
    for (let abs = 2026 * 12; abs <= nowAbs; abs++) {
      const key = `${Math.floor(abs / 12)}-${String((abs % 12) + 1).padStart(2, '0')}`;
      periods.push({ key, label: format(new Date(Math.floor(abs / 12), abs % 12, 1), "MMM ''yy") });
    }
  }
  const keyFor = (date: string) =>
    view === 'month' ? date.slice(0, 7)
    : view === 'mtd' && date < monthStart ? (date <= prevEnd ? '__prev' : '__skip')
    : date;
  const buckets = new Map<string, Metrics>(periods.map(p => [p.key, emptyMetrics()]));
  if (view === 'mtd') buckets.set('__prev', emptyMetrics());
  const bucket = (date: string): Metrics | undefined => buckets.get(keyFor(date));

  // One fetch per source over the whole span; bucket in JS.
  const [{ data: dsRows }, adsRaw, { data: stripeSnaps }, { data: paypalSnaps }, { data: metricRows }] = await Promise.all([
    supabaseAdmin
      .from('daily_summary')
      .select('date,total_revenue,total_net_sales,total_shipping,total_cogs,total_profit,total_orders,phys_cash_revenue,phys_cash_shipping,phys_non_cash_revenue,mem_revenue,amazon_revenue,amazon_shipping')
      .gte('date', start)
      .lte('date', end),
    fetchAdsRangeRaw(start, end),
    (supabaseAdmin as any).from('stripe_daily_snapshot').select('date,payload').gte('date', start).lte('date', end),
    (supabaseAdmin as any).from('paypal_daily_snapshot').select('date,payload').gte('date', start).lte('date', end),
    supabaseAdmin
      .from('membership_metrics_daily')
      .select('metric_date, active_members')
      .gte('metric_date', start)
      .lte('metric_date', end)
      .order('metric_date', { ascending: true }),
  ]);

  const { data: payoutRowsDb } = await (supabaseAdmin as any)
    .from('payouts_daily')
    .select('provider, payout_date, amount_cents, status')
    .gte('payout_date', start)
    .lte('payout_date', end)
    .limit(5000);
  let hasShopifyPayouts = false;
  for (const r of ((payoutRowsDb ?? []) as { provider: string; payout_date: string; amount_cents: number; status: string | null }[])) {
    if (r.status && !['paid', 'in_transit', 'scheduled'].includes(r.status)) continue;
    const b = bucket(r.payout_date);
    if (!b) continue;
    if (r.provider === 'stripe') b.stripePayout += r.amount_cents / 100;
    else if (r.provider === 'paypal') b.paypalPayout += r.amount_cents / 100;
    else if (r.provider === 'shopify') { b.shopifyPayout += r.amount_cents / 100; hasShopifyPayouts = true; }
  }

  // New-member orders, paged past the 1,000-row cap.
  const memRows: { date: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: pageRows } = await supabaseAdmin
      .from('daily_membership_orders')
      .select('date')
      .eq('membership_type', 'new')
      .gte('date', start)
      .lte('date', end)
      .range(from, from + 999);
    const batch = (pageRows ?? []) as { date: string }[];
    memRows.push(...batch);
    if (batch.length < 1000) break;
  }

  for (const r of (dsRows ?? []) as Record<string, unknown>[]) {
    const b = bucket(String(r.date));
    if (!b) continue;
    const n = (k: string) => Number(r[k]) || 0;
    b.cashShopify    += n('phys_cash_revenue');
    b.memSales       += n('mem_revenue');
    b.amazonSales    += n('amazon_revenue');
    b.creditSales    += n('phys_non_cash_revenue');
    b.grossSales     += n('total_revenue');
    b.netSales       += n('total_net_sales');
    b.shippingIncome += n('total_shipping');
    b.cogs           += n('total_cogs');
    b.gp             += n('total_profit');
    // Cash-view approximations: Shopify card captures ≈ cash product sales +
    // their shipping; Amazon settles separately.
    b.shopifyIn      += n('phys_cash_revenue') + n('phys_cash_shipping');
    b.amazonIn       += n('amazon_revenue') + n('amazon_shipping');
    b.orders         += n('total_orders');
  }
  for (const r of memRows) {
    const b = bucket(r.date);
    if (b) b.newMembers += 1;
  }
  // Total members: the LAST nightly reading inside each period (point-in-time).
  for (const r of ((metricRows ?? []) as { metric_date: string; active_members: number }[])) {
    const b = bucket(r.metric_date);
    if (b) b.totalMembersEnd = r.active_members; // rows are date-ascending
  }
  for (const r of adsRaw) {
    const b = bucket(String(r.report_date));
    if (!b) continue;
    b.adSpend    += r.spend ?? 0;
    b.metaOrders += (r as { purchases?: number }).purchases ?? 0;
  }
  for (const snap of ((stripeSnaps ?? []) as { date: string; payload: unknown }[])) {
    const b = bucket(snap.date);
    const s = (snap.payload as { summary?: Record<string, number> })?.summary;
    if (!b || !s) continue;
    b.stripeIn      += (s.direct_success_total_cents ?? 0) / 100;
    b.stripeRefunds += (s.refunds_total_cents ?? 0) / 100;
  }
  for (const snap of ((paypalSnaps ?? []) as { date: string; payload: unknown }[])) {
    const b = bucket(snap.date);
    const s = (snap.payload as { summary?: Record<string, number> })?.summary;
    if (!b || !s) continue;
    b.paypalIn         += (s.direct_success_total_cents ?? 0) / 100;
    b.paypalCheckoutIn += (s.shopify_success_total_cents ?? 0) / 100;
    b.paypalRefunds    += (s.refunds_total_cents ?? 0) / 100;
  }

  const cols = periods.map(p => ({ ...p, m: addDerived(buckets.get(p.key)!) }));
  const totalMetrics = emptyMetrics();
  for (const p of periods) {
    const b = buckets.get(p.key)!;
    (Object.keys(totalMetrics) as (keyof Metrics)[]).forEach(k => {
      if (k === 'totalMembersEnd') return;
      (totalMetrics[k] as number) += (b[k] as number) ?? 0;
    });
    if (b.totalMembersEnd !== null) totalMetrics.totalMembersEnd = b.totalMembersEnd; // latest wins
  }
  const totals = addDerived(totalMetrics);
  const prevTotals = view === 'mtd' ? addDerived(buckets.get('__prev')!) : null;
  const prevLabel = `${format(prevStartD, 'MMM')} 1–${prevCut}`;

  return { view, includeToday, asOf, cols, totals, prevTotals, prevLabel, hasShopifyPayouts };
}
