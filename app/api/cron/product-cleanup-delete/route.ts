import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { runDeleteWorker } from '@/lib/product-cleanup';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Deletion worker (every 2 min): processes admin-APPROVED batches only, and
// only while the deletion_enabled kill switch is on — otherwise a no-op.
// Time-budgeted (~100s/run) with 3 concurrent deletions and batch roll-over:
// ~400-500 products per run ≈ 12-15k/hour when batches are approved.

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization');
  const query = req.nextUrl.searchParams.get('secret');
  return header === `Bearer ${secret}` || query === secret;
}

async function run(): Promise<NextResponse> {
  const summary = await runDeleteWorker({ timeBudgetMs: 100_000, concurrency: 3, actor: 'cron' });
  if (summary.processed > 0) {
    await (supabaseAdmin as any).from('job_logs').insert({
      date: new Date().toISOString().slice(0, 10),
      job_type: 'product_cleanup_delete',
      status: summary.errors > 0 ? 'error' : 'success',
      message: `batches=${summary.batches.join('+') || '?'} deleted=${summary.deleted} skipped=${summary.skipped} errors=${summary.errors}`,
    });
  }
  return NextResponse.json({ status: 'ok', ...summary });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run();
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run();
}
