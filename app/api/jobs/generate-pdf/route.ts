import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { buildMugPrintPdf } from '@/lib/mugs/pdf-template';
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
  // Otherwise pick the oldest eligible received job (cron mode).
  const jobId = req.nextUrl.searchParams.get('job_id');
  const now = new Date().toISOString();

  let query = supabaseAdmin
    .from('mug_fulfillment_jobs')
    .select('id, tile_id, attempts')
    .eq('state', 'received');

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

  // Claim the job: transition received → generating.
  const { data: claimed } = await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .update({ state: 'generating', updated_at: new Date().toISOString() })
    .eq('id', job.id)
    .eq('state', 'received')
    .select('id');

  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ status: 'ok', message: 'Job already claimed by another runner' });
  }

  await logEvent(job.id, 'state_transition', { from_state: 'received', to_state: 'generating' });

  // ── generate ────────────────────────────────────────────────────────────────

  try {
    if (!job.tile_id) throw new Error('tile_id is null — cannot generate PDF without a source image');

    await logEvent(job.id, 'pdf_gen', { payload: { tile_id: job.tile_id } });

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
      .eq('id', job.id);

    await logEvent(job.id, 'state_transition', {
      from_state: 'generating',
      to_state:   'file_ready',
      payload:    { storage_path: storagePath, public_url: publicUrl },
    });

    return NextResponse.json({ status: 'ok', job_id: job.id, url: publicUrl });

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
      from_state: 'generating',
      error:      msg,
      payload:    { attempts },
    });

    console.error(`[generate-pdf] job ${job.id} failed (attempt ${attempts}):`, msg);
    return NextResponse.json({ error: msg, job_id: job.id }, { status: 500 });
  }
}
