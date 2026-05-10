export interface AnalyticsEvent {
  id?: string | number;
  event_type: string;
  event_name?: string;
  page_path?: string;
  page_url?: string;
  session_id?: string;
  visitor_id?: string;
  device_type?: string | null;
  is_preview?: boolean;
  properties?: Record<string, unknown>;
  created_at?: string;
  timestamp?: string;
  // UTM / referrer
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  referrer?: string | null;
  // e-commerce
  revenue?: number | null;
  currency?: string | null;
  order_id?: string | null;
  product_id?: string | null;
  quantity?: number | null;
}

export interface FetchOptions {
  startDate?: string;
  endDate?: string;
  limit?: number;
  offset?: number;
  eventType?: string;
  pagePath?: string;
  deviceType?: string;
  isPreview?: boolean;
  sessionId?: string;
}

function buildUrl(opts: FetchOptions): string {
  const params = new URLSearchParams();
  if (opts.startDate) params.set('start_date', opts.startDate);
  if (opts.endDate) params.set('end_date', opts.endDate);
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts.offset !== undefined) params.set('offset', String(opts.offset));
  if (opts.eventType) params.set('event_type', opts.eventType);
  if (opts.pagePath) params.set('page_path', opts.pagePath);
  if (opts.deviceType) params.set('device_type', opts.deviceType);
  if (opts.isPreview !== undefined) params.set('is_preview', String(opts.isPreview));
  if (opts.sessionId) params.set('session_id', opts.sessionId);
  return `/api/analytics?${params.toString()}`;
}

export async function fetchEvents(opts: FetchOptions = {}): Promise<AnalyticsEvent[]> {
  const url = buildUrl({ limit: 1000, ...opts });
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Analytics fetch failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : (data.events ?? data.data ?? []);
}

export async function fetchAllEvents(opts: Omit<FetchOptions, 'offset'> = {}): Promise<AnalyticsEvent[]> {
  const PAGE = 5000;
  const all: AnalyticsEvent[] = [];
  let offset = 0;
  while (true) {
    const batch = await fetchEvents({ ...opts, limit: PAGE, offset });
    all.push(...batch);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

export function applyPreviewFilter(events: AnalyticsEvent[], exclude: boolean): AnalyticsEvent[] {
  if (!exclude) return events;
  return events.filter(e => !e.is_preview);
}

export function applyDeviceFilter(events: AnalyticsEvent[], devices: string[]): AnalyticsEvent[] {
  if (!devices.length) return events;
  return events.filter(e => e.device_type && devices.includes(e.device_type));
}

// Server-side fetch — uses local mirror by default; set ANALYTICS_USE_REMOTE=true to fall back to remote API
export async function fetchEventsDirect(opts: FetchOptions = {}): Promise<AnalyticsEvent[]> {
  if (process.env.ANALYTICS_USE_REMOTE === 'true') {
    return fetchEventsRemote(opts);
  }
  const { fetchEventsLocal } = await import('./queries');
  return fetchEventsLocal(opts);
}

// Remote fallback (original implementation — kept for debugging via ANALYTICS_USE_REMOTE=true)
async function fetchEventsRemote(opts: FetchOptions): Promise<AnalyticsEvent[]> {
  const API_URL = process.env.ANALYTICS_API_URL!;
  const API_KEY = process.env.ANALYTICS_API_KEY!;
  const params = new URLSearchParams();
  if (opts.startDate) params.set('start_date', opts.startDate);
  if (opts.endDate) params.set('end_date', opts.endDate);
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts.offset !== undefined) params.set('offset', String(opts.offset));
  if (opts.eventType) params.set('event_type', opts.eventType);
  if (opts.pagePath) params.set('page_path', opts.pagePath);
  if (opts.deviceType) params.set('device_type', opts.deviceType);
  if (opts.isPreview !== undefined) params.set('is_preview', String(opts.isPreview));
  if (opts.sessionId) params.set('session_id', opts.sessionId);

  const res = await fetch(`${API_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`Analytics direct fetch failed: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : (data.events ?? data.data ?? []);
}

export async function fetchDistinctEventTypes(opts: { startDate?: string; endDate?: string } = {}): Promise<string[]> {
  try {
    const events = await fetchEventsDirect({ ...opts, limit: 5000 });
    const types = new Set(events.map(e => e.event_type).filter(Boolean));
    return Array.from(types).sort();
  } catch {
    return [];
  }
}
