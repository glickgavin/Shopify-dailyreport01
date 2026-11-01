import Link from 'next/link';
import { subDays, subMonths, startOfMonth, endOfMonth, format, parseISO, isValid } from 'date-fns';
import { supabaseAdmin } from '@/lib/supabase';
import { fetchAdsRangeRaw } from '@/lib/ads';

export const dynamic = 'force-dynamic';

// Man Accounts — pro-forma management accounts for a selected period:
// Income Statement (sales split cash/credit, refunds & discounts, shipping,
// COGS, GP, advertising, GP−Ads) and Cash Flow (cash in by processor, cash
// out, net cash). All figures come from the same sources the daily/range
// reports use: daily_summary, stripe/paypal daily snapshots, Meta ads spend.

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const fmtNeg = (n: number) => (n === 0 ? fmt(0) : `(${fmt(Math.abs(n))})`);
const pct = (n: number | null) => (n === null ? '—' : `${n.toFixed(1)}%`);

type Preset = 'yesterday' | '7d' | '30d' | 'mtd' | 'm1' | 'm2' | 'custom';

function resolveRange(preset: Preset, from?: string, to?: string): { start: string; end: string; label: string } {
  const today = new Date();
  const d = (x: Date) => format(x, 'yyyy-MM-dd');
  if (preset === 'yesterday') { const y = subDays(today, 1); return { start: d(y), end: d(y), label: 'Yesterday' }; }
  if (preset === '7d')  return { start: d(subDays(today, 7)),  end: d(subDays(today, 1)), label: 'Last 7 days' };
  if (preset === '30d') return { start: d(subDays(today, 30)), end: d(subDays(today, 1)), label: 'Last 30 days' };
  if (preset === 'mtd') {
    const end = today.getDate() === 1 ? today : subDays(today, 1);
    return { start: d(startOfMonth(today)), end: d(end), label: `${format(today, 'MMMM')} MTD` };
  }
  if (preset === 'm1' || preset === 'm2') {
    const ref = subMonths(today, preset === 'm1' ? 1 : 2);
    return { start: d(startOfMonth(ref)), end: d(endOfMonth(ref)), label: format(ref, 'MMMM yyyy') };
  }
  if (preset === 'custom' && from && to && isValid(parseISO(from)) && isValid(parseISO(to))) {
    return { start: from, end: to, label: `${from} → ${to}` };
  }
  return { start: d(subDays(today, 30)), end: d(subDays(today, 1)), label: 'Last 30 days' };
}

function sum(rows: Record<string, unknown>[], col: string): number {
  return rows.reduce((s, r) => s + (Number(r[col]) || 0), 0);
}

function snapTotal(snaps: { payload: unknown }[], field: string): number {
  return snaps.reduce((s, snap) => {
    const sm = (snap.payload as { summary?: Record<string, number> })?.summary;
    return s + ((sm?.[field] ?? 0) as number);
  }, 0) / 100;
}

// ── statement row helpers ─────────────────────────────────────────────────────

type RowDef = {
  label: string;
  value: string;
  kind?: 'line' | 'sub' | 'subtotal' | 'total' | 'head' | 'memo';
};

function StatementTable({ title, note, rows }: { title: string; note?: string; rows: RowDef[] }) {
  return (
    <div style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '1.5rem 1.75rem', flex: 1, minWidth: 340 }}>
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1.15rem', marginBottom: 2 }}>{title}</div>
      {note && <div style={{ fontSize: '0.72rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginBottom: '1rem' }}>{note}</div>}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
        <tbody>
          {rows.map((r, i) => {
            const k = r.kind ?? 'line';
            const style: React.CSSProperties = {
              padding: k === 'head' ? '0.9rem 0 0.35rem' : '0.3rem 0',
              fontVariantNumeric: 'tabular-nums',
            };
            const labelStyle: React.CSSProperties = {
              ...style,
              paddingLeft: k === 'sub' ? '1.5rem' : 0,
              color: k === 'memo' ? 'var(--muted)' : 'var(--text)',
              fontWeight: k === 'head' ? 700 : k === 'total' || k === 'subtotal' ? 600 : 400,
              fontSize: k === 'head' ? '0.72rem' : k === 'memo' ? '0.76rem' : undefined,
              textTransform: k === 'head' ? 'uppercase' : undefined,
              letterSpacing: k === 'head' ? '0.08em' : undefined,
              fontFamily: k === 'head' ? 'var(--font-mono)' : undefined,
            };
            const valStyle: React.CSSProperties = {
              ...style,
              textAlign: 'right',
              fontFamily: 'var(--font-mono)',
              fontWeight: k === 'total' ? 700 : k === 'subtotal' ? 600 : 400,
              fontSize: k === 'total' ? '1rem' : k === 'memo' ? '0.76rem' : undefined,
              color: k === 'memo' ? 'var(--muted)' : r.value.startsWith('(') ? '#b91c1c' : 'var(--text)',
              borderTop: k === 'total' ? '2px solid var(--text)' : k === 'subtotal' ? '1px solid var(--border)' : undefined,
            };
            return (
              <tr key={`${r.label}-${i}`}>
                <td style={labelStyle}>{r.label}</td>
                <td style={valStyle}>{r.value}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

export default async function ManAccountsPage({
  searchParams,
}: {
  searchParams: { preset?: string; from?: string; to?: string };
}) {
  const preset = (['yesterday', '7d', '30d', 'mtd', 'm1', 'm2', 'custom'].includes(searchParams.preset ?? '')
    ? searchParams.preset : '30d') as Preset;
  const { start, end, label } = resolveRange(preset, searchParams.from, searchParams.to);

  const [{ data: dsRows }, adsRaw, { data: stripeSnaps }, { data: paypalSnaps }] = await Promise.all([
    supabaseAdmin
      .from('daily_summary')
      .select('total_revenue,total_net_sales,total_shipping,total_cogs,total_profit,phys_cash_revenue,phys_cash_shipping,phys_non_cash_revenue,mem_revenue,amazon_revenue,amazon_shipping')
      .gte('date', start)
      .lte('date', end),
    fetchAdsRangeRaw(start, end),
    (supabaseAdmin as any).from('stripe_daily_snapshot').select('payload').gte('date', start).lte('date', end),
    (supabaseAdmin as any).from('paypal_daily_snapshot').select('payload').gte('date', start).lte('date', end),
  ]);

  const rows = (dsRows ?? []) as Record<string, unknown>[];

  // ── income statement inputs ──────────────────────────────────────────────────
  const grossSales      = sum(rows, 'total_revenue');
  const netSales        = sum(rows, 'total_net_sales');
  const refundsAndDisc  = grossSales - netSales;
  const shippingIncome  = sum(rows, 'total_shipping');
  const cogs            = sum(rows, 'total_cogs');
  const gp              = sum(rows, 'total_profit');

  const cashSalesShopify = sum(rows, 'phys_cash_revenue');
  const memSales         = sum(rows, 'mem_revenue');
  const amazonSales      = sum(rows, 'amazon_revenue');
  const creditSales      = sum(rows, 'phys_non_cash_revenue');
  const cashSales        = cashSalesShopify + memSales + amazonSales;

  const adSpend = adsRaw.reduce((s, r) => s + (r.spend ?? 0), 0);
  const gpMinusAds = gp - adSpend;
  const gpMargin = netSales > 0 ? (gp / netSales) * 100 : null;

  // ── cash flow inputs ─────────────────────────────────────────────────────────
  const stripeSn = (stripeSnaps ?? []) as { payload: unknown }[];
  const paypalSn = (paypalSnaps ?? []) as { payload: unknown }[];
  const stripeIn       = snapTotal(stripeSn, 'direct_success_total_cents');
  const stripeRefunds  = snapTotal(stripeSn, 'refunds_total_cents');
  const paypalIn       = snapTotal(paypalSn, 'direct_success_total_cents');
  const paypalRefunds  = snapTotal(paypalSn, 'refunds_total_cents');
  // Shopify card captures ≈ cash-paid product sales + their shipping (Amazon
  // settles separately and is listed on its own line).
  const shopifyIn = cashSalesShopify + sum(rows, 'phys_cash_shipping');
  const amazonIn  = amazonSales + sum(rows, 'amazon_shipping');

  const cashIn   = stripeIn + paypalIn + shopifyIn + amazonIn;
  const refundsOut = stripeRefunds + paypalRefunds;
  const cashOut  = refundsOut + adSpend + cogs;
  const netCash  = cashIn - cashOut;

  const incomeRows: RowDef[] = [
    { label: 'Sales', value: '', kind: 'head' },
    { label: 'Cash sales — Shopify (card)', value: fmt(cashSalesShopify), kind: 'sub' },
    { label: 'Cash sales — Membership', value: fmt(memSales), kind: 'sub' },
    { label: 'Cash sales — Amazon', value: fmt(amazonSales), kind: 'sub' },
    { label: 'Credit sales (paid with store credit)', value: fmt(creditSales), kind: 'sub' },
    { label: 'Gross sales', value: fmt(grossSales), kind: 'subtotal' },
    { label: 'Refunds & discounts', value: fmtNeg(refundsAndDisc), kind: 'line' },
    { label: 'Net sales', value: fmt(netSales), kind: 'subtotal' },
    { label: 'Shipping income', value: fmt(shippingIncome), kind: 'line' },
    { label: 'Cost of goods sold', value: fmtNeg(cogs), kind: 'line' },
    { label: 'Gross profit', value: fmt(gp), kind: 'subtotal' },
    { label: 'GP margin (of net sales)', value: pct(gpMargin), kind: 'memo' },
    { label: 'Advertising (Meta)', value: fmtNeg(adSpend), kind: 'line' },
    { label: 'GP − Ads', value: fmt(gpMinusAds), kind: 'total' },
    { label: 'Note: cash vs credit split is by payment gateway; "credit sales" consumed store credit (no new cash).', value: '', kind: 'memo' },
  ];

  const cashFlowRows: RowDef[] = [
    { label: 'Cash in', value: '', kind: 'head' },
    { label: 'Stripe (memberships, direct)', value: fmt(stripeIn), kind: 'sub' },
    { label: 'PayPal (memberships, direct)', value: fmt(paypalIn), kind: 'sub' },
    { label: 'Shopify payments (cards)', value: fmt(shopifyIn), kind: 'sub' },
    { label: 'Amazon settlements', value: fmt(amazonIn), kind: 'sub' },
    { label: 'Total cash in', value: fmt(cashIn), kind: 'subtotal' },
    { label: 'Cash out', value: '', kind: 'head' },
    { label: 'Refunds (Stripe + PayPal)', value: fmtNeg(refundsOut), kind: 'sub' },
    { label: 'Advertising (Meta)', value: fmtNeg(adSpend), kind: 'sub' },
    { label: 'Cost of goods sold', value: fmtNeg(cogs), kind: 'sub' },
    { label: 'Total cash out', value: fmtNeg(cashOut), kind: 'subtotal' },
    { label: 'Net cash', value: netCash >= 0 ? fmt(netCash) : fmtNeg(netCash), kind: 'total' },
    { label: 'Pro-forma: COGS is accrual (billed with sales, not supplier payment timing); processor fees and payout lags are not modelled.', value: '', kind: 'memo' },
  ];

  const presets: { key: Preset; label: string }[] = [
    { key: 'yesterday', label: 'Yesterday' },
    { key: '7d', label: '7D' },
    { key: '30d', label: '30D' },
    { key: 'mtd', label: `${format(new Date(), 'MMM')} MTD` },
    { key: 'm1', label: format(subMonths(new Date(), 1), 'MMM') },
    { key: 'm2', label: format(subMonths(new Date(), 2), 'MMM') },
  ];

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
              Pro-forma management accounts · {label} · {start} → {end}
            </div>
          </div>
          <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
          <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
            {presets.map(p => (
              <Link key={p.key} href={`/dashboard/man-accounts?preset=${p.key}`} style={{
                padding: '0.3rem 0.7rem', borderRadius: 7, fontSize: '0.78rem', fontFamily: 'var(--font-mono)',
                textDecoration: 'none', border: '1px solid var(--border)',
                background: preset === p.key ? 'var(--accent-100)' : 'var(--neutral-100)',
                color: preset === p.key ? '#fff' : 'var(--neutral-600)',
                fontWeight: preset === p.key ? 600 : 400,
              }}>{p.label}</Link>
            ))}
          </div>
        </div>
        <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--neutral-500)' }}>
          Net cash: <strong style={{ color: netCash >= 0 ? 'var(--accent2-900)' : '#b91c1c' }}>{netCash >= 0 ? fmt(netCash) : `(${fmt(Math.abs(netCash))})`}</strong>
        </div>
      </div>

      <div style={{ maxWidth: 1520, margin: '0 auto', padding: '2rem 1.5rem' }}>
        <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <StatementTable
            title="Income Statement"
            note={`accrual view · ${label}`}
            rows={incomeRows}
          />
          <StatementTable
            title="Cash Flow"
            note={`cash view · ${label}`}
            rows={cashFlowRows}
          />
        </div>

        {/* Reconciliation strip */}
        <div style={{ marginTop: '1.25rem', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '1rem 1.5rem', display: 'flex', gap: '2.5rem', flexWrap: 'wrap', fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--muted)' }}>
          <span>GP − Ads (accrual): <strong style={{ color: 'var(--text)' }}>{gpMinusAds >= 0 ? fmt(gpMinusAds) : `(${fmt(Math.abs(gpMinusAds))})`}</strong></span>
          <span>Net cash (cash view): <strong style={{ color: 'var(--text)' }}>{netCash >= 0 ? fmt(netCash) : `(${fmt(Math.abs(netCash))})`}</strong></span>
          <span>Difference ≈ credit sales consumed ({fmt(creditSales)}) and membership cash not yet earned</span>
        </div>
      </div>
    </div>
  );
}
