'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import type { HistoryRow } from './page';

type SortKey = keyof HistoryRow;
type SortDir = 'asc' | 'desc';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dayLabel(iso: string) {
  // Parse as local date to avoid UTC-shift
  const [y, m, d] = iso.split('-').map(Number);
  return DOW[new Date(y, m - 1, d).getDay()];
}

export default function HistoryTable({ rows }: { rows: HistoryRow[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'date', dir: 'desc' });
  const [start, setStart] = useState('');
  const [end,   setEnd]   = useState('');

  const filtered = useMemo(() =>
    rows.filter((r) => {
      if (start && r.date < start) return false;
      if (end   && r.date > end)   return false;
      return true;
    }),
  [rows, start, end]);

  const sorted = useMemo(() =>
    [...filtered].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sort.dir === 'asc' ? cmp : -cmp;
    }),
  [filtered, sort]);

  function toggle(key: SortKey) {
    setSort((prev) => prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'desc' });
  }

  function Th({ label, k, right = true }: { label: string; k: SortKey; right?: boolean }) {
    const active = sort.key === k;
    return (
      <th onClick={() => toggle(k)} style={{
        padding: '0.75rem 1rem',
        textAlign: right ? 'right' : 'left',
        fontFamily: 'var(--font-mono)', fontSize: '0.65rem',
        textTransform: 'uppercase', letterSpacing: '0.07em',
        color: active ? 'var(--text)' : 'var(--muted)',
        cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
        fontWeight: active ? 600 : 500,
      }}>
        {label}{active ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
      </th>
    );
  }

  return (
    <>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--muted)', marginBottom: '1rem' }}>
        Daily Log
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>Filter:</span>
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} style={{
          padding: '0.35rem 0.7rem', borderRadius: 8, border: '1px solid var(--border)',
          fontSize: '0.82rem', background: 'var(--bg)', fontFamily: 'var(--font-mono)',
          color: 'var(--text)',
        }} />
        <span style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>→</span>
        <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} style={{
          padding: '0.35rem 0.7rem', borderRadius: 8, border: '1px solid var(--border)',
          fontSize: '0.82rem', background: 'var(--bg)', fontFamily: 'var(--font-mono)',
          color: 'var(--text)',
        }} />
        {(start || end) && (
          <button onClick={() => { setStart(''); setEnd(''); }} style={{
            padding: '0.35rem 0.7rem', borderRadius: 8, border: '1px solid var(--border)',
            fontSize: '0.78rem', background: 'transparent', cursor: 'pointer', color: 'var(--muted)',
          }}>
            Clear
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '0.78rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          {sorted.length} days
        </span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)' }}>
              <Th label="Date"      k="date"                 right={false} />
              <Th label="Revenue"   k="total_revenue" />
              <Th label="Net Sales" k="total_net_sales" />
              <Th label="Orders"    k="total_orders" />
              <Th label="AOV"       k="total_aov" />
              <Th label="Margin"    k="total_margin" />
              <Th label="Cash"      k="phys_cash_revenue" />
              <Th label="Non-Cash"  k="phys_non_cash_revenue" />
              <Th label="Mem Rev"   k="mem_revenue" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => (
              <tr key={r.date} style={{
                borderBottom: i < sorted.length - 1 ? '1px solid var(--border)' : 'none',
                transition: 'background 0.1s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface2)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                {/* Date — prominent clickable link */}
                <td style={{ padding: '0.7rem 1rem', whiteSpace: 'nowrap' }}>
                  <Link href={`/dashboard/${r.date}`} style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      background: 'var(--surface2)', border: '1px solid var(--border)',
                      borderRadius: 6, padding: '0.2rem 0.45rem',
                      fontFamily: 'var(--font-mono)', fontSize: '0.68rem',
                      color: 'var(--muted)', fontWeight: 500, minWidth: 30, textAlign: 'center',
                    }}>
                      {dayLabel(r.date)}
                    </span>
                    <span style={{
                      fontFamily: 'var(--font-mono)', fontSize: '0.82rem',
                      color: 'var(--cash-blue)', fontWeight: 600,
                      borderBottom: '1px dashed var(--cash-blue)',
                    }}>
                      {r.date}
                    </span>
                    <span style={{ color: 'var(--muted)', fontSize: '0.72rem', opacity: 0.6 }}>→</span>
                  </Link>
                </td>
                <td style={{ padding: '0.7rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 600 }}>
                  {fmt(r.total_revenue)}
                </td>
                <td style={{ padding: '0.7rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--muted)' }}>
                  {fmt(r.total_net_sales)}
                </td>
                <td style={{ padding: '0.7rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>
                  {r.total_orders}
                </td>
                <td style={{ padding: '0.7rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>
                  {fmt(r.total_aov)}
                </td>
                <td style={{ padding: '0.7rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: r.total_margin < 80 ? '#dc2626' : 'inherit' }}>
                  {r.total_margin.toFixed(1)}%
                </td>
                <td style={{ padding: '0.7rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--cash-blue-dark)' }}>
                  {fmt(r.phys_cash_revenue)}
                </td>
                <td style={{ padding: '0.7rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--nc-green-dark)' }}>
                  {fmt(r.phys_non_cash_revenue)}
                </td>
                <td style={{ padding: '0.7rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--muted)' }}>
                  {fmt(r.mem_revenue)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
