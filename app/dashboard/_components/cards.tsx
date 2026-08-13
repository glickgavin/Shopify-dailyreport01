import Sparkline from './Sparkline';
import InfoTip from './InfoTip';

// ── formatters ────────────────────────────────────────────────────────────────

export const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

export const fmtDec = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export const fmtPct = (n: number) => `${Number(n).toFixed(1)}%`;

export function calcDelta(now: number, prev: number | null | undefined): number | null {
  if (!prev) return null;
  return ((now - prev) / Math.abs(prev)) * 100;
}

// ── DeltaBadge ────────────────────────────────────────────────────────────────

export function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct === null) return null;
  const up = pct >= 0;
  return (
    <span style={{
      fontSize: '0.7rem',
      fontWeight: 600,
      background: up ? 'var(--accent2-200)' : 'var(--accent-200)',
      color: up ? 'var(--accent2-900)' : 'var(--accent-900)',
      borderRadius: 999,
      padding: '2px 8px',
      marginLeft: '0.45rem',
      verticalAlign: 'middle',
      whiteSpace: 'nowrap',
    }}>
      {up ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

// ── KpiCard ───────────────────────────────────────────────────────────────────

export function KpiCard({
  label, value, sub, delta, sparkData, info,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: number | null;
  sparkData?: number[];
  /** How this figure is calculated — shown in an ⓘ popover next to the label. */
  info?: string;
}) {
  return (
    <div style={{
      background: 'var(--surface)',
      borderRadius: 24,
      padding: '22px 24px',
      overflow: 'hidden',
    }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--neutral-600)', marginBottom: '0.5rem' }}>
        {label}
        {info && <InfoTip text={info} />}
      </div>
      <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
        {value}
        {delta !== undefined && <DeltaBadge pct={delta ?? null} />}
      </div>
      {sub && <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.25rem' }}>{sub}</div>}
      {sparkData && sparkData.length > 1 && (
        <div style={{ marginTop: '0.75rem', marginLeft: '-1.5rem', marginRight: '-1.5rem', marginBottom: '-1.375rem' }}>
          <Sparkline data={sparkData} color="#17a97b" />
        </div>
      )}
    </div>
  );
}

// ── MiniStat ──────────────────────────────────────────────────────────────────

export function MiniStat({ label, value, highlight, color }: { label: string; value: string; highlight?: boolean; color?: string }) {
  return (
    <div style={{
      background: highlight ? (color ?? 'var(--cash-blue-light)') : 'transparent',
      borderRadius: highlight ? 8 : 0,
      padding: highlight ? '0.5rem 0.75rem' : '0.25rem 0',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    }}>
      <span style={{ fontSize: '0.8rem', color: highlight ? 'inherit' : 'var(--muted)' }}>{label}</span>
      <span style={{ fontSize: '0.875rem', fontWeight: highlight ? 700 : 500 }}>{value}</span>
    </div>
  );
}

// ── SegmentCard ───────────────────────────────────────────────────────────────

export function SegmentCard({
  title, revenue, orders, qty, netSales, shipping, cogs, profit, margin, aov, theme, breakdownLabel, info,
}: {
  title: string;
  revenue: number;
  orders: number;
  qty: number;
  netSales: number;
  shipping: number;
  cogs: number;
  profit: number;
  margin: number;
  aov: number;
  theme: 'cash' | 'noncash' | 'membership' | 'amazon';
  breakdownLabel?: string;
  /** How this segment is defined/calculated — shown in an ⓘ popover next to the title. */
  info?: string;
}) {
  // Dot colors follow the redesign's chart palette: cash = emerald (primary
  // data), non-cash = blue, membership = violet, amazon = amber.
  const accent =
    theme === 'cash'       ? 'var(--chart-green)'
    : theme === 'noncash'  ? 'var(--chart-blue)'
    : theme === 'amazon'   ? 'var(--chart-amber)'
    : 'var(--chart-violet)';
  const accentLight =
    theme === 'cash'       ? 'var(--accent2-100)'
    : theme === 'noncash'  ? '#e9f2fc'
    : theme === 'amazon'   ? '#fdf2dc'
    : '#f0eafc';
  const accentDark = 'var(--text)';

  return (
    <div style={{
      background: 'var(--surface)',
      borderRadius: 24,
      padding: '20px 24px',
      flex: 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '10px' }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: accent }} />
        <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--neutral-700)', fontWeight: 600 }}>
          {title}
          {info && <InfoTip text={info} />}
        </span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '0.25rem', color: accentDark, fontVariantNumeric: 'tabular-nums' }}>
        {fmt(revenue)}
      </div>
      <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: breakdownLabel ? '0.15rem' : '1.25rem' }}>
        {orders} orders · {qty} units
      </div>
      {breakdownLabel && (
        <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '1.25rem', fontFamily: 'var(--font-mono)' }}>
          {breakdownLabel}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
        <MiniStat label="Net Sales" value={fmtDec(netSales)} />
        <MiniStat label="Shipping" value={fmtDec(shipping)} />
        <MiniStat label="COGS" value={fmtDec(cogs)} />
        <MiniStat label="Gross Profit" value={fmtDec(profit)} />
        <MiniStat label="Margin" value={fmtPct(margin)} />
        <MiniStat label="AOV" value={fmtDec(aov)} highlight color={accentLight} />
      </div>
    </div>
  );
}

// ── TintCard ──────────────────────────────────────────────────────────────────
// Themed KPI card with custom background/border/text colours.
// delta.inverted=true → green on decrease, red on increase (for cost metrics)

export function TintCard({
  label, value, sub, bg, border, textColor, subColor, delta, info,
}: {
  label: string;
  value: string;
  sub?: string;
  bg: string;
  border: string;
  textColor: string;
  subColor: string;
  delta?: { pct: number | null; inverted?: boolean };
  /** How this figure is calculated — shown in an ⓘ popover next to the label. */
  info?: string;
}) {
  let badge: React.ReactNode = null;
  if (delta && delta.pct !== null) {
    const up = delta.pct >= 0;
    const good = delta.inverted ? !up : up;
    badge = (
      <span style={{
        fontSize: '0.7rem',
        fontFamily: 'var(--font-mono)',
        fontWeight: 600,
        color: good ? 'var(--accent2-700)' : 'var(--accent-700)',
        marginLeft: '0.35rem',
        verticalAlign: 'middle',
      }}>
        {up ? '▲' : '▼'}{Math.abs(delta.pct).toFixed(1)}%
      </span>
    );
  }

  return (
    <div style={{
      background: bg,
      borderRadius: 24,
      padding: '18px 20px',
      overflow: 'hidden',
    }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: subColor, marginBottom: '0.4rem' }}>
        {label}
        {info && <InfoTip text={info} />}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: textColor, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums' }}>
        {value}{badge}
      </div>
      {sub && <div style={{ fontSize: '0.72rem', color: subColor, marginTop: '0.3rem' }}>{sub}</div>}
    </div>
  );
}

// ── StripeSegmentCard ─────────────────────────────────────────────────────────

export function StripeSegmentCard({
  grossCents, refundCents, charges, refunds, uniqueCustomers, info,
}: {
  grossCents: number;
  refundCents: number;
  charges: number;
  refunds: number;
  uniqueCustomers: number;
  /** How this figure is calculated — shown in an ⓘ popover next to the title. */
  info?: string;
}) {
  const gross  = grossCents  / 100;
  const refund = refundCents / 100;
  const net    = gross - refund;

  return (
    <div style={{
      background: 'var(--surface)',
      borderRadius: 24,
      padding: '20px 24px',
      flex: 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '10px' }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--neutral-700)' }} />
        <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--neutral-700)', fontWeight: 600 }}>
          Stripe
          {info && <InfoTip text={info} />}
        </span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '0.25rem', fontVariantNumeric: 'tabular-nums' }}>
        {fmt(net)}
      </div>
      <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1.25rem' }}>
        {charges} charges · {refunds} refund{refunds !== 1 ? 's' : ''}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
        <MiniStat label="Gross"    value={fmtDec(gross)}  />
        <MiniStat label="Refunds"  value={fmtDec(refund)} />
        <MiniStat label="Net"      value={fmtDec(net)}    />
        <MiniStat label="Customers" value={String(uniqueCustomers)} highlight color="var(--neutral-100)" />
      </div>
    </div>
  );
}

// ── PayPalSegmentCard ─────────────────────────────────────────────────────────

export function PayPalSegmentCard({
  grossCents, refundCents, transactions, refunds, uniqueCustomers,
  excludedTransfersCount, excludedTransfersNetCents, info,
}: {
  grossCents: number;
  refundCents: number;
  transactions: number;
  refunds: number;
  uniqueCustomers: number;
  /**
   * Count of internal balance movements excluded from gross/refunds
   * (payouts, transfers, currency conversions). Surfaced for transparency
   * — if you ever wonder why PayPal's API total differs from this card,
   * the difference is here.
   */
  excludedTransfersCount?: number;
  /** Signed net cents of the excluded rows (negative if outflows > inflows). */
  excludedTransfersNetCents?: number;
  /** How this figure is calculated — shown in an ⓘ popover next to the title. */
  info?: string;
}) {
  const gross  = grossCents  / 100;
  const refund = refundCents / 100;
  const net    = gross - refund;
  const hasExcluded = (excludedTransfersCount ?? 0) > 0;

  return (
    <div style={{
      background: 'var(--surface)',
      borderRadius: 24,
      padding: '20px 24px',
      flex: 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '10px' }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--neutral-400)' }} />
        <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--neutral-700)', fontWeight: 600 }}>
          PayPal
          {info && <InfoTip text={info} />}
        </span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: '0.25rem', fontVariantNumeric: 'tabular-nums' }}>
        {fmt(net)}
      </div>
      <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1.25rem' }}>
        {transactions} transactions · {refunds} refund{refunds !== 1 ? 's' : ''}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
        <MiniStat label="Gross"     value={fmtDec(gross)}  />
        <MiniStat label="Refunds"   value={fmtDec(refund)} />
        <MiniStat label="Net"       value={fmtDec(net)}    />
        <MiniStat label="Customers" value={String(uniqueCustomers)} highlight color="var(--neutral-100)" />
      </div>
      {hasExcluded && (
        <div
          title="Internal PayPal balance movements (payouts to bank, transfers, currency conversions). Not real customer transactions — excluded from gross and refunds."
          style={{
            marginTop: '0.75rem',
            paddingTop: '0.75rem',
            borderTop: '1px dashed var(--border)',
            fontSize: '0.7rem',
            color: 'var(--muted)',
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.02em',
          }}
        >
          excluded {excludedTransfersCount} internal transfer{(excludedTransfersCount ?? 0) === 1 ? '' : 's'}
          {excludedTransfersNetCents !== undefined && (
            <> · net {fmtDec(excludedTransfersNetCents / 100)}</>
          )}
        </div>
      )}
    </div>
  );
}

// ── SectionLabel ──────────────────────────────────────────────────────────────

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 12,
      textTransform: 'uppercase',
      letterSpacing: '0.1em',
      fontWeight: 600,
      color: 'var(--neutral-600)',
      marginBottom: '0.85rem',
    }}>
      {children}
    </div>
  );
}
