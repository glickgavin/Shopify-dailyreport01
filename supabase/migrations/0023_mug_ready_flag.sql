-- Track whether the customer has confirmed their mug selection via the
-- mug:ready Shopify tag + custom.mug_choice metafield. Populated by the
-- /api/cron/mug-ready-scan cron (every 15 min, last-3-days window).

alter table public.mug_fulfillment_jobs
  add column if not exists mug_ready            boolean     not null default false,
  add column if not exists mug_ready_at         timestamptz,
  add column if not exists mug_ready_checked_at timestamptz;

comment on column public.mug_fulfillment_jobs.mug_ready
  is 'True when the Shopify order has both the mug:ready tag AND a parseable custom.mug_choice metafield with an image_url.';

comment on column public.mug_fulfillment_jobs.mug_ready_at
  is 'First timestamp when mug_ready flipped to true (i.e., when the customer confirmed).';

comment on column public.mug_fulfillment_jobs.mug_ready_checked_at
  is 'Last time the mug-ready-scan cron polled Shopify for this job''s order.';

create index if not exists mug_jobs_mug_ready_idx
  on public.mug_fulfillment_jobs (mug_ready)
  where mug_ready = true;
