-- Two additions on top of the prior fix in
-- 0021_analytics_event_neighborhood_fix_ambiguity_and_type.sql:
--
--   1. Add an optional `p_exclude_labels text[]` parameter so the UI can
--      hide noisy events and have the next-most-common event slide into the
--      freed slot. We filter at the earliest stage (_nb_ev build) so the
--      whole pipeline — anchor counting, neighbor ranking, top-N — only
--      ever sees non-excluded events. Default '{}' keeps existing callers
--      intact.
--   2. Drop the old 5-arg overload. With a DEFAULT on the new 6th arg, a
--      5-arg call matches both signatures and PG throws "function ... is
--      not unique". Dropping the old function eliminates the ambiguity.

DROP FUNCTION IF EXISTS public.analytics_event_neighborhood(
  text,
  timestamp with time zone,
  timestamp with time zone,
  integer,
  integer
);

CREATE OR REPLACE FUNCTION public.analytics_event_neighborhood(
  p_anchor          text,
  p_from            timestamp with time zone,
  p_to              timestamp with time zone,
  p_depth           integer  DEFAULT 3,
  p_top_n           integer  DEFAULT 8,
  p_exclude_labels  text[]   DEFAULT '{}'::text[]
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
      label,
      row_number() over (partition by session_id order by created_at) as pos
    from (
      select
        session_id,
        case
          when event_name = 'page_view' then 'page_view: ' || coalesce(page_path, '?')
          when page_path is not null    then event_name || ' @ ' || page_path
          else event_name
        end as label,
        created_at
      from public.analytics_events_mirror
      where created_at between p_from and p_to
        and session_id is not null
    ) raw
    where label <> all(coalesce(p_exclude_labels, '{}'::text[]));

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
