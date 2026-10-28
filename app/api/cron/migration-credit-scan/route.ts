import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  loadFixConfig,
  saveScanState,
  scanCustomer,
  startHoldersBulk,
  pollHoldersBulk,
  ingestHoldersChunk,
  nextUnscannedHolders,
} from '@/lib/migration-credit';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Migration-credit scan, two passes:
//   (segment pass, no phase) walk membership_credit_members — completed 2026-10-22.
//   (store-wide pass) phase machine: bulk_start → bulk_running → bulk_ingest
//   → holders → done. The bulk export enumerates EVERY customer with a
//   store-credit balance; 'holders' then scans the ones with no review row
//   yet (ex-members outside the segment). Kick the store-wide pass with
//   ?phase=bulk_start (or set scan_state.phase manually); ?restart=1 restarts
//   the legacy segment walk.

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization');
  const query  = req.nextUrl.searchParams.get('secret');
  return header === `Bearer ${secret}` || query === secret;
}

const INGEST_LINES_PER_RUN = 120_000;
const DEADLINE_MS = 240_000;

async function run(req: NextRequest): Promise<NextResponse> {
  const cfg = await loadFixConfig();
  let state = cfg.scan_state ?? {};

  // One-off probe: scan a single customer named in scan_state.probe_customer_id
  // (set via SQL), clear the flag, and report. Used for investigations.
  const probeId = (state as { probe_customer_id?: string }).probe_customer_id;
  if (probeId) {
    const { probe_customer_id: _drop, ...rest } = state as Record<string, unknown>;
    await saveScanState(rest as typeof state);
    const out = await scanCustomer(probeId);
    console.log(`[migration-credit-scan] probe ${probeId}: ${out.status}, duplicates $${(out.duplicateCents / 100).toFixed(2)}`);
    return NextResponse.json({ status: 'ok', probe: probeId, result: out });
  }
  if (req.nextUrl.searchParams.get('restart') === '1') state = {};
  if (req.nextUrl.searchParams.get('phase') === 'bulk_start') state = { phase: 'bulk_start' };

  const phase = state.phase;

  // ── store-wide pass ──────────────────────────────────────────────────────────
  if (phase === 'bulk_start') {
    const started = await startHoldersBulk();
    if (started.error) {
      // Another bulk op may be in flight (one per shop) — retry next tick.
      console.error('[migration-credit-scan] bulk start deferred:', started.error);
      return NextResponse.json({ status: 'ok', phase, detail: `start deferred: ${started.error}` });
    }
    await saveScanState({ phase: 'bulk_running', bulk_op_id: started.id });
    return NextResponse.json({ status: 'ok', phase: 'bulk_running', bulk_op_id: started.id });
  }

  if (phase === 'bulk_running') {
    const op = await pollHoldersBulk(state.bulk_op_id!);
    if (op.status === 'COMPLETED' && op.url) {
      await saveScanState({ phase: 'bulk_ingest', url: op.url, line_offset: 0, carry: null });
      return NextResponse.json({ status: 'ok', phase: 'bulk_ingest', objects: op.objectCount });
    }
    if (op.status === 'RUNNING' || op.status === 'CREATED') {
      return NextResponse.json({ status: 'ok', phase, detail: `bulk ${op.status}` });
    }
    await saveScanState({ phase: 'bulk_start' });
    console.error(`[migration-credit-scan] bulk failed: ${op.status} ${op.errorCode ?? ''} — will restart`);
    return NextResponse.json({ status: 'ok', phase: 'bulk_start', detail: `bulk failed: ${op.status}` });
  }

  if (phase === 'bulk_ingest') {
    const r = await ingestHoldersChunk(state.url!, state.line_offset ?? 0, state.carry ?? null, INGEST_LINES_PER_RUN);
    if (r.done) {
      await saveScanState({ phase: 'holders', cursor_customer_id: '' });
      console.log(`[migration-credit-scan] holders ingest complete (+${r.inserted} this run)`);
      return NextResponse.json({ status: 'ok', phase: 'holders', inserted: r.inserted });
    }
    await saveScanState({ phase: 'bulk_ingest', url: state.url, line_offset: r.nextOffset, carry: r.carry });
    return NextResponse.json({ status: 'ok', phase, offset: r.nextOffset, inserted: r.inserted });
  }

  if (phase === 'holders') {
    const startedAt = Date.now();
    let scanned = 0, flagged = 0, errors = 0;
    let cursor = state.cursor_customer_id ?? '';

    while (Date.now() - startedAt < DEADLINE_MS) {
      const { ids, lastCursor } = await nextUnscannedHolders(cursor, 25);
      if (lastCursor === null) {
        await saveScanState({ phase: 'done', done_at: new Date().toISOString() });
        console.log(`[migration-credit-scan] store-wide pass complete — scanned ${scanned} this run`);
        return NextResponse.json({ status: 'ok', phase: 'done', scanned, flagged, errors });
      }
      for (const id of ids) {
        if (Date.now() - startedAt > DEADLINE_MS) break;
        try {
          const out = await scanCustomer(id);
          scanned++;
          if (out.status === 'pending_review') flagged++;
        } catch (err) {
          errors++;
          console.error(`[migration-credit-scan] ${id}:`, (err as Error).message);
        }
      }
      cursor = lastCursor;
      await saveScanState({ phase: 'holders', cursor_customer_id: cursor });
    }
    console.log(`[migration-credit-scan] holders progress — scanned ${scanned}, flagged ${flagged}, errors ${errors}`);
    return NextResponse.json({ status: 'ok', phase, scanned, flagged, errors, cursor });
  }

  if (phase === 'done' || state.done_at) {
    return NextResponse.json({ status: 'ok', done: true, done_at: state.done_at ?? null });
  }

  // ── legacy segment pass (membership_credit_members cursor walk) ─────────────
  const startedAt = Date.now();
  let scanned = 0, flagged = 0, errors = 0;
  let cursor = state.cursor_customer_id ?? '';

  while (Date.now() - startedAt < DEADLINE_MS) {
    const { data: batch, error } = await (supabaseAdmin as any)
      .from('membership_credit_members')
      .select('customer_id')
      .gt('customer_id', cursor)
      .order('customer_id', { ascending: true })
      .limit(25);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (!batch || batch.length === 0) {
      await saveScanState({ done_at: new Date().toISOString() });
      console.log(`[migration-credit-scan] segment pass complete — scanned ${scanned} this run`);
      return NextResponse.json({ status: 'ok', done: true, scanned, flagged, errors });
    }

    for (const m of batch as { customer_id: string }[]) {
      if (Date.now() - startedAt > DEADLINE_MS) break;
      try {
        const out = await scanCustomer(m.customer_id);
        scanned++;
        if (out.status === 'pending_review') flagged++;
      } catch (err) {
        errors++;
        console.error(`[migration-credit-scan] ${m.customer_id}:`, (err as Error).message);
      }
      cursor = m.customer_id;
    }
    await saveScanState({ cursor_customer_id: cursor });
  }

  console.log(`[migration-credit-scan] progress — scanned ${scanned}, flagged ${flagged}, errors ${errors}, cursor ${cursor}`);
  return NextResponse.json({ status: 'ok', done: false, scanned, flagged, errors, cursor });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run(req);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run(req);
}
