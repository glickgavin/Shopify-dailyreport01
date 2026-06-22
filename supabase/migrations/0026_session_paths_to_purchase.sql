-- Within-session paths ending in order_placed.
-- Uses the session_id on order_placed events directly (no email stitching needed).
-- Returns last p_steps events before order_placed, grouped as a path string.

create or replace function analytics_session_paths_to_purchase(
  p_from  timestamptz,
  p_to    timestamptz,
  p_steps int default 10,
  p_top_n int default 10
)
returns table (
  path     text,
  sessions bigint
)
language sql stable security definer as $$
  with converting_sessions as (
    select distinct session_id
    from  analytics_events_mirror
    where event_name  = 'order_placed'
      and session_id  is not null
      and created_at between p_from and p_to
  ),
  last_n as (
    select
      cs.session_id,
      case
        when e.event_name = 'page_view'
          then 'page_view: ' || coalesce(e.page_path, '?')
        when e.page_path is not null
          then e.event_name || ' @ ' || e.page_path
        else e.event_name
      end as event_label,
      row_number() over (
        partition by cs.session_id
        order by e.created_at desc
      ) as step_back
    from  converting_sessions cs
    join  analytics_events_mirror e
      on  e.session_id  = cs.session_id
      and e.event_name != 'order_placed'
  ),
  paths as (
    select
      session_id,
      array_to_string(
        array_agg(event_label order by step_back desc),
        ' → '
      ) as path
    from  last_n
    where step_back <= p_steps
    group by session_id
  )
  select
    path,
    count(*)::bigint as sessions
  from  paths
  where path is not null and path != ''
  group by path
  order by sessions desc
  limit p_top_n;
$$;
