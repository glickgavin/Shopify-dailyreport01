'use client';

import { useState, useMemo, type CSSProperties } from 'react';

export interface SessionSummary {
  session_id: string;
  visitor_id?: string;
  email?: string;
  events: number;
  first_event: string;
  last_event: string;
  device: string;
  country: string;
  first_at: string;
  last_at: string;
  duration_s: number;
}

const filterInputStyle: CSSProperties = {
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

const thBase: CSSProperties = {
  padding: '0.5rem 0.75rem', textAlign: 'left', color: 'var(--muted)',
  fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase',
  letterSpacing: '0.05em', background: 'var(--surface)', whiteSpace: 'nowrap',
};

function contains(val: string | null | undefined, q: string): boolean {
  if (!q) return true;
  return (val ?? '').toLowerCase().includes(q.toLowerCase());
}

function fmtDuration(s: number) {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function SessionsTable({
  sessions, sortKey, focusSession, preset, sortHrefs,
}: {
  sessions: SessionSummary[];
  sortKey: string;
  focusSession?: string;
  preset: string;
  sortHrefs: Record<string, string>;
}) {
  const [fStarted, setFStarted]   = useState('');
  const [fDevice, setFDevice]     = useState('');
  const [fCountry, setFCountry]   = useState('');
  const [fFirst, setFFirst]       = useState('');
  const [fSession, setFSession]   = useState('');
  const [fEmail, setFEmail]       = useState('');

  const devices = useMemo(
    () => Array.from(new Set(sessions.map(s => s.device).filter(d => d && d !== '—'))).sort(),
    [sessions],
  );
  const countries = useMemo(
    () => Array.from(new Set(sessions.map(s => s.country).filter(c => c && c !== '—'))).sort(),
    [sessions],
  );

  const filtered = useMemo(() => sessions.filter(s =>
    contains(s.first_at ? new Date(s.first_at).toLocaleString() : '', fStarted) &&
    (!fDevice || s.device === fDevice) &&
    (!fCountry || s.country === fCountry) &&
    contains(s.first_event, fFirst) &&
    contains(s.session_id, fSession) &&
    contains(s.email, fEmail)
  ), [sessions, fStarted, fDevice, fCountry, fFirst, fSession, fEmail]);

  const anyFilter = !!(fStarted || fDevice || fCountry || fFirst || fSession || fEmail);

  function clearFilters() {
    setFStarted(''); setFDevice(''); setFCountry(''); setFFirst(''); setFSession(''); setFEmail('');
  }

  function SortTh({ label, col }: { label: string; col?: string }) {
    return (
      <th style={thBase}>
        {col ? (
          <a href={sortHrefs[col]} style={{ color: sortKey === col ? 'var(--text)' : 'var(--muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            {label}{sortKey === col && <span style={{ fontSize: '0.65rem' }}>▼</span>}
          </a>
        ) : label}
      </th>
    );
  }

  return (
    <>
      <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', fontSize: '0.85rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
        Sessions
        <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 400 }}>
          {filtered.length.toLocaleString()}{filtered.length !== sessions.length ? ` of ${sessions.length.toLocaleString()}` : ''} total
        </span>
        {anyFilter && (
          <button onClick={clearFilters} style={{
            marginLeft: 'auto', fontSize: '0.72rem', fontFamily: 'var(--font-mono)',
            padding: '0.25rem 0.6rem', borderRadius: 6, border: '1px solid var(--border)',
            background: 'transparent', color: 'var(--muted)', cursor: 'pointer',
          }}>Clear filters</button>
        )}
      </div>
      <div style={{ maxHeight: 560, overflowY: 'auto', overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse', minWidth: 700 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 1 }}>
              <SortTh label="Started"     col="started" />
              <SortTh label="Events"      col="events" />
              <SortTh label="Duration"    col="duration" />
              <SortTh label="Device" />
              <SortTh label="Country" />
              <SortTh label="First Event" />
              <SortTh label="Session ID"  col="session" />
              <SortTh label="Email"       col="email" />
            </tr>
            {/* Filter row */}
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)', position: 'sticky', top: 28, zIndex: 1 }}>
              <th style={{ padding: '0.4rem 0.6rem' }}>
                <input value={fStarted} onChange={e => setFStarted(e.target.value)} placeholder="Search time…" style={filterInputStyle} />
              </th>
              <th style={{ padding: '0.4rem 0.6rem' }} />
              <th style={{ padding: '0.4rem 0.6rem' }} />
              <th style={{ padding: '0.4rem 0.6rem' }}>
                <select value={fDevice} onChange={e => setFDevice(e.target.value)} style={{ ...filterInputStyle, cursor: 'pointer' }}>
                  <option value="">All</option>
                  {devices.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </th>
              <th style={{ padding: '0.4rem 0.6rem' }}>
                <select value={fCountry} onChange={e => setFCountry(e.target.value)} style={{ ...filterInputStyle, cursor: 'pointer' }}>
                  <option value="">All</option>
                  {countries.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </th>
              <th style={{ padding: '0.4rem 0.6rem' }}>
                <input value={fFirst} onChange={e => setFFirst(e.target.value)} placeholder="Search event…" style={filterInputStyle} />
              </th>
              <th style={{ padding: '0.4rem 0.6rem' }}>
                <input value={fSession} onChange={e => setFSession(e.target.value)} placeholder="Search session…" style={filterInputStyle} />
              </th>
              <th style={{ padding: '0.4rem 0.6rem' }}>
                <input value={fEmail} onChange={e => setFEmail(e.target.value)} placeholder="Search email…" style={filterInputStyle} />
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 200).map(s => (
              <tr key={s.session_id} style={{ borderBottom: '1px solid var(--border)', background: focusSession === s.session_id ? 'rgba(26,26,46,0.05)' : 'transparent', cursor: 'pointer' }}>
                <td style={{ padding: '0.5rem 0.75rem' }}>
                  <a href={`/analytics/journey?preset=${preset}&session_id=${s.session_id}&sort=${sortKey}`}
                     style={{ color: 'var(--text)', textDecoration: 'none', fontFamily: 'var(--font-mono)', fontSize: '0.73rem' }}>
                    {s.first_at ? new Date(s.first_at).toLocaleString() : '—'}
                  </a>
                </td>
                <td style={{ padding: '0.5rem 0.75rem', color: 'var(--muted)' }}>{s.events}</td>
                <td style={{ padding: '0.5rem 0.75rem', color: 'var(--muted)' }}>{fmtDuration(s.duration_s)}</td>
                <td style={{ padding: '0.5rem 0.75rem', color: 'var(--muted)', textTransform: 'capitalize' }}>{s.device}</td>
                <td style={{ padding: '0.5rem 0.75rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>{s.country}</td>
                <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>{s.first_event}</td>
                <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--muted)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.session_id}>
                  {s.session_id.length > 12 ? s.session_id.slice(0, 12) + '…' : s.session_id}
                </td>
                <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.75rem', color: 'var(--muted)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.email}>
                  {s.email ?? <span style={{ opacity: 0.4 }}>—</span>}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>No sessions match the current filters</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
