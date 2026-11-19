-- Internal VIP labels for customer administration only.
create table if not exists public.customer_vip_tags (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  is_vip boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.customer_vip_tags enable row level security;
revoke all on table public.customer_vip_tags from anon, authenticated;
grant all on table public.customer_vip_tags to service_role;
comment on table public.customer_vip_tags is
  'Internal admin-only VIP labels. Does not grant discounts, wallet changes, or account permissions.';
