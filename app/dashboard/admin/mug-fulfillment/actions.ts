'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { buildMugPrintPdf } from '@/lib/mugs/pdf-template';
import type { Json } from '@/lib/types/database';

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

// ── PDF generation (runs inline — no HTTP hop, no CRON_SECRET needed) ────────

export async function generatePdf(formData: FormData) {
  const jobId = formData.get('job_id') as string;

  // Fetch the job
  const { data: job, error: fetchErr } = await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .select('id, tile_id, attempts')
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

    const pdfBuffer = await buildMugPrintPdf(job.tile_id);

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

// ── submit to Gelato (calls API route with CRON_SECRET) ──────────────────────

export async function submitGelato(formData: FormData) {
  const jobId = formData.get('job_id') as string;
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const base = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';
    await fetch(`${base}/api/jobs/submit-gelato?job_id=${encodeURIComponent(jobId)}`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: 'no-store',
    });
  }
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
      updated_at:      new Date().toISOString(),
    })
    .eq('id', jobId);
  await logEvent(jobId, 'admin_reset', { payload: { to_state: 'received' } });
  revalidatePath('/dashboard/admin/mug-fulfillment');
}
