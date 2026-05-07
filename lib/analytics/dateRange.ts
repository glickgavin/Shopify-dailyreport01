export type Preset = 'today' | 'yesterday' | '3d' | '7d' | '30d' | 'custom';

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function subtractDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() - n);
  return r;
}

export function resolveDateRange(
  preset: string | undefined,
  from: string | undefined,
  to: string | undefined,
): { startDate: string; endDate: string; preset: Preset; label: string } {
  const now = new Date();
  const today = toDateStr(now);
  const yesterday = toDateStr(subtractDays(now, 1));

  let start = today;
  let end = today;
  let p: Preset = '7d';

  switch (preset) {
    case 'today':
      start = today; end = today; p = 'today'; break;
    case 'yesterday':
      start = yesterday; end = yesterday; p = 'yesterday'; break;
    case '3d':
      start = toDateStr(subtractDays(now, 2)); end = today; p = '3d'; break;
    case '7d':
      start = toDateStr(subtractDays(now, 6)); end = today; p = '7d'; break;
    case '30d':
      start = toDateStr(subtractDays(now, 29)); end = today; p = '30d'; break;
    case 'custom':
      start = from ?? today; end = to ?? today; p = 'custom'; break;
    default:
      start = toDateStr(subtractDays(now, 6)); end = today; p = '7d'; break;
  }

  const label = start === end
    ? start
    : `${start} – ${end}`;

  return { startDate: start, endDate: end, preset: p, label };
}
