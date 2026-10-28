-- Monthly store-credit history (one row per customer per month, from the
-- monthly bulk export) + phase state for the snapshot job.
-- Applied live as credit_monthly_history.

create table credit_monthly_history (
  id           uuid primary key default gen_random_uuid(),
  month        date not null,
  customer_id  text not null,
  email        text,
  display_name text,
  credit_cents bigint not null,
  in_segment   boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (month, customer_id)
);
create index on credit_monthly_history (month);
create index on credit_monthly_history (month, credit_cents desc);

create table credit_snapshot_config (
  id int primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into credit_snapshot_config (id) values (1);

alter table credit_monthly_history enable row level security;
alter table credit_snapshot_config enable row level security;

-- Atomic month-stamped copy of current holders into the history table.
create or replace function copy_credit_month(target_month date)
returns void
language sql
security definer
set search_path = public
as $$
  insert into credit_monthly_history (month, customer_id, email, display_name, credit_cents, in_segment)
  select target_month, h.customer_id, h.email, h.display_name, h.balance_cents,
         exists (select 1 from membership_credit_members m where m.customer_id = h.customer_id)
  from store_credit_holders h
  where h.balance_cents > 0
  on conflict (month, customer_id) do update
    set credit_cents = excluded.credit_cents,
        email = excluded.email,
        display_name = excluded.display_name,
        in_segment = excluded.in_segment;
$$;
