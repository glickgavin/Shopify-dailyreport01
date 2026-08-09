-- ─────────────────────────────────────────────────────────────────────────
-- Per-day discount-code performance, computed by the daily pipeline from the
-- same Shopify GraphQL order fetch that powers daily_summary (same PT days,
-- same net-sales rules, so all numbers tie out with the rest of the dashboard).
--
-- Granularity is a rollup cube so the UI can filter without raw orders:
--   discount_code: 'ALL' = blended (no code filter) | '' = no discount | code
--   product_title: 'ALL' = all products             | specific title
--   variant_title: 'ALL' = all variants             | specific variant (only under a specific title)
-- orders      = DISTINCT orders containing >=1 matching line (exact per cell)
-- units       = matching line-item quantity
-- net_sales   = net sales of the matching lines only
-- order_value = full order value (net sales + shipping, whole order) summed
--               over the distinct matching orders → AOV = order_value / orders
--
-- Applied to Supabase project kztxlpfrullqzphkvkiv; committed for parity.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.daily_discounts (
  date           date    not null,
  discount_code  text    not null,
  product_title  text    not null,
  variant_title  text    not null,
  orders         integer not null default 0,
  units          integer not null default 0,
  net_sales      numeric not null default 0,
  order_value    numeric not null default 0,
  created_at     timestamptz not null default now(),
  primary key (date, discount_code, product_title, variant_title)
);

create index if not exists daily_discounts_code_idx on public.daily_discounts (discount_code, date);
