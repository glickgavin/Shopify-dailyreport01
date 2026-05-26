export const dynamic = 'force-dynamic';

import { resolveDateRange } from '@/lib/analytics/dateRange';
import { supabaseAdmin } from '@/lib/supabase';
import AnalyticsFilterBar from '@/components/analytics/AnalyticsFilterBar';
import type { Preset } from '@/lib/analytics/dateRange';
import type { AnalyticsEvent } from '@/lib/analytics/client';
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
  const activeType     = sp.event_type ?? '';

  const from = startDate;
  const to   = endDate + 'T23:59:59.999Z';

  let events: AnalyticsEvent[] = [];
  let allTypes: string[] = [];
  let error: string | null = null;

  try {
    // ── 1. Distinct event names (lean query — just the name column) ────────
    // Default Supabase limit of 1000 rows is enough: with ~30 distinct types
    // each appearing 100+ times, all names appear in the first 1000 rows.
    const { data: typeRows } = await supabaseAdmin
      .from('analytics_events_mirror')
      .select('event_name')
      .gte('created_at', from)
      .lte('created_at', to);
    allTypes = Array.from(new Set((typeRows ?? []).map(r => r.event_name))).sort();

    // ── 2. Events — server-side filtered when a type is active ─────────────
    // When activeType is set (via URL pill click), paginate to get ALL events
    // of that type so the count is accurate.
    // When no filter, return the most recent 5,000 events for overview.
    const { fetchEventsLocal, fetchAllEventsLocal } = await import('@/lib/analytics/queries');
    if (activeType) {
      events = await fetchAllEventsLocal({ startDate: from, endDate, eventType: activeType });
    } else {
      events = await fetchEventsLocal({ startDate: from, endDate, limit: 5000 });
    }
  } catch (e) {
    error = String(e);
  }

  // Apply device + preview filters server-side (URL-driven)
  const filtered = events
    .filter(e => !excludePreview || !e.is_preview)
    .filter(e => !devices.length || (e.device_type && devices.includes(e.device_type)));

  const countLabel = activeType
    ? `${filtered.length.toLocaleString()} ${activeType} events`
    : `${filtered.length.toLocaleString()} events (most recent)`;

  return (
    <div style={{ padding: '2rem', maxWidth: 1400 }}>
      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: 4 }}>Event Explorer</h1>
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>{label} · {countLabel}</p>
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
        activeType={activeType}
        searchParams={sp}
      />
    </div>
  );
}
