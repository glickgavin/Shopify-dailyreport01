'use client';

import {
  BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ReferenceLine, ResponsiveContainer,
} from 'recharts';
import type { HistoryRow } from './page';

const fmtRev = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

const tooltipStyle = {
  contentStyle: { background: '#282c28', borderRadius: 10, border: 'none', color: '#fff', fontSize: '0.8rem' },
  labelStyle:   { color: 'rgba(255,255,255,0.6)', marginBottom: 4 },
};
const axisStyle = { fontSize: 10, fontFamily: 'var(--font-mono)', fill: '#888' };

function ChartCard({ title }: { title: string; children?: React.ReactNode }) {
  return null; // inline below
}

export default function HistoryCharts({ rows }: { rows: HistoryRow[] }) {
  const data = rows.map((r) => ({
    date:    r.date.slice(5),          // MM-DD
    Cash:    r.phys_cash_revenue,
    NonCash: r.phys_non_cash_revenue,
    Mem:     r.mem_revenue,
    orders:  r.total_orders,
    margin:  r.total_margin,
    aov:     r.total_aov,
  }));

  const cardStyle: React.CSSProperties = {
    background: 'var(--surface)', borderRadius: 14, border: '1px solid var(--border)',
    padding: '1.25rem 1.25rem 1rem',
  };
  const titleStyle: React.CSSProperties = {
    fontFamily: 'var(--font-mono)', fontSize: '0.65rem', textTransform: 'uppercase',
    letterSpacing: '0.1em', color: 'var(--muted)', marginBottom: '0.875rem',
  };

  return (
    <>
      <style>{`
        .hist-charts { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
        @media (max-width: 768px) { .hist-charts { grid-template-columns: 1fr; } }
      `}</style>

      <div className="hist-charts">

        {/* 1 — Revenue by channel */}
        <div style={cardStyle}>
          <div style={titleStyle}>Revenue by Channel</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barSize={10}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
              <XAxis dataKey="date" tick={axisStyle} axisLine={false} tickLine={false} interval={4} />
              <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={axisStyle} axisLine={false} tickLine={false} width={40} />
              <Tooltip formatter={(v: unknown, n: unknown) => [fmtRev(v as number), n as string]} {...tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)' }} />
              <Bar dataKey="Cash"    stackId="a" fill="#185FA5" name="Cash" />
              <Bar dataKey="NonCash" stackId="a" fill="#1D9E75" name="Non-Cash" />
              <Bar dataKey="Mem"     stackId="a" fill="#c8a88a" name="Membership" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* 2 — Daily orders */}
        <div style={cardStyle}>
          <div style={titleStyle}>Daily Orders</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barSize={10}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
              <XAxis dataKey="date" tick={axisStyle} axisLine={false} tickLine={false} interval={4} />
              <YAxis tick={axisStyle} axisLine={false} tickLine={false} width={30} allowDecimals={false} />
              <Tooltip formatter={(v: unknown) => [v as number, 'Orders']} {...tooltipStyle} />
              <Bar dataKey="orders" fill="#6366f1" radius={[3, 3, 0, 0]} name="Orders" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* 3 — Margin % */}
        <div style={cardStyle}>
          <div style={titleStyle}>Margin %</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
              <XAxis dataKey="date" tick={axisStyle} axisLine={false} tickLine={false} interval={4} />
              <YAxis tickFormatter={(v) => `${v}%`} tick={axisStyle} axisLine={false} tickLine={false} width={40} domain={['auto', 'auto']} />
              <Tooltip formatter={(v: unknown) => [`${(v as number).toFixed(1)}%`, 'Margin']} {...tooltipStyle} />
              <ReferenceLine y={80} stroke="#dc2626" strokeDasharray="4 3" strokeWidth={1} label={{ value: '80%', fill: '#dc2626', fontSize: 9, fontFamily: 'var(--font-mono)' }} />
              <Line dataKey="margin" stroke="#f59e0b" strokeWidth={2} dot={false} name="Margin %" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* 4 — AOV */}
        <div style={cardStyle}>
          <div style={titleStyle}>Average Order Value</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
              <XAxis dataKey="date" tick={axisStyle} axisLine={false} tickLine={false} interval={4} />
              <YAxis tickFormatter={(v) => `$${v}`} tick={axisStyle} axisLine={false} tickLine={false} width={44} />
              <Tooltip formatter={(v: unknown) => [fmtRev(v as number), 'AOV']} {...tooltipStyle} />
              <Line dataKey="aov" stroke="#1D9E75" strokeWidth={2} dot={false} name="AOV" />
            </LineChart>
          </ResponsiveContainer>
        </div>

      </div>
    </>
  );
}
