-- Per-campaign, per-day Meta insights snapshot (spend, purchases, attributed
-- purchase revenue via action_values). Written by the meta-insights cron,
-- which re-upserts a trailing window each run so late attribution updates
-- self-correct. Service-role access only.
create table if not exists meta_insights_daily (
  id            uuid primary key default gen_random_uuid(),
  date          date not null,
  campaign_id   text not null,
  campaign_name text,
  spend         numeric not null default 0,
  impressions   integer not null default 0,
  clicks        integer,
  purchases     integer not null default 0,
  revenue       numeric,
  fetched_at    timestamptz not null default now(),
  unique (date, campaign_id)
);
create index if not exists meta_insights_daily_date_idx on meta_insights_daily (date);
alter table meta_insights_daily enable row level security;
