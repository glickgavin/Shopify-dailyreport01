-- Add p_attribution parameter to analytics_purchase_entry_pages
-- 'last_touch' (default): session immediately before purchase (same session)
-- 'first_touch': earliest session ever for that email (cross-session attribution)

create or replace function analytics_purchase_entry_pages(
  p_from        timestamptz,
  p_to          timestamptz,
  p_attribution text default 'last_touch'
)
returns table (
  first_page    text,
  purchases     bigint,
  total_revenue numeric,
  avg_revenue   numeric
)
language sql stable security definer as $$
  with purchases as (
    select
      id,
      email,
      created_at                            as purchased_at,
      (properties->>'total_value')::numeric as revenue
    from  analytics_events_mirror
    where event_name = 'order_placed'
      and created_at between p_from and p_to
      and email is not null
  ),
  stitched as (
    select distinct on (p.id)
      p.id      as purchase_id,
      p.revenue,
      br.session_id
    from  purchases p
    join  analytics_events_mirror br
      on  br.email       = p.email
      and br.session_id  is not null
      and br.event_name != 'order_placed'
      and (p_attribution = 'first_touch' or br.created_at <= p.purchased_at)
    order by p.id,
      case when p_attribution = 'last_touch'
        then -extract(epoch from br.created_at)::numeric
        else  extract(epoch from br.created_at)::numeric
      end asc
  ),
  first_views as (
    select distinct on (s.purchase_id)
      s.purchase_id,
      s.revenue,
      coalesce(e.page_path, '(unknown)') as first_page
    from  stitched s
    join  analytics_events_mirror e
      on  e.session_id = s.session_id
      and e.event_name = 'page_view'
    order by s.purchase_id, e.created_at asc
  )
  select
    first_page,
    count(*)::bigint       as purchases,
    round(sum(revenue), 2) as total_revenue,
    round(avg(revenue), 2) as avg_revenue
  from  first_views
  group by first_page
  order by total_revenue desc nulls last
  limit 50;
$$;
