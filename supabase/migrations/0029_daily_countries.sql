-- Daily country-of-purchase rollup, computed by the pipeline from the same
-- order rows as daily_summary/daily_discounts. One row per (date, country)
-- where country is 'ALL' (blended), '' (no address on order), or an ISO
-- 3166-1 alpha-2 code from the order's shipping (fallback billing) address.
create table if not exists daily_countries (
  id            bigint generated always as identity primary key,
  date          date        not null,
  country       text        not null,
  orders        integer     not null default 0,
  units         integer     not null default 0,
  units_primary integer     not null default 0,
  net_sales     numeric     not null default 0,
  order_value   numeric     not null default 0,
  created_at    timestamptz not null default now(),
  unique (date, country)
);

create index if not exists daily_countries_date_idx on daily_countries (date);

alter table daily_countries enable row level security;

-- Service role bypasses RLS; no anon policies — table is read via the
-- server-side dashboard only, same as daily_discounts.
