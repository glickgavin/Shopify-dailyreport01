import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { loadFixConfig, fixApprovedRow } from '@/lib/migration-credit';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Reversal worker: debits approved duplicate-migration credits. Runs every
// 10 minutes but does NOTHING unless migration_fix_config.reversal_enabled is
// true (kill switch, OFF by default) — and then only rows an admin explicitly
// approved on /dashboard/admin/credit-correction.

const MAX_ATTEMPTS = 4;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization');
  const query  = req.nextUrl.searchParams.get('secret');
  return header === `Bearer ${secret}` || query === secret;
}

async function run(): Promise<NextResponse> {
  const cfg = await loadFixConfig();
  if (!cfg.reversal_enabled) {
    return NextResponse.json({ status: 'ok', message: 'reversal_enabled is OFF — nothing processed' });
  }

  const { data: rows, error } = await (supabaseAdmin as any)
    .from('migration_credit_review')
    .select('customer_id, email, proposed_debit_cents, attempts')
    .eq('status', 'approved')
    .lt('attempts', MAX_ATTEMPTS)
    .order('updated_at', { ascending: true })
    .limit(60);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows || rows.length === 0) {
    return NextResponse.json({ status: 'ok', message: 'no approved rows' });
  }

  const startedAt = Date.now();
  const DEADLINE_MS = 240_000;
  const results = { reversed: 0, skipped: 0, failed: 0 };

  for (const row of rows) {
    if (Date.now() - startedAt > DEADLINE_MS) break;
    // Kill switch re-check per row so flipping it off stops mid-run.
    const live = await loadFixConfig();
    if (!live.reversal_enabled) break;

    const res = await fixApprovedRow(row);
    if (res.status === 'reversed') results.reversed++;
    else if (res.status === 'skipped') results.skipped++;
    else if (res.status === 'failed') results.failed++;
    console.log(`[migration-credit-fix] ${row.email} → ${res.status}${res.detail ? ` (${res.detail})` : ''}`);
  }

  return NextResponse.json({ status: 'ok', ...results });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run();
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run();
}
