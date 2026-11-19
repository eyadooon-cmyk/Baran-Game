-- Notification delivery observability, safe retry claims, and realtime inbox updates.
create table if not exists public.baran_push_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.baran_notifications(id) on delete cascade,
  subscription_id uuid not null,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','expired')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  http_status integer,
  error_code text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notification_id, subscription_id)
);
create index if not exists baran_push_delivery_logs_status_updated_idx
  on public.baran_push_delivery_logs(status, updated_at desc);
create index if not exists baran_push_delivery_logs_notification_idx
  on public.baran_push_delivery_logs(notification_id, created_at desc);

alter table public.baran_push_delivery_logs enable row level security;
revoke all on public.baran_push_delivery_logs from anon, authenticated;
grant all on public.baran_push_delivery_logs to service_role;

create or replace function public.baran_claim_push_delivery(
  p_notification_id uuid,
  p_subscription_id uuid,
  p_max_attempts integer default 3
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed boolean := false;
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  insert into public.baran_push_delivery_logs (
    notification_id, subscription_id, status, attempt_count, updated_at
  ) values (
    p_notification_id, p_subscription_id, 'processing', 1, now()
  )
  on conflict (notification_id, subscription_id) do update
    set status = 'processing',
        attempt_count = public.baran_push_delivery_logs.attempt_count + 1,
        http_status = null,
        error_code = null,
        last_error = null,
        updated_at = now()
    where public.baran_push_delivery_logs.status not in ('sent','expired')
      and public.baran_push_delivery_logs.attempt_count < greatest(1, least(p_max_attempts, 5))
      and (
        public.baran_push_delivery_logs.status <> 'processing'
        or public.baran_push_delivery_logs.updated_at < now() - interval '2 minutes'
      )
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;
revoke all on function public.baran_claim_push_delivery(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.baran_claim_push_delivery(uuid, uuid, integer) to service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'baran_notifications'
  ) then
    alter publication supabase_realtime add table public.baran_notifications;
  end if;
end
$$;
