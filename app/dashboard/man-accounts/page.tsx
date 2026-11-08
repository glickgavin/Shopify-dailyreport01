import Link from 'next/link';
import { subDays, format } from 'date-fns';
import { supabaseAdmin } from '@/lib/supabase';
import { fetchAdsRangeRaw } from '@/lib/ads';

export const dynamic = 'force-dynamic';

// Man Accounts — pro-forma management accounts as a columnar grid:
//   view=month (default): one column per month since Jan 2026 incl. the
//   current month, plus a Totals column.
//   view=day: one column per day for the last 7 days, plus Totals.
// Income Statement on top, Cash Flow below. Sources match the daily/range
// reports: daily_summary, stripe/paypal daily snapshots, Meta ads spend.

const HISTORY_START = '2026-01-01';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const fmt2 = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const cell = (n: number | null, neg = false, f: 'usd' | 'int' | 'usd2' | 'pct' | 'x' = 'usd') => {
  if (n === null) return '—';
  if (f === 'int') return new Intl.NumberFormat('en-US').format(Math.round(n));
  if (f === 'usd2') return fmt2(n);
  if (f === 'pct') return `${n.toFixed(1)}%`;
  if (f === 'x') return `${n.toFixed(1)}x`;
  return neg ? (n === 0 ? fmt(0) : `(${fmt(Math.abs(n))})`) : fmt(n);
};

// ── per-period metric bucket ──────────────────────────────────────────────────

interface Metrics {
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
type Derived = ReturnType<typeof addDerived>;

// ── row layout ────────────────────────────────────────────────────────────────

type RowDef =
  | { kind: 'head'; label: string }
  | { kind: 'line' | 'sub' | 'subtotal' | 'total'; label: string; get: (m: Derived) => number | null; neg?: boolean; fmt?: 'usd' | 'int' | 'usd2' | 'pct' | 'x' }
  | { kind: 'gap' };

const INCOME_ROWS: RowDef[] = [
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

const CASHFLOW_ROWS: RowDef[] = [
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

function payoutRows(hasShopify: boolean): RowDef[] {
  return [
    { kind: 'head', label: 'Actual Cash Received (bank)' },
    { kind: 'sub', label: 'Stripe payouts (net of fees)', get: m => m.stripePayout },
    { kind: 'sub', label: 'PayPal withdrawals', get: m => m.paypalPayout },
    { kind: 'sub', label: 'Shopify Payments payouts', get: m => (hasShopify ? m.shopifyPayout : null) },
    { kind: 'total', label: 'Total cash received', get: m => m.cashReceived },
  ];
}

const KPI_ROWS: RowDef[] = [
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

// ── page ──────────────────────────────────────────────────────────────────────

export default async function ManAccountsPage({
  searchParams,
}: {
  searchParams: { view?: string };
}) {
  const view = searchParams.view === 'day' ? 'day' : 'month';

  const today = new Date();
  const start = view === 'day' ? format(subDays(today, 6), 'yyyy-MM-dd') : HISTORY_START;
  const end = format(today, 'yyyy-MM-dd');

  // Period columns.
  const periods: { key: string; label: string }[] = [];
  if (view === 'day') {
    for (let i = 6; i >= 0; i--) {
      const d = subDays(today, i);
      periods.push({ key: format(d, 'yyyy-MM-dd'), label: format(d, 'EEE d MMM') });
    }
  } else {
    const nowAbs = today.getFullYear() * 12 + today.getMonth();
    for (let abs = 2026 * 12; abs <= nowAbs; abs++) {
      const key = `${Math.floor(abs / 12)}-${String((abs % 12) + 1).padStart(2, '0')}`;
      periods.push({ key, label: format(new Date(Math.floor(abs / 12), abs % 12, 1), "MMM ''yy") });
    }
  }
  const keyFor = (date: string) => (view === 'day' ? date : date.slice(0, 7));
  const buckets = new Map<string, Metrics>(periods.map(p => [p.key, emptyMetrics()]));
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

  // New-member orders, paged past the 1,000-row cap (the unpaged fetch silently
  // dropped later months once the span exceeded 1,000 rows).
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

  const renderRows = (rows: RowDef[]) => rows.map((r, i) => {
    if (r.kind === 'gap') return <tr key={`gap-${i}`}><td colSpan={cols.length + 2} style={{ height: 14 }} /></tr>;
    if (r.kind === 'head') {
      return (
        <tr key={r.label}>
          <td colSpan={cols.length + 2} style={{ padding: '1.1rem 0 0.45rem', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'var(--accent)' }}>
            {r.label}
          </td>
        </tr>
      );
    }
    const strong = r.kind === 'total' || r.kind === 'subtotal';
    const tdBase: React.CSSProperties = {
      padding: '0.32rem 0.7rem', textAlign: 'right', fontFamily: 'var(--font-mono)',
      fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontSize: '0.8rem',
      fontWeight: r.kind === 'total' ? 700 : strong ? 600 : 400,
      borderTop: r.kind === 'total' ? '2px solid var(--text)' : r.kind === 'subtotal' ? '1px solid var(--border)' : undefined,
    };
    return (
      <tr key={r.label} style={{ background: strong ? 'rgba(0,0,0,0.02)' : undefined }}>
        <td style={{
          padding: '0.32rem 0.6rem', paddingLeft: r.kind === 'sub' ? '1.4rem' : '0.6rem',
          whiteSpace: 'nowrap', fontWeight: strong ? 600 : 400, fontSize: '0.84rem',
          position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1,
          borderTop: r.kind === 'total' ? '2px solid var(--text)' : r.kind === 'subtotal' ? '1px solid var(--border)' : undefined,
        }}>
          {r.label}
        </td>
        {cols.map(c => {
          const v = r.get(c.m);
          return <td key={c.key} style={{ ...tdBase, color: v !== null && r.neg && v !== 0 ? '#b91c1c' : v !== null && r.kind === 'total' && v < 0 ? '#b91c1c' : 'var(--text)' }}>{cell(v, r.neg, r.fmt)}</td>;
        })}
        <td style={{ ...tdBase, fontWeight: 700, background: 'rgba(23,169,123,0.06)', color: r.neg && (r.get(totals) ?? 0) !== 0 ? '#b91c1c' : r.kind === 'total' && (r.get(totals) ?? 0) < 0 ? '#b91c1c' : 'var(--text)' }}>
          {cell(r.get(totals), r.neg, r.fmt)}
        </td>
      </tr>
    );
  });

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      {/* Top bar */}
      <div style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)', padding: '1rem 2rem', position: 'sticky', top: 0, zIndex: 50, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem', fontWeight: 400, margin: 0 }}>
              Man <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Accounts</em>
            </h1>
            <div style={{ fontSize: '0.72rem', color: 'var(--neutral-500)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
              Pro-forma management accounts · {view === 'day' ? 'last 7 days' : `monthly since Jan 2026 (incl. current month)`}
            </div>
          </div>
          <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            {([['month', 'By Month'], ['day', 'By Day']] as const).map(([k, l]) => (
              <Link key={k} href={`/dashboard/man-accounts${k === 'month' ? '' : `?view=${k}`}`} style={{
                padding: '0.3rem 0.8rem', borderRadius: 7, fontSize: '0.78rem', fontFamily: 'var(--font-mono)',
                textDecoration: 'none', border: '1px solid var(--border)',
                background: view === k ? 'var(--accent-100)' : 'var(--neutral-100)',
                color: view === k ? '#fff' : 'var(--neutral-600)',
                fontWeight: view === k ? 600 : 400,
              }}>{l}</Link>
            ))}
          </div>
        </div>
        <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--neutral-500)' }}>
          Net cash (total): <strong style={{ color: totals.netCash >= 0 ? 'var(--accent2-900)' : '#b91c1c' }}>{totals.netCash >= 0 ? fmt(totals.netCash) : `(${fmt(Math.abs(totals.netCash))})`}</strong>
        </div>
      </div>

      <div style={{ maxWidth: 1520, margin: '0 auto', padding: '2rem 1.5rem' }}>
        <div style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '1.25rem 1rem', overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ padding: '0.4rem 0.6rem', position: 'sticky', left: 0, background: 'var(--surface)', zIndex: 1 }} />
                {cols.map(c => (
                  <th key={c.key} style={{ padding: '0.4rem 0.7rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.64rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{c.label}</th>
                ))}
                <th style={{ padding: '0.4rem 0.7rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.64rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--accent2-900)', whiteSpace: 'nowrap', background: 'rgba(23,169,123,0.06)' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {renderRows(INCOME_ROWS)}
              {renderRows([{ kind: 'gap' }, ...CASHFLOW_ROWS])}
              {renderRows([{ kind: 'gap' }, ...payoutRows(hasShopifyPayouts)])}
              {renderRows([{ kind: 'gap' }, ...KPI_ROWS])}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: '0.75rem', fontSize: '0.72rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          Accrual (Income Statement) vs cash (Cash Flow): the gap is mostly credit sales ({fmt(totals.creditSales)} total), which book revenue without new cash, and membership cash received ahead of earned revenue. COGS shown as billed; processor fees and payout lag not modelled. Current {view === 'day' ? 'day' : 'month'} is partial. Actual cash received = money that landed at the bank (Stripe payouts are net of fees; Shopify payouts need the read_shopify_payments scope on the app and show {'\u2014'} until granted).
        </div>
      </div>
    </div>
  );
}
