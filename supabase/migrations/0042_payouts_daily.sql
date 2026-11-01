-- Actual cash received: one row per payout/withdrawal to the bank.
-- stripe  — Stripe Payouts API (net of fees, by arrival date)
-- paypal  — T04xx bank withdrawals parsed from paypal_daily_snapshot payloads
-- shopify — Shopify Payments payouts (requires read_shopify_payments scope)
-- Applied live as payouts_daily.

create table payouts_daily (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('stripe','paypal','shopify')),
  payout_id text not null unique,
  payout_date date not null,
  amount_cents bigint not null,
  status text,
  created_at timestamptz not null default now()
);
create index on payouts_daily (provider, payout_date);
alter table payouts_daily enable row level security;
