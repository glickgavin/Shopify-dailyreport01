import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { createDraftOrder, patchDraftToOrder } from '@/lib/mugs/gelato';
import type { Json } from '@/lib/types/database';

export const runtime = 'nodejs';
export const maxDuration = 300;

// ── helpers ───────────────────────────────────────────────────────────────────

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

function nextAttemptAt(attempts: number): string {
  const ms = Math.min(Math.pow(2, attempts) * 60_000, 4 * 3600_000);
  return new Date(Date.now() + ms).toISOString();
}

// ── route ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const secret  = process.env.CRON_SECRET;
  const auth    = req.headers.get('authorization');
  const qsecret = req.nextUrl.searchParams.get('secret');
  if (!secret || (auth !== `Bearer ${secret}` && qsecret !== secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // When job_id is provided, process only that specific job.
  // Otherwise pick the oldest eligible file_ready job (cron mode).
  const jobId = req.nextUrl.searchParams.get('job_id');
  const now = new Date().toISOString();

  let query = supabaseAdmin
    .from('mug_fulfillment_jobs')
    .select('id, tile_id, print_file_url, shopify_order_id, shopify_line_item_id, customer_name, shipping_address, attempts')
    .eq('state', 'file_ready');

  if (jobId) {
    query = query.eq('id', jobId);
  } else {
    query = (query as typeof query)
      .or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`)
      .order('created_at', { ascending: true })
      .limit(1);
  }

  const { data: job, error: fetchErr } = await query.maybeSingle();

  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!job) {
    return NextResponse.json({ status: 'ok', message: 'No jobs to process' });
  }

  // Claim: file_ready → draft_created (guard prevents double-claim)
  const { data: claimed } = await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .update({ state: 'draft_created', updated_at: new Date().toISOString() })
    .eq('id', job.id)
    .eq('state', 'file_ready')
    .select('id');

  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ status: 'ok', message: 'Job already claimed by another runner' });
  }

  await logEvent(job.id, 'state_transition', { from_state: 'file_ready', to_state: 'draft_created' });

  // ── submit to Gelato ────────────────────────────────────────────────────────

  try {
    if (!job.print_file_url) throw new Error('print_file_url is null — cannot submit without a print file');

    const address = job.shipping_address as Record<string, string> | null;
    if (!address) throw new Error('shipping_address is null');

    const draftPayload = {
      orderReferenceId:    String(job.shopify_line_item_id),
      customerReferenceId: String(job.shopify_order_id),
      currency:            'USD',
      items: [
        {
          itemReferenceId: String(job.shopify_line_item_id),
          productUid:      'mug_product_msz_11-oz_mmat_ceramic-black_cl_4-0',
          quantity:        1,
          files:           [{ type: 'default' as const, url: job.print_file_url }],
        },
      ],
      shippingAddress: {
        name:         address.name         ?? job.customer_name ?? '',
        firstName:    address.first_name   ?? '',
        lastName:     address.last_name    ?? '',
        addressLine1: address.address1     ?? '',
        addressLine2: address.address2     ?? undefined,
        city:         address.city         ?? '',
        postCode:     address.zip          ?? '',
        state:        address.province_code ?? address.province ?? undefined,
        country:      address.country_code ?? address.country ?? 'US',
        email:        address.email        ?? undefined,
        phone:        address.phone        ?? undefined,
      },
    };

    await logEvent(job.id, 'gelato_draft_attempt', {
      payload: { order_reference_id: draftPayload.orderReferenceId },
    });

    const draft = await createDraftOrder(draftPayload);

    await logEvent(job.id, 'gelato_draft_created', {
      payload: { gelato_draft_id: draft.id, status: draft.status },
    });

    const order = await patchDraftToOrder(draft.id);

    await supabaseAdmin
      .from('mug_fulfillment_jobs')
      .update({
        state:           'submitted',
        gelato_order_id: order.id,
        updated_at:      new Date().toISOString(),
      })
      .eq('id', job.id);

    await logEvent(job.id, 'state_transition', {
      from_state: 'draft_created',
      to_state:   'submitted',
      payload:    { gelato_order_id: order.id, gelato_status: order.status },
    });

    return NextResponse.json({ status: 'ok', job_id: job.id, gelato_order_id: order.id });

  } catch (err) {
    const msg      = err instanceof Error ? err.message : String(err);
    const attempts = (job.attempts ?? 0) + 1;

    await supabaseAdmin
      .from('mug_fulfillment_jobs')
      .update({
        state:           'failed',
        attempts,
        last_error:      msg,
        next_attempt_at: nextAttemptAt(attempts),
        updated_at:      new Date().toISOString(),
      })
      .eq('id', job.id);

    await logEvent(job.id, 'error', {
      from_state: 'draft_created',
      error:      msg,
      payload:    { attempts },
    });

    console.error(`[submit-gelato] job ${job.id} failed (attempt ${attempts}):`, msg);
    return NextResponse.json({ error: msg, job_id: job.id }, { status: 500 });
  }
}
