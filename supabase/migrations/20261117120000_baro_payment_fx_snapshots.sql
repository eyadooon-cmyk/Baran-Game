-- Keep the exchange rate used for actual SYP payment conversion separate from the display-time rate.

alter table public.leo_manual_orders
  add column if not exists payment_exchange_rate_snapshot numeric(20,6);
alter table public.baro_manual_supplier_products
  add column if not exists exchange_rate_snapshot numeric(20,6);

create or replace function public.baro_manual_capture_payment_fx()
returns trigger
language plpgsql security definer set search_path=''
as $function$
declare v_rate numeric;
begin
  if new.payment_status='verified' and old.payment_status is distinct from new.payment_status then
    if coalesce(new.customer_price_syp,0)>0 then
      select usd_syp_rate into v_rate from public.baro_manual_settings where id='main';
      if coalesce(v_rate,0)<=0 then
        raise exception using errcode='22023',message='لا يمكن تأكيد دفع بالليرة قبل تحديد سعر الصرف في إعدادات BARO.';
      end if;
      new.payment_exchange_rate_snapshot:=v_rate;
    elsif coalesce(new.customer_price_usd,0)>0 then
      new.payment_exchange_rate_snapshot:=1;
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function public.baro_manual_capture_payment_fx() from public,anon,authenticated;
drop trigger if exists baro_manual_capture_payment_fx_trigger on public.leo_manual_orders;
create trigger baro_manual_capture_payment_fx_trigger
before update of payment_status on public.leo_manual_orders
for each row execute function public.baro_manual_capture_payment_fx();

create or replace function public.baro_manual_post_finance_and_notify()
returns trigger
language plpgsql security definer set search_path=''
as $function$
declare
  v_amount numeric;
  v_currency text;
  v_rate numeric;
  v_usd numeric;
  v_status_label text;
  v_actor uuid:=nullif(current_setting('app.baro_actor_id',true),'')::uuid;
begin
  if new.payment_status='verified' and (tg_op='INSERT' or old.payment_status is distinct from new.payment_status) then
    if coalesce(new.customer_price_usd,0)>0 then
      v_amount:=new.customer_price_usd;v_currency:='USD';v_rate:=1;v_usd:=v_amount;
    elsif coalesce(new.customer_price_syp,0)>0 then
      v_amount:=new.customer_price_syp;v_currency:='SYP';v_rate:=new.payment_exchange_rate_snapshot;
      v_usd:=case when coalesce(v_rate,0)>0 then v_amount/v_rate else null end;
    else
      v_amount:=null;
    end if;
    if v_amount is not null then
      insert into public.baro_manual_finance_entries(
        order_id,entry_type,title,amount,currency,exchange_rate,amount_usd_equivalent,status,description,idempotency_key,created_by
      ) values (
        new.id,'sale_received','تحصيل طلب BARO',v_amount,v_currency,v_rate,v_usd,'posted',
        'تسجيل تلقائي بعد تأكيد استلام الدفع يدوياً','baro-sale-'||new.id::text,v_actor
      ) on conflict do nothing;
    end if;
  end if;

  if new.status='completed' and coalesce(new.supplier_cost_usd,0)>0
     and (tg_op='INSERT' or old.status is distinct from new.status or old.supplier_cost_usd is distinct from new.supplier_cost_usd) then
    insert into public.baro_manual_finance_entries(
      order_id,entry_type,title,amount,currency,exchange_rate,amount_usd_equivalent,status,description,idempotency_key,created_by
    ) values (
      new.id,'supplier_cost','تكلفة مورد طلب BARO',new.supplier_cost_usd,'USD',1,new.supplier_cost_usd,'posted',
      'تسجيل تكلفة التنفيذ عند إكمال الطلب','baro-cost-'||new.id::text,v_actor
    ) on conflict do nothing;
  end if;

  if tg_op='INSERT' then
    insert into public.baran_notifications(recipient_id,audience,kind,title,body,entity_type,entity_id)
    select au.user_id,'admin','order_new','طلب BARO جديد',
      'وصل طلب شحن يدوي جديد يحتاج مراجعة الإدارة.','leo_manual_order',new.id
    from public.admin_users au;
  elsif old.status is distinct from new.status then
    v_status_label:=case new.status
      when 'pending' then 'طلب جديد'
      when 'awaiting_payment' then 'بانتظار الدفع'
      when 'paid' then 'تم تأكيد الدفع'
      when 'in_progress' then 'قيد التنفيذ'
      when 'completed' then 'مكتمل'
      when 'failed' then 'تعذر التنفيذ'
      when 'needs_review' then 'يحتاج مراجعة'
      when 'cancelled' then 'ملغي'
      else new.status end;
    insert into public.baran_notifications(recipient_id,audience,kind,title,body,entity_type,entity_id)
    values(new.user_id,'customer','order_status','تحديث طلب BARO','تم تحديث حالة طلبك: '||v_status_label,'leo_manual_order',new.id);
  end if;
  return new;
end;
$function$;
revoke all on function public.baro_manual_post_finance_and_notify() from public,anon,authenticated;

create or replace function public.baro_manual_supplier_product_save_atomic(
  p_admin_id uuid,p_supplier_id uuid,p_product_code text,p_supplier_sku text,
  p_unit_cost numeric,p_currency text,p_lead_time_hours integer,p_is_preferred boolean,
  p_is_active boolean,p_notes text
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
  v_rate numeric;
  v_cost_usd numeric;
  v_rate_snapshot numeric;
  v_row public.baro_manual_supplier_products%rowtype;
begin
  if p_admin_id is null or not public.baro_manual_has_permission(p_admin_id,'suppliers') then
    raise exception using errcode='42501',message='BARO supplier permission required';
  end if;
  if p_supplier_id is null or p_product_code is null
     or p_unit_cost is null or p_unit_cost<0 or p_unit_cost>1000000000
     or p_currency not in ('USD','SYP')
     or (p_lead_time_hours is not null and p_lead_time_hours<0)
     or char_length(coalesce(p_supplier_sku,''))>160
     or char_length(coalesce(p_notes,''))>1000 then
    raise exception using errcode='22023',message='بيانات ربط المورد بالمنتج غير صحيحة.';
  end if;
  select usd_syp_rate into v_rate from public.baro_manual_settings where id='main';
  if p_currency='SYP' then
    if coalesce(v_rate,0)<=0 then
      raise exception using errcode='22023',message='أدخل سعر صرف الدولار مقابل الليرة في إعدادات BARO أولاً.';
    end if;
    v_cost_usd:=p_unit_cost/v_rate;
    v_rate_snapshot:=v_rate;
  else
    v_cost_usd:=p_unit_cost;
    v_rate_snapshot:=1;
  end if;
  perform set_config('app.baro_actor_id',p_admin_id::text,true);
  insert into public.baro_manual_supplier_products(
    supplier_id,product_code,supplier_sku,unit_cost,currency,exchange_rate_snapshot,
    lead_time_hours,is_preferred,is_active,notes,updated_at
  ) values(
    p_supplier_id,p_product_code,nullif(btrim(coalesce(p_supplier_sku,'')),''),p_unit_cost,p_currency,v_rate_snapshot,
    p_lead_time_hours,coalesce(p_is_preferred,false),coalesce(p_is_active,true),coalesce(p_notes,''),now()
  )
  on conflict(supplier_id,product_code) do update set
    supplier_sku=excluded.supplier_sku,unit_cost=excluded.unit_cost,currency=excluded.currency,
    exchange_rate_snapshot=excluded.exchange_rate_snapshot,lead_time_hours=excluded.lead_time_hours,
    is_preferred=excluded.is_preferred,is_active=excluded.is_active,notes=excluded.notes,updated_at=now()
  returning * into v_row;
  update public.leo_manual_products
  set supplier_id=p_supplier_id,supplier_sku=nullif(btrim(coalesce(p_supplier_sku,'')),''),
      supplier_cost_currency=p_currency,supplier_cost_usd=v_cost_usd,updated_at=now()
  where product_code=p_product_code;
  if not found then raise exception using errcode='P0002',message='BARO product not found'; end if;
  insert into public.admin_audit_log(admin_id,action,entity_type,entity_id,details)
  values(p_admin_id,'baro_supplier_product_updated','baro_manual_supplier_product',v_row.id::text,
    jsonb_build_object('supplier_id',p_supplier_id,'product_code',p_product_code,'cost',p_unit_cost,
      'currency',p_currency,'exchange_rate_snapshot',v_rate_snapshot));
  return jsonb_build_object('supplier_product',to_jsonb(v_row),'supplier_cost_usd',v_cost_usd);
end;
$function$;
revoke all on function public.baro_manual_supplier_product_save_atomic(uuid,uuid,text,text,numeric,text,integer,boolean,boolean,text) from public,anon,authenticated;
grant execute on function public.baro_manual_supplier_product_save_atomic(uuid,uuid,text,text,numeric,text,integer,boolean,boolean,text) to service_role;
