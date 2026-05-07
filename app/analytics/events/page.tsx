export const dynamic = 'force-dynamic';

import { fetchEventsDirect } from '@/lib/analytics/client';
import { resolveDateRange } from '@/lib/analytics/dateRange';
import AnalyticsFilterBar from '@/components/analytics/AnalyticsFilterBar';
import type { Preset } from '@/lib/analytics/dateRange';
import Link from 'next/link';

const PAGE_SIZE = 50;

interface Props {
  searchParams: Promise<{
    preset?: string; from?: string; to?: string;
    devices?: string; exclude_preview?: string;
    event_type?: string; page?: string;
  }>;
}

export default async function EventExplorerPage({ searchParams }: Props) {
  const sp = await searchParams;
  const { startDate, endDate, preset, label } = resolveDateRange(sp.preset, sp.from, sp.to);
  const devices = sp.devices ? sp.devices.split(',').filter(Boolean) : [];
  const excludePreview = sp.exclude_preview === 'true';
  const filterType = sp.event_type ?? '';
  const page = Math.max(1, parseInt(sp.page ?? '1'));

  let events: Awaited<ReturnType<typeof fetchEventsDirect>> = [];
  let error: string | null = null;
  try {
    events = await fetchEventsDirect({ startDate, endDate, limit: 5000, eventType: filterType || undefined });
  } catch (e) {
    error = String(e);
  }

  const filtered = events
    .filter(e => !excludePreview || !e.is_preview)
    .filter(e => !devices.length || (e.device_type && devices.includes(e.device_type)));

  // Distinct event types for filter dropdown
  const allTypes = Array.from(new Set(events.map(e => e.event_type))).sort();

  const totalCount = filtered.length;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const buildHref = (overrides: Record<string, string>) => {
    const params = new URLSearchParams({
      preset: sp.preset ?? '7d',
      ...(sp.from ? { from: sp.from } : {}),
      ...(sp.to ? { to: sp.to } : {}),
      ...(sp.devices ? { devices: sp.devices } : {}),
      ...(excludePreview ? { exclude_preview: 'true' } : {}),
      ...(filterType ? { event_type: filterType } : {}),
      page: String(page),
      ...overrides,
    });
    return `/analytics/events?${params.toString()}`;
  };

  return (
    <div style={{ padding: '2rem', maxWidth: 1100 }}>
      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: 4 }}>Event Explorer</h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>{label} · {totalCount.toLocaleString()} events</p>
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
          {error}
        </div>
      )}

      {/* Type filter */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '1rem 0' }}>
        <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>Event type:</span>
        <Link href={buildHref({ event_type: '', page: '1' })} style={{
          padding: '0.25rem 0.65rem', borderRadius: 6, fontSize: '0.78rem', textDecoration: 'none',
          background: !filterType ? '#1a1a2e' : 'var(--surface)',
          color: !filterType ? '#fff' : 'var(--muted)',
          border: `1px solid ${!filterType ? '#1a1a2e' : 'var(--border)'}`,
        }}>All</Link>
        {allTypes.slice(0, 12).map(t => (
          <Link key={t} href={buildHref({ event_type: t, page: '1' })} style={{
            padding: '0.25rem 0.65rem', borderRadius: 6, fontSize: '0.78rem', textDecoration: 'none',
            background: filterType === t ? '#1a1a2e' : 'var(--surface)',
            color: filterType === t ? '#fff' : 'var(--muted)',
            border: `1px solid ${filterType === t ? '#1a1a2e' : 'var(--border)'}`,
          }}>{t}</Link>
        ))}
      </div>

      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Time', 'Event Name', 'Category', 'Page Path', 'Device', 'Session'].map(h => (
                <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', color: 'var(--muted)', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.map((e, i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '0.6rem 1rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                  {e.created_at ? new Date(e.created_at).toLocaleString() : '—'}
                </td>
                <td style={{ padding: '0.6rem 1rem', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{e.event_type}</td>
                <td style={{ padding: '0.6rem 1rem' }}>
                  {e.event_category ? (
                    <span style={{ padding: '0.15rem 0.5rem', borderRadius: 4, background: '#e2e8f0', fontSize: '0.75rem', fontWeight: 500 }}>{e.event_category}</span>
                  ) : '—'}
                </td>
                <td style={{ padding: '0.6rem 1rem', color: 'var(--muted)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.page_path ?? '—'}</td>
                <td style={{ padding: '0.6rem 1rem', color: 'var(--muted)', textTransform: 'capitalize' }}>{e.device_type ?? '—'}</td>
                <td style={{ padding: '0.6rem 1rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.session_id ?? '—'}</td>
              </tr>
            ))}
            {paged.length === 0 && (
              <tr><td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted)' }}>No events found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: '1rem', alignItems: 'center' }}>
          {page > 1 && (
            <Link href={buildHref({ page: String(page - 1) })} style={{ padding: '0.4rem 0.9rem', borderRadius: 8, border: '1px solid var(--border)', textDecoration: 'none', color: 'var(--text)', background: 'var(--surface)', fontSize: '0.82rem' }}>← Prev</Link>
          )}
          <span style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>Page {page} of {totalPages}</span>
          {page < totalPages && (
            <Link href={buildHref({ page: String(page + 1) })} style={{ padding: '0.4rem 0.9rem', borderRadius: 8, border: '1px solid var(--border)', textDecoration: 'none', color: 'var(--text)', background: 'var(--surface)', fontSize: '0.82rem' }}>Next →</Link>
          )}
        </div>
      )}
    </div>
  );
}
