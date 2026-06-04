alter table public.mug_fulfillment_jobs
  add column if not exists shopify_fulfillment_id text;

comment on column public.mug_fulfillment_jobs.shopify_fulfillment_id
  is 'Shopify fulfillment GID (numeric part) created when Gelato ships — idempotency key for the Shopify push.';
