-- Automatic supplier fulfilment switch. Defaults to OFF and never changes BARO.
create table if not exists public.baran_automatic_fulfillment_settings (
  id text primary key default 'main' check (id = 'main'),
  enabled boolean not null default false,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.baran_automatic_fulfillment_settings enable row level security;
revoke all on public.baran_automatic_fulfillment_settings from public,anon,authenticated;
insert into public.baran_automatic_fulfillment_settings(id,enabled) values ('main',false)
on conflict (id) do nothing;

create or replace function public.baran_auto_fulfillment_set_enabled_atomic(p_admin_id uuid,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_setting public.baran_automatic_fulfillment_settings%rowtype;
begin
  if p_admin_id is null or not public.admin_is_user(p_admin_id) then
    raise exception using errcode='42501',message='admin access required';
  end if;
  if p_enabled is null then
    raise exception using errcode='22023',message='حالة الشحن الآلي غير صحيحة.';
  end if;
  update public.baran_automatic_fulfillment_settings
  set enabled=p_enabled,updated_by=p_admin_id,updated_at=pg_catalog.now()
  where id='main' returning * into v_setting;
  if not found then
    raise exception using errcode='P0002',message='automatic fulfillment settings row missing';
  end if;
  insert into public.admin_audit_log(admin_id,action,entity_type,entity_id,details)
  values(p_admin_id,'baran_automatic_fulfillment_global_toggle','baran_automatic_fulfillment_settings','main',
    pg_catalog.jsonb_build_object('enabled',v_setting.enabled));
  return pg_catalog.jsonb_build_object('success',true,'automatic_enabled',v_setting.enabled,
    'updated_at',v_setting.updated_at,'wallet_changed',false,'manual_baro_changed',false);
end;
$function$;
revoke all on function public.baran_auto_fulfillment_set_enabled_atomic(uuid,boolean) from public,anon,authenticated;
grant execute on function public.baran_auto_fulfillment_set_enabled_atomic(uuid,boolean) to service_role;

alter function public.baran_supplier_prepare_order(uuid)
  rename to baran_supplier_prepare_order_without_global_gate;
revoke all on function public.baran_supplier_prepare_order_without_global_gate(uuid)
  from public,anon,authenticated;

create or replace function public.baran_supplier_prepare_order(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_enabled boolean := false;
begin
  if p_order_id is null then
    raise exception 'معرّف الطلب غير صحيح' using errcode='22023';
  end if;
  select enabled into v_enabled
  from public.baran_automatic_fulfillment_settings
  where id='main' for share;
  if coalesce(v_enabled,false) is not true then
    return pg_catalog.jsonb_build_object('success',false,'blocked',true,
      'dispatch_state','manual_review',
      'message','مسار الشحن الآلي متوقف من الإدارة. لم يتم تجهيز الطلب أو إرساله.');
  end if;
  return public.baran_supplier_prepare_order_without_global_gate(p_order_id);
end;
$function$;
revoke all on function public.baran_supplier_prepare_order(uuid) from public,anon,authenticated;
grant execute on function public.baran_supplier_prepare_order(uuid) to service_role;
