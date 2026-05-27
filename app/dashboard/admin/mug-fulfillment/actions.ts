'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';

// All external API calls attach CRON_SECRET server-side — never sent to the browser.

async function callJobApi(path: string, jobId: string): Promise<{ ok: boolean; error?: string }> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return { ok: false, error: 'CRON_SECRET not configured' };

  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';

  const url = `${base}${path}?job_id=${encodeURIComponent(jobId)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${secret}` },
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    return { ok: false, error: body.error ?? `HTTP ${res.status}` };
  }
  return { ok: true };
}

export async function approvePdf(formData: FormData) {
  const jobId = formData.get('job_id') as string;
  await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .update({ manual_approval: 'pdf_only', updated_at: new Date().toISOString() })
    .eq('id', jobId);
  await supabaseAdmin.from('mug_fulfillment_events').insert({
    job_id: jobId, event_type: 'admin_approval', payload: { approval: 'pdf_only' },
  });
  revalidatePath('/dashboard/admin/mug-fulfillment');
}

export async function approveSubmit(formData: FormData) {
  const jobId = formData.get('job_id') as string;
  await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .update({ manual_approval: 'submit', updated_at: new Date().toISOString() })
    .eq('id', jobId);
  await supabaseAdmin.from('mug_fulfillment_events').insert({
    job_id: jobId, event_type: 'admin_approval', payload: { approval: 'submit' },
  });
  revalidatePath('/dashboard/admin/mug-fulfillment');
}

export async function approveGoLive(formData: FormData) {
  const jobId = formData.get('job_id') as string;
  await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .update({ manual_approval: 'go_live', updated_at: new Date().toISOString() })
    .eq('id', jobId);
  await supabaseAdmin.from('mug_fulfillment_events').insert({
    job_id: jobId, event_type: 'admin_approval', payload: { approval: 'go_live' },
  });
  revalidatePath('/dashboard/admin/mug-fulfillment');
}

export async function generatePdf(formData: FormData) {
  const jobId = formData.get('job_id') as string;
  await callJobApi('/api/jobs/generate-pdf', jobId);
  revalidatePath('/dashboard/admin/mug-fulfillment');
}

export async function submitGelato(formData: FormData) {
  const jobId = formData.get('job_id') as string;
  await callJobApi('/api/jobs/submit-gelato', jobId);
  revalidatePath('/dashboard/admin/mug-fulfillment');
}

export async function cancelJob(formData: FormData) {
  const jobId = formData.get('job_id') as string;
  await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .update({
      state: 'failed',
      manual_approval: 'cancelled',
      last_error: 'Cancelled by admin',
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);
  await supabaseAdmin.from('mug_fulfillment_events').insert({
    job_id: jobId, event_type: 'admin_cancel',
  });
  revalidatePath('/dashboard/admin/mug-fulfillment');
}

export async function resetToReceived(formData: FormData) {
  const jobId = formData.get('job_id') as string;
  await supabaseAdmin
    .from('mug_fulfillment_jobs')
    .update({
      state: 'received',
      manual_approval: null,
      last_error: null,
      next_attempt_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);
  await supabaseAdmin.from('mug_fulfillment_events').insert({
    job_id: jobId, event_type: 'admin_reset', payload: { to_state: 'received' },
  });
  revalidatePath('/dashboard/admin/mug-fulfillment');
}
