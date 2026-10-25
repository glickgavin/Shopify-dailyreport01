'use client';

import { useMemo, useState } from 'react';

// Active members & their store credit — the live membership_credit_members
// table (kept current by the nightly segment snapshot and the credit-
// correction worker), searchable and sortable client-side.

export interface MemberRow {
  customer_id: string;
  email: string | null;
  display_name: string | null;
  credit_cents: number;
}

const usd = (c: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(c / 100);
const num = (n: number) => new Intl.NumberFormat('en-US').format(n);

const PAGE_SIZE = 50;

type SortKey = 'credit' | 'name' | 'email';

export default function MembersTable({ rows, asOf }: { rows: MemberRow[]; asOf: string | null }) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('credit');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? rows.filter(r =>
          (r.email ?? '').toLowerCase().includes(q) ||
          (r.display_name ?? '').toLowerCase().includes(q) ||
          r.customer_id.includes(q))
      : rows;
    const sorted = [...base].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'credit') cmp = a.credit_cents - b.credit_cents;
      else if (sortKey === 'name') cmp = (a.display_name ?? '').localeCompare(b.display_name ?? '');
      else cmp = (a.email ?? '').localeCompare(b.email ?? '');
      return sortAsc ? cmp : -cmp;
    });
    return sorted;
  }, [rows, search, sortKey, sortAsc]);

  const totalCents = useMemo(() => filtered.reduce((s, r) => s + r.credit_cents, 0), [filtered]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const header = (label: string, key: SortKey, align: 'left' | 'right') => (
    <th
      onClick={() => {
        if (sortKey === key) setSortAsc(!sortAsc);
        else { setSortKey(key); setSortAsc(key !== 'credit'); }
        setPage(0);
      }}
      style={{ padding: '0.6rem 0.875rem', textAlign: align, cursor: 'pointer', userSelect: 'none', fontFamily: 'var(--font-mono)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)', fontWeight: 500, whiteSpace: 'nowrap' }}
    >
      {label}{sortKey === key ? (sortAsc ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <div>
      {/* Summary + search */}
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)', marginRight: 10 }}>Members</span>
          <strong style={{ fontSize: '1.1rem' }}>{num(filtered.length)}</strong>
        </div>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)', marginRight: 10 }}>Store credit</span>
          <strong style={{ fontSize: '1.1rem' }}>{usd(totalCents)}</strong>
        </div>
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0); }}
          placeholder="Search name, email or customer ID…"
          style={{ flex: 1, minWidth: 220, padding: '0.6rem 0.9rem', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)', fontSize: '0.85rem', color: 'var(--text)' }}
        />
        {asOf && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)' }}>balances as of {asOf.slice(0, 16).replace('T', ' ')} UTC</div>
        )}
      </div>

      {/* Table */}
      <div style={{ background: 'var(--surface)', borderRadius: 12, border: '1px solid var(--border)', overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
          <thead>
            <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
              {header('Member', 'name', 'left')}
              {header('Email', 'email', 'left')}
              {header('Store Credit', 'credit', 'right')}
              <th style={{ padding: '0.6rem 0.875rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)', fontWeight: 500 }}>Customer ID</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr><td colSpan={4} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>No members match.</td></tr>
            )}
            {pageRows.map((r, i) => (
              <tr key={r.customer_id} style={{ borderBottom: i < pageRows.length - 1 ? '1px solid var(--border)' : 'none', background: i % 2 === 1 ? 'rgba(0,0,0,0.015)' : 'transparent' }}>
                <td style={{ padding: '0.55rem 0.875rem', fontWeight: 500 }}>{r.display_name || '—'}</td>
                <td style={{ padding: '0.55rem 0.875rem', fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--neutral-600)' }}>{r.email ?? '—'}</td>
                <td style={{ padding: '0.55rem 0.875rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: r.credit_cents > 100000 ? 'var(--accent)' : 'var(--text)' }}>{usd(r.credit_cents)}</td>
                <td style={{ padding: '0.55rem 0.875rem', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted)' }}>{r.customer_id.split('/').pop()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'flex-end', marginTop: '0.75rem', fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
        <button disabled={page === 0} onClick={() => setPage(p => p - 1)} style={{ padding: '0.3rem 0.8rem', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', cursor: page === 0 ? 'default' : 'pointer', color: page === 0 ? 'var(--muted)' : 'var(--text)' }}>‹ Prev</button>
        <span style={{ color: 'var(--muted)' }}>page {page + 1} / {pages}</span>
        <button disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)} style={{ padding: '0.3rem 0.8rem', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--surface)', cursor: page >= pages - 1 ? 'default' : 'pointer', color: page >= pages - 1 ? 'var(--muted)' : 'var(--text)' }}>Next ›</button>
      </div>
    </div>
  );
}
