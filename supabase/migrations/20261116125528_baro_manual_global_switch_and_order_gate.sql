-- BARO global switch. Defaults to OFF; independent from automatic fulfilment.
create table if not exists public.baro_manual_settings (
  id text primary key default 'main' check (id = 'main'),
  enabled boolean not null default false,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.baro_manual_settings enable row level security;
revoke all on public.baro_manual_settings from public, anon, authenticated;
insert into public.baro_manual_settings(id,enabled) values ('main',false)
on conflict (id) do nothing;

alter function public.baro_manual_create_customer_order(uuid,text,text,integer,text)
  rename to baro_manual_create_customer_order_without_global_gate;
revoke all on function public.baro_manual_create_customer_order_without_global_gate(uuid,text,text,integer,text)
  from public, anon, authenticated;

create or replace function public.baro_manual_create_customer_order(
  p_user_id uuid,p_product_code text,p_player_id text,p_quantity integer,p_customer_note text
) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare v_enabled boolean := false;
begin
  select enabled into v_enabled from public.baro_manual_settings where id='main' for share;
  if coalesce(v_enabled,false) is not true then
    raise exception using errcode='55000',message='استقبال طلبات BARO متوقف حالياً من الإدارة.';
  end if;
  return public.baro_manual_create_customer_order_without_global_gate(
    p_user_id,p_product_code,p_player_id,p_quantity,p_customer_note
  );
end;
$function$;
revoke all on function public.baro_manual_create_customer_order(uuid,text,text,integer,text)
  from public, anon, authenticated;
grant execute on function public.baro_manual_create_customer_order(uuid,text,text,integer,text) to service_role;
