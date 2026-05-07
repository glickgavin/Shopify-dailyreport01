import type { AnalyticsEvent } from './client';

export interface EventDefinition {
  id: number;
  event_type: string;
  display_name: string;
  description: string | null;
  category_id: number | null;
  is_conversion: boolean;
  is_purchase: boolean;
  revenue_property: string | null;
}

export interface EventCategory {
  id: number;
  name: string;
  color: string | null;
  icon: string | null;
}

export interface PathDefinition {
  id: number;
  path_pattern: string;
  canonical_name: string;
  description: string | null;
}

export interface PropertyDefinition {
  id: number;
  property_key: string;
  display_name: string;
  description: string | null;
  data_type: string;
}

export interface Dictionary {
  events: EventDefinition[];
  categories: EventCategory[];
  paths: PathDefinition[];
  properties: PropertyDefinition[];
}

export function resolveEvent(dict: Dictionary, eventType: string): EventDefinition | undefined {
  return dict.events.find(e => e.event_type === eventType);
}

export function resolveEventCategory(dict: Dictionary, eventType: string): EventCategory | undefined {
  const def = resolveEvent(dict, eventType);
  if (!def?.category_id) return undefined;
  return dict.categories.find(c => c.id === def.category_id);
}

export function resolvePathCanonical(dict: Dictionary, path: string): string {
  for (const p of dict.paths) {
    if (matchesPattern(path, p.path_pattern)) return p.canonical_name;
  }
  return path;
}

export function isPurchaseEvent(dict: Dictionary, eventType: string): boolean {
  return resolveEvent(dict, eventType)?.is_purchase ?? false;
}

export function isConversionEvent(dict: Dictionary, eventType: string): boolean {
  return resolveEvent(dict, eventType)?.is_conversion ?? false;
}

export function purchaseValue(dict: Dictionary, event: AnalyticsEvent): number {
  const def = resolveEvent(dict, event.event_type);
  if (!def?.revenue_property) return event.revenue ?? 0;
  const props = event.properties as Record<string, unknown> | undefined;
  return Number(props?.[def.revenue_property] ?? event.revenue ?? 0);
}

export function isUnmapped(dict: Dictionary, eventType: string): boolean {
  return !dict.events.some(e => e.event_type === eventType);
}

function matchesPattern(path: string, pattern: string): boolean {
  // Support simple glob: /products/* matches /products/anything
  const re = new RegExp('^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]+') + '$');
  return re.test(path);
}

export const emptyDictionary: Dictionary = { events: [], categories: [], paths: [], properties: [] };
