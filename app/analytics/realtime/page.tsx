'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import type { AnalyticsEvent } from '@/lib/analytics/client';

const REFRESH_INTERVAL = 30_000;
const BUCKET_MINUTES = 5;
const BUCKETS = 12; // 1 hour of 5-min buckets

function bucketLabel(i: number): string {
  const minsAgo = (BUCKETS - 1 - i) * BUCKET_MINUTES;
  if (minsAgo === 0) return 'now';
  return `-${minsAgo}m`;
}

function buildBuckets(events: AnalyticsEvent[]): number[] {
  const now = Date.now();
  const counts = new Array(BUCKETS).fill(0);
  for (const e of events) {
    const ts = new Date(e.created_at ?? e.timestamp ?? 0).getTime();
    const minsAgo = (now - ts) / 60_000;
    const bucket = BUCKETS - 1 - Math.floor(minsAgo / BUCKET_MINUTES);
    if (bucket >= 0 && bucket < BUCKETS) counts[bucket]++;
  }
  return counts;
}

export default function RealtimePage() {
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL / 1000);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch last 1 hour of events
      const endDate = new Date().toISOString().slice(0, 10);
      const res = await fetch(`/api/analytics?limit=500&end_date=${endDate}`);
      if (res.ok) {
        const data = await res.json();
        const arr: AnalyticsEvent[] = Array.isArray(data) ? data : (data.events ?? data.data ?? []);
        // Filter to last 60 minutes
        const cutoff = Date.now() - 60 * 60 * 1000;
        setEvents(arr.filter(e => new Date(e.created_at ?? e.timestamp ?? 0).getTime() > cutoff));
        setLastFetched(new Date());
        setCountdown(REFRESH_INTERVAL / 1000);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    timerRef.current = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const buckets = buildBuckets(events);
  const maxBucket = Math.max(...buckets, 1);

  const sessions = new Set(events.map(e => e.session_id).filter(Boolean)).size;
  const eventTypeCounts = new Map<string, number>();
  for (const e of events) {
    eventTypeCounts.set(e.event_type, (eventTypeCounts.get(e.event_type) ?? 0) + 1);
  }
  const topEvents = Array.from(eventTypeCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);

  return (
    <div style={{ padding: '2rem', maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700 }}>Real-time</h1>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          background: loading ? '#fef3c7' : '#dcfce7',
          color: loading ? '#92400e' : '#166534',
          border: `1px solid ${loading ? '#fcd34d' : '#86efac'}`,
          borderRadius: 20, padding: '0.2rem 0.6rem', fontSize: '0.75rem', fontWeight: 600,
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: loading ? '#f59e0b' : '#22c55e', display: 'inline-block' }} />
          {loading ? 'Loading…' : 'Live'}
        </span>
        <span style={{ color: 'var(--muted)', fontSize: '0.8rem', marginLeft: 'auto' }}>
          Refreshes in {countdown}s
          {lastFetched && ` · Last: ${lastFetched.toLocaleTimeString()}`}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: '1.5rem' }}>
        {[
          { label: 'Events (1hr)', value: events.length },
          { label: 'Sessions (1hr)', value: sessions },
        ].map(({ label, value }) => (
          <div key={label} style={{
            flex: 1, background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 12, padding: '1rem 1.25rem',
          }}>
            <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: '2rem', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Bucket bar chart */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.25rem', marginBottom: '1.25rem' }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '1rem' }}>Events per {BUCKET_MINUTES}-min window (last hour)</div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 80 }}>
          {buckets.map((count, i) => (
            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <div style={{
                width: '100%', background: i === BUCKETS - 1 ? '#22c55e' : '#1a1a2e',
                borderRadius: '3px 3px 0 0',
                height: count === 0 ? 2 : `${Math.round((count / maxBucket) * 70)}px`,
                minHeight: 2, opacity: 0.85,
              }} />
              <span style={{ fontSize: '0.58rem', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                {bucketLabel(i)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Recent events stream */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.25rem', marginBottom: '1.25rem' }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.75rem' }}>Recent Events</div>
        <div style={{ maxHeight: 280, overflowY: 'auto' }}>
          <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Time', 'Event', 'Path', 'Device'].map(h => (
                  <th key={h} style={{ padding: '0.3rem 0.5rem', textAlign: 'left', color: 'var(--muted)', fontWeight: 600, borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, background: 'var(--surface)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.slice(0, 50).map((e, i) => (
                <tr key={i}>
                  <td style={{ padding: '0.3rem 0.5rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                    {new Date(e.created_at ?? e.timestamp ?? '').toLocaleTimeString()}
                  </td>
                  <td style={{ padding: '0.3rem 0.5rem', fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{e.event_type}</td>
                  <td style={{ padding: '0.3rem 0.5rem', color: 'var(--muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.page_path ?? '—'}</td>
                  <td style={{ padding: '0.3rem 0.5rem', color: 'var(--muted)', textTransform: 'capitalize' }}>{e.device_type ?? '—'}</td>
                </tr>
              ))}
              {events.length === 0 && !loading && (
                <tr><td colSpan={4} style={{ padding: '1rem', textAlign: 'center', color: 'var(--muted)' }}>No events in the last hour</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top event types */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.25rem' }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.75rem' }}>Event Types (1hr)</div>
        {topEvents.map(([type, count]) => (
          <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ flex: 1, fontSize: '0.82rem', fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{type}</span>
            <span style={{ fontSize: '0.82rem', color: 'var(--muted)', minWidth: 30, textAlign: 'right' }}>{count}</span>
            <div style={{ width: 100, height: 6, borderRadius: 3, background: '#e2e8f0' }}>
              <div style={{ height: 6, borderRadius: 3, background: '#1a1a2e', width: `${Math.round((count / (topEvents[0]?.[1] || 1)) * 100)}%` }} />
            </div>
          </div>
        ))}
        {topEvents.length === 0 && <p style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>No events</p>}
      </div>
    </div>
  );
}
