'use client';

import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

// Monthly store-credit trend: total credit held (bars, $) and number of
// holders (line) per month, from credit_monthly_history aggregates.

export interface CreditMonth {
  month: string;        // "Oct '26"
  total_usd: number;
  holders: number;
}

const fmtUsd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

export default function CreditTrendChart({ months }: { months: CreditMonth[] }) {
  return (
    <div style={{ background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)', padding: '1.25rem 1.25rem 1rem', marginBottom: '1.5rem' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)', marginBottom: 2 }}>Store Credit by Month</div>
      <div style={{ fontSize: '0.72rem', color: 'var(--muted)', marginBottom: '0.75rem' }}>
        Total credit held (bars) and customers holding a balance (line) — one snapshot per month{months.length < 2 ? ' · trend builds as months accrue' : ''}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={months} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barSize={40}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 10, fontFamily: 'var(--font-mono)', fill: '#888' }} axisLine={false} tickLine={false} />
          <YAxis yAxisId="usd" tickFormatter={(v) => `$${(v / 1_000_000).toFixed(1)}M`} tick={{ fontSize: 10, fontFamily: 'var(--font-mono)', fill: '#888' }} axisLine={false} tickLine={false} width={50} />
          <YAxis yAxisId="n" orientation="right" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10, fontFamily: 'var(--font-mono)', fill: '#888' }} axisLine={false} tickLine={false} width={36} />
          <Tooltip
            contentStyle={{ background: '#282c28', borderRadius: 10, border: 'none', color: '#fff', fontSize: '0.8rem' }}
            labelStyle={{ color: 'rgba(255,255,255,0.6)', marginBottom: 4 }}
            formatter={(v: unknown, name: unknown) =>
              (name as string) === 'Total credit' ? [fmtUsd(v as number), name as string] : [(v as number).toLocaleString('en-US'), name as string]}
          />
          <Legend wrapperStyle={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)' }} />
          <Bar yAxisId="usd" dataKey="total_usd" fill="#17a97b" name="Total credit" radius={[3, 3, 0, 0]} />
          <Line yAxisId="n" dataKey="holders" stroke="#8a63e8" strokeWidth={2} dot name="Holders" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
