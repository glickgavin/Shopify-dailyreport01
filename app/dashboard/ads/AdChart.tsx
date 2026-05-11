'use client';

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

export interface ChartDay {
  date: string;
  spend: number | null;
  cpaDaily: number | null;
  cpa5d: number | null;
}

const fmtUsd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: { name: string; value: number | null; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#1a1a2e',
      borderRadius: 10,
      padding: '0.75rem 1rem',
      fontSize: '0.8rem',
      color: '#fff',
      boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
      minWidth: 160,
    }}>
      <div style={{ fontWeight: 600, marginBottom: '0.5rem', color: 'rgba(255,255,255,0.7)', fontSize: '0.72rem' }}>{label}</div>
      {payload.map((p) => p.value != null && (
        <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.2rem' }}>
          <span style={{ color: p.color }}>{p.name}</span>
          <strong>{p.name === 'Spend' ? fmtUsd(p.value) : `$${p.value.toFixed(2)}`}</strong>
        </div>
      ))}
    </div>
  );
}

export default function AdChart({ data }: { data: ChartDay[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 8, right: 60, left: 8, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fontFamily: 'var(--font-mono)', fill: '#6b6b6b' }}
          axisLine={false}
          tickLine={false}
          interval={6}
        />
        <YAxis
          yAxisId="cpa"
          orientation="left"
          tickFormatter={(v) => `$${Number(v).toFixed(0)}`}
          tick={{ fontSize: 10, fontFamily: 'var(--font-mono)', fill: '#6b6b6b' }}
          axisLine={false}
          tickLine={false}
          width={48}
          label={{ value: 'CPA ($)', angle: -90, position: 'insideLeft', offset: 10, style: { fontSize: 9, fill: '#6b6b6b', fontFamily: 'var(--font-mono)' } }}
        />
        <YAxis
          yAxisId="spend"
          orientation="right"
          tickFormatter={(v) => `$${(Number(v) / 1000).toFixed(1)}k`}
          tick={{ fontSize: 10, fontFamily: 'var(--font-mono)', fill: '#6b6b6b' }}
          axisLine={false}
          tickLine={false}
          width={52}
          label={{ value: 'Spend', angle: 90, position: 'insideRight', offset: 10, style: { fontSize: 9, fill: '#6b6b6b', fontFamily: 'var(--font-mono)' } }}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
        <Legend
          wrapperStyle={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', paddingTop: 8 }}
        />
        <Bar
          yAxisId="spend"
          dataKey="spend"
          name="Spend"
          fill="#c8d8ef"
          radius={[3, 3, 0, 0]}
          opacity={0.75}
        />
        <Line
          yAxisId="cpa"
          type="monotone"
          dataKey="cpaDaily"
          name="CPA daily"
          stroke="#1a1a2e"
          strokeWidth={1.5}
          dot={false}
          connectNulls
        />
        <Line
          yAxisId="cpa"
          type="monotone"
          dataKey="cpa5d"
          name="CPA 5d avg"
          stroke="#1D9E75"
          strokeWidth={2.5}
          strokeDasharray="5 3"
          dot={false}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
