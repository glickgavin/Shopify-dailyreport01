alter table daily_summary
  add column if not exists amazon_revenue       numeric default 0,
  add column if not exists amazon_net_sales     numeric default 0,
  add column if not exists amazon_shipping      numeric default 0,
  add column if not exists amazon_cogs          numeric default 0,
  add column if not exists amazon_profit        numeric default 0,
  add column if not exists amazon_margin        numeric default 0,
  add column if not exists amazon_orders        integer default 0,
  add column if not exists amazon_qty           integer default 0,
  add column if not exists amazon_aov           numeric default 0;
