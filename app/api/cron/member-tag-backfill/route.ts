import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { tagCustomerMemberActive } from '@/lib/store-credit';

export const runtime = 'nodejs';
export const maxDuration = 120;

// Hourly member-active tag backfill / self-healer. Tags the Shopify customer
// on every paypal_subscription_ledger row that was allocated store credit but
// has no tagged_at marker yet (rows credited before inline tagging shipped,
// or whose inline tag failed). tagsAdd is idempotent, so re-running is always
// safe. Works through the backlog in batches; no-ops once everything is
// tagged. New allocations set tagged_at inline, so this stays a stray-catcher.

const BATCH = 100;
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization');
  const query = req.nextUrl.searchParams.get('secret');
  return header === `Bearer ${secret}` || query === secret;
}

async function run(): Promise<NextResponse> {
  const db = supabaseAdmin as any;

  const { data: rows, error } = await db
    .from('paypal_subscription_ledger')
    .select('id, credit_shopify_customer_id, credit_email')
    .eq('credit_status', 'allocated')
    .is('tagged_at', null)
    .not('credit_shopify_customer_id', 'is', null)
    .order('credit_allocated_at', { ascending: true })
    .limit(BATCH);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let tagged = 0;
  let failed = 0;
  const failures: { id: string; detail?: string }[] = [];

  for (const row of rows ?? []) {
    const outcome = await tagCustomerMemberActive(row.credit_shopify_customer_id);
    if (outcome.ok) {
      tagged++;
      await db.from('paypal_subscription_ledger')
        .update({ tagged_at: new Date().toISOString() })
        .eq('id', row.id);
    } else {
      failed++;
      failures.push({ id: row.id, detail: outcome.detail });
    }
    await sleep(350); // stay well inside Shopify rate limits
  }

  const remainingQ = await db
    .from('paypal_subscription_ledger')
    .select('id', { count: 'exact', head: true })
    .eq('credit_status', 'allocated')
    .is('tagged_at', null)
    .not('credit_shopify_customer_id', 'is', null);
  const remaining = remainingQ.count ?? null;

  if ((rows ?? []).length > 0) {
    await db.from('job_logs').insert({
      date: new Date().toISOString().slice(0, 10),
      job_type: 'member_tag_backfill',
      status: failed > 0 ? 'error' : 'success',
      message: `tagged=${tagged} failed=${failed} remaining=${remaining ?? '?'}`,
    });
  }

  return NextResponse.json({ status: 'ok', processed: (rows ?? []).length, tagged, failed, remaining, failures: failures.slice(0, 10) });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run();
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run();
}
