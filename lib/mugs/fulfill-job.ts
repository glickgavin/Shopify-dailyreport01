import { supabaseAdmin } from '@/lib/supabase';
import { buildMugPrintPdf } from '@/lib/mugs/pdf-template';
import { findOrderByReference, patchOrder, createDraftOrder, patchDraftToOrder, cancelOrder } from '@/lib/mugs/gelato';
import { fetchMugReadyStatus } from '@/lib/mugs/mug-ready';
import type { Json } from '@/lib/types/database';

// Core "Fulfill" pipeline for one mug job: approve → verify/regenerate the
// print PDF (honouring any customer re-selection via the mug:ready metafield)
// → submit to Gelato. Extracted from the admin server action so the
// mug-fulfill-approved cron can run the identical flow headlessly.

export interface FulfillResult {
  ok: boolean;
  jobId: string;
  stage: 'fetch' | 'claim' | 'pdf' | 'gelato' | 'done';
  error?: string;
}

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

// ── mug:ready customer re-selection resolver ──────────────────────────────────

interface MugReadyOverride {
  tileId: string | null;
  tileOverrideUrl: string | null;
}

export async function applyMugReadyOverride(
  jobId: string,
  shopifyOrderId: string,
  currentTileId: string | null,
): Promise<MugReadyOverride> {
  try {
    const status = await fetchMugReadyStatus(shopifyOrderId);

    if (!status.ready || !status.imageUrl) {
      return { tileId: currentTileId, tileOverrideUrl: null };
    }

    const newTileId = status.tileId ?? currentTileId;

    await supabaseAdmin
      .from('mug_fulfillment_jobs')
      .update({ tile_id: newTileId, tile_override_url: status.imageUrl, updated_at: new Date().toISOString() })
      .eq('id', jobId);

    await logEvent(jobId, 'customer_reselection_applied', {
      payload: {
        original_tile_id:     currentTileId,
        new_tile_id:          newTileId,
        image_url:            status.imageUrl,
        source:               status.source,
        metafield_updated_at: status.metafieldUpdatedAt,
      },
    });

    return { tileId: newTileId, tileOverrideUrl: status.imageUrl };
  } catch (err) {
    await logEvent(jobId, 'customer_reselection_check_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { tileId: currentTileId, tileOverrideUrl: null };
  }
}

// ── fulfill: approve → generate PDF → submit to Gelato ────────────────────────

export async function fulfillJob(
  jobId: string,
  opts: { stampApproval?: string; triggeredBy?: string } = {},
): Promise<FulfillResult> {
  const stampApproval = opts.stampApproval ?? 'go_live';
  const triggeredBy   = opts.triggeredBy   ?? 'fulfill';

  const { data: job } = await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .select('id, tile_id, tile_override_url, print_file_url, shopify_order_id, shopify_line_item_id, customer_name, shipping_address, attempts, state')
    .eq('id', jobId)
    .in('state', ['received', 'failed'])
    .maybeSingle();

  if (!job) {
    return { ok: false, jobId, stage: 'fetch', error: 'Job not found or not in received/failed state' };
  }

  const fromState = job.state;

  // Record admin approval
  await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .update({ manual_approval: stampApproval, updated_at: new Date().toISOString() })
    .eq('id', jobId);
  await logEvent(jobId, 'admin_approval', { payload: { approval: stampApproval, triggered_by: triggeredBy } });

  // ── Step 1: Generate PDF (skip if already have a print_file_url AND file exists) ──
  let printFileUrl = job.print_file_url;

  // Webhook pre-populates print_file_url from Shopify order attributes before any PDF is
  // uploaded here. Verify the file actually exists in storage before trusting the URL.
  if (printFileUrl) {
    const { data: listed } = await supabaseAdmin.storage
      .from(process.env.SUPABASE_MUG_PRINTS_BUCKET ?? 'mug-prints')
      .list('mugs', { search: `${job.tile_id}.pdf` });
    if (!listed || listed.length === 0) {
      await logEvent(jobId, 'pdf_url_stale', {
        payload: { stale_url: printFileUrl, reason: 'file_not_in_storage' },
      });
      await supabaseAdmin
        .from('mug_fulfillment_jobs')
        .update({ print_file_url: null, updated_at: new Date().toISOString() })
        .eq('id', jobId);
      printFileUrl = null;
    }
  }

  // Check for customer re-selection via mug:ready tag before generating PDF
  const { tileId: effectiveTileId, tileOverrideUrl: effectiveOverrideUrl } =
    await applyMugReadyOverride(jobId, String(job.shopify_order_id), job.tile_id);

  // If the customer re-selected, clear any cached PDF so we regenerate with the new image
  if (effectiveOverrideUrl && printFileUrl) {
    await supabaseAdmin
      .from('mug_fulfillment_jobs')
      .update({ print_file_url: null, updated_at: new Date().toISOString() })
      .eq('id', jobId);
    await logEvent(jobId, 'pdf_regeneration_required', {
      payload: { reason: 'mug:ready_customer_reselection', cleared_url: printFileUrl },
    });
    printFileUrl = null;
  }

  if (!printFileUrl) {
    const { data: claimed } = await supabaseAdmin
      .from('mug_fulfillment_jobs')
      .update({ state: 'generating', updated_at: new Date().toISOString() })
      .eq('id', jobId)
      .select('id');

    if (!claimed || claimed.length === 0) {
      return { ok: false, jobId, stage: 'claim', error: 'Could not claim job for PDF generation' };
    }

    await logEvent(jobId, 'state_transition', { from_state: fromState, to_state: 'generating' });

    try {
      if (!effectiveTileId) throw new Error('tile_id is null');
      await logEvent(jobId, 'pdf_gen', { payload: { tile_id: effectiveTileId, override_url: effectiveOverrideUrl ?? null } });

      const pdfBuffer  = await buildMugPrintPdf(effectiveTileId, effectiveOverrideUrl ?? job.tile_override_url);
      const storagePath = `mugs/${effectiveTileId}.pdf`;

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
      return { ok: false, jobId, stage: 'pdf', error: msg };
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
    return { ok: false, jobId, stage: 'claim', error: 'Could not claim job for Gelato submission' };
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

    // Only a draft order can have its print file patched. A placed (live) order's
    // files are immutable — Gelato returns 550 if you try. A found order here is
    // almost always a stale order from a prior attempt (re-fulfill after reset), so
    // cancel it and create a fresh draft with the new file.
    const existingIsDraft = (existing?.status ?? '').toLowerCase() === 'draft';

    if (existing && existingIsDraft) {
      await logEvent(jobId, 'gelato_existing_found', {
        payload: { gelato_order_id: existing.id, status: existing.status, action: 'patch' },
      });
      order = await patchOrder(existing.id, {
        items: [{ itemReferenceId: lineItemRef, files: [{ type: 'default', url: printFileUrl }] }],
      });
      await logEvent(jobId, 'gelato_patched', { payload: { gelato_order_id: order.id, status: order.status } });
    } else {
      if (existing) {
        await logEvent(jobId, 'gelato_existing_found', {
          payload: { gelato_order_id: existing.id, status: existing.status, action: 'cancel_and_recreate' },
        });
        // Best-effort cancel of the stale order — don't let a cancel failure block resubmission.
        try {
          await cancelOrder(existing.id);
          await logEvent(jobId, 'gelato_stale_cancelled', { payload: { gelato_order_id: existing.id } });
        } catch (cancelErr) {
          await logEvent(jobId, 'gelato_stale_cancel_failed', {
            payload: { gelato_order_id: existing.id, error: cancelErr instanceof Error ? cancelErr.message : String(cancelErr) },
          });
        }
      }
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

    return { ok: true, jobId, stage: 'done' };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabaseAdmin
      .from('mug_fulfillment_jobs')
      .update({ state: 'failed', attempts: (job.attempts ?? 0) + 1, last_error: msg, updated_at: new Date().toISOString() })
      .eq('id', jobId);
    await logEvent(jobId, 'error', { from_state: 'draft_created', error: msg, payload: { attempts: (job.attempts ?? 0) + 1 } });
    return { ok: false, jobId, stage: 'gelato', error: msg };
  }
}
