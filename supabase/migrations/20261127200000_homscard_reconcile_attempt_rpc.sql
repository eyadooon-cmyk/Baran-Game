-- Service-only bridge: read the private HomsCard attempt UUID without exposing the private schema through PostgREST.
create or replace function public.baran_get_homscard_reconcile_attempt(p_order_id uuid)
returns table(attempt_id uuid, attempt_number integer, supplier_order_uuid uuid)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_role text := coalesce(auth.jwt()->>'role','');
begin
  if v_role <> 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  if p_order_id is null then
    raise exception 'Order id is required' using errcode='22023';
  end if;

  return query
  select a.id, a.attempt_number, a.supplier_order_uuid
  from private.baran_supplier_order_attempts a
  join public.suppliers s on s.id = a.supplier_id
  where a.order_id = p_order_id
    and lower(s.name) = 'homscard'
  order by a.attempt_number desc, a.created_at desc
  limit 1;
end;
$function$;

revoke all on function public.baran_get_homscard_reconcile_attempt(uuid) from public, anon, authenticated;
grant execute on function public.baran_get_homscard_reconcile_attempt(uuid) to service_role;
