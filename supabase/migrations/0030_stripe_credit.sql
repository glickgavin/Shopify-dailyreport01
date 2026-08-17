-- Stripe invoices → Shopify store credit system (mirrors the PayPal
-- store-credit ledger pattern). Service-role access only: the admin dashboard
-- reads/writes through server-side routes, webhooks/crons use the service
-- role, and no anon/client policies exist.

-- 1. Single-row config: the kill switch and allocation rules.
create table if not exists stripe_credit_config (
  id                    integer primary key default 1 check (id = 1),
  allocation_enabled    boolean not null default false,
  allocation_percentage integer not null default 100 check (allocation_percentage between 0 and 100),
  min_amount_cents      integer not null default 0,
  max_amount_cents      integer,
  eligible_currencies   text[]  not null default '{USD}',
  updated_at            timestamptz not null default now(),
  updated_by            text
);
insert into stripe_credit_config (id) values (1) on conflict (id) do nothing;

-- 2. One row per Stripe invoice seen by the webhook.
create table if not exists stripe_credit_invoices (
  id                  uuid primary key default gen_random_uuid(),
  stripe_invoice_id   text not null unique,
  stripe_customer_id  text,
  customer_email      text,
  amount_paid         integer not null,          -- cents
  currency            text not null,
  status              text not null,             -- Stripe invoice status
  billing_reason      text,
  invoice_data        jsonb not null,
  -- pending → processing → success | failed | skipped
  allocation_status   text not null default 'pending',
  allocation_error    text,
  credit_amount_cents integer,
  shopify_customer_id text,
  credit_reference    text,
  retry_count         integer not null default 0,
  created_at          timestamptz not null default now(),
  processed_at        timestamptz
);
create index if not exists stripe_credit_invoices_status_idx on stripe_credit_invoices (allocation_status);
create index if not exists stripe_credit_invoices_email_idx  on stripe_credit_invoices (customer_email);

-- 3. One row per Stripe refund → proportional store-credit debit.
create table if not exists stripe_credit_refunds (
  id                  uuid primary key default gen_random_uuid(),
  stripe_refund_id    text not null unique,
  stripe_charge_id    text,
  stripe_invoice_id   text,
  customer_email      text,
  amount_refunded     integer not null,          -- cents
  currency            text not null,
  refund_reason       text,
  refund_data         jsonb not null,
  -- pending → processing → success | failed | skipped
  debit_status        text not null default 'pending',
  debit_error         text,
  debit_amount_cents  integer,
  shopify_customer_id text,
  created_at          timestamptz not null default now(),
  processed_at        timestamptz
);
create index if not exists stripe_credit_refunds_invoice_idx on stripe_credit_refunds (stripe_invoice_id);

-- 4. Immutable audit trail: one row per credit/debit attempt.
create table if not exists stripe_credit_logs (
  id                  uuid primary key default gen_random_uuid(),
  invoice_id          uuid references stripe_credit_invoices(id),
  refund_id           uuid references stripe_credit_refunds(id),
  transaction_type    text not null,             -- credit | debit
  shopify_customer_id text,
  customer_email      text,
  amount_cents        integer not null,
  currency            text not null,
  success             boolean not null,
  error_message       text,
  shopify_response    jsonb,
  request_id          text,
  created_at          timestamptz not null default now()
);
create index if not exists stripe_credit_logs_created_idx on stripe_credit_logs (created_at desc);

alter table stripe_credit_config   enable row level security;
alter table stripe_credit_invoices enable row level security;
alter table stripe_credit_refunds  enable row level security;
alter table stripe_credit_logs     enable row level security;
