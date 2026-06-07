-- Fix analytics_top_event_labels to include server-side events (no session_id)
-- and raise the limit so low-frequency events like order_placed always appear.
--
-- Changes:
--   • Removed "and session_id is not null" — server-side events (order_placed, etc.)
--     fire without a session_id and were being silently excluded from the selector.
--   • Raised default p_top_n from 60 → 500 so the dropdown stays complete even on
--     high-traffic days where many distinct (event, page) combos exist.

create or replace function public.analytics_top_event_labels(
  p_from  timestamptz,
  p_to    timestamptz,
  p_top_n int default 500
)
returns table (label text, cnt bigint)
language sql
security definer
set search_path = public
as $$
  select
    case
      when event_name = 'page_view' then 'page_view: ' || coalesce(page_path, '?')
      when page_path is not null    then event_name || ' @ ' || page_path
      else event_name
    end  as label,
    count(*) as cnt
  from public.analytics_events_mirror
  where created_at between p_from and p_to
  group by 1
  order by cnt desc
  limit p_top_n;
$$;
