import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { format, subDays } from 'date-fns';

export const runtime = 'nodejs';
export const maxDuration = 300;

const PAGE_SIZE = 1000;
const MAX_PAGES = 60; // up to 60k rows per backfill run
const BACKFILL_DAYS = 90;

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
  return runBackfill();
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return runBackfill();
}

async function runBackfill() {
  const API_URL = process.env.ANALYTICS_API_URL;
  const API_KEY = process.env.ANALYTICS_API_KEY;
  if (!API_URL || !API_KEY) {
    return NextResponse.json({ error: 'ANALYTICS_API_URL or ANALYTICS_API_KEY not set' }, { status: 500 });
  }

  const { data: stateRow } = await supabaseAdmin
    .from('analytics_sync_state')
    .select('backfill_complete, backfill_oldest_synced_at, backfill_target_at')
    .eq('id', 1)
    .single();

  if (stateRow?.backfill_complete) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'backfill already complete' });
  }

  const targetDate = format(subDays(new Date(), BACKFILL_DAYS), 'yyyy-MM-dd');
  // Cursor walks backward: end_date starts at yesterday (or oldest synced) and shrinks
  const endDate: string = stateRow?.backfill_oldest_synced_at
    ? format(new Date(stateRow.backfill_oldest_synced_at), 'yyyy-MM-dd')
    : format(subDays(new Date(), 1), 'yyyy-MM-dd');

  // Set target on first run
  if (!stateRow?.backfill_target_at) {
    await supabaseAdmin.from('analytics_sync_state').update({
      backfill_target_at: targetDate,
    }).eq('id', 1);
  }

  if (endDate <= targetDate) {
    await supabaseAdmin.from('analytics_sync_state').update({
      backfill_complete: true,
      last_run_at: new Date().toISOString(),
      last_run_status: 'ok',
    }).eq('id', 1);
    return NextResponse.json({ ok: true, complete: true });
  }

  const runId = crypto.randomUUID();
  await supabaseAdmin.from('analytics_sync_runs').insert({
    id: runId,
    kind: 'backfill',
    watermark_before_created_at: stateRow?.backfill_oldest_synced_at ?? null,
  });

  let totalFetched = 0;
  let totalInserted = 0;
  let pagesCount = 0;
  let oldestCreatedAt: string | null = null;
  let lastError: string | null = null;
  let lastHttpStatus = 200;
  // Walk backward one day at a time per run
  let currentEndDate = endDate;

  try {
    for (let offset = 0; pagesCount < MAX_PAGES; offset += PAGE_SIZE) {
      // start_date is one day before end_date for a one-day window per page
      const startDate = format(subDays(new Date(currentEndDate), 1), 'yyyy-MM-dd');

      const url = new URL(API_URL);
      url.searchParams.set('start_date', startDate);
      url.searchParams.set('end_date', currentEndDate);
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

      if (rows.length > 0) {
        totalFetched += rows.length;

        for (const r of rows) {
          const ca = r.created_at as string | undefined;
          if (ca && (!oldestCreatedAt || ca < oldestCreatedAt)) oldestCreatedAt = ca;
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
          country: (r.country ?? null) as string | null,
        }));

        const { error: upsertErr, count } = await supabaseAdmin
          .from('analytics_events_mirror')
          .upsert(toInsert, { onConflict: 'id', ignoreDuplicates: true, count: 'exact' });

        if (upsertErr) {
          lastError = upsertErr.message;
          break;
        }
        totalInserted += count ?? 0;
      }

      if (rows.length < PAGE_SIZE) {
        // Move cursor back one day
        currentEndDate = startDate;
        offset = -PAGE_SIZE; // reset offset (loop increments it back to 0)
        if (currentEndDate <= targetDate) break;
      }
    }
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
  }

  const newOldest = oldestCreatedAt ?? stateRow?.backfill_oldest_synced_at ?? null;
  const isComplete = !lastError && currentEndDate <= targetDate;

  await supabaseAdmin.from('analytics_sync_state').update({
    backfill_oldest_synced_at: newOldest,
    backfill_complete: isComplete,
    last_run_at: new Date().toISOString(),
    last_run_status: lastError ? 'error' : 'ok',
    last_run_rows: totalFetched,
    last_run_error: lastError,
  }).eq('id', 1);

  await supabaseAdmin.from('analytics_sync_runs').update({
    finished_at: new Date().toISOString(),
    rows_fetched: totalFetched,
    rows_inserted: totalInserted,
    pages_fetched: pagesCount,
    http_status: lastHttpStatus,
    error: lastError,
    watermark_after_created_at: newOldest,
  }).eq('id', runId);

  return NextResponse.json({
    ok: !lastError,
    rows: totalFetched,
    inserted: totalInserted,
    pages: pagesCount,
    complete: isComplete,
    oldest: newOldest,
    error: lastError,
  });
}
