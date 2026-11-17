create table if not exists public.customer_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  session_id uuid not null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists customer_presence_last_seen_idx
  on public.customer_presence (last_seen_at desc);
alter table public.customer_presence enable row level security;
revoke all on table public.customer_presence from anon, authenticated;
grant all on table public.customer_presence to service_role;
comment on table public.customer_presence is
  'Private customer online heartbeat; accessible only to trusted server-side service role.';
