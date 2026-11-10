-- Baran Game security hardening: supplier-order refund authorization.
-- The legacy implementation is retained as an internal helper and is no longer executable by service_role.
create or replace function public.baran_refund_failed_supplier_order_authorized(
  p_order_id uuid,
  p_reason text,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if p_actor_id is null
     or not exists (
       select 1 from public.admin_users a where a.user_id = p_actor_id
     ) then
    raise exception 'Not authorized to refund supplier orders'
      using errcode = '42501';
  end if;

  v_result := public.baran_refund_failed_supplier_order(p_order_id, p_reason);
  return v_result;
end;
$function$;

revoke all on function public.baran_refund_failed_supplier_order_authorized(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.baran_refund_failed_supplier_order_authorized(uuid,text,uuid) to service_role;

revoke all on function public.baran_refund_failed_supplier_order(uuid,text) from public, anon, authenticated, service_role;
