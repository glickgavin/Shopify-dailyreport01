-- Fix two PL/pgSQL bugs in analytics_event_neighborhood that caused every
-- call to throw, which made /analytics/paths Event Explorer show
-- "No neighboring events found" for every anchor/date range:
--
--   1. "column reference 'sessions' is ambiguous" — `sessions` was both
--      a RETURNS TABLE OUT variable and a CTE column alias. Resolved with
--      `#variable_conflict use_column` directive.
--
--   2. "structure of query does not match function result type" — `step_offset`
--      was declared integer but `abs(rel_pos)` was bigint (row_number() returns
--      bigint). Resolved by casting `(e.pos - a.anchor_pos)::int`.
--
-- No signature change. No semantic change. Just makes the function actually run.

CREATE OR REPLACE FUNCTION public.analytics_event_neighborhood(
  p_anchor text,
  p_from   timestamp with time zone,
  p_to     timestamp with time zone,
  p_depth  integer DEFAULT 3,
  p_top_n  integer DEFAULT 8
)
RETURNS TABLE(direction text, step_offset integer, event_label text, sessions bigint, pct numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_total bigint;
begin
  create temp table _nb_ev on commit drop as
    select
      session_id,
      case
        when event_name = 'page_view' then 'page_view: ' || coalesce(page_path, '?')
        when page_path is not null    then event_name || ' @ ' || page_path
        else event_name
      end                                                              as label,
      row_number() over (partition by session_id order by created_at) as pos
    from public.analytics_events_mirror
    where created_at between p_from and p_to
      and session_id is not null;

  create index on _nb_ev (session_id, pos);

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
      (e.pos - a.anchor_pos)::int as rel_pos
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
$function$;
