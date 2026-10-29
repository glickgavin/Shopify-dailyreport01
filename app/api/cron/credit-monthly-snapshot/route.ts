import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { startHoldersBulk, pollHoldersBulk, ingestHoldersChunk, HOLDERS_BULK_QUERY_BASIC } from '@/lib/migration-credit';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Monthly store-credit snapshot. Runs every 10 minutes but no-ops once the
// current calendar month has history rows. When a month is missing it runs the
// store-wide bulk export (same resumable pipeline as the migration scan,
// refreshing store_credit_holders with live balances), then copies the
// holders into credit_monthly_history stamped with the month and flagged
// in_segment by membership_credit_members. ?force=1 re-runs the current month.

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization');
  const query  = req.nextUrl.searchParams.get('secret');
  return header === `Bearer ${secret}` || query === secret;
}

interface SnapState {
  phase?: string;       // bulk_start → bulk_running → bulk_ingest → copy
  target_month?: string; // yyyy-MM-01
  bulk_op_id?: string;
  url?: string;
  line_offset?: number;
  carry?: { id: string; email: string | null; name: string | null; balance_cents: number } | null;
}

async function loadState(): Promise<SnapState> {
  const { data, error } = await (supabaseAdmin as any)
    .from('credit_snapshot_config').select('state').eq('id', 1).single();
  if (error || !data) throw new Error(`credit_snapshot_config: ${error?.message ?? 'missing'}`);
  return (data.state ?? {}) as SnapState;
}

async function saveState(state: SnapState): Promise<void> {
  await (supabaseAdmin as any)
    .from('credit_snapshot_config')
    .update({ state, updated_at: new Date().toISOString() })
    .eq('id', 1);
}

function currentMonth(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

async function run(req: NextRequest): Promise<NextResponse> {
  const month = currentMonth();
  let state = await loadState();

  // Idle check: run when this month has no rows yet, OR when the holders data
  // is older than 7 days (weekly refresh keeps tags / last purchase / last
  // credit and balances current; the copy phase upserts the current month).
  if (!state.phase) {
    const { count, error } = await (supabaseAdmin as any)
      .from('credit_monthly_history')
      .select('id', { count: 'exact', head: true })
      .eq('month', month);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const { data: freshRow } = await (supabaseAdmin as any)
      .from('store_credit_holders')
      .select('ingested_at')
      .order('ingested_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const ageMs = freshRow?.ingested_at ? Date.now() - new Date(freshRow.ingested_at).getTime() : Infinity;
    const stale = ageMs > 7 * 24 * 3600 * 1000;

    if ((count ?? 0) > 0 && !stale && req.nextUrl.searchParams.get('force') !== '1') {
      return NextResponse.json({ status: 'ok', month, done: true, rows: count });
    }
    state = { phase: 'bulk_start', target_month: month };
    await saveState(state);
  }

  const target = state.target_month ?? month;

  if (state.phase === 'bulk_start') {
    // Try the rich query (tags + last order + credit transactions); if the
    // schema rejects it, fall back to the basic one so the snapshot still runs.
    let started = await startHoldersBulk();
    if (started.error && !/already in progress|is already running/i.test(started.error)) {
      console.error('[credit-monthly-snapshot] rich bulk rejected, trying basic:', started.error);
      started = await startHoldersBulk(HOLDERS_BULK_QUERY_BASIC);
    }
    if (started.error) {
      // Another bulk op may be running (one per shop) — retry next tick.
      console.error('[credit-monthly-snapshot] bulk start deferred:', started.error);
      return NextResponse.json({ status: 'ok', phase: state.phase, detail: started.error });
    }
    await saveState({ phase: 'bulk_running', target_month: target, bulk_op_id: started.id });
    return NextResponse.json({ status: 'ok', phase: 'bulk_running', bulk_op_id: started.id });
  }

  if (state.phase === 'bulk_running') {
    const op = await pollHoldersBulk(state.bulk_op_id!);
    if (op.status === 'COMPLETED' && op.url) {
      // Reset the holders table so stale (now-zero) balances don't linger.
      await (supabaseAdmin as any).from('store_credit_holders').delete().neq('customer_id', '');
      await saveState({ phase: 'bulk_ingest', target_month: target, url: op.url, line_offset: 0, carry: null });
      return NextResponse.json({ status: 'ok', phase: 'bulk_ingest', objects: op.objectCount });
    }
    if (op.status === 'RUNNING' || op.status === 'CREATED') {
      return NextResponse.json({ status: 'ok', phase: state.phase, detail: `bulk ${op.status}` });
    }
    await saveState({ phase: 'bulk_start', target_month: target });
    console.error(`[credit-monthly-snapshot] bulk failed: ${op.status} ${op.errorCode ?? ''} — will restart`);
    return NextResponse.json({ status: 'ok', phase: 'bulk_start', detail: `bulk failed: ${op.status}` });
  }

  if (state.phase === 'bulk_ingest') {
    const r = await ingestHoldersChunk(state.url!, state.line_offset ?? 0, state.carry ?? null, 120_000);
    if (r.done) {
      await saveState({ phase: 'copy', target_month: target });
      return NextResponse.json({ status: 'ok', phase: 'copy', inserted: r.inserted });
    }
    await saveState({ phase: 'bulk_ingest', target_month: target, url: state.url, line_offset: r.nextOffset, carry: r.carry });
    return NextResponse.json({ status: 'ok', phase: state.phase, offset: r.nextOffset });
  }

  if (state.phase === 'copy') {
    // Month-stamped copy in one SQL pass via the service role (RPC-free upsert
    // would need paging; a single INSERT..SELECT keeps it atomic).
    const { error } = await (supabaseAdmin as any).rpc('copy_credit_month', { target_month: target });
    if (error) {
      // Fallback: paged copy through the API if the RPC is absent.
      let copied = 0;
      for (let from = 0; ; from += 1000) {
        const { data, error: selErr } = await (supabaseAdmin as any)
          .from('store_credit_holders')
          .select('customer_id, email, display_name, balance_cents')
          .gt('balance_cents', 0)
          .order('customer_id', { ascending: true })
          .range(from, from + 999);
        if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });
        const rows = data ?? [];
        if (rows.length === 0) break;
        const ids = rows.map((r: { customer_id: string }) => r.customer_id);
        const { data: seg } = await (supabaseAdmin as any)
          .from('membership_credit_members').select('customer_id').in('customer_id', ids);
        const inSeg = new Set(((seg ?? []) as { customer_id: string }[]).map(s => s.customer_id));
        const { error: insErr } = await (supabaseAdmin as any)
          .from('credit_monthly_history')
          .upsert(rows.map((r: { customer_id: string; email: string | null; display_name: string | null; balance_cents: number }) => ({
            month: target,
            customer_id: r.customer_id,
            email: r.email,
            display_name: r.display_name,
            credit_cents: r.balance_cents,
            in_segment: inSeg.has(r.customer_id),
          })), { onConflict: 'month,customer_id' });
        if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
        copied += rows.length;
        if (rows.length < 1000) break;
      }
      await saveState({});
      console.log(`[credit-monthly-snapshot] ${target}: ${copied} holders recorded (paged copy)`);
      return NextResponse.json({ status: 'ok', month: target, copied });
    }
    await saveState({});
    console.log(`[credit-monthly-snapshot] ${target}: recorded via copy_credit_month`);
    return NextResponse.json({ status: 'ok', month: target, copied: 'rpc' });
  }

  return NextResponse.json({ status: 'ok', phase: state.phase ?? 'idle' });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run(req);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run(req);
}
