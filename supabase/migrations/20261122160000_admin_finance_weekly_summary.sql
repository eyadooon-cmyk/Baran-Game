-- Keep the production RPC definition reproducible in source control.
-- This definition was applied directly to the production database on 2026-11-22
-- and verified with admin_finance_data(uuid). CREATE OR REPLACE is repeatable;
-- it does not alter ledger rows, wallet balances, or opening capital.
CREATE OR REPLACE FUNCTION public.admin_finance_data(p_admin_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_today_start timestamptz := date_trunc('day', now() at time zone 'Asia/Damascus') at time zone 'Asia/Damascus';
  v_week_start timestamptz := (date_trunc('day', now() at time zone 'Asia/Damascus') - interval '6 days') at time zone 'Asia/Damascus';
  v_month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Damascus') at time zone 'Asia/Damascus';
  v_result jsonb;
begin
  if not exists (select 1 from public.admin_users where user_id = p_admin_id) then
    raise exception 'Administrator access required';
  end if;

  select jsonb_build_object(
    'totals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency',c.currency,'capital',coalesce(a.capital,0),'sales',coalesce(a.sales,0),
        'cost',coalesce(a.cost,0),'expenses',coalesce(a.expenses,0),
        'profit',coalesce(a.sales,0)-coalesce(a.cost,0)-coalesce(a.expenses,0),
        'today_sales',coalesce(a.today_sales,0),'today_cost',coalesce(a.today_cost,0),
        'today_expenses',coalesce(a.today_expenses,0),
        'today_gross_profit',coalesce(a.today_sales,0)-coalesce(a.today_cost,0),
        'today_profit',coalesce(a.today_sales,0)-coalesce(a.today_cost,0)-coalesce(a.today_expenses,0),
        'week_sales',coalesce(a.week_sales,0),'week_cost',coalesce(a.week_cost,0),
        'week_expenses',coalesce(a.week_expenses,0),
        'week_gross_profit',coalesce(a.week_sales,0)-coalesce(a.week_cost,0),
        'week_profit',coalesce(a.week_sales,0)-coalesce(a.week_cost,0)-coalesce(a.week_expenses,0),
        'month_sales',coalesce(a.month_sales,0),'month_cost',coalesce(a.month_cost,0),
        'month_expenses',coalesce(a.month_expenses,0),
        'month_gross_profit',coalesce(a.month_sales,0)-coalesce(a.month_cost,0),
        'month_profit',coalesce(a.month_sales,0)-coalesce(a.month_cost,0)-coalesce(a.month_expenses,0)
      ) order by c.currency)
      from (values ('USD'::text),('SYP'::text)) as c(currency)
      left join lateral (
        select
          sum(amount) filter(where entry_type='capital') capital,
          sum(amount) filter(where entry_type='sale') sales,
          sum(cost_amount) filter(where entry_type='sale') cost,
          sum(amount) filter(where entry_type='expense') expenses,
          sum(amount) filter(where entry_type='sale' and created_at>=v_today_start) today_sales,
          sum(cost_amount) filter(where entry_type='sale' and created_at>=v_today_start) today_cost,
          sum(amount) filter(where entry_type='expense' and created_at>=v_today_start) today_expenses,
          sum(amount) filter(where entry_type='sale' and created_at>=v_week_start) week_sales,
          sum(cost_amount) filter(where entry_type='sale' and created_at>=v_week_start) week_cost,
          sum(amount) filter(where entry_type='expense' and created_at>=v_week_start) week_expenses,
          sum(amount) filter(where entry_type='sale' and created_at>=v_month_start) month_sales,
          sum(cost_amount) filter(where entry_type='sale' and created_at>=v_month_start) month_cost,
          sum(amount) filter(where entry_type='expense' and created_at>=v_month_start) month_expenses
        from public.admin_finance_entries e where e.currency=c.currency
      ) a on true
    ),'[]'::jsonb),
    'product_report',coalesce((
      select jsonb_agg(jsonb_build_object('product_name',p.product_name,'currency',p.currency,
        'quantity',p.quantity,'sales',p.sales,'cost',p.cost,'gross_profit',p.sales-p.cost)
        order by p.currency,p.sales desc,p.product_name)
      from (
        select coalesce(nullif(btrim(product_name),''),'منتج غير محدد') product_name,currency,
          sum(coalesce(quantity,0))::bigint quantity,sum(amount) sales,sum(cost_amount) cost
        from public.admin_finance_entries
        where entry_type='sale' and created_at>=v_month_start and currency in ('USD','SYP')
        group by coalesce(nullif(btrim(product_name),''),'منتج غير محدد'),currency
      ) p
    ),'[]'::jsonb),
    'entries',coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from (select id,entry_type,title,product_name,quantity,unit_sale_price,unit_cost_price,
        amount,cost_amount,currency,order_id,created_at from public.admin_finance_entries
        order by created_at desc limit 150) x
    ),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;
