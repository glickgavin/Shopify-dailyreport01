import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import {
  getOrderStatus,
  extractGelatoTracking,
  gelatoTrackingDebugSnapshot,
} from '@/lib/mugs/gelato';
import { pushTrackingToShopify } from '@/lib/mugs/shopify-fulfillment';
import type { Database, Json } from '@/lib/types/database';

type MugJobUpdate = Database['public']['Tables']['mug_fulfillment_jobs']['Update'];

export const runtime = 'nodejs';
export const maxDuration = 300;

// One-off (idempotent) backfill: for every shipped/delivered mug job with
// activity since `since` (default 2026-06-20), re-fetch the Gelato order,
// capture its tracking code, and push a Shopify fulfillment for the mug line
// item only. Safe to run repeatedly — pushTrackingToShopify skips jobs that
// already have a real fulfillment id.
//
// Trigger:  POST/GET /api/admin/backfill-mug-tracking?secret=CRON_SECRET
// Options:  &since=2026-06-20   &limit=200   &debug=1 (include raw Gelato shapes)

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization');
  const query  = req.nextUrl.searchParams.get('secret');
  return header === `Bearer ${secret}` || query === secret;
}

async function logEvent(jobId: string, eventType: string, payload: Record<string, unknown>) {
  await supabaseAdmin.from('mug_fulfillment_events').insert({
    job_id:     jobId,
    event_type: eventType,
    from_state: null,
    to_state:   null,
    payload:    payload as Json,
    error:      null,
  });
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const since   = req.nextUrl.searchParams.get('since') ?? '2026-06-20';
  const limit   = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '200', 10) || 200, 500);
  const debug   = req.nextUrl.searchParams.get('debug') === '1';

  const startedAt  = Date.now();
  const DEADLINE_MS = 270_000; // leave margin under the 300s maxDuration

  const { data: jobs, error } = await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .select('id, shopify_order_name, gelato_order_id, shopify_order_id, shopify_line_item_id, quantity, state, tracking_number, tracking_url, tracking_company, shopify_fulfillment_id')
    .in('state', ['shipped', 'delivered'])
    .not('gelato_order_id', 'is', null)
    .gte('updated_at', since)
    .order('updated_at', { ascending: true })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const summary = {
    since,
    scanned:            0,
    tracking_found:     0,
    tracking_missing:   0,
    fulfillment_created: 0,
    already_fulfilled:  0,
    line_item_not_found: 0,
    errors:             0,
    skipped_deadline:   0,
  };
  const report: Array<Record<string, unknown>> = [];

  for (const job of jobs ?? []) {
    if (Date.now() - startedAt > DEADLINE_MS) {
      summary.skipped_deadline = (jobs?.length ?? 0) - summary.scanned;
      break;
    }
    summary.scanned++;

    const row: Record<string, unknown> = {
      order: job.shopify_order_name,
      state: job.state,
      gelato_order_id: job.gelato_order_id,
    };

    try {
      const gelatoOrder = await getOrderStatus(job.gelato_order_id!);
      const tracking = extractGelatoTracking(gelatoOrder);

      // Persist any newly-found tracking fields.
      const trackingUpdate: MugJobUpdate = {};
      if (tracking.trackingCode    && !job.tracking_number)  trackingUpdate.tracking_number  = tracking.trackingCode;
      if (tracking.trackingUrl     && !job.tracking_url)     trackingUpdate.tracking_url     = tracking.trackingUrl;
      if (tracking.trackingCompany && !job.tracking_company) trackingUpdate.tracking_company = tracking.trackingCompany;
      if (Object.keys(trackingUpdate).length > 0) {
        trackingUpdate.updated_at = new Date().toISOString();
        await supabaseAdmin.from('mug_fulfillment_jobs').update(trackingUpdate).eq('id', job.id);
      }

      const trackingNumber = tracking.trackingCode ?? job.tracking_number ?? null;
      row.tracking_number  = trackingNumber;
      row.tracking_company = tracking.trackingCompany ?? job.tracking_company ?? null;

      if (debug || !trackingNumber) {
        row.gelato_raw = gelatoTrackingDebugSnapshot(gelatoOrder);
      }

      if (!trackingNumber) {
        summary.tracking_missing++;
        row.result = 'no_tracking';
        await logEvent(job.id, 'gelato_tracking_missing', gelatoTrackingDebugSnapshot(gelatoOrder));
        report.push(row);
        continue;
      }

      summary.tracking_found++;

      const push = await pushTrackingToShopify({
        id:                    job.id,
        shopify_order_id:      job.shopify_order_id,
        shopify_line_item_id:  job.shopify_line_item_id,
        shopify_fulfillment_id: job.shopify_fulfillment_id,
        tracking_number:       trackingNumber,
        tracking_url:          tracking.trackingUrl     ?? job.tracking_url     ?? null,
        tracking_company:      tracking.trackingCompany ?? job.tracking_company ?? null,
        quantity:              job.quantity ?? 1,
      });

      row.result = push.status;
      if (push.status === 'created')            summary.fulfillment_created++;
      else if (push.status === 'existing' || push.status === 'already_fulfilled') summary.already_fulfilled++;
      else if (push.status === 'line_item_not_found') summary.line_item_not_found++;
      else if (push.status === 'error')         summary.errors++;
    } catch (err) {
      summary.errors++;
      const msg = err instanceof Error ? err.message : String(err);
      row.result = 'error';
      row.error  = msg;
      console.error(`[backfill-mug-tracking] ${job.shopify_order_name} error:`, msg);
    }

    report.push(row);
  }

  return NextResponse.json({
    status: 'ok',
    elapsed_ms: Date.now() - startedAt,
    ...summary,
    report,
  });
}

export async function POST(req: NextRequest) {
  return GET(req);
}
