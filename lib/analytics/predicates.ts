import type { AnalyticsEvent } from './client';

export type PredicateKind = 'event_type' | 'page_path' | 'property' | 'device_type';
export type PredicateOp = 'is' | 'is_not' | 'contains' | 'not_contains' | 'exists' | 'not_exists';

export interface Predicate {
  kind: PredicateKind;
  key?: string;         // for 'property' kind: the property key
  op: PredicateOp;
  value?: string;
}

export function matchesPredicate(event: AnalyticsEvent, predicate: Predicate): boolean {
  const { kind, key, op, value = '' } = predicate;

  let target: string | null | undefined;
  if (kind === 'event_type') {
    target = event.event_type;
  } else if (kind === 'page_path') {
    target = event.page_path;
  } else if (kind === 'device_type') {
    target = event.device_type;
  } else if (kind === 'property' && key) {
    const props = event.properties as Record<string, unknown> | undefined;
    target = props?.[key] != null ? String(props[key]) : undefined;
  }

  switch (op) {
    case 'is':           return target === value;
    case 'is_not':       return target !== value;
    case 'contains':     return typeof target === 'string' && target.includes(value);
    case 'not_contains': return typeof target === 'string' && !target.includes(value);
    case 'exists':       return target !== undefined && target !== null;
    case 'not_exists':   return target === undefined || target === null;
    default:             return false;
  }
}

export function matchesAllPredicates(event: AnalyticsEvent, predicates: Predicate[]): boolean {
  return predicates.every(p => matchesPredicate(event, p));
}
