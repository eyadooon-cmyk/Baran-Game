-- BARO: prevent duplicate active Free Fire player/package orders.
-- No existing orders, wallet balances, or financial entries are modified by this migration.
create or replace function public.baro_manual_create_customer_order(
  p_user_id uuid,p_product_code text,p_player_id text,p_quantity integer,
  p_customer_note text,p_idempotency_key uuid,p_player_id_confirmed boolean,
  p_wallet_currency text
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
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
    return pg_catalog.jsonb_build_object('success',true,'replayed',true,'order_id',v_existing.id,
      'status',v_existing.status,'payment_status',v_existing.payment_status,'wallet_changed',true,
      'wallet_settlement',(select h.status from public.baro_manual_wallet_holds h where h.order_id=v_existing.id));
  end if;

  -- Serialize identical player/package submissions before checking active orders.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_user_id::text || ':' || p_product_code || ':' || pg_catalog.lower(pg_catalog.btrim(v_player)), 0
  ));

  -- Prevent a second active order for the same customer, Free Fire package and player ID.
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
  if p_wallet_currency='USD' and v_price<>round(v_price,2) then
    raise exception using errcode='22023',message='سعر الدولار يجب ألا يتجاوز منزلتين عشريتين.';
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
    status,payment_status,payment_method,idempotency_key
  ) values (
    p_user_id,p_product_code,v_player,v_product.product_name,p_quantity,v_note,
    v_product.sale_price_usd,v_product.sale_price_syp,v_now,v_rate,
    case when p_wallet_currency='USD' then 1 else v_rate end,
    v_product.supplier_id,v_product.supplier_cost_usd,
    case when p_wallet_currency='USD' then v_price else null end,
    case when p_wallet_currency='SYP' then v_price else null end,
    'paid','verified','wallet_'||pg_catalog.lower(p_wallet_currency),p_idempotency_key
  ) returning * into v_order;

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
    'wallet_transaction_id',v_hold_tx,'reserved_at',v_now));

  return pg_catalog.jsonb_build_object('success',true,'replayed',false,'order_id',v_order.id,
    'status',v_order.status,'payment_status',v_order.payment_status,'wallet_changed',true,
    'wallet_settlement','reserved','reserved_amount',v_price,'currency',p_wallet_currency);
end;
$function$;

create index if not exists leo_manual_orders_active_player_package_idx
  on public.leo_manual_orders (
    user_id,
    product_code,
    (pg_catalog.lower(pg_catalog.btrim(player_id)))
  )
  where status not in ('completed','failed','cancelled');

revoke all on function public.baro_manual_create_customer_order(uuid,text,text,integer,text,uuid,boolean,text)
  from public,anon,authenticated;
grant execute on function public.baro_manual_create_customer_order(uuid,text,text,integer,text,uuid,boolean,text)
  to service_role;
