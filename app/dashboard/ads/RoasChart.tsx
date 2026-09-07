'use client';

import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceLine, ResponsiveContainer,
} from 'recharts';

// Spend vs Meta-attributed revenue (left axis, $) with ROAS and MER lines
// (right axis, ×). Fed by the meta_insights_daily snapshot.

export interface RoasDay {
  date: string;        // MM-DD
  spend: number;
  revenue: number | null;   // Meta-attributed purchase value
  roas: number | null;      // revenue / spend
  mer: number | null;       // store total revenue / spend (blended)
}

const fmtUsd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

export default function RoasChart({ data }: { data: RoasDay[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barSize={9}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#747c74' }} axisLine={false} tickLine={false} interval={4} />
        <YAxis yAxisId="usd" tickFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} tick={{ fontSize: 10, fill: '#747c74' }} axisLine={false} tickLine={false} width={46} />
        <YAxis yAxisId="x" orientation="right" tickFormatter={(v) => `${v}×`} tick={{ fontSize: 10, fill: '#747c74' }} axisLine={false} tickLine={false} width={36} domain={[0, 'auto']} />
        <Tooltip
          contentStyle={{ background: '#282c28', borderRadius: 10, border: 'none', color: '#fff', fontSize: '0.8rem' }}
          labelStyle={{ color: 'rgba(255,255,255,0.6)', marginBottom: 4 }}
          formatter={(v: unknown, name: unknown) => {
            const n = v as number;
            const label = name as string;
            return label === 'ROAS' || label === 'MER'
              ? [`${n.toFixed(2)}×`, label]
              : [fmtUsd(n), label];
          }}
        />
        <Legend wrapperStyle={{ fontSize: '0.72rem' }} />
        <ReferenceLine yAxisId="x" y={1} stroke="#d54c30" strokeDasharray="4 3" strokeWidth={1} />
        <Bar yAxisId="usd" dataKey="spend"   fill="#ffbca8" name="Spend" radius={[2, 2, 0, 0]} />
        <Bar yAxisId="usd" dataKey="revenue" fill="#55cba0" name="Attributed revenue" radius={[2, 2, 0, 0]} />
        <Line yAxisId="x" dataKey="roas" stroke="#0f8a63" strokeWidth={2.5} dot={false} name="ROAS" connectNulls />
        <Line yAxisId="x" dataKey="mer"  stroke="#969d96" strokeWidth={1.5} strokeDasharray="5 4" dot={false} name="MER" connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
