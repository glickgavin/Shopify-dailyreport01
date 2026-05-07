import type { AnalyticsEvent } from './client';

export interface UtmParams {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  term: string | null;
}

export function resolveUtm(event: AnalyticsEvent): UtmParams {
  // First try direct fields
  if (event.utm_source || event.utm_medium) {
    return {
      source: event.utm_source ?? null,
      medium: event.utm_medium ?? null,
      campaign: event.utm_campaign ?? null,
      content: event.utm_content ?? null,
      term: event.utm_term ?? null,
    };
  }
  // Fall back to parsing page_url
  if (event.page_url) {
    try {
      const url = new URL(event.page_url);
      return {
        source: url.searchParams.get('utm_source'),
        medium: url.searchParams.get('utm_medium'),
        campaign: url.searchParams.get('utm_campaign'),
        content: url.searchParams.get('utm_content'),
        term: url.searchParams.get('utm_term'),
      };
    } catch {
      // ignore
    }
  }
  return { source: null, medium: null, campaign: null, content: null, term: null };
}

export function utmLabel(utm: UtmParams): string {
  if (utm.source && utm.medium) return `${utm.source} / ${utm.medium}`;
  if (utm.source) return utm.source;
  if (utm.medium) return utm.medium;
  return '(direct)';
}

export function groupByUtmSource(events: AnalyticsEvent[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of events) {
    const { source } = resolveUtm(e);
    const key = source ?? '(direct)';
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}
