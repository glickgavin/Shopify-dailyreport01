-- Add manual_approval gate to mug_fulfillment_jobs.
-- Values: NULL (no approval yet) | 'pdf_only' | 'submit' | 'go_live' | 'cancelled'
alter table public.mug_fulfillment_jobs
  add column if not exists manual_approval text
    constraint mug_jobs_approval_check check (manual_approval in ('pdf_only','submit','go_live','cancelled'));
