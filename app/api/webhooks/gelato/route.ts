import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { pushTrackingToShopify } from '@/lib/mugs/shopify-fulfillment';
import type { Database, Json } from '@/lib/types/database';

type MugJobUpdate = Database['public']['Tables']['mug_fulfillment_jobs']['Update'];

export const runtime = 'nodejs';

// Gelato webhook handler — receives status updates for mug print orders.
// Verifies HMAC-SHA256 signature from Gelato-Signature header.
// Advances job state and writes tracking info to Shopify fulfillments.

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

function gelatoStatusToState(status: string | null | undefined): string | null {
  switch ((status ?? '').toLowerCase()) {
    case 'passed':    return 'passed';
    case 'printed':   return 'printed';
    case 'shipped':   return 'shipped';
    case 'delivered': return 'delivered';
    default:          return null;
  }
}


export async function POST(req: NextRequest) {
  const rawBody = Buffer.from(await req.arrayBuffer());

  // Verify Gelato webhook signature
  const webhookSecret = process.env.GELATO_WEBHOOK_SECRET;
  if (webhookSecret) {
    const sig = req.headers.get('gelato-signature') ?? req.headers.get('x-gelato-signature') ?? '';
    const expected = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    const sigBuf      = Buffer.from(sig,      'hex');
    if (expectedBuf.length !== sigBuf.length || !crypto.timingSafeEqual(expectedBuf, sigBuf)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Gelato sends: { event, order: { id, orderReferenceId, status, fulfillment: { shipments: [...] } } }
  const event     = payload.event as string | undefined;
  const order     = payload.order as Record<string, unknown> | undefined;

  if (!order) {
    return NextResponse.json({ ok: true, skipped: 'no order in payload' });
  }

  const gelatoOrderId      = String(order.id ?? '');
  const orderReferenceId   = String(order.orderReferenceId ?? '');  // = shopify_line_item_id
  const gelatoStatus       = String(order.status ?? '');
  const fulfillment        = order.fulfillment as Record<string, unknown> | undefined;
  const shipments          = (fulfillment?.shipments as Array<Record<string, unknown>>) ?? [];
  const firstShipment      = shipments[0] ?? {};

  const newState = gelatoStatusToState(gelatoStatus);

  // Look up job by gelato_order_id first, fall back to orderReferenceId (line_item_id)
  let jobQuery = supabaseAdmin
    .from('mug_fulfillment_jobs')
    .select('id, state, shopify_order_id, shopify_line_item_id, quantity')
    .limit(1);

  if (gelatoOrderId) {
    jobQuery = jobQuery.eq('gelato_order_id', gelatoOrderId);
  } else {
    jobQuery = jobQuery.eq('shopify_line_item_id', orderReferenceId);
  }

  const { data: jobs } = await jobQuery;
  const job = jobs?.[0];

  if (!job) {
    console.warn(`[gelato-webhook] no job found for gelato_order_id=${gelatoOrderId} ref=${orderReferenceId}`);
    return NextResponse.json({ ok: true, skipped: 'job not found' });
  }

  // Always log the raw webhook event
  await logEvent(job.id, 'gelato_webhook', {
    payload: { event, gelato_order_id: gelatoOrderId, gelato_status: gelatoStatus },
  });

  if (!newState || newState === job.state) {
    return NextResponse.json({ ok: true, state: job.state, skipped: 'no state change' });
  }

  const updatePayload: MugJobUpdate = {
    state:      newState,
    updated_at: new Date().toISOString(),
  };

  if (firstShipment.trackingCode)       updatePayload.tracking_number  = firstShipment.trackingCode as string;
  if (firstShipment.trackingUrl)        updatePayload.tracking_url     = firstShipment.trackingUrl as string;
  if (firstShipment.shipmentMethodName) updatePayload.tracking_company = firstShipment.shipmentMethodName as string;

  const { error: updateErr } = await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .update(updatePayload)
    .eq('id', job.id);

  if (updateErr) {
    console.error(`[gelato-webhook] update error:`, updateErr.message);
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  await logEvent(job.id, 'state_transition', {
    from_state: job.state,
    to_state:   newState,
    payload:    { gelato_status: gelatoStatus, event },
  });

  // Push line-item fulfillment + tracking to Shopify once Gelato ships
  if (newState === 'shipped') {
    await pushTrackingToShopify({
      id:                    job.id,
      shopify_order_id:      job.shopify_order_id,
      shopify_line_item_id:  job.shopify_line_item_id,
      shopify_fulfillment_id: null,  // not yet set; idempotency handled inside helper
      tracking_number:       updatePayload.tracking_number  ?? null,
      tracking_url:          updatePayload.tracking_url     ?? null,
      tracking_company:      updatePayload.tracking_company ?? null,
      quantity:              job.quantity ?? 1,
    });
  }

  return NextResponse.json({ ok: true, job_id: job.id, state: newState });
}
