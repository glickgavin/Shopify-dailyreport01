'use server';

export async function rerunPipeline(date: string): Promise<{ ok: boolean; message: string }> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return { ok: false, message: 'CRON_SECRET not configured' };

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://shopifydailyreport01.vercel.app';
  const url = `${appUrl}/api/cron/daily?date=${encodeURIComponent(date)}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${secret}` },
      // server-to-server; no caching
      cache: 'no-store',
    });
    const body = await res.json();
    if (res.ok) {
      return { ok: true, message: `Done — revenue ${body.summary?.revenue ?? '?'}, orders ${body.summary?.orders ?? '?'}` };
    }
    return { ok: false, message: body.error ?? `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Network error' };
  }
}
