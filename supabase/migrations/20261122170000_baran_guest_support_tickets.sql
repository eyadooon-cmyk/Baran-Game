-- Guest support tickets are intentionally isolated from customer_feedback.
-- Public clients never receive table privileges; all access is mediated by the Edge Function.
create schema if not exists private;

create table if not exists public.baran_guest_support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_code text not null unique,
  email text not null,
  subject text not null,
  initial_message text not null,
  secret_hash text not null,
  status text not null default 'pending'
    check (status in ('pending','in_progress','answered','closed')),
  priority text not null default 'normal'
    check (priority in ('low','normal','high','urgent')),
  assistant_reason text,
  assistant_draft text,
  admin_read_at timestamptz,
  last_customer_message_at timestamptz,
  last_admin_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists baran_guest_support_tickets_status_created_idx
  on public.baran_guest_support_tickets (status, created_at desc);
create index if not exists baran_guest_support_tickets_email_created_idx
  on public.baran_guest_support_tickets (lower(email), created_at desc);

create table if not exists public.baran_guest_support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.baran_guest_support_tickets(id) on delete cascade,
  sender_role text not null check (sender_role in ('guest','admin','assistant')),
  message text not null check (char_length(message) between 1 and 5000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists baran_guest_support_messages_ticket_created_idx
  on public.baran_guest_support_messages (ticket_id, created_at asc);

create table if not exists private.baran_guest_support_rate_limits (
  key_hash text not null,
  window_start timestamptz not null,
  request_count integer not null default 0,
  primary key (key_hash, window_start)
);

create or replace function public.consume_guest_support_rate_limit(
  p_key_hash text,
  p_window_start timestamptz,
  p_limit integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into private.baran_guest_support_rate_limits(key_hash, window_start, request_count)
  values (p_key_hash, p_window_start, 1)
  on conflict (key_hash, window_start)
  do update set request_count = private.baran_guest_support_rate_limits.request_count + 1
  returning request_count into v_count;

  return v_count <= greatest(1, least(p_limit, 100));
end;
$$;

revoke all on schema private from public, anon, authenticated;
revoke all on function public.consume_guest_support_rate_limit(text, timestamptz, integer) from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function public.consume_guest_support_rate_limit(text, timestamptz, integer) to service_role;

alter table public.baran_guest_support_tickets enable row level security;
alter table public.baran_guest_support_messages enable row level security;

revoke all on table public.baran_guest_support_tickets from anon, authenticated;
revoke all on table public.baran_guest_support_messages from anon, authenticated;
grant all on table public.baran_guest_support_tickets to service_role;
grant all on table public.baran_guest_support_messages to service_role;

comment on table public.baran_guest_support_tickets is
  'Unauthenticated visitor support tickets; accessed only through the baran-guest-support Edge Function.';
comment on table public.baran_guest_support_messages is
  'Conversation messages for visitor support tickets; accessed only through the baran-guest-support Edge Function.';
