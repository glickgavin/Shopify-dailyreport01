-- Per-member store-credit breakdown for the Membership 2025 segment,
-- refreshed by /api/cron/membership-active alongside the daily snapshot.
-- Applied live as membership_credit_members.

create table membership_credit_members (
  customer_id   text primary key,
  email         text,
  display_name  text,
  credit_cents  bigint not null,
  currency      text,
  snapshot_date date not null,
  computed_at   timestamptz not null default now()
);
alter table membership_credit_members enable row level security;
