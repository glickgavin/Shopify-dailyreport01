import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { fulfillJob } from '@/lib/mugs/fulfill-job';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Headless fulfillment worker (every 10 minutes): runs the same
// approve → PDF → Gelato pipeline as the admin "Fulfill" button, but only for
// jobs explicitly flagged manual_approval = 'auto_fulfill' (set via admin/ops —
// nothing sets it automatically). Successful jobs are re-stamped 'go_live' so
// they read normally in the admin UI and drop out of this queue; failures keep
// the flag and retry with the attempt counter until MAX_ATTEMPTS.

const MAX_ATTEMPTS = 5;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization');
  const query  = req.nextUrl.searchParams.get('secret');
  return header === `Bearer ${secret}` || query === secret;
}

async function run(req: NextRequest): Promise<NextResponse> {
  const { data: jobs, error } = await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .select('id, shopify_order_name, attempts')
    .eq('manual_approval', 'auto_fulfill')
    .in('state', ['received', 'failed'])
    .is('gelato_order_id', null)
    .lt('attempts', MAX_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(10);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!jobs || jobs.length === 0) {
    return NextResponse.json({ status: 'ok', message: 'No auto_fulfill jobs queued' });
  }

  const startedAt = Date.now();
  const DEADLINE_MS = 240_000; // leave margin under maxDuration for the in-flight job
  const results: Array<{ job_id: string; order: string; ok: boolean; stage?: string; error?: string }> = [];

  for (const job of jobs) {
    if (Date.now() - startedAt > DEADLINE_MS) break;

    // Keep the auto_fulfill stamp through processing so a failure stays queued
    // for the next run; flip to go_live only once Gelato submission succeeds.
    const res = await fulfillJob(job.id, { stampApproval: 'auto_fulfill', triggeredBy: 'auto_fulfill_cron' });

    if (res.ok) {
      await supabaseAdmin
        .from('mug_fulfillment_jobs')
        .update({ manual_approval: 'go_live', updated_at: new Date().toISOString() })
        .eq('id', job.id);
    }

    results.push({ job_id: job.id, order: job.shopify_order_name ?? '', ok: res.ok, stage: res.stage, error: res.error });
    console.log(`[mug-fulfill-approved] ${job.shopify_order_name} → ${res.ok ? 'submitted' : `failed at ${res.stage}: ${res.error}`}`);
  }

  return NextResponse.json({ status: 'ok', processed: results.length, results });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run(req);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run(req);
}
