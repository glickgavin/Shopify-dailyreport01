-- All store-credit holders store-wide (from a Shopify bulk export), the
-- source list for widening the migration-credit scan beyond the Membership
-- 2025 segment. Applied live as store_credit_holders.

create table store_credit_holders (
  customer_id   text primary key,
  email         text,
  display_name  text,
  balance_cents bigint not null default 0,
  ingested_at   timestamptz not null default now()
);
alter table store_credit_holders enable row level security;
