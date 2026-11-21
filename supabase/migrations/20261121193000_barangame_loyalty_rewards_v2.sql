-- BARAN CLUB v2
-- Conversion: 1,000 points = $1 coupon.
-- Earning: 10 points per eligible USD, with VIP multipliers.
-- Hard cap: reward value is at most 10% of realized gross profit.
-- Existing $0.10 coupons remain valid; existing points are not changed.

CREATE OR REPLACE FUNCTION public.baran_award_order_loyalty_points()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_category text;
  v_f public.order_fulfillment%rowtype;
  v_sale_usd numeric(18,4);
  v_cost_usd numeric(18,4);
  v_profit_usd numeric(18,4);
  v_lifetime bigint:=0;
  v_multiplier numeric(6,3):=1.000;
  v_points bigint;
  v_tx_id uuid;
begin
  if new.status <> 'completed' or old.status = 'completed' then
    return new;
  end if;

  select p.category into v_category
  from public.products p
  where p.product_code = new.product_code;

  if v_category is null or v_category not in ('game','ai','vpn','app') then
    return new;
  end if;

  select * into v_f
  from public.order_fulfillment f
  where f.order_id = new.id
  for update;

  if not found
     or v_f.supplier_status <> 'completed'
     or v_f.dispatch_state <> 'succeeded'
     or v_f.supplier_total_cost is null
     or v_f.supplier_cost_currency not in ('USD','SYP') then
    return new;
  end if;

  if v_f.supplier_cost_currency = 'USD' then
    v_cost_usd := round(v_f.supplier_total_cost,4);
  else
    if coalesce(v_f.supplier_cost_exchange_rate,0) <= 0 then
      return new;
    end if;
    v_cost_usd := round(v_f.supplier_total_cost / v_f.supplier_cost_exchange_rate,4);
  end if;

  v_sale_usd := round(coalesce(new.total_price_usd,0),4);
  v_profit_usd := round(v_sale_usd - v_cost_usd,4);
  if v_sale_usd <= 0 or v_profit_usd <= 0 then
    return new;
  end if;

  select coalesce(cl.lifetime_earned,0) into v_lifetime
  from public.customer_loyalty cl
  where cl.user_id=new.user_id;

  v_multiplier:=case
    when coalesce(v_lifetime,0)>=15000 then 2.000
    when coalesce(v_lifetime,0)>=5000 then 1.500
    when coalesce(v_lifetime,0)>=1000 then 1.250
    else 1.000
  end;

  -- 1,000 points = $1. Base earning is 10 points per eligible USD.
  -- VIP multipliers increase earning, while the hard cap keeps rewards <= 10% of realized gross profit.
  v_points := least(floor(v_sale_usd * 10 * v_multiplier), floor(v_profit_usd * 100))::bigint;
  if v_points < 1 then
    return new;
  end if;

  insert into public.loyalty_transactions
    (user_id,points,transaction_type,description,order_id)
  values
    (new.user_id,v_points,'earn',
     'مكافأة BARAN CLUB عن الطلب المكتمل #' || left(new.id::text,8),new.id)
  on conflict (order_id)
    where order_id is not null and transaction_type='earn'
  do nothing
  returning id into v_tx_id;

  if v_tx_id is not null then
    insert into public.customer_loyalty(user_id,points_balance,lifetime_earned,updated_at)
    values(new.user_id,v_points,v_points,now())
    on conflict(user_id) do update set
      points_balance=public.customer_loyalty.points_balance+excluded.points_balance,
      lifetime_earned=public.customer_loyalty.lifetime_earned+excluded.lifetime_earned,
      updated_at=now();
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.baro_award_manual_order_loyalty_points()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_sale_usd numeric(18,4);
  v_profit_usd numeric(18,4);
  v_lifetime bigint:=0;
  v_multiplier numeric(6,3):=1.000;
  v_points bigint;
  v_tx_id uuid;
begin
  if new.status is distinct from 'completed'
     or new.payment_status is distinct from 'verified'
     or coalesce(new.supplier_cost_usd,0) <= 0 then
    return new;
  end if;

  if coalesce(new.customer_price_usd,0) > 0 then
    v_sale_usd := round(new.customer_price_usd,4);
  elsif coalesce(new.customer_price_syp,0) > 0
        and coalesce(new.payment_exchange_rate_snapshot,0) > 0 then
    v_sale_usd := round(new.customer_price_syp / new.payment_exchange_rate_snapshot,4);
  else
    return new;
  end if;

  v_profit_usd := round(v_sale_usd - new.supplier_cost_usd,4);
  if v_sale_usd <= 0 or v_profit_usd <= 0 then
    return new;
  end if;

  select coalesce(cl.lifetime_earned,0) into v_lifetime
  from public.customer_loyalty cl
  where cl.user_id=new.user_id;

  v_multiplier:=case
    when coalesce(v_lifetime,0)>=15000 then 2.000
    when coalesce(v_lifetime,0)>=5000 then 1.500
    when coalesce(v_lifetime,0)>=1000 then 1.250
    else 1.000
  end;

  -- 1,000 points = $1. Base earning is 10 points per eligible USD.
  -- VIP multipliers increase earning, while the hard cap keeps rewards <= 10% of realized gross profit.
  v_points := least(floor(v_sale_usd * 10 * v_multiplier), floor(v_profit_usd * 100))::bigint;
  if v_points < 1 then
    return new;
  end if;

  insert into public.loyalty_transactions
    (user_id, points, transaction_type, description, manual_order_id)
  values (new.user_id, v_points, 'earn',
     'مكافأة BARAN CLUB عن طلب BARO المكتمل #' || left(new.id::text,8), new.id)
  on conflict (manual_order_id)
    where manual_order_id is not null and transaction_type = 'earn'
  do nothing
  returning id into v_tx_id;

  if v_tx_id is not null then
    insert into public.customer_loyalty
      (user_id, points_balance, lifetime_earned, updated_at)
    values (new.user_id, v_points, v_points, now())
    on conflict (user_id) do update set
      points_balance = public.customer_loyalty.points_balance + excluded.points_balance,
      lifetime_earned = public.customer_loyalty.lifetime_earned + excluded.lifetime_earned,
      updated_at = now();
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.redeem_loyalty_coupon()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_balance bigint;
  v_code text;
  v_coupon_id uuid;
begin
  if v_user_id is null then
    raise exception 'يجب تسجيل الدخول أولاً';
  end if;

  insert into public.customer_loyalty(user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select points_balance into v_balance
  from public.customer_loyalty
  where user_id = v_user_id
  for update;

  if coalesce(v_balance,0) < 1000 then
    raise exception 'تحتاج إلى 1000 نقطة على الأقل للاستبدال';
  end if;

  update public.customer_loyalty
  set points_balance = points_balance - 1000,
      updated_at = now()
  where user_id = v_user_id
  returning points_balance into v_balance;

  v_code := 'BARAN-' || upper(encode(extensions.gen_random_bytes(6),'hex'));

  insert into public.loyalty_coupons(user_id,code,discount_amount_usd,points_spent)
  values(v_user_id,v_code,1.00,1000)
  returning id into v_coupon_id;

  insert into public.loyalty_transactions(user_id,points,transaction_type,description)
  values(v_user_id,1000,'redeem','استبدال 1,000 نقطة بقسيمة خصم بقيمة 1 دولار');

  return jsonb_build_object(
    'coupon_id',v_coupon_id,
    'code',v_code,
    'discount_amount_usd',1.00,
    'points_spent',1000,
    'remaining_points',v_balance,
    'status','active'
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.baro_manual_create_customer_order_with_coupon(p_user_id uuid, p_product_code text, p_player_id text, p_quantity integer, p_customer_note text, p_idempotency_key uuid, p_player_id_confirmed boolean, p_wallet_currency text, p_coupon_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_existing public.leo_manual_orders%rowtype;
  v_product public.leo_manual_products%rowtype;
  v_order public.leo_manual_orders%rowtype;
  v_wallet public.wallets%rowtype;
  v_enabled boolean;
  v_rate numeric;
  v_price numeric;
  v_player text:=pg_catalog.btrim(coalesce(p_player_id,''));
  v_note text:=pg_catalog.btrim(coalesce(p_customer_note,''));
  v_now timestamptz:=pg_catalog.now();
  v_hold_tx uuid;
  v_coupon public.loyalty_coupons%rowtype;
  v_coupon_id uuid;
  v_coupon_code text:=pg_catalog.upper(pg_catalog.btrim(coalesce(p_coupon_code,'')));
  v_discount_usd numeric:=0;
  v_discount_amount numeric:=0;
  v_profit_usd numeric;
  v_discount_limit numeric;
begin
  if p_user_id is null or p_idempotency_key is null or p_player_id_confirmed is not true
     or p_wallet_currency is null or p_wallet_currency not in ('USD','SYP')
     or p_product_code is null or p_product_code !~ '^LEO_[A-Z0-9_]{3,56}$'
     or pg_catalog.length(v_player)<3 or pg_catalog.length(v_player)>80
     or v_player ~ '[[:cntrl:]]' or pg_catalog.length(v_note)>500
     or p_quantity is null or p_quantity<1 or p_quantity>1000000 then
    raise exception using errcode='22023',message='بيانات الطلب أو عملة المحفظة غير صحيحة.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,0));
  select * into v_existing from public.leo_manual_orders
    where user_id=p_user_id and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.product_code is distinct from p_product_code
       or v_existing.player_id is distinct from v_player
       or v_existing.quantity is distinct from p_quantity
       or v_existing.customer_note is distinct from v_note
       or v_existing.payment_method is distinct from ('wallet_'||pg_catalog.lower(p_wallet_currency)) then
      raise exception using errcode='22023',message='رقم محاولة الطلب مستخدم مع بيانات مختلفة.';
    end if;
    if v_coupon_code<>'' then
      select id into v_coupon_id from public.loyalty_coupons
       where user_id=p_user_id and upper(code)=v_coupon_code and status in ('reserved','redeemed')
         and redeemed_order_id=v_existing.id and redeemed_order_type='baro_manual';
      if v_coupon_id is null or v_existing.coupon_id is distinct from v_coupon_id then
        raise exception using errcode='22023',message='رمز القسيمة لا يطابق محاولة الطلب السابقة.';
      end if;
    elsif v_existing.coupon_id is not null then
      raise exception using errcode='22023',message='محاولة الطلب السابقة مرتبطة بقسيمة؛ أعد إرسال نفس الرمز.';
    end if;
    return pg_catalog.jsonb_build_object('success',true,'replayed',true,'order_id',v_existing.id,
      'status',v_existing.status,'payment_status',v_existing.payment_status,'wallet_changed',true,
      'coupon_discount_usd',coalesce(v_existing.coupon_discount_usd,0),
      'wallet_settlement',(select h.status from public.baro_manual_wallet_holds h where h.order_id=v_existing.id));
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_user_id::text || ':' || p_product_code || ':' || pg_catalog.lower(pg_catalog.btrim(v_player)), 0
  ));

  if exists (
    select 1 from public.leo_manual_orders active_order
    where active_order.user_id=p_user_id
      and active_order.product_code=p_product_code
      and pg_catalog.lower(pg_catalog.btrim(active_order.player_id))=pg_catalog.lower(v_player)
      and active_order.status not in ('completed','failed','cancelled')
      and exists (select 1 from public.leo_manual_products product
        where product.product_code=p_product_code and product.category_id='freefire')
  ) then
    raise exception using errcode='23505',
      message='لديك طلب مفتوح لنفس باقة Free Fire ومعرّف اللاعب. انتظر اكتماله أو إلغاءه قبل تكرار الطلب.';
  end if;

  select enabled,usd_syp_rate into v_enabled,v_rate
    from public.baro_manual_settings where id='main' for share;
  if coalesce(v_enabled,false) is not true then
    raise exception using errcode='55000',message='استقبال طلبات BARO متوقف حالياً من الإدارة.';
  end if;
  select * into v_product from public.leo_manual_products
    where product_code=p_product_code for share;
  if not found or v_product.catalog_visible is not true or v_product.purchase_enabled is not true then
    raise exception using errcode='55000',message='هذا المنتج غير متاح للطلب اليدوي حالياً.';
  end if;
  v_price:=case when p_wallet_currency='USD' then v_product.sale_price_usd else v_product.sale_price_syp end;
  if coalesce(v_price,0)<=0 then
    raise exception using errcode='22023',message='سعر المنتج غير متاح بعملة المحفظة المختارة.';
  end if;
  if p_wallet_currency='USD' then
    if v_coupon_code<>'' then
      v_price:=round(v_price,2);
    elsif v_price<>round(v_price,2) then
      raise exception using errcode='22023',message='سعر الدولار يجب ألا يتجاوز منزلتين عشريتين.';
    end if;
  end if;
  if p_wallet_currency='SYP' and (v_price<>trunc(v_price) or coalesce(v_rate,0)<=0) then
    raise exception using errcode='22023',message='سعر الليرة أو سعر الصرف غير صالح.';
  end if;
  if v_product.category_id='jawaker' and v_product.group_id='tokens' then
    if p_quantity<10000 or p_quantity>1000000 then
      raise exception using errcode='22023',message='كمية جواكر يجب أن تكون بين 10,000 و1,000,000.';
    end if;
  elsif p_quantity<>1 then
    raise exception using errcode='22023',message='هذا المنتج لا يقبل كمية متغيرة.';
  end if;
  if v_coupon_code<>'' then
    if p_quantity<>1 then
      raise exception using errcode='22023',message='القسيمة متاحة حالياً للطلبات ذات الكمية الواحدة فقط.';
    end if;
    select * into v_coupon from public.loyalty_coupons
      where user_id=p_user_id and upper(code)=v_coupon_code for update;
    if not found or v_coupon.status<>'active' or v_coupon.discount_amount_usd not in (0.10,1.00)
       or v_coupon.points_spent<>1000 then
      raise exception using errcode='22023',message='القسيمة غير صالحة أو مستخدمة أو لا تخص حسابك.';
    end if;
    if coalesce(v_product.sale_price_usd,0)<=0 or v_product.supplier_cost_usd is null
       or v_product.supplier_cost_usd<=0 or v_product.supplier_cost_usd>=v_product.sale_price_usd then
      raise exception using errcode='55000',message='هذه الباقة غير مؤهلة للقسيمة لأن تكلفة المورد أو هامش الربح غير مؤكد.';
    end if;
    v_profit_usd:=round(v_product.sale_price_usd-v_product.supplier_cost_usd,4);
    v_discount_limit:=floor(v_profit_usd*0.90*100)/100;
    if v_discount_limit<v_coupon.discount_amount_usd then
      raise exception using errcode='55000',message='لا يمكن استخدام قسيمة الخصم على هذه الباقة دون الإضرار بهامش الربح.';
    end if;
    v_discount_usd:=v_coupon.discount_amount_usd;
    v_discount_amount:=case when p_wallet_currency='USD' then v_discount_usd else round(v_rate*v_discount_usd,0) end;
    if v_discount_amount<=0 or v_discount_amount>=v_price then
      raise exception using errcode='55000',message='قيمة الخصم أكبر من المبلغ المسموح لهذه الباقة.';
    end if;
    v_price:=v_price-v_discount_amount;
    v_coupon_id:=v_coupon.id;
  end if;

  if (select count(*) from public.leo_manual_orders
      where user_id=p_user_id and created_at>pg_catalog.now()-interval '10 minutes')>=5 then
    raise exception using errcode='54000',message='وصلت للحد المؤقت للطلبات. حاول بعد قليل.';
  end if;

  insert into public.wallets(user_id,balance_usd,balance_syp)
    values(p_user_id,0,0) on conflict(user_id) do nothing;
  select * into v_wallet from public.wallets where user_id=p_user_id for update;
  if (p_wallet_currency='USD' and v_wallet.balance_usd<v_price)
     or (p_wallet_currency='SYP' and v_wallet.balance_syp<v_price) then
    raise exception using errcode='22023',message='رصيد محفظتك غير كافٍ لإتمام هذا الطلب.';
  end if;

  insert into public.leo_manual_orders(
    user_id,product_code,player_id,product_name_snapshot,quantity,customer_note,
    displayed_price_usd_snapshot,displayed_price_syp_snapshot,displayed_price_captured_at,
    displayed_exchange_rate_snapshot,payment_exchange_rate_snapshot,
    supplier_id_snapshot,supplier_cost_usd_snapshot,customer_price_usd,customer_price_syp,
    status,payment_status,payment_method,idempotency_key,coupon_id,coupon_discount_usd,
    coupon_discount_amount,coupon_discount_currency
  ) values (
    p_user_id,p_product_code,v_player,v_product.product_name,p_quantity,v_note,
    v_product.sale_price_usd,v_product.sale_price_syp,v_now,v_rate,
    case when p_wallet_currency='USD' then 1 else v_rate end,
    v_product.supplier_id,v_product.supplier_cost_usd,
    case when p_wallet_currency='USD' then v_price else null end,
    case when p_wallet_currency='SYP' then v_price else null end,
    'paid','verified','wallet_'||pg_catalog.lower(p_wallet_currency),p_idempotency_key,
    v_coupon_id,v_discount_usd,v_discount_amount,case when v_coupon_id is null then null else p_wallet_currency end
  ) returning * into v_order;

  if v_coupon_id is not null then
    update public.loyalty_coupons set status='reserved',redeemed_at=null,
      redeemed_order_id=v_order.id,redeemed_order_type='baro_manual'
    where id=v_coupon_id and user_id=p_user_id and status='active';
    if not found then
      raise exception using errcode='55000',message='تعذر تثبيت استخدام القسيمة؛ تم إلغاء الطلب تلقائياً.';
    end if;
  end if;

  if p_wallet_currency='USD' then
    update public.wallets set balance_usd=balance_usd-v_price where user_id=p_user_id;
  else
    update public.wallets set balance_syp=balance_syp-v_price where user_id=p_user_id;
  end if;
  insert into public.wallet_transactions(user_id,amount,currency,transaction_type,description)
  values(p_user_id,-v_price,p_wallet_currency,'baro_manual_order_hold',
    'حجز قيمة طلب BARO #'||pg_catalog.left(v_order.id::text,8))
  returning id into v_hold_tx;

  insert into public.baro_manual_wallet_holds(
    order_id,user_id,amount,currency,exchange_rate_snapshot,hold_transaction_id
  ) values(v_order.id,p_user_id,v_price,p_wallet_currency,
    case when p_wallet_currency='USD' then 1 else v_rate end,v_hold_tx);

  insert into public.leo_manual_order_events(order_id,actor_id,event_type,details)
  values(v_order.id,p_user_id,'customer_order_wallet_reserved',pg_catalog.jsonb_build_object(
    'amount',v_price,'currency',p_wallet_currency,'player_id_confirmed',true,
    'wallet_transaction_id',v_hold_tx,'reserved_at',v_now,
    'coupon_discount_usd',v_discount_usd,'coupon_discount_amount',v_discount_amount,
    'coupon_discount_currency',case when v_coupon_id is null then null else p_wallet_currency end));

  return pg_catalog.jsonb_build_object('success',true,'replayed',false,'order_id',v_order.id,
    'status',v_order.status,'payment_status',v_order.payment_status,'wallet_changed',true,
    'wallet_settlement','reserved','reserved_amount',v_price,'currency',p_wallet_currency,
    'coupon_discount_usd',v_discount_usd,'coupon_discount_amount',v_discount_amount,
    'coupon_id',v_coupon_id);
end;
$function$;


CREATE OR REPLACE FUNCTION public.get_my_baro_coupon_quote(
  p_product_code text,
  p_wallet_currency text,
  p_coupon_code text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user_id uuid:=auth.uid();
  v_product public.leo_manual_products%rowtype;
  v_coupon public.loyalty_coupons%rowtype;
  v_rate numeric;
  v_profit_usd numeric;
  v_discount_limit numeric;
  v_discount_usd numeric;
  v_discount_amount numeric;
  v_price numeric;
begin
  if v_user_id is null then
    raise exception using errcode='28000',message='سجّل الدخول أولاً للتحقق من القسيمة.';
  end if;
  if p_wallet_currency not in ('USD','SYP') then
    raise exception using errcode='22023',message='عملة المحفظة غير صحيحة.';
  end if;
  if p_product_code is null or p_product_code !~ '^LEO_[A-Z0-9_]{3,56}
REVOKE EXECUTE ON FUNCTION public.redeem_loyalty_coupon() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_loyalty_coupon() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_baro_coupon_quote(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_baro_coupon_quote(text,text,text) TO authenticated;

-- Keep the existing VIP thresholds and update only the displayed benefits.
UPDATE public.loyalty_tiers
SET benefits = CASE tier_code
  WHEN 'bronze' THEN ARRAY['10 نقاط لكل دولار مؤهل','قسيمة 1$ مقابل كل 1,000 نقطة']
  WHEN 'silver' THEN ARRAY['مضاعف نقاط 1.25x','أولوية الاطلاع على العروض الجديدة']
  WHEN 'gold' THEN ARRAY['مضاعف نقاط 1.5x','أولوية في متابعة طلبات الدعم']
  WHEN 'platinum' THEN ARRAY['مضاعف نقاط 2x','دعم VIP وأولوية الوصول للعروض']
  ELSE benefits
END,
updated_at = now()
WHERE tier_code IN ('bronze','silver','gold','platinum');

     or p_coupon_code is null or pg_catalog.length(pg_catalog.btrim(p_coupon_code))>40 then
    raise exception using errcode='22023',message='بيانات القسيمة أو المنتج غير صحيحة.';
  end if;

  select * into v_coupon
  from public.loyalty_coupons
  where user_id=v_user_id
    and upper(code)=upper(pg_catalog.btrim(p_coupon_code))
    and status='active';
  if not found or v_coupon.points_spent<>1000
     or v_coupon.discount_amount_usd not in (0.10,1.00) then
    raise exception using errcode='22023',message='القسيمة غير صالحة أو مستخدمة أو لا تخص حسابك.';
  end if;

  select * into v_product
  from public.leo_manual_products
  where product_code=p_product_code
    and catalog_visible is true
    and purchase_enabled is true
  for share;
  if not found then
    raise exception using errcode='55000',message='هذه الباقة غير متاحة للطلب حالياً.';
  end if;
  if coalesce(v_product.sale_price_usd,0)<=0
     or coalesce(v_product.supplier_cost_usd,0)<=0
     or v_product.supplier_cost_usd>=v_product.sale_price_usd then
    raise exception using errcode='55000',message='لا يمكن التحقق من هامش ربح هذه الباقة للقسيمة.';
  end if;

  v_profit_usd:=round(v_product.sale_price_usd-v_product.supplier_cost_usd,4);
  v_discount_limit:=floor(v_profit_usd*0.90*100)/100;
  if v_coupon.discount_amount_usd=0.10 then
    if v_discount_limit<0.10 then
      raise exception using errcode='55000',message='هذه القسيمة القديمة بقيمة 10 سنت تحتاج باقة تسمح بالخصم الكامل.';
    end if;
    v_discount_usd:=0.10;
  else
    v_discount_usd:=least(v_coupon.discount_amount_usd,v_discount_limit);
  end if;
  if v_discount_usd<0.01 then
    raise exception using errcode='55000',message='هامش ربح هذه الباقة لا يسمح بتطبيق خصم آمن للقسيمة.';
  end if;

  select usd_syp_rate into v_rate
  from public.baro_manual_settings
  where id='main'
  for share;
  v_price:=case when p_wallet_currency='USD' then v_product.sale_price_usd else v_product.sale_price_syp end;
  if p_wallet_currency='SYP' and (coalesce(v_rate,0)<=0 or coalesce(v_price,0)<=0 or v_price<>trunc(v_price)) then
    raise exception using errcode='22023',message='سعر الليرة أو سعر الصرف غير صالح.';
  end if;
  v_discount_amount:=case when p_wallet_currency='USD' then v_discount_usd else round(v_rate*v_discount_usd,0) end;
  if v_discount_amount<=0 or v_discount_amount>=v_price then
    raise exception using errcode='55000',message='قيمة الخصم لا تناسب سعر هذه الباقة.';
  end if;

  return pg_catalog.jsonb_build_object(
    'coupon_code',v_coupon.code,
    'max_discount_usd',v_coupon.discount_amount_usd,
    'discount_usd',v_discount_usd,
    'discount_amount',v_discount_amount,
    'currency',p_wallet_currency,
    'original_price',v_price,
    'final_price',v_price-v_discount_amount
  );
end;
$function$;

-- Restore only authenticated customer access to the secure redemption RPC.
REVOKE EXECUTE ON FUNCTION public.redeem_loyalty_coupon() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_loyalty_coupon() TO authenticated;

-- Keep the existing VIP thresholds and update only the displayed benefits.
UPDATE public.loyalty_tiers
SET benefits = CASE tier_code
  WHEN 'bronze' THEN ARRAY['10 نقاط لكل دولار مؤهل','قسيمة 1$ مقابل كل 1,000 نقطة']
  WHEN 'silver' THEN ARRAY['مضاعف نقاط 1.25x','أولوية الاطلاع على العروض الجديدة']
  WHEN 'gold' THEN ARRAY['مضاعف نقاط 1.5x','أولوية في متابعة طلبات الدعم']
  WHEN 'platinum' THEN ARRAY['مضاعف نقاط 2x','دعم VIP وأولوية الوصول للعروض']
  ELSE benefits
END,
updated_at = now()
WHERE tier_code IN ('bronze','silver','gold','platinum');
