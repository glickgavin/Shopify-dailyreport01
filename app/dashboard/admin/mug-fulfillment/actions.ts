'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { buildMugPrintPdf } from '@/lib/mugs/pdf-template';
import { findOrderByReference, patchOrder, createDraftOrder, patchDraftToOrder } from '@/lib/mugs/gelato';
import { shopifyGraphQL } from '@/lib/shopify';
import type { Json } from '@/lib/types/database';

const MAGIC_MUG_PRODUCT_IDS = ['8600824643780'];

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

// ── approval actions ──────────────────────────────────────────────────────────

export async function approvePdf(formData: FormData) {
  const jobId = formData.get('job_id') as string;
  await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .update({ manual_approval: 'pdf_only', updated_at: new Date().toISOString() })
    .eq('id', jobId);
  await logEvent(jobId, 'admin_approval', { payload: { approval: 'pdf_only' } });
  revalidatePath('/dashboard/admin/mug-fulfillment');
}

export async function approveSubmit(formData: FormData) {
  const jobId = formData.get('job_id') as string;
  await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .update({ manual_approval: 'submit', updated_at: new Date().toISOString() })
    .eq('id', jobId);
  await logEvent(jobId, 'admin_approval', { payload: { approval: 'submit' } });
  revalidatePath('/dashboard/admin/mug-fulfillment');
}

export async function approveGoLive(formData: FormData) {
  const jobId = formData.get('job_id') as string;
  await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .update({ manual_approval: 'go_live', updated_at: new Date().toISOString() })
    .eq('id', jobId);
  await logEvent(jobId, 'admin_approval', { payload: { approval: 'go_live' } });
  revalidatePath('/dashboard/admin/mug-fulfillment');
}

// ── one-click fulfill: approve → generate PDF → submit to Gelato ─────────────

export async function fulfillOrder(formData: FormData) {
  const jobId = formData.get('job_id') as string;

  const { data: job } = await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .select('id, tile_id, tile_override_url, print_file_url, shopify_order_id, shopify_line_item_id, customer_name, shipping_address, attempts, state')
    .eq('id', jobId)
    .in('state', ['received', 'failed'])
    .maybeSingle();

  if (!job) {
    revalidatePath('/dashboard/admin/mug-fulfillment');
    return;
  }

  const fromState = job.state;

  // Record admin approval
  await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .update({ manual_approval: 'go_live', updated_at: new Date().toISOString() })
    .eq('id', jobId);
  await logEvent(jobId, 'admin_approval', { payload: { approval: 'go_live', triggered_by: 'fulfill' } });

  // ── Step 1: Generate PDF (skip if already have a print_file_url) ─────────────
  let printFileUrl = job.print_file_url;

  if (!printFileUrl) {
    const { data: claimed } = await supabaseAdmin
      .from('mug_fulfillment_jobs')
      .update({ state: 'generating', updated_at: new Date().toISOString() })
      .eq('id', jobId)
      .select('id');

    if (!claimed || claimed.length === 0) {
      revalidatePath('/dashboard/admin/mug-fulfillment');
      return;
    }

    await logEvent(jobId, 'state_transition', { from_state: fromState, to_state: 'generating' });

    try {
      if (!job.tile_id) throw new Error('tile_id is null');
      await logEvent(jobId, 'pdf_gen', { payload: { tile_id: job.tile_id } });

      const pdfBuffer  = await buildMugPrintPdf(job.tile_id, job.tile_override_url);
      const storagePath = `mugs/${job.tile_id}.pdf`;

      const { error: uploadErr } = await supabaseAdmin.storage
        .from(process.env.SUPABASE_MUG_PRINTS_BUCKET ?? 'mug-prints')
        .upload(storagePath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

      if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

      const { data: { publicUrl } } = supabaseAdmin.storage
        .from(process.env.SUPABASE_MUG_PRINTS_BUCKET ?? 'mug-prints')
        .getPublicUrl(storagePath);

      printFileUrl = publicUrl;

      await supabaseAdmin
        .from('mug_fulfillment_jobs')
        .update({ state: 'file_ready', print_file_url: publicUrl, updated_at: new Date().toISOString() })
        .eq('id', jobId);

      await logEvent(jobId, 'state_transition', {
        from_state: 'generating',
        to_state:   'file_ready',
        payload:    { storage_path: storagePath, public_url: publicUrl },
      });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await supabaseAdmin
        .from('mug_fulfillment_jobs')
        .update({ state: 'failed', attempts: (job.attempts ?? 0) + 1, last_error: msg, updated_at: new Date().toISOString() })
        .eq('id', jobId);
      await logEvent(jobId, 'error', { from_state: 'generating', error: msg, payload: { attempts: (job.attempts ?? 0) + 1 } });
      revalidatePath('/dashboard/admin/mug-fulfillment');
      return;
    }

  } else {
    await logEvent(jobId, 'pdf_skipped', { payload: { print_file_url: printFileUrl, reason: 'already_generated' } });
    await supabaseAdmin
      .from('mug_fulfillment_jobs')
      .update({ state: 'file_ready', updated_at: new Date().toISOString() })
      .eq('id', jobId);
  }

  // ── Step 2: Submit to Gelato ──────────────────────────────────────────────────
  const { data: claimed2 } = await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .update({ state: 'draft_created', updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('state', 'file_ready')
    .select('id');

  if (!claimed2 || claimed2.length === 0) {
    revalidatePath('/dashboard/admin/mug-fulfillment');
    return;
  }

  await logEvent(jobId, 'state_transition', { from_state: 'file_ready', to_state: 'draft_created' });

  try {
    const address = job.shipping_address as Record<string, string> | null;
    if (!address) throw new Error('shipping_address is null');
    if (!printFileUrl) throw new Error('print_file_url is null');

    const lineItemRef  = String(job.shopify_line_item_id);
    const draftPayload = {
      orderReferenceId:    lineItemRef,
      customerReferenceId: String(job.shopify_order_id),
      currency:            'USD',
      items: [{
        itemReferenceId: lineItemRef,
        productUid:      'mug_product_msz_11-oz_mmat_ceramic-black_cl_4-0',
        quantity:        1,
        files:           [{ type: 'default' as const, url: printFileUrl }],
      }],
      shippingAddress: {
        name:         address.name          ?? job.customer_name ?? '',
        firstName:    address.first_name    ?? '',
        lastName:     address.last_name     ?? '',
        addressLine1: address.address1      ?? '',
        addressLine2: address.address2      ?? undefined,
        city:         address.city          ?? '',
        postCode:     address.zip           ?? '',
        state:        address.province_code ?? address.province ?? undefined,
        country:      address.country_code  ?? address.country  ?? 'US',
        email:        address.email         ?? undefined,
        phone:        address.phone         ?? undefined,
      },
    };

    const existing = await findOrderByReference(lineItemRef);
    let order;

    if (existing) {
      await logEvent(jobId, 'gelato_existing_found', {
        payload: { gelato_order_id: existing.id, status: existing.status },
      });
      order = await patchOrder(existing.id, {
        items: [{ itemReferenceId: lineItemRef, files: [{ type: 'default', url: printFileUrl }] }],
      });
      await logEvent(jobId, 'gelato_patched', { payload: { gelato_order_id: order.id, status: order.status } });
    } else {
      await logEvent(jobId, 'gelato_draft_attempt', { payload: { order_reference_id: lineItemRef } });
      const draft = await createDraftOrder(draftPayload);
      await logEvent(jobId, 'gelato_draft_created', { payload: { gelato_draft_id: draft.id, status: draft.status } });
      order = await patchDraftToOrder(draft.id);
    }

    await supabaseAdmin
      .from('mug_fulfillment_jobs')
      .update({ state: 'submitted', gelato_order_id: order.id, updated_at: new Date().toISOString() })
      .eq('id', jobId);

    await logEvent(jobId, 'state_transition', {
      from_state: 'draft_created',
      to_state:   'submitted',
      payload:    { gelato_order_id: order.id, gelato_status: order.status },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabaseAdmin
      .from('mug_fulfillment_jobs')
      .update({ state: 'failed', attempts: (job.attempts ?? 0) + 1, last_error: msg, updated_at: new Date().toISOString() })
      .eq('id', jobId);
    await logEvent(jobId, 'error', { from_state: 'draft_created', error: msg, payload: { attempts: (job.attempts ?? 0) + 1 } });
  }

  revalidatePath('/dashboard/admin/mug-fulfillment');
}

// ── PDF generation (runs inline — no HTTP hop, no CRON_SECRET needed) ────────

export async function generatePdf(formData: FormData) {
  const jobId = formData.get('job_id') as string;

  // Fetch the job
  const { data: job, error: fetchErr } = await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .select('id, tile_id, tile_override_url, attempts')
    .eq('id', jobId)
    .eq('state', 'received')
    .maybeSingle();

  if (fetchErr || !job) {
    revalidatePath('/dashboard/admin/mug-fulfillment');
    return;
  }

  // Claim: received → generating
  const { data: claimed } = await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .update({ state: 'generating', updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('state', 'received')
    .select('id');

  if (!claimed || claimed.length === 0) {
    revalidatePath('/dashboard/admin/mug-fulfillment');
    return;
  }

  await logEvent(jobId, 'state_transition', { from_state: 'received', to_state: 'generating' });

  try {
    if (!job.tile_id) throw new Error('tile_id is null');

    await logEvent(jobId, 'pdf_gen', { payload: { tile_id: job.tile_id } });

    const pdfBuffer = await buildMugPrintPdf(job.tile_id, job.tile_override_url);

    const storagePath = `mugs/${job.tile_id}.pdf`;
    const { error: uploadErr } = await supabaseAdmin.storage
      .from(process.env.SUPABASE_MUG_PRINTS_BUCKET ?? 'mug-prints')
      .upload(storagePath, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    if (uploadErr) throw new Error(`Storage upload failed: ${uploadErr.message}`);

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from(process.env.SUPABASE_MUG_PRINTS_BUCKET ?? 'mug-prints')
      .getPublicUrl(storagePath);

    await supabaseAdmin
      .from('mug_fulfillment_jobs')
      .update({ state: 'file_ready', print_file_url: publicUrl, updated_at: new Date().toISOString() })
      .eq('id', jobId);

    await logEvent(jobId, 'state_transition', {
      from_state: 'generating',
      to_state:   'file_ready',
      payload:    { storage_path: storagePath, public_url: publicUrl },
    });

  } catch (err) {
    const msg      = err instanceof Error ? err.message : String(err);
    const attempts = (job.attempts ?? 0) + 1;

    await supabaseAdmin
      .from('mug_fulfillment_jobs')
      .update({
        state:      'failed',
        attempts,
        last_error: msg,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    await logEvent(jobId, 'error', { from_state: 'generating', error: msg, payload: { attempts } });
  }

  revalidatePath('/dashboard/admin/mug-fulfillment');
}

// ── submit to Gelato (runs inline — no HTTP hop, no CRON_SECRET needed) ─────

export async function submitGelato(formData: FormData) {
  const jobId = formData.get('job_id') as string;

  const { data: job, error: fetchErr } = await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .select('id, tile_id, print_file_url, shopify_order_id, shopify_line_item_id, customer_name, shipping_address, attempts')
    .eq('id', jobId)
    .eq('state', 'file_ready')
    .maybeSingle();

  if (fetchErr || !job) {
    revalidatePath('/dashboard/admin/mug-fulfillment');
    return;
  }

  // Claim: file_ready → draft_created
  const { data: claimed } = await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .update({ state: 'draft_created', updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('state', 'file_ready')
    .select('id');

  if (!claimed || claimed.length === 0) {
    revalidatePath('/dashboard/admin/mug-fulfillment');
    return;
  }

  await logEvent(jobId, 'state_transition', { from_state: 'file_ready', to_state: 'draft_created' });

  try {
    if (!job.print_file_url) throw new Error('print_file_url is null — cannot submit without a print file');

    const address = job.shipping_address as Record<string, string> | null;
    if (!address) throw new Error('shipping_address is null');

    const draftPayload = {
      orderReferenceId:    String(job.shopify_line_item_id),
      customerReferenceId: String(job.shopify_order_id),
      currency:            'USD',
      items: [{
        itemReferenceId: String(job.shopify_line_item_id),
        productUid:      'mug_product_msz_11-oz_mmat_ceramic-black_cl_4-0',
        quantity:        1,
        files:           [{ type: 'default' as const, url: job.print_file_url }],
      }],
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

    // Check if Shopify-Gelato integration already created this order.
    // If so, patch the existing order with the print file rather than creating a duplicate.
    const lineItemRef = String(job.shopify_line_item_id);
    const existing = await findOrderByReference(lineItemRef);

    let order;
    if (existing) {
      await logEvent(jobId, 'gelato_existing_found', {
        payload: { gelato_order_id: existing.id, status: existing.status, source: 'shopify_integration' },
      });
      // Patch the existing order with our print file URL
      order = await patchOrder(existing.id, {
        items: [{
          itemReferenceId: lineItemRef,
          files: [{ type: 'default', url: job.print_file_url }],
        }],
      });
      await logEvent(jobId, 'gelato_patched', {
        payload: { gelato_order_id: order.id, status: order.status },
      });
    } else {
      // No existing Gelato order — create a new one
      await logEvent(jobId, 'gelato_draft_attempt', {
        payload: { order_reference_id: draftPayload.orderReferenceId },
      });
      const draft = await createDraftOrder(draftPayload);
      await logEvent(jobId, 'gelato_draft_created', {
        payload: { gelato_draft_id: draft.id, status: draft.status },
      });
      order = await patchDraftToOrder(draft.id);
    }

    await supabaseAdmin
      .from('mug_fulfillment_jobs')
      .update({
        state:           'submitted',
        gelato_order_id: order.id,
        updated_at:      new Date().toISOString(),
      })
      .eq('id', jobId);

    await logEvent(jobId, 'state_transition', {
      from_state: 'draft_created',
      to_state:   'submitted',
      payload:    { gelato_order_id: order.id, gelato_status: order.status },
    });

  } catch (err) {
    const msg      = err instanceof Error ? err.message : String(err);
    const attempts = (job.attempts ?? 0) + 1;

    await supabaseAdmin
      .from('mug_fulfillment_jobs')
      .update({
        state:      'failed',
        attempts,
        last_error: msg,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    await logEvent(jobId, 'error', { from_state: 'draft_created', error: msg, payload: { attempts } });
  }

  revalidatePath('/dashboard/admin/mug-fulfillment');
}

// ── tile override ─────────────────────────────────────────────────────────────

export async function setTileOverrideUrl(formData: FormData) {
  const jobId = formData.get('job_id') as string;
  const url   = (formData.get('tile_override_url') as string)?.trim() || null;
  await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .update({ tile_override_url: url, updated_at: new Date().toISOString() })
    .eq('id', jobId);
  await logEvent(jobId, 'admin_set_tile_override', { payload: { tile_override_url: url } });
  revalidatePath('/dashboard/admin/mug-fulfillment');
}

// ── cancel / reset ────────────────────────────────────────────────────────────

export async function cancelJob(formData: FormData) {
  const jobId = formData.get('job_id') as string;
  await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .update({
      state:           'failed',
      manual_approval: 'cancelled',
      last_error:      'Cancelled by admin',
      updated_at:      new Date().toISOString(),
    })
    .eq('id', jobId);
  await logEvent(jobId, 'admin_cancel', {});
  revalidatePath('/dashboard/admin/mug-fulfillment');
}

export async function resetToReceived(formData: FormData) {
  const jobId = formData.get('job_id') as string;
  await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .update({
      state:           'received',
      manual_approval: null,
      last_error:      null,
      next_attempt_at: null,
      attempts:        0,
      print_file_url:  null,
      gelato_order_id: null,
      gelato_draft_id: null,
      updated_at:      new Date().toISOString(),
    })
    .eq('id', jobId);
  await logEvent(jobId, 'admin_reset', { payload: { to_state: 'received' } });
  revalidatePath('/dashboard/admin/mug-fulfillment');
}

// ── single-order backfill ────────────────────────────────────────────────────

const ORDER_QUERY = `
  query GetOrder($id: ID!) {
    order(id: $id) {
      id name createdAt
      customer { firstName lastName }
      shippingAddress {
        firstName lastName address1 address2
        city provinceCode zip countryCode phone
      }
      lineItems(first: 50) {
        nodes {
          id title
          product { id }
          customAttributes { key value }
        }
      }
    }
  }
`;

interface GQLOrderResult {
  order: {
    id: string; name: string; createdAt: string;
    customer: { firstName: string; lastName: string } | null;
    shippingAddress: Record<string, string> | null;
    lineItems: { nodes: Array<{
      id: string; title: string;
      product: { id: string } | null;
      customAttributes: Array<{ key: string; value: string }>;
    }> };
  } | null;
}

export async function backfillSingleOrder(_prev: unknown, formData: FormData): Promise<{ ok: boolean; message: string }> {
  const raw = (formData.get('shopify_order_id') as string)?.trim();
  if (!raw) return { ok: false, message: 'No order ID provided' };

  // Accept either the numeric ID or a full URL — extract just the numeric part
  const numeric = raw.replace(/\D/g, '');
  if (!numeric) return { ok: false, message: 'Could not parse a numeric order ID from input' };

  const gid = `gid://shopify/Order/${numeric}`;

  let result: GQLOrderResult;
  try {
    result = await shopifyGraphQL<GQLOrderResult>(ORDER_QUERY, { id: gid });
  } catch (err) {
    return { ok: false, message: `Shopify fetch failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const order = result.order;
  if (!order) return { ok: false, message: `Order ${numeric} not found in Shopify` };

  const mugLineItems = order.lineItems.nodes.filter(li => {
    const pid = li.product?.id?.split('/').pop();
    return pid && MAGIC_MUG_PRODUCT_IDS.includes(pid);
  });

  if (mugLineItems.length === 0) {
    return { ok: false, message: `No Magic Mug line items found on order ${order.name}` };
  }

  const addr = order.shippingAddress;
  const customerName = order.customer
    ? `${order.customer.firstName} ${order.customer.lastName}`.trim()
    : addr ? `${addr.firstName ?? ''} ${addr.lastName ?? ''}`.trim() : '';

  let inserted = 0, skipped = 0;

  for (const li of mugLineItems) {
    const liNumeric = li.id.split('/').pop()!;
    const tileId    = li.customAttributes.find(a => a.key === '_mug_portrait_tile_id')?.value ?? null;
    const printUrl  = li.customAttributes.find(a => a.key === '_print_file_url')?.value ?? null;
    const gelatoUid = li.customAttributes.find(a => a.key === '_gelato_product_uid')?.value ?? null;

    // Skip if already in DB
    const { data: existing } = await supabaseAdmin
      .from('mug_fulfillment_jobs')
      .select('id')
      .eq('shopify_line_item_id', liNumeric)
      .maybeSingle();

    if (existing) { skipped++; continue; }

    await supabaseAdmin.from('mug_fulfillment_jobs').insert({
      shopify_order_id:      numeric,
      shopify_order_name:    order.name,
      shopify_line_item_id:  liNumeric,
      customer_name:         customerName,
      shipping_address:      (addr ?? null) as Json | null,
      state:                 'received',
      tile_id:               tileId,
      gelato_product_uid:    gelatoUid ?? 'mug_product_msz_11-oz_mmat_ceramic-black_cl_4-0',
      attempts:              0,
      created_at:            order.createdAt,
    });

    inserted++;
  }

  revalidatePath('/dashboard/admin/mug-fulfillment');

  if (inserted === 0 && skipped > 0) return { ok: true, message: `Order ${order.name} already in DB (skipped ${skipped} line item(s))` };
  return { ok: true, message: `Backfilled ${inserted} line item(s) from ${order.name}${skipped ? `, ${skipped} already existed` : ''}` };
}
