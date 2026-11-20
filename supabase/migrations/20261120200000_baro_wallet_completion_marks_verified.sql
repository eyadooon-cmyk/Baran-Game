-- Permit one-step completion for new BARO wallet-on-completion orders.
-- Keep the existing atomic wallet debit, supplier-cost trigger, audit, and notification behavior.
create or replace function public.baro_manual_order_admin_update_wallet_aware(
  p_admin_id uuid,p_order_id uuid,p_status text,p_quote_amount numeric,p_quote_currency text,
  p_payment_method text,p_payment_status text,p_customer_message text,p_supplier_cost_usd numeric,
  p_supplier_reference text,p_exception_reason text,p_internal_notes text
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
  v_order public.leo_manual_orders%rowtype;
  v_wallet public.wallets%rowtype;
  v_currency text;
  v_amount numeric;
  v_rate numeric;
  v_usd numeric;
  v_cost_posted boolean;
  v_sale_posted boolean;
  v_count integer;
  v_now timestamptz:=pg_catalog.now();
  v_from_status text;
  v_target_status text:=case when p_status='paid' then 'in_progress' else p_status end;
begin
  if p_admin_id is null or not public.baro_manual_has_permission(p_admin_id,'orders') then
    raise exception using errcode='42501',message='BARO order permission required';
  end if;
  select * into v_order from public.leo_manual_orders where id=p_order_id for update;
  if not found then raise exception using errcode='P0002',message='order not found'; end if;
  v_from_status:=v_order.status;

  -- Preserve the complete, existing legacy workflow byte-for-byte via its original RPC.
  if v_order.wallet_charge_mode is distinct from 'wallet_on_completion' then
    return public.baro_manual_order_admin_update_atomic(
      p_admin_id,p_order_id,p_status,p_quote_amount,p_quote_currency,p_payment_method,
      p_payment_status,p_customer_message,p_supplier_cost_usd,p_supplier_reference,
      p_exception_reason,p_internal_notes);
  end if;

  if v_target_status not in ('pending','in_progress','completed','failed','needs_review','cancelled')
     or p_payment_status not in ('awaiting_quote','verified')
     or (p_quote_amount is not null and p_quote_amount is distinct from coalesce(v_order.customer_price_usd,v_order.customer_price_syp))
     or (p_quote_currency is not null and p_quote_currency is distinct from case when v_order.customer_price_usd is not null then 'USD' else 'SYP' end)
     or pg_catalog.length(coalesce(p_customer_message,''))>500
     or pg_catalog.length(coalesce(p_internal_notes,''))>2000
     or pg_catalog.length(coalesce(p_supplier_reference,''))>160
     or pg_catalog.length(coalesce(p_exception_reason,''))>500
     or (p_supplier_cost_usd is not null and (p_supplier_cost_usd<0 or p_supplier_cost_usd>1000000)) then
    raise exception using errcode='22023',message='بيانات تحديث طلب BARO المؤجل الخصم غير صحيحة.';
  end if;

  if v_order.status='completed' then
    if v_target_status='completed' and v_order.wallet_charged_at is not null then
      return pg_catalog.jsonb_build_object('order',to_jsonb(v_order),'wallet_changed',false,
        'wallet_charge_replayed',true,'finance_posted',true);
    end if;
    raise exception using errcode='55000',message='الطلب المكتمل لا يمكن تغيير حالته.';
  end if;
  if (v_order.status='pending' and v_target_status not in ('pending','in_progress','completed','failed','needs_review','cancelled'))
     or (v_order.status='in_progress' and v_target_status not in ('in_progress','completed','failed','needs_review'))
     or (v_order.status='needs_review' and v_target_status not in ('needs_review','in_progress','failed','cancelled'))
     or (v_order.status in ('failed','cancelled') and v_target_status<>v_order.status) then
    raise exception using errcode='55000',message='انتقال حالة طلب BARO غير مسموح.';
  end if;
  if v_target_status='completed' and (
    coalesce(p_supplier_cost_usd,0)<=0 or
    (pg_catalog.length(pg_catalog.btrim(coalesce(p_supplier_reference,'')))<2
      and pg_catalog.length(pg_catalog.btrim(coalesce(p_exception_reason,'')))<5)
  ) then
    raise exception using errcode='22023',message='إكمال الطلب يتطلب التكلفة ومرجع التنفيذ أو سبب استثناء موثق.';
  end if;

  if v_target_status='completed' and v_order.wallet_charged_at is null then
    v_currency:=case when v_order.payment_method='wallet_usd' then 'USD'
      when v_order.payment_method='wallet_syp' then 'SYP' else null end;
    v_amount:=case when v_currency='USD' then v_order.customer_price_usd
      when v_currency='SYP' then v_order.customer_price_syp else null end;
    if v_currency is null or coalesce(v_amount,0)<=0 then
      raise exception using errcode='55000',message='تعذر تحديد قيمة خصم محفظة طلب BARO.';
    end if;
    insert into public.wallets(user_id,balance_usd,balance_syp)
      values(v_order.user_id,0,0) on conflict(user_id) do nothing;
    select * into v_wallet from public.wallets where user_id=v_order.user_id for update;
    if (v_currency='USD' and v_wallet.balance_usd<v_amount)
       or (v_currency='SYP' and v_wallet.balance_syp<v_amount) then
      raise exception using errcode='22023',message='رصيد العميل غير كافٍ لإكمال الشحن. لم يتم إكمال الطلب ولم يُخصم أي مبلغ.';
    end if;
    if v_currency='USD' then
      update public.wallets set balance_usd=balance_usd-v_amount where user_id=v_order.user_id;
      v_rate:=1; v_usd:=v_amount;
    else
      v_rate:=v_order.payment_exchange_rate_snapshot;
      if coalesce(v_rate,0)<=0 then
        raise exception using errcode='55000',message='سعر الصرف المحفوظ للطلب غير صالح؛ أوقفنا الإكمال لحماية الحسابات.';
      end if;
      update public.wallets set balance_syp=balance_syp-v_amount where user_id=v_order.user_id;
      v_usd:=v_amount/v_rate;
    end if;
    insert into public.wallet_transactions(user_id,amount,currency,transaction_type,description,baro_manual_order_id)
    values(v_order.user_id,-v_amount,v_currency,'baro_manual_wallet_charge',
      'خصم قيمة طلب BARO اليدوي #'||pg_catalog.left(v_order.id::text,8),v_order.id);
    insert into public.baro_manual_finance_entries(
      order_id,entry_type,title,amount,currency,exchange_rate,amount_usd_equivalent,
      status,description,idempotency_key,created_by
    ) values(v_order.id,'sale_received','تحصيل طلب BARO من المحفظة',v_amount,v_currency,
      v_rate,v_usd,'posted','خصم محفظة العميل عند اكتمال الشحن اليدوي',
      'baro-wallet-sale-'||v_order.id::text,p_admin_id);
  end if;

  perform pg_catalog.set_config('app.baro_actor_id',p_admin_id::text,true);
  update public.leo_manual_orders set
    status=v_target_status,payment_status=case when v_target_status='completed' then 'verified' else 'awaiting_quote' end,
    customer_message=coalesce(p_customer_message,''),
    supplier_cost_usd=p_supplier_cost_usd,
    supplier_reference=nullif(pg_catalog.btrim(coalesce(p_supplier_reference,'')),''),
    exception_reason=nullif(pg_catalog.btrim(coalesce(p_exception_reason,'')),''),
    internal_notes=coalesce(p_internal_notes,''),updated_at=v_now,
    completed_at=case when v_target_status='completed' then coalesce(v_order.completed_at,v_now) else v_order.completed_at end,
    wallet_charged_at=case when v_target_status='completed' then coalesce(v_order.wallet_charged_at,v_now) else v_order.wallet_charged_at end
  where id=p_order_id returning * into v_order;

  select exists(select 1 from public.baro_manual_finance_entries
    where order_id=p_order_id and entry_type='sale_received' and status='posted') into v_sale_posted;
  select exists(select 1 from public.baro_manual_finance_entries
    where order_id=p_order_id and entry_type='supplier_cost' and status='posted') into v_cost_posted;
  if v_target_status='completed' and (not v_sale_posted or not v_cost_posted or v_order.wallet_charged_at is null) then
    raise exception using errcode='55000',message='تعذر تثبيت خصم المحفظة وقيود BARO معاً؛ تم التراجع عن العملية.';
  end if;
  select count(*)::integer into v_count from public.baro_manual_finance_entries
    where order_id=p_order_id and status='posted';
  insert into public.leo_manual_order_events(order_id,actor_id,event_type,details)
  values(p_order_id,p_admin_id,'admin_wallet_order_review',pg_catalog.jsonb_build_object(
    'from',v_from_status,'to',v_target_status,'wallet_charge_mode','wallet_on_completion',
    'wallet_charged',v_target_status='completed','sale_entry_posted',v_sale_posted,
    'supplier_cost_entry_posted',v_cost_posted,'finance_entry_count',v_count));
  insert into public.admin_audit_log(admin_id,action,entity_type,entity_id,details)
  values(p_admin_id,'baro_manual_wallet_order_review','leo_manual_order',p_order_id::text,
    pg_catalog.jsonb_build_object('from',v_from_status,'to',v_target_status,'wallet_charged',v_target_status='completed',
      'sale_entry_posted',v_sale_posted,'supplier_cost_entry_posted',v_cost_posted));
  return pg_catalog.jsonb_build_object('order',to_jsonb(v_order),
    'wallet_changed',v_target_status='completed','wallet_charge_replayed',false,
    'finance_posted',v_target_status='completed','finance_entries_count',v_count,
    'sale_entry_posted',v_sale_posted,'supplier_cost_entry_posted',v_cost_posted);
end;
$function$;

revoke execute on function public.baro_manual_order_admin_update_wallet_aware(uuid,uuid,text,numeric,text,text,text,text,numeric,text,text,text) from public,anon,authenticated;
grant execute on function public.baro_manual_order_admin_update_wallet_aware(uuid,uuid,text,numeric,text,text,text,text,numeric,text,text,text) to service_role;
