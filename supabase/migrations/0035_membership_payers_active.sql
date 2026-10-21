-- Membership payments & active-members rollups.
-- membership_monthly_payers: distinct paying customers per calendar month per
-- provider (stripe / paypal), filled hourly by /api/cron/membership-payers.
-- membership_active_snapshot: daily count + store-credit total of the
-- "Membership 2025" Shopify segment, filled nightly by /api/cron/membership-active.

create table membership_monthly_payers (
  id            uuid primary key default gen_random_uuid(),
  month         date not null,
  provider      text not null check (provider in ('stripe', 'paypal')),
  unique_payers int  not null,
  payments      int  not null,
  amount_cents  bigint not null,
  computed_at   timestamptz not null default now(),
  unique (month, provider)
);

create table membership_active_snapshot (
  date                     date primary key,
  member_count             int    not null,
  store_credit_total_cents bigint not null,
  accounts_with_credit     int    not null,
  computed_at              timestamptz not null default now()
);

alter table membership_monthly_payers enable row level security;
alter table membership_active_snapshot enable row level security;
