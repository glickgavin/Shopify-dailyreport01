export type Preset = 'today' | 'yesterday' | '3d' | '7d' | '30d' | 'custom';

export const REPORTING_TZ = 'America/Los_Angeles';

/** Calendar date string (YYYY-MM-DD) for a given moment in the reporting timezone */
function getDateInTZ(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: REPORTING_TZ }).format(d);
}

/** Subtract n calendar days from a YYYY-MM-DD string */
function subtractDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00Z'); // noon UTC avoids DST edge cases
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** UTC offset in hours for the reporting timezone on the given date (e.g. -7 PDT, -8 PST) */
function getPacificOffset(dateStr: string): number {
  const noon = new Date(dateStr + 'T12:00:00Z');
  const tzPart = new Intl.DateTimeFormat('en', {
    timeZone: REPORTING_TZ,
    timeZoneName: 'shortOffset',
  }).formatToParts(noon).find(p => p.type === 'timeZoneName')?.value ?? 'GMT-8';
  return parseInt(tzPart.replace('GMT', '')) || -8; // -7 (PDT) or -8 (PST)
}

/**
 * Convert a YYYY-MM-DD date range (in Pacific Time) to UTC ISO timestamp bounds
 * suitable for Supabase/Postgres queries against `created_at timestamptz`.
 *
 * e.g. "2026-05-25" → { from: "2026-05-25T07:00:00.000Z", to: "2026-05-26T06:59:59.999Z" }
 */
export function dateToUTCRange(
  startStr: string,
  endStr: string = startStr,
): { from: string; to: string } {
  const startOffset = getPacificOffset(startStr); // e.g. -7
  const endOffset   = getPacificOffset(endStr);

  // Pacific midnight = UTC midnight shifted right by |offset| hours
  const from = new Date(Date.parse(startStr + 'T00:00:00Z') + (-startOffset) * 3_600_000);
  const to   = new Date(Date.parse(endStr   + 'T23:59:59.999Z') + (-endOffset) * 3_600_000);

  return { from: from.toISOString(), to: to.toISOString() };
}

export function resolveDateRange(
  preset: string | undefined,
  from: string | undefined,
  to: string | undefined,
): { startDate: string; endDate: string; preset: Preset; label: string } {
  const now       = new Date();
  const today     = getDateInTZ(now);           // Pacific "today"
  const yesterday = subtractDays(today, 1);     // Pacific "yesterday"

  let start = today;
  let end   = today;
  let p: Preset = '7d';

  switch (preset) {
    case 'today':     start = today;                    end = today;      p = 'today';     break;
    case 'yesterday': start = yesterday;                end = yesterday;  p = 'yesterday'; break;
    case '3d':        start = subtractDays(today, 3);  end = yesterday;  p = '3d';        break;
    case '7d':        start = subtractDays(today, 7);  end = yesterday;  p = '7d';        break;
    case '30d':       start = subtractDays(today, 30); end = yesterday;  p = '30d';       break;
    case 'custom':    start = from ?? today;            end = to ?? today; p = 'custom';   break;
    default:          start = subtractDays(today, 7);  end = yesterday;  p = '7d';        break;
  }

  const label = start === end ? start : `${start} – ${end}`;
  return { startDate: start, endDate: end, preset: p, label };
}
