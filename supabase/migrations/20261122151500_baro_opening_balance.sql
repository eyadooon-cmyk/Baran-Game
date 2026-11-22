-- BARO opening balance support.
-- This migration is idempotent and records opening capital separately from profit.

alter table public.baro_manual_finance_entries
  drop constraint if exists baro_manual_finance_entries_entry_type_check;
alter table public.baro_manual_finance_entries
  add constraint baro_manual_finance_entries_entry_type_check
  check (entry_type = any (array[
    'sale_received','supplier_cost','expense','commission','refund',
    'adjustment','reversal','opening_balance'
  ]));

alter table public.baro_manual_finance_entries
  drop constraint if exists baro_manual_finance_entries_check;
alter table public.baro_manual_finance_entries
  add constraint baro_manual_finance_entries_check
  check (
    currency <> 'SYP'
    or entry_type = 'opening_balance'
    or (exchange_rate is not null and exchange_rate > 0)
  );

create unique index if not exists baro_manual_opening_balance_once
  on public.baro_manual_finance_entries(currency)
  where entry_type = 'opening_balance' and status = 'posted';

create or replace function public.baro_manual_finance_entry_atomic(
  p_admin_id uuid, p_order_id uuid, p_entry_type text, p_title text,
  p_amount numeric, p_currency text, p_exchange_rate numeric,
  p_description text, p_external_reference text, p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_entry public.baro_manual_finance_entries%rowtype;
  v_usd numeric;
  v_inserted boolean := false;
begin
  if p_admin_id is null or not public.baro_manual_has_permission(p_admin_id,'finance') then
    raise exception using errcode='42501',message='BARO finance permission required';
  end if;
  if p_entry_type not in ('expense','commission','refund','adjustment','opening_balance')
     or p_title is null or char_length(btrim(p_title))<2 or char_length(p_title)>140
     or p_amount is null or p_amount<=0 or p_amount>1000000000000
     or p_currency not in ('USD','SYP')
     or (p_entry_type <> 'opening_balance' and p_currency='SYP' and (p_exchange_rate is null or p_exchange_rate<=0))
     or (p_entry_type = 'opening_balance' and (p_order_id is not null or coalesce(btrim(p_idempotency_key),'') = ''))
     or char_length(coalesce(p_description,''))>1000
     or char_length(coalesce(p_external_reference,''))>160
     or char_length(coalesce(p_idempotency_key,''))>160 then
    raise exception using errcode='22023',message='بيانات الحركة المالية غير صحيحة.';
  end if;
  v_usd := case
    when p_entry_type='opening_balance' then null
    when p_currency='USD' then p_amount
    else p_amount/nullif(p_exchange_rate,0)
  end;
  insert into public.baro_manual_finance_entries(
    order_id,entry_type,title,amount,currency,exchange_rate,amount_usd_equivalent,
    status,description,external_reference,idempotency_key,created_by
  ) values (
    p_order_id,p_entry_type,btrim(p_title),p_amount,p_currency,
    case when p_entry_type='opening_balance' then null
         when p_currency='USD' then 1 else p_exchange_rate end,
    v_usd,'posted',coalesce(p_description,''),
    nullif(btrim(coalesce(p_external_reference,'')),''),
    nullif(btrim(coalesce(p_idempotency_key,'')),''),p_admin_id
  )
  on conflict (idempotency_key) do nothing
  returning * into v_entry;
  v_inserted := v_entry.id is not null;
  if not v_inserted and p_idempotency_key is not null then
    select * into v_entry from public.baro_manual_finance_entries where idempotency_key=p_idempotency_key;
    if not found or v_entry.entry_type is distinct from p_entry_type
       or v_entry.order_id is distinct from p_order_id
       or v_entry.amount is distinct from p_amount
       or v_entry.currency is distinct from p_currency then
      raise exception using errcode='22023',message='رقم الحركة المالية مستخدم مع بيانات مختلفة.';
    end if;
  end if;
  if v_entry.id is null then raise exception using errcode='40001',message='تعذر تسجيل الحركة المالية.'; end if;
  if v_inserted then
    insert into public.admin_audit_log(admin_id,action,entity_type,entity_id,details)
    values(p_admin_id,'baro_finance_entry_created','baro_manual_finance_entry',v_entry.id::text,
      jsonb_build_object('entry_type',v_entry.entry_type,'amount',v_entry.amount,'currency',v_entry.currency,'order_id',v_entry.order_id));
  end if;
  return jsonb_build_object('entry',to_jsonb(v_entry));
end;
$function$;
