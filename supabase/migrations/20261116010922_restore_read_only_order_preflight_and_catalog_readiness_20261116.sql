CREATE OR REPLACE FUNCTION public.baran_admin_catalog_readiness()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_rate numeric;
  v_products jsonb;
  v_total integer;
  v_price_ready integer;
  v_supplier_ready integer;
begin
  select exchange_rate into v_rate
  from public.store_settings
  where id = 'main';

  with report as (
    select
      p.product_code,
      p.name,
      p.category,
      p.is_active,
      p.price_usd,
      p.price_syp,
      (p.price_usd is not null and p.price_usd > 0 and v_rate is not null and v_rate > 0) as price_ready,
      exists (select 1 from public.supplier_products sp where sp.product_id = p.id) as has_mapping,
      exists (
        select 1 from public.supplier_products sp
        join public.suppliers s on s.id = sp.supplier_id and s.is_active = true
        where sp.product_id = p.id
      ) as has_active_supplier,
      exists (
        select 1 from public.supplier_products sp
        join public.suppliers s on s.id = sp.supplier_id and s.is_active = true
        where sp.product_id = p.id
          and nullif(btrim(coalesce(sp.supplier_sku, '')), '') is not null
          and sp.unit_cost is not null and sp.unit_cost >= 0
      ) as has_sku_and_cost,
      exists (
        select 1 from public.supplier_products sp
        join public.suppliers s on s.id = sp.supplier_id and s.is_active = true
        join private.baran_supplier_api_configs c on c.supplier_id = s.id
        where sp.product_id = p.id
          and nullif(btrim(coalesce(sp.supplier_sku, '')), '') is not null
          and sp.unit_cost is not null and sp.unit_cost >= 0
          and c.integration_enabled = true
          and c.execution_enabled = true
          and c.connection_status = 'ready'
          and c.create_order_path is not null
          and c.auth_secret_name is not null
      ) as has_api_ready,
      exists (
        select 1 from public.supplier_products sp
        join public.suppliers s on s.id = sp.supplier_id and s.is_active = true
        join private.baran_supplier_api_configs c on c.supplier_id = s.id
        join private.baran_supplier_balance_snapshots b on b.supplier_id = s.id
        where sp.product_id = p.id
          and c.integration_enabled = true
          and c.execution_enabled = true
          and c.connection_status = 'ready'
          and b.status = 'ok'
          and b.balance is not null
          and b.checked_at >= now() - interval '10 minutes'
      ) as has_recent_balance,
      exists (
        select 1 from public.supplier_products sp
        join public.suppliers s on s.id = sp.supplier_id and s.is_active = true
        join private.baran_supplier_api_configs c on c.supplier_id = s.id
        join lateral (
          select b.balance, b.currency, b.status, b.checked_at
          from private.baran_supplier_balance_snapshots b
          where b.supplier_id = s.id
          order by b.checked_at desc
          limit 1
        ) b on true
        where sp.product_id = p.id
          and nullif(btrim(coalesce(sp.supplier_sku, '')), '') is not null
          and sp.unit_cost is not null and sp.unit_cost >= 0
          and c.integration_enabled = true
          and c.execution_enabled = true
          and c.connection_status = 'ready'
          and c.create_order_path is not null
          and c.auth_secret_name is not null
          and b.status = 'ok'
          and b.balance is not null
          and b.checked_at >= now() - interval '10 minutes'
          and case
            when sp.currency = b.currency then b.balance >= sp.unit_cost
            when sp.currency = 'USD' and b.currency = 'SYP' and v_rate > 0 then b.balance >= sp.unit_cost * v_rate
            when sp.currency = 'SYP' and b.currency = 'USD' and v_rate > 0 then b.balance >= sp.unit_cost / v_rate
            else false
          end
      ) as supplier_ready
    from public.products p
  )
  select
    count(*),
    count(*) filter (where price_ready),
    count(*) filter (where supplier_ready),
    coalesce(jsonb_agg(
      jsonb_build_object(
        'product_code', product_code,
        'name', name,
        'category', category,
        'active', is_active,
        'price_ready', price_ready,
        'price_usd', price_usd,
        'price_syp', price_syp,
        'has_mapping', has_mapping,
        'has_active_supplier', has_active_supplier,
        'has_sku_and_cost', has_sku_and_cost,
        'has_api_ready', has_api_ready,
        'has_recent_balance', has_recent_balance,
        'supplier_ready', supplier_ready,
        'fulfillment_gate_open', false,
        'launch_ready', false,
        'blockers', to_jsonb(array_remove(array[
          case when not is_active then 'المنتج غير مفعّل' end,
          case when not price_ready then 'سعر البيع بالدولار أو سعر الصرف غير معتمد' end,
          case when not has_mapping then 'لا يوجد ربط منتج بمورد' end,
          case when has_mapping and not has_active_supplier then 'لا يوجد مورد مفعّل لهذا المنتج' end,
          case when has_active_supplier and not has_sku_and_cost then 'رمز SKU أو تكلفة المورد ناقصة' end,
          case when has_sku_and_cost and not has_api_ready then 'إعداد API للمورد غير جاهز' end,
          case when has_api_ready and not has_recent_balance then 'لا يوجد فحص رصيد مورد ناجح خلال آخر 10 دقائق' end,
          case when has_recent_balance and not supplier_ready then 'رصيد المورد لا يغطي التكلفة أو العملة غير متوافقة' end,
          'بوابة التنفيذ مغلقة حتى اكتمال واختبار الإرسال والتحقق والاسترداد'
        ], null))
      ) order by product_code
    ), '[]'::jsonb)
  into v_total, v_price_ready, v_supplier_ready, v_products
  from report;

  return jsonb_build_object(
    'generated_at', now(),
    'exchange_rate_valid', coalesce(v_rate > 0, false),
    'total_products', coalesce(v_total, 0),
    'price_ready_products', coalesce(v_price_ready, 0),
    'supplier_ready_products', coalesce(v_supplier_ready, 0),
    'launch_ready_products', 0,
    'fulfillment_gate_open', false,
    'products', coalesce(v_products, '[]'::jsonb)
  );
end;
$function$

REVOKE ALL ON FUNCTION public.baran_admin_catalog_readiness() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.baran_admin_catalog_readiness() TO service_role;

CREATE OR REPLACE FUNCTION public.baran_order_preflight(p_user_id uuid, p_product_code text, p_quantity integer, p_payment_currency text, p_player_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_product public.products%rowtype;
  v_wallet public.wallets%rowtype;
  v_rate numeric;
  v_price_usd numeric;
  v_total_usd numeric;
  v_total_syp numeric;
  v_due numeric;
  v_balance numeric;
  v_mapping record;
  v_snapshot record;
  v_cost numeric;
  v_cost_in_balance_currency numeric;
  v_supplier_ready boolean := false;
  v_checks jsonb := '[]'::jsonb;
  v_player text := nullif(btrim(coalesce(p_player_id,'')),'');
begin
  if p_user_id is null then raise exception 'Invalid user' using errcode='22023'; end if;
  if p_product_code is null or p_product_code !~ '^[A-Z0-9][A-Z0-9_-]{1,59}$' then
    raise exception 'Invalid product code' using errcode='22023';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 100 then
    raise exception 'Invalid quantity' using errcode='22023';
  end if;
  if p_payment_currency not in ('USD','SYP') then
    raise exception 'Invalid currency' using errcode='22023';
  end if;

  select * into v_product from public.products
  where product_code=p_product_code and is_active=true;
  if not found then
    return jsonb_build_object('success',true,'can_create_order',false,'can_purchase',false,
      'checks',jsonb_build_array(jsonb_build_object('code','PRODUCT_UNAVAILABLE','ok',false,'message','المنتج غير متاح حالياً.')));
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('code','PRODUCT_ACTIVE','ok',true,'message','المنتج موجود ومفعّل.'));

  if v_product.category='game' then
    if v_player is null or char_length(v_player)<3 or char_length(v_player)>100 then
      v_checks := v_checks || jsonb_build_array(jsonb_build_object('code','PLAYER_ID_REQUIRED','ok',false,'message','أدخل معرّف اللاعب.'));
    elsif (left(p_product_code,5)='PUBG_' or left(p_product_code,9)='FREEFIRE_')
      and v_player !~ '^[0-9]{5,24}$' then
      v_checks := v_checks || jsonb_build_array(jsonb_build_object('code','PLAYER_ID_INVALID','ok',false,'message','معرّف اللاعب يجب أن يكون من 5 إلى 24 رقماً.'));
    else
      v_checks := v_checks || jsonb_build_array(jsonb_build_object('code','PLAYER_ID_VALID','ok',true,'message','معرّف اللاعب مقبول شكلياً.'));
    end if;
  end if;

  select exchange_rate into v_rate from public.store_settings where id='main';
  v_price_usd := v_product.price_usd;
  if v_price_usd is null or v_price_usd<=0 then
    v_checks := v_checks || jsonb_build_array(jsonb_build_object('code','PRICE_NOT_APPROVED','ok',false,'message','سعر المنتج بالدولار غير معتمد.'));
  elsif v_rate is null or v_rate<=0 then
    v_checks := v_checks || jsonb_build_array(jsonb_build_object('code','EXCHANGE_RATE_MISSING','ok',false,'message','سعر الصرف غير صالح.'));
  else
    v_total_usd := round(v_price_usd*p_quantity,2);
    v_total_syp := round(v_total_usd*v_rate,2);
    v_due := case when p_payment_currency='USD' then v_total_usd else v_total_syp end;
    select * into v_wallet from public.wallets where user_id=p_user_id;
    v_balance := case when p_payment_currency='USD' then coalesce(v_wallet.balance_usd,0) else coalesce(v_wallet.balance_syp,0) end;
    if v_balance < v_due then
      v_checks := v_checks || jsonb_build_array(jsonb_build_object('code','INSUFFICIENT_WALLET','ok',false,'message','رصيد المحفظة لا يكفي للسعر الحالي.'));
    else
      v_checks := v_checks || jsonb_build_array(jsonb_build_object('code','WALLET_BALANCE_OK','ok',true,'message','الرصيد يغطي السعر الحالي.'));
    end if;
    v_checks := v_checks || jsonb_build_array(jsonb_build_object('code','PRICE_VALID','ok',true,'message','السعر وسعر الصرف صالحان.'));
  end if;

  for v_mapping in
    select sp.supplier_id,sp.supplier_sku,sp.unit_cost,sp.currency,s.name
    from public.supplier_products sp
    join public.suppliers s on s.id=sp.supplier_id and s.is_active=true
    where sp.product_id=v_product.id
    order by sp.is_preferred desc,sp.created_at asc
  loop
    if nullif(btrim(coalesce(v_mapping.supplier_sku,'')),'') is null then continue; end if;
    if v_mapping.unit_cost is null or v_mapping.unit_cost<0 then continue; end if;
    if not exists (
      select 1 from private.baran_supplier_api_configs c
      where c.supplier_id=v_mapping.supplier_id
        and c.integration_enabled=true and c.execution_enabled=true
        and c.connection_status='ready'
        and c.create_order_path is not null
        and c.auth_secret_name is not null
    ) then continue; end if;
    select b.balance,b.currency,b.status,b.checked_at into v_snapshot
    from private.baran_supplier_balance_snapshots b
    where b.supplier_id=v_mapping.supplier_id
      and b.checked_at>=now()-interval '10 minutes'
    order by b.checked_at desc limit 1;
    if not found or v_snapshot.status<>'ok' or v_snapshot.balance is null then continue; end if;
    v_cost := v_mapping.unit_cost*p_quantity;
    if v_mapping.currency=v_snapshot.currency then
      v_cost_in_balance_currency := v_cost;
    elsif v_mapping.currency='USD' and v_snapshot.currency='SYP' and v_rate>0 then
      v_cost_in_balance_currency := v_cost*v_rate;
    elsif v_mapping.currency='SYP' and v_snapshot.currency='USD' and v_rate>0 then
      v_cost_in_balance_currency := v_cost/v_rate;
    else
      continue;
    end if;
    if v_snapshot.balance>=v_cost_in_balance_currency then
      v_supplier_ready := true;
      exit;
    end if;
  end loop;

  if v_supplier_ready then
    v_checks := v_checks || jsonb_build_array(jsonb_build_object('code','SUPPLIER_READY','ok',true,'message','يوجد مورد مفعّل وربط جاهز وفحص رصيد حديث.'));
  else
    v_checks := v_checks || jsonb_build_array(jsonb_build_object('code','SUPPLIER_NOT_READY','ok',false,'message','لا يوجد مورد يحقق شروط الربط وSKU وفحص الرصيد الحديث.'));
  end if;

  v_checks := v_checks || jsonb_build_array(jsonb_build_object('code','FULFILLMENT_GATE_CLOSED','ok',false,'message','مسار إرسال المورد والتحقق من النتيجة والاسترداد لم يكتمل بعد.'));
  return jsonb_build_object(
    'success',true,'mode','preflight_only','can_create_order',false,'can_purchase',false,
    'charged',false,'order_created',false,
    'product',jsonb_build_object('code',v_product.product_code,'name',v_product.name),
    'quote',case when v_total_usd is null then null else jsonb_build_object('total_usd',v_total_usd,'total_syp',v_total_syp,'payment_currency',p_payment_currency,'amount_due',v_due) end,
    'checks',v_checks,
    'message','اكتمل فحص الجاهزية الأولي. الشراء والخصم ما زالا مغلقين حتى اكتمال واختبار مسار تنفيذ المورد.'
  );
end;
$function$

REVOKE ALL ON FUNCTION public.baran_order_preflight(uuid,text,integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.baran_order_preflight(uuid,text,integer,text,text) TO service_role;
