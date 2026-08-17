import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { retryFailedAllocations } from '@/lib/stripe-credit';

export const runtime = 'nodejs';
export const maxDuration = 120;

// Hourly retry of failed Stripe→store-credit allocations. Max 10 rows/run,
// max 5 attempts/row, 1s throttle between Shopify calls. No-ops (skipped)
// while the config kill switch is off.

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization');
  const query = req.nextUrl.searchParams.get('secret');
  return header === `Bearer ${secret}` || query === secret;
}

async function run(): Promise<NextResponse> {
  const summary = await retryFailedAllocations({ limit: 10, maxRetries: 5 });

  if (summary.retried > 0) {
    await (supabaseAdmin as any).from('job_logs').insert({
      date: new Date().toISOString().slice(0, 10),
      job_type: 'stripe_credit_retry',
      status: summary.failed > 0 ? 'error' : 'success',
      message: `retried=${summary.retried} succeeded=${summary.succeeded} failed=${summary.failed} skipped=${summary.skipped}`,
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
