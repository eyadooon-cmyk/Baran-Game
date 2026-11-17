-- Complete customer account enforcement and authentication telemetry.
create or replace function public.customer_account_is_banned(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.customer_account_controls c
    where c.user_id = p_user_id
      and c.status = 'banned'
      and (c.banned_until is null or c.banned_until > pg_catalog.now())
  );
$$;
revoke all on function public.customer_account_is_banned(uuid) from public, anon, authenticated;
grant execute on function public.customer_account_is_banned(uuid) to service_role;

create or replace function public.block_banned_customer_writes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is not null and public.customer_account_is_banned(v_actor) then
    raise exception 'هذا الحساب موقوف حالياً. لا يمكن تنفيذ عمليات على الحساب أثناء الحظر.'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists block_banned_customer_orders on public.orders;
create trigger block_banned_customer_orders before insert or update or delete on public.orders
for each row execute function public.block_banned_customer_writes();
drop trigger if exists block_banned_customer_deposits on public.deposit_requests;
create trigger block_banned_customer_deposits before insert or update or delete on public.deposit_requests
for each row execute function public.block_banned_customer_writes();
drop trigger if exists block_banned_customer_feedback on public.customer_feedback;
create trigger block_banned_customer_feedback before insert or update or delete on public.customer_feedback
for each row execute function public.block_banned_customer_writes();
drop trigger if exists block_banned_customer_wallets on public.wallets;
create trigger block_banned_customer_wallets before insert or update or delete on public.wallets
for each row execute function public.block_banned_customer_writes();
drop trigger if exists block_banned_customer_support_messages on public.baran_support_messages;
create trigger block_banned_customer_support_messages before insert or update or delete on public.baran_support_messages
for each row execute function public.block_banned_customer_writes();
drop trigger if exists block_banned_customer_baro_orders on public.leo_manual_orders;
create trigger block_banned_customer_baro_orders before insert or update or delete on public.leo_manual_orders
for each row execute function public.block_banned_customer_writes();

-- Capture successful customer sessions from Supabase Auth itself.
create or replace function public.capture_customer_auth_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has_prior boolean;
  v_same_device boolean;
  v_event text;
  v_severity text;
begin
  if exists (select 1 from public.admin_users a where a.user_id = new.user_id) then
    return new;
  end if;
  select exists (
    select 1 from auth.sessions s
    where s.user_id = new.user_id and s.id <> new.id
  ) into v_has_prior;
  select exists (
    select 1 from auth.sessions s
    where s.user_id = new.user_id and s.id <> new.id
      and coalesce(s.user_agent,'') = coalesce(new.user_agent,'')
      and coalesce(s.ip::text,'') = coalesce(new.ip::text,'')
  ) into v_same_device;
  if v_has_prior and not v_same_device then
    v_event := 'customer_new_device_detected';
    v_severity := 'warning';
  else
    v_event := 'customer_login_session_created';
    v_severity := 'info';
  end if;
  insert into public.customer_security_events(user_id, actor_id, event_type, severity, details)
  values (
    new.user_id, new.user_id, v_event, v_severity,
    pg_catalog.jsonb_build_object(
      'source','supabase_auth_sessions',
      'device_fingerprint', pg_catalog.md5(coalesce(new.user_agent,'') || '|' || coalesce(new.ip::text,'')),
      'user_agent', pg_catalog.left(coalesce(new.user_agent,''),250),
      'has_previous_session', v_has_prior
    )
  );
  return new;
end;
$$;
drop trigger if exists baran_capture_customer_auth_session on auth.sessions;
create trigger baran_capture_customer_auth_session
after insert on auth.sessions
for each row execute function public.capture_customer_auth_session();

-- Rate-limited, privacy-preserving reports from the login form.
create table if not exists public.customer_auth_attempts (
  id uuid primary key default gen_random_uuid(),
  identifier_hash text not null check (identifier_hash ~ '^[0-9a-f]{64}$'),
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
alter table public.customer_auth_attempts enable row level security;
revoke all on public.customer_auth_attempts from anon, authenticated;
grant all on public.customer_auth_attempts to service_role;
create index if not exists customer_auth_attempts_identifier_created_idx
  on public.customer_auth_attempts(identifier_hash, created_at desc);
create index if not exists customer_auth_attempts_ip_created_idx
  on public.customer_auth_attempts(ip_hash, created_at desc);

create or replace function public.baran_record_login_failure(
  p_identifier_hash text,
  p_ip_hash text,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_identifier_count integer;
  v_ip_count integer;
begin
  if p_identifier_hash is null or p_identifier_hash !~ '^[0-9a-f]{64}$'
     or p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid security telemetry payload' using errcode = '22023';
  end if;
  delete from public.customer_auth_attempts
  where created_at < pg_catalog.now() - interval '7 days';
  select count(*) into v_identifier_count
  from public.customer_auth_attempts
  where identifier_hash = p_identifier_hash
    and created_at >= pg_catalog.now() - interval '15 minutes';
  select count(*) into v_ip_count
  from public.customer_auth_attempts
  where ip_hash = p_ip_hash
    and created_at >= pg_catalog.now() - interval '15 minutes';
  if v_identifier_count >= 8 or v_ip_count >= 40 then
    return pg_catalog.jsonb_build_object('accepted',false,'rate_limited',true);
  end if;
  insert into public.customer_auth_attempts(identifier_hash,ip_hash)
  values (p_identifier_hash,p_ip_hash);
  insert into public.customer_security_events(user_id,actor_id,event_type,severity,details)
  values (
    null, null, 'login_failed_reported',
    case when v_identifier_count >= 2 or v_ip_count >= 8 then 'warning' else 'info' end,
    pg_catalog.jsonb_build_object(
      'source','client_reported_auth_error',
      'identifier_hash',p_identifier_hash,
      'ip_hash',p_ip_hash,
      'user_agent',pg_catalog.left(coalesce(p_user_agent,''),250),
      'reports_for_identifier_15m',v_identifier_count + 1,
      'reports_for_ip_15m',v_ip_count + 1,
      'verified_by_auth_server',false
    )
  );
  return pg_catalog.jsonb_build_object('accepted',true,'rate_limited',false);
end;
$$;
revoke all on function public.baran_record_login_failure(text,text,text) from public, anon, authenticated;
grant execute on function public.baran_record_login_failure(text,text,text) to service_role;
