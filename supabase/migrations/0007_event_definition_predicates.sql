-- ─────────────────────────────────────────────────────────────────────────────
-- 0007_event_definition_predicates.sql
-- Adds compound predicate support to event definitions and funnel steps
-- ─────────────────────────────────────────────────────────────────────────────

-- Add predicates column to event definitions
alter table public.analytics_event_definitions
  add column if not exists predicates jsonb not null default '[]'::jsonb;

-- ── Update analytics_funnel to support compound predicates per step ────────────
-- New step format: { "label": string, "predicates": [{kind, op, value},...] }
-- Old step format { "event_type": string } is handled by backward-compat logic
-- in the application layer before calling this function.

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

  -- Each step in p_steps is now { label, predicates: [...] }
  -- All predicates in a step must match (AND logic) for the step to be satisfied
  create temp table _step_hits on commit drop as
    select fe.session_id,
           s.idx,
           min(fe.created_at) as step_ts
    from _funnel_events fe
    cross join lateral (
      select (t.ordinality - 1)::int as idx,
             t.elem->'predicates' as predicates
      from jsonb_array_elements(p_steps) with ordinality as t(elem, ordinality)
    ) s
    where (
      select bool_and(
        public.analytics_predicate_matches(
          (null::uuid, fe.event_name, null, fe.session_id, null, fe.properties,
           null, fe.page_path, null, null, fe.device_type, fe.created_at,
           null, null, null, now())::public.analytics_events_mirror,
          pred
        )
      )
      from jsonb_array_elements(s.predicates) as pred
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
        (p_steps->c.idx)->>'label',
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
