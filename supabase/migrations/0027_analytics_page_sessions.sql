-- Page sessions report: unique sessions and total views per page path.

create or replace function analytics_page_sessions(
  p_from timestamptz,
  p_to   timestamptz
)
returns table (
  page_path       text,
  unique_sessions bigint,
  total_views     bigint,
  pct_of_sessions numeric
)
language sql stable security definer as $$
  with total as (
    select count(distinct session_id) as n
    from   analytics_events_mirror
    where  event_name  = 'page_view'
      and  session_id  is not null
      and  created_at between p_from and p_to
  )
  select
    page_path,
    count(distinct session_id)::bigint                                                      as unique_sessions,
    count(*)::bigint                                                                         as total_views,
    round(count(distinct session_id)::numeric / nullif((select n from total), 0) * 100, 1)  as pct_of_sessions
  from   analytics_events_mirror
  where  event_name  = 'page_view'
    and  page_path   is not null
    and  created_at between p_from and p_to
  group  by page_path
  order  by unique_sessions desc
  limit  50;
$$;

-- v2: add converting_sessions and converting_views columns (email-stitched)
-- Applied via migration 0028 (drop + recreate due to return type change)
