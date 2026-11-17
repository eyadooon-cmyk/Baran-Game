-- Unified, append-only support conversation history for BARAN GAME.
create table if not exists public.baran_support_messages (
  id uuid primary key default gen_random_uuid(),
  feedback_id uuid not null references public.customer_feedback(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete restrict,
  sender_role text not null check (sender_role in ('customer','admin','assistant')),
  message text not null check (char_length(btrim(message)) between 1 and 2000),
  message_type text not null default 'message' check (message_type in ('message','ticket_opened','system')),
  created_at timestamptz not null default now()
);

create index if not exists baran_support_messages_ticket_created_idx
  on public.baran_support_messages(feedback_id, created_at, id);
create index if not exists baran_support_messages_sender_created_idx
  on public.baran_support_messages(sender_id, created_at desc);

alter table public.baran_support_messages enable row level security;
drop policy if exists baran_support_messages_deny_clients on public.baran_support_messages;
create policy baran_support_messages_deny_clients
  on public.baran_support_messages
  for all to anon, authenticated
  using (false) with check (false);

revoke all on public.baran_support_messages from anon, authenticated;
grant all on public.baran_support_messages to service_role;

comment on table public.baran_support_messages is
  'Append-only support conversation messages. Client roles are denied; access is mediated by baran-support-center Edge Function.';
