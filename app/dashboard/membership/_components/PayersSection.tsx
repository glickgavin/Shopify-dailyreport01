'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList,
  ComposedChart, Line, Legend,
} from 'recharts';

// "Payments & Active Members" section: distinct paying members per month per
// provider (since Jan 2026), the Membership 2025 segment snapshot with
// store-credit totals, and the gap between segment size and who actually paid.

export interface PayerMonthRow {
  month: string;         // "Jan '26"
  stripe: number | null;
  paypal: number | null;
  segment?: number | null; // Membership 2025 segment size (from daily snapshots)
}

export interface ActiveSnapshot {
  date: string;
  member_count: number;
  store_credit_total_cents: number;
  accounts_with_credit: number;
}

const tooltipStyle = {
  contentStyle: { background: '#282c28', borderRadius: 10, border: 'none', color: '#fff', fontSize: '0.8rem' },
  labelStyle:   { color: 'rgba(255,255,255,0.6)', marginBottom: 4 },
};
const axisStyle = { fontSize: 10, fontFamily: 'var(--font-mono)', fill: '#888' };

const fmtUsd = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(cents / 100);

function PayerChart({ data, dataKey, color, title, note }: {
  data: PayerMonthRow[]; dataKey: 'stripe' | 'paypal'; color: string; title: string; note: string;
}) {
  const hasData = data.some(d => d[dataKey] !== null);
  return (
    <div style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '1.25rem 1.25rem 1rem' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)', marginBottom: 2 }}>{title}</div>
      <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginBottom: '0.75rem' }}>{note}</div>
      {hasData ? (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 16, right: 8, left: 0, bottom: 0 }} barSize={26}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
            <XAxis dataKey="month" tick={axisStyle} axisLine={false} tickLine={false} />
            <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={36} allowDecimals={false} />
            <Tooltip formatter={(v: unknown) => [v as number, 'Paying members']} {...tooltipStyle} />
            <Bar dataKey={dataKey} fill={color} radius={[3, 3, 0, 0]} name="Paying members">
              <LabelList dataKey={dataKey} position="top" style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fill: 'var(--muted)' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
          Collecting data — the hourly rollup backfills one month per run.
        </div>
      )}
    </div>
  );
}

export default function PayersSection({ months, active }: { months: PayerMonthRow[]; active: ActiveSnapshot | null }) {
  const avgCents = active && active.member_count > 0 ? active.store_credit_total_cents / active.member_count : 0;

  // Gap series: total payers (stripe + paypal) vs segment size. For months
  // before the nightly snapshot existed, the latest known segment count is
  // used as the reference; once snapshots accrue, each month gets its own.
  const gapData = months
    .filter(m => m.stripe !== null || m.paypal !== null)
    .map(m => {
      const payers = (m.stripe ?? 0) + (m.paypal ?? 0);
      const segment = m.segment ?? active?.member_count ?? null;
      return {
        month: m.month,
        payers,
        segment,
        gap: segment !== null ? Math.max(segment - payers, 0) : null,
      };
    });
  const latestGap = gapData.length > 0 ? gapData[gapData.length - 1] : null;

  const cards = active ? [
    { label: 'Active Members', value: active.member_count.toLocaleString('en-US'), sub: 'Membership 2025 segment' },
    { label: 'Store Credit Held', value: fmtUsd(active.store_credit_total_cents), sub: 'total across segment' },
    { label: 'Members w/ Credit', value: active.accounts_with_credit.toLocaleString('en-US'), sub: `${active.member_count ? Math.round(active.accounts_with_credit / active.member_count * 100) : 0}% of segment` },
    { label: 'Avg Credit / Member', value: fmtUsd(avgCents), sub: `as of ${active.date}` },
    ...(latestGap && latestGap.gap !== null && latestGap.segment ? [{
      label: 'Paying Gap',
      value: latestGap.gap.toLocaleString('en-US'),
      sub: `${Math.round(latestGap.gap / latestGap.segment * 100)}% of segment unpaid · ${latestGap.month}`,
    }] : []),
  ] : [];

  return (
    <div style={{ marginTop: 16 }}>
      <style>{`
        .payers-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
        .payers-kpis { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 1rem; }
        @media (max-width: 900px) { .payers-grid { grid-template-columns: 1fr; } .payers-kpis { grid-template-columns: repeat(2, 1fr); } }
      `}</style>

      <div style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 12 }}>Payments &amp; Active Members</div>

      {active ? (
        <div className="payers-kpis">
          {cards.map(({ label, value, sub }) => (
            <div key={label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 16px' }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', marginBottom: 8 }}>{label}</div>
              <div style={{ fontSize: '1.875rem', fontWeight: 600, lineHeight: 1.1, letterSpacing: '-0.02em' }}>{value}</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--muted)', marginTop: 8 }}>{sub}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '1rem 1.25rem', marginBottom: '1rem', color: 'var(--muted)', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
          Active-member snapshot pending — the nightly job (06:40 UTC) counts the Membership 2025 segment and totals its store credit.
        </div>
      )}

      <div className="payers-grid">
        <PayerChart data={months} dataKey="stripe" color="#17a97b" title="Stripe · Paying Members per Month" note="Distinct customers with a paid Stripe invoice, since Jan 2026" />
        <PayerChart data={months} dataKey="paypal" color="#3b8fe4" title="PayPal · Paying Members per Month" note="Distinct customers with a successful direct PayPal payment, since Jan 2026" />
      </div>

      {/* Gap: segment size vs who actually paid */}
      {gapData.length > 0 && (
        <div style={{ marginTop: '1rem', background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '1.25rem 1.25rem 1rem' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)', marginBottom: 2 }}>Paying Gap · Segment vs Actual Payers</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginBottom: '0.75rem' }}>
            Stacked bars: members who paid (Stripe + PayPal) and the gap up to the segment size. The segment line uses the nightly snapshot per month once available, otherwise the latest known count.
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={gapData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barSize={30}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
              <XAxis dataKey="month" tick={axisStyle} axisLine={false} tickLine={false} />
              <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={42} allowDecimals={false} />
              <Tooltip
                formatter={(v: unknown, name: unknown) => [(v as number).toLocaleString('en-US'), name as string]}
                {...tooltipStyle}
              />
              <Legend wrapperStyle={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)' }} />
              <Bar dataKey="payers" stackId="g" fill="#17a97b" name="Paid this month" />
              <Bar dataKey="gap" stackId="g" fill="#f2c2b4" name="Gap (in segment, no payment)" radius={[3, 3, 0, 0]} />
              <Line dataKey="segment" stroke="#8a63e8" strokeWidth={2} strokeDasharray="5 4" dot={false} name="Segment size" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
