-- Queue of customer emails to tag member-active in Shopify (email → customer
-- lookup → tagsAdd), worked through by the member-tag-backfill cron. Seeded
-- with every Stripe customer that had a paid subscription charge in the last
-- 30 days (from the daily Stripe snapshots), so the base is pre-tagged before
-- the Stripe→store-credit cutover. Unique on email → re-seeding is a no-op.
create table if not exists member_tag_queue (
  id                  uuid primary key default gen_random_uuid(),
  email               text not null unique,
  source              text not null default 'stripe_30d_seed',
  status              text not null default 'pending',  -- pending | tagged | failed
  shopify_customer_id text,
  error               text,
  created_at          timestamptz not null default now(),
  processed_at        timestamptz
);
create index if not exists member_tag_queue_status_idx on member_tag_queue (status);
alter table member_tag_queue enable row level security;

-- Seed: distinct emails from successful direct Stripe charges, last 30 days.
insert into member_tag_queue (email)
select distinct lower(c->>'email')
from stripe_daily_snapshot s,
     jsonb_array_elements(s.payload->'direct_success_charges') as c
where s.date >= current_date - 30
  and c->>'email' is not null
on conflict (email) do nothing;
