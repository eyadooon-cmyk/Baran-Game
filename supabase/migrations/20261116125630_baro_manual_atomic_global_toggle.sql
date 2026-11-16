create or replace function public.baro_manual_set_enabled_atomic(p_admin_id uuid,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_setting public.baro_manual_settings%rowtype;
begin
  if p_admin_id is null or not public.admin_is_user(p_admin_id) then
    raise exception using errcode='42501',message='admin access required';
  end if;
  if p_enabled is null then
    raise exception using errcode='22023',message='حالة استقبال BARO غير صحيحة.';
  end if;
  update public.baro_manual_settings
  set enabled=p_enabled,updated_by=p_admin_id,updated_at=pg_catalog.now()
  where id='main' returning * into v_setting;
  if not found then
    raise exception using errcode='P0002',message='BARO settings row missing';
  end if;
  insert into public.admin_audit_log(admin_id,action,entity_type,entity_id,details)
  values(p_admin_id,'baro_manual_global_toggle','baro_manual_settings','main',
    pg_catalog.jsonb_build_object('enabled',v_setting.enabled));
  return pg_catalog.jsonb_build_object('success',true,'manual_enabled',v_setting.enabled,
    'updated_at',v_setting.updated_at,'wallet_changed',false,'automatic_fulfillment_changed',false);
end;
$function$;
revoke all on function public.baro_manual_set_enabled_atomic(uuid,boolean) from public,anon,authenticated;
grant execute on function public.baro_manual_set_enabled_atomic(uuid,boolean) to service_role;
