-- Allow the 'auto_fulfill' manual_approval value used by the
-- /api/cron/mug-fulfill-approved worker. Applied live as
-- mug_jobs_allow_auto_fulfill_approval.

alter table mug_fulfillment_jobs drop constraint mug_jobs_approval_check;
alter table mug_fulfillment_jobs add constraint mug_jobs_approval_check
  check (manual_approval = any (array['pdf_only'::text, 'submit'::text, 'go_live'::text, 'cancelled'::text, 'auto_fulfill'::text]));
