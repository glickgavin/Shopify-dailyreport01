'use client';
import { useState, useEffect, useCallback, useRef } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

type Period = '1D' | '3D' | '7D';
type Tab = 'sequences' | 'explorer';

interface SequenceRow {
  step1: string | null;
  step2: string | null;
  step3: string | null;
  step4: string | null;
  sessions: number;
  pct: number;
}

interface NeighborhoodRow {
  direction: 'before' | 'after';
  step_offset: number;
  event_label: string;
  sessions: number;
  pct: number;
}

interface TopEvent {
  label: string;
  cnt: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getRange(period: Period) {
  const to   = new Date();
  const days = period === '1D' ? 1 : period === '3D' ? 3 : 7;
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function eventColor(label: string | null): string {
  if (!label) return '#9ca3af';
  if (label.startsWith('page_view')) return '#3b82f6';
  if (label.includes('order') || label.includes('purchase')) return '#16a34a';
  if (label.includes('cart')) return '#ea580c';
  if (label.includes('checkout')) return '#7c3aed';
  if (label.includes('member')) return '#0891b2';
  return '#6b7280';
}

function shortLabel(label: string | null): string {
  if (!label) return '—';
  if (label.startsWith('page_view: ')) return label.slice('page_view: '.length) || '/';
  return label;
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function PeriodTabs({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {(['1D', '3D', '7D'] as Period[]).map(p => (
        <button key={p} onClick={() => onChange(p)} style={{
          padding: '0.35rem 0.85rem',
          fontSize: '0.78rem', fontFamily: 'var(--font-mono)',
          fontWeight: value === p ? 700 : 400,
          background: value === p ? '#1a1a2e' : 'transparent',
          color: value === p ? '#fff' : 'var(--muted)',
          border: `1px solid ${value === p ? '#1a1a2e' : 'var(--border)'}`,
          borderRadius: 6, cursor: 'pointer',
        }}>
          {p}
        </button>
      ))}
    </div>
  );
}

function Spinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '3rem', color: 'var(--muted)', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
      Loading…
    </div>
  );
}

// ── Step badge ────────────────────────────────────────────────────────────────

function StepBadge({ label }: { label: string | null }) {
  if (!label) return <span style={{ color: 'var(--muted)', fontSize: '0.72rem' }}>—</span>;
  const color = eventColor(label);
  const text  = shortLabel(label);
  const isPage = label.startsWith('page_view');
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: color + '18',
      border: `1px solid ${color}44`,
      borderRadius: 5,
      padding: '0.2rem 0.55rem',
      fontSize: '0.72rem', fontFamily: 'var(--font-mono)',
      color, maxWidth: 160, overflow: 'hidden',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: color, flexShrink: 0,
      }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {isPage ? text : text}
      </span>
    </span>
  );
}

// ── Sequences view ────────────────────────────────────────────────────────────

function SequencesView({
  sequences, loading, topEvents, startFilter, onStartChange,
}: {
  sequences: SequenceRow[];
  loading: boolean;
  topEvents: TopEvent[];
  startFilter: string;
  onStartChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* Filter bar */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 10, padding: '1rem 1.25rem',
        display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
          Start from
        </span>
        <select
          value={startFilter}
          onChange={e => onStartChange(e.target.value)}
          style={{
            padding: '0.35rem 0.6rem',
            fontSize: '0.78rem', fontFamily: 'var(--font-mono)',
            background: 'var(--bg)', color: 'var(--text)',
            border: '1px solid var(--border)', borderRadius: 6,
            minWidth: 220, cursor: 'pointer',
          }}
        >
          <option value="">Any event (session start)</option>
          {topEvents.map(e => (
            <option key={e.label} value={e.label}>{shortLabel(e.label)} ({e.cnt.toLocaleString()})</option>
          ))}
        </select>
        {startFilter && (
          <button
            onClick={() => onStartChange('')}
            style={{
              padding: '0.3rem 0.6rem', fontSize: '0.72rem',
              background: 'transparent', color: 'var(--muted)',
              border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer',
            }}
          >
            Clear
          </button>
        )}
        <span style={{ fontSize: '0.65rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>
          Top 25 paths · up to 4 steps
        </span>
      </div>

      {/* Table */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        {loading ? <Spinner /> : sequences.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--muted)', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
            No data for this period
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface2)' }}>
                  {['#', 'Step 1', 'Step 2', 'Step 3', 'Step 4', 'Sessions', '% of total'].map((h, i) => (
                    <th key={h} style={{
                      padding: '0.6rem 1rem', textAlign: i >= 5 ? 'right' : 'left',
                      fontSize: '0.62rem', fontFamily: 'var(--font-mono)',
                      textTransform: 'uppercase', letterSpacing: '0.08em',
                      color: 'var(--muted)', fontWeight: 500, whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sequences.map((row, i) => (
                  <tr key={i} style={{
                    borderBottom: i < sequences.length - 1 ? '1px solid var(--border)' : 'none',
                    background: i % 2 === 1 ? 'var(--surface2)' : 'transparent',
                  }}>
                    <td style={{ padding: '0.7rem 1rem', fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)', width: 36 }}>
                      {i + 1}
                    </td>
                    {[row.step1, row.step2, row.step3, row.step4].map((step, si) => (
                      <td key={si} style={{ padding: '0.6rem 1rem', whiteSpace: 'nowrap' }}>
                        <StepBadge label={step} />
                      </td>
                    ))}
                    <td style={{ padding: '0.6rem 1rem', textAlign: 'right', fontSize: '0.85rem', fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                      {row.sessions.toLocaleString()}
                    </td>
                    <td style={{ padding: '0.6rem 1rem', textAlign: 'right' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                        <div style={{ width: 60, height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${Math.min(row.pct, 100)}%`, height: '100%', background: '#1a1a2e', borderRadius: 3 }} />
                        </div>
                        <span style={{ fontSize: '0.78rem', fontFamily: 'var(--font-mono)', color: 'var(--text)', minWidth: 36, textAlign: 'right' }}>
                          {row.pct}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Neighborhood event card ───────────────────────────────────────────────────

function EventCard({
  label, sessions, pct, maxSessions,
}: {
  label: string; sessions: number; pct: number; maxSessions: number;
}) {
  const color = eventColor(label);
  const barWidth = maxSessions > 0 ? (sessions / maxSessions) * 100 : 0;
  return (
    <div style={{
      background: 'var(--surface2)', border: `1px solid ${color}33`,
      borderLeft: `3px solid ${color}`,
      borderRadius: 6, padding: '0.5rem 0.65rem',
      marginBottom: 5,
    }}>
      <div style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--text)', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {shortLabel(label)}
      </div>
      <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, marginBottom: 4, overflow: 'hidden' }}>
        <div style={{ width: `${barWidth}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.62rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
          {sessions.toLocaleString()} sessions
        </span>
        <span style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', fontWeight: 700, color }}>
          {pct}%
        </span>
      </div>
    </div>
  );
}

// ── Neighborhood column ───────────────────────────────────────────────────────

function NeighborhoodColumn({
  label, events, maxSessions,
}: {
  label: string;
  events: NeighborhoodRow[];
  maxSessions: number;
}) {
  return (
    <div style={{ flex: '1 1 0', minWidth: 0 }}>
      <div style={{
        fontSize: '0.6rem', fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
        letterSpacing: '0.08em', color: 'var(--muted)', fontWeight: 600,
        marginBottom: '0.5rem', textAlign: 'center',
      }}>
        {label}
      </div>
      {events.length === 0 ? (
        <div style={{ fontSize: '0.65rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', textAlign: 'center', padding: '0.5rem 0' }}>—</div>
      ) : (
        events.map(e => (
          <EventCard
            key={e.event_label}
            label={e.event_label}
            sessions={e.sessions}
            pct={e.pct}
            maxSessions={maxSessions}
          />
        ))
      )}
    </div>
  );
}

// ── Explorer view ─────────────────────────────────────────────────────────────

function ExplorerView({
  neighborhood, anchorEvent, loading, topEvents, totalAnchorSessions, onAnchorChange,
}: {
  neighborhood: NeighborhoodRow[];
  anchorEvent: string;
  loading: boolean;
  topEvents: TopEvent[];
  totalAnchorSessions: number;
  onAnchorChange: (v: string) => void;
}) {
  const before = (offset: number) =>
    neighborhood.filter(r => r.direction === 'before' && r.step_offset === offset);
  const after  = (offset: number) =>
    neighborhood.filter(r => r.direction === 'after'  && r.step_offset === offset);

  const allSessions = neighborhood.length > 0
    ? Math.max(...neighborhood.map(r => r.sessions))
    : 1;

  const anchorColor = eventColor(anchorEvent);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

      {/* Anchor selector */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 10, padding: '1rem 1.25rem',
        display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
          Anchor event
        </span>
        <select
          value={anchorEvent}
          onChange={e => onAnchorChange(e.target.value)}
          style={{
            padding: '0.35rem 0.6rem',
            fontSize: '0.78rem', fontFamily: 'var(--font-mono)',
            background: 'var(--bg)', color: 'var(--text)',
            border: '1px solid var(--border)', borderRadius: 6,
            minWidth: 240, cursor: 'pointer',
          }}
        >
          <option value="">Select an event…</option>
          {topEvents.map(e => (
            <option key={e.label} value={e.label}>{shortLabel(e.label)} ({e.cnt.toLocaleString()})</option>
          ))}
        </select>
        {anchorEvent && totalAnchorSessions > 0 && (
          <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)', marginLeft: 8 }}>
            {totalAnchorSessions.toLocaleString()} sessions in period
          </span>
        )}
        <span style={{ fontSize: '0.65rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>
          3 steps before · 3 steps after · top 8 events per step
        </span>
      </div>

      {!anchorEvent ? (
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10,
          padding: '4rem', textAlign: 'center',
          color: 'var(--muted)', fontSize: '0.85rem', fontFamily: 'var(--font-mono)',
        }}>
          Select an anchor event above to explore its context
        </div>
      ) : loading ? (
        <Spinner />
      ) : (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '1.5rem', overflowX: 'auto' }}>

          {/* Butterfly grid */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 900 }}>

            {/* Before columns — offset 3, 2, 1 */}
            <NeighborhoodColumn label="3 steps before" events={before(3)} maxSessions={allSessions} />
            <ArrowDivider direction="right" />
            <NeighborhoodColumn label="2 steps before" events={before(2)} maxSessions={allSessions} />
            <ArrowDivider direction="right" />
            <NeighborhoodColumn label="1 step before"  events={before(1)} maxSessions={allSessions} />

            {/* Arrow in */}
            <ArrowDivider direction="right" />

            {/* Anchor box */}
            <div style={{
              flex: '0 0 140px',
              background: anchorColor + '15',
              border: `2px solid ${anchorColor}`,
              borderRadius: 10,
              padding: '1rem 0.75rem',
              textAlign: 'center',
              alignSelf: 'flex-start',
            }}>
              <div style={{
                width: 10, height: 10, borderRadius: '50%',
                background: anchorColor, margin: '0 auto 8px',
              }} />
              <div style={{
                fontSize: '0.7rem', fontFamily: 'var(--font-mono)',
                fontWeight: 700, color: anchorColor,
                wordBreak: 'break-word', lineHeight: 1.4, marginBottom: 8,
              }}>
                {shortLabel(anchorEvent)}
              </div>
              {totalAnchorSessions > 0 && (
                <div style={{ fontSize: '0.62rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
                  {totalAnchorSessions.toLocaleString()}<br />sessions
                </div>
              )}
            </div>

            {/* Arrow out */}
            <ArrowDivider direction="right" />

            {/* After columns — offset 1, 2, 3 */}
            <NeighborhoodColumn label="1 step after"   events={after(1)} maxSessions={allSessions} />
            <ArrowDivider direction="right" />
            <NeighborhoodColumn label="2 steps after"  events={after(2)} maxSessions={allSessions} />
            <ArrowDivider direction="right" />
            <NeighborhoodColumn label="3 steps after"  events={after(3)} maxSessions={allSessions} />
          </div>

          {neighborhood.length === 0 && (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--muted)', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
              No neighboring events found for this anchor in the selected period
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ArrowDivider({ direction }: { direction: 'left' | 'right' }) {
  return (
    <div style={{
      flex: '0 0 20px', display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--muted)', fontSize: '0.75rem', paddingTop: 24, alignSelf: 'flex-start',
    }}>
      {direction === 'right' ? '→' : '←'}
    </div>
  );
}

// ── Main page component ───────────────────────────────────────────────────────

export default function PathsClient() {
  const [tab,       setTab]       = useState<Tab>('sequences');
  const [period,    setPeriod]    = useState<Period>('7D');
  const [startFilter, setStartFilter] = useState('');
  const [anchorEvent, setAnchorEvent] = useState('');

  const [sequences,   setSequences]   = useState<SequenceRow[]>([]);
  const [neighborhood, setNeighborhood] = useState<NeighborhoodRow[]>([]);
  const [topEvents,   setTopEvents]   = useState<TopEvent[]>([]);
  const [anchorTotal, setAnchorTotal] = useState(0);

  const [seqLoading, setSeqLoading] = useState(false);
  const [nbLoading,  setNbLoading]  = useState(false);
  const [evLoading,  setEvLoading]  = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  // Fetch top events whenever period changes
  useEffect(() => {
    const { from, to } = getRange(period);
    setEvLoading(true);
    fetch(`/api/analytics/top-events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then(r => r.json())
      .then(d => { setTopEvents(Array.isArray(d) ? d : []); setEvLoading(false); })
      .catch(() => setEvLoading(false));
  }, [period]);

  // Fetch sequences when on sequences tab, or period/filter changes
  const fetchSequences = useCallback((p: Period, start: string) => {
    const { from, to } = getRange(p);
    setSeqLoading(true);
    const url = `/api/analytics/sequences?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${start ? `&start=${encodeURIComponent(start)}` : ''}`;
    fetch(url)
      .then(r => r.json())
      .then(d => { setSequences(Array.isArray(d) ? d : []); setSeqLoading(false); })
      .catch(() => setSeqLoading(false));
  }, []);

  useEffect(() => {
    if (tab === 'sequences') fetchSequences(period, startFilter);
  }, [tab, period, startFilter, fetchSequences]);

  // Fetch neighborhood when anchor is selected
  const fetchNeighborhood = useCallback((anchor: string, p: Period) => {
    if (!anchor) { setNeighborhood([]); setAnchorTotal(0); return; }
    const { from, to } = getRange(p);
    setNbLoading(true);
    fetch(`/api/analytics/neighborhood?anchor=${encodeURIComponent(anchor)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .then(r => r.json())
      .then(d => {
        const rows: NeighborhoodRow[] = Array.isArray(d) ? d : [];
        setNeighborhood(rows);
        // anchor total = max sessions at step_offset 1 (closest step)
        const closest = rows.filter(r => r.step_offset === 1);
        const maxClose = closest.length > 0 ? Math.max(...closest.map(r => r.sessions)) : 0;
        // estimate from pct: sessions / pct * 100 for any row
        if (rows.length > 0) {
          const ref = rows[0];
          setAnchorTotal(ref.pct > 0 ? Math.round(ref.sessions / ref.pct * 100) : 0);
        } else {
          setAnchorTotal(0);
        }
        setNbLoading(false);
      })
      .catch(() => setNbLoading(false));
  }, []);

  useEffect(() => {
    if (tab === 'explorer') fetchNeighborhood(anchorEvent, period);
  }, [tab, anchorEvent, period, fetchNeighborhood]);

  // Switch tab handler
  const handleTabChange = (t: Tab) => {
    setTab(t);
    if (t === 'sequences' && sequences.length === 0 && !seqLoading) {
      fetchSequences(period, startFilter);
    }
    if (t === 'explorer' && anchorEvent) {
      fetchNeighborhood(anchorEvent, period);
    }
  };

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>

      {/* Header */}
      <div style={{
        background: '#1a1a2e', color: '#fff',
        padding: '1rem 2rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem', fontWeight: 400, margin: 0 }}>
            Path <em style={{ color: 'var(--accent)', fontStyle: 'italic' }}>Analysis</em>
          </h1>
          <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.45)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
            Discover how users actually move through your site
          </div>
        </div>
        <PeriodTabs value={period} onChange={p => { setPeriod(p); }} />
      </div>

      <div style={{ maxWidth: 1400, margin: '0 auto', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

        {/* Tab bar */}
        <div style={{
          display: 'flex', gap: 0,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, padding: 4, width: 'fit-content',
        }}>
          {([
            { key: 'sequences', label: 'Path Sequences' },
            { key: 'explorer',  label: 'Event Explorer' },
          ] as { key: Tab; label: string }[]).map(t => (
            <button key={t.key} onClick={() => handleTabChange(t.key)} style={{
              padding: '0.45rem 1.1rem',
              fontSize: '0.82rem', fontWeight: tab === t.key ? 600 : 400,
              background: tab === t.key ? '#1a1a2e' : 'transparent',
              color: tab === t.key ? '#fff' : 'var(--muted)',
              border: 'none', borderRadius: 7, cursor: 'pointer',
              transition: 'all 0.15s',
            }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'sequences' ? (
          <SequencesView
            sequences={sequences}
            loading={seqLoading}
            topEvents={topEvents}
            startFilter={startFilter}
            onStartChange={setStartFilter}
          />
        ) : (
          <ExplorerView
            neighborhood={neighborhood}
            anchorEvent={anchorEvent}
            loading={nbLoading}
            topEvents={topEvents}
            totalAnchorSessions={anchorTotal}
            onAnchorChange={setAnchorEvent}
          />
        )}

      </div>
    </div>
  );
}
