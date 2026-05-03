'use client';
import { useState, useMemo } from 'react';
import Link from 'next/link';

interface Row {
  date: string;
  total_revenue: number;
  total_net_sales: number;
  total_orders: number;
  total_margin: number;
  phys_cash_revenue: number;
  phys_non_cash_revenue: number;
  mem_revenue: number;
  mem_orders: number;
}

type SortKey = keyof Row;
type SortDir = 'asc' | 'desc';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

export default function HistoryTable({ rows }: { rows: Row[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'date', dir: 'desc' });
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (start && r.date < start) return false;
      if (end && r.date > end) return false;
      return true;
    });
  }, [rows, start, end]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sort]);

  function toggle(key: SortKey) {
    setSort((prev) => prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'desc' });
  }

  function Th({ label, k }: { label: string; k: SortKey }) {
    const active = sort.key === k;
    return (
      <th
        onClick={() => toggle(k)}
        style={{
          padding: '0.75rem 1rem',
          textAlign: k === 'date' ? 'left' : 'right',
          fontFamily: 'var(--font-mono)', fontSize: '0.68rem',
          textTransform: 'uppercase', letterSpacing: '0.07em',
          color: active ? 'var(--text)' : 'var(--muted)',
          cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
          fontWeight: active ? 600 : 500,
        }}
      >
        {label} {active ? (sort.dir === 'asc' ? '↑' : '↓') : ''}
      </th>
    );
  }

  return (
    <>
      {/* Date range filter */}
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>Filter:</span>
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
          style={{ padding: '0.4rem 0.75rem', borderRadius: 8, border: '1px solid var(--border)', fontSize: '0.85rem', background: 'var(--surface)', fontFamily: 'var(--font-mono)' }} />
        <span style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>→</span>
        <input type="date" value={end} onChange={(e) => setEnd(e.target.value)}
          style={{ padding: '0.4rem 0.75rem', borderRadius: 8, border: '1px solid var(--border)', fontSize: '0.85rem', background: 'var(--surface)', fontFamily: 'var(--font-mono)' }} />
        {(start || end) && (
          <button onClick={() => { setStart(''); setEnd(''); }}
            style={{ padding: '0.4rem 0.75rem', borderRadius: 8, border: '1px solid var(--border)', fontSize: '0.8rem', background: 'transparent', cursor: 'pointer', color: 'var(--muted)' }}>
            Clear
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: 'var(--muted)' }}>{sorted.length} days</span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
              <Th label="Date" k="date" />
              <Th label="Revenue" k="total_revenue" />
              <Th label="Net Sales" k="total_net_sales" />
              <Th label="Orders" k="total_orders" />
              <Th label="Margin" k="total_margin" />
              <Th label="Cash" k="phys_cash_revenue" />
              <Th label="Non-Cash" k="phys_non_cash_revenue" />
              <Th label="Mem Rev" k="mem_revenue" />
              <Th label="Mem Orders" k="mem_orders" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={r.date} style={{
                borderBottom: i < sorted.length - 1 ? '1px solid var(--border)' : 'none',
                background: i % 2 === 1 ? 'rgba(0,0,0,0.015)' : 'transparent',
              }}>
                <td style={{ padding: '0.65rem 1rem' }}>
                  <Link href={`/dashboard/${r.date}`} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--cash-blue)', textDecoration: 'none', fontWeight: 500 }}>
                    {r.date}
                  </Link>
                </td>
                <td style={{ padding: '0.65rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 600 }}>{fmt(r.total_revenue)}</td>
                <td style={{ padding: '0.65rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{fmt(r.total_net_sales)}</td>
                <td style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>{r.total_orders}</td>
                <td style={{ padding: '0.65rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: r.total_margin < 80 ? '#e53e3e' : 'inherit' }}>{r.total_margin.toFixed(1)}%</td>
                <td style={{ padding: '0.65rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--cash-blue-dark)' }}>{fmt(r.phys_cash_revenue)}</td>
                <td style={{ padding: '0.65rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--nc-green-dark)' }}>{fmt(r.phys_non_cash_revenue)}</td>
                <td style={{ padding: '0.65rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>{fmt(r.mem_revenue)}</td>
                <td style={{ padding: '0.65rem 1rem', textAlign: 'right' }}>{r.mem_orders}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
