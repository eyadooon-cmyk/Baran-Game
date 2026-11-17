create table if not exists public.customer_referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references auth.users(id) on delete cascade,
  referred_user_id uuid not null unique references auth.users(id) on delete cascade,
  referral_code text not null,
  status text not null default 'pending' check (status in ('pending','qualified','rewarded','rejected')),
  qualified_order_id uuid references public.orders(id) on delete set null,
  reward_points bigint not null default 0 check (reward_points >= 0),
  admin_note text,
  created_at timestamptz not null default now(),
  qualified_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id)
);
create index if not exists customer_referrals_referrer_idx on public.customer_referrals(referrer_user_id, created_at desc);
create index if not exists customer_referrals_status_idx on public.customer_referrals(status, created_at desc);
alter table public.customer_referrals enable row level security;
revoke all on table public.customer_referrals from anon, authenticated;
grant all on table public.customer_referrals to service_role;

create or replace function public.register_customer_referral()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  entered_code text;
  referrer_id uuid;
begin
  select upper(btrim(coalesce(raw_user_meta_data->>'referral_code','')))
    into entered_code from auth.users where id = new.id;
  if entered_code is null or entered_code = '' then return new; end if;
  select id into referrer_id
    from public.profiles
    where upper(member_code) = entered_code and id <> new.id
    limit 1;
  if referrer_id is null then return new; end if;
  insert into public.customer_referrals(referrer_user_id,referred_user_id,referral_code)
  values(referrer_id,new.id,entered_code)
  on conflict (referred_user_id) do nothing;
  return new;
end;
$$;
drop trigger if exists trg_register_customer_referral on public.profiles;
create trigger trg_register_customer_referral
after insert on public.profiles
for each row execute function public.register_customer_referral();

create or replace function public.qualify_customer_referral_on_first_completed_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'completed' and old.status is distinct from new.status
     and (select count(*) from public.orders where user_id = new.user_id and status = 'completed') = 1 then
    update public.customer_referrals
      set status = 'qualified', qualified_order_id = new.id, qualified_at = now()
      where referred_user_id = new.user_id and status = 'pending';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_qualify_customer_referral on public.orders;
create trigger trg_qualify_customer_referral
after update of status on public.orders
for each row execute function public.qualify_customer_referral_on_first_completed_order();

revoke all on function public.register_customer_referral() from public, anon, authenticated;
revoke all on function public.qualify_customer_referral_on_first_completed_order() from public, anon, authenticated;
