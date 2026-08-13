'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

interface ChartRow { name: string; revenue: number; netSales: number; }

const COLORS = [
  '#17a97b',
  '#3b8fe4',
  '#8a63e8',
  '#f2a516',
  '#55cba0',
  '#969d96',
];

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#282c28',
      borderRadius: 10,
      padding: '0.75rem 1rem',
      fontSize: '0.8rem',
      color: '#fff',
      boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
    }}>
      <div style={{ fontWeight: 600, marginBottom: '0.4rem' }}>{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ color: 'rgba(255,255,255,0.8)' }}>
          {p.name}: <strong>{fmt(p.value)}</strong>
        </div>
      ))}
    </div>
  );
}

export default function RevenueChart({ data }: { data: ChartRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }} barSize={36}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11, fontFamily: 'var(--font-mono)', fill: '#747c74' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
          tick={{ fontSize: 11, fontFamily: 'var(--font-mono)', fill: '#747c74' }}
          axisLine={false}
          tickLine={false}
          width={48}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
        <Bar dataKey="revenue" name="Revenue" radius={[6, 6, 0, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Bar>
        <Bar dataKey="netSales" name="Net Sales" radius={[6, 6, 0, 0]} fill="rgba(0,0,0,0.08)" />
      </BarChart>
    </ResponsiveContainer>
  );
}
