-- Per-account notification preferences. Inbox records remain available even when push is muted.
create table if not exists public.baran_notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  support_enabled boolean not null default true,
  wallet_enabled boolean not null default true,
  orders_enabled boolean not null default true,
  offers_enabled boolean not null default true,
  security_enabled boolean not null default true,
  quiet_hours_enabled boolean not null default false,
  quiet_hours_start time not null default '22:00',
  quiet_hours_end time not null default '08:00',
  timezone text not null default 'UTC' check (char_length(timezone) between 1 and 80),
  updated_at timestamptz not null default now()
);
alter table public.baran_notification_preferences enable row level security;
drop policy if exists baran_notification_preferences_select_own on public.baran_notification_preferences;
create policy baran_notification_preferences_select_own
  on public.baran_notification_preferences for select to authenticated
  using ((select auth.uid()) = user_id);
drop policy if exists baran_notification_preferences_insert_own on public.baran_notification_preferences;
create policy baran_notification_preferences_insert_own
  on public.baran_notification_preferences for insert to authenticated
  with check ((select auth.uid()) = user_id);
drop policy if exists baran_notification_preferences_update_own on public.baran_notification_preferences;
create policy baran_notification_preferences_update_own
  on public.baran_notification_preferences for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
revoke all on public.baran_notification_preferences from anon;
grant select,insert,update on public.baran_notification_preferences to authenticated;
grant all on public.baran_notification_preferences to service_role;
