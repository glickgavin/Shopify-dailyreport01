'use client';
import { useState, useEffect, useCallback, useRef } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

type Period = 'yesterday' | '1D' | '3D' | '7D' | '30D';
type Tab = 'sequences' | 'explorer' | 'purchases';

const PERIOD_LABEL: Record<Period, string> = {
  yesterday: 'Yesterday', '1D': '1D', '3D': '3D', '7D': '7D', '30D': '30D',
};

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

interface EntryPageRow {
  first_page:    string;
  purchases:     number;
  total_revenue: number;
  avg_revenue:   number;
}

interface PreEventRow {
  step:        number;
  event_label: string;
  occurrences: number;
}

interface PurchasePathRow {
  path:      string;
  purchases: number;
}

interface SessionPathRow {
  path:      string;
  purchases: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PT = 'America/Los_Angeles';

// Returns the UTC Date corresponding to midnight on a given 'YYYY-MM-DD' Pacific date.
function ptMidnight(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  // Pacific is UTC-7 (PDT) or UTC-8 (PST). Try each offset until PT hour reads 0.
  for (const h of [7, 8]) {
    const candidate = new Date(Date.UTC(y, m - 1, d, h, 0, 0));
    const ptHour = parseInt(
      new Intl.DateTimeFormat('en-US', { timeZone: PT, hour: 'numeric', hour12: false }).format(candidate),
    );
    if (ptHour === 0) return candidate;
  }
  return new Date(Date.UTC(y, m - 1, d, 8, 0, 0));
}

function getRange(period: Period) {
  const now = new Date();
  if (period === 'yesterday') {
    // Use Pacific calendar dates so "yesterday" aligns with PT business day.
    const todayPT   = now.toLocaleDateString('en-CA', { timeZone: PT }); // 'YYYY-MM-DD'
    const [y, m, d] = todayPT.split('-').map(Number);
    const yestPT    = new Date(Date.UTC(y, m - 1, d - 1, 12))
                        .toLocaleDateString('en-CA', { timeZone: PT });
    return { from: ptMidnight(yestPT).toISOString(), to: ptMidnight(todayPT).toISOString() };
  }
  const days = period === '1D' ? 1 : period === '3D' ? 3 : period === '7D' ? 7 : 30;
  return { from: new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString(), to: now.toISOString() };
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
    <div style={{ display: 'flex', gap: 3 }}>
      {(['yesterday', '1D', '3D', '7D', '30D'] as Period[]).map(p => (
        <button key={p} onClick={() => onChange(p)} style={{
          padding: '0.3rem 0.7rem',
          fontSize: '0.75rem', fontFamily: 'var(--font-mono)',
          fontWeight: value === p ? 700 : 400,
          background: value === p ? '#1a1a2e' : 'transparent',
          color: value === p ? '#fff' : 'var(--muted)',
          border: `1px solid ${value === p ? '#1a1a2e' : 'var(--border)'}`,
          borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
        }}>
          {PERIOD_LABEL[p]}
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

function parseLabel(label: string): { primary: string; secondary: string | null } {
  if (label.startsWith('page_view: ')) {
    return { primary: label.slice('page_view: '.length) || '/', secondary: null };
  }
  const at = label.indexOf(' @ ');
  if (at > -1) return { primary: label.slice(0, at), secondary: label.slice(at + 3) };
  return { primary: label, secondary: null };
}

function StepBadge({ label }: { label: string | null }) {
  if (!label) return <span style={{ color: 'var(--muted)', fontSize: '0.72rem' }}>—</span>;
  const color = eventColor(label);
  const { primary, secondary } = parseLabel(label);
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      background: color + '18', border: `1px solid ${color}44`,
      borderRadius: 5, padding: '0.2rem 0.55rem',
      fontSize: '0.72rem', fontFamily: 'var(--font-mono)',
      color, maxWidth: 200, overflow: 'hidden',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{primary}</span>
        {secondary && (
          <span style={{ fontSize: '0.65em', opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {secondary}
          </span>
        )}
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
            <option key={e.label} value={e.label}>{e.label} ({e.cnt.toLocaleString()})</option>
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

function EventCard({ label, sessions, pct, maxSessions, onHide, featured }: {
  label: string; sessions: number; pct: number; maxSessions: number;
  /** When provided, renders a small × on hover that calls this with the label. */
  onHide?: (label: string) => void;
  /** Top event in the column — slightly larger and bolder. */
  featured?: boolean;
}) {
  const color = eventColor(label);
  const barWidth = maxSessions > 0 ? (sessions / maxSessions) * 100 : 0;
  return (
    <div
      className="path-event-card"
      style={{
        background: 'var(--surface2)',
        border: `1px solid ${featured ? color + '66' : color + '33'}`,
        borderLeft: `${featured ? 4 : 3}px solid ${color}`,
        borderRadius: 6,
        padding: featured ? '0.6rem 0.7rem' : '0.5rem 0.65rem',
        marginBottom: 5,
        position: 'relative',
        boxShadow: featured ? `0 1px 3px ${color}22` : 'none',
      }}>
      {onHide && (
        <button
          type="button"
          aria-label={`Hide ${label}`}
          title="Hide this event"
          onClick={() => onHide(label)}
          onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'var(--border)'; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '0.45'; e.currentTarget.style.background = 'transparent'; }}
          style={{
            position: 'absolute', top: 4, right: 4,
            width: 16, height: 16, padding: 0,
            border: 'none', borderRadius: 4,
            background: 'transparent', color: 'var(--muted)',
            fontSize: '0.85rem', lineHeight: 1, cursor: 'pointer',
            opacity: 0.45, transition: 'opacity 0.12s, background 0.12s',
          }}>
          ×
        </button>
      )}
      {(() => { const { primary, secondary } = parseLabel(label); return (
        <div style={{ marginBottom: 4, overflow: 'hidden', paddingRight: onHide ? 14 : 0 }}>
          <div style={{
            fontSize: featured ? '0.78rem' : '0.72rem',
            fontFamily: 'var(--font-mono)', color: 'var(--text)',
            fontWeight: featured ? 600 : 400,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{primary}</div>
          {secondary && <div style={{ fontSize: '0.62rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{secondary}</div>}
        </div>
      ); })()}
      <div style={{ height: featured ? 4 : 3, background: 'var(--border)', borderRadius: 2, marginBottom: 4, overflow: 'hidden' }}>
        <div style={{ width: `${barWidth}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.62rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
          {sessions.toLocaleString()} sessions
        </span>
        <span style={{ fontSize: featured ? '0.78rem' : '0.7rem', fontFamily: 'var(--font-mono)', fontWeight: 700, color }}>
          {pct}%
        </span>
      </div>
    </div>
  );
}

// ── Neighborhood column ───────────────────────────────────────────────────────

function NeighborhoodColumn({
  label, events, maxSessions, onHide,
}: {
  label: string;
  events: NeighborhoodRow[];
  maxSessions: number;
  onHide?: (label: string) => void;
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
        events.map((e, i) => (
          <EventCard
            key={e.event_label}
            label={e.event_label}
            sessions={e.sessions}
            pct={e.pct}
            maxSessions={maxSessions}
            onHide={onHide}
            featured={i === 0}
          />
        ))
      )}
    </div>
  );
}

// ── Explorer view ─────────────────────────────────────────────────────────────

function ExplorerView({
  neighborhood, anchorEvent, loading, topEvents, totalAnchorSessions, onAnchorChange,
  hidden, onHide, onUnhide, onClearHidden,
}: {
  neighborhood: NeighborhoodRow[];
  anchorEvent: string;
  loading: boolean;
  topEvents: TopEvent[];
  totalAnchorSessions: number;
  onAnchorChange: (v: string) => void;
  hidden: string[];
  onHide: (label: string) => void;
  onUnhide: (label: string) => void;
  onClearHidden: () => void;
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
            <option key={e.label} value={e.label}>{e.label} ({e.cnt.toLocaleString()})</option>
          ))}
        </select>
        {anchorEvent && totalAnchorSessions > 0 && (
          <span style={{ fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)', marginLeft: 8 }}>
            {totalAnchorSessions.toLocaleString()} sessions in period
          </span>
        )}
        <span style={{ fontSize: '0.65rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginLeft: 'auto' }}>
          3 steps before · 3 steps after · top 5 events per step
        </span>
      </div>

      {/* Hidden events chips — only show when something is hidden */}
      {hidden.length > 0 && (
        <div style={{
          background: 'var(--surface)', border: '1px dashed var(--border)',
          borderRadius: 10, padding: '0.65rem 0.85rem',
          display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center',
        }}>
          <span style={{ fontSize: '0.65rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginRight: 4 }}>
            Hidden ({hidden.length})
          </span>
          {hidden.map(label => {
            const color = eventColor(label);
            return (
              <button
                key={label}
                type="button"
                onClick={() => onUnhide(label)}
                title="Restore this event"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '0.2rem 0.5rem',
                  background: color + '12', border: `1px solid ${color}33`,
                  borderRadius: 5, cursor: 'pointer',
                  fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color,
                  maxWidth: 240,
                }}
              >
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortLabel(label)}</span>
                <span style={{ marginLeft: 4, opacity: 0.7, fontWeight: 700 }}>×</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={onClearHidden}
            style={{
              marginLeft: 'auto',
              padding: '0.2rem 0.55rem',
              background: 'transparent', border: '1px solid var(--border)',
              borderRadius: 5, cursor: 'pointer',
              fontSize: '0.65rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)',
            }}
          >
            Clear all
          </button>
        </div>
      )}

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
            <NeighborhoodColumn label="3 steps before" events={before(3)} maxSessions={allSessions} onHide={onHide} />
            <ArrowDivider direction="right" />
            <NeighborhoodColumn label="2 steps before" events={before(2)} maxSessions={allSessions} onHide={onHide} />
            <ArrowDivider direction="right" />
            <NeighborhoodColumn label="1 step before"  events={before(1)} maxSessions={allSessions} onHide={onHide} />

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
            <NeighborhoodColumn label="1 step after"   events={after(1)} maxSessions={allSessions} onHide={onHide} />
            <ArrowDivider direction="right" />
            <NeighborhoodColumn label="2 steps after"  events={after(2)} maxSessions={allSessions} onHide={onHide} />
            <ArrowDivider direction="right" />
            <NeighborhoodColumn label="3 steps after"  events={after(3)} maxSessions={allSessions} onHide={onHide} />
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

// ── Purchases view ────────────────────────────────────────────────────────────

function PurchasesView({
  entryPages, preEvents, paths, sessionPaths, loading, attribution, onAttributionChange,
}: {
  entryPages:          EntryPageRow[];
  preEvents:           PreEventRow[];
  paths:               PurchasePathRow[];
  sessionPaths:        SessionPathRow[];
  loading:             boolean;
  attribution:         Attribution;
  onAttributionChange: (a: Attribution) => void;
}) {
  if (loading) return <Spinner />;

  const maxRevenue    = entryPages[0]?.total_revenue ?? 0;
  const maxPaths      = paths[0]?.purchases ?? 0;
  const totalPurchases = entryPages.reduce((s, r) => s + r.purchases, 0);
  const totalRevenue   = entryPages.reduce((s, r) => s + Number(r.total_revenue), 0);
  const blendedAOV     = totalPurchases > 0 ? totalRevenue / totalPurchases : 0;

  // Group pre-events by step
  const steps = [1, 2, 3, 4, 5];
  const byStep = (s: number) => preEvents.filter(r => r.step === s);
  const maxOcc  = Math.max(...preEvents.map(r => r.occurrences), 1);

  const empty = (
    <div style={{
      padding: '3rem', textAlign: 'center',
      color: 'var(--muted)', fontSize: '0.8rem', fontFamily: 'var(--font-mono)',
    }}>
      No purchase data for this period
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

      {/* ── Entry pages ──────────────────────────────────────────────────── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 600 }}>Entry Pages</span>
          <span style={{ fontSize: '0.7rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
            {attribution === 'last_touch'
              ? 'first page of the session immediately before purchase'
              : 'first page ever recorded for that email (cross-session)'}
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 7, padding: 3, gap: 2 }}>
            {(['last_touch', 'first_touch'] as Attribution[]).map(a => (
              <button key={a} onClick={() => onAttributionChange(a)} style={{
                padding: '0.28rem 0.65rem',
                fontSize: '0.7rem', fontFamily: 'var(--font-mono)',
                fontWeight: attribution === a ? 700 : 400,
                background: attribution === a ? '#1a1a2e' : 'transparent',
                color: attribution === a ? '#fff' : 'var(--muted)',
                border: 'none', borderRadius: 5, cursor: 'pointer', whiteSpace: 'nowrap',
              }}>
                {a === 'last_touch' ? 'Last touch' : 'First touch'}
              </button>
            ))}
          </div>
        </div>
        {entryPages.length === 0 ? empty : (() => {
          const NO_SESSION = '(no browser session)';
          const mainRows   = entryPages.filter(r => r.first_page !== NO_SESSION);
          const noSession  = entryPages.find(r => r.first_page === NO_SESSION);
          return (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--surface2)', borderBottom: '1px solid var(--border)' }}>
                  {['#', 'First Page', 'Purchases', 'Revenue', 'AOV'].map((h, i) => (
                    <th key={h} style={{
                      padding: '0.55rem 1rem', textAlign: i >= 2 ? 'right' : 'left',
                      fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)',
                      fontWeight: 500, whiteSpace: 'nowrap',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mainRows.map((row, i) => (
                  <tr key={row.first_page} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'var(--surface2)' }}>
                    <td style={{ padding: '0.5rem 1rem', fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)', width: 36 }}>{i + 1}</td>
                    <td style={{ padding: '0.5rem 1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{
                          height: 4, width: Math.max(4, (row.total_revenue / maxRevenue) * 120),
                          background: '#3b82f6', borderRadius: 2, flexShrink: 0,
                        }} />
                        <span style={{ fontSize: '0.78rem', fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                          {row.first_page}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: '0.5rem 1rem', textAlign: 'right', fontSize: '0.78rem', fontFamily: 'var(--font-mono)' }}>{row.purchases.toLocaleString()}</td>
                    <td style={{ padding: '0.5rem 1rem', textAlign: 'right', fontSize: '0.78rem', fontFamily: 'var(--font-mono)', color: '#16a34a', fontWeight: 600 }}>
                      ${Number(row.total_revenue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: '0.5rem 1rem', textAlign: 'right', fontSize: '0.78rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
                      ${Number(row.avg_revenue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
                {noSession && (
                  <tr style={{ borderTop: '1px dashed var(--border)', background: 'var(--surface2)', opacity: 0.7 }}>
                    <td style={{ padding: '0.5rem 1rem', fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)', width: 36 }}>—</td>
                    <td style={{ padding: '0.5rem 1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ height: 4, width: 4, background: 'var(--muted)', borderRadius: 2, flexShrink: 0 }} />
                        <span style={{ fontSize: '0.78rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)', fontStyle: 'italic' }}>
                          {NO_SESSION}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: '0.5rem 1rem', textAlign: 'right', fontSize: '0.78rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>{Number(noSession.purchases).toLocaleString()}</td>
                    <td style={{ padding: '0.5rem 1rem', textAlign: 'right', fontSize: '0.78rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
                      ${Number(noSession.total_revenue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: '0.5rem 1rem', textAlign: 'right', fontSize: '0.78rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
                      ${Number(noSession.avg_revenue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--surface2)' }}>
                  <td colSpan={2} style={{ padding: '0.55rem 1rem', fontSize: '0.72rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)', fontWeight: 600 }}>
                    Total
                  </td>
                  <td style={{ padding: '0.55rem 1rem', textAlign: 'right', fontSize: '0.78rem', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                    {totalPurchases.toLocaleString()}
                  </td>
                  <td style={{ padding: '0.55rem 1rem', textAlign: 'right', fontSize: '0.78rem', fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#16a34a' }}>
                    ${totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: '0.55rem 1rem', textAlign: 'right', fontSize: '0.78rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)', fontWeight: 600 }}>
                    ${blendedAOV.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          );
        })()}
      </div>

      {/* ── Pre-purchase events ──────────────────────────────────────────── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 600 }}>Pre-Purchase Journey</span>
          <span style={{ fontSize: '0.7rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>top events at each step immediately before purchase</span>
        </div>
        {preEvents.length === 0 ? empty : (
          <div style={{ overflowX: 'auto', padding: '1.25rem' }}>
            <div style={{ display: 'flex', gap: 8, minWidth: 700, alignItems: 'flex-start' }}>
              {steps.map(s => {
                const rows = byStep(s);
                return (
                  <div key={s} style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: '0.65rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)',
                      textAlign: 'center', marginBottom: 8, fontWeight: 600,
                    }}>
                      {s === 1 ? '1 step before' : `${s} steps before`}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {rows.length === 0 ? (
                        <div style={{ fontSize: '0.65rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', textAlign: 'center', padding: '1rem 0' }}>—</div>
                      ) : rows.map((r, ri) => {
                        const color = eventColor(r.event_label);
                        const barW  = Math.max(4, (r.occurrences / maxOcc) * 100);
                        const { primary, secondary } = parseLabel(r.event_label);
                        return (
                          <div key={ri} style={{
                            background: color + '12', border: `1px solid ${color}33`,
                            borderRadius: 6, padding: '0.4rem 0.5rem',
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
                              <span style={{ fontSize: '0.65rem', fontFamily: 'var(--font-mono)', color, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                                {primary}
                              </span>
                            </div>
                            {secondary && (
                              <div style={{ fontSize: '0.6rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginBottom: 3, paddingLeft: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {secondary}
                              </div>
                            )}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                              <div style={{ height: 3, width: `${barW}%`, background: color, borderRadius: 2, opacity: 0.6 }} />
                              <span style={{ fontSize: '0.6rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                                {r.occurrences.toLocaleString()}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {/* Purchase endpoint */}
              <div style={{ flex: '0 0 80px', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 22 }}>
                <div style={{ fontSize: '0.65rem', fontFamily: 'var(--font-mono)', color: '#16a34a', fontWeight: 700, marginBottom: 8, textAlign: 'center' }}>→ purchase</div>
                <div style={{
                  background: '#dcfce7', border: '2px solid #16a34a',
                  borderRadius: 8, padding: '0.5rem 0.4rem', textAlign: 'center',
                }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', margin: '0 auto 4px' }} />
                  <div style={{ fontSize: '0.62rem', fontFamily: 'var(--font-mono)', color: '#166534', fontWeight: 600 }}>order_placed</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Top paths (email-stitched) ───────────────────────────────────── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 600 }}>Top Paths to Purchase</span>
          <span style={{ fontSize: '0.7rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>last 5 events before order_placed · email-stitched · top 20</span>
        </div>
        {paths.length === 0 ? empty : (
          <div style={{ padding: '0.5rem 0' }}>
            {paths.map((row, i) => {
              const steps = row.path.split(' → ');
              const barW  = Math.max(4, (row.purchases / maxPaths) * 280);
              return (
                <div key={i} style={{
                  padding: '0.6rem 1.25rem',
                  borderBottom: i < paths.length - 1 ? '1px solid var(--border)' : 'none',
                  display: 'flex', alignItems: 'center', gap: '1rem',
                }}>
                  <span style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)', width: 20, flexShrink: 0 }}>{i + 1}</span>
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', minWidth: 0 }}>
                    {steps.map((step, si) => (
                      <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <StepBadge label={step} />
                        {si < steps.length - 1 && (
                          <span style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>→</span>
                        )}
                      </div>
                    ))}
                    <span style={{ fontSize: '0.65rem', color: 'var(--muted)', marginLeft: 2 }}>→</span>
                    <span style={{
                      fontSize: '0.65rem', fontFamily: 'var(--font-mono)', fontWeight: 700,
                      color: '#16a34a', background: '#dcfce7', border: '1px solid #bbf7d0',
                      borderRadius: 5, padding: '0.2rem 0.45rem',
                    }}>purchase</span>
                  </div>
                  <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{ width: barW, height: 4, background: '#16a34a', borderRadius: 2, opacity: 0.6 }} />
                    <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', fontWeight: 600, color: '#16a34a', width: 28, textAlign: 'right' }}>
                      {row.purchases}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Session paths to purchase ─────────────────────────────────────── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 600 }}>Session Paths to Purchase</span>
          <span style={{ fontSize: '0.7rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
            up to 10 events · within-session only · top 10 converting paths
          </span>
        </div>
        {sessionPaths.length === 0 ? empty : (() => {
          const maxSessions = sessionPaths[0]?.purchases ?? 1;
          return (
            <div style={{ padding: '0.5rem 0' }}>
              {sessionPaths.map((row, i) => {
                const steps = row.path.split(' → ');
                const barW  = Math.max(4, (row.purchases / maxSessions) * 280);
                return (
                  <div key={i} style={{
                    padding: '0.75rem 1.25rem',
                    borderBottom: i < sessionPaths.length - 1 ? '1px solid var(--border)' : 'none',
                  }}>
                    {/* Rank + count row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.7rem', fontFamily: 'var(--font-mono)', color: 'var(--muted)', width: 20, flexShrink: 0 }}>
                        {i + 1}
                      </span>
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: barW, height: 4, background: '#16a34a', borderRadius: 2, opacity: 0.55 }} />
                        <span style={{ fontSize: '0.8rem', fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#16a34a' }}>
                          {row.purchases} {row.purchases === 1 ? 'purchase' : 'purchases'}
                        </span>
                      </div>
                    </div>
                    {/* Path badges — wrapping row */}
                    <div style={{ paddingLeft: 28, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                      {steps.map((step, si) => (
                        <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <StepBadge label={step} />
                          {si < steps.length - 1 && (
                            <span style={{ fontSize: '0.65rem', color: 'var(--muted)' }}>→</span>
                          )}
                        </div>
                      ))}
                      <span style={{ fontSize: '0.65rem', color: 'var(--muted)', marginLeft: 2 }}>→</span>
                      <span style={{
                        fontSize: '0.65rem', fontFamily: 'var(--font-mono)', fontWeight: 700,
                        color: '#16a34a', background: '#dcfce7', border: '1px solid #bbf7d0',
                        borderRadius: 5, padding: '0.2rem 0.45rem',
                      }}>order_placed</span>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

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

// ── Settings persistence ──────────────────────────────────────────────────────
// All Path Analysis settings live under a single localStorage key so we read
// once on mount and write atomically on change. Schema is forward-compatible
// — unknown keys are ignored on read, missing keys fall back to defaults.

const SETTINGS_KEY = 'paths.settings.v1';

type Attribution = 'last_touch' | 'first_touch';

interface PersistedSettings {
  tab?: Tab;
  period?: Period;
  anchorEvent?: string;
  startFilter?: string;
  hidden?: string[];
  attribution?: Attribution;
}

function loadSettings(): PersistedSettings {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveSettings(s: PersistedSettings) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* quota / private mode — silently ignore */
  }
}

// ── Main page component ───────────────────────────────────────────────────────

export default function PathsClient() {
  const [tab,       setTab]       = useState<Tab>('sequences');
  const [period,    setPeriod]    = useState<Period>('yesterday');
  const [startFilter, setStartFilter] = useState('');
  const [anchorEvent, setAnchorEvent] = useState('');
  const [hidden,    setHidden]    = useState<string[]>([]);
  // Hydration flag: prevents writing the default state back to localStorage
  // before we've had a chance to read what's stored.
  const [hydrated,  setHydrated]  = useState(false);

  const [sequences,   setSequences]   = useState<SequenceRow[]>([]);
  const [neighborhood, setNeighborhood] = useState<NeighborhoodRow[]>([]);
  const [topEvents,   setTopEvents]   = useState<TopEvent[]>([]);
  const [anchorTotal, setAnchorTotal] = useState(0);

  const [entryPages,     setEntryPages]     = useState<EntryPageRow[]>([]);
  const [preEvents,      setPreEvents]      = useState<PreEventRow[]>([]);
  const [purchasePaths,  setPurchasePaths]  = useState<PurchasePathRow[]>([]);
  const [sessionPaths,   setSessionPaths]   = useState<SessionPathRow[]>([]);
  const [purchLoading,   setPurchLoading]   = useState(false);
  const [attribution,    setAttribution]    = useState<Attribution>('last_touch');

  const [seqLoading, setSeqLoading] = useState(false);
  const [nbLoading,  setNbLoading]  = useState(false);
  const [evLoading,  setEvLoading]  = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  // Hydrate from localStorage ONCE on mount.
  useEffect(() => {
    const s = loadSettings();
    if (s.tab === 'sequences' || s.tab === 'explorer' || s.tab === 'purchases') setTab(s.tab);
    if (s.period && (['yesterday','1D','3D','7D','30D'] as const).includes(s.period)) setPeriod(s.period);
    if (typeof s.anchorEvent === 'string') setAnchorEvent(s.anchorEvent);
    if (typeof s.startFilter === 'string') setStartFilter(s.startFilter);
    if (Array.isArray(s.hidden)) setHidden(s.hidden.filter((x): x is string => typeof x === 'string'));
    if (s.attribution === 'last_touch' || s.attribution === 'first_touch') setAttribution(s.attribution);
    setHydrated(true);
  }, []);

  // Persist whenever any tracked setting changes — only after hydration so
  // we don't overwrite the user's saved state with our initial defaults.
  useEffect(() => {
    if (!hydrated) return;
    saveSettings({ tab, period, anchorEvent, startFilter, hidden, attribution });
  }, [hydrated, tab, period, anchorEvent, startFilter, hidden, attribution]);

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

  // Fetch neighborhood when anchor, period, or hidden list changes. Hiding
  // an event re-runs the query with a longer exclude list so the next-most-
  // common event slides into the freed slot.
  const fetchNeighborhood = useCallback((anchor: string, p: Period, excluded: string[]) => {
    if (!anchor) { setNeighborhood([]); setAnchorTotal(0); return; }
    const { from, to } = getRange(p);
    setNbLoading(true);
    const excludeParam = excluded.length > 0
      ? `&exclude=${encodeURIComponent(excluded.join(','))}`
      : '';
    fetch(`/api/analytics/neighborhood?anchor=${encodeURIComponent(anchor)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${excludeParam}`)
      .then(r => r.json())
      .then(d => {
        const rows: NeighborhoodRow[] = Array.isArray(d) ? d : [];
        setNeighborhood(rows);
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
    if (tab === 'explorer') fetchNeighborhood(anchorEvent, period, hidden);
  }, [tab, anchorEvent, period, hidden, fetchNeighborhood]);

  const fetchPurchases = useCallback((p: Period, attr: Attribution) => {
    const { from, to } = getRange(p);
    setPurchLoading(true);
    const qs = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    Promise.all([
      fetch(`/api/analytics/purchases/entry-pages?${qs}&attribution=${attr}`).then(r => r.json()),
      fetch(`/api/analytics/purchases/pre-events?${qs}`).then(r => r.json()),
      fetch(`/api/analytics/purchases/paths?${qs}`).then(r => r.json()),
      fetch(`/api/analytics/purchases/session-paths?${qs}`).then(r => r.json()),
    ]).then(([ep, pe, pp, sp]) => {
      setEntryPages(Array.isArray(ep) ? ep : []);
      setPreEvents(Array.isArray(pe) ? pe : []);
      setPurchasePaths(Array.isArray(pp) ? pp : []);
      setSessionPaths(Array.isArray(sp) ? sp : []);
      setPurchLoading(false);
    }).catch(() => setPurchLoading(false));
  }, []);

  useEffect(() => {
    if (tab === 'purchases') fetchPurchases(period, attribution);
  }, [tab, period, attribution, fetchPurchases]);

  // Switch tab handler
  const handleTabChange = (t: Tab) => {
    setTab(t);
    if (t === 'sequences' && sequences.length === 0 && !seqLoading) {
      fetchSequences(period, startFilter);
    }
    if (t === 'explorer' && anchorEvent) {
      fetchNeighborhood(anchorEvent, period, hidden);
    }
    if (t === 'purchases') {
      fetchPurchases(period, attribution);
    }
  };

  // Hidden-events handlers — keep the list de-duplicated and stable.
  const handleHide       = useCallback((label: string) => setHidden(h => h.includes(label) ? h : [...h, label]), []);
  const handleUnhide     = useCallback((label: string) => setHidden(h => h.filter(l => l !== label)), []);
  const handleClearHidden = useCallback(() => setHidden([]), []);

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
            { key: 'purchases', label: 'Purchases' },
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
        ) : tab === 'explorer' ? (
          <ExplorerView
            neighborhood={neighborhood}
            anchorEvent={anchorEvent}
            loading={nbLoading}
            topEvents={topEvents}
            totalAnchorSessions={anchorTotal}
            onAnchorChange={setAnchorEvent}
            hidden={hidden}
            onHide={handleHide}
            onUnhide={handleUnhide}
            onClearHidden={handleClearHidden}
          />
        ) : (
          <PurchasesView
            entryPages={entryPages}
            preEvents={preEvents}
            paths={purchasePaths}
            sessionPaths={sessionPaths}
            loading={purchLoading}
            attribution={attribution}
            onAttributionChange={a => { setAttribution(a); fetchPurchases(period, a); }}
          />
        )}

      </div>
    </div>
  );
}
