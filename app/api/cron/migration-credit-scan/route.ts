import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { loadFixConfig, saveScanState, scanCustomer } from '@/lib/migration-credit';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Time-budgeted, resumable scan of the Membership 2025 members for duplicate
// migration credits (Mar–Apr 2026). Walks membership_credit_members in
// customer_id order, one page per run, cursor kept in migration_fix_config.
// Re-run from scratch with ?restart=1.

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization');
  const query  = req.nextUrl.searchParams.get('secret');
  return header === `Bearer ${secret}` || query === secret;
}

async function run(req: NextRequest): Promise<NextResponse> {
  const cfg = await loadFixConfig();
  let state = cfg.scan_state ?? {};
  if (req.nextUrl.searchParams.get('restart') === '1') state = {};

  if (state.done_at) {
    return NextResponse.json({ status: 'ok', done: true, done_at: state.done_at });
  }

  const startedAt = Date.now();
  const DEADLINE_MS = 240_000;
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
      console.log(`[migration-credit-scan] complete — scanned ${scanned} this run`);
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
