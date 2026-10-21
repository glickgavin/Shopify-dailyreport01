-- Ad-hoc dump of store-credit transaction histories for investigation
-- (filled by /api/cron/credit-history-dump for the top balances in
-- membership_credit_members). Applied live as store_credit_history_dump.

create table store_credit_history_dump (
  id uuid primary key default gen_random_uuid(),
  customer_id text not null,
  email text,
  account_id text not null,
  occurred_at timestamptz not null,
  tx_type text not null,
  amount_cents bigint not null,
  balance_after_cents bigint,
  dumped_at timestamptz not null default now()
);
create index on store_credit_history_dump (customer_id, occurred_at);
alter table store_credit_history_dump enable row level security;
