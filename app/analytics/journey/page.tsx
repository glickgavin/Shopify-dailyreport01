export const dynamic = 'force-dynamic';

import { resolveDateRange } from '@/lib/analytics/dateRange';
import { supabaseAdmin } from '@/lib/supabase';
import { dateToUTCRange } from '@/lib/analytics/dateRange';
import AnalyticsFilterBar from '@/components/analytics/AnalyticsFilterBar';
import type { Preset } from '@/lib/analytics/dateRange';
import type { AnalyticsEvent } from '@/lib/analytics/client';

interface Props {
  searchParams: Promise<{
    preset?: string; from?: string; to?: string;
    devices?: string; exclude_preview?: string;
    session_id?: string;
    sort?: string;
  }>;
}

interface SessionSummary {
  session_id: string;
  visitor_id?: string;
  email?: string;
  events: number;
  first_event: string;
  last_event: string;
  device: string;
  first_at: string;
  last_at: string;
  duration_s: number;
}

interface MirrorRow {
  id: string;
  event_name: string;
  event_category: string | null;
  session_id: string | null;
  user_id: string | null;
  properties: Record<string, unknown> | null;
  page_url: string | null;
  page_path: string | null;
  referrer: string | null;
  user_agent: string | null;
  device_type: string | null;
  created_at: string;
  magic_id: string | null;
  click_id: string | null;
  email: string | null;
}

function toEvent(r: MirrorRow): AnalyticsEvent {
  return {
    id: r.id,
    event_type: r.event_name,
    event_name: r.event_name,
    event_category: r.event_category ?? null,
    session_id: r.session_id ?? undefined,
    visitor_id: r.user_id ?? undefined,
    email: r.email ?? null,
    properties: r.properties ?? undefined,
    page_url: r.page_url ?? undefined,
    page_path: r.page_path ?? undefined,
    referrer: r.referrer ?? null,
    device_type: r.device_type ?? null,
    created_at: r.created_at,
  };
}

const SORT_COLS: Record<string, (a: SessionSummary, b: SessionSummary) => number> = {
  started:  (a, b) => new Date(b.first_at).getTime() - new Date(a.first_at).getTime(),
  events:   (a, b) => b.events - a.events,
  duration: (a, b) => b.duration_s - a.duration_s,
  session:  (a, b) => a.session_id.localeCompare(b.session_id),
  email:    (a, b) => (a.email ?? '').localeCompare(b.email ?? ''),
};

export default async function UserJourneyPage({ searchParams }: Props) {
  const sp = await searchParams;
  const { startDate, endDate, preset, label } = resolveDateRange(sp.preset, sp.from, sp.to);
  const devices        = sp.devices ? sp.devices.split(',').filter(Boolean) : [];
  const excludePreview = sp.exclude_preview === 'true';
  const focusSession   = sp.session_id;
  const sortKey        = sp.sort ?? 'started';

  const { from, to } = dateToUTCRange(startDate, endDate);

  let events: AnalyticsEvent[] = [];
  let error: string | null = null;
  try {
    let q = supabaseAdmin
      .from('analytics_events_mirror')
      .select('*')
      .gte('created_at', from)
      .lte('created_at', to)
      .order('created_at', { ascending: false })
      .limit(10000);

    if (focusSession) q = q.eq('session_id', focusSession);

    const { data, error: dbErr } = await q;
    if (dbErr) throw dbErr;
    events = (data as MirrorRow[]).map(toEvent);
  } catch (e) {
    error = String(e);
  }

  const filtered = events
    .filter(e => !excludePreview || !e.is_preview)
    .filter(e => !devices.length || (e.device_type && devices.includes(e.device_type)));

  // Build session map
  const sessionMap = new Map<string, AnalyticsEvent[]>();
  for (const e of filtered) {
    const sid = e.session_id ?? 'unknown';
    const arr = sessionMap.get(sid) ?? [];
    arr.push(e);
    sessionMap.set(sid, arr);
  }

  const fmtDuration = (s: number) => {
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  };

  // Build session summaries
  const sessions: SessionSummary[] = Array.from(sessionMap.entries())
    .map(([sid, evts]) => {
      const sorted = evts.slice().sort((a, b) =>
        new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime()
      );
      const firstAt  = sorted[0]?.created_at ?? '';
      const lastAt   = sorted[sorted.length - 1]?.created_at ?? '';
      const durationS = firstAt && lastAt
        ? Math.round((new Date(lastAt).getTime() - new Date(firstAt).getTime()) / 1000)
        : 0;
      return {
        session_id: sid,
        visitor_id: sorted[0]?.visitor_id,
        email: evts.find(e => e.email)?.email ?? undefined,
        events: evts.length,
        first_event: sorted[0]?.event_type ?? '—',
        last_event: sorted[sorted.length - 1]?.event_type ?? '—',
        device: sorted[0]?.device_type ?? '—',
        first_at: firstAt,
        last_at: lastAt,
        duration_s: durationS,
      };
    })
    .sort(SORT_COLS[sortKey] ?? SORT_COLS.started);

  // Focused session detail
  const focusedEvents = focusSession
    ? (sessionMap.get(focusSession) ?? []).sort((a, b) =>
        new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime()
      )
    : [];

  const totalEvents   = filtered.length;
  const totalSessions = sessions.length;
  const avgEventsPerSession = totalSessions > 0 ? (totalEvents / totalSessions).toFixed(1) : '—';
  const avgDuration = totalSessions > 0
    ? fmtDuration(Math.round(sessions.reduce((s, x) => s + x.duration_s, 0) / totalSessions))
    : '—';

  // Build sort link helper
  function sortHref(col: string) {
    const p = new URLSearchParams();
    if (sp.preset)         p.set('preset', sp.preset);
    if (sp.from)           p.set('from', sp.from);
    if (sp.to)             p.set('to', sp.to);
    if (sp.devices)        p.set('devices', sp.devices);
    if (sp.exclude_preview) p.set('exclude_preview', sp.exclude_preview);
    if (sp.session_id)     p.set('session_id', sp.session_id);
    p.set('sort', col);
    return `/analytics/journey?${p.toString()}`;
  }

  const thBase: React.CSSProperties = {
    padding: '0.5rem 0.75rem', textAlign: 'left', color: 'var(--muted)',
    fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase',
    letterSpacing: '0.05em', position: 'sticky', top: 0, background: 'var(--surface)',
    whiteSpace: 'nowrap',
  };

  const colDefs: { label: string; sortCol?: string }[] = [
    { label: 'Started',     sortCol: 'started' },
    { label: 'Events',      sortCol: 'events' },
    { label: 'Duration',    sortCol: 'duration' },
    { label: 'Device' },
    { label: 'First Event' },
    { label: 'Session ID',  sortCol: 'session' },
    { label: 'Email',       sortCol: 'email' },
  ];

  return (
    <div style={{ padding: '2rem', maxWidth: 1400 }}>
      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: 4 }}>User Journey</h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>{label}</p>
      </div>

      <AnalyticsFilterBar
        preset={preset as Preset}
        from={sp.from}
        to={sp.to}
        devices={devices}
        excludePreview={excludePreview}
      />

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, margin: '1rem 0' }}>
        {[
          { label: 'Total Sessions',   value: totalSessions.toLocaleString() },
          { label: 'Total Events',     value: totalEvents.toLocaleString() },
          { label: 'Events / Session', value: avgEventsPerSession },
          { label: 'Avg Duration',     value: avgDuration },
        ].map(({ label: lbl, value }) => (
          <div key={lbl} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '0.875rem 1rem' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: '0.4rem' }}>{lbl}</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text)' }}>{value}</div>
          </div>
        ))}
      </div>

      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, padding: '0.75rem 1rem', color: '#991b1b', fontSize: '0.85rem' }}>{error}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: focusSession ? '3fr 2fr' : '1fr', gap: 16, marginTop: '1.5rem' }}>
        {/* Session list */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', fontSize: '0.85rem', fontWeight: 600 }}>
            Sessions
            <span style={{ fontSize: '0.75rem', color: 'var(--muted)', fontWeight: 400, marginLeft: 8 }}>{sessions.length.toLocaleString()} total</span>
          </div>
          <div style={{ maxHeight: 560, overflowY: 'auto', overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse', minWidth: 700 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {colDefs.map(({ label: h, sortCol }) => (
                    <th key={h} style={thBase}>
                      {sortCol ? (
                        <a
                          href={sortHref(sortCol)}
                          style={{ color: sortKey === sortCol ? 'var(--text)' : 'var(--muted)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                        >
                          {h}
                          {sortKey === sortCol && <span style={{ fontSize: '0.65rem' }}>▼</span>}
                        </a>
                      ) : h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessions.slice(0, 200).map(s => (
                  <tr
                    key={s.session_id}
                    style={{ borderBottom: '1px solid var(--border)', background: focusSession === s.session_id ? 'rgba(26,26,46,0.05)' : 'transparent', cursor: 'pointer' }}
                  >
                    <td style={{ padding: '0.5rem 0.75rem' }}>
                      <a
                        href={`/analytics/journey?preset=${sp.preset ?? '7d'}&session_id=${s.session_id}&sort=${sortKey}`}
                        style={{ color: 'var(--text)', textDecoration: 'none', fontFamily: 'var(--font-mono)', fontSize: '0.73rem' }}
                      >
                        {s.first_at ? new Date(s.first_at).toLocaleString() : '—'}
                      </a>
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', color: 'var(--muted)' }}>{s.events}</td>
                    <td style={{ padding: '0.5rem 0.75rem', color: 'var(--muted)' }}>{fmtDuration(s.duration_s)}</td>
                    <td style={{ padding: '0.5rem 0.75rem', color: 'var(--muted)', textTransform: 'capitalize' }}>{s.device}</td>
                    <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>{s.first_event}</td>
                    <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--muted)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.session_id}>
                      {s.session_id.length > 12 ? s.session_id.slice(0, 12) + '…' : s.session_id}
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.75rem', color: 'var(--muted)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.email}>
                      {s.email ?? <span style={{ opacity: 0.4 }}>—</span>}
                    </td>
                  </tr>
                ))}
                {sessions.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>No sessions</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Session detail / timeline */}
        {focusSession && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', fontSize: '0.85rem', fontWeight: 600 }}>
              Session Timeline
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--muted)', marginLeft: 8, wordBreak: 'break-all' }}>{focusSession}</span>
            </div>
            <div style={{ padding: '0.75rem 1rem', maxHeight: 560, overflowY: 'auto' }}>
              {focusedEvents.length === 0 ? (
                <p style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>No events</p>
              ) : (
                <div style={{ position: 'relative', paddingLeft: 20 }}>
                  <div style={{ position: 'absolute', left: 8, top: 0, bottom: 0, width: 2, background: 'var(--border)' }} />
                  {focusedEvents.map((e, i) => {
                    const prevTs = i > 0 ? new Date(focusedEvents[i - 1].created_at ?? 0).getTime() : null;
                    const thisTs = new Date(e.created_at ?? 0).getTime();
                    const gapS   = prevTs ? Math.round((thisTs - prevTs) / 1000) : null;
                    const revenue = e.properties?.total_value as number | undefined;
                    return (
                      <div key={i} style={{ marginBottom: '0.75rem', position: 'relative' }}>
                        <div style={{ position: 'absolute', left: -16, top: 4, width: 10, height: 10, borderRadius: '50%', background: '#1a1a2e', border: '2px solid var(--surface)' }} />
                        {gapS !== null && gapS > 0 && (
                          <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginBottom: 2 }}>+{fmtDuration(gapS)}</div>
                        )}
                        <div style={{ fontSize: '0.8rem', fontWeight: 600, fontFamily: 'var(--font-mono)', display: 'flex', gap: 8, alignItems: 'center' }}>
                          {e.event_type}
                          {revenue != null && revenue > 0 && (
                            <span style={{ color: '#1D9E75', fontSize: '0.75rem', fontWeight: 600 }}>${revenue.toFixed(2)}</span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                          {e.page_path ?? '—'}
                          {e.device_type && ` · ${e.device_type}`}
                        </div>
                        {e.email && (
                          <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>{e.email}</div>
                        )}
                        <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                          {e.created_at ? new Date(e.created_at).toLocaleTimeString() : '—'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
