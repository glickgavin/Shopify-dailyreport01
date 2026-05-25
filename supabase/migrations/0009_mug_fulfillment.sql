-- ─────────────────────────────────────────────────────────────────────────────
-- mug_fulfillment_jobs
-- One row per Magic Mug line item. shopify_line_item_id is the idempotency key.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.mug_fulfillment_jobs (
  id                    uuid        primary key default gen_random_uuid(),
  shopify_order_id      text        not null,
  shopify_order_name    text        not null,
  shopify_line_item_id  text        not null unique,
  tile_id               text,
  print_file_url        text,
  gelato_product_uid    text        not null,
  quantity              int         not null default 1,
  state                 text        not null default 'received'
    constraint mug_jobs_state_check check (state in (
      'received', 'generating', 'file_ready', 'draft_created',
      'submitted', 'passed', 'printed', 'shipped', 'delivered', 'failed'
    )),
  gelato_draft_id       text,
  gelato_order_id       text,
  tracking_number       text,
  tracking_url          text,
  tracking_company      text,
  attempts              int         not null default 0,
  last_error            text,
  next_attempt_at       timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index mug_jobs_state_idx   on public.mug_fulfillment_jobs (state);
create index mug_jobs_order_idx   on public.mug_fulfillment_jobs (shopify_order_id);
create index mug_jobs_created_idx on public.mug_fulfillment_jobs (created_at desc);

alter table public.mug_fulfillment_jobs enable row level security;

create trigger mug_jobs_updated_at
  before update on public.mug_fulfillment_jobs
  for each row execute function public.touch_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- mug_fulfillment_events
-- Append-only audit log. Every API call and state transition writes here.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.mug_fulfillment_events (
  id          uuid        primary key default gen_random_uuid(),
  job_id      uuid        not null
                references public.mug_fulfillment_jobs (id) on delete cascade,
  event_type  text        not null,  -- 'state_transition' | 'gelato_api' | 'shopify_api' | 'pdf_gen' | 'error'
  from_state  text,
  to_state    text,
  payload     jsonb,
  error       text,
  created_at  timestamptz not null default now()
);

create index mug_events_job_idx     on public.mug_fulfillment_events (job_id);
create index mug_events_created_idx on public.mug_fulfillment_events (created_at desc);

alter table public.mug_fulfillment_events enable row level security;


-- ─────────────────────────────────────────────────────────────────────────────
-- Storage bucket: mug-prints
-- Private, service role only. Path: mugs/<tile_id>.pdf
-- ─────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mug-prints',
  'mug-prints',
  false,
  52428800,
  array['application/pdf']
)
on conflict (id) do nothing;
