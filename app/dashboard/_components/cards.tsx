import Sparkline from './Sparkline';

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
      fontSize: '0.72rem',
      fontFamily: 'var(--font-mono)',
      fontWeight: 600,
      color: up ? '#1D9E75' : '#e53e3e',
      marginLeft: '0.4rem',
      verticalAlign: 'middle',
    }}>
      {up ? '▲' : '▼'}{Math.abs(pct).toFixed(1)}%
    </span>
  );
}

// ── KpiCard ───────────────────────────────────────────────────────────────────

export function KpiCard({
  label, value, sub, delta, sparkData,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: number | null;
  sparkData?: number[];
}) {
  return (
    <div style={{
      background: 'var(--surface)',
      borderRadius: 14,
      border: '1px solid var(--border)',
      padding: '1.25rem 1.5rem',
      overflow: 'hidden',
    }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: '0.5rem' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.875rem', fontWeight: 600, lineHeight: 1.1, letterSpacing: '-0.02em' }}>
        {value}
        {delta !== undefined && <DeltaBadge pct={delta ?? null} />}
      </div>
      {sub && <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginTop: '0.25rem' }}>{sub}</div>}
      {sparkData && sparkData.length > 1 && (
        <div style={{ marginTop: '0.75rem', marginLeft: '-1.5rem', marginRight: '-1.5rem', marginBottom: '-1.25rem' }}>
          <Sparkline data={sparkData} color="#185FA5" />
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
  title, revenue, orders, qty, netSales, shipping, cogs, profit, margin, aov, theme, breakdownLabel,
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
  theme: 'cash' | 'noncash' | 'membership';
  breakdownLabel?: string;
}) {
  const accent = theme === 'cash' ? 'var(--cash-blue)' : theme === 'noncash' ? 'var(--nc-green)' : '#7c3aed';
  const accentLight = theme === 'cash' ? 'var(--cash-blue-light)' : theme === 'noncash' ? 'var(--nc-green-light)' : '#ede9fe';
  const accentDark = theme === 'cash' ? 'var(--cash-blue-dark)' : theme === 'noncash' ? 'var(--nc-green-dark)' : '#5b21b6';

  return (
    <div style={{
      background: 'var(--surface)',
      borderRadius: 14,
      border: `1.5px solid ${accent}`,
      padding: '1.5rem',
      flex: 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: accent }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: accentDark, fontWeight: 500 }}>
          {title}
        </span>
      </div>
      <div style={{ fontSize: '2.5rem', fontWeight: 700, letterSpacing: '-0.03em', marginBottom: '0.25rem', color: accentDark }}>
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
  label, value, sub, bg, border, textColor, subColor, delta,
}: {
  label: string;
  value: string;
  sub?: string;
  bg: string;
  border: string;
  textColor: string;
  subColor: string;
  delta?: { pct: number | null; inverted?: boolean };
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
        color: good ? '#1D9E75' : '#e53e3e',
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
      borderRadius: 12,
      border: `1.5px solid ${border}`,
      padding: '14px 16px',
      overflow: 'hidden',
    }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: subColor, marginBottom: '0.4rem' }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: textColor, lineHeight: 1.15 }}>
        {value}{badge}
      </div>
      {sub && <div style={{ fontSize: '0.72rem', color: subColor, marginTop: '0.3rem' }}>{sub}</div>}
    </div>
  );
}

// ── StripeSegmentCard ─────────────────────────────────────────────────────────

export function StripeSegmentCard({
  grossCents, refundCents, charges, refunds, uniqueCustomers,
}: {
  grossCents: number;
  refundCents: number;
  charges: number;
  refunds: number;
  uniqueCustomers: number;
}) {
  const gross  = grossCents  / 100;
  const refund = refundCents / 100;
  const net    = gross - refund;

  return (
    <div style={{
      background: 'var(--surface)',
      borderRadius: 14,
      border: '1.5px solid #6366f1',
      padding: '1.5rem',
      flex: 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#6366f1' }} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#4338ca', fontWeight: 500 }}>
          Stripe
        </span>
      </div>
      <div style={{ fontSize: '2.5rem', fontWeight: 700, letterSpacing: '-0.03em', marginBottom: '0.25rem', color: '#4338ca' }}>
        {fmt(net)}
      </div>
      <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '1.25rem' }}>
        {charges} charges · {refunds} refund{refunds !== 1 ? 's' : ''}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
        <MiniStat label="Gross"    value={fmtDec(gross)}  />
        <MiniStat label="Refunds"  value={fmtDec(refund)} />
        <MiniStat label="Net"      value={fmtDec(net)}    />
        <MiniStat label="Customers" value={String(uniqueCustomers)} highlight color="#eef2ff" />
      </div>
    </div>
  );
}

// ── SectionLabel ──────────────────────────────────────────────────────────────

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'var(--font-mono)',
      fontSize: '0.68rem',
      textTransform: 'uppercase',
      letterSpacing: '0.1em',
      color: 'var(--muted)',
      marginBottom: '0.75rem',
    }}>
      {children}
    </div>
  );
}
