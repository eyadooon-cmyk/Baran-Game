-- Keep the shared channel lock status aligned with BARAN's real automatic order states.
create or replace function public.baran_sync_automatic_order_guard_status()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  if new.client_request_id is not null then
    update public.baran_order_channel_guard
    set status=case
      when new.status='completed' then 'completed'
      when new.status in ('awaiting_supplier','processing','in_progress','fulfilled','delivered') then 'processing'
      when new.status in ('failed','rejected') then 'failed'
      when new.status in ('needs_review','unknown') then 'needs_review'
      when new.status='cancelled' then 'cancelled'
      else status
    end,updated_at=pg_catalog.now()
    where user_id=new.user_id and client_request_id=new.client_request_id
      and channel='automatic' and order_id=new.id;
  end if;
  return new;
end;
$function$;
