-- BARO: audited external/manual sales, isolated from customer orders and wallets.
begin;

create table if not exists public.baro_manual_external_sales (
  id uuid primary key default gen_random_uuid(),
  product_name text not null check (char_length(btrim(product_name)) between 2 and 160),
  customer_name text not null default '',
  player_id text not null default '',
  supplier_id uuid not null references public.baro_manual_suppliers(id) on delete restrict,
  supplier_name_snapshot text not null,
  sale_amount numeric(20,6) not null check (sale_amount > 0),
  sale_currency text not null check (sale_currency in ('USD','SYP')),
  sale_exchange_rate numeric(20,6) not null check (sale_exchange_rate > 0),
  sale_usd_equivalent numeric(20,6) not null check (sale_usd_equivalent > 0),
  supplier_cost_amount numeric(20,6) not null check (supplier_cost_amount > 0),
  supplier_cost_currency text not null check (supplier_cost_currency in ('USD','SYP')),
  supplier_cost_exchange_rate numeric(20,6) not null check (supplier_cost_exchange_rate > 0),
  supplier_cost_usd_equivalent numeric(20,6) not null check (supplier_cost_usd_equivalent > 0),
  profit_usd_equivalent numeric(20,6) generated always as (sale_usd_equivalent - supplier_cost_usd_equivalent) stored,
  payment_method text not null check (payment_method in ('sham_cash','cash','other')),
  customer_reference text not null default '',
  supplier_reference text not null default '',
  notes text not null default '',
  idempotency_key text not null unique check (char_length(btrim(idempotency_key)) between 8 and 160),
  created_by uuid not null,
  created_at timestamptz not null default now()
);

alter table public.baro_manual_finance_entries
  add column if not exists external_sale_id uuid
  references public.baro_manual_external_sales(id) on delete restrict;

create unique index if not exists baro_external_sale_ledger_entry_once
  on public.baro_manual_finance_entries(external_sale_id,entry_type)
  where external_sale_id is not null;
create index if not exists baro_external_sales_created_idx
  on public.baro_manual_external_sales(created_at desc);
create index if not exists baro_external_sales_supplier_idx
  on public.baro_manual_external_sales(supplier_id,created_at desc);

alter table public.baro_manual_external_sales enable row level security;
revoke all on public.baro_manual_external_sales from public,anon,authenticated;
grant select on public.baro_manual_external_sales, public.baro_manual_suppliers to service_role;
drop policy if exists baro_manual_external_sales_deny_client_access on public.baro_manual_external_sales;
create policy baro_manual_external_sales_deny_client_access
  on public.baro_manual_external_sales for all to anon,authenticated
  using(false) with check(false);

create or replace function public.baro_manual_external_sale_create_atomic(
  p_admin_id uuid,
  p_product_name text,
  p_customer_name text,
  p_player_id text,
  p_supplier_id uuid,
  p_sale_amount numeric,
  p_sale_currency text,
  p_sale_exchange_rate numeric,
  p_supplier_cost_amount numeric,
  p_supplier_cost_currency text,
  p_supplier_cost_exchange_rate numeric,
  p_payment_method text,
  p_customer_reference text,
  p_supplier_reference text,
  p_notes text,
  p_idempotency_key text,
  p_execution_confirmed boolean
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
  v_sale public.baro_manual_external_sales%rowtype;
  v_supplier_name text;
  v_sale_rate numeric;
  v_cost_rate numeric;
  v_sale_usd numeric;
  v_cost_usd numeric;
begin
  if p_admin_id is null or not public.baro_manual_has_permission(p_admin_id,'finance') then
    raise exception using errcode='42501',message='BARO finance permission required';
  end if;
  if p_execution_confirmed is distinct from true then
    raise exception using errcode='22023',message='لا يمكن ترحيل البيع قبل تأكيد القبض وتنفيذ الشحن.';
  end if;
  if p_product_name is null or char_length(btrim(p_product_name))<2 or char_length(p_product_name)>160
     or char_length(coalesce(p_customer_name,''))>120 or char_length(coalesce(p_player_id,''))>100
     or p_supplier_id is null
     or p_sale_amount is null or p_sale_amount<=0 or p_sale_amount>1000000000000
     or p_supplier_cost_amount is null or p_supplier_cost_amount<=0 or p_supplier_cost_amount>1000000000000
     or p_sale_currency is null or p_sale_currency not in ('USD','SYP')
     or p_supplier_cost_currency is null or p_supplier_cost_currency not in ('USD','SYP')
     or (p_sale_currency='SYP' and (p_sale_exchange_rate is null or p_sale_exchange_rate<=0))
     or (p_supplier_cost_currency='SYP' and (p_supplier_cost_exchange_rate is null or p_supplier_cost_exchange_rate<=0))
     or p_payment_method is null or p_payment_method not in ('sham_cash','cash','other')
     or char_length(coalesce(p_customer_reference,''))>160
     or char_length(coalesce(p_supplier_reference,''))>160
     or char_length(coalesce(p_notes,''))>1000
     or p_idempotency_key is null or char_length(btrim(p_idempotency_key))<8 or char_length(p_idempotency_key)>160 then
    raise exception using errcode='22023',message='بيانات البيع الخارجي غير مكتملة أو غير صحيحة.';
  end if;

  select s.name into v_supplier_name
  from public.baro_manual_suppliers s
  where s.id=p_supplier_id and s.is_active=true;
  if v_supplier_name is null then
    raise exception using errcode='22023',message='اختر مورداً نشطاً مسجلاً في BARO.';
  end if;

  v_sale_rate:=case when p_sale_currency='USD' then 1 else p_sale_exchange_rate end;
  v_cost_rate:=case when p_supplier_cost_currency='USD' then 1 else p_supplier_cost_exchange_rate end;
  v_sale_usd:=case when p_sale_currency='USD' then p_sale_amount else p_sale_amount/nullif(v_sale_rate,0) end;
  v_cost_usd:=case when p_supplier_cost_currency='USD' then p_supplier_cost_amount else p_supplier_cost_amount/nullif(v_cost_rate,0) end;

  insert into public.baro_manual_external_sales(
    product_name,customer_name,player_id,supplier_id,supplier_name_snapshot,
    sale_amount,sale_currency,sale_exchange_rate,sale_usd_equivalent,
    supplier_cost_amount,supplier_cost_currency,supplier_cost_exchange_rate,supplier_cost_usd_equivalent,
    payment_method,customer_reference,supplier_reference,notes,idempotency_key,created_by
  ) values (
    btrim(p_product_name),btrim(coalesce(p_customer_name,'')),btrim(coalesce(p_player_id,'')),
    p_supplier_id,v_supplier_name,p_sale_amount,p_sale_currency,v_sale_rate,v_sale_usd,
    p_supplier_cost_amount,p_supplier_cost_currency,v_cost_rate,v_cost_usd,
    p_payment_method,btrim(coalesce(p_customer_reference,'')),btrim(coalesce(p_supplier_reference,'')),
    btrim(coalesce(p_notes,'')),btrim(p_idempotency_key),p_admin_id
  )
  on conflict(idempotency_key) do nothing
  returning * into v_sale;

  if v_sale.id is null then
    select * into v_sale from public.baro_manual_external_sales where idempotency_key=btrim(p_idempotency_key);
    if not found
       or v_sale.product_name is distinct from btrim(p_product_name)
       or v_sale.supplier_id is distinct from p_supplier_id
       or v_sale.sale_amount is distinct from p_sale_amount
       or v_sale.sale_currency is distinct from p_sale_currency
       or v_sale.supplier_cost_amount is distinct from p_supplier_cost_amount
       or v_sale.supplier_cost_currency is distinct from p_supplier_cost_currency
       or v_sale.sale_exchange_rate is distinct from v_sale_rate
       or v_sale.supplier_cost_exchange_rate is distinct from v_cost_rate
       or v_sale.customer_name is distinct from btrim(coalesce(p_customer_name,''))
       or v_sale.player_id is distinct from btrim(coalesce(p_player_id,''))
       or v_sale.payment_method is distinct from p_payment_method
       or v_sale.customer_reference is distinct from btrim(coalesce(p_customer_reference,''))
       or v_sale.supplier_reference is distinct from btrim(coalesce(p_supplier_reference,'')) then
      raise exception using errcode='22023',message='مفتاح العملية مستخدم مع بيانات بيع مختلفة.';
    end if;
    return jsonb_build_object('sale',to_jsonb(v_sale),'replayed',true);
  end if;

  insert into public.baro_manual_finance_entries(
    external_sale_id,entry_type,title,amount,currency,exchange_rate,amount_usd_equivalent,
    status,description,external_reference,idempotency_key,created_by
  ) values
  (
    v_sale.id,'sale_received','مبيعات خارجية - '||left(v_sale.product_name,110),
    v_sale.sale_amount,v_sale.sale_currency,v_sale.sale_exchange_rate,v_sale.sale_usd_equivalent,
    'posted','بيع خارجي منفذ ومقبوض؛ المورد: '||v_supplier_name,
    nullif(v_sale.customer_reference,''),'baro-ext-'||v_sale.id::text||'-sale',p_admin_id
  ),
  (
    v_sale.id,'supplier_cost','تكلفة مورد - '||left(v_sale.product_name,110),
    v_sale.supplier_cost_amount,v_sale.supplier_cost_currency,v_sale.supplier_cost_exchange_rate,v_sale.supplier_cost_usd_equivalent,
    'posted','تكلفة المورد للعملية الخارجية: '||v_supplier_name,
    nullif(v_sale.supplier_reference,''),'baro-ext-'||v_sale.id::text||'-cost',p_admin_id
  );

  insert into public.admin_audit_log(admin_id,action,entity_type,entity_id,details)
  values(p_admin_id,'baro_external_sale_created','baro_manual_external_sale',v_sale.id::text,
    jsonb_build_object('product_name',v_sale.product_name,'supplier_id',v_sale.supplier_id,
      'sale_usd_equivalent',v_sale.sale_usd_equivalent,'supplier_cost_usd_equivalent',v_sale.supplier_cost_usd_equivalent,
      'profit_usd_equivalent',v_sale.profit_usd_equivalent,'payment_method',v_sale.payment_method));

  return jsonb_build_object('sale',to_jsonb(v_sale),'replayed',false);
end;
$function$;

revoke all on function public.baro_manual_external_sale_create_atomic(uuid,text,text,text,uuid,numeric,text,numeric,numeric,text,numeric,text,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.baro_manual_external_sale_create_atomic(uuid,text,text,text,uuid,numeric,text,numeric,numeric,text,numeric,text,text,text,text,text,boolean) to service_role;

commit;
