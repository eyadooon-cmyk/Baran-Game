-- Preserve HomsCard's documented 8-decimal supplier prices through settlement.
-- Widen only supplier cost columns; existing values remain numerically equivalent.
alter table public.order_fulfillment
  alter column supplier_unit_cost type numeric(20,8)
    using supplier_unit_cost::numeric(20,8),
  alter column supplier_total_cost type numeric(20,8)
    using supplier_total_cost::numeric(20,8);

-- Allow settlement of already-dispatched HomsCard orders after the admin disables new supplier execution.
-- This does NOT enable new orders, supplier API calls, or background polling.
-- New order creation remains guarded by baran_create_homscard_variable_order and prepare_order.

create or replace function public.baran_supplier_finalize_order(
  p_order_id uuid,
  p_result text,
  p_supplier_reference text default null,
  p_supplier_unit_cost numeric default null,
  p_cost_currency text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_order public.orders%rowtype;
  v_f public.order_fulfillment%rowtype;
  v_total_cost numeric;
  v_refund jsonb;
  v_attempt_id uuid;
  v_attempt_uuid uuid;
  v_attempt_status text;
begin
  if p_order_id is null or p_result not in ('succeeded','failed','unknown') then
    raise exception 'نتيجة المورد غير صالحة' using errcode='22023';
  end if;

  select * into v_order from public.orders where id=p_order_id for update;
  if not found then raise exception 'الطلب غير موجود' using errcode='P0002'; end if;

  select * into v_f from public.order_fulfillment where order_id=p_order_id for update;
  if not found or v_f.supplier_id is null or v_f.supplier_order_uuid is null then
    raise exception 'لا توجد هوية مورد موثقة لهذا الطلب' using errcode='55000';
  end if;

  -- Settlement is tied to the exact supplier UUID created for this order.
  -- Supplier enablement controls NEW dispatches, not reconciliation of an existing attempt.
  select a.id,a.supplier_order_uuid,a.attempt_status
    into v_attempt_id,v_attempt_uuid,v_attempt_status
    from private.baran_supplier_order_attempts a
   where a.order_id=p_order_id and a.supplier_id=v_f.supplier_id
   order by a.attempt_number desc limit 1 for update;

  if v_attempt_id is null or v_attempt_uuid is distinct from v_f.supplier_order_uuid then
    raise exception 'محاولة المورد لا تطابق UUID المسجل للطلب' using errcode='55000';
  end if;

  if v_attempt_status='succeeded' and p_result<>'succeeded' then
    raise exception 'تم تسجيل نجاح المورد مسبقاً ولا يمكن تحويل الطلب إلى فشل' using errcode='55000';
  end if;

  if v_f.refund_status='completed' or v_f.dispatch_state='refunded' then
    return jsonb_build_object('success',true,'duplicate',true,'result','refunded');
  end if;
  if v_order.status='completed' then
    return jsonb_build_object('success',true,'duplicate',true,'result','succeeded');
  end if;

  if p_result='unknown' then
    update private.baran_supplier_order_attempts
       set attempt_status='unknown',
           error_message=left(coalesce(p_reason,'نتيجة المورد غير محسومة'),500)
     where id=v_attempt_id;

    update public.order_fulfillment
       set supplier_status='processing',dispatch_state='awaiting_result',
           next_retry_at=now()+interval '5 minutes',
           failure_reason=left(coalesce(p_reason,'بانتظار تأكيد المورد'),500),
           updated_at=now()
     where order_id=p_order_id;

    if v_order.status<>'awaiting_supplier' then
      update public.orders set status='awaiting_supplier' where id=p_order_id;
      insert into public.order_status_events(order_id,old_status,new_status,customer_message)
      values(p_order_id,v_order.status,'awaiting_supplier',
        'نتيجة المورد غير محسومة؛ نتحقق من العملية قبل أي إعادة إرسال أو استرداد.');
    end if;

    return jsonb_build_object('success',true,'result','unknown','refunded',false,
      'message','تم تعليق الطلب للتحقق. لم يتم استرداد المبلغ أو إعادة الإرسال.');
  elsif p_result='failed' then
    update private.baran_supplier_order_attempts
       set attempt_status='failed',
           supplier_reference=nullif(btrim(coalesce(p_supplier_reference,'')),''),
           error_message=left(coalesce(p_reason,'أكد المورد فشل التنفيذ'),500),
           completed_at=now()
     where id=v_attempt_id;

    update public.order_fulfillment
       set supplier_status='failed',dispatch_state='failed',
           refund_status='pending',
           failure_reason=left(coalesce(p_reason,'أكد المورد فشل التنفيذ'),500),
           updated_at=now()
     where order_id=p_order_id;

    v_refund:=public.baran_refund_failed_supplier_order(
      p_order_id,coalesce(p_reason,'أكد المورد فشل التنفيذ')
    );
    return jsonb_build_object('success',true,'result','failed','refund',v_refund);
  else
    if p_supplier_reference is null or length(btrim(p_supplier_reference))<1
       or length(p_supplier_reference)>160
       or p_supplier_unit_cost is null or p_supplier_unit_cost<0
       or p_cost_currency not in ('USD','SYP')
       or coalesce(v_order.exchange_rate,0)<=0 then
      raise exception 'بيانات نجاح المورد أو تكلفة التنفيذ غير مكتملة' using errcode='22023';
    end if;

    v_total_cost:=round(p_supplier_unit_cost*v_order.quantity,8);

    update private.baran_supplier_order_attempts
       set attempt_status='succeeded',
           supplier_reference=p_supplier_reference,
           http_status=200,error_message=null,completed_at=now()
     where id=v_attempt_id;

    update public.order_fulfillment
       set supplier_reference=p_supplier_reference,
           supplier_status='completed',
           supplier_unit_cost=p_supplier_unit_cost,
           supplier_total_cost=v_total_cost,
           supplier_cost_currency=p_cost_currency,
           supplier_cost_exchange_rate=v_order.exchange_rate,
           dispatch_state='succeeded',
           refund_status='not_required',
           next_retry_at=null,failure_reason=null,updated_at=now()
     where order_id=p_order_id;

    update public.orders set status='completed' where id=p_order_id;
    insert into public.order_status_events(order_id,old_status,new_status,customer_message)
    values(p_order_id,v_order.status,'completed','تم تنفيذ طلبك بنجاح لدى المورد.');

    return jsonb_build_object('success',true,'result','succeeded',
      'supplier_reference',p_supplier_reference,
      'supplier_total_cost',v_total_cost,'cost_currency',p_cost_currency);
  end if;
end;
$function$;

revoke all on function public.baran_supplier_finalize_order(uuid,text,text,numeric,text,text)
  from public, anon, authenticated;
grant execute on function public.baran_supplier_finalize_order(uuid,text,text,numeric,text,text)
  to service_role;
