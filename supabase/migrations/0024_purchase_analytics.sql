-- Purchase analytics RPC functions
-- All three use email-based stitching: order_placed events arrive server-side
-- with session_id = NULL, so we join to the most-recent browser session for
-- that email to reconstruct the pre-purchase journey.

-- ── 1. Entry pages: first page_view per stitched session, with revenue ─────────

create or replace function analytics_purchase_entry_pages(
  p_from timestamptz,
  p_to   timestamptz
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
      and br.created_at <= p.purchased_at
      and br.event_name != 'order_placed'
    order by p.id, br.created_at desc
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

-- ── 2. Pre-purchase events: top events at each step before order_placed ────────

create or replace function analytics_purchase_pre_events(
  p_from  timestamptz,
  p_to    timestamptz,
  p_steps int default 5,
  p_top_n int default 8
)
returns table (
  step        int,
  event_label text,
  occurrences bigint
)
language sql stable security definer as $$
  with purchases as (
    select id, email, created_at as purchased_at
    from  analytics_events_mirror
    where event_name = 'order_placed'
      and created_at between p_from and p_to
      and email is not null
  ),
  stitched as (
    select distinct on (p.id)
      p.id           as purchase_id,
      p.purchased_at,
      br.session_id
    from  purchases p
    join  analytics_events_mirror br
      on  br.email       = p.email
      and br.session_id  is not null
      and br.created_at <= p.purchased_at
      and br.event_name != 'order_placed'
    order by p.id, br.created_at desc
  ),
  ranked as (
    select
      s.purchase_id,
      row_number() over (
        partition by s.purchase_id
        order by e.created_at desc
      ) as step_back,
      case
        when e.event_name = 'page_view'
          then 'page_view: ' || coalesce(e.page_path, '?')
        when e.page_path is not null
          then e.event_name || ' @ ' || e.page_path
        else e.event_name
      end as event_label
    from  stitched s
    join  analytics_events_mirror e
      on  e.session_id   = s.session_id
      and e.created_at  <= s.purchased_at
      and e.event_name  != 'order_placed'
  ),
  top_per_step as (
    select
      step_back as step,
      event_label,
      count(*) as occurrences,
      row_number() over (partition by step_back order by count(*) desc) as rn
    from  ranked
    where step_back <= p_steps
    group by step_back, event_label
  )
  select step, event_label, occurrences::bigint
  from  top_per_step
  where rn <= p_top_n
  order by step, occurrences desc;
$$;

-- ── 3. Top paths to purchase: last N events per session → order_placed ─────────

create or replace function analytics_purchase_paths(
  p_from  timestamptz,
  p_to    timestamptz,
  p_steps int default 5,
  p_top_n int default 20
)
returns table (
  path      text,
  purchases bigint
)
language sql stable security definer as $$
  with purchases as (
    select id, email, created_at as purchased_at
    from  analytics_events_mirror
    where event_name = 'order_placed'
      and created_at between p_from and p_to
      and email is not null
  ),
  stitched as (
    select distinct on (p.id)
      p.id           as purchase_id,
      p.purchased_at,
      br.session_id
    from  purchases p
    join  analytics_events_mirror br
      on  br.email       = p.email
      and br.session_id  is not null
      and br.created_at <= p.purchased_at
      and br.event_name != 'order_placed'
    order by p.id, br.created_at desc
  ),
  last_n as (
    select
      s.purchase_id,
      case
        when e.event_name = 'page_view'
          then 'page_view: ' || coalesce(e.page_path, '?')
        when e.page_path is not null
          then e.event_name || ' @ ' || e.page_path
        else e.event_name
      end as event_label,
      row_number() over (
        partition by s.purchase_id
        order by e.created_at desc
      ) as step_back
    from  stitched s
    join  analytics_events_mirror e
      on  e.session_id   = s.session_id
      and e.created_at  <= s.purchased_at
      and e.event_name  != 'order_placed'
  ),
  paths as (
    select
      purchase_id,
      array_to_string(
        array_agg(event_label order by step_back desc),
        ' → '
      ) as path
    from  last_n
    where step_back <= p_steps
    group by purchase_id
  )
  select
    path,
    count(*)::bigint as purchases
  from  paths
  where path is not null and path != ''
  group by path
  order by purchases desc
  limit p_top_n;
$$;
