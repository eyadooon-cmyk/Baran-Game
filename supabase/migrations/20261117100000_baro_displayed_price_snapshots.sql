-- Preserve the exact catalog price shown to the customer when a BARO order is created.
-- Final admin quote remains in customer_price_usd/customer_price_syp and is intentionally separate.
alter table public.leo_manual_orders
  add column if not exists displayed_price_usd_snapshot numeric,
  add column if not exists displayed_price_syp_snapshot numeric,
  add column if not exists displayed_price_captured_at timestamptz;

create or replace function public.baro_manual_create_customer_order(
  p_user_id uuid,p_product_code text,p_player_id text,p_quantity integer,
  p_customer_note text,p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path = ''
as $function$
declare
  v_existing public.leo_manual_orders%rowtype;
  v_product public.leo_manual_products%rowtype;
  v_order public.leo_manual_orders%rowtype;
  v_player text := pg_catalog.btrim(coalesce(p_player_id,''));
  v_note text := pg_catalog.btrim(coalesce(p_customer_note,''));
  v_enabled boolean := false;
  v_captured_at timestamptz := pg_catalog.now();
begin
  if p_user_id is null or p_idempotency_key is null
     or p_product_code is null or p_product_code !~ '^LEO_[A-Z0-9_]{3,56}$'
     or pg_catalog.length(v_player)<3 or pg_catalog.length(v_player)>80
     or v_player ~ '[[:cntrl:]]' or pg_catalog.length(v_note)>500
     or p_quantity is null or p_quantity<1 or p_quantity>1000000 then
    raise exception using errcode='22023',message='بيانات طلب BARO غير صحيحة.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,0));
  select * into v_existing from public.leo_manual_orders
  where user_id=p_user_id and idempotency_key=p_idempotency_key;
  if found then
    if v_existing.product_code is distinct from p_product_code
       or v_existing.player_id is distinct from v_player
       or v_existing.quantity is distinct from p_quantity
       or v_existing.customer_note is distinct from v_note then
      raise exception using errcode='22023',message='رقم محاولة الطلب مستخدم مع بيانات مختلفة. حدّث الصفحة وحاول من جديد.';
    end if;
    return pg_catalog.jsonb_build_object(
      'success',true,'replayed',true,'order_id',v_existing.id,
      'status',v_existing.status,'payment_status',v_existing.payment_status,
      'wallet_changed',false,'finance_posted',false
    );
  end if;
  select enabled into v_enabled from public.baro_manual_settings where id='main' for share;
  if coalesce(v_enabled,false) is not true then
    raise exception using errcode='55000',message='استقبال طلبات BARO متوقف حالياً من الإدارة.';
  end if;
  select * into v_product from public.leo_manual_products where product_code=p_product_code for share;
  if not found or v_product.catalog_visible is not true or v_product.purchase_enabled is not true then
    raise exception using errcode='55000',message='هذا المنتج غير متاح للطلب اليدوي حالياً.';
  end if;
  if coalesce(v_product.sale_price_usd,0)<=0 and coalesce(v_product.sale_price_syp,0)<=0 then
    raise exception using errcode='55000',message='سعر المنتج غير محدد حالياً؛ لا يمكن بدء الطلب.';
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
  insert into public.leo_manual_orders(
    user_id,product_code,player_id,product_name_snapshot,quantity,customer_note,
    displayed_price_usd_snapshot,displayed_price_syp_snapshot,displayed_price_captured_at,
    status,payment_status,idempotency_key
  ) values (
    p_user_id,p_product_code,v_player,v_product.product_name,p_quantity,v_note,
    v_product.sale_price_usd,v_product.sale_price_syp,v_captured_at,
    'pending','awaiting_quote',p_idempotency_key
  ) returning * into v_order;
  insert into public.leo_manual_order_events(order_id,actor_id,event_type,details)
  values(v_order.id,p_user_id,'customer_order_created',
    pg_catalog.jsonb_build_object(
      'product_code',p_product_code,'quantity',p_quantity,
      'displayed_price_usd',v_order.displayed_price_usd_snapshot,
      'displayed_price_syp',v_order.displayed_price_syp_snapshot,
      'displayed_price_captured_at',v_order.displayed_price_captured_at
    ));
  return pg_catalog.jsonb_build_object(
    'success',true,'replayed',false,'order_id',v_order.id,
    'status',v_order.status,'payment_status',v_order.payment_status,
    'wallet_changed',false,'finance_posted',false
  );
end;
$function$;
revoke all on function public.baro_manual_create_customer_order(uuid,text,text,integer,text,uuid)
  from public,anon,authenticated;
grant execute on function public.baro_manual_create_customer_order(uuid,text,text,integer,text,uuid)
  to service_role;
