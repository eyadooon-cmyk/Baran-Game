-- Fixed HomsCard order lifecycle.
-- This migration is committed for review only; it is not deployed to production.
-- The transaction is atomic: order, wallet debit, payment intent and supplier queue all roll back together on failure.

create or replace function public.set_order_price_snapshot()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  current_rate numeric;
  current_price numeric;
  product_group text;
  market_rate numeric;
  fx_buffer numeric;
begin
  select p.price_usd, p.catalog_group
    into current_price, product_group
    from public.products p
   where p.product_code = new.product_code
     and p.is_active = true;

  if current_price is null or current_price <= 0 then
    raise exception 'Product is unavailable or has no valid USD price';
  end if;

  if product_group = 'homscard_variable' or product_group = 'homscard_fixed' then
    select s.market_exchange_rate, s.fx_buffer_percent
      into market_rate, fx_buffer
      from public.store_settings s where s.id = 'main';
    if market_rate is null or market_rate <= 0 or fx_buffer is null or fx_buffer < 0 then
      raise exception 'Store commercial exchange rate is unavailable';
    end if;
    current_rate := market_rate * (1 + fx_buffer / 100) / 100;
  else
    select s.exchange_rate into current_rate
      from public.store_settings s where s.id = 'main';
  end if;

  if current_rate is null or current_rate <= 0 then
    raise exception 'Store exchange rate is unavailable';
  end if;

  new.exchange_rate := current_rate;
  new.unit_price_usd := current_price;
  new.unit_price_syp := round(current_price * current_rate);
  new.total_price_usd := round(current_price * new.quantity, 4);
  new.total_price_syp := round(current_price * current_rate * new.quantity, 2);
  return new;
end;
$function$;

-- Classify only currently verified, preferred HomsCard fixed products.
with homscard as (
  select s.id as supplier_id
  from public.suppliers s
  where lower(s.name) = 'homscard' and s.is_active = true
  limit 1
), latest_audit as (
  select distinct on (ai.product_id)
    ai.product_id, ai.product_data, ai.page_data, ai.updated_at
  from public.baran_homscard_audit_items ai
  where ai.page_status = 'success'
  order by ai.product_id, ai.updated_at desc
), approved as (
  select p.id
  from public.products p
  join public.supplier_products sp
    on sp.product_id = p.id and sp.is_preferred = true
  join homscard h on h.supplier_id = sp.supplier_id
  join latest_audit ai on ai.product_id = sp.supplier_sku
  cross join public.store_settings ss
  where ss.id = 'main'
    and (p.catalog_group is null or p.catalog_group = 'homscard_fixed')
    and p.is_active = true
    and p.price_usd > 0
    and sp.currency = 'USD'
    and sp.unit_cost > 0
    and ai.updated_at >= now() - interval '24 hours'
    and ai.product_data->>'product_type' = 'package'
    and coalesce((ai.product_data->>'available')::boolean, false) = true
    and jsonb_typeof(ai.product_data->'params') = 'array'
    and jsonb_array_length(ai.product_data->'params') = 1
    and ai.product_data->'params'->>0 ~* 'player\s*id'
    and coalesce(ai.page_data->>'text','') ~* 'player\s*id'
    and abs((ai.product_data->>'price')::numeric - sp.unit_cost) <= 0.000001
    and abs(p.price_usd - round(sp.unit_cost * (1 + ss.product_markup_percent / 100), 2)) <= 0.000001
    and p.product_code !~* '(MEMBERSHIP|SUBSCRIPTION|WEEKLY|^JAWAKER_TOKENS$)'
)
update public.products p
   set catalog_group = 'homscard_fixed', updated_at = now()
 where p.id in (select id from approved);

create or replace function public.baran_create_homscard_fixed_order(
  p_user_id uuid,
  p_product_code text,
  p_player_id text,
  p_payment_currency text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_product public.products%rowtype;
  v_supplier_id uuid;
  v_mapping public.supplier_products%rowtype;
  v_audit record;
  v_config private.baran_supplier_api_configs%rowtype;
  v_existing public.orders%rowtype;
  v_order public.orders%rowtype;
  v_player text := nullif(btrim(coalesce(p_player_id,'')),'');
  v_params jsonb;
  v_markup numeric;
  v_rate numeric;
  v_expected_sale numeric;
  v_amount numeric;
  v_balance numeric;
  v_prepare jsonb;
  v_attempt_id uuid;
  v_supplier_uuid uuid;
  v_supplier_sku text;
  v_transaction_id uuid;
begin
  if p_user_id is null or p_request_id is null
     or p_product_code is null or p_product_code !~ '^[A-Z0-9_]{3,100}$'
     or p_payment_currency is null or p_payment_currency not in ('USD','SYP')
     or v_player is null or length(v_player) < 2 or length(v_player) > 100 then
    raise exception 'بيانات الطلب الثابت غير صالحة' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_request_id::text,0));

  select * into v_existing
    from public.orders
   where user_id = p_user_id and client_request_id = p_request_id
   for update;
  if found then
    if v_existing.product_code <> p_product_code
       or v_existing.quantity <> 1
       or v_existing.payment_currency <> p_payment_currency
       or coalesce(v_existing.player_id,'') <> v_player then
      raise exception 'معرّف الطلب مستخدم لطلب مختلف.' using errcode='22023';
    end if;
    select a.supplier_order_uuid, sp.supplier_sku
      into v_supplier_uuid, v_supplier_sku
      from private.baran_supplier_order_attempts a
      join public.supplier_products sp
        on sp.product_id = (select p.id from public.products p where p.product_code = v_existing.product_code)
       and sp.is_preferred = true
      join public.suppliers s on s.id = sp.supplier_id and lower(s.name) = 'homscard'
     where a.order_id = v_existing.id
     order by a.attempt_number desc limit 1;
    if v_supplier_uuid is null or v_supplier_sku is null
       or length(v_supplier_sku) < 1 or length(v_supplier_sku) > 10
       or translate(v_supplier_sku, '0123456789', '') <> '' then
      raise exception 'بيانات محاولة HomsCard للطلب السابق غير مكتملة؛ أوقفنا التكرار للمراجعة' using errcode='55000';
    end if;
    return jsonb_build_object('success',true,'duplicate',true,
      'order_id',v_existing.id,'status',v_existing.status,
      'supplier_order_uuid',v_supplier_uuid,'supplier_sku',v_supplier_sku,'quantity',1);
  end if;

  select * into v_product
    from public.products p
   where p.product_code = p_product_code
     and p.is_active = true
     and p.catalog_group = 'homscard_fixed'
     and p.price_usd > 0
   for share;
  if not found then
    raise exception 'المنتج الثابت غير معتمد أو غير متاح حالياً' using errcode='55000';
  end if;

  select s.id into v_supplier_id
    from public.suppliers s
   where lower(s.name) = 'homscard' and s.is_active = true
   limit 1;
  if v_supplier_id is null then
    raise exception 'مورد HomsCard غير مفعّل' using errcode='55000';
  end if;

  select * into v_mapping
    from public.supplier_products sp
   where sp.supplier_id = v_supplier_id
     and sp.product_id = v_product.id
     and sp.is_preferred = true
     and sp.currency = 'USD'
     and sp.unit_cost > 0
   for share;
  if not found then
    raise exception 'لا يوجد ربط مورد ثابت ومعتمد لهذا المنتج' using errcode='55000';
  end if;

  -- Validate HomsCard numeric product ID before any order or wallet write.
  if length(v_mapping.supplier_sku) < 1 or length(v_mapping.supplier_sku) > 10
     or translate(v_mapping.supplier_sku, '0123456789', '') <> '' then
    raise exception 'معرّف منتج HomsCard غير صالح؛ لم يتم إنشاء طلب أو خصم رصيد' using errcode='22023';
  end if;

  select ai.product_id, ai.product_data, ai.page_data, ai.updated_at
    into v_audit
    from public.baran_homscard_audit_items ai
   where ai.product_id = v_mapping.supplier_sku
     and ai.page_status = 'success'
   order by ai.updated_at desc
   limit 1;
  if not found
     or v_audit.updated_at < now() - interval '24 hours'
     or v_audit.product_data->>'product_type' <> 'package'
     or coalesce((v_audit.product_data->>'available')::boolean,false) is not true
     or jsonb_typeof(v_audit.product_data->'params') <> 'array'
     or jsonb_array_length(v_audit.product_data->'params') <> 1
     or coalesce(v_audit.product_data->'params'->>0,'') !~* 'player\s*id'
     or coalesce(v_audit.page_data->>'text','') !~* 'player\s*id'
     or abs((v_audit.product_data->>'price')::numeric - v_mapping.unit_cost) > 0.000001 then
    raise exception 'تدقيق HomsCard للمنتج قديم أو لا يطابق متطلبات Player ID والتكلفة' using errcode='55000';
  end if;

  select ss.product_markup_percent,
         ss.market_exchange_rate * (1 + ss.fx_buffer_percent / 100) / 100
    into v_markup, v_rate
    from public.store_settings ss
   where ss.id = 'main';
  if v_markup is null or v_markup < 0 or v_rate is null or v_rate <= 0 then
    raise exception 'إعدادات تسعير باران غير صالحة' using errcode='22023';
  end if;
  v_expected_sale := round(v_mapping.unit_cost * (1 + v_markup / 100), 2);
  if abs(v_product.price_usd - v_expected_sale) > 0.000001 then
    raise exception 'سعر المنتج لا يطابق تكلفة HomsCard وهامش الربح الحالي؛ يلزم تحديث التسعير أولاً' using errcode='55000';
  end if;

  select * into v_config
    from private.baran_supplier_api_configs c
   where c.supplier_id = v_supplier_id
   for update;
  if not found or not v_config.integration_enabled
     or not v_config.execution_enabled
     or v_config.connection_status <> 'ready'
     or v_config.create_order_path <> '/order.php'
     or v_config.order_status_path <> '/check.php'
     or v_config.auth_secret_name is null then
    raise exception 'تنفيذ HomsCard غير مفعّل؛ لم يتم إنشاء طلب أو خصم رصيد' using errcode='55000';
  end if;

  insert into public.wallets(user_id,balance_usd,balance_syp)
  values(p_user_id,0,0) on conflict(user_id) do nothing;

  select case when p_payment_currency = 'USD' then w.balance_usd else w.balance_syp end
    into v_balance
    from public.wallets w
   where w.user_id = p_user_id
   for update;

  insert into public.orders(user_id,product_code,player_id,quantity,payment_currency,client_request_id)
  values(p_user_id,p_product_code,v_player,1,p_payment_currency,p_request_id)
  returning * into v_order;

  v_amount := case when p_payment_currency = 'USD'
    then v_order.total_price_usd else v_order.total_price_syp end;
  if v_amount is null or v_amount <= 0 or v_balance is null or v_balance < v_amount then
    raise exception 'رصيد محفظتك غير كافٍ لإتمام الطلب';
  end if;

  update public.wallets
     set balance_usd = case when p_payment_currency = 'USD' then balance_usd - v_amount else balance_usd end,
         balance_syp = case when p_payment_currency = 'SYP' then balance_syp - v_amount else balance_syp end
   where user_id = p_user_id;

  insert into public.wallet_transactions(user_id,amount,currency,transaction_type,description,order_id)
  values(p_user_id,v_amount,p_payment_currency,'order_payment',
    'دفع منتج HomsCard ثابت #' || left(v_order.id::text,8),v_order.id)
  returning id into v_transaction_id;

  insert into public.order_fulfillment(order_id,supplier_status,dispatch_state)
  values(v_order.id,'not_sent','not_queued')
  on conflict(order_id) do nothing;

  v_prepare := public.baran_supplier_prepare_order(v_order.id);
  if nullif(v_prepare->>'supplier_id','')::uuid is distinct from v_supplier_id then
    raise exception 'اختيار المورد داخل مسار التجهيز لا يطابق HomsCard؛ ألغينا الطلب والخصم لحماية العملية';
  end if;
  if coalesce((v_prepare->>'queued')::boolean,false) is not true then
    raise exception 'تعذر تجهيز طلب HomsCard الثابت: %',
      coalesce(v_prepare->>'message','unknown');
  end if;

  v_attempt_id := nullif(v_prepare->>'attempt_id','')::uuid;
  select a.supplier_order_uuid into v_supplier_uuid
    from private.baran_supplier_order_attempts a
   where a.id = v_attempt_id;

  -- A paid order must not commit without a real supplier attempt and UUID.
  if v_attempt_id is null or v_supplier_uuid is null then
    raise exception 'تعذر إنشاء محاولة HomsCard أو UUID صالح؛ ألغينا الطلب والخصم' using errcode='55000';
  end if;

  update public.order_fulfillment
     set supplier_order_uuid = v_supplier_uuid, updated_at = now()
   where order_id = v_order.id;

  return jsonb_build_object('success',true,'duplicate',false,
    'order_id',v_order.id,'status','awaiting_supplier',
    'amount_charged',v_amount,'payment_currency',p_payment_currency,
    'supplier_order_uuid',v_supplier_uuid,
    'supplier_sku',v_mapping.supplier_sku,'attempt_id',v_attempt_id,
    'quantity',1,'product_name',v_product.name,
    'wallet_transaction_id',v_transaction_id);
end;
$function$;

revoke all on function public.baran_create_homscard_fixed_order(uuid,text,text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.baran_create_homscard_fixed_order(uuid,text,text,text,uuid)
  to service_role;
