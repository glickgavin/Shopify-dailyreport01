import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { format } from 'date-fns';

export const runtime = 'nodejs';
export const maxDuration = 300;

const PAGE_SIZE = 5000;
const MAX_PAGES = 6; // 30k rows per run max

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization');
  const query = req.nextUrl.searchParams.get('secret');
  return header === `Bearer ${secret}` || query === secret;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return runForwardSync('forward');
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return runForwardSync('forward');
}

export async function runForwardSync(kind: 'forward' | 'manual') {
  const API_URL = process.env.ANALYTICS_API_URL;
  const API_KEY = process.env.ANALYTICS_API_KEY;
  if (!API_URL || !API_KEY) {
    return NextResponse.json({ error: 'ANALYTICS_API_URL or ANALYTICS_API_KEY not set' }, { status: 500 });
  }

  // Read watermark
  const { data: stateRow } = await supabaseAdmin
    .from('analytics_sync_state')
    .select('last_synced_created_at')
    .eq('id', 1)
    .single();

  const watermarkDate: string = stateRow?.last_synced_created_at
    ? format(new Date(stateRow.last_synced_created_at), 'yyyy-MM-dd')
    : format(new Date(Date.now() - 5 * 60 * 1000), 'yyyy-MM-dd');

  const today = format(new Date(), 'yyyy-MM-dd');

  const runId = crypto.randomUUID();
  await supabaseAdmin.from('analytics_sync_runs').insert({
    id: runId,
    kind,
    watermark_before_created_at: stateRow?.last_synced_created_at ?? null,
  });

  let totalFetched = 0;
  let totalInserted = 0;
  let pagesCount = 0;
  let maxCreatedAt: string | null = null;
  let lastError: string | null = null;
  let lastHttpStatus = 200;

  try {
    for (let offset = 0; pagesCount < MAX_PAGES; offset += PAGE_SIZE) {
      const url = new URL(API_URL);
      url.searchParams.set('start_date', watermarkDate);
      url.searchParams.set('end_date', today);
      url.searchParams.set('limit', String(PAGE_SIZE));
      url.searchParams.set('offset', String(offset));

      const res = await fetch(url.toString(), {
        headers: { 'x-api-key': API_KEY },
        cache: 'no-store',
      });

      lastHttpStatus = res.status;
      pagesCount++;

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        lastError = `HTTP ${res.status}: ${text.slice(0, 200)}`;
        break;
      }

      const raw = await res.json();
      const rows: Record<string, unknown>[] = Array.isArray(raw)
        ? raw
        : (raw.events ?? raw.data ?? []);

      if (rows.length === 0) break;

      totalFetched += rows.length;

      // Track max created_at
      for (const r of rows) {
        const ca = r.created_at as string | undefined;
        if (ca && (!maxCreatedAt || ca > maxCreatedAt)) maxCreatedAt = ca;
      }

      const toInsert = rows.map(r => ({
        id: r.id as string,
        event_name: (r.event_name ?? r.event_type ?? '') as string,
        event_category: (r.event_category ?? null) as string | null,
        session_id: (r.session_id ?? null) as string | null,
        user_id: (r.user_id ?? null) as string | null,
        properties: (r.properties ?? null) as import('@/lib/types/database').Json | null,
        page_url: (r.page_url ?? null) as string | null,
        page_path: (r.page_path ?? null) as string | null,
        referrer: (r.referrer ?? null) as string | null,
        user_agent: (r.user_agent ?? null) as string | null,
        device_type: (r.device_type ?? null) as string | null,
        created_at: r.created_at as string,
        magic_id: (r.magic_id ?? null) as string | null,
        click_id: (r.click_id ?? null) as string | null,
        email: (r.email ?? null) as string | null,
      }));

      const { error: upsertErr, count } = await supabaseAdmin
        .from('analytics_events_mirror')
        .upsert(toInsert, { onConflict: 'id', ignoreDuplicates: true, count: 'exact' });

      if (upsertErr) {
        lastError = upsertErr.message;
        break;
      }

      totalInserted += count ?? 0;

      if (rows.length < PAGE_SIZE) break;
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
  }

  // Advance watermark
  if (maxCreatedAt && !lastError) {
    await supabaseAdmin.from('analytics_sync_state').update({
      last_synced_created_at: maxCreatedAt,
      last_run_at: new Date().toISOString(),
      last_run_status: 'ok',
      last_run_rows: totalFetched,
      last_run_error: null,
    }).eq('id', 1);
  } else {
    await supabaseAdmin.from('analytics_sync_state').update({
      last_run_at: new Date().toISOString(),
      last_run_status: lastError ? 'error' : 'ok',
      last_run_rows: totalFetched,
      last_run_error: lastError,
    }).eq('id', 1);
  }

  await supabaseAdmin.from('analytics_sync_runs').update({
    finished_at: new Date().toISOString(),
    rows_fetched: totalFetched,
    rows_inserted: totalInserted,
    pages_fetched: pagesCount,
    http_status: lastHttpStatus,
    error: lastError,
    watermark_after_created_at: maxCreatedAt,
  }).eq('id', runId);

  const ok = !lastError;
  return NextResponse.json({ ok, rows: totalFetched, inserted: totalInserted, pages: pagesCount, error: lastError });
}
