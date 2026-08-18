import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { tagCustomerMemberActive, lookupCustomerIdByEmail } from '@/lib/store-credit';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Hourly member-active tag backfill / self-healer, in two passes:
//  1. paypal_subscription_ledger rows allocated store credit with no
//     tagged_at (we already hold the Shopify customer GID — tag directly).
//  2. member_tag_queue rows (email-seeded lists, e.g. the Stripe 30-day
//     subscriber base): look the customer up by email, then tag; not-found
//     emails go to 'failed' with the reason.
// tagsAdd is idempotent, so re-running is always safe. No-ops once both
// backlogs are empty; new PayPal allocations set tagged_at inline.

const LEDGER_BATCH = 100;
const QUEUE_BATCH = 150;
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
    .limit(LEDGER_BATCH);
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

  // ── Pass 2: email-seeded queue (lookup by email → tag) ─────────────────────
  const { data: qRows, error: qErr } = await db
    .from('member_tag_queue')
    .select('id, email')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(QUEUE_BATCH);
  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });

  let queueTagged = 0;
  let queueFailed = 0;
  for (const row of qRows ?? []) {
    const finish = (status: string, patch: Record<string, unknown>) =>
      db.from('member_tag_queue')
        .update({ status, processed_at: new Date().toISOString(), ...patch })
        .eq('id', row.id);

    const lookup = await lookupCustomerIdByEmail(row.email);
    if (lookup.error) {
      queueFailed++;
      await finish('failed', { error: `lookup: ${lookup.error}` });
    } else if (!lookup.id) {
      queueFailed++;
      await finish('failed', { error: 'customer_not_found' });
    } else {
      const outcome = await tagCustomerMemberActive(lookup.id);
      if (outcome.ok) {
        queueTagged++;
        await finish('tagged', { shopify_customer_id: lookup.id, error: null });
      } else {
        queueFailed++;
        await finish('failed', { shopify_customer_id: lookup.id, error: outcome.detail ?? 'tag failed' });
      }
    }
    await sleep(400); // two Shopify calls per row — stay well inside limits
  }

  const remainingQ = await db
    .from('paypal_subscription_ledger')
    .select('id', { count: 'exact', head: true })
    .eq('credit_status', 'allocated')
    .is('tagged_at', null)
    .not('credit_shopify_customer_id', 'is', null);
  const remaining = remainingQ.count ?? null;

  const queueRemainingQ = await db
    .from('member_tag_queue')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');
  const queueRemaining = queueRemainingQ.count ?? null;

  if ((rows ?? []).length > 0 || (qRows ?? []).length > 0) {
    await db.from('job_logs').insert({
      date: new Date().toISOString().slice(0, 10),
      job_type: 'member_tag_backfill',
      status: failed + queueFailed > 0 ? 'error' : 'success',
      message: `ledger: tagged=${tagged} failed=${failed} remaining=${remaining ?? '?'} · queue: tagged=${queueTagged} failed=${queueFailed} remaining=${queueRemaining ?? '?'}`,
    });
  }

  return NextResponse.json({
    status: 'ok',
    ledger: { processed: (rows ?? []).length, tagged, failed, remaining, failures: failures.slice(0, 10) },
    queue: { processed: (qRows ?? []).length, tagged: queueTagged, failed: queueFailed, remaining: queueRemaining },
  });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run();
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run();
}
