export const dynamic = 'force-dynamic';

import { fetchEventsDirect } from '@/lib/analytics/client';
import { resolveDateRange } from '@/lib/analytics/dateRange';
import AnalyticsFilterBar from '@/components/analytics/AnalyticsFilterBar';
import type { Preset } from '@/lib/analytics/dateRange';
import EventTable from './EventTable';

interface Props {
  searchParams: Promise<{
    preset?: string; from?: string; to?: string;
    devices?: string; exclude_preview?: string;
    event_type?: string;
  }>;
}

export default async function EventExplorerPage({ searchParams }: Props) {
  const sp = await searchParams;
  const { startDate, endDate, preset, label } = resolveDateRange(sp.preset, sp.from, sp.to);
  const devices        = sp.devices ? sp.devices.split(',').filter(Boolean) : [];
  const excludePreview = sp.exclude_preview === 'true';
  const initialType    = sp.event_type ?? '';

  let events: Awaited<ReturnType<typeof fetchEventsDirect>> = [];
  let error: string | null = null;
  try {
    events = await fetchEventsDirect({ startDate, endDate, limit: 5000 });
  } catch (e) {
    error = String(e);
  }

  // Apply device + preview filters server-side (URL-driven)
  const filtered = events
    .filter(e => !excludePreview || !e.is_preview)
    .filter(e => !devices.length || (e.device_type && devices.includes(e.device_type)));

  const allTypes = Array.from(new Set(filtered.map(e => e.event_type))).sort();

  return (
    <div style={{ padding: '2rem', maxWidth: 1400 }}>
      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: 4 }}>Event Explorer</h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>{label} · {filtered.length.toLocaleString()} events</p>
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

      <EventTable
        events={filtered}
        allTypes={allTypes}
        initialType={initialType}
      />
    </div>
  );
}
