-- HomsCard variable-quantity order lifecycle.
-- This migration builds the transactional wallet/order foundation but does not enable supplier execution.
alter table private.baran_supplier_order_attempts
  add column if not exists supplier_order_uuid uuid not null default gen_random_uuid();

alter table public.order_fulfillment
  add column if not exists supplier_delivery text,
  add column if not exists supplier_order_uuid uuid;

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

  if product_group = 'homscard_variable' then
    select s.market_exchange_rate, s.fx_buffer_percent
      into market_rate, fx_buffer
      from public.store_settings s where s.id = 'main';
    if market_rate is null or market_rate <= 0 or fx_buffer is null or fx_buffer < 0 then
      raise exception 'Store commercial exchange rate is unavailable';
    end if;
    current_rate := market_rate * (1 + fx_buffer / 100);
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

create or replace function public.baran_create_homscard_variable_order(
  p_user_id uuid,
  p_product_id text,
  p_quantity integer,
  p_payment_currency text,
  p_player_id text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_audit record;
  v_config private.baran_supplier_api_configs%rowtype;
  v_supplier_id uuid;
  v_product_code text;
  v_category_raw text;
  v_category text;
  v_product_category text;
  v_product_name text;
  v_cost numeric;
  v_markup numeric;
  v_sale_unit numeric;
  v_rate numeric;
  v_min integer;
  v_max integer;
  v_params jsonb;
  v_player text := nullif(btrim(coalesce(p_player_id,'')),'');
  v_balance numeric;
  v_amount numeric;
  v_order public.orders%rowtype;
  v_existing public.orders%rowtype;
  v_prepare jsonb;
  v_attempt_id uuid;
  v_supplier_uuid uuid;
  v_transaction_id uuid;
begin
  if p_user_id is null or p_request_id is null
     or p_product_id is null or p_product_id !~ '^[0-9]{1,10}$'
     or p_quantity is null or p_quantity < 1
     or p_payment_currency not in ('USD','SYP')
     or length(coalesce(p_player_id,'')) > 100 then
    raise exception 'بيانات الطلب غير صالحة' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_request_id::text,0));
  select * into v_existing from public.orders
   where user_id=p_user_id and client_request_id=p_request_id for update;
  if found then
    if v_existing.product_code <> 'HOMSCARD_VAR_'||p_product_id
       or v_existing.quantity <> p_quantity
       or v_existing.payment_currency <> p_payment_currency
       or coalesce(v_existing.player_id,'') <> coalesce(nullif(btrim(coalesce(p_player_id,'')),''),'') then
      raise exception 'معرّف الطلب مستخدم لطلب مختلف.' using errcode='22023';
    end if;
    select a.id,a.supplier_order_uuid into v_attempt_id,v_supplier_uuid
      from private.baran_supplier_order_attempts a
     where a.order_id=v_existing.id order by a.attempt_number desc limit 1;
    return jsonb_build_object('success',true,'duplicate',true,'order_id',v_existing.id,
      'status',v_existing.status,'supplier_order_uuid',v_supplier_uuid);
  end if;

  select ai.product_id,ai.product_name,ai.product_data,ai.page_data,ai.updated_at
    into v_audit
    from public.baran_homscard_audit_items ai
   where ai.product_id=p_product_id and ai.page_status='success'
   order by ai.updated_at desc limit 1;
  if not found or v_audit.updated_at < now()-interval '24 hours'
     or coalesce(v_audit.product_data->>'product_type','') <> 'quantity'
     or coalesce((v_audit.product_data->>'available')::boolean,false) is not true
     or nullif(v_audit.page_data->>'text','') is null then
    raise exception 'بيانات المنتج لدى HomsCard غير محدثة أو غير متاحة' using errcode='55000';
  end if;

  v_category_raw := btrim(coalesce(v_audit.product_data->>'category',''));
  v_category := regexp_replace(v_category_raw,'^ال','');
  v_product_category := case
    when v_category like 'ألعاب%' then 'game'
    when v_category like 'تطبيقات%' or v_category like 'اتصالات%' then 'app'
    when v_category like 'محافظ%' then 'gift_card'
    else null end;
  if v_product_category is null then
    raise exception 'فئة المنتج غير معتمدة للشراء الآلي' using errcode='55000';
  end if;

  v_cost := nullif(v_audit.product_data->>'price','')::numeric;
  v_min := nullif(v_audit.product_data#>>'{qty_values,min}','')::integer;
  v_max := nullif(v_audit.product_data#>>'{qty_values,max}','')::integer;
  v_params := case when jsonb_typeof(v_audit.product_data->'params')='array'
                   then v_audit.product_data->'params' else '[]'::jsonb end;
  if v_cost is null or v_cost <= 0 or v_min is null or v_max is null
     or v_min < 1 or v_max < v_min or p_quantity < v_min or p_quantity > v_max then
    raise exception 'الكمية أو سعر المورد خارج الحدود المعتمدة' using errcode='22023';
  end if;
  if jsonb_array_length(v_params) > 1 then
    raise exception 'هذا المنتج يتطلب أكثر من حقل حساب؛ يلزم إعداد مخصص قبل الشراء' using errcode='55000';
  end if;
  if jsonb_array_length(v_params)=1 and (v_player is null or length(v_player)<2) then
    raise exception 'أدخل بيانات الحساب المطلوبة لهذا المنتج' using errcode='22023';
  end if;

  select s.id into v_supplier_id
    from public.suppliers s where lower(s.name)='homscard' and s.is_active=true limit 1;
  if v_supplier_id is null then raise exception 'مورد HomsCard غير مفعّل' using errcode='55000'; end if;
  select * into v_config from private.baran_supplier_api_configs c
   where c.supplier_id=v_supplier_id for update;
  if not found or not v_config.integration_enabled or not v_config.execution_enabled
     or v_config.connection_status <> 'ready'
     or v_config.create_order_path <> '/order.php'
     or v_config.order_status_path <> '/check.php'
     or v_config.auth_secret_name is null then
    raise exception 'تنفيذ HomsCard غير مفعّل أو غير جاهز؛ لم يتم إنشاء طلب أو خصم رصيد' using errcode='55000';
  end if;

  select ss.product_markup_percent,
         ss.market_exchange_rate*(1+ss.fx_buffer_percent/100)
    into v_markup,v_rate from public.store_settings ss where ss.id='main';
  if v_markup is null or v_markup<0 or v_rate is null or v_rate<=0 then
    raise exception 'إعدادات التسعير غير صالحة' using errcode='22023';
  end if;
  v_sale_unit := round(v_cost*(1+v_markup/100),8);
  v_product_code := 'HOMSCARD_VAR_'||p_product_id;
  v_product_name := left(coalesce(nullif(v_audit.product_name,''),v_audit.product_data->>'name','منتج HomsCard'),120);

  insert into public.products(product_code,category,name,description,price_usd,price_syp,is_active,catalog_group)
  values(v_product_code,v_product_category,v_product_name,
    'HomsCard variable-quantity product #'||p_product_id,v_sale_unit,
    round(v_sale_unit*v_rate),true,'homscard_variable')
  on conflict(product_code) do update set
    category=excluded.category,name=excluded.name,description=excluded.description,
    price_usd=excluded.price_usd,price_syp=excluded.price_syp,is_active=true,
    catalog_group='homscard_variable',updated_at=now();

  insert into public.supplier_products(supplier_id,product_id,supplier_sku,unit_cost,currency,is_preferred,input_schema,notes)
  select v_supplier_id,p.id,p_product_id,v_cost,'USD',true,
    case when jsonb_array_length(v_params)=1 then
      jsonb_build_array(jsonb_build_object('name',v_params->>0,'required',true))
    else '[]'::jsonb end,
    'Synced from the latest successful HomsCard audit'
  from public.products p where p.product_code=v_product_code
  on conflict(supplier_id,product_id) do update set
    supplier_sku=excluded.supplier_sku,unit_cost=excluded.unit_cost,currency='USD',
    is_preferred=true,input_schema=excluded.input_schema,updated_at=now();

  insert into public.wallets(user_id,balance_usd,balance_syp)
  values(p_user_id,0,0) on conflict(user_id) do nothing;
  insert into public.orders(user_id,product_code,player_id,quantity,payment_currency,client_request_id)
  values(p_user_id,v_product_code,v_player,p_quantity,p_payment_currency,p_request_id)
  returning * into v_order;

  v_amount := case when p_payment_currency='USD' then v_order.total_price_usd
                   else v_order.total_price_syp end;
  select case when p_payment_currency='USD' then w.balance_usd else w.balance_syp end
    into v_balance from public.wallets w where w.user_id=p_user_id for update;
  if v_amount is null or v_amount<=0 or v_balance is null or v_balance<v_amount then
    raise exception 'رصيد محفظتك غير كافٍ لإتمام الطلب';
  end if;

  update public.wallets set
    balance_usd=case when p_payment_currency='USD' then balance_usd-v_amount else balance_usd end,
    balance_syp=case when p_payment_currency='SYP' then balance_syp-v_amount else balance_syp end
   where user_id=p_user_id;
  insert into public.wallet_transactions(user_id,amount,currency,transaction_type,description,order_id)
  values(p_user_id,v_amount,p_payment_currency,'order_payment',
    'دفع طلب HomsCard #'||left(v_order.id::text,8),v_order.id)
  returning id into v_transaction_id;

  insert into public.order_fulfillment(order_id,supplier_status,dispatch_state)
  values(v_order.id,'not_sent','not_queued') on conflict(order_id) do nothing;

  v_prepare := public.baran_supplier_prepare_order(v_order.id);
  if coalesce((v_prepare->>'queued')::boolean,false) is not true then
    raise exception 'تعذر تجهيز الطلب لدى HomsCard: %',coalesce(v_prepare->>'message','unknown');
  end if;
  v_attempt_id := nullif(v_prepare->>'attempt_id','')::uuid;
  select a.supplier_order_uuid into v_supplier_uuid
    from private.baran_supplier_order_attempts a where a.id=v_attempt_id;
  update public.order_fulfillment set supplier_order_uuid=v_supplier_uuid,updated_at=now()
   where order_id=v_order.id;

  return jsonb_build_object('success',true,'duplicate',false,'order_id',v_order.id,
    'status','awaiting_supplier','amount_charged',v_amount,'payment_currency',p_payment_currency,
    'supplier_order_uuid',v_supplier_uuid,'supplier_sku',p_product_id,
    'attempt_id',v_attempt_id,'quantity',p_quantity,'product_name',v_product_name);
end;
$function$;

revoke all on function public.baran_create_homscard_variable_order(uuid,text,integer,text,text,uuid) from public, anon, authenticated;
grant execute on function public.baran_create_homscard_variable_order(uuid,text,integer,text,text,uuid) to service_role;
