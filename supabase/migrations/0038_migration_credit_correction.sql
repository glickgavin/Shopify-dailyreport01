-- Migration-credit correction system: review table, immutable fix log, and
-- config (kill switch OFF by default + resumable scan cursor).
-- Applied live as migration_credit_correction.

create table migration_credit_review (
  customer_id            text primary key,
  email                  text,
  display_name           text,
  current_balance_cents  bigint not null default 0,
  migration_credits      jsonb not null default '[]'::jsonb,
  migration_credit_count int not null default 0,
  duplicate_cents        bigint not null default 0,
  proposed_debit_cents   bigint not null default 0,
  status                 text not null default 'pending_review'
    check (status in ('no_duplicates','pending_review','approved','processing','reversed','failed','skipped')),
  debit_reference        text,
  balance_after_cents    bigint,
  error                  text,
  attempts               int not null default 0,
  scanned_at             timestamptz,
  processed_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index on migration_credit_review (status);

create table migration_credit_fix_log (
  id uuid primary key default gen_random_uuid(),
  customer_id text not null,
  email text,
  action text not null,
  debit_cents bigint,
  balance_before_cents bigint,
  balance_after_cents bigint,
  debit_reference text,
  note_text text,
  error text,
  created_at timestamptz not null default now()
);
create index on migration_credit_fix_log (customer_id);

create table migration_fix_config (
  id int primary key,
  reversal_enabled boolean not null default false,
  scan_state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into migration_fix_config (id, reversal_enabled) values (1, false);

alter table migration_credit_review enable row level security;
alter table migration_credit_fix_log enable row level security;
alter table migration_fix_config enable row level security;
