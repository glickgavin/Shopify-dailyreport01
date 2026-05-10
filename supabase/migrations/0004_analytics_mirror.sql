-- ─────────────────────────────────────────────────────────────────────────────
-- 0004_analytics_mirror.sql
-- Mirror of remote analytics_events + sync-state bookkeeping
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pg_cron;

-- ── Mirror table ──────────────────────────────────────────────────────────────
create table public.analytics_events_mirror (
  id             uuid        primary key,
  event_name     text        not null,
  event_category text,
  session_id     text,
  user_id        text,
  properties     jsonb,
  page_url       text,
  page_path      text,
  referrer       text,
  user_agent     text,
  device_type    text,
  created_at     timestamptz not null,
  magic_id       text,
  click_id       text,
  email          text,
  synced_at      timestamptz not null default now()
);

-- 1. Time-range pagination (every report filters by created_at)
create index analytics_events_mirror_created_at_idx
  on public.analytics_events_mirror (created_at desc, id desc);

-- 2. Event-name lookups
create index analytics_events_mirror_event_name_created_idx
  on public.analytics_events_mirror (event_name, created_at desc);

-- 3. Category lookups
create index analytics_events_mirror_event_category_created_idx
  on public.analytics_events_mirror (event_category, created_at desc)
  where event_category is not null;

-- 4. Session-level queries
create index analytics_events_mirror_session_created_idx
  on public.analytics_events_mirror (session_id, created_at)
  where session_id is not null;

-- 5. Email-level queries
create index analytics_events_mirror_email_created_idx
  on public.analytics_events_mirror (email, created_at)
  where email is not null;

-- 6. JSONB property filters
create index analytics_events_mirror_properties_gin_idx
  on public.analytics_events_mirror using gin (properties);

-- 7. Device split-by
create index analytics_events_mirror_device_created_idx
  on public.analytics_events_mirror (device_type, created_at desc)
  where device_type is not null;

alter table public.analytics_events_mirror enable row level security;

create policy "service role full access" on public.analytics_events_mirror
  for all to service_role using (true) with check (true);

create policy "anon read" on public.analytics_events_mirror
  for select using (true);

-- ── Sync state (single row) ───────────────────────────────────────────────────
create table public.analytics_sync_state (
  id                         int         primary key default 1 check (id = 1),
  last_synced_created_at     timestamptz,
  backfill_complete          boolean     not null default false,
  backfill_oldest_synced_at  timestamptz,
  backfill_target_at         timestamptz,
  last_run_at                timestamptz,
  last_run_status            text,
  last_run_rows              int,
  last_run_error             text,
  updated_at                 timestamptz not null default now()
);

insert into public.analytics_sync_state (id) values (1) on conflict do nothing;

alter table public.analytics_sync_state enable row level security;

create policy "service role full access" on public.analytics_sync_state
  for all to service_role using (true) with check (true);

create policy "anon read" on public.analytics_sync_state
  for select using (true);

create trigger trg_sync_state_touch
  before update on public.analytics_sync_state
  for each row execute function public.touch_updated_at();

-- ── Sync run log ──────────────────────────────────────────────────────────────
create table public.analytics_sync_runs (
  id              uuid        primary key default gen_random_uuid(),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  kind            text        not null check (kind in ('forward','backfill','manual')),
  rows_fetched    int         not null default 0,
  rows_inserted   int         not null default 0,
  pages_fetched   int         not null default 0,
  http_status     int,
  error           text,
  watermark_before_created_at timestamptz,
  watermark_after_created_at  timestamptz
);

create index analytics_sync_runs_started_idx
  on public.analytics_sync_runs (started_at desc);

alter table public.analytics_sync_runs enable row level security;

create policy "service role full access" on public.analytics_sync_runs
  for all to service_role using (true) with check (true);

create policy "anon read" on public.analytics_sync_runs
  for select using (true);

-- ── pg_cron: prune old run logs daily at 03:00 ───────────────────────────────
select cron.schedule(
  'analytics-sync-runs-cleanup',
  '0 3 * * *',
  $$ delete from public.analytics_sync_runs where started_at < now() - interval '30 days' $$
);
