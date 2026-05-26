'use client';
import { useState, useMemo } from 'react';
import type { AnalyticsEvent } from '@/lib/analytics/client';

const PAGE_SIZE = 50;

interface Props {
  events: AnalyticsEvent[];
  allTypes: string[];
  initialType: string;
}

const thStyle: React.CSSProperties = {
  padding: '0.6rem 0.85rem',
  textAlign: 'left',
  color: 'var(--muted)',
  fontWeight: 600,
  fontSize: '0.72rem',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  whiteSpace: 'nowrap',
  borderBottom: '1px solid var(--border)',
};

const filterInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.3rem 0.5rem',
  borderRadius: 5,
  border: '1px solid var(--border)',
  background: 'var(--background)',
  color: 'var(--text)',
  fontSize: '0.75rem',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

const tdStyle: React.CSSProperties = {
  padding: '0.55rem 0.85rem',
  borderBottom: '1px solid var(--border)',
  verticalAlign: 'middle',
};

function contains(val: string | null | undefined, q: string): boolean {
  if (!q) return true;
  return (val ?? '').toLowerCase().includes(q.toLowerCase());
}

const DEVICES = ['', 'mobile', 'desktop', 'tablet'];

export default function EventTable({ events, allTypes, initialType }: Props) {
  const [page, setPage]             = useState(1);
  const [fTime, setFTime]           = useState('');
  const [fName, setFName]           = useState(initialType);
  const [fCat, setFCat]             = useState('');
  const [fPath, setFPath]           = useState('');
  const [fDevice, setFDevice]       = useState('');
  const [fSession, setFSession]     = useState('');

  const filtered = useMemo(() => {
    return events.filter(e => {
      if (fTime && !contains(e.created_at ? new Date(e.created_at).toLocaleString() : '', fTime)) return false;
      if (fName && !contains(e.event_type, fName)) return false;
      if (fCat  && !contains(e.event_category, fCat))  return false;
      if (fPath && !contains(e.page_path, fPath)) return false;
      if (fDevice && e.device_type?.toLowerCase() !== fDevice) return false;
      if (fSession && !contains(e.session_id, fSession)) return false;
      return true;
    });
  }, [events, fTime, fName, fCat, fPath, fDevice, fSession]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const paged      = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const resetPage  = () => setPage(1);

  const isFiltered = fTime || fName || fCat || fPath || fDevice || fSession;

  return (
    <div>
      {/* Event type quick-filter pills */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '1rem 0 0.75rem' }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--muted)', flexShrink: 0 }}>Event type:</span>
        <button
          onClick={() => { setFName(''); resetPage(); }}
          style={{
            padding: '0.22rem 0.6rem', borderRadius: 5, fontSize: '0.75rem', fontFamily: 'inherit', cursor: 'pointer',
            background: !fName ? '#1a1a2e' : 'var(--surface)',
            color: !fName ? '#fff' : 'var(--muted)',
            border: `1px solid ${!fName ? '#1a1a2e' : 'var(--border)'}`,
          }}
        >All</button>
        {allTypes.slice(0, 16).map(t => (
          <button
            key={t}
            onClick={() => { setFName(t); resetPage(); }}
            style={{
              padding: '0.22rem 0.6rem', borderRadius: 5, fontSize: '0.75rem', fontFamily: 'inherit', cursor: 'pointer',
              background: fName === t ? '#1a1a2e' : 'var(--surface)',
              color: fName === t ? '#fff' : 'var(--muted)',
              border: `1px solid ${fName === t ? '#1a1a2e' : 'var(--border)'}`,
            }}
          >{t}</button>
        ))}
      </div>

      {/* Count + clear */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
          {filtered.length.toLocaleString()} {filtered.length !== events.length ? `of ${events.length.toLocaleString()} ` : ''}events
        </span>
        {isFiltered && (
          <button
            onClick={() => { setFTime(''); setFName(''); setFCat(''); setFPath(''); setFDevice(''); setFSession(''); resetPage(); }}
            style={{ fontSize: '0.75rem', color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
          >Clear filters</button>
        )}
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'auto' }}>
        <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse', minWidth: 800 }}>
          <thead>
            {/* Column headers */}
            <tr>
              <th style={{ ...thStyle, width: 180 }}>Time</th>
              <th style={thStyle}>Event Name</th>
              <th style={{ ...thStyle, width: 110 }}>Category</th>
              <th style={thStyle}>Page Path</th>
              <th style={{ ...thStyle, width: 100 }}>Device</th>
              <th style={{ ...thStyle, width: 140 }}>Session</th>
            </tr>
            {/* Column search inputs */}
            <tr style={{ borderBottom: '2px solid var(--border)' }}>
              <th style={{ padding: '0.4rem 0.85rem' }}>
                <input
                  value={fTime}
                  onChange={e => { setFTime(e.target.value); resetPage(); }}
                  placeholder="Search time…"
                  style={filterInputStyle}
                />
              </th>
              <th style={{ padding: '0.4rem 0.85rem' }}>
                <input
                  value={fName}
                  onChange={e => { setFName(e.target.value); resetPage(); }}
                  placeholder="Search event…"
                  style={filterInputStyle}
                />
              </th>
              <th style={{ padding: '0.4rem 0.85rem' }}>
                <input
                  value={fCat}
                  onChange={e => { setFCat(e.target.value); resetPage(); }}
                  placeholder="Search…"
                  style={filterInputStyle}
                />
              </th>
              <th style={{ padding: '0.4rem 0.85rem' }}>
                <input
                  value={fPath}
                  onChange={e => { setFPath(e.target.value); resetPage(); }}
                  placeholder="Search path…"
                  style={filterInputStyle}
                />
              </th>
              <th style={{ padding: '0.4rem 0.85rem' }}>
                <select
                  value={fDevice}
                  onChange={e => { setFDevice(e.target.value); resetPage(); }}
                  style={{ ...filterInputStyle, cursor: 'pointer' }}
                >
                  {DEVICES.map(d => (
                    <option key={d} value={d}>{d || 'All'}</option>
                  ))}
                </select>
              </th>
              <th style={{ padding: '0.4rem 0.85rem' }}>
                <input
                  value={fSession}
                  onChange={e => { setFSession(e.target.value); resetPage(); }}
                  placeholder="Search session…"
                  style={filterInputStyle}
                />
              </th>
            </tr>
          </thead>
          <tbody>
            {paged.map((e, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)' }}>
                <td style={{ ...tdStyle, color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                  {e.created_at ? new Date(e.created_at).toLocaleString() : '—'}
                </td>
                <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: '0.8rem' }}>
                  {e.event_type}
                </td>
                <td style={tdStyle}>
                  {e.event_category ? (
                    <span style={{ padding: '0.15rem 0.45rem', borderRadius: 4, background: '#e2e8f0', fontSize: '0.72rem', fontWeight: 500 }}>
                      {e.event_category}
                    </span>
                  ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                </td>
                <td style={{ ...tdStyle, color: 'var(--muted)', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.78rem' }}>
                  {e.page_path ?? '—'}
                </td>
                <td style={{ ...tdStyle, color: 'var(--muted)', textTransform: 'capitalize', fontSize: '0.78rem' }}>
                  {e.device_type ?? '—'}
                </td>
                <td style={{ ...tdStyle, color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.session_id ?? '—'}
                </td>
              </tr>
            ))}
            {paged.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--muted)', fontSize: '0.85rem' }}>
                  No events match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: '1rem', alignItems: 'center' }}>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            style={{ padding: '0.35rem 0.85rem', borderRadius: 8, border: '1px solid var(--border)', cursor: safePage <= 1 ? 'default' : 'pointer', color: 'var(--text)', background: 'var(--surface)', fontSize: '0.82rem', opacity: safePage <= 1 ? 0.4 : 1, fontFamily: 'inherit' }}
          >← Prev</button>
          <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
            Page {safePage} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={safePage >= totalPages}
            style={{ padding: '0.35rem 0.85rem', borderRadius: 8, border: '1px solid var(--border)', cursor: safePage >= totalPages ? 'default' : 'pointer', color: 'var(--text)', background: 'var(--surface)', fontSize: '0.82rem', opacity: safePage >= totalPages ? 0.4 : 1, fontFamily: 'inherit' }}
          >Next →</button>
        </div>
      )}
    </div>
  );
}
