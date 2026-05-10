-- ─────────────────────────────────────────────────────────────────────────────
-- 0005_analytics_functions.sql
-- Predicate matcher, funnel, and behavior Postgres functions
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Predicate matcher ─────────────────────────────────────────────────────────
-- Mirrors TypeScript: kind 'event_type'|'page_path'|'property'|'device_type'
--                     op  'is'|'is_not'|'contains'|'not_contains'|'exists'|'not_exists'
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

-- ── Funnel function ───────────────────────────────────────────────────────────
create or replace function public.analytics_funnel(
  p_steps         jsonb,
  p_from          timestamptz,
  p_to            timestamptz,
  p_window_hours  int     default 24,
  p_identifier    text    default 'session_id',
  p_include_preview boolean default false
)
returns table (
  step_index            int,
  step_label            text,
  users                 bigint,
  conversion_from_prev  numeric,
  conversion_from_start numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_step_count int;
begin
  v_step_count := jsonb_array_length(p_steps);
  if v_step_count = 0 then return; end if;

  create temp table _funnel_events on commit drop as
    select e.session_id, e.event_name, e.page_path, e.device_type, e.properties, e.created_at
    from public.analytics_events_mirror e
    where e.created_at between p_from and p_to
      and e.session_id is not null;

  create index on _funnel_events (session_id, created_at);

  create temp table _step_hits on commit drop as
    select fe.session_id,
           s.idx,
           min(fe.created_at) as step_ts
    from _funnel_events fe
    cross join lateral (
      select (t.ordinality - 1)::int as idx, t.elem as predicate
      from jsonb_array_elements(p_steps) with ordinality as t(elem, ordinality)
    ) s
    where public.analytics_predicate_matches(
      (null::uuid, fe.event_name, null, fe.session_id, null, fe.properties,
       null, fe.page_path, null, null, fe.device_type, fe.created_at,
       null, null, null, now())::public.analytics_events_mirror,
      s.predicate
    )
    group by fe.session_id, s.idx;

  create index on _step_hits (session_id, idx, step_ts);

  create temp table _funnel_progress on commit drop as
    with recursive walk(session_id, idx, step_ts) as (
      select session_id, 0 as idx, step_ts
      from _step_hits
      where idx = 0

      union all

      select h.session_id, h.idx, h.step_ts
      from _step_hits h
      join walk w on w.session_id = h.session_id
                  and h.idx = w.idx + 1
                  and h.step_ts > w.step_ts
                  and h.step_ts <= w.step_ts + make_interval(hours => p_window_hours)
    )
    select session_id, idx, step_ts from walk;

  return query
    with counts as (
      select s.idx,
             count(distinct fp.session_id) as cnt
      from (
        select generate_series(0, v_step_count - 1) as idx
      ) s
      left join _funnel_progress fp on fp.idx = s.idx
      group by s.idx
    ),
    step0_count as (
      select cnt as n from counts where idx = 0
    )
    select
      c.idx,
      coalesce(
        (p_steps->c.idx)->>'value',
        (p_steps->c.idx)->>'kind',
        'Step ' || (c.idx + 1)
      ),
      c.cnt,
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
    order by c.idx;

  drop table if exists _funnel_events;
  drop table if exists _step_hits;
  drop table if exists _funnel_progress;
end;
$$;

-- ── Behavior function ─────────────────────────────────────────────────────────
create or replace function public.analytics_behavior(
  p_conditions      jsonb,
  p_from            timestamptz,
  p_to              timestamptz,
  p_identifier      text    default 'session_id',
  p_include_preview boolean default false
)
returns table (
  matched_sessions   bigint,
  matched_events     bigint,
  events_per_session numeric,
  by_device          jsonb,
  by_source          jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    with base as (
      select e.*
      from public.analytics_events_mirror e
      where e.created_at between p_from and p_to
        and e.session_id is not null
    ),
    matching as (
      select b.*
      from base b
      where (
        select bool_and(
          public.analytics_predicate_matches(b, pred)
        )
        from jsonb_array_elements(p_conditions) as pred
      )
    ),
    agg as (
      select
        count(distinct m.session_id)                         as matched_sessions,
        count(*)                                             as matched_events,
        case when count(distinct m.session_id) > 0
             then round(count(*)::numeric / count(distinct m.session_id), 2)
             else 0 end                                      as events_per_session
      from matching m
    ),
    dev as (
      select jsonb_agg(jsonb_build_object('key', device_type, 'sessions', cnt) order by cnt desc)
      from (
        select coalesce(device_type, '(unknown)') as device_type,
               count(distinct session_id) as cnt
        from matching
        group by device_type
        order by cnt desc
        limit 5
      ) d
    ),
    src as (
      select jsonb_agg(jsonb_build_object('key', source, 'sessions', cnt) order by cnt desc)
      from (
        select coalesce(properties->>'utm_source', '(direct)') as source,
               count(distinct session_id) as cnt
        from matching
        group by 1
        order by cnt desc
        limit 5
      ) s
    )
    select
      agg.matched_sessions,
      agg.matched_events,
      agg.events_per_session,
      dev.jsonb_agg,
      src.jsonb_agg
    from agg, dev, src;
end;
$$;
