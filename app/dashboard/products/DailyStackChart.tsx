'use client';

import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

const COLORS = ['#17a97b', '#3b8fe4', '#8a63e8', '#f2a516', '#f4694a', '#55cba0', '#969d96'];

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

export default function DailyStackChart({
  data, keys,
}: {
  data: Record<string, string | number>[];
  keys: string[];
}) {
  return (
    <div style={{ width: '100%', height: 320 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.08)" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmt(v)} width={70} />
          <Tooltip
            formatter={(v, name) => [fmt(Number(v ?? 0)), String(name)]}
            contentStyle={{ borderRadius: 10, fontSize: '0.78rem' }}
          />
          <Legend wrapperStyle={{ fontSize: '0.72rem' }} />
          {keys.map((k, i) => (
            <Bar key={k} dataKey={k} stackId="net" fill={COLORS[i % COLORS.length]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
