'use client';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';

interface HistoryRow {
  date: string;
  phys_cash_revenue: number;
  phys_non_cash_revenue: number;
  mem_revenue: number;
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

export default function HistoryChart({ rows }: { rows: HistoryRow[] }) {
  const data = [...rows].reverse().map((r) => ({
    date: r.date.slice(5), // MM-DD
    Cash: r.phys_cash_revenue,
    'Non-Cash': r.phys_non_cash_revenue,
    Membership: r.mem_revenue,
  }));

  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }} barSize={14}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 10, fontFamily: 'var(--font-mono)', fill: '#6b6b6b' }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10, fontFamily: 'var(--font-mono)', fill: '#6b6b6b' }} axisLine={false} tickLine={false} width={44} />
        <Tooltip
          formatter={(value: unknown, name: unknown) => [fmt(value as number), name as string]}
          contentStyle={{ background: '#1a1a2e', borderRadius: 10, border: 'none', color: '#fff', fontSize: '0.8rem' }}
          labelStyle={{ color: 'rgba(255,255,255,0.7)', marginBottom: 4 }}
        />
        <Legend wrapperStyle={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)' }} />
        <Bar dataKey="Cash" stackId="a" fill="#185FA5" radius={[0, 0, 0, 0]} />
        <Bar dataKey="Non-Cash" stackId="a" fill="#1D9E75" radius={[0, 0, 0, 0]} />
        <Bar dataKey="Membership" stackId="a" fill="#c8a88a" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
