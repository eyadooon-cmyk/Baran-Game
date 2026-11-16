-- BARO customer-order idempotency and per-user concurrency control.
-- Branch-only migration. Do not apply to production before staging review.

alter table public.leo_manual_orders
  add column if not exists idempotency_key uuid;

create unique index if not exists leo_manual_orders_user_idempotency_uidx
  on public.leo_manual_orders(user_id,idempotency_key)
  where idempotency_key is not null;

-- Replace the five-argument global-gate wrapper with a six-argument
-- idempotent wrapper. The underlying order-creation routine remains private
-- to service_role and continues to validate product, quantity and rate limits.
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
  v_created_id uuid;
  v_result jsonb;
  v_enabled boolean := false;
begin
  if p_user_id is null or p_idempotency_key is null then
    raise exception using errcode='22023',message='رقم محاولة الطلب غير صالح.';
  end if;

  -- Serialize order submissions for one customer. This makes the existing
  -- five-orders-per-ten-minutes check safe against concurrent requests.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text,0)
  );

  -- A retry must return the original order, even if BARO was switched OFF
  -- after the first request reached the database.
  select * into v_existing
  from public.leo_manual_orders
  where user_id=p_user_id and idempotency_key=p_idempotency_key;

  if found then
    if v_existing.product_code is distinct from p_product_code
       or v_existing.player_id is distinct from pg_catalog.btrim(coalesce(p_player_id,''))
       or v_existing.quantity is distinct from p_quantity
       or v_existing.customer_note is distinct from pg_catalog.btrim(coalesce(p_customer_note,'')) then
      raise exception using errcode='22023',message='رقم محاولة الطلب مستخدم مع بيانات مختلفة. حدّث الصفحة وحاول من جديد.';
    end if;
    return pg_catalog.jsonb_build_object(
      'success',true,
      'replayed',true,
      'order_id',v_existing.id,
      'status',v_existing.status,
      'payment_status',v_existing.payment_status,
      'wallet_changed',false,
      'finance_posted',false
    );
  end if;

  select enabled into v_enabled
  from public.baro_manual_settings
  where id='main'
  for share;

  if coalesce(v_enabled,false) is not true then
    raise exception using errcode='55000',message='استقبال طلبات BARO متوقف حالياً من الإدارة.';
  end if;

  v_result := public.baro_manual_create_customer_order_without_global_gate(
    p_user_id,p_product_code,p_player_id,p_quantity,p_customer_note
  );
  v_created_id := nullif(v_result->>'order_id','')::uuid;
  if v_created_id is null then
    raise exception using errcode='P0001',message='تعذر تأكيد تسجيل طلب BARO.';
  end if;

  update public.leo_manual_orders
  set idempotency_key=p_idempotency_key
  where id=v_created_id and user_id=p_user_id and idempotency_key is null;

  if not found then
    raise exception using errcode='23505',message='تعذر حفظ رقم محاولة الطلب بشكل آمن.';
  end if;

  return v_result || pg_catalog.jsonb_build_object('replayed',false);
end;
$function$;

revoke all on function public.baro_manual_create_customer_order(uuid,text,text,integer,text,uuid)
  from public,anon,authenticated;
grant execute on function public.baro_manual_create_customer_order(uuid,text,text,integer,text,uuid)
  to service_role;

-- Keep the obsolete five-argument implementation inaccessible to clients.
revoke all on function public.baro_manual_create_customer_order_without_global_gate(uuid,text,text,integer,text)
  from public,anon,authenticated;
grant execute on function public.baro_manual_create_customer_order_without_global_gate(uuid,text,text,integer,text)
  to service_role;
