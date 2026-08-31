'use client';

import { useState, useMemo, type CSSProperties } from 'react';
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

  // Totals over the currently-filtered rows. Sums for money/counts; AOV and
  // Margin are recomputed from the totals (not summed).
  const totals = useMemo(() => {
    const t = {
      revenue: 0, net_sales: 0, orders: 0, profit: 0, ad_spend: 0,
      gp_ads: 0, gp_ads_ltv: 0, cash: 0, non_cash: 0, mem: 0,
    };
    for (const r of filtered) {
      t.revenue    += r.total_revenue;
      t.net_sales  += r.total_net_sales;
      t.orders     += r.total_orders;
      t.profit     += r.gross_profit;
      t.ad_spend   += r.ad_spend;
      t.gp_ads     += r.gp_ads;
      t.gp_ads_ltv += r.gp_ads_ltv;
      t.cash       += r.phys_cash_revenue;
      t.non_cash   += r.phys_non_cash_revenue;
      t.mem        += r.mem_revenue;
    }
    return t;
  }, [filtered]);
  const totalAov    = totals.orders > 0 ? totals.revenue / totals.orders : 0;
  const totalMargin = totals.revenue > 0 ? (totals.profit / totals.revenue) * 100 : 0;

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
              <Th label="Ad Spend"     k="ad_spend" />
              <Th label="GP"           k="gross_profit" />
              <Th label="GP − Ads"     k="gp_ads" />
              <Th label="GP − Ads + LTV" k="gp_ads_ltv" />
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
                <td style={{ padding: '0.7rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--accent-700)' }}>
                  {r.ad_spend > 0 ? fmt(r.ad_spend) : '—'}
                </td>
                <td style={{ padding: '0.7rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 600 }}>
                  {fmt(r.gross_profit)}
                </td>
                <td style={{ padding: '0.7rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: r.gp_ads < 0 ? '#dc2626' : 'inherit' }}>
                  {fmt(r.gp_ads)}
                </td>
                <td style={{ padding: '0.7rem 1rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 600, color: 'var(--accent)' }}>
                  {fmt(r.gp_ads_ltv)}
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
          <tfoot>
            <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface2)' }}>
              <td style={tf(false)}>Total · {sorted.length} days</td>
              <td style={tf()}>{fmt(totals.revenue)}</td>
              <td style={{ ...tf(), color: 'var(--muted)' }}>{fmt(totals.net_sales)}</td>
              <td style={tf()}>{totals.orders.toLocaleString()}</td>
              <td style={tf()}>{fmt(totalAov)}</td>
              <td style={tf()}>{totalMargin.toFixed(1)}%</td>
              <td style={{ ...tf(), color: 'var(--accent-700)' }}>{fmt(totals.ad_spend)}</td>
              <td style={tf()}>{fmt(totals.profit)}</td>
              <td style={{ ...tf(), color: totals.gp_ads < 0 ? '#dc2626' : 'inherit' }}>{fmt(totals.gp_ads)}</td>
              <td style={{ ...tf(), color: 'var(--accent)' }}>{fmt(totals.gp_ads_ltv)}</td>
              <td style={{ ...tf(), color: 'var(--cash-blue-dark)' }}>{fmt(totals.cash)}</td>
              <td style={{ ...tf(), color: 'var(--nc-green-dark)' }}>{fmt(totals.non_cash)}</td>
              <td style={{ ...tf(), color: 'var(--muted)' }}>{fmt(totals.mem)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

// Totals-row cell style.
function tf(right = true): CSSProperties {
  return {
    padding: '0.7rem 1rem',
    textAlign: right ? 'right' : 'left',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.82rem',
    fontWeight: 700,
    whiteSpace: 'nowrap',
  };
}
