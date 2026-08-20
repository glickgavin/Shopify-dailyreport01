import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { runDeleteWorker } from '@/lib/product-cleanup';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Deletion worker (every 5 min): processes admin-APPROVED batches only, and
// only while the deletion_enabled kill switch is on — otherwise a no-op.
// ~150 products per run at ~1.6/sec; a 5,000 batch takes ~3 hours.

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization');
  const query = req.nextUrl.searchParams.get('secret');
  return header === `Bearer ${secret}` || query === secret;
}

async function run(): Promise<NextResponse> {
  const summary = await runDeleteWorker(150, 'cron');
  if (summary.processed > 0) {
    await (supabaseAdmin as any).from('job_logs').insert({
      date: new Date().toISOString().slice(0, 10),
      job_type: 'product_cleanup_delete',
      status: summary.errors > 0 ? 'error' : 'success',
      message: `batch=${summary.batch ?? '?'} deleted=${summary.deleted} skipped=${summary.skipped} errors=${summary.errors}`,
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
