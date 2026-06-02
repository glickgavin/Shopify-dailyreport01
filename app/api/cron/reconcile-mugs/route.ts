import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getOrderStatus } from '@/lib/mugs/gelato';
import type { Database, Json } from '@/lib/types/database';

type MugJobUpdate = Database['public']['Tables']['mug_fulfillment_jobs']['Update'];

export const runtime = 'nodejs';
export const maxDuration = 300;

// Reconcile cron — runs every 10 minutes via Vercel cron.
// Drives two transitions:
//   1. Kick pending generate-pdf / submit-gelato jobs that are stuck in failed state
//      but whose backoff window has passed (reset to previous state).
//   2. Poll Gelato for submitted/passed/printed jobs and advance state.

async function logEvent(
  jobId: string,
  eventType: string,
  fields: { from_state?: string; to_state?: string; payload?: Record<string, unknown>; error?: string },
) {
  await supabaseAdmin.from('mug_fulfillment_events').insert({
    job_id:     jobId,
    event_type: eventType,
    from_state: fields.from_state ?? null,
    to_state:   fields.to_state   ?? null,
    payload:    (fields.payload ?? null) as Json | null,
    error:      fields.error      ?? null,
  });
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization');
  const query  = req.nextUrl.searchParams.get('secret');
  return header === `Bearer ${secret}` || query === secret;
}

// Map Gelato status → our state
function gelatoStatusToState(status: string | null | undefined): string | null {
  switch ((status ?? '').toLowerCase()) {
    case 'passed':    return 'passed';
    case 'printed':   return 'printed';
    case 'shipped':   return 'shipped';
    case 'delivered': return 'delivered';
    default:          return null;
  }
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date().toISOString();
  const results: Record<string, number> = {
    requeued:  0,
    polled:    0,
    advanced:  0,
    errors:    0,
  };

  // ── 1. Re-queue failed jobs whose backoff window has passed ─────────────────
  // Failed jobs that previously were in 'received' → reset to 'received'
  // Failed jobs that previously were in 'file_ready' → reset to 'file_ready'
  // We use last_error to infer; simpler: reset all failed+expired to 'received'
  // so generate-pdf re-tries and re-uploads before re-submitting.
  const { data: failedJobs } = await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .select('id, attempts')
    .eq('state', 'failed')
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`)
    .limit(20);

  for (const job of failedJobs ?? []) {
    const { error } = await supabaseAdmin
      .from('mug_fulfillment_jobs')
      .update({ state: 'received', updated_at: new Date().toISOString() })
      .eq('id', job.id)
      .eq('state', 'failed');

    if (!error) {
      results.requeued++;
      await logEvent(job.id, 'state_transition', {
        from_state: 'failed',
        to_state:   'received',
        payload:    { reason: 'backoff_expired', attempts: job.attempts },
      });
    }
  }

  // ── 2. Poll Gelato for in-flight orders ────────────────────────────────────
  const { data: inFlightJobs } = await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .select('id, gelato_order_id, state, attempts')
    .in('state', ['submitted', 'passed', 'printed'])
    .not('gelato_order_id', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(20);

  for (const job of inFlightJobs ?? []) {
    results.polled++;
    try {
      const gelatoOrder = await getOrderStatus(job.gelato_order_id!);
      const newState = gelatoStatusToState(gelatoOrder.status);

      if (!newState || newState === job.state) continue;

      const updatePayload: MugJobUpdate = {
        state:      newState,
        updated_at: new Date().toISOString(),
      };

      // Capture tracking info when shipped
      if (newState === 'shipped' || newState === 'delivered') {
        const shipment = gelatoOrder.fulfillment?.shipments?.[0];
        if (shipment?.trackingCode)       updatePayload.tracking_number  = shipment.trackingCode;
        if (shipment?.trackingUrl)        updatePayload.tracking_url     = shipment.trackingUrl;
        if (shipment?.shipmentMethodName) updatePayload.tracking_company = shipment.shipmentMethodName;
      }

      const { error: updateErr } = await supabaseAdmin
        .from('mug_fulfillment_jobs')
        .update(updatePayload)
        .eq('id', job.id)
        .eq('state', job.state);

      if (!updateErr) {
        results.advanced++;
        await logEvent(job.id, 'state_transition', {
          from_state: job.state,
          to_state:   newState,
          payload:    { gelato_status: gelatoOrder.status, state: newState },
        });
      }
    } catch (err) {
      results.errors++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[reconcile-mugs] job ${job.id} poll error:`, msg);
      await logEvent(job.id, 'error', {
        from_state: job.state,
        error:      msg,
        payload:    { context: 'gelato_poll' },
      });
    }
  }

  return NextResponse.json({ status: 'ok', ...results });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
