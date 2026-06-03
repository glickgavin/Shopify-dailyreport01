-- Path Analysis: three new SQL functions powering the /analytics/paths page.
--
--  1. analytics_top_sequences      – ranks the most common 4-step event paths
--  2. analytics_event_neighborhood – shows what happened before/after any event
--  3. analytics_top_event_labels   – top distinct event labels (for dropdowns)
--
-- All three normalise page_view events to "page_view: <page_path>" so the UI
-- can display paths meaningfully rather than just the event_name "page_view".


-- ── 1. analytics_top_sequences ───────────────────────────────────────────────

create or replace function public.analytics_top_sequences(
  p_from  timestamptz,
  p_to    timestamptz,
  p_start text default null,  -- if set, only sessions containing this event label
  p_top_n int  default 25
)
returns table (
  step1    text,
  step2    text,
  step3    text,
  step4    text,
  sessions bigint,
  pct      numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with ev as (
    select
      session_id,
      case when event_name = 'page_view'
           then 'page_view: ' || coalesce(page_path, '?')
           else event_name
      end                                                              as label,
      row_number() over (partition by session_id order by created_at) as pos
    from public.analytics_events_mirror
    where created_at between p_from and p_to
      and session_id is not null
  ),
  -- starting position per session:
  -- p_start = null  → begin at pos 1 (session start)
  -- p_start = value → begin at first occurrence of that label
  sp as (
    select e.session_id,
           case
             when p_start is null then 1
             else min(case when e.label = p_start then e.pos end)
           end as sp
    from ev e
    group by e.session_id
    having p_start is null
        or min(case when e.label = p_start then e.pos end) is not null
  ),
  seqs as (
    select
      e1.label                      as step1,
      e2.label                      as step2,
      e3.label                      as step3,
      e4.label                      as step4,
      count(distinct e1.session_id) as sessions
    from sp
    join      ev e1 on e1.session_id = sp.session_id and e1.pos = sp.sp
    left join ev e2 on e2.session_id = sp.session_id and e2.pos = sp.sp + 1
    left join ev e3 on e3.session_id = sp.session_id and e3.pos = sp.sp + 2
    left join ev e4 on e4.session_id = sp.session_id and e4.pos = sp.sp + 3
    group by 1, 2, 3, 4
    order by sessions desc
    limit p_top_n
  ),
  total as (
    select count(distinct session_id) as n from sp
  )
  select s.step1, s.step2, s.step3, s.step4,
         s.sessions,
         case when t.n > 0 then round(s.sessions::numeric / t.n * 100, 1) else 0 end
  from seqs s, total t
  order by s.sessions desc;
end;
$$;


-- ── 2. analytics_event_neighborhood ──────────────────────────────────────────

create or replace function public.analytics_event_neighborhood(
  p_anchor text,
  p_from   timestamptz,
  p_to     timestamptz,
  p_depth  int default 3,
  p_top_n  int default 8
)
returns table (
  direction    text,    -- 'before' | 'after'
  step_offset  int,     -- 1..p_depth (distance from anchor)
  event_label  text,
  sessions     bigint,
  pct          numeric  -- % of anchor sessions that saw this event at this offset
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total bigint;
begin
  create temp table _nb_ev on commit drop as
    select
      session_id,
      case when event_name = 'page_view'
           then 'page_view: ' || coalesce(page_path, '?')
           else event_name
      end                                                              as label,
      row_number() over (partition by session_id order by created_at) as pos
    from public.analytics_events_mirror
    where created_at between p_from and p_to
      and session_id is not null;

  create index on _nb_ev (session_id, pos);

  -- first occurrence of anchor per session
  create temp table _nb_anc on commit drop as
    select session_id, min(pos) as anchor_pos
    from _nb_ev
    where label = p_anchor
    group by session_id;

  select count(*) into v_total from _nb_anc;

  if v_total = 0 then
    drop table if exists _nb_ev;
    drop table if exists _nb_anc;
    return;
  end if;

  return query
  with rel_offsets as (
    select
      e.session_id,
      e.label,
      e.pos - a.anchor_pos as rel_pos
    from _nb_ev e
    join _nb_anc a on a.session_id = e.session_id
    where abs(e.pos - a.anchor_pos) between 1 and p_depth
      and e.label != p_anchor
  ),
  grouped as (
    select
      case when rel_pos < 0 then 'before' else 'after' end as direction,
      abs(rel_pos)                                          as step_offset,
      label                                                 as event_label,
      count(distinct session_id)                            as sessions
    from rel_offsets
    group by 1, 2, 3
  ),
  ranked as (
    select *,
           row_number() over (partition by direction, step_offset order by sessions desc) as rn
    from grouped
  )
  select r.direction, r.step_offset, r.event_label,
         r.sessions,
         round(r.sessions::numeric / v_total * 100, 1)
  from ranked r
  where r.rn <= p_top_n
  order by r.direction desc, r.step_offset, r.sessions desc;

  drop table if exists _nb_ev;
  drop table if exists _nb_anc;
end;
$$;


-- ── 3. analytics_top_event_labels ────────────────────────────────────────────

create or replace function public.analytics_top_event_labels(
  p_from  timestamptz,
  p_to    timestamptz,
  p_top_n int default 60
)
returns table (label text, cnt bigint)
language sql
security definer
set search_path = public
as $$
  select
    case when event_name = 'page_view'
         then 'page_view: ' || coalesce(page_path, '?')
         else event_name
    end  as label,
    count(*) as cnt
  from public.analytics_events_mirror
  where created_at between p_from and p_to
    and session_id is not null
  group by 1
  order by cnt desc
  limit p_top_n;
$$;
