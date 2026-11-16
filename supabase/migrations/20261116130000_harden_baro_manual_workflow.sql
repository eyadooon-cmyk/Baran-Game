-- BARO hardening: atomic product configuration and strict order-state transitions.
-- Branch-only migration; do not apply to production until reviewed and staged.

-- Deactivate any previously exposed test catalogue entries that lack an approved sale price.
update public.leo_manual_products
set catalog_visible=false,purchase_enabled=false,updated_at=pg_catalog.now()
where purchase_enabled=true
  and coalesce(sale_price_usd,0)<=0
  and coalesce(sale_price_syp,0)<=0;

alter table public.leo_manual_products
  drop constraint if exists leo_manual_products_purchase_requires_sale_price;
alter table public.leo_manual_products
  add constraint leo_manual_products_purchase_requires_sale_price
  check (
    purchase_enabled=false
    or coalesce(sale_price_usd,0)>0
    or coalesce(sale_price_syp,0)>0
  );

create or replace function public.baro_manual_product_configure_atomic(
  p_admin_id uuid,p_product_code text,p_catalog_visible boolean,p_purchase_enabled boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_product public.leo_manual_products%rowtype;
begin
  if p_admin_id is null or not public.admin_is_user(p_admin_id) then
    raise exception using errcode='42501',message='admin access required';
  end if;
  if p_product_code is null or p_catalog_visible is null or p_purchase_enabled is null then
    raise exception using errcode='22023',message='إعدادات إتاحة المنتج غير صحيحة.';
  end if;
  if p_purchase_enabled and not p_catalog_visible then
    raise exception using errcode='22023',message='يجب إظهار المنتج قبل فتح استقبال الطلبات.';
  end if;
  select * into v_product from public.leo_manual_products
  where product_code=p_product_code for update;
  if not found then
    raise exception using errcode='P0002',message='product not found';
  end if;
  if p_purchase_enabled
     and coalesce(v_product.sale_price_usd,0) <= 0
     and coalesce(v_product.sale_price_syp,0) <= 0 then
    raise exception using errcode='22023',message='يجب تحديد سعر بيع موجب قبل فتح استقبال الطلبات.';
  end if;
  update public.leo_manual_products
  set catalog_visible=p_catalog_visible,purchase_enabled=p_purchase_enabled,updated_at=pg_catalog.now()
  where product_code=p_product_code returning * into v_product;
  insert into public.admin_audit_log(admin_id,action,entity_type,entity_id,details)
  values(p_admin_id,'baro_manual_product_configure','leo_manual_product',p_product_code,
    pg_catalog.jsonb_build_object('catalog_visible',p_catalog_visible,'purchase_enabled',p_purchase_enabled));
  return pg_catalog.jsonb_build_object('product',pg_catalog.to_jsonb(v_product));
end;
$function$;
revoke all on function public.baro_manual_product_configure_atomic(uuid,text,boolean,boolean)
  from public,anon,authenticated;
grant execute on function public.baro_manual_product_configure_atomic(uuid,text,boolean,boolean)
  to service_role;

create or replace function public.baro_manual_product_save_atomic(
  p_admin_id uuid,
  p_product_code text,
  p_supplier_cost_usd numeric,
  p_sale_price_usd numeric,
  p_sale_price_syp numeric,
  p_admin_notes text,
  p_catalog_visible boolean,
  p_purchase_enabled boolean
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_pricing jsonb;
  v_config jsonb;
  v_product jsonb;
begin
  if p_admin_id is null or not public.admin_is_user(p_admin_id) then
    raise exception using errcode='42501', message='admin access required';
  end if;
  if p_product_code is null
     or p_product_code !~ '^LEO_[A-Z0-9_]{3,56}$'
     or p_catalog_visible is null
     or p_purchase_enabled is null then
    raise exception using errcode='22023', message='إعدادات منتج BARO غير صحيحة.';
  end if;
  if p_purchase_enabled and (
    not p_catalog_visible
    or (coalesce(p_sale_price_usd,0) <= 0 and coalesce(p_sale_price_syp,0) <= 0)
  ) then
    raise exception using errcode='22023', message='يجب إظهار المنتج وتحديد سعر بيع موجب قبل فتح استقبال الطلبات.';
  end if;

  -- Both changes run in one database transaction. Any failure rolls back both.
  v_pricing := public.baro_manual_product_update_atomic(
    p_admin_id,p_product_code,p_supplier_cost_usd,p_sale_price_usd,p_sale_price_syp,p_admin_notes
  );
  v_config := public.baro_manual_product_configure_atomic(
    p_admin_id,p_product_code,p_catalog_visible,p_purchase_enabled
  );
  v_product := v_config->'product';
  return pg_catalog.jsonb_build_object(
    'product',v_product,
    'pricing',v_pricing,
    'catalog_visible',p_catalog_visible,
    'purchase_enabled',p_purchase_enabled
  );
end;
$function$;
revoke all on function public.baro_manual_product_save_atomic(uuid,text,numeric,numeric,numeric,text,boolean,boolean)
  from public,anon,authenticated;
grant execute on function public.baro_manual_product_save_atomic(uuid,text,numeric,numeric,numeric,text,boolean,boolean)
  to service_role;


create or replace function public.baro_manual_order_admin_update_atomic(
  p_admin_id uuid,
  p_order_id uuid,
  p_status text,
  p_quote_amount numeric,
  p_quote_currency text,
  p_payment_method text,
  p_payment_status text,
  p_customer_message text,
  p_supplier_cost_usd numeric,
  p_supplier_reference text,
  p_exception_reason text,
  p_internal_notes text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_current public.leo_manual_orders%rowtype;
  v_order public.leo_manual_orders%rowtype;
  v_now timestamptz := pg_catalog.now();
  v_usd numeric := null;
  v_syp numeric := null;
  v_transition_ok boolean := false;
begin
  if p_admin_id is null or not public.admin_is_user(p_admin_id) then
    raise exception using errcode='42501', message='admin access required';
  end if;
  if p_order_id is null
     or p_status is null
     or p_status not in ('pending','awaiting_payment','paid','in_progress','completed','failed','needs_review','cancelled')
     or p_payment_status is null
     or p_payment_status not in ('awaiting_quote','awaiting_payment','verified','failed')
     or (p_quote_amount is not null and (p_quote_amount <= 0 or p_quote_amount > 1000000000000))
     or (p_quote_currency is not null and p_quote_currency not in ('USD','SYP'))
     or (p_payment_method is not null and pg_catalog.length(p_payment_method) > 60)
     or pg_catalog.length(coalesce(p_customer_message,'')) > 500
     or pg_catalog.length(coalesce(p_internal_notes,'')) > 2000
     or pg_catalog.length(coalesce(p_supplier_reference,'')) > 160
     or pg_catalog.length(coalesce(p_exception_reason,'')) > 500
     or (p_supplier_cost_usd is not null and (p_supplier_cost_usd < 0 or p_supplier_cost_usd > 1000000)) then
    raise exception using errcode='22023', message='بيانات تحديث طلب BARO غير صحيحة.';
  end if;

  select * into v_current
  from public.leo_manual_orders
  where id=p_order_id
  for update;
  if not found then
    raise exception using errcode='P0002', message='order not found';
  end if;

  if p_status = v_current.status then
    v_transition_ok := true;
  else
    v_transition_ok := case v_current.status
      when 'pending' then p_status in ('awaiting_payment','needs_review','failed','cancelled')
      when 'awaiting_payment' then p_status in ('paid','needs_review','failed','cancelled')
      when 'paid' then p_status in ('in_progress','needs_review','failed')
      when 'in_progress' then p_status in ('completed','needs_review','failed')
      when 'needs_review' then p_status in ('awaiting_payment','paid','in_progress','failed','cancelled')
      when 'failed' then p_status = 'needs_review'
      when 'completed' then false
      when 'cancelled' then false
      else false
    end;
  end if;
  if not v_transition_ok then
    raise exception using errcode='55000',
      message='انتقال حالة الطلب غير مسموح. راجع حالة الطلب الحالية قبل المتابعة.';
  end if;

  if p_status='awaiting_payment' and (
    p_quote_amount is null or p_quote_currency is null
    or p_payment_status <> 'awaiting_payment'
    or pg_catalog.length(pg_catalog.btrim(coalesce(p_payment_method,''))) < 2
  ) then
    raise exception using errcode='22023',
      message='إرسال عرض السعر يتطلب السعر والعملة وطريقة الدفع وحالة انتظار الدفع.';
  end if;

  if p_status='pending' and p_payment_status <> 'awaiting_quote' then
    raise exception using errcode='22023', message='الطلب الجديد يجب أن يبقى بانتظار عرض السعر.';
  end if;

  if p_status in ('paid','in_progress','completed') and (
    p_payment_status <> 'verified' or p_quote_amount is null or p_quote_currency is null
  ) then
    raise exception using errcode='22023',
      message='لا يمكن متابعة الشحن قبل تسجيل السعر وتأكيد استلام الدفع يدوياً.';
  end if;

  if p_status='cancelled' and p_payment_status='verified' then
    raise exception using errcode='55000',
      message='لا يمكن إلغاء طلب تم تأكيد دفعه من هذه الشاشة؛ يلزم إجراء مراجعة مالية يدوية أولاً.';
  end if;

  if p_status='completed' and (
    coalesce(p_supplier_cost_usd,0) <= 0
    or (
      pg_catalog.length(pg_catalog.btrim(coalesce(p_supplier_reference,''))) < 2
      and pg_catalog.length(pg_catalog.btrim(coalesce(p_exception_reason,''))) < 5
    )
  ) then
    raise exception using errcode='22023',
      message='إكمال الطلب يتطلب تسجيل تكلفة التنفيذ ومرجع العملية أو سبب استثناء موثق.';
  end if;

  if p_quote_currency='USD' then
    v_usd := p_quote_amount;
  elsif p_quote_currency='SYP' then
    v_syp := p_quote_amount;
  end if;

  update public.leo_manual_orders
  set status=p_status,
      customer_price_usd=v_usd,
      customer_price_syp=v_syp,
      payment_status=p_payment_status,
      payment_method=nullif(pg_catalog.btrim(coalesce(p_payment_method,'')),''),
      customer_message=coalesce(p_customer_message,''),
      supplier_cost_usd=p_supplier_cost_usd,
      supplier_reference=nullif(pg_catalog.btrim(coalesce(p_supplier_reference,'')),''),
      exception_reason=nullif(pg_catalog.btrim(coalesce(p_exception_reason,'')),''),
      internal_notes=coalesce(p_internal_notes,''),
      updated_at=v_now,
      completed_at=case when p_status='completed' then v_now else v_current.completed_at end
  where id=p_order_id
  returning * into v_order;

  insert into public.leo_manual_order_events(order_id,actor_id,event_type,details)
  values(
    p_order_id,p_admin_id,'admin_order_review',
    pg_catalog.jsonb_build_object(
      'from',v_current.status,'to',p_status,
      'payment_status',p_payment_status,
      'quote_currency',p_quote_currency,
      'quote_amount',p_quote_amount
    )
  );
  insert into public.admin_audit_log(admin_id,action,entity_type,entity_id,details)
  values(
    p_admin_id,'baro_manual_order_review','leo_manual_order',p_order_id::text,
    pg_catalog.jsonb_build_object(
      'from',v_current.status,'to',p_status,'payment_status',p_payment_status
    )
  );

  return pg_catalog.jsonb_build_object(
    'order',pg_catalog.to_jsonb(v_order),
    'wallet_changed',false,
    'finance_posted',false
  );
end;
$function$;
revoke all on function public.baro_manual_order_admin_update_atomic(uuid,uuid,text,numeric,text,text,text,text,numeric,text,text,text)
  from public,anon,authenticated;
grant execute on function public.baro_manual_order_admin_update_atomic(uuid,uuid,text,numeric,text,text,text,text,numeric,text,text,text)
  to service_role;
