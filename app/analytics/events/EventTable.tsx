'use client';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { AnalyticsEvent } from '@/lib/analytics/client';

const PAGE_SIZE = 50;

interface Props {
  events: AnalyticsEvent[];
  allTypes: string[];
  activeType: string;
  searchParams: Record<string, string | undefined>;
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

// ── Detail drawer ─────────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '0.4rem', padding: '0.45rem 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', paddingTop: 1 }}>{label}</span>
      <span style={{ fontSize: '0.8rem', wordBreak: 'break-all', color: 'var(--text)' }}>{value}</span>
    </div>
  );
}

function EventDetailDrawer({ event, onClose }: { event: AnalyticsEvent; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const hasUTM  = event.utm_source || event.utm_medium || event.utm_campaign || event.utm_content || event.utm_term;
  const hasEcom = event.revenue != null || event.order_id || event.product_id;

  return (
    <>
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 40 }} />

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 420,
        background: 'var(--background)', borderLeft: '1px solid var(--border)',
        zIndex: 50, overflowY: 'auto', padding: '1.25rem 1.5rem',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '0.95rem', marginBottom: 4 }}>
              {event.event_type}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
              {event.created_at ? new Date(event.created_at).toLocaleString() : '—'}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: '1.2rem', lineHeight: 1, padding: '0 0.2rem' }}
            aria-label="Close"
          >×</button>
        </div>

        {/* Core fields */}
        <DetailRow label="ID"       value={<span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>{String(event.id ?? '—')}</span>} />
        <DetailRow label="Category" value={event.event_category} />
        <DetailRow label="Page path" value={event.page_path} />
        <DetailRow label="Page URL"  value={event.page_url} />
        <DetailRow label="Device"    value={event.device_type} />
        <DetailRow label="Session"   value={<span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>{event.session_id ?? '—'}</span>} />
        <DetailRow label="Visitor"   value={<span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>{event.visitor_id ?? '—'}</span>} />
        <DetailRow label="Referrer"  value={event.referrer} />

        {/* UTM */}
        {hasUTM && (
          <div style={{ marginTop: '0.75rem', marginBottom: '0.25rem', fontSize: '0.7rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em' }}>UTM</div>
        )}
        {hasUTM && <>
          <DetailRow label="Source"   value={event.utm_source} />
          <DetailRow label="Medium"   value={event.utm_medium} />
          <DetailRow label="Campaign" value={event.utm_campaign} />
          <DetailRow label="Content"  value={event.utm_content} />
          <DetailRow label="Term"     value={event.utm_term} />
        </>}

        {/* E-commerce */}
        {hasEcom && (
          <div style={{ marginTop: '0.75rem', marginBottom: '0.25rem', fontSize: '0.7rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Order</div>
        )}
        {hasEcom && <>
          <DetailRow label="Order ID"   value={event.order_id} />
          <DetailRow label="Product ID" value={event.product_id} />
          <DetailRow label="Revenue"    value={event.revenue != null ? `${event.currency ?? '$'}${event.revenue}` : undefined} />
          <DetailRow label="Quantity"   value={event.quantity != null ? String(event.quantity) : undefined} />
        </>}

        {/* Properties */}
        {event.properties && Object.keys(event.properties).length > 0 && (
          <>
            <div style={{ marginTop: '0.75rem', marginBottom: '0.5rem', fontSize: '0.7rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Properties</div>
            <pre style={{
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
              padding: '0.75rem', fontSize: '0.72rem', overflowX: 'auto', whiteSpace: 'pre-wrap',
              wordBreak: 'break-all', margin: 0, color: 'var(--text)', fontFamily: 'var(--font-mono)',
              lineHeight: 1.6,
            }}>
              {JSON.stringify(event.properties, null, 2)}
            </pre>
          </>
        )}
      </div>
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function EventTable({ events, allTypes, activeType, searchParams }: Props) {
  const router = useRouter();
  const [page, setPage]         = useState(1);
  const [fTime, setFTime]       = useState('');
  const [fName, setFName]       = useState('');
  const [fCat, setFCat]         = useState('');
  const [fPath, setFPath]       = useState('');
  const [fDevice, setFDevice]   = useState('');
  const [fSession, setFSession] = useState('');
  const [selected, setSelected] = useState<AnalyticsEvent | null>(null);

  const closeDrawer = useCallback(() => setSelected(null), []);

  function selectType(t: string) {
    const p = new URLSearchParams();
    if (searchParams.preset) p.set('preset', searchParams.preset);
    if (searchParams.from)   p.set('from', searchParams.from);
    if (searchParams.to)     p.set('to', searchParams.to);
    if (t) p.set('event_type', t);
    router.push(`/analytics/events?${p.toString()}`);
  }

  const filtered = useMemo(() => events.filter(e => {
    if (fTime   && !contains(e.created_at ? new Date(e.created_at).toLocaleString() : '', fTime)) return false;
    if (fName   && !contains(e.event_type, fName))      return false;
    if (fCat    && !contains(e.event_category, fCat))   return false;
    if (fPath   && !contains(e.page_path, fPath))       return false;
    if (fDevice && e.device_type?.toLowerCase() !== fDevice) return false;
    if (fSession && !contains(e.session_id, fSession))  return false;
    return true;
  }), [events, fTime, fName, fCat, fPath, fDevice, fSession]);

  const totalPages     = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage       = Math.min(page, totalPages);
  const paged          = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const resetPage      = () => setPage(1);
  const hasLocalFilter = fTime || fName || fCat || fPath || fDevice || fSession;

  return (
    <div>
      {selected && <EventDetailDrawer event={selected} onClose={closeDrawer} />}

      {/* Event type pills */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '1rem 0 0.75rem' }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--muted)', flexShrink: 0 }}>Event type:</span>
        <button
          onClick={() => selectType('')}
          style={{ padding: '0.22rem 0.6rem', borderRadius: 5, fontSize: '0.75rem', fontFamily: 'inherit', cursor: 'pointer', background: !activeType ? '#1a1a2e' : 'var(--surface)', color: !activeType ? '#fff' : 'var(--muted)', border: `1px solid ${!activeType ? '#1a1a2e' : 'var(--border)'}` }}
        >All</button>
        {allTypes.slice(0, 20).map(t => (
          <button
            key={t}
            onClick={() => selectType(t)}
            style={{ padding: '0.22rem 0.6rem', borderRadius: 5, fontSize: '0.75rem', fontFamily: 'inherit', cursor: 'pointer', background: activeType === t ? '#1a1a2e' : 'var(--surface)', color: activeType === t ? '#fff' : 'var(--muted)', border: `1px solid ${activeType === t ? '#1a1a2e' : 'var(--border)'}` }}
          >{t}</button>
        ))}
      </div>

      {/* Count + clear */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
          {filtered.length.toLocaleString()} {filtered.length !== events.length ? `of ${events.length.toLocaleString()} ` : ''}events
          {activeType && <span style={{ fontSize: '0.75rem' }}> — all <strong>{activeType}</strong> events for this period</span>}
        </span>
        {hasLocalFilter && (
          <button
            onClick={() => { setFTime(''); setFName(''); setFCat(''); setFPath(''); setFDevice(''); setFSession(''); resetPage(); }}
            style={{ fontSize: '0.75rem', color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
          >Clear column filters</button>
        )}
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'auto' }}>
        <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse', minWidth: 800 }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width: 180 }}>Time</th>
              <th style={thStyle}>Event Name</th>
              <th style={{ ...thStyle, width: 110 }}>Category</th>
              <th style={thStyle}>Page Path</th>
              <th style={{ ...thStyle, width: 100 }}>Device</th>
              <th style={{ ...thStyle, width: 140 }}>Session</th>
            </tr>
            <tr style={{ borderBottom: '2px solid var(--border)' }}>
              <th style={{ padding: '0.4rem 0.85rem' }}>
                <input value={fTime}    onChange={e => { setFTime(e.target.value);    resetPage(); }} placeholder="Search time…"    style={filterInputStyle} />
              </th>
              <th style={{ padding: '0.4rem 0.85rem' }}>
                <input value={fName}    onChange={e => { setFName(e.target.value);    resetPage(); }} placeholder="Search event…"   style={filterInputStyle} />
              </th>
              <th style={{ padding: '0.4rem 0.85rem' }}>
                <input value={fCat}     onChange={e => { setFCat(e.target.value);     resetPage(); }} placeholder="Search…"         style={filterInputStyle} />
              </th>
              <th style={{ padding: '0.4rem 0.85rem' }}>
                <input value={fPath}    onChange={e => { setFPath(e.target.value);    resetPage(); }} placeholder="Search path…"    style={filterInputStyle} />
              </th>
              <th style={{ padding: '0.4rem 0.85rem' }}>
                <select value={fDevice} onChange={e => { setFDevice(e.target.value);  resetPage(); }} style={{ ...filterInputStyle, cursor: 'pointer' }}>
                  {DEVICES.map(d => <option key={d} value={d}>{d || 'All'}</option>)}
                </select>
              </th>
              <th style={{ padding: '0.4rem 0.85rem' }}>
                <input value={fSession} onChange={e => { setFSession(e.target.value); resetPage(); }} placeholder="Search session…" style={filterInputStyle} />
              </th>
            </tr>
          </thead>
          <tbody>
            {paged.map((e, i) => (
              <tr
                key={i}
                onClick={() => setSelected(e)}
                style={{
                  background: selected === e ? 'rgba(99,102,241,0.07)' : i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)',
                  cursor: 'pointer',
                }}
                onMouseEnter={ev => { if (selected !== e) (ev.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.04)'; }}
                onMouseLeave={ev => { if (selected !== e) (ev.currentTarget as HTMLElement).style.background = i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)'; }}
              >
                <td style={{ ...tdStyle, color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                  {e.created_at ? new Date(e.created_at).toLocaleString() : '—'}
                </td>
                <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: '0.8rem' }}>
                  {e.event_type}
                </td>
                <td style={tdStyle}>
                  {e.event_category
                    ? <span style={{ padding: '0.15rem 0.45rem', borderRadius: 4, background: '#e2e8f0', fontSize: '0.72rem', fontWeight: 500 }}>{e.event_category}</span>
                    : <span style={{ color: 'var(--muted)' }}>—</span>}
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

      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: '1rem', alignItems: 'center' }}>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={safePage <= 1}
            style={{ padding: '0.35rem 0.85rem', borderRadius: 8, border: '1px solid var(--border)', cursor: safePage <= 1 ? 'default' : 'pointer', color: 'var(--text)', background: 'var(--surface)', fontSize: '0.82rem', opacity: safePage <= 1 ? 0.4 : 1, fontFamily: 'inherit' }}
          >← Prev</button>
          <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>Page {safePage} of {totalPages}</span>
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
