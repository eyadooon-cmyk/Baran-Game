-- BARO customer-order idempotency and per-user concurrency control.
-- Branch-only migration. Do not apply to production before staging review.

alter table public.leo_manual_orders
  add column if not exists idempotency_key uuid;

create unique index if not exists leo_manual_orders_user_idempotency_uidx
  on public.leo_manual_orders(user_id,idempotency_key)
  where idempotency_key is not null;

-- Replace the previous five-argument RPC with a self-contained idempotent
-- version. This works whether the previous RPC was deployed as a wrapper or
-- as the original gated function in an isolated staging database.
drop function if exists public.baro_manual_create_customer_order(uuid,text,text,integer,text);

create function public.baro_manual_create_customer_order(
  p_user_id uuid,
  p_product_code text,
  p_player_id text,
  p_quantity integer,
  p_customer_note text,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_existing public.leo_manual_orders%rowtype;
  v_product public.leo_manual_products%rowtype;
  v_order public.leo_manual_orders%rowtype;
  v_player text := pg_catalog.btrim(coalesce(p_player_id,''));
  v_note text := pg_catalog.btrim(coalesce(p_customer_note,''));
  v_enabled boolean := false;
begin
  if p_user_id is null or p_idempotency_key is null
     or p_product_code is null or p_product_code !~ '^LEO_[A-Z0-9_]{3,56}$'
     or pg_catalog.length(v_player)<3 or pg_catalog.length(v_player)>80
     or v_player ~ '[[:cntrl:]]'
     or pg_catalog.length(v_note)>500
     or p_quantity is null or p_quantity<1 or p_quantity>1000000 then
    raise exception using errcode='22023',message='بيانات طلب BARO غير صحيحة.';
  end if;

  -- Serialize all submissions from this customer so the rate limit cannot
  -- be bypassed by sending several requests concurrently.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text,0)
  );

  -- Return the original order on a retry, including if the first response was
  -- lost or the administrator switched BARO OFF after it was created.
  select * into v_existing
  from public.leo_manual_orders
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

  select enabled into v_enabled
  from public.baro_manual_settings
  where id='main'
  for share;
  if coalesce(v_enabled,false) is not true then
    raise exception using errcode='55000',message='استقبال طلبات BARO متوقف حالياً من الإدارة.';
  end if;

  select * into v_product
  from public.leo_manual_products
  where product_code=p_product_code
  for share;
  if not found or v_product.catalog_visible is not true or v_product.purchase_enabled is not true then
    raise exception using errcode='55000',message='هذا المنتج غير متاح للطلب اليدوي حالياً.';
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
    status,payment_status,idempotency_key
  )
  values(
    p_user_id,p_product_code,v_player,v_product.product_name,p_quantity,v_note,
    'pending','awaiting_quote',p_idempotency_key
  )
  returning * into v_order;

  insert into public.leo_manual_order_events(order_id,actor_id,event_type,details)
  values(
    v_order.id,p_user_id,'customer_order_created',
    pg_catalog.jsonb_build_object('product_code',p_product_code,'quantity',p_quantity)
  );

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
