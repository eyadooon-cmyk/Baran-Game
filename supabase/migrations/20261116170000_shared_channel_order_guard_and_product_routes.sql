-- Shared cross-channel idempotency guard for BARAN automatic and BARO manual orders.
-- Feature branch + isolated staging project only. All routes stay disabled until explicit review.

create table if not exists public.baran_order_channel_guard (
  user_id uuid not null references auth.users(id),
  client_request_id uuid not null,
  channel text not null check (channel in ('automatic','manual')),
  product_code text not null,
  order_id uuid,
  status text not null default 'claimed'
    check (status in ('claimed','created','processing','unknown','completed','failed','needs_review','cancelled')),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (user_id,client_request_id)
);
create index if not exists baran_order_channel_guard_status_idx
  on public.baran_order_channel_guard(status,updated_at desc);
alter table public.baran_order_channel_guard enable row level security;
revoke all on public.baran_order_channel_guard from anon,authenticated;

create table if not exists public.baran_channel_product_routes (
  baran_product_code text not null references public.products(product_code),
  baro_product_code text not null references public.leo_manual_products(product_code),
  mapping_status text not null default 'pending_review'
    check (mapping_status in ('pending_review','approved','disabled')),
  route_enabled boolean not null default false,
  review_note text not null default '',
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (baran_product_code,baro_product_code),
  check (route_enabled = false or mapping_status = 'approved'),
  check ((mapping_status = 'approved') = (reviewed_by is not null and reviewed_at is not null))
);
alter table public.baran_channel_product_routes enable row level security;
revoke all on public.baran_channel_product_routes from anon,authenticated;

-- Product codes currently available in BARAN identify broad product families, not exact
-- package SKUs. Store candidates for admin review, but NEVER enable them automatically.
insert into public.baran_channel_product_routes
  (baran_product_code,baro_product_code,mapping_status,route_enabled,review_note)
select 'PUBG_UC',p.product_code,'pending_review',false,
       'مرشح فقط: رمز BARAN الحالي عام لفئة PUBG ولا يحدد SKU/كمية الحزمة بشكل مستقل.'
from public.leo_manual_products p
where p.category_id='pubg' and p.group_id='uc'
on conflict (baran_product_code,baro_product_code) do nothing;

insert into public.baran_channel_product_routes
  (baran_product_code,baro_product_code,mapping_status,route_enabled,review_note)
select 'FREEFIRE_DIAMONDS',p.product_code,'pending_review',false,
       'مرشح فقط: رمز BARAN الحالي عام لفئة جواهر Free Fire ولا يحدد SKU/كمية الحزمة بشكل مستقل.'
from public.leo_manual_products p
where p.category_id='freefire' and p.group_id='diamonds'
on conflict (baran_product_code,baro_product_code) do nothing;

create or replace function public.baran_claim_order_channel(
  p_user_id uuid,p_client_request_id uuid,p_channel text,p_product_code text
) returns void
language plpgsql security definer set search_path = ''
as $function$
declare v_claim public.baran_order_channel_guard%rowtype;
begin
  if p_user_id is null or p_client_request_id is null
     or p_channel not in ('automatic','manual')
     or p_product_code is null or pg_catalog.length(pg_catalog.btrim(p_product_code))<2 then
    raise exception using errcode='22023',message='معرّف العملية أو مسار الطلب غير صالح.';
  end if;

  insert into public.baran_order_channel_guard(user_id,client_request_id,channel,product_code,status)
  values(p_user_id,p_client_request_id,p_channel,p_product_code,'claimed')
  on conflict (user_id,client_request_id) do nothing;

  select * into v_claim
  from public.baran_order_channel_guard
  where user_id=p_user_id and client_request_id=p_client_request_id
  for update;

  if v_claim.channel is distinct from p_channel then
    raise exception using errcode='23505',
      message='هذه العملية محجوزة مسبقاً لقناة أخرى. لا يمكن تكرارها أو تحويلها تلقائياً.';
  end if;
  if v_claim.product_code is distinct from p_product_code then
    raise exception using errcode='23505',
      message='رقم العملية مستخدم لمنتج مختلف. أوقف الطلب وراجع سجل العملية.';
  end if;
end;
$function$;
revoke all on function public.baran_claim_order_channel(uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.baran_claim_order_channel(uuid,uuid,text,text) to service_role;

create or replace function public.baran_guard_manual_order_insert()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  if new.idempotency_key is null then
    raise exception using errcode='22023',message='طلب BARO يتطلب معرّف محاولة ثابتاً لمنع التكرار.';
  end if;
  perform public.baran_claim_order_channel(new.user_id,new.idempotency_key,'manual',new.product_code);
  return new;
end;
$function$;

create or replace function public.baran_guard_automatic_order_insert()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  if new.client_request_id is not null then
    perform public.baran_claim_order_channel(new.user_id,new.client_request_id,'automatic',new.product_code);
  end if;
  return new;
end;
$function$;

create or replace function public.baran_link_manual_order_channel()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  update public.baran_order_channel_guard
  set order_id=new.id,status='created',updated_at=pg_catalog.now()
  where user_id=new.user_id and client_request_id=new.idempotency_key
    and channel='manual' and product_code=new.product_code;
  if not found then
    raise exception using errcode='23514',message='تعذر ربط طلب BARO بقفل منع التكرار.';
  end if;
  return new;
end;
$function$;

create or replace function public.baran_link_automatic_order_channel()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  if new.client_request_id is not null then
    update public.baran_order_channel_guard
    set order_id=new.id,status='created',updated_at=pg_catalog.now()
    where user_id=new.user_id and client_request_id=new.client_request_id
      and channel='automatic' and product_code=new.product_code;
    if not found then
      raise exception using errcode='23514',message='تعذر ربط الطلب الآلي بقفل منع التكرار.';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.baran_sync_manual_order_guard_status()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  update public.baran_order_channel_guard
  set status=case
    when new.status='completed' then 'completed'
    when new.status='in_progress' then 'processing'
    when new.status='failed' then 'failed'
    when new.status='needs_review' then 'needs_review'
    when new.status='cancelled' then 'cancelled'
    else status
  end,updated_at=pg_catalog.now()
  where user_id=new.user_id and client_request_id=new.idempotency_key
    and channel='manual' and order_id=new.id;
  return new;
end;
$function$;

create or replace function public.baran_sync_automatic_order_guard_status()
returns trigger language plpgsql security definer set search_path = ''
as $function$
begin
  if new.client_request_id is not null then
    update public.baran_order_channel_guard
    set status=case
      when new.status='completed' then 'completed'
      when new.status in ('processing','in_progress') then 'processing'
      when new.status='failed' then 'failed'
      when new.status in ('needs_review','unknown') then 'needs_review'
      when new.status='cancelled' then 'cancelled'
      else status
    end,updated_at=pg_catalog.now()
    where user_id=new.user_id and client_request_id=new.client_request_id
      and channel='automatic' and order_id=new.id;
  end if;
  return new;
end;
$function$;

drop trigger if exists baran_guard_manual_order_insert on public.leo_manual_orders;
create trigger baran_guard_manual_order_insert
before insert on public.leo_manual_orders
for each row execute function public.baran_guard_manual_order_insert();

drop trigger if exists baran_link_manual_order_channel on public.leo_manual_orders;
create trigger baran_link_manual_order_channel
after insert on public.leo_manual_orders
for each row execute function public.baran_link_manual_order_channel();

drop trigger if exists baran_sync_manual_order_guard_status on public.leo_manual_orders;
create trigger baran_sync_manual_order_guard_status
after update of status on public.leo_manual_orders
for each row when (old.status is distinct from new.status)
execute function public.baran_sync_manual_order_guard_status();

drop trigger if exists baran_guard_automatic_order_insert on public.orders;
create trigger baran_guard_automatic_order_insert
before insert on public.orders
for each row execute function public.baran_guard_automatic_order_insert();

drop trigger if exists baran_link_automatic_order_channel on public.orders;
create trigger baran_link_automatic_order_channel
after insert on public.orders
for each row execute function public.baran_link_automatic_order_channel();

drop trigger if exists baran_sync_automatic_order_guard_status on public.orders;
create trigger baran_sync_automatic_order_guard_status
after update of status on public.orders
for each row when (old.status is distinct from new.status)
execute function public.baran_sync_automatic_order_guard_status();

-- No function here releases a claim. A failed/unknown order remains reserved until
-- an operator verifies supplier state and a separately reviewed resolution is added.
