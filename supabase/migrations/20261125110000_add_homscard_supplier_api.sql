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
