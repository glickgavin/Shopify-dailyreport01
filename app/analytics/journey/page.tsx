export const dynamic = 'force-dynamic';

import { fetchEventsDirect } from '@/lib/analytics/client';
import { resolveDateRange } from '@/lib/analytics/dateRange';
import AnalyticsFilterBar from '@/components/analytics/AnalyticsFilterBar';
import type { Preset } from '@/lib/analytics/dateRange';

interface Props {
  searchParams: Promise<{
    preset?: string; from?: string; to?: string;
    devices?: string; exclude_preview?: string;
    session_id?: string;
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

export default async function UserJourneyPage({ searchParams }: Props) {
  const sp = await searchParams;
  const { startDate, endDate, preset, label } = resolveDateRange(sp.preset, sp.from, sp.to);
  const devices = sp.devices ? sp.devices.split(',').filter(Boolean) : [];
  const excludePreview = sp.exclude_preview === 'true';
  const focusSession = sp.session_id;

  let events: Awaited<ReturnType<typeof fetchEventsDirect>> = [];
  let error: string | null = null;
  try {
    events = await fetchEventsDirect({
      startDate, endDate, limit: 5000,
      sessionId: focusSession || undefined,
    });
  } catch (e) {
    error = String(e);
  }

  const filtered = events
    .filter(e => !excludePreview || !e.is_preview)
    .filter(e => !devices.length || (e.device_type && devices.includes(e.device_type)));

  // Build session map
  const sessionMap = new Map<string, typeof filtered>();
  for (const e of filtered) {
    const sid = e.session_id ?? 'unknown';
    const arr = sessionMap.get(sid) ?? [];
    arr.push(e);
    sessionMap.set(sid, arr);
  }

  // Build session summaries
  const sessions: SessionSummary[] = Array.from(sessionMap.entries()).map(([sid, evts]) => {
    const sorted = evts.slice().sort((a, b) =>
      new Date(a.created_at ?? a.timestamp ?? 0).getTime() - new Date(b.created_at ?? b.timestamp ?? 0).getTime()
    );
    const firstAt = sorted[0]?.created_at ?? sorted[0]?.timestamp ?? '';
    const lastAt = sorted[sorted.length - 1]?.created_at ?? sorted[sorted.length - 1]?.timestamp ?? '';
    const durationS = firstAt && lastAt
      ? Math.round((new Date(lastAt).getTime() - new Date(firstAt).getTime()) / 1000)
      : 0;
    // Extract email from any event's properties (Shopify Pixel stores it on order_placed)
    const email = sorted.reduce<string | undefined>((found, e) => {
      if (found) return found;
      const p = e.properties as Record<string, unknown> | undefined;
      const v = p?.email ?? p?.customer_email ?? p?.['Email'];
      return typeof v === 'string' ? v : undefined;
    }, undefined);
    return {
      session_id: sid,
      visitor_id: sorted[0]?.visitor_id,
      email,
      events: evts.length,
      first_event: sorted[0]?.event_type ?? '—',
      last_event: sorted[sorted.length - 1]?.event_type ?? '—',
      device: sorted[0]?.device_type ?? '—',
      first_at: firstAt,
      last_at: lastAt,
      duration_s: durationS,
    };
  }).sort((a, b) => new Date(b.first_at).getTime() - new Date(a.first_at).getTime());

  // Focused session detail
  const focusedEvents = focusSession
    ? (sessionMap.get(focusSession) ?? []).sort((a, b) =>
        new Date(a.created_at ?? a.timestamp ?? 0).getTime() - new Date(b.created_at ?? b.timestamp ?? 0).getTime()
      )
    : [];

  const fmtDuration = (s: number) => {
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  };

  const totalEvents = filtered.length;
  const totalSessions = sessions.length;
  const avgEventsPerSession = totalSessions > 0 ? (totalEvents / totalSessions).toFixed(1) : '—';
  const avgDuration = totalSessions > 0
    ? fmtDuration(Math.round(sessions.reduce((s, x) => s + x.duration_s, 0) / totalSessions))
    : '—';

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
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, padding: '0.75rem 1rem', marginTop: '1rem', color: '#991b1b', fontSize: '0.85rem' }}>{error}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: focusSession ? '1fr 1fr' : '1fr', gap: 16, marginTop: '1.5rem' }}>
        {/* Session list */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', fontSize: '0.85rem', fontWeight: 600 }}>Sessions</div>
          <div style={{ maxHeight: 520, overflowY: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Started', 'Session ID', 'User', 'Events', 'Duration', 'Device', 'First Event'].map(h => (
                    <th key={h} style={{ padding: '0.5rem 0.75rem', textAlign: 'left', color: 'var(--muted)', fontWeight: 600, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', position: 'sticky', top: 0, background: 'var(--surface)', whiteSpace: 'nowrap' }}>{h}</th>
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
                        href={`/analytics/journey?preset=${sp.preset ?? '7d'}&session_id=${s.session_id}`}
                        style={{ color: 'var(--text)', textDecoration: 'none', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', whiteSpace: 'nowrap' }}
                      >
                        {s.first_at ? new Date(s.first_at).toLocaleString() : '—'}
                      </a>
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem' }}>
                      <span
                        title={s.session_id}
                        style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted)', cursor: 'default' }}
                      >
                        {s.session_id.slice(0, 8)}…
                      </span>
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', fontSize: '0.78rem', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.email ? (
                        <span title={s.email} style={{ color: 'var(--text)' }}>{s.email}</span>
                      ) : s.visitor_id ? (
                        <span title={s.visitor_id} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted)' }}>{s.visitor_id.slice(0, 10)}…</span>
                      ) : '—'}
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', color: 'var(--muted)' }}>{s.events}</td>
                    <td style={{ padding: '0.5rem 0.75rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmtDuration(s.duration_s)}</td>
                    <td style={{ padding: '0.5rem 0.75rem', color: 'var(--muted)', textTransform: 'capitalize' }}>{s.device}</td>
                    <td style={{ padding: '0.5rem 0.75rem', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>{s.first_event}</td>
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
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted)', marginLeft: 8 }}>{focusSession}</span>
            </div>
            <div style={{ padding: '0.75rem 1rem', maxHeight: 520, overflowY: 'auto' }}>
              {focusedEvents.length === 0 ? (
                <p style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>No events</p>
              ) : (
                <div style={{ position: 'relative', paddingLeft: 20 }}>
                  <div style={{ position: 'absolute', left: 8, top: 0, bottom: 0, width: 2, background: 'var(--border)' }} />
                  {focusedEvents.map((e, i) => {
                    const prevTs = i > 0 ? new Date(focusedEvents[i - 1].created_at ?? focusedEvents[i - 1].timestamp ?? 0).getTime() : null;
                    const thisTs = new Date(e.created_at ?? e.timestamp ?? 0).getTime();
                    const gapS = prevTs ? Math.round((thisTs - prevTs) / 1000) : null;
                    return (
                      <div key={i} style={{ marginBottom: '0.75rem', position: 'relative' }}>
                        <div style={{ position: 'absolute', left: -16, top: 4, width: 10, height: 10, borderRadius: '50%', background: '#1a1a2e', border: '2px solid var(--surface)' }} />
                        {gapS !== null && gapS > 0 && (
                          <div style={{ fontSize: '0.68rem', color: 'var(--muted)', marginBottom: 2 }}>+{fmtDuration(gapS)}</div>
                        )}
                        <div style={{ fontSize: '0.8rem', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{e.event_type}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                          {e.page_path ?? '—'}
                          {e.device_type && ` · ${e.device_type}`}
                        </div>
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
