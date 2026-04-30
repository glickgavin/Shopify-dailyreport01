-- ─────────────────────────────────────────────────────────────────────────────
-- 0001_init.sql  –  Shopify Daily Report schema
-- ─────────────────────────────────────────────────────────────────────────────

-- updated_at auto-touch helper
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── daily_summary ─────────────────────────────────────────────────────────────
create table public.daily_summary (
  date                    date        primary key,

  -- total
  total_revenue           numeric(12,4) not null default 0,
  total_net_sales         numeric(12,4) not null default 0,
  total_shipping          numeric(12,4) not null default 0,
  total_cogs              numeric(12,4) not null default 0,
  total_profit            numeric(12,4) not null default 0,
  total_margin            numeric(8,4)  not null default 0,
  total_orders            integer       not null default 0,
  total_qty               integer       not null default 0,
  total_aov               numeric(12,4) not null default 0,

  -- physical cash
  phys_cash_revenue       numeric(12,4) not null default 0,
  phys_cash_net_sales     numeric(12,4) not null default 0,
  phys_cash_shipping      numeric(12,4) not null default 0,
  phys_cash_cogs          numeric(12,4) not null default 0,
  phys_cash_profit        numeric(12,4) not null default 0,
  phys_cash_margin        numeric(8,4)  not null default 0,
  phys_cash_orders        integer       not null default 0,
  phys_cash_qty           integer       not null default 0,
  phys_cash_aov           numeric(12,4) not null default 0,

  -- physical non-cash
  phys_non_cash_revenue   numeric(12,4) not null default 0,
  phys_non_cash_net_sales numeric(12,4) not null default 0,
  phys_non_cash_shipping  numeric(12,4) not null default 0,
  phys_non_cash_cogs      numeric(12,4) not null default 0,
  phys_non_cash_profit    numeric(12,4) not null default 0,
  phys_non_cash_margin    numeric(8,4)  not null default 0,
  phys_non_cash_orders    integer       not null default 0,
  phys_non_cash_qty       integer       not null default 0,
  phys_non_cash_aov       numeric(12,4) not null default 0,

  -- membership
  mem_revenue             numeric(12,4) not null default 0,
  mem_net_sales           numeric(12,4) not null default 0,
  mem_shipping            numeric(12,4) not null default 0,
  mem_cogs                numeric(12,4) not null default 0,
  mem_profit              numeric(12,4) not null default 0,
  mem_margin              numeric(8,4)  not null default 0,
  mem_orders              integer       not null default 0,
  mem_qty                 integer       not null default 0,
  mem_aov                 numeric(12,4) not null default 0,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

alter table public.daily_summary enable row level security;

create policy "service role full access" on public.daily_summary
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "anon read" on public.daily_summary
  for select using (true);

create trigger trg_daily_summary_updated_at
  before update on public.daily_summary
  for each row execute function touch_updated_at();

-- ── daily_products ────────────────────────────────────────────────────────────
create table public.daily_products (
  id          bigserial     primary key,
  date        date          not null references public.daily_summary(date) on delete cascade,
  title       text          not null,
  variant     text          not null default '',
  item_type   text          not null check (item_type in ('Physical','Membership')),
  net_sales   numeric(12,4) not null default 0,
  shipping    numeric(12,4) not null default 0,
  cogs        numeric(12,4) not null default 0,
  revenue     numeric(12,4) not null default 0,
  qty         integer       not null default 0,
  orders      integer       not null default 0,
  created_at  timestamptz   not null default now()
);

create index idx_daily_products_date on public.daily_products(date);
create unique index idx_daily_products_date_title_variant
  on public.daily_products(date, title, variant);

alter table public.daily_products enable row level security;

create policy "service role full access" on public.daily_products
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "anon read" on public.daily_products
  for select using (true);

-- ── daily_membership_orders ───────────────────────────────────────────────────
create table public.daily_membership_orders (
  id               bigserial   primary key,
  date             date        not null references public.daily_summary(date) on delete cascade,
  order_name       text        not null,
  membership_type  text        not null check (membership_type in ('new','recurring')),
  net_sales        numeric(12,4) not null default 0,
  shipping         numeric(12,4) not null default 0,
  revenue          numeric(12,4) not null default 0,
  created_at       timestamptz not null default now()
);

create index idx_daily_mem_orders_date on public.daily_membership_orders(date);
create unique index idx_daily_mem_orders_date_order
  on public.daily_membership_orders(date, order_name);

alter table public.daily_membership_orders enable row level security;

create policy "service role full access" on public.daily_membership_orders
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create policy "anon read" on public.daily_membership_orders
  for select using (true);

-- ── raw_data ──────────────────────────────────────────────────────────────────
create table public.raw_data (
  id          bigserial   primary key,
  date        date        not null,
  fetched_at  timestamptz not null default now(),
  order_rows  jsonb       not null default '[]',
  payment_rows jsonb      not null default '[]'
);

create index idx_raw_data_date on public.raw_data(date);

alter table public.raw_data enable row level security;

create policy "service role full access" on public.raw_data
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ── job_logs ──────────────────────────────────────────────────────────────────
create table public.job_logs (
  id          bigserial   primary key,
  date        date,
  job_type    text        not null default 'cron',
  status      text        not null check (status in ('started','success','error')),
  message     text,
  meta        jsonb,
  created_at  timestamptz not null default now()
);

create index idx_job_logs_date on public.job_logs(date);
create index idx_job_logs_created_at on public.job_logs(created_at desc);

alter table public.job_logs enable row level security;

create policy "service role full access" on public.job_logs
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
