-- Add HomsCard as an isolated reseller API provider. Keep all live purchasing disabled.
alter table private.baran_supplier_api_configs
  drop constraint if exists baran_supplier_api_configs_adapter_key_check;
alter table private.baran_supplier_api_configs
  add constraint baran_supplier_api_configs_adapter_key_check
  check (adapter_key = any (array['pending','rtc_market','flow1st','generic_rest','custom','homscard']));

with supplier_row as (
  insert into public.suppliers(name,notes,is_active)
  select 'HomsCard','مورد API موثّق. الربط يبدأ بقراءة الملف الشخصي والكتالوج فقط؛ إنشاء الطلبات الآلي متوقف حتى مراجعة مستقلة.',true
  where not exists (select 1 from public.suppliers where lower(name)=lower('HomsCard'))
  returning id
), selected_supplier as (
  select id from supplier_row
  union all
  select id from public.suppliers where lower(name)=lower('HomsCard')
  limit 1
)
insert into private.baran_supplier_api_configs(
  supplier_id,adapter_key,api_base_url,health_path,balance_path,create_order_path,order_status_path,
  auth_secret_name,auth_header_name,auth_prefix,low_balance_threshold,balance_currency,
  integration_enabled,execution_enabled,connection_status,updated_at
)
select id,'homscard','https://homscard.com/reseller','/profile.php','/profile.php',
  '/order.php','/check.php','HOMSCARD_API_TOKEN','api-token','',0,'USD',
  false,false,'pending_credentials',now()
from selected_supplier
on conflict(supplier_id) do update set
  adapter_key='homscard',
  api_base_url='https://homscard.com/reseller',
  health_path='/profile.php',
  balance_path='/profile.php',
  create_order_path='/order.php',
  order_status_path='/check.php',
  auth_secret_name='HOMSCARD_API_TOKEN',
  auth_header_name='api-token',
  auth_prefix='',
  balance_currency='USD',
  integration_enabled=false,
  execution_enabled=false,
  connection_status='pending_credentials',
  updated_at=now();

insert into private.baran_supplier_events(supplier_id,event_type,severity,message,details)
select id,'configuration','info',
  'تمت إضافة موصل HomsCard بوضع قراءة فقط؛ لم يتم تفعيل إنشاء الطلبات أو الخصم.',
  jsonb_build_object('adapter_key','homscard','read_only',true,'execution_enabled',false)
from public.suppliers where lower(name)=lower('HomsCard')
on conflict do nothing;


-- Permit the dedicated HomsCard adapter in the existing admin-only configuration RPC.
create or replace function public.baran_admin_save_supplier_api_config(
  p_admin_id uuid,p_supplier_id uuid,p_adapter_key text,p_api_base_url text,
  p_health_path text,p_balance_path text,p_create_order_path text,p_order_status_path text,
  p_auth_secret_name text,p_auth_header_name text,p_auth_prefix text,
  p_low_balance_threshold numeric,p_balance_currency text,p_integration_enabled boolean
) returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare v_row private.baran_supplier_api_configs%rowtype;
begin
  if not exists(select 1 from public.admin_users where user_id=p_admin_id) then
    raise exception 'Administrator access required' using errcode='42501';
  end if;
  if p_supplier_id is null or not exists(select 1 from public.suppliers where id=p_supplier_id) then
    raise exception 'المورد غير موجود' using errcode='P0002';
  end if;
  if p_adapter_key not in ('pending','rtc_market','flow1st','generic_rest','custom','homscard') then
    raise exception 'نوع موصل المورد غير مدعوم' using errcode='22023';
  end if;
  if p_api_base_url is not null and (p_api_base_url !~ '^https://' or length(p_api_base_url)>500) then
    raise exception 'يجب أن يكون عنوان API آمناً ويبدأ بـ HTTPS' using errcode='22023';
  end if;
  if p_auth_secret_name is not null and p_auth_secret_name !~ '^[A-Z][A-Z0-9_]{2,99}$' then
    raise exception 'اسم سر الاتصال غير صالح' using errcode='22023';
  end if;
  if p_auth_header_name is null or p_auth_header_name !~ '^[A-Za-z0-9-]{1,64}$' then
    raise exception 'اسم ترويسة المصادقة غير صالح' using errcode='22023';
  end if;
  if p_auth_prefix is null or length(p_auth_prefix)>40 then
    raise exception 'بادئة المصادقة غير صالحة' using errcode='22023';
  end if;
  if p_low_balance_threshold is null or p_low_balance_threshold<0 or p_low_balance_threshold>100000000000 then
    raise exception 'حد تنبيه الرصيد غير صالح' using errcode='22023';
  end if;
  if p_balance_currency not in ('USD','SYP') then
    raise exception 'عملة الرصيد غير صالحة' using errcode='22023';
  end if;
  if exists(select 1 from unnest(array[p_health_path,p_balance_path,p_create_order_path,p_order_status_path]) x
            where x is not null and (x ~ '^https?://' or x ~ '\\.\\.' or length(x)>240)) then
    raise exception 'مسارات API يجب أن تكون نسبية وآمنة' using errcode='22023';
  end if;
  insert into private.baran_supplier_api_configs(
    supplier_id,adapter_key,api_base_url,health_path,balance_path,create_order_path,order_status_path,
    auth_secret_name,auth_header_name,auth_prefix,low_balance_threshold,balance_currency,
    integration_enabled,execution_enabled,connection_status,updated_by,updated_at
  ) values (
    p_supplier_id,p_adapter_key,nullif(btrim(p_api_base_url),''),nullif(btrim(p_health_path),''),
    nullif(btrim(p_balance_path),''),nullif(btrim(p_create_order_path),''),nullif(btrim(p_order_status_path),''),
    nullif(btrim(p_auth_secret_name),''),p_auth_header_name,p_auth_prefix,p_low_balance_threshold,p_balance_currency,
    coalesce(p_integration_enabled,false),false,
    case when coalesce(p_integration_enabled,false) then 'pending_credentials' else 'disabled' end,
    p_admin_id,now()
  ) on conflict(supplier_id) do update set
    adapter_key=excluded.adapter_key,api_base_url=excluded.api_base_url,health_path=excluded.health_path,
    balance_path=excluded.balance_path,create_order_path=excluded.create_order_path,
    order_status_path=excluded.order_status_path,auth_secret_name=excluded.auth_secret_name,
    auth_header_name=excluded.auth_header_name,auth_prefix=excluded.auth_prefix,
    low_balance_threshold=excluded.low_balance_threshold,balance_currency=excluded.balance_currency,
    integration_enabled=excluded.integration_enabled,execution_enabled=false,
    connection_status=excluded.connection_status,last_error=null,updated_by=p_admin_id,updated_at=now()
  returning * into v_row;
  insert into private.baran_supplier_events(supplier_id,event_type,severity,message,details)
  values(p_supplier_id,'configuration','info','تم حفظ إعدادات الربط الأولية؛ التنفيذ التلقائي ما زال متوقفاً',
    jsonb_build_object('adapter_key',p_adapter_key,'integration_enabled',p_integration_enabled));
  insert into public.admin_audit_log(admin_id,action,entity_type,entity_id,details)
  values(p_admin_id,'supplier_api_config_save','supplier',p_supplier_id::text,
    jsonb_build_object('adapter_key',p_adapter_key,'integration_enabled',p_integration_enabled,'execution_enabled',false));
  return jsonb_build_object('supplier_id',v_row.supplier_id,'connection_status',v_row.connection_status,
    'integration_enabled',v_row.integration_enabled,'execution_enabled',v_row.execution_enabled,
    'auth_secret_name',v_row.auth_secret_name);
end;
$function$;
