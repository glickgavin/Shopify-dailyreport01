-- ─────────────────────────────────────────────────────────────────────────────
-- 0014_membership_analytics.sql  –  VIP Membership subscription analytics
-- ─────────────────────────────────────────────────────────────────────────────
-- Three data tables + one singleton sync-state cursor.
--
-- membership_billing_events   – raw, one row per qualifying Shopify line item.
--                               Unique on (shopify_order_id, line_index) so
--                               re-syncs are idempotent.
-- membership_status_snapshots – point-in-time, APPEND-ONLY.  Never overwrite
--                               a past snapshot_date — that immutability is
--                               precisely what makes the table useful.
-- membership_metrics_daily    – computed daily aggregates + JSONB cohort blob.
-- membership_sync_state       – singleton cursor (same pattern as
--                               analytics_sync_state in 0004).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── membership_billing_events ─────────────────────────────────────────────────
create table public.membership_billing_events (
  id                bigserial     primary key,
  shopify_order_id  text          not null,
  line_index        integer       not null default 0,
  customer_id       text          not null,
  charged_at        timestamptz   not null,
  net_amount        numeric(10,2) not null,
  currency          text          not null default 'USD',
  is_intro          boolean       not null default false,
  raw               jsonb         not null default '{}',
  created_at        timestamptz   not null default now(),
  constraint membership_billing_events_order_line_unique
    unique (shopify_order_id, line_index)
);

create index idx_membership_billing_customer
  on public.membership_billing_events(customer_id, charged_at desc);

create index idx_membership_billing_charged_at
  on public.membership_billing_events(charged_at desc);

alter table public.membership_billing_events enable row level security;

create policy "service role full access" on public.membership_billing_events
  for all to service_role using (true) with check (true);

create policy "anon read" on public.membership_billing_events
  for select using (true);

-- ── membership_status_snapshots ───────────────────────────────────────────────
-- APPEND-ONLY: no updated_at, no touch trigger.  Past rows must never change.
create table public.membership_status_snapshots (
  snapshot_date          date          not null,
  customer_id            text          not null,
  was_billed_this_period boolean       not null default false,
  last_charge_amount     numeric(10,2) not null default 0,
  contract_status        text,
  is_active              boolean       not null default false,
  first_seen_month       date          not null,
  created_at             timestamptz   not null default now(),
  primary key (snapshot_date, customer_id)
);

create index idx_mem_snapshots_date
  on public.membership_status_snapshots(snapshot_date desc);

create index idx_mem_snapshots_customer
  on public.membership_status_snapshots(customer_id, snapshot_date desc);

alter table public.membership_status_snapshots enable row level security;

create policy "service role full access" on public.membership_status_snapshots
  for all to service_role using (true) with check (true);

create policy "anon read" on public.membership_status_snapshots
  for select using (true);

-- ── membership_metrics_daily ──────────────────────────────────────────────────
create table public.membership_metrics_daily (
  metric_date         date          primary key,
  active_members      integer       not null default 0,
  new_signups         integer       not null default 0,
  mrr_net             numeric(12,2) not null default 0,
  avg_monthly_churn   numeric(8,4)  not null default 0,
  one_and_done_rate   numeric(8,4)  not null default 0,
  projected_ltv       numeric(12,2) not null default 0,
  conservative_ltv    numeric(12,2) not null default 0,
  -- JSONB blob carries: cohort_triangle, survival_curve,
  -- billing_cycle_distribution, realized_revenue_per_starter
  cohort_data         jsonb         not null default '{}',
  created_at          timestamptz   not null default now(),
  updated_at          timestamptz   not null default now()
);

create trigger trg_membership_metrics_updated_at
  before update on public.membership_metrics_daily
  for each row execute function public.touch_updated_at();

alter table public.membership_metrics_daily enable row level security;

create policy "service role full access" on public.membership_metrics_daily
  for all to service_role using (true) with check (true);

create policy "anon read" on public.membership_metrics_daily
  for select using (true);

-- ── membership_sync_state (singleton cursor) ──────────────────────────────────
create table public.membership_sync_state (
  id                     int         primary key default 1 check (id = 1),
  last_synced_charged_at timestamptz,
  last_run_at            timestamptz,
  last_run_status        text,
  last_run_rows          int,
  last_run_error         text,
  updated_at             timestamptz not null default now()
);

insert into public.membership_sync_state (id) values (1) on conflict do nothing;

create trigger trg_membership_sync_state_touch
  before update on public.membership_sync_state
  for each row execute function public.touch_updated_at();

alter table public.membership_sync_state enable row level security;

create policy "service role full access" on public.membership_sync_state
  for all to service_role using (true) with check (true);

create policy "anon read" on public.membership_sync_state
  for select using (true);
