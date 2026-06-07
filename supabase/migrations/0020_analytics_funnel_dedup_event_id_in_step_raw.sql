-- Fix double-counting of total_events and revenue when email-stitching is on.
--
-- Root cause: _funnel_events inserts the same underlying event twice when
-- email-stitching fires — once with its real session_id and once aliased to
-- a prior browsing session_id.  _step_raw counted count(*) over _step_matches
-- without deduping, so each stitched event contributed 2 to total_events and
-- 2× its revenue to the step total.
--
-- Fix:
--   1. Add id uuid to _funnel_events so we can track the source event.
--   2. Carry id into _step_matches.
--   3. Dedup _step_raw by (id, idx) before aggregating.
--
-- Invariant: users / conversion_from_prev / conversion_from_start are
-- unchanged because they derive from _funnel_progress.session_id which
-- this fix does not touch.

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
           e.event_name, e.page_path, e.device_type, e.properties, e.created_at
    from public.analytics_events_mirror e
    where e.created_at between p_from and p_to
      and e.session_id is not null;

  if p_stitch_by_email then
    insert into _funnel_events (id, session_id, event_name, page_path, device_type, properties, created_at)
    select id, session_id, event_name, page_path, device_type, properties, created_at
    from (
      select distinct on (o.id)
        o.id,
        m.session_id,            -- assign the prior browsing session_id
        o.event_name, o.page_path, o.device_type, o.properties, o.created_at
      from public.analytics_events_mirror o
      join public.analytics_events_mirror m
        on  m.email      = o.email
        and m.session_id is not null
        -- don't stitch an event back to its own session
        and m.session_id != coalesce(o.session_id, '')
        and m.created_at <= o.created_at
        and m.created_at >= o.created_at - make_interval(hours => v_stitch_hours)
      where o.created_at between p_from and p_to
        and o.email is not null
        and (
          -- Old Shopify behaviour: event arrived with no session at all
          o.session_id is null
          or
          -- New Shopify behaviour (from ~May 27 2026): event carries a
          -- checkout session_id that belongs to no other analytics event.
          -- These are still "orphaned" from the funnel's perspective.
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
               null, null, null, now())::public.analytics_events_mirror,
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
               null, null, null, now())::public.analytics_events_mirror,
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
    select session_id, idx, min(created_at) as step_ts
    from _step_matches
    group by session_id, idx;

  create index on _step_hits (session_id, idx, step_ts);

  -- ── Step 5: recursive funnel walk ────────────────────────────────────────
  create temp table _funnel_progress on commit drop as
    with recursive walk(session_id, idx, step_ts) as (
      select session_id, 0 as idx, step_ts
      from _step_hits
      where idx = 0

      union all

      select h.session_id, h.idx, h.step_ts
      from _step_hits h
      join walk w on  w.session_id = h.session_id
                  and h.idx        = w.idx + 1
                  and h.step_ts    > w.step_ts
                  and h.step_ts   <= w.step_ts + make_interval(hours => v_window_hours)
    )
    select session_id, idx, step_ts from walk;

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
