import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { sweepStripe } from '@/lib/stripe-credit';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Polling ingestion for the Stripe → store credit system (every 10 minutes).
// Lists paid invoices + refunds from the last 24h via the Stripe API and runs
// the idempotent credit/debit engine over anything not yet processed — no
// Stripe webhook registration needed. Supports ?lookback_hours= for manual
// wider sweeps.

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization');
  const query = req.nextUrl.searchParams.get('secret');
  return header === `Bearer ${secret}` || query === secret;
}

async function run(req: NextRequest): Promise<NextResponse> {
  const lookbackParam = Number(req.nextUrl.searchParams.get('lookback_hours'));
  const lookbackHours = Number.isFinite(lookbackParam) && lookbackParam > 0 && lookbackParam <= 24 * 14
    ? lookbackParam
    : 24;

  const summary = await sweepStripe(lookbackHours);

  if (summary.invoicesProcessed > 0 || summary.chargesProcessed > 0) {
    const credited = summary.creditResults.filter(r => r.status === 'success').length;
    const debited  = summary.refundResults.filter(r => r.status === 'success').length;
    const failed   = [...summary.creditResults, ...summary.refundResults].filter(r => r.status === 'failed' || r.status === 'error').length;
    await (supabaseAdmin as any).from('job_logs').insert({
      date: new Date().toISOString().slice(0, 10),
      job_type: 'stripe_credit_sweep',
      status: failed > 0 ? 'error' : 'success',
      message: `invoices=${summary.invoicesProcessed} credited=${credited} charges=${summary.chargesProcessed} debited=${debited} failed=${failed}`,
    });
  }

  return NextResponse.json({ status: 'ok', ...summary });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run(req);
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return run(req);
}
