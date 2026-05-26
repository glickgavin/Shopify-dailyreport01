import { supabaseAdmin } from '@/lib/supabase';
import type { AnalyticsEvent, FetchOptions } from './client';
import { dateToUTCRange } from './dateRange';

// Convert a plain date string or a full UTC timestamp to a UTC start/end bound.
// Plain dates (YYYY-MM-DD) are treated as Pacific Time midnight / end-of-day.
// Full timestamps (contains 'T') are passed through unchanged.
function toUTCStart(s: string): string {
  return s.includes('T') ? s : dateToUTCRange(s).from;
}
function toUTCEnd(s: string): string {
  return s.includes('T') ? s : dateToUTCRange(s).to;
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
  synced_at: string;
}

function normalizeMirrorRow(r: MirrorRow): AnalyticsEvent {
  return {
    id: r.id,
    event_type: r.event_name,
    event_name: r.event_name,
    event_category: r.event_category ?? null,
    session_id: r.session_id ?? undefined,
    visitor_id: r.user_id ?? undefined,
    properties: r.properties ?? undefined,
    page_url: r.page_url ?? undefined,
    page_path: r.page_path ?? undefined,
    referrer: r.referrer ?? null,
    email: r.email ?? null,
    device_type: r.device_type ?? null,
    created_at: r.created_at,
  };
}

export async function fetchEventsLocal(opts: FetchOptions = {}): Promise<AnalyticsEvent[]> {
  const limit = Math.min(opts.limit ?? 1000, 5000);
  const offset = opts.offset ?? 0;

  let q = supabaseAdmin
    .from('analytics_events_mirror')
    .select('*')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limit - 1);

  if (opts.startDate) q = q.gte('created_at', toUTCStart(opts.startDate));
  if (opts.endDate)   q = q.lte('created_at', toUTCEnd(opts.endDate));
  if (opts.eventType) q = q.eq('event_name', opts.eventType);
  if (opts.pagePath)  q = q.eq('page_path', opts.pagePath);
  if (opts.deviceType) q = q.eq('device_type', opts.deviceType);
  if (opts.sessionId) q = q.eq('session_id', opts.sessionId);

  const { data, error } = await q;
  if (error) throw error;
  return (data as MirrorRow[]).map(normalizeMirrorRow);
}

export async function fetchAllEventsLocal(opts: FetchOptions = {}): Promise<AnalyticsEvent[]> {
  const PAGE = 5000;
  const CAP = 100_000;
  const all: AnalyticsEvent[] = [];
  let offset = 0;

  while (all.length < CAP) {
    const batch = await fetchEventsLocal({ ...opts, limit: PAGE, offset });
    all.push(...batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }

  return all.slice(0, CAP);
}
