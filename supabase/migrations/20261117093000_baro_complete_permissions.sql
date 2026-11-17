-- Allow scoped BARO staff permissions without granting BARAN-wide administrator access.

create or replace function public.baro_manual_product_save_complete_atomic(
  p_admin_id uuid,p_product_code text,p_supplier_cost_usd numeric,p_sale_price_usd numeric,
  p_sale_price_syp numeric,p_admin_notes text,p_catalog_visible boolean,p_purchase_enabled boolean
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare v_product public.leo_manual_products%rowtype;
begin
  if p_admin_id is null or not public.baro_manual_has_permission(p_admin_id,'catalog') then
    raise exception using errcode='42501',message='BARO catalog permission required';
  end if;
  if p_product_code is null or p_product_code !~ '^LEO_[A-Z0-9_]{3,56}$'
     or p_supplier_cost_usd is not null and (p_supplier_cost_usd<0 or p_supplier_cost_usd>1000000)
     or p_sale_price_usd is not null and (p_sale_price_usd<0 or p_sale_price_usd>1000000)
     or p_sale_price_syp is not null and (p_sale_price_syp<0 or p_sale_price_syp>100000000000)
     or char_length(coalesce(p_admin_notes,''))>1000
     or p_catalog_visible is null or p_purchase_enabled is null then
    raise exception using errcode='22023',message='بيانات منتج BARO غير صحيحة.';
  end if;
  if p_purchase_enabled and (
    not p_catalog_visible or coalesce(p_sale_price_usd,0)<=0 or coalesce(p_sale_price_syp,0)<=0
  ) then
    raise exception using errcode='22023',message='يجب إظهار المنتج وإدخال سعر موجب بالدولار والليرة قبل إتاحة الطلب.';
  end if;
  perform set_config('app.baro_actor_id',p_admin_id::text,true);
  select * into v_product from public.leo_manual_products where product_code=p_product_code for update;
  if not found then raise exception using errcode='P0002',message='BARO product not found'; end if;
  update public.leo_manual_products
  set supplier_cost_usd=p_supplier_cost_usd,
      sale_price_usd=p_sale_price_usd,
      sale_price_syp=p_sale_price_syp,
      admin_notes=coalesce(p_admin_notes,''),
      catalog_visible=p_catalog_visible,
      purchase_enabled=p_purchase_enabled,
      updated_at=now()
  where product_code=p_product_code
  returning * into v_product;
  insert into public.admin_audit_log(admin_id,action,entity_type,entity_id,details)
  values(p_admin_id,'baro_manual_product_saved','leo_manual_product',p_product_code,
    jsonb_build_object('sale_price_usd',v_product.sale_price_usd,'sale_price_syp',v_product.sale_price_syp,
      'supplier_cost_usd',v_product.supplier_cost_usd,'catalog_visible',v_product.catalog_visible,
      'purchase_enabled',v_product.purchase_enabled));
  return jsonb_build_object('product',to_jsonb(v_product));
end;
$function$;
revoke all on function public.baro_manual_product_save_complete_atomic(uuid,text,numeric,numeric,numeric,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.baro_manual_product_save_complete_atomic(uuid,text,numeric,numeric,numeric,text,boolean,boolean) to service_role;

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
begin
  if p_admin_id is null or not public.baro_manual_has_permission(p_admin_id,'orders') then
    raise exception using errcode='42501',message='BARO order permission required';
  end if;
  if p_order_id is null or p_status is null
     or p_status not in ('pending','awaiting_payment','paid','in_progress','completed','failed','needs_review','cancelled')
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
      completed_at=case when p_status='completed' then v_now else v_current.completed_at end
  where id=p_order_id returning * into v_order;
  insert into public.leo_manual_order_events(order_id,actor_id,event_type,details)
  values(p_order_id,p_admin_id,'admin_order_review',jsonb_build_object(
    'from',v_current.status,'to',p_status,'payment_status',p_payment_status,
    'quote_currency',p_quote_currency,'quote_amount',p_quote_amount));
  insert into public.admin_audit_log(admin_id,action,entity_type,entity_id,details)
  values(p_admin_id,'baro_manual_order_review','leo_manual_order',p_order_id::text,
    jsonb_build_object('from',v_current.status,'to',p_status,'payment_status',p_payment_status));
  return jsonb_build_object('order',to_jsonb(v_order),'wallet_changed',false,'finance_posted',false);
end;
$function$;
revoke all on function public.baro_manual_order_admin_update_atomic(uuid,uuid,text,numeric,text,text,text,numeric,text,text,text) from public,anon,authenticated;
grant execute on function public.baro_manual_order_admin_update_atomic(uuid,uuid,text,numeric,text,text,text,numeric,text,text,text) to service_role;
