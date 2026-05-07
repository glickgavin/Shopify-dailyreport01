export const dynamic = 'force-dynamic';

import { fetchEventsDirect } from '@/lib/analytics/client';
import { resolveDateRange } from '@/lib/analytics/dateRange';
import { resolvePath, groupByPath } from '@/lib/analytics/paths';
import { resolveUtm, groupByUtmSource } from '@/lib/analytics/utm';
import AnalyticsFilterBar from '@/components/analytics/AnalyticsFilterBar';
import type { Preset } from '@/lib/analytics/dateRange';

interface Props {
  searchParams: Promise<{ preset?: string; from?: string; to?: string; devices?: string; exclude_preview?: string }>;
}

export default async function AnalyticsOverviewPage({ searchParams }: Props) {
  const sp = await searchParams;
  const { startDate, endDate, preset, label } = resolveDateRange(sp.preset, sp.from, sp.to);
  const devices = sp.devices ? sp.devices.split(',').filter(Boolean) : [];
  const excludePreview = sp.exclude_preview === 'true';

  let events: Awaited<ReturnType<typeof fetchEventsDirect>> = [];
  let error: string | null = null;
  try {
    events = await fetchEventsDirect({ startDate, endDate, limit: 5000 });
  } catch (e) {
    error = String(e);
  }

  const filtered = events
    .filter(e => !excludePreview || !e.is_preview)
    .filter(e => !devices.length || (e.device_type && devices.includes(e.device_type)));

  const totalEvents = filtered.length;
  const sessions = new Set(filtered.map(e => e.session_id).filter(Boolean)).size;
  const visitors = new Set(filtered.map(e => e.visitor_id).filter(Boolean)).size;
  const pageViews = filtered.filter(e => e.event_type === 'page_view' || e.event_type === 'pageview').length;

  // Top pages
  const pathMap = groupByPath(filtered);
  const topPages = Array.from(pathMap.entries())
    .map(([path, evts]) => ({ path, count: evts.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Top event types
  const eventTypeCounts = new Map<string, number>();
  for (const e of filtered) {
    eventTypeCounts.set(e.event_type, (eventTypeCounts.get(e.event_type) ?? 0) + 1);
  }
  const topEvents = Array.from(eventTypeCounts.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Traffic sources
  const utmMap = groupByUtmSource(filtered);
  const topSources = Array.from(utmMap.entries())
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  // Device breakdown
  const deviceCounts = new Map<string, number>();
  for (const e of filtered) {
    const d = e.device_type ?? 'unknown';
    deviceCounts.set(d, (deviceCounts.get(d) ?? 0) + 1);
  }

  // Events per day for mini chart
  const dayMap = new Map<string, number>();
  for (const e of filtered) {
    const day = (e.created_at ?? e.timestamp ?? '').slice(0, 10);
    if (day) dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
  }

  const statCard = (label: string, value: string | number) => (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '1.25rem 1.5rem', flex: 1, minWidth: 140,
    }}>
      <div style={{ fontSize: '0.78rem', color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: '1.75rem', fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
    </div>
  );

  return (
    <div style={{ padding: '2rem', maxWidth: 1100 }}>
      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: 4 }}>Analytics Overview</h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>{label}</p>
      </div>

      <AnalyticsFilterBar
        preset={preset as Preset}
        from={sp.from}
        to={sp.to}
        devices={devices}
        excludePreview={excludePreview}
      />

      {error && (
        <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, padding: '0.75rem 1rem', marginTop: '1rem', color: '#991b1b', fontSize: '0.85rem' }}>
          Failed to load analytics: {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '1.5rem 0 1.25rem' }}>
        {statCard('Total Events', totalEvents)}
        {statCard('Sessions', sessions)}
        {statCard('Visitors', visitors)}
        {statCard('Page Views', pageViews)}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Top Pages */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.25rem' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.75rem' }}>Top Pages</div>
          {topPages.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>No data</p>
          ) : (
            <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
              <tbody>
                {topPages.map(({ path, count }) => (
                  <tr key={path}>
                    <td style={{ padding: '0.3rem 0', color: 'var(--text)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{path}</td>
                    <td style={{ padding: '0.3rem 0', textAlign: 'right', color: 'var(--muted)' }}>{count.toLocaleString()}</td>
                    <td style={{ padding: '0.3rem 0 0.3rem 0.5rem', width: 80 }}>
                      <div style={{ height: 6, borderRadius: 3, background: '#e2e8f0' }}>
                        <div style={{ height: 6, borderRadius: 3, background: '#1a1a2e', width: `${Math.round((count / (topPages[0]?.count || 1)) * 100)}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Top Event Types */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.25rem' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.75rem' }}>Top Event Types</div>
          {topEvents.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>No data</p>
          ) : (
            <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
              <tbody>
                {topEvents.map(({ type, count }) => (
                  <tr key={type}>
                    <td style={{ padding: '0.3rem 0', color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{type}</td>
                    <td style={{ padding: '0.3rem 0', textAlign: 'right', color: 'var(--muted)' }}>{count.toLocaleString()}</td>
                    <td style={{ padding: '0.3rem 0 0.3rem 0.5rem', width: 80 }}>
                      <div style={{ height: 6, borderRadius: 3, background: '#e2e8f0' }}>
                        <div style={{ height: 6, borderRadius: 3, background: '#1a1a2e', width: `${Math.round((count / (topEvents[0]?.count || 1)) * 100)}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Traffic Sources */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.25rem' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.75rem' }}>Traffic Sources</div>
          {topSources.length === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>No data</p>
          ) : (
            <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
              <tbody>
                {topSources.map(({ source, count }) => (
                  <tr key={source}>
                    <td style={{ padding: '0.3rem 0', color: 'var(--text)' }}>{source}</td>
                    <td style={{ padding: '0.3rem 0', textAlign: 'right', color: 'var(--muted)' }}>{count.toLocaleString()}</td>
                    <td style={{ padding: '0.3rem 0 0.3rem 0.5rem', width: 80 }}>
                      <div style={{ height: 6, borderRadius: 3, background: '#e2e8f0' }}>
                        <div style={{ height: 6, borderRadius: 3, background: '#1a1a2e', width: `${Math.round((count / (topSources[0]?.count || 1)) * 100)}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Device Breakdown */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.25rem' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.75rem' }}>Devices</div>
          {deviceCounts.size === 0 ? (
            <p style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>No data</p>
          ) : (
            <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
              <tbody>
                {Array.from(deviceCounts.entries()).sort((a, b) => b[1] - a[1]).map(([device, count]) => (
                  <tr key={device}>
                    <td style={{ padding: '0.3rem 0', color: 'var(--text)', textTransform: 'capitalize' }}>{device}</td>
                    <td style={{ padding: '0.3rem 0', textAlign: 'right', color: 'var(--muted)' }}>{count.toLocaleString()}</td>
                    <td style={{ padding: '0.3rem 0 0.3rem 0.5rem', width: 80 }}>
                      <div style={{ height: 6, borderRadius: 3, background: '#e2e8f0' }}>
                        <div style={{ height: 6, borderRadius: 3, background: '#1a1a2e', width: `${Math.round((count / totalEvents) * 100)}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
