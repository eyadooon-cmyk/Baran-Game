-- Customer account controls and private security audit trail.
create table if not exists public.customer_account_controls (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','banned')),
  reason text,
  banned_until timestamptz,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  constraint customer_account_controls_reason_len check (reason is null or char_length(reason) <= 500)
);
create table if not exists public.customer_security_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null check (char_length(event_type) between 2 and 80),
  severity text not null default 'info' check (severity in ('info','warning','critical')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.customer_account_controls enable row level security;
alter table public.customer_security_events enable row level security;
revoke all on public.customer_account_controls from anon, authenticated;
revoke all on public.customer_security_events from anon, authenticated;
grant all on public.customer_account_controls to service_role;
grant all on public.customer_security_events to service_role;
create index if not exists customer_security_events_created_at_idx on public.customer_security_events(created_at desc);
create index if not exists customer_security_events_user_id_idx on public.customer_security_events(user_id, created_at desc);
