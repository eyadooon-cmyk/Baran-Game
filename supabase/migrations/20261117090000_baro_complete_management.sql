-- BARO complete manual-management foundation.
-- Additive only: preserves the existing BARAN automatic fulfilment path and keeps BARO closed.

alter table public.baro_manual_settings
  add column if not exists usd_syp_rate numeric(20,6),
  add column if not exists low_margin_percent numeric(6,2) not null default 15,
  add column if not exists default_currency text not null default 'USD',
  add column if not exists settings_json jsonb not null default '{}'::jsonb;

alter table public.leo_manual_products
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null,
  add column if not exists supplier_sku text,
  add column if not exists supplier_cost_currency text not null default 'USD',
  add column if not exists margin_alert_percent numeric(6,2);

alter table public.leo_manual_orders
  add column if not exists displayed_price_usd_snapshot numeric(20,6),
  add column if not exists displayed_price_syp_snapshot numeric(20,2),
  add column if not exists displayed_price_captured_at timestamptz,
  add column if not exists displayed_exchange_rate_snapshot numeric(20,6),
  add column if not exists supplier_id_snapshot uuid,
  add column if not exists supplier_cost_usd_snapshot numeric(20,6);

alter table public.leo_manual_products
  drop constraint if exists leo_manual_products_purchase_requires_both_prices;
alter table public.leo_manual_products
  add constraint leo_manual_products_purchase_requires_both_prices
  check (
    purchase_enabled = false
    or (coalesce(sale_price_usd,0) > 0 and coalesce(sale_price_syp,0) > 0)
  );

alter table public.baro_manual_settings
  drop constraint if exists baro_manual_settings_default_currency_check;
alter table public.baro_manual_settings
  add constraint baro_manual_settings_default_currency_check
  check (default_currency in ('USD','SYP'));
alter table public.baro_manual_settings
  drop constraint if exists baro_manual_settings_rate_check;
alter table public.baro_manual_settings
  add constraint baro_manual_settings_rate_check
  check (usd_syp_rate is null or usd_syp_rate > 0);
alter table public.baro_manual_settings
  drop constraint if exists baro_manual_settings_margin_check;
alter table public.baro_manual_settings
  add constraint baro_manual_settings_margin_check
  check (low_margin_percent >= 0 and low_margin_percent <= 100);

create table if not exists public.baro_manual_product_price_history (
  id uuid primary key default gen_random_uuid(),
  product_code text not null references public.leo_manual_products(product_code),
  changed_by uuid,
  previous_values jsonb not null default '{}'::jsonb,
  new_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.baro_manual_supplier_products (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id),
  product_code text not null references public.leo_manual_products(product_code),
  supplier_sku text,
  unit_cost numeric(20,6) not null check (unit_cost >= 0),
  currency text not null check (currency in ('USD','SYP')),
  lead_time_hours integer check (lead_time_hours is null or lead_time_hours >= 0),
  is_preferred boolean not null default false,
  is_active boolean not null default true,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_id, product_code)
);

create table if not exists public.baro_manual_supplier_events (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id),
  order_id uuid references public.leo_manual_orders(id),
  event_type text not null check (event_type in ('delay','issue','rating','note')),
  rating smallint check (rating is null or rating between 1 and 5),
  details text not null default '',
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.baro_manual_finance_entries (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.leo_manual_orders(id),
  entry_type text not null check (entry_type in ('sale_received','supplier_cost','expense','commission','refund','adjustment','reversal')),
  title text not null check (char_length(btrim(title)) between 2 and 140),
  amount numeric(20,6) not null check (amount > 0),
  currency text not null check (currency in ('USD','SYP')),
  exchange_rate numeric(20,6),
  amount_usd_equivalent numeric(20,6),
  status text not null default 'posted' check (status in ('posted','pending','void')),
  description text not null default '',
  external_reference text,
  idempotency_key text unique,
  reversal_of uuid references public.baro_manual_finance_entries(id),
  created_by uuid,
  created_at timestamptz not null default now(),
  check (currency <> 'SYP' or exchange_rate is not null and exchange_rate > 0)
);

create unique index if not exists baro_finance_order_sale_once
  on public.baro_manual_finance_entries(order_id)
  where order_id is not null and entry_type='sale_received' and status='posted';
create unique index if not exists baro_finance_order_supplier_cost_once
  on public.baro_manual_finance_entries(order_id)
  where order_id is not null and entry_type='supplier_cost' and status='posted';
create index if not exists baro_finance_created_at_idx
  on public.baro_manual_finance_entries(created_at desc);
create index if not exists baro_finance_order_id_idx
  on public.baro_manual_finance_entries(order_id);
create index if not exists baro_price_history_product_created_idx
  on public.baro_manual_product_price_history(product_code,created_at desc);
create index if not exists baro_supplier_products_product_idx
  on public.baro_manual_supplier_products(product_code,is_active);
create index if not exists baro_supplier_events_supplier_created_idx
  on public.baro_manual_supplier_events(supplier_id,created_at desc);

create table if not exists public.baro_staff_permissions (
  user_id uuid not null,
  permission_key text not null check (permission_key in ('view','catalog','orders','finance','suppliers','settings','staff','audit')),
  is_active boolean not null default true,
  granted_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id,permission_key)
);

alter table public.baro_manual_product_price_history enable row level security;
alter table public.baro_manual_supplier_products enable row level security;
alter table public.baro_manual_supplier_events enable row level security;
alter table public.baro_manual_finance_entries enable row level security;
alter table public.baro_staff_permissions enable row level security;

revoke all on public.baro_manual_product_price_history from anon,authenticated;
revoke all on public.baro_manual_supplier_products from anon,authenticated;
revoke all on public.baro_manual_supplier_events from anon,authenticated;
revoke all on public.baro_manual_finance_entries from anon,authenticated;
revoke all on public.baro_staff_permissions from anon,authenticated;

drop policy if exists baro_price_history_deny_client_access on public.baro_manual_product_price_history;
create policy baro_price_history_deny_client_access on public.baro_manual_product_price_history
  for all to anon,authenticated using (false) with check (false);
drop policy if exists baro_supplier_products_deny_client_access on public.baro_manual_supplier_products;
create policy baro_supplier_products_deny_client_access on public.baro_manual_supplier_products
  for all to anon,authenticated using (false) with check (false);
drop policy if exists baro_supplier_events_deny_client_access on public.baro_manual_supplier_events;
create policy baro_supplier_events_deny_client_access on public.baro_manual_supplier_events
  for all to anon,authenticated using (false) with check (false);
drop policy if exists baro_finance_deny_client_access on public.baro_manual_finance_entries;
create policy baro_finance_deny_client_access on public.baro_manual_finance_entries
  for all to anon,authenticated using (false) with check (false);
drop policy if exists baro_staff_permissions_deny_client_access on public.baro_staff_permissions;
create policy baro_staff_permissions_deny_client_access on public.baro_staff_permissions
  for all to anon,authenticated using (false) with check (false);

create or replace function public.baro_manual_has_permission(p_user_id uuid,p_permission text)
returns boolean
language sql stable security definer set search_path=''
as $function$
  select p_user_id is not null and (
    public.admin_is_user(p_user_id)
    or exists (
      select 1 from public.baro_staff_permissions p
      where p.user_id=p_user_id and p.permission_key=p_permission and p.is_active=true
    )
    or exists (
      select 1 from public.baro_staff_permissions p
      where p.user_id=p_user_id and p.permission_key='view' and p.is_active=true and p_permission='view'
    )
  );
$function$;
revoke all on function public.baro_manual_has_permission(uuid,text) from public,anon,authenticated;
grant execute on function public.baro_manual_has_permission(uuid,text) to service_role;

create or replace function public.baro_manual_settings_save_atomic(
  p_admin_id uuid,p_usd_syp_rate numeric,p_low_margin_percent numeric,p_default_currency text
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare v_row public.baro_manual_settings%rowtype;
begin
  if p_admin_id is null or not public.baro_manual_has_permission(p_admin_id,'settings') then
    raise exception using errcode='42501',message='BARO settings permission required';
  end if;
  if (p_usd_syp_rate is not null and (p_usd_syp_rate<=0 or p_usd_syp_rate>1000000000))
     or p_low_margin_percent is null or p_low_margin_percent<0 or p_low_margin_percent>100
     or p_default_currency not in ('USD','SYP') then
    raise exception using errcode='22023',message='إعدادات العملات وهامش الربح غير صحيحة.';
  end if;
  update public.baro_manual_settings
  set usd_syp_rate=p_usd_syp_rate,low_margin_percent=p_low_margin_percent,
      default_currency=p_default_currency,updated_by=p_admin_id,updated_at=now()
  where id='main'
  returning * into v_row;
  if not found then raise exception using errcode='P0002',message='BARO settings row missing'; end if;
  insert into public.admin_audit_log(admin_id,action,entity_type,entity_id,details)
  values(p_admin_id,'baro_settings_updated','baro_manual_settings','main',
    jsonb_build_object('usd_syp_rate',p_usd_syp_rate,'low_margin_percent',p_low_margin_percent,'default_currency',p_default_currency));
  return jsonb_build_object('settings',to_jsonb(v_row));
end;
$function$;
revoke all on function public.baro_manual_settings_save_atomic(uuid,numeric,numeric,text) from public,anon,authenticated;
grant execute on function public.baro_manual_settings_save_atomic(uuid,numeric,numeric,text) to service_role;

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
  if p_entry_type not in ('expense','commission','refund','adjustment','reversal')
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
  end if;
  if v_entry.id is null then raise exception using errcode='40001',message='تعذر تسجيل الحركة المالية.'; end if;
  insert into public.admin_audit_log(admin_id,action,entity_type,entity_id,details)
  values(p_admin_id,'baro_finance_entry_created','baro_manual_finance_entry',v_entry.id::text,
    jsonb_build_object('entry_type',v_entry.entry_type,'amount',v_entry.amount,'currency',v_entry.currency,'order_id',v_entry.order_id));
  return jsonb_build_object('entry',to_jsonb(v_entry));
end;
$function$;
revoke all on function public.baro_manual_finance_entry_atomic(uuid,uuid,text,text,numeric,text,numeric,text,text,text) from public,anon,authenticated;
grant execute on function public.baro_manual_finance_entry_atomic(uuid,uuid,text,text,numeric,text,numeric,text,text,text) to service_role;

create or replace function public.baro_manual_staff_permission_save_atomic(
  p_admin_id uuid,p_user_id uuid,p_permission_key text,p_is_active boolean
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare v_row public.baro_staff_permissions%rowtype;
begin
  if p_admin_id is null or not public.admin_is_user(p_admin_id) then
    raise exception using errcode='42501',message='admin access required';
  end if;
  if p_user_id is null or p_user_id=p_admin_id or p_permission_key not in ('view','catalog','orders','finance','suppliers','settings','staff','audit') or p_is_active is null then
    raise exception using errcode='22023',message='صلاحيات موظف BARO غير صحيحة.';
  end if;
  insert into public.baro_staff_permissions(user_id,permission_key,is_active,granted_by)
  values(p_user_id,p_permission_key,p_is_active,p_admin_id)
  on conflict(user_id,permission_key) do update
    set is_active=excluded.is_active,granted_by=excluded.granted_by,updated_at=now()
  returning * into v_row;
  insert into public.admin_audit_log(admin_id,action,entity_type,entity_id,details)
  values(p_admin_id,'baro_staff_permission_updated','baro_staff_permission',p_user_id::text,
    jsonb_build_object('permission',p_permission_key,'active',p_is_active));
  return jsonb_build_object('permission',to_jsonb(v_row));
end;
$function$;
revoke all on function public.baro_manual_staff_permission_save_atomic(uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.baro_manual_staff_permission_save_atomic(uuid,uuid,text,boolean) to service_role;

create or replace function public.baro_manual_product_save_complete_atomic(
  p_admin_id uuid,p_product_code text,p_supplier_cost_usd numeric,p_sale_price_usd numeric,
  p_sale_price_syp numeric,p_admin_notes text,p_catalog_visible boolean,p_purchase_enabled boolean
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare v_result jsonb;
begin
  if p_admin_id is null or not public.baro_manual_has_permission(p_admin_id,'catalog') then
    raise exception using errcode='42501',message='BARO catalog permission required';
  end if;
  perform set_config('app.baro_actor_id',p_admin_id::text,true);
  if p_purchase_enabled and (
    p_sale_price_usd is null or p_sale_price_usd<=0 or
    p_sale_price_syp is null or p_sale_price_syp<=0
  ) then
    raise exception using errcode='22023',message='يجب إدخال سعر موجب بالدولار والليرة قبل إتاحة المنتج.';
  end if;
  v_result:=public.baro_manual_product_save_atomic(
    p_admin_id,p_product_code,p_supplier_cost_usd,p_sale_price_usd,p_sale_price_syp,
    p_admin_notes,p_catalog_visible,p_purchase_enabled
  );
  return v_result;
end;
$function$;
revoke all on function public.baro_manual_product_save_complete_atomic(uuid,text,numeric,numeric,numeric,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.baro_manual_product_save_complete_atomic(uuid,text,numeric,numeric,numeric,text,boolean,boolean) to service_role;

create or replace function public.baro_manual_capture_price_history()
returns trigger
language plpgsql security definer set search_path=''
as $function$
declare v_actor uuid;
begin
  if old.sale_price_usd is distinct from new.sale_price_usd
     or old.sale_price_syp is distinct from new.sale_price_syp
     or old.supplier_cost_usd is distinct from new.supplier_cost_usd
     or old.supplier_id is distinct from new.supplier_id then
    v_actor:=nullif(current_setting('app.baro_actor_id',true),'')::uuid;
    insert into public.baro_manual_product_price_history(product_code,changed_by,previous_values,new_values)
    values(
      new.product_code,v_actor,
      jsonb_build_object('sale_price_usd',old.sale_price_usd,'sale_price_syp',old.sale_price_syp,'supplier_cost_usd',old.supplier_cost_usd,'supplier_id',old.supplier_id),
      jsonb_build_object('sale_price_usd',new.sale_price_usd,'sale_price_syp',new.sale_price_syp,'supplier_cost_usd',new.supplier_cost_usd,'supplier_id',new.supplier_id)
    );
  end if;
  return new;
end;
$function$;
revoke all on function public.baro_manual_capture_price_history() from public,anon,authenticated;
drop trigger if exists baro_manual_product_price_history_trigger on public.leo_manual_products;
create trigger baro_manual_product_price_history_trigger
after update on public.leo_manual_products
for each row execute function public.baro_manual_capture_price_history();

create or replace function public.baro_manual_post_finance_and_notify()
returns trigger
language plpgsql security definer set search_path=''
as $function$
declare v_amount numeric; v_currency text; v_rate numeric; v_usd numeric; v_status_label text;
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
        'تسجيل تلقائي بعد تأكيد استلام الدفع يدوياً','baro-sale-'||new.id::text,new.user_id
      ) on conflict do nothing;
    end if;
  end if;

  if new.status='completed' and coalesce(new.supplier_cost_usd,0)>0
     and (tg_op='INSERT' or old.status is distinct from new.status or old.supplier_cost_usd is distinct from new.supplier_cost_usd) then
    insert into public.baro_manual_finance_entries(
      order_id,entry_type,title,amount,currency,exchange_rate,amount_usd_equivalent,status,description,idempotency_key,created_by
    ) values (
      new.id,'supplier_cost','تكلفة مورد طلب BARO',new.supplier_cost_usd,'USD',1,new.supplier_cost_usd,'posted',
      'تسجيل تكلفة التنفيذ عند إكمال الطلب','baro-cost-'||new.id::text,new.user_id
    ) on conflict do nothing;
  end if;

  if tg_op='UPDATE' and old.status is distinct from new.status then
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
drop trigger if exists baro_manual_order_finance_notification_trigger on public.leo_manual_orders;
create trigger baro_manual_order_finance_notification_trigger
after insert or update of status,payment_status,supplier_cost_usd on public.leo_manual_orders
for each row execute function public.baro_manual_post_finance_and_notify();

create or replace function public.baro_manual_create_customer_order(
  p_user_id uuid,p_product_code text,p_player_id text,p_quantity integer,p_customer_note text,p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
  v_existing public.leo_manual_orders%rowtype;
  v_product public.leo_manual_products%rowtype;
  v_order public.leo_manual_orders%rowtype;
  v_player text:=pg_catalog.btrim(coalesce(p_player_id,''));
  v_note text:=pg_catalog.btrim(coalesce(p_customer_note,''));
  v_enabled boolean:=false;
  v_rate numeric;
  v_captured_at timestamptz:=pg_catalog.now();
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
    return pg_catalog.jsonb_build_object('success',true,'replayed',true,'order_id',v_existing.id,
      'status',v_existing.status,'payment_status',v_existing.payment_status,'wallet_changed',false,'finance_posted',false);
  end if;
  select enabled,usd_syp_rate into v_enabled,v_rate
  from public.baro_manual_settings where id='main' for share;
  if coalesce(v_enabled,false) is not true then
    raise exception using errcode='55000',message='استقبال طلبات BARO متوقف حالياً من الإدارة.';
  end if;
  select * into v_product from public.leo_manual_products where product_code=p_product_code for share;
  if not found or v_product.catalog_visible is not true or v_product.purchase_enabled is not true then
    raise exception using errcode='55000',message='هذا المنتج غير متاح للطلب اليدوي حالياً.';
  end if;
  if coalesce(v_product.sale_price_usd,0)<=0 or coalesce(v_product.sale_price_syp,0)<=0 then
    raise exception using errcode='55000',message='يجب تحديد سعر المنتج بالدولار والليرة قبل الطلب.';
  end if;
  if v_product.category_id='jawaker' and v_product.group_id='tokens' then
    if p_quantity<10000 or p_quantity>1000000 then
      raise exception using errcode='22023',message='كمية جواكر يجب أن تكون بين 10,000 و1,000,000.';
    end if;
  elsif p_quantity<>1 then
    raise exception using errcode='22023',message='هذا المنتج لا يقبل كمية متغيرة.';
  end if;
  if (select count(*) from public.leo_manual_orders where user_id=p_user_id and created_at>pg_catalog.now()-interval '10 minutes')>=5 then
    raise exception using errcode='54000',message='وصلت للحد المؤقت للطلبات. حاول بعد قليل.';
  end if;
  insert into public.leo_manual_orders(
    user_id,product_code,player_id,product_name_snapshot,quantity,customer_note,
    displayed_price_usd_snapshot,displayed_price_syp_snapshot,displayed_price_captured_at,
    displayed_exchange_rate_snapshot,supplier_id_snapshot,supplier_cost_usd_snapshot,
    status,payment_status,idempotency_key
  ) values (
    p_user_id,p_product_code,v_player,v_product.product_name,p_quantity,v_note,
    v_product.sale_price_usd,v_product.sale_price_syp,v_captured_at,
    v_rate,v_product.supplier_id,v_product.supplier_cost_usd,
    'pending','awaiting_quote',p_idempotency_key
  ) returning * into v_order;
  insert into public.leo_manual_order_events(order_id,actor_id,event_type,details)
  values(v_order.id,p_user_id,'customer_order_created',
    pg_catalog.jsonb_build_object('product_code',p_product_code,'quantity',p_quantity,
      'displayed_price_usd',v_order.displayed_price_usd_snapshot,
      'displayed_price_syp',v_order.displayed_price_syp_snapshot,
      'displayed_exchange_rate',v_order.displayed_exchange_rate_snapshot,
      'displayed_price_captured_at',v_order.displayed_price_captured_at));
  return pg_catalog.jsonb_build_object('success',true,'replayed',false,'order_id',v_order.id,
    'status',v_order.status,'payment_status',v_order.payment_status,'wallet_changed',false,'finance_posted',false);
end;
$function$;
revoke all on function public.baro_manual_create_customer_order(uuid,text,text,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.baro_manual_create_customer_order(uuid,text,text,integer,text,uuid) to service_role;

create or replace function public.baro_manual_add_supplier_event_atomic(
  p_admin_id uuid,p_supplier_id uuid,p_order_id uuid,p_event_type text,p_rating smallint,p_details text
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare v_row public.baro_manual_supplier_events%rowtype;
begin
  if p_admin_id is null or not public.baro_manual_has_permission(p_admin_id,'suppliers') then
    raise exception using errcode='42501',message='BARO supplier permission required';
  end if;
  if p_supplier_id is null or p_event_type not in ('delay','issue','rating','note')
     or (p_event_type='rating' and (p_rating is null or p_rating<1 or p_rating>5))
     or char_length(coalesce(p_details,''))>1000 then
    raise exception using errcode='22023',message='بيانات سجل المورد غير صحيحة.';
  end if;
  insert into public.baro_manual_supplier_events(supplier_id,order_id,event_type,rating,details,created_by)
  values(p_supplier_id,p_order_id,p_event_type,p_rating,coalesce(p_details,''),p_admin_id)
  returning * into v_row;
  insert into public.admin_audit_log(admin_id,action,entity_type,entity_id,details)
  values(p_admin_id,'baro_supplier_event_created','baro_manual_supplier_event',v_row.id::text,
    jsonb_build_object('supplier_id',p_supplier_id,'event_type',p_event_type));
  return jsonb_build_object('event',to_jsonb(v_row));
end;
$function$;
revoke all on function public.baro_manual_add_supplier_event_atomic(uuid,uuid,uuid,text,smallint,text) from public,anon,authenticated;
grant execute on function public.baro_manual_add_supplier_event_atomic(uuid,uuid,uuid,text,smallint,text) to service_role;

-- BARO's private finance and supplier tables are reachable only through the authenticated Edge Function.
