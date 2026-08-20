-- Magic Portraits product cleanup system. Deny-by-default: deletion_enabled
-- ships false, the master product is protected in config AND hard-coded in
-- the worker, and every batch needs explicit admin approval.

create table if not exists product_cleanup_config (
  id                    integer primary key default 1 check (id = 1),
  deletion_enabled      boolean not null default false,
  window_start          date not null default '2026-03-01',
  window_end            date not null default '2026-05-31',
  title_pattern         text not null default 'magic portrait',
  protected_product_ids text[] not null default '{gid://shopify/Product/8471707222212}',
  batch_size            integer not null default 5000,
  sync_state            jsonb not null default '{}'::jsonb,
  updated_at            timestamptz not null default now(),
  updated_by            text
);
insert into product_cleanup_config (id) values (1) on conflict (id) do nothing;

create table if not exists product_cleanup_candidates (
  id                 uuid primary key default gen_random_uuid(),
  product_id         text not null unique,
  title              text,
  handle             text,
  product_type       text,
  tags               text[],
  product_status     text,
  shopify_created_at timestamptz,
  is_portrait        boolean not null default false,
  sold               boolean not null default false,
  batch_id           uuid,
  -- candidate | excluded | sold | protected | queued | deleted | error
  status             text not null default 'candidate',
  error              text,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists pcc_status_idx  on product_cleanup_candidates (status);
create index if not exists pcc_batch_idx   on product_cleanup_candidates (batch_id);
create index if not exists pcc_created_idx on product_cleanup_candidates (shopify_created_at);

create table if not exists product_cleanup_batches (
  id            uuid primary key default gen_random_uuid(),
  batch_number  integer not null unique,
  month_label   text,
  size          integer not null default 0,
  -- ready | approved | deleting | done | cancelled
  status        text not null default 'ready',
  approved_by   text,
  approved_at   timestamptz,
  deleted_count integer not null default 0,
  error_count   integer not null default 0,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);

create table if not exists product_cleanup_log (
  id                 uuid primary key default gen_random_uuid(),
  product_id         text not null,
  title              text,
  handle             text,
  shopify_created_at timestamptz,
  batch_id           uuid,
  batch_number       integer,
  snapshot           jsonb,
  result             text not null,       -- deleted | error | skipped
  error              text,
  deleted_by         text,
  created_at         timestamptz not null default now()
);
create index if not exists pcl_created_idx on product_cleanup_log (created_at desc);

-- All-time sold-product ledger (from Shopify order line items via bulk export).
create table if not exists sold_products (
  product_id text primary key,
  first_seen timestamptz not null default now()
);

alter table product_cleanup_config     enable row level security;
alter table product_cleanup_candidates enable row level security;
alter table product_cleanup_batches    enable row level security;
alter table product_cleanup_log        enable row level security;
alter table sold_products              enable row level security;
