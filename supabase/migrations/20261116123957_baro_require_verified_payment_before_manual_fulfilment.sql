create or replace function public.baro_manual_order_admin_update_atomic(
p_admin_id uuid,p_order_id uuid,p_status text,p_quote_amount numeric,p_quote_currency text,p_payment_method text,p_payment_status text,
p_customer_message text,p_supplier_cost_usd numeric,p_supplier_reference text,p_exception_reason text,p_internal_notes text)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_current public.leo_manual_orders%rowtype; v_order public.leo_manual_orders%rowtype; v_now timestamptz:=pg_catalog.now();
v_usd numeric:=null; v_syp numeric:=null; v_allowed_status text[]:=array['pending','awaiting_payment','paid','in_progress','completed','failed','needs_review','cancelled'];
begin
 if p_admin_id is null or not public.admin_is_user(p_admin_id) then raise exception using errcode='42501',message='admin access required'; end if;
 if p_order_id is null or not (p_status=any(v_allowed_status))
 or p_payment_status not in ('awaiting_quote','awaiting_payment','verified','failed')
 or (p_quote_amount is not null and (p_quote_amount<=0 or p_quote_amount>1000000000000))
 or (p_quote_currency is not null and p_quote_currency not in ('USD','SYP'))
 or (p_payment_method is not null and pg_catalog.length(p_payment_method)>60)
 or pg_catalog.length(coalesce(p_customer_message,''))>500 or pg_catalog.length(coalesce(p_internal_notes,''))>2000
 or pg_catalog.length(coalesce(p_supplier_reference,''))>160 or pg_catalog.length(coalesce(p_exception_reason,''))>500
 or (p_supplier_cost_usd is not null and (p_supplier_cost_usd<0 or p_supplier_cost_usd>1000000)) then
  raise exception using errcode='22023',message='بيانات تحديث طلب BARO غير صحيحة.';
 end if;
 if p_status='awaiting_payment' and (p_quote_amount is null or p_quote_currency is null or p_payment_status<>'awaiting_payment'
 or pg_catalog.length(pg_catalog.btrim(coalesce(p_payment_method,'')))<2) then
  raise exception using errcode='22023',message='يجب تحديد السعر والعملة وطريقة الدفع قبل إرسال عرض السعر.';
 end if;
 if p_status in ('paid','in_progress','completed') and (p_payment_status<>'verified' or p_quote_amount is null or p_quote_currency is null) then
  raise exception using errcode='22023',message='لا يمكن متابعة الشحن قبل تسجيل السعر وتأكيد استلام الدفع يدوياً.';
 end if;
 if p_status='completed' and (coalesce(p_supplier_cost_usd,0)<=0 or
 (pg_catalog.length(pg_catalog.btrim(coalesce(p_supplier_reference,'')))<2 and pg_catalog.length(pg_catalog.btrim(coalesce(p_exception_reason,'')))<5)) then
  raise exception using errcode='22023',message='إكمال الطلب يتطلب تكلفة التنفيذ ومرجع العملية أو سبب استثناء موثق.';
 end if;
 if p_quote_currency='USD' then v_usd:=p_quote_amount; elsif p_quote_currency='SYP' then v_syp:=p_quote_amount; end if;
 select * into v_current from public.leo_manual_orders where id=p_order_id for update;
 if not found then raise exception using errcode='P0002',message='order not found'; end if;
 update public.leo_manual_orders set status=p_status,customer_price_usd=v_usd,customer_price_syp=v_syp,payment_status=p_payment_status,
 payment_method=nullif(pg_catalog.btrim(coalesce(p_payment_method,'')),''),customer_message=coalesce(p_customer_message,''),
 supplier_cost_usd=p_supplier_cost_usd,supplier_reference=nullif(pg_catalog.btrim(coalesce(p_supplier_reference,'')),''),
 exception_reason=nullif(pg_catalog.btrim(coalesce(p_exception_reason,'')),''),internal_notes=coalesce(p_internal_notes,''),
 updated_at=v_now,completed_at=case when p_status='completed' then v_now else null end
 where id=p_order_id returning * into v_order;
 insert into public.leo_manual_order_events(order_id,actor_id,event_type,details)
 values(p_order_id,p_admin_id,'admin_order_review',pg_catalog.jsonb_build_object('from',v_current.status,'to',p_status,'payment_status',p_payment_status,'quote_currency',p_quote_currency,'quote_amount',p_quote_amount));
 insert into public.admin_audit_log(admin_id,action,entity_type,entity_id,details)
 values(p_admin_id,'baro_manual_order_review','leo_manual_order',p_order_id::text,pg_catalog.jsonb_build_object('from',v_current.status,'to',p_status,'payment_status',p_payment_status));
 return pg_catalog.jsonb_build_object('order',pg_catalog.to_jsonb(v_order),'wallet_changed',false,'finance_posted',false);
end;$function$;
revoke all on function public.baro_manual_order_admin_update_atomic(uuid,uuid,text,numeric,text,text,text,text,numeric,text,text,text) from public,anon,authenticated;
grant execute on function public.baro_manual_order_admin_update_atomic(uuid,uuid,text,numeric,text,text,text,text,numeric,text,text,text) to service_role;