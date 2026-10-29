-- Store Credit list: Tags / Last Purchase / Last Credit Added columns and
-- the server-side sortable page function. Applied live as
-- credit_list_columns_and_page_fn.

alter table store_credit_holders
  add column if not exists tags text,
  add column if not exists last_purchase_at timestamptz,
  add column if not exists last_credit_at timestamptz;

alter table credit_monthly_history
  add column if not exists tags text,
  add column if not exists last_purchase_at timestamptz,
  add column if not exists last_credit_at timestamptz;

create or replace function copy_credit_month(target_month date)
returns void
language sql
security definer
set search_path = public
as $$
  insert into credit_monthly_history (month, customer_id, email, display_name, credit_cents, in_segment, tags, last_purchase_at, last_credit_at)
  select target_month, h.customer_id, h.email, h.display_name, h.balance_cents,
         exists (select 1 from membership_credit_members m where m.customer_id = h.customer_id),
         h.tags, h.last_purchase_at, h.last_credit_at
  from store_credit_holders h
  where h.balance_cents > 0
  on conflict (month, customer_id) do update
    set credit_cents = excluded.credit_cents,
        email = excluded.email,
        display_name = excluded.display_name,
        in_segment = excluded.in_segment,
        tags = excluded.tags,
        last_purchase_at = excluded.last_purchase_at,
        last_credit_at = excluded.last_credit_at;
$$;

-- One sortable, searchable, paginated page of the latest month with the
-- prior-month delta — sorting by any column happens over the FULL set.
create or replace function credit_page(
  p_month date, p_prior date, p_q text, p_scope text,
  p_sort text, p_dir text, p_limit int, p_offset int)
returns table (
  customer_id text, email text, display_name text, credit_cents bigint,
  in_segment boolean, tags text, last_purchase_at timestamptz, last_credit_at timestamptz,
  prev_cents bigint, total_count bigint)
language sql
security definer
set search_path = public
as $$
  with base as (
    select c.customer_id, c.email, c.display_name, c.credit_cents, c.in_segment,
           c.tags, c.last_purchase_at, c.last_credit_at, p.credit_cents as prev_cents
    from credit_monthly_history c
    left join credit_monthly_history p
      on p_prior is not null and p.month = p_prior and p.customer_id = c.customer_id
    where c.month = p_month
      and (p_scope is distinct from 'members' or c.in_segment)
      and (coalesce(p_q, '') = ''
           or c.email ilike '%' || p_q || '%'
           or c.display_name ilike '%' || p_q || '%'
           or c.customer_id ilike '%' || p_q || '%'
           or c.tags ilike '%' || p_q || '%')
  )
  select b.*, count(*) over () as total_count
  from base b
  order by
    case when p_dir = 'asc' then
      case p_sort when 'name' then b.display_name when 'email' then b.email when 'tags' then b.tags end
    end asc nulls last,
    case when p_dir <> 'asc' then
      case p_sort when 'name' then b.display_name when 'email' then b.email when 'tags' then b.tags end
    end desc nulls last,
    case when p_dir = 'asc' then
      case p_sort
        when 'credit' then b.credit_cents::numeric
        when 'change' then (b.credit_cents - coalesce(b.prev_cents, 0))::numeric
        when 'last_purchase' then extract(epoch from b.last_purchase_at)
        when 'last_credit' then extract(epoch from b.last_credit_at)
      end
    end asc nulls last,
    case when p_dir <> 'asc' then
      case p_sort
        when 'credit' then b.credit_cents::numeric
        when 'change' then (b.credit_cents - coalesce(b.prev_cents, 0))::numeric
        when 'last_purchase' then extract(epoch from b.last_purchase_at)
        when 'last_credit' then extract(epoch from b.last_credit_at)
      end
    end desc nulls last,
    b.credit_cents desc, b.customer_id
  limit p_limit offset p_offset
$$;
