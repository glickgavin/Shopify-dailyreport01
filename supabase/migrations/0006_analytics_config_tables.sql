-- ─────────────────────────────────────────────────────────────────────────────
-- 0006_analytics_config_tables.sql
-- The 9 analytics-configuration tables that the app/lib code expects but were
-- never actually created. Without these, /analytics/funnel saves silently fail
-- (the app reports "Saved!" but the row never lands), /configuration/events
-- can't list or create definitions, and the unmapped page can't function.
--
-- Safe to run once. All statements use IF NOT EXISTS so re-running is a no-op.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Event categories (Sales, Engagement, etc.) ───────────────────────────────
create table if not exists public.analytics_event_categories (
  id          bigserial primary key,
  name        text        not null unique,
  color       text,
  icon        text,
  created_at  timestamptz not null default now()
);

-- ── Canonical event definitions (e.g. "add_to_cart" → "Added to Cart") ───────
create table if not exists public.analytics_event_definitions (
  id                bigserial primary key,
  event_type        text        not null unique,
  display_name      text        not null,
  description       text,
  category_id       bigint      references public.analytics_event_categories(id) on delete set null,
  is_conversion     boolean     not null default false,
  is_purchase       boolean     not null default false,
  revenue_property  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists analytics_event_definitions_category_idx
  on public.analytics_event_definitions (category_id);

-- ── Event-name aliases (multiple raw names → one canonical event) ────────────
-- NOTE: the funnel SQL in 0005 does NOT consult this table — predicates still
-- match raw event_name directly. This table is for future alias support and
-- for the "unmapped" page bookkeeping.
create table if not exists public.analytics_event_aliases (
  id            bigserial primary key,
  definition_id bigint      not null references public.analytics_event_definitions(id) on delete cascade,
  alias         text        not null unique,
  created_at    timestamptz not null default now()
);
create index if not exists analytics_event_aliases_definition_idx
  on public.analytics_event_aliases (definition_id);

-- ── Path definitions (e.g. "/products/*" → "Product Page") ───────────────────
create table if not exists public.analytics_path_definitions (
  id              bigserial primary key,
  canonical_name  text        not null,
  path_pattern    text        not null unique,
  description     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── Observed raw paths (auto-populated; references a definition once mapped) ─
create table if not exists public.analytics_path_observations (
  id            bigserial primary key,
  raw_path      text        not null unique,
  definition_id bigint      references public.analytics_path_definitions(id) on delete set null,
  hit_count     bigint      not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);
create index if not exists analytics_path_observations_definition_idx
  on public.analytics_path_observations (definition_id);

-- ── Property definitions (e.g. "total" is a numeric revenue property) ────────
create table if not exists public.analytics_property_definitions (
  id            bigserial primary key,
  property_key  text        not null unique,
  display_name  text        not null,
  description   text,
  data_type     text        not null default 'string',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── Property aliases (multiple raw keys → one canonical property) ────────────
create table if not exists public.analytics_property_aliases (
  id            bigserial primary key,
  definition_id bigint      not null references public.analytics_property_definitions(id) on delete cascade,
  alias_key     text        not null unique,
  created_at    timestamptz not null default now()
);
create index if not exists analytics_property_aliases_definition_idx
  on public.analytics_property_aliases (definition_id);

-- ── Saved funnels (this is the one the editor writes to) ─────────────────────
create table if not exists public.analytics_funnels (
  id          bigserial primary key,
  name        text        not null,
  description text,
  steps       jsonb       not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── Saved behavior queries (used by /analytics/behaviors) ────────────────────
create table if not exists public.analytics_behaviors (
  id          bigserial primary key,
  name        text        not null,
  description text,
  predicates  jsonb       not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── updated_at triggers ──────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  for t in
    select unnest(array[
      'analytics_event_definitions',
      'analytics_path_definitions',
      'analytics_property_definitions',
      'analytics_funnels',
      'analytics_behaviors'
    ])
  loop
    execute format(
      'drop trigger if exists %I_set_updated_at on public.%I;
       create trigger %I_set_updated_at
         before update on public.%I
         for each row execute function public.set_updated_at();',
      t, t, t, t
    );
  end loop;
end$$;

-- ── Row-level security ───────────────────────────────────────────────────────
-- The app uses supabaseAdmin (service-role key) which bypasses RLS, so simply
-- enabling RLS without policies is the safest default: nothing is exposed to
-- anon/authenticated roles, but the server-side admin client still works.
alter table public.analytics_event_categories     enable row level security;
alter table public.analytics_event_definitions    enable row level security;
alter table public.analytics_event_aliases        enable row level security;
alter table public.analytics_path_definitions     enable row level security;
alter table public.analytics_path_observations    enable row level security;
alter table public.analytics_property_definitions enable row level security;
alter table public.analytics_property_aliases     enable row level security;
alter table public.analytics_funnels              enable row level security;
alter table public.analytics_behaviors            enable row level security;

-- ── Seed a few default categories so the editor isn't empty ──────────────────
insert into public.analytics_event_categories (name, color, icon) values
  ('Sales',       '#dcfce7', '💰'),
  ('Engagement',  '#dbeafe', '👁'),
  ('Navigation',  '#fef3c7', '🧭'),
  ('Lifecycle',   '#fce7f3', '🔁')
on conflict (name) do nothing;
