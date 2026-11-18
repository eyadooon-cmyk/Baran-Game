-- BARO accounting integrity: immutable financial snapshots and truthful posting status.
-- Branch-only migration. Keep BARO intake disabled; this does not enable orders or fulfilment.

create or replace function public.baro_manual_order_admin_update_atomic(
  p_admin_id uuid,p_order_id uuid,p_status text,p_quote_amount numeric,p_quote_currency text,
  p_payment_method text,p_payment_status text,p_customer_message text,p_supplier_cost_usd numeric,
  p_supplier_reference text,p_exception_reason text,p_internal_notes text
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
  v_current public.leo_manual_orders%rowtype;
  v_order public.leo_manual_orders%rowtype;
  v_now timestamptz:=pg_catalog.now();
  v_usd numeric:=null;
  v_syp numeric:=null;
  v_transition_ok boolean:=false;
  v_sale_posted boolean:=false;
  v_cost_posted boolean:=false;
  v_finance_count integer:=0;
begin
  if p_admin_id is null or not public.baro_manual_has_permission(p_admin_id,'orders') then
    raise exception using errcode='42501',message='BARO order permission required';
  end if;
  if p_order_id is null or p_status is null
     or p_status not in ('pending','awaiting_payment','paid','in_progress','awaiting_admin_confirmation','completed','failed','needs_review','cancelled')
     or p_payment_status is null or p_payment_status not in ('awaiting_quote','awaiting_payment','verified','failed')
     or (p_quote_amount is not null and (p_quote_amount<=0 or p_quote_amount>1000000000000))
     or (p_quote_currency is not null and p_quote_currency not in ('USD','SYP'))
     or (p_payment_method is not null and pg_catalog.length(p_payment_method)>60)
     or pg_catalog.length(coalesce(p_customer_message,''))>500
     or pg_catalog.length(coalesce(p_internal_notes,''))>2000
     or pg_catalog.length(coalesce(p_supplier_reference,''))>160
     or pg_catalog.length(coalesce(p_exception_reason,''))>500
     or (p_supplier_cost_usd is not null and (p_supplier_cost_usd<0 or p_supplier_cost_usd>1000000)) then
    raise exception using errcode='22023',message='بيانات تحديث طلب BARO غير صحيحة.';
  end if;

  select * into v_current from public.leo_manual_orders where id=p_order_id for update;
  if not found then raise exception using errcode='P0002',message='order not found'; end if;

  if p_status=v_current.status then
    v_transition_ok:=true;
  else
    v_transition_ok:=case v_current.status
      when 'pending' then p_status in ('awaiting_payment','needs_review','failed','cancelled')
      when 'awaiting_admin_confirmation' then p_status in ('awaiting_payment','needs_review','failed','cancelled')
      when 'awaiting_payment' then p_status in ('paid','needs_review','failed','cancelled')
      when 'paid' then p_status in ('in_progress','needs_review','failed')
      when 'in_progress' then p_status in ('completed','needs_review','failed')
      when 'needs_review' then p_status in ('awaiting_payment','paid','in_progress','failed','cancelled')
      when 'failed' then p_status='needs_review'
      else false end;
  end if;
  if not v_transition_ok then
    raise exception using errcode='55000',message='انتقال حالة الطلب غير مسموح.';
  end if;

  if p_status='awaiting_payment' and (
    p_quote_amount is null or p_quote_currency is null or p_payment_status<>'awaiting_payment'
    or pg_catalog.length(pg_catalog.btrim(coalesce(p_payment_method,'')))<2
  ) then
    raise exception using errcode='22023',message='إرسال عرض السعر يتطلب السعر والعملة وطريقة الدفع.';
  end if;
  if p_status='pending' and p_payment_status<>'awaiting_quote' then
    raise exception using errcode='22023',message='الطلب الجديد يجب أن يبقى بانتظار عرض السعر.';
  end if;
  if p_status in ('paid','in_progress','completed') and (
    p_payment_status<>'verified' or p_quote_amount is null or p_quote_currency is null
  ) then
    raise exception using errcode='22023',message='لا يمكن متابعة الشحن قبل تأكيد استلام الدفع يدوياً.';
  end if;
  if p_status='cancelled' and p_payment_status='verified' then
    raise exception using errcode='55000',message='الطلب المدفوع يحتاج تسوية مالية قبل إلغائه.';
  end if;
  if p_status='completed' and (
    coalesce(p_supplier_cost_usd,0)<=0 or
    (pg_catalog.length(pg_catalog.btrim(coalesce(p_supplier_reference,'')))<2
      and pg_catalog.length(pg_catalog.btrim(coalesce(p_exception_reason,'')))<5)
  ) then
    raise exception using errcode='22023',message='إكمال الطلب يتطلب التكلفة ومرجع التنفيذ أو سبب استثناء موثق.';
  end if;

  -- Once cash has been verified, its original customer amount/currency is immutable.
  if v_current.payment_status='verified' and (
    p_payment_status<>'verified'
    or (p_quote_currency='USD' and p_quote_amount is distinct from v_current.customer_price_usd)
    or (p_quote_currency='SYP' and p_quote_amount is distinct from v_current.customer_price_syp)
    or p_quote_currency is null
  ) then
    raise exception using errcode='55000',message='تم ترحيل المقبوض؛ لا يمكن تغيير مبلغ الدفع أو عملته. استخدم تسوية مالية موثقة.';
  end if;

  -- The supplier cost becomes immutable after completion; corrections must be separate audited adjustments.
  if v_current.status='completed' and p_supplier_cost_usd is distinct from v_current.supplier_cost_usd then
    raise exception using errcode='55000',message='تم ترحيل تكلفة الطلب المكتمل؛ لا يمكن تعديلها مباشرة. استخدم تسوية مالية موثقة.';
  end if;

  if p_quote_currency='USD' then v_usd:=p_quote_amount;
  elsif p_quote_currency='SYP' then v_syp:=p_quote_amount; end if;

  perform set_config('app.baro_actor_id',p_admin_id::text,true);
  update public.leo_manual_orders
  set status=p_status,customer_price_usd=v_usd,customer_price_syp=v_syp,
      payment_status=p_payment_status,
      payment_method=nullif(pg_catalog.btrim(coalesce(p_payment_method,'')),''),
      customer_message=coalesce(p_customer_message,''),
      supplier_cost_usd=p_supplier_cost_usd,
      supplier_reference=nullif(pg_catalog.btrim(coalesce(p_supplier_reference,'')),''),
      exception_reason=nullif(pg_catalog.btrim(coalesce(p_exception_reason,'')),''),
      internal_notes=coalesce(p_internal_notes,''),updated_at=v_now,
      completed_at=case when p_status='completed' then coalesce(v_current.completed_at,v_now) else v_current.completed_at end
  where id=p_order_id returning * into v_order;

  -- The AFTER trigger posts these entries in this same transaction. Fail closed if either is missing.
  select exists(
    select 1 from public.baro_manual_finance_entries
    where order_id=p_order_id and entry_type='sale_received' and status='posted'
      and amount_usd_equivalent is not null
  ) into v_sale_posted;
  select exists(
    select 1 from public.baro_manual_finance_entries
    where order_id=p_order_id and entry_type='supplier_cost' and status='posted'
      and amount_usd_equivalent is not null
  ) into v_cost_posted;

  if v_order.payment_status='verified' and not v_sale_posted then
    raise exception using errcode='55000',message='تعذر ترحيل مقبوض الطلب؛ تم إلغاء التحديث لحماية الدفتر المالي.';
  end if;
  if v_order.status='completed' and (not v_sale_posted or not v_cost_posted) then
    raise exception using errcode='55000',message='لا يمكن اعتماد اكتمال الطلب قبل وجود قيد المقبوض وقيد تكلفة المورد معاً.';
  end if;

  select count(*)::integer into v_finance_count
  from public.baro_manual_finance_entries
  where order_id=p_order_id and status='posted';

  insert into public.leo_manual_order_events(order_id,actor_id,event_type,details)
  values(p_order_id,p_admin_id,'admin_order_review',jsonb_build_object(
    'from',v_current.status,'to',p_status,'payment_status',p_payment_status,
    'quote_currency',p_quote_currency,'quote_amount',p_quote_amount,
    'sale_entry_posted',v_sale_posted,'supplier_cost_entry_posted',v_cost_posted,
    'finance_entry_count',v_finance_count));
  insert into public.admin_audit_log(admin_id,action,entity_type,entity_id,details)
  values(p_admin_id,'baro_manual_order_review','leo_manual_order',p_order_id::text,
    jsonb_build_object('from',v_current.status,'to',p_status,'payment_status',p_payment_status,
      'sale_entry_posted',v_sale_posted,'supplier_cost_entry_posted',v_cost_posted,
      'finance_entry_count',v_finance_count));

  return jsonb_build_object(
    'order',to_jsonb(v_order),
    'wallet_changed',false,
    'finance_posted',(v_order.status='completed' and v_order.payment_status='verified' and v_sale_posted and v_cost_posted),
    'finance_entries_count',v_finance_count,
    'sale_entry_posted',v_sale_posted,
    'supplier_cost_entry_posted',v_cost_posted
  );
end;
$function$;

revoke all on function public.baro_manual_order_admin_update_atomic(uuid,uuid,text,numeric,text,text,text,text,numeric,text,text,text)
  from public,anon,authenticated;
grant execute on function public.baro_manual_order_admin_update_atomic(uuid,uuid,text,numeric,text,text,text,text,numeric,text,text,text)
  to service_role;
