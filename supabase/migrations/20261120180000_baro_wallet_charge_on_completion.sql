-- BARO manual wallet checkout: charge only after the manual top-up is completed.
-- Existing rows are explicitly legacy_reserved and are never re-settled by this path.
alter table public.leo_manual_orders
  add column if not exists wallet_charge_mode text not null default 'legacy_reserved',
  add column if not exists wallet_charged_at timestamptz;

alter table public.leo_manual_orders
  add constraint leo_manual_orders_wallet_charge_mode_check
  check (wallet_charge_mode in ('legacy_reserved','wallet_on_completion'));

create unique index if not exists wallet_transactions_baro_manual_order_charge_uidx
  on public.wallet_transactions(order_id)
  where order_id is not null and transaction_type='baro_manual_wallet_charge';

create or replace function public.baro_manual_create_customer_order_on_completion(
  p_user_id uuid, p_product_code text, p_player_id text, p_quantity integer,
  p_customer_note text, p_idempotency_key uuid, p_player_id_confirmed boolean,
  p_wallet_currency text
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
  v_existing public.leo_manual_orders%rowtype;
  v_product public.leo_manual_products%rowtype;
  v_order public.leo_manual_orders%rowtype;
  v_enabled boolean;
  v_rate numeric;
  v_price numeric;
  v_player text:=pg_catalog.btrim(coalesce(p_player_id,''));
  v_note text:=pg_catalog.btrim(coalesce(p_customer_note,''));
  v_now timestamptz:=pg_catalog.now();
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
    if v_existing.wallet_charge_mode is distinct from 'wallet_on_completion' then
      raise exception using errcode='55000',message='رقم محاولة الطلب مرتبط بطلب قديم. لا تعِد إرساله؛ راجع سجل طلبات BARO أولاً.';
    end if;
    if v_existing.product_code is distinct from p_product_code
       or v_existing.player_id is distinct from v_player
       or v_existing.quantity is distinct from p_quantity
       or v_existing.customer_note is distinct from v_note
       or v_existing.payment_method is distinct from ('wallet_'||pg_catalog.lower(p_wallet_currency)) then
      raise exception using errcode='22023',message='رقم محاولة الطلب مستخدم مع بيانات مختلفة.';
    end if;
    return pg_catalog.jsonb_build_object('success',true,'replayed',true,'order_id',v_existing.id,
      'status',v_existing.status,'payment_status',v_existing.payment_status,
      'wallet_changed',false,'wallet_settlement','charge_on_completion',
      'wallet_charge_mode',v_existing.wallet_charge_mode);
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_user_id::text||':'||p_product_code||':'||pg_catalog.lower(v_player),0));
  if exists (
    select 1 from public.leo_manual_orders o
    where o.user_id=p_user_id and o.product_code=p_product_code
      and pg_catalog.lower(pg_catalog.btrim(o.player_id))=pg_catalog.lower(v_player)
      and o.status not in ('completed','failed','cancelled')
      and exists(select 1 from public.leo_manual_products p
        where p.product_code=p_product_code and p.category_id='freefire')
  ) then
    raise exception using errcode='23505',
      message='لديك طلب مفتوح لنفس باقة Free Fire ومعرّف اللاعب.';
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
  insert into public.leo_manual_orders(
    user_id,product_code,player_id,product_name_snapshot,quantity,customer_note,
    displayed_price_usd_snapshot,displayed_price_syp_snapshot,displayed_price_captured_at,
    displayed_exchange_rate_snapshot,payment_exchange_rate_snapshot,
    supplier_id_snapshot,supplier_cost_usd_snapshot,customer_price_usd,customer_price_syp,
    status,payment_status,payment_method,idempotency_key,wallet_charge_mode
  ) values (
    p_user_id,p_product_code,v_player,v_product.product_name,p_quantity,v_note,
    v_product.sale_price_usd,v_product.sale_price_syp,v_now,v_rate,
    case when p_wallet_currency='USD' then 1 else v_rate end,
    v_product.supplier_id,v_product.supplier_cost_usd,
    case when p_wallet_currency='USD' then v_price else null end,
    case when p_wallet_currency='SYP' then v_price else null end,
    'pending','awaiting_quote','wallet_'||pg_catalog.lower(p_wallet_currency),
    p_idempotency_key,'wallet_on_completion'
  ) returning * into v_order;
  insert into public.leo_manual_order_events(order_id,actor_id,event_type,details)
  values(v_order.id,p_user_id,'customer_order_wallet_charge_deferred',pg_catalog.jsonb_build_object(
    'amount',v_price,'currency',p_wallet_currency,'player_id_confirmed',true,
    'wallet_changed',false,'charge_on_completion',true,'created_at',v_now));
  return pg_catalog.jsonb_build_object('success',true,'replayed',false,'order_id',v_order.id,
    'status',v_order.status,'payment_status',v_order.payment_status,'wallet_changed',false,
    'wallet_settlement','charge_on_completion','wallet_charge_mode','wallet_on_completion',
    'amount_due_on_completion',v_price,'currency',p_wallet_currency);
end;
$function$;

create or replace function public.baro_manual_order_admin_update_wallet_aware(
  p_admin_id uuid,p_order_id uuid,p_status text,p_quote_amount numeric,p_quote_currency text,
  p_payment_method text,p_payment_status text,p_customer_message text,p_supplier_cost_usd numeric,
  p_supplier_reference text,p_exception_reason text,p_internal_notes text
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
  v_order public.leo_manual_orders%rowtype;
  v_wallet public.wallets%rowtype;
  v_currency text;
  v_amount numeric;
  v_rate numeric;
  v_usd numeric;
  v_cost_posted boolean;
  v_sale_posted boolean;
  v_count integer;
  v_now timestamptz:=pg_catalog.now();
  v_from_status text;
  v_target_status text:=case when p_status='paid' then 'in_progress' else p_status end;
begin
  if p_admin_id is null or not public.baro_manual_has_permission(p_admin_id,'orders') then
    raise exception using errcode='42501',message='BARO order permission required';
  end if;
  select * into v_order from public.leo_manual_orders where id=p_order_id for update;
  if not found then raise exception using errcode='P0002',message='order not found'; end if;
  v_from_status:=v_order.status;

  -- Preserve the complete, existing legacy workflow byte-for-byte via its original RPC.
  if v_order.wallet_charge_mode is distinct from 'wallet_on_completion' then
    return public.baro_manual_order_admin_update_atomic(
      p_admin_id,p_order_id,p_status,p_quote_amount,p_quote_currency,p_payment_method,
      p_payment_status,p_customer_message,p_supplier_cost_usd,p_supplier_reference,
      p_exception_reason,p_internal_notes);
  end if;

  if v_target_status not in ('pending','in_progress','completed','failed','needs_review','cancelled')
     or p_payment_status not in ('awaiting_quote','verified')
     or (p_quote_amount is not null and p_quote_amount is distinct from coalesce(v_order.customer_price_usd,v_order.customer_price_syp))
     or (p_quote_currency is not null and p_quote_currency is distinct from case when v_order.customer_price_usd is not null then 'USD' else 'SYP' end)
     or pg_catalog.length(coalesce(p_customer_message,''))>500
     or pg_catalog.length(coalesce(p_internal_notes,''))>2000
     or pg_catalog.length(coalesce(p_supplier_reference,''))>160
     or pg_catalog.length(coalesce(p_exception_reason,''))>500
     or (p_supplier_cost_usd is not null and (p_supplier_cost_usd<0 or p_supplier_cost_usd>1000000)) then
    raise exception using errcode='22023',message='بيانات تحديث طلب BARO المؤجل الخصم غير صحيحة.';
  end if;

  if v_order.status='completed' then
    if v_target_status='completed' and v_order.wallet_charged_at is not null then
      return pg_catalog.jsonb_build_object('order',to_jsonb(v_order),'wallet_changed',false,
        'wallet_charge_replayed',true,'finance_posted',true);
    end if;
    raise exception using errcode='55000',message='الطلب المكتمل لا يمكن تغيير حالته.';
  end if;
  if (v_order.status='pending' and v_target_status not in ('pending','in_progress','failed','needs_review','cancelled'))
     or (v_order.status='in_progress' and v_target_status not in ('in_progress','completed','failed','needs_review'))
     or (v_order.status='needs_review' and v_target_status not in ('needs_review','in_progress','failed','cancelled'))
     or (v_order.status in ('failed','cancelled') and v_target_status<>v_order.status) then
    raise exception using errcode='55000',message='انتقال حالة طلب BARO غير مسموح.';
  end if;
  if v_target_status='completed' and (
    coalesce(p_supplier_cost_usd,0)<=0 or
    (pg_catalog.length(pg_catalog.btrim(coalesce(p_supplier_reference,'')))<2
      and pg_catalog.length(pg_catalog.btrim(coalesce(p_exception_reason,'')))<5)
  ) then
    raise exception using errcode='22023',message='إكمال الطلب يتطلب التكلفة ومرجع التنفيذ أو سبب استثناء موثق.';
  end if;

  if v_target_status='completed' and v_order.wallet_charged_at is null then
    v_currency:=case when v_order.payment_method='wallet_usd' then 'USD'
      when v_order.payment_method='wallet_syp' then 'SYP' else null end;
    v_amount:=case when v_currency='USD' then v_order.customer_price_usd
      when v_currency='SYP' then v_order.customer_price_syp else null end;
    if v_currency is null or coalesce(v_amount,0)<=0 then
      raise exception using errcode='55000',message='تعذر تحديد قيمة خصم محفظة طلب BARO.';
    end if;
    insert into public.wallets(user_id,balance_usd,balance_syp)
      values(v_order.user_id,0,0) on conflict(user_id) do nothing;
    select * into v_wallet from public.wallets where user_id=v_order.user_id for update;
    if (v_currency='USD' and v_wallet.balance_usd<v_amount)
       or (v_currency='SYP' and v_wallet.balance_syp<v_amount) then
      raise exception using errcode='22023',message='رصيد العميل غير كافٍ لإكمال الشحن. لم يتم إكمال الطلب ولم يُخصم أي مبلغ.';
    end if;
    if v_currency='USD' then
      update public.wallets set balance_usd=balance_usd-v_amount where user_id=v_order.user_id;
      v_rate:=1; v_usd:=v_amount;
    else
      v_rate:=v_order.payment_exchange_rate_snapshot;
      if coalesce(v_rate,0)<=0 then
        raise exception using errcode='55000',message='سعر الصرف المحفوظ للطلب غير صالح؛ أوقفنا الإكمال لحماية الحسابات.';
      end if;
      update public.wallets set balance_syp=balance_syp-v_amount where user_id=v_order.user_id;
      v_usd:=v_amount/v_rate;
    end if;
    insert into public.wallet_transactions(user_id,amount,currency,transaction_type,description,order_id)
    values(v_order.user_id,-v_amount,v_currency,'baro_manual_wallet_charge',
      'خصم قيمة طلب BARO اليدوي #'||pg_catalog.left(v_order.id::text,8),v_order.id);
    insert into public.baro_manual_finance_entries(
      order_id,entry_type,title,amount,currency,exchange_rate,amount_usd_equivalent,
      status,description,idempotency_key,created_by
    ) values(v_order.id,'sale_received','تحصيل طلب BARO من المحفظة',v_amount,v_currency,
      v_rate,v_usd,'posted','خصم محفظة العميل عند اكتمال الشحن اليدوي',
      'baro-wallet-sale-'||v_order.id::text,p_admin_id);
  end if;

  perform pg_catalog.set_config('app.baro_actor_id',p_admin_id::text,true);
  update public.leo_manual_orders set
    status=v_target_status,payment_status='awaiting_quote',
    customer_message=coalesce(p_customer_message,''),
    supplier_cost_usd=p_supplier_cost_usd,
    supplier_reference=nullif(pg_catalog.btrim(coalesce(p_supplier_reference,'')),''),
    exception_reason=nullif(pg_catalog.btrim(coalesce(p_exception_reason,'')),''),
    internal_notes=coalesce(p_internal_notes,''),updated_at=v_now,
    completed_at=case when v_target_status='completed' then coalesce(v_order.completed_at,v_now) else v_order.completed_at end,
    wallet_charged_at=case when v_target_status='completed' then coalesce(v_order.wallet_charged_at,v_now) else v_order.wallet_charged_at end
  where id=p_order_id returning * into v_order;

  select exists(select 1 from public.baro_manual_finance_entries
    where order_id=p_order_id and entry_type='sale_received' and status='posted') into v_sale_posted;
  select exists(select 1 from public.baro_manual_finance_entries
    where order_id=p_order_id and entry_type='supplier_cost' and status='posted') into v_cost_posted;
  if v_target_status='completed' and (not v_sale_posted or not v_cost_posted or v_order.wallet_charged_at is null) then
    raise exception using errcode='55000',message='تعذر تثبيت خصم المحفظة وقيود BARO معاً؛ تم التراجع عن العملية.';
  end if;
  select count(*)::integer into v_count from public.baro_manual_finance_entries
    where order_id=p_order_id and status='posted';
  insert into public.leo_manual_order_events(order_id,actor_id,event_type,details)
  values(p_order_id,p_admin_id,'admin_wallet_order_review',pg_catalog.jsonb_build_object(
    'from',v_from_status,'to',v_target_status,'wallet_charge_mode','wallet_on_completion',
    'wallet_charged',v_target_status='completed','sale_entry_posted',v_sale_posted,
    'supplier_cost_entry_posted',v_cost_posted,'finance_entry_count',v_count));
  insert into public.admin_audit_log(admin_id,action,entity_type,entity_id,details)
  values(p_admin_id,'baro_manual_wallet_order_review','leo_manual_order',p_order_id::text,
    pg_catalog.jsonb_build_object('from',v_from_status,'to',v_target_status,'wallet_charged',v_target_status='completed',
      'sale_entry_posted',v_sale_posted,'supplier_cost_entry_posted',v_cost_posted));
  return pg_catalog.jsonb_build_object('order',to_jsonb(v_order),
    'wallet_changed',v_target_status='completed','wallet_charge_replayed',false,
    'finance_posted',v_target_status='completed','finance_entries_count',v_count,
    'sale_entry_posted',v_sale_posted,'supplier_cost_entry_posted',v_cost_posted);
end;
$function$;

revoke execute on function public.baro_manual_create_customer_order_on_completion(uuid,text,text,integer,text,uuid,boolean,text) from public,anon,authenticated;
revoke execute on function public.baro_manual_order_admin_update_wallet_aware(uuid,uuid,text,numeric,text,text,text,text,numeric,text,text,text) from public,anon,authenticated;
grant execute on function public.baro_manual_create_customer_order_on_completion(uuid,text,text,integer,text,uuid,boolean,text) to service_role;
grant execute on function public.baro_manual_order_admin_update_wallet_aware(uuid,uuid,text,numeric,text,text,text,text,numeric,text,text,text) to service_role;
