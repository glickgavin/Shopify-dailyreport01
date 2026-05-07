import type { AnalyticsEvent } from './client';

export function resolvePath(event: AnalyticsEvent): string {
  if (event.page_url) {
    try {
      return new URL(event.page_url).pathname || '/';
    } catch {
      // fall through
    }
  }
  return event.page_path || '/';
}

export function resolveHost(event: AnalyticsEvent): string | null {
  if (event.page_url) {
    try {
      return new URL(event.page_url).hostname;
    } catch {
      // ignore
    }
  }
  return null;
}

export function normalizePath(path: string): string {
  // strip trailing slash except root
  return path.length > 1 ? path.replace(/\/$/, '') : path;
}

// Group a list of events into a map of path → events
export function groupByPath(events: AnalyticsEvent[]): Map<string, AnalyticsEvent[]> {
  const map = new Map<string, AnalyticsEvent[]>();
  for (const e of events) {
    const p = normalizePath(resolvePath(e));
    const arr = map.get(p) ?? [];
    arr.push(e);
    map.set(p, arr);
  }
  return map;
}
