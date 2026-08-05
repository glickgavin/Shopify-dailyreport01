import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { allocateLedgerRows } from '@/lib/paypal-allocate';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Auto-allocate store credit for NEW PayPal subscription (T0002) payments.
//
// Runs daily right after the PayPal snapshot cron (which populates the ledger
// via trigger). FORWARD-ONLY: only rows whose pt_date is on or after the
// go-live date below are ever touched — the historic backlog stays manual.
//
// Only 'pending' rows are claimed; rows that fail (customer_not_found,
// no_account, …) move to 'failed' with the error recorded and are left for
// human review in the dashboard — the cron never retries them, so a
// persistent failure can't loop.
const AUTO_ALLOCATE_FROM = '2026-08-05';
const MAX_PER_RUN = 100;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization');
  const query = req.nextUrl.searchParams.get('secret');
  return header === `Bearer ${secret}` || query === secret;
}

async function run(): Promise<NextResponse> {
  const { data: rows, error } = await (supabaseAdmin as any)
    .from('paypal_subscription_ledger')
    .select('id, pt_date, gross_cents')
    .eq('credit_status', 'pending')
    .gte('pt_date', AUTO_ALLOCATE_FROM)
    .order('pt_date', { ascending: true })
    .limit(MAX_PER_RUN);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ids: string[] = (rows ?? []).map((r: { id: string }) => r.id);
  if (ids.length === 0) {
    return NextResponse.json({ status: 'ok', processed: 0, allocated: 0, failed: 0 });
  }

  const results = await allocateLedgerRows(ids, 'auto-cron', ['pending']);

  const allocated = results.filter(r => r.ok).length;
  const failed    = results.filter(r => !r.ok).length;
  const totalCents = (rows ?? []).reduce((s: number, r: { gross_cents: number }) => s + (r.gross_cents ?? 0), 0);

  console.log(
    `[paypal-auto-allocate] processed=${results.length} allocated=${allocated} failed=${failed}` +
    ` total=$${(totalCents / 100).toFixed(2)} from=${AUTO_ALLOCATE_FROM}`,
  );

  // Record the run so it's auditable alongside other jobs.
  await supabaseAdmin.from('job_logs').insert({
    date:     new Date().toISOString().slice(0, 10),
    job_type: 'paypal_auto_allocate',
    status:   failed > 0 ? 'alert' : 'ok',
    message:  `allocated ${allocated}, failed ${failed} of ${results.length} new PayPal subscription credits`,
    meta:     JSON.parse(JSON.stringify({ results })),
  });

  return NextResponse.json({ status: 'ok', processed: results.length, allocated, failed, results });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run();
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run();
}
