create table if not exists public.paypal_daily_snapshot (
  date       date        primary key,
  payload    jsonb       not null,
  fetched_at timestamptz not null default now()
);

create index if not exists idx_pds_fetched_at
  on public.paypal_daily_snapshot (fetched_at desc);

alter table public.paypal_daily_snapshot enable row level security;

create policy "service role full access" on public.paypal_daily_snapshot
  for all to service_role using (true) with check (true);

create policy "anon read" on public.paypal_daily_snapshot
  for select to anon using (true);
