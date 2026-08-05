-- ─────────────────────────────────────────────────────────────────────────
-- Fix analytics_funnel after adding country to analytics_events_mirror, and
-- support country as a funnel predicate kind.
--
-- Root cause of the outage: the step-predicate row literals cast to
-- ::analytics_events_mirror had 16 columns while the composite type now has
-- 17 → "cannot cast type record to analytics_events_mirror — Input has too
-- few columns."
--
-- Applied to Supabase project kztxlpfrullqzphkvkiv; committed for parity.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.analytics_predicate_matches(
  e public.analytics_events_mirror,
  p jsonb
) returns boolean
language plpgsql
immutable
as $$
declare
  v_kind   text := p->>'kind';
  v_op     text := p->>'op';
  v_val    text := p->>'value';
  v_target text;
begin
  if    v_kind = 'event_type'  then v_target := e.event_name;
  elsif v_kind = 'page_path'   then v_target := coalesce(e.page_path, '');
  elsif v_kind = 'device_type' then v_target := coalesce(e.device_type, '');
  elsif v_kind = 'country'     then v_target := coalesce(e.country, '');
  elsif v_kind = 'property'    then v_target := e.properties->>(p->>'key');
  else return false;
  end if;

  return case v_op
    when 'is'          then v_target = v_val
    when 'is_not'      then v_target is distinct from v_val
    when 'contains'    then position(v_val in coalesce(v_target, '')) > 0
    when 'not_contains'then position(v_val in coalesce(v_target, '')) = 0
    when 'exists'      then v_target is not null
    when 'not_exists'  then v_target is null
    else false
  end;
end;
$$;

create or replace function public.analytics_funnel(
  p_steps             jsonb,
  p_from              timestamptz,
  p_to                timestamptz,
  p_window_hours      integer  default 24,
  p_identifier        text     default 'session_id',
  p_include_preview   boolean  default false,
  p_stitch_by_email   boolean  default true
)
returns table (
  step_index             integer,
  step_label             text,
  users                  bigint,
  total_events           bigint,
  total_revenue          numeric,
  conversion_from_prev   numeric,
  conversion_from_start  numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step_count   int;
  v_window_hours int;
  v_stitch_hours int;
begin
  v_step_count := jsonb_array_length(p_steps);
  if v_step_count = 0 then return; end if;

  v_window_hours := coalesce(p_window_hours, 87600);
  v_stitch_hours := least(coalesce(p_window_hours, 168), 168);

  -- ── Step 1: build event pool ─────────────────────────────────────────────
  create temp table _funnel_events on commit drop as
    select e.id,
           e.session_id,
           e.event_name, e.page_path, e.device_type, e.country, e.properties, e.created_at
    from public.analytics_events_mirror e
    where e.created_at between p_from and p_to
      and e.session_id is not null;

  if p_stitch_by_email then
    insert into _funnel_events (id, session_id, event_name, page_path, device_type, country, properties, created_at)
    select id, session_id, event_name, page_path, device_type, country, properties, created_at
    from (
      select distinct on (o.id)
        o.id,
        m.session_id,
        o.event_name, o.page_path, o.device_type, o.country, o.properties, o.created_at
      from public.analytics_events_mirror o
      join public.analytics_events_mirror m
        on  m.email      = o.email
        and m.session_id is not null
        and m.session_id != coalesce(o.session_id, '')
        and m.created_at <= o.created_at
        and m.created_at >= o.created_at - make_interval(hours => v_stitch_hours)
      where o.created_at between p_from and p_to
        and o.email is not null
        and (
          o.session_id is null
          or
          not exists (
            select 1
            from public.analytics_events_mirror e2
            where e2.session_id = o.session_id
              and e2.id         != o.id
              and e2.event_name != 'order_placed'
          )
        )
      order by o.id, m.created_at desc
    ) stitched;
  end if;

  create index on _funnel_events (session_id, created_at);

  -- ── Step 2: single-pass predicate evaluation ─────────────────────────────
  -- Row literal column order must match analytics_events_mirror exactly:
  -- id, event_name, event_category, session_id, user_id, properties, page_url,
  -- page_path, referrer, user_agent, device_type, created_at, magic_id,
  -- click_id, email, synced_at, country
  create temp table _step_matches on commit drop as
    select fe.session_id,
           fe.id,
           s.idx,
           fe.created_at,
           (fe.properties->>'total_value')::numeric as revenue
    from _funnel_events fe
    cross join lateral (
      select (t.ordinality - 1)::int              as idx,
             t.elem->'predicates'                 as predicates,
             coalesce(t.elem->>'logic', 'AND')    as logic
      from jsonb_array_elements(p_steps) with ordinality as t(elem, ordinality)
    ) s
    where (
      case s.logic
        when 'OR' then (
          select bool_or(
            public.analytics_predicate_matches(
              (null::uuid, fe.event_name, null, fe.session_id, null, fe.properties,
               null, fe.page_path, null, null, fe.device_type, fe.created_at,
               null, null, null, now(), fe.country)::public.analytics_events_mirror,
              pred
            )
          )
          from jsonb_array_elements(s.predicates) as pred
        )
        else (
          select bool_and(
            public.analytics_predicate_matches(
              (null::uuid, fe.event_name, null, fe.session_id, null, fe.properties,
               null, fe.page_path, null, null, fe.device_type, fe.created_at,
               null, null, null, now(), fe.country)::public.analytics_events_mirror,
              pred
            )
          )
          from jsonb_array_elements(s.predicates) as pred
        )
      end
    );

  create index on _step_matches (session_id, idx, created_at);

  -- ── Step 3: aggregate raw stats per step (dedup by event id first) ───────
  create temp table _step_raw on commit drop as
    with deduped as (
      select distinct on (id, idx) id, idx, revenue
      from _step_matches
    )
    select idx,
           count(*)                  as raw_count,
           coalesce(sum(revenue), 0) as revenue
    from deduped
    group by idx;

  -- ── Step 4: first hit per session per step ───────────────────────────────
  create temp table _step_hits on commit drop as
    select _step_matches.session_id, _step_matches.idx, min(_step_matches.created_at) as step_ts
    from _step_matches
    group by _step_matches.session_id, _step_matches.idx;

  create index on _step_hits (session_id, idx, step_ts);

  -- ── Step 5: recursive funnel walk ────────────────────────────────────────
  create temp table _funnel_progress on commit drop as
    with recursive walk(session_id, idx, step_ts) as (
      select _step_hits.session_id, 0 as idx, _step_hits.step_ts
      from _step_hits
      where _step_hits.idx = 0

      union all

      select h.session_id, h.idx, h.step_ts
      from _step_hits h
      join walk w on  w.session_id = h.session_id
                  and h.idx        = w.idx + 1
                  and h.step_ts    > w.step_ts
                  and h.step_ts   <= w.step_ts + make_interval(hours => v_window_hours)
    )
    select walk.session_id, walk.idx, walk.step_ts from walk;

  -- ── Step 6: return results ───────────────────────────────────────────────
  return query
    with counts as (
      select s.idx,
             count(distinct fp.session_id) as cnt
      from   (select generate_series(0, v_step_count - 1) as idx) s
      left join _funnel_progress fp on fp.idx = s.idx
      group by s.idx
    ),
    step0_count as (
      select cnt as n from counts where idx = 0
    )
    select
      c.idx,
      coalesce(
        (p_steps->c.idx)->>'label',
        (p_steps->c.idx)->>'value',
        (p_steps->c.idx)->>'kind',
        'Step ' || (c.idx + 1)
      ),
      c.cnt,
      coalesce(r.raw_count, 0),
      coalesce(r.revenue, 0),
      case
        when c.idx = 0 then null
        when lag(c.cnt) over (order by c.idx) > 0
        then round(c.cnt::numeric / lag(c.cnt) over (order by c.idx) * 100, 1)
        else 0
      end,
      case
        when (select n from step0_count) > 0
        then round(c.cnt::numeric / (select n from step0_count) * 100, 1)
        else 0
      end
    from counts c
    left join _step_raw r on r.idx = c.idx
    order by c.idx;

  drop table if exists _funnel_events;
  drop table if exists _step_matches;
  drop table if exists _step_raw;
  drop table if exists _step_hits;
  drop table if exists _funnel_progress;
end;
$$;
