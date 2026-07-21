import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { getOrderStatus, extractGelatoTracking, gelatoTrackingDebugSnapshot } from '@/lib/mugs/gelato';
import { pushTrackingToShopify } from '@/lib/mugs/shopify-fulfillment';
import type { Database, Json } from '@/lib/types/database';

type MugJobUpdate = Database['public']['Tables']['mug_fulfillment_jobs']['Update'];

export const runtime = 'nodejs';
export const maxDuration = 300;

// Reconcile cron — runs every 10 minutes via Vercel cron.
// Drives three actions:
//   1. Kick pending generate-pdf / submit-gelato jobs stuck in failed state
//      but whose backoff window has passed (reset to previous state).
//   2. Poll Gelato for submitted/passed/printed jobs and advance state.
//   3. Retry Shopify fulfillment push for shipped/delivered jobs that never got one.

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
    requeued:        0,
    polled:          0,
    advanced:        0,
    shopify_retried: 0,
    errors:          0,
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
    .select('id, gelato_order_id, state, attempts, shopify_order_id, shopify_line_item_id, quantity')
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

      // Capture tracking info when shipped/delivered. Gelato exposes tracking in
      // several shapes; extractGelatoTracking checks all of them.
      let tracking = extractGelatoTracking(gelatoOrder);
      if (newState === 'shipped' || newState === 'delivered') {
        if (tracking.trackingCode)    updatePayload.tracking_number  = tracking.trackingCode;
        if (tracking.trackingUrl)     updatePayload.tracking_url     = tracking.trackingUrl;
        if (tracking.trackingCompany) updatePayload.tracking_company = tracking.trackingCompany;

        // If we advanced to shipped but no tracking code yet, log the raw shape
        // so we can confirm the field structure — tracking often lands shortly
        // after the status flip and step 3 will re-poll for it.
        if (!tracking.trackingCode) {
          await logEvent(job.id, 'gelato_tracking_missing', {
            payload: gelatoTrackingDebugSnapshot(gelatoOrder),
          });
        }
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

        // Only push to Shopify once we actually have a tracking number.
        // If it's not there yet, step 3 re-polls shipped jobs until it appears.
        if (newState === 'shipped' && tracking.trackingCode) {
          await pushTrackingToShopify({
            id:                    job.id,
            shopify_order_id:      job.shopify_order_id,
            shopify_line_item_id:  job.shopify_line_item_id,
            shopify_fulfillment_id: null,
            tracking_number:       tracking.trackingCode,
            tracking_url:          tracking.trackingUrl,
            tracking_company:      tracking.trackingCompany,
            quantity:              job.quantity ?? 1,
          });
        }
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

  // ── 3. Re-poll shipped/delivered jobs and push tracking to Shopify ──────────
  // Handles two gaps: (a) tracking codes that arrive AFTER Gelato flips to
  // shipped, and (b) jobs previously stranded with the legacy 'not_found'
  // sentinel. We include null OR 'not_found' so those recover automatically.
  // Order by stalest-first (updated_at asc) so every job is reached in rotation.
  // Without an explicit order, Postgres returns an arbitrary slice under the
  // limit and the same rows get processed each run while the tail is starved
  // (e.g. jobs that have sat in 'not_found' for days never get re-polled).
  const { data: unfulfilledJobs } = await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .select('id, gelato_order_id, shopify_order_id, shopify_line_item_id, quantity, tracking_number, tracking_url, tracking_company')
    .in('state', ['shipped', 'delivered'])
    .or('shopify_fulfillment_id.is.null,shopify_fulfillment_id.eq.not_found')
    .not('gelato_order_id', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(100);

  for (const job of unfulfilledJobs ?? []) {
    try {
      // Re-fetch from Gelato to pick up tracking that may have landed late.
      const gelatoOrder = await getOrderStatus(job.gelato_order_id!);
      const tracking = extractGelatoTracking(gelatoOrder);

      // Persist any newly-found tracking (code and/or carrier).
      const trackingUpdate: MugJobUpdate = {};
      if (tracking.trackingCode    && !job.tracking_number)  trackingUpdate.tracking_number  = tracking.trackingCode;
      if (tracking.trackingUrl     && !job.tracking_url)     trackingUpdate.tracking_url     = tracking.trackingUrl;
      if (tracking.trackingCompany && !job.tracking_company) trackingUpdate.tracking_company = tracking.trackingCompany;
      if (Object.keys(trackingUpdate).length > 0) {
        trackingUpdate.updated_at = new Date().toISOString();
        await supabaseAdmin.from('mug_fulfillment_jobs').update(trackingUpdate).eq('id', job.id);
      }

      const trackingNumber = tracking.trackingCode ?? job.tracking_number ?? null;

      // Without a tracking number there is nothing worth pushing yet. Log the
      // raw shape so we can confirm where Gelato hides the code, then move on —
      // the next run re-checks.
      if (!trackingNumber) {
        await logEvent(job.id, 'gelato_tracking_missing', {
          payload: gelatoTrackingDebugSnapshot(gelatoOrder),
        });
        continue;
      }

      await pushTrackingToShopify({
        id:                    job.id,
        shopify_order_id:      job.shopify_order_id,
        shopify_line_item_id:  job.shopify_line_item_id,
        shopify_fulfillment_id: null,
        tracking_number:       trackingNumber,
        tracking_url:          tracking.trackingUrl     ?? job.tracking_url     ?? null,
        tracking_company:      tracking.trackingCompany ?? job.tracking_company ?? null,
        quantity:              job.quantity ?? 1,
      });

      results.shopify_retried++;
    } catch (err) {
      results.errors++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[reconcile-mugs] shopify retry job ${job.id} error:`, msg);
      await logEvent(job.id, 'error', {
        error:   msg,
        payload: { context: 'shopify_retry' },
      });
    }
  }

  return NextResponse.json({ status: 'ok', ...results });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
