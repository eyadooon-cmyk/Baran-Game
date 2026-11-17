-- BARO follow-up hardening: reporting indexes, idempotent finance entries and admin alerts.

create index if not exists baro_finance_reversal_of_idx
  on public.baro_manual_finance_entries(reversal_of);
create index if not exists baro_supplier_events_order_idx
  on public.baro_manual_supplier_events(order_id);
create index if not exists leo_manual_products_supplier_id_idx
  on public.leo_manual_products(supplier_id);

create or replace function public.baro_manual_finance_entry_atomic(
  p_admin_id uuid,p_order_id uuid,p_entry_type text,p_title text,p_amount numeric,
  p_currency text,p_exchange_rate numeric,p_description text,p_external_reference text,p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare v_entry public.baro_manual_finance_entries%rowtype; v_usd numeric;
begin
  if p_admin_id is null or not public.baro_manual_has_permission(p_admin_id,'finance') then
    raise exception using errcode='42501',message='BARO finance permission required';
  end if;
  if p_entry_type not in ('expense','commission','refund','adjustment')
     or p_title is null or char_length(btrim(p_title))<2 or char_length(p_title)>140
     or p_amount is null or p_amount<=0 or p_amount>1000000000000
     or p_currency not in ('USD','SYP')
     or (p_currency='SYP' and (p_exchange_rate is null or p_exchange_rate<=0))
     or char_length(coalesce(p_description,''))>1000
     or char_length(coalesce(p_external_reference,''))>160
     or char_length(coalesce(p_idempotency_key,''))>160 then
    raise exception using errcode='22023',message='بيانات الحركة المالية غير صحيحة.';
  end if;
  v_usd:=case when p_currency='USD' then p_amount else p_amount/nullif(p_exchange_rate,0) end;
  insert into public.baro_manual_finance_entries(
    order_id,entry_type,title,amount,currency,exchange_rate,amount_usd_equivalent,
    status,description,external_reference,idempotency_key,created_by
  ) values (
    p_order_id,p_entry_type,btrim(p_title),p_amount,p_currency,
    case when p_currency='USD' then 1 else p_exchange_rate end,v_usd,
    'posted',coalesce(p_description,''),nullif(btrim(coalesce(p_external_reference,'')),''),
    nullif(btrim(coalesce(p_idempotency_key,'')),''),p_admin_id
  )
  on conflict (idempotency_key) do nothing
  returning * into v_entry;
  if v_entry.id is null and p_idempotency_key is not null then
    select * into v_entry from public.baro_manual_finance_entries where idempotency_key=p_idempotency_key;
    if not found or v_entry.entry_type is distinct from p_entry_type
       or v_entry.order_id is distinct from p_order_id
       or v_entry.amount is distinct from p_amount
       or v_entry.currency is distinct from p_currency then
      raise exception using errcode='22023',message='رقم الحركة المالية مستخدم مع بيانات مختلفة.';
    end if;
  end if;
  if v_entry.id is null then raise exception using errcode='40001',message='تعذر تسجيل الحركة المالية.'; end if;
  if v_entry.created_by=p_admin_id and v_entry.created_at>now()-interval '2 seconds' then
    insert into public.admin_audit_log(admin_id,action,entity_type,entity_id,details)
    values(p_admin_id,'baro_finance_entry_created','baro_manual_finance_entry',v_entry.id::text,
      jsonb_build_object('entry_type',v_entry.entry_type,'amount',v_entry.amount,'currency',v_entry.currency,'order_id',v_entry.order_id));
  end if;
  return jsonb_build_object('entry',to_jsonb(v_entry));
end;
$function$;
revoke all on function public.baro_manual_finance_entry_atomic(uuid,uuid,text,text,numeric,text,numeric,text,text,text) from public,anon,authenticated;
grant execute on function public.baro_manual_finance_entry_atomic(uuid,uuid,text,text,numeric,text,numeric,text,text,text) to service_role;

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
      v_amount:=new.customer_price_syp;v_currency:='SYP';v_rate:=new.displayed_exchange_rate_snapshot;
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
