-- Isolate BARO suppliers from automatic suppliers and retain private daily BARO snapshots.

create table if not exists public.baro_manual_suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120),
  contact_name text,
  contact_phone text,
  contact_email text,
  notes text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.baro_manual_suppliers enable row level security;
revoke all on public.baro_manual_suppliers from anon,authenticated;
drop policy if exists baro_manual_suppliers_deny_client_access on public.baro_manual_suppliers;
create policy baro_manual_suppliers_deny_client_access on public.baro_manual_suppliers
  for all to anon,authenticated using(false) with check(false);

alter table public.leo_manual_products drop constraint if exists leo_manual_products_supplier_id_fkey;
alter table public.leo_manual_products
  add constraint leo_manual_products_supplier_id_fkey
  foreign key(supplier_id) references public.baro_manual_suppliers(id) on delete set null;

alter table public.baro_manual_supplier_products drop constraint if exists baro_manual_supplier_products_supplier_id_fkey;
alter table public.baro_manual_supplier_products
  add constraint baro_manual_supplier_products_supplier_id_fkey
  foreign key(supplier_id) references public.baro_manual_suppliers(id) on delete restrict;

alter table public.baro_manual_supplier_events drop constraint if exists baro_manual_supplier_events_supplier_id_fkey;
alter table public.baro_manual_supplier_events
  add constraint baro_manual_supplier_events_supplier_id_fkey
  foreign key(supplier_id) references public.baro_manual_suppliers(id) on delete restrict;

create index if not exists baro_manual_suppliers_active_name_idx
  on public.baro_manual_suppliers(is_active,name);
create index if not exists leo_manual_products_supplier_id_idx
  on public.leo_manual_products(supplier_id);

create table if not exists public.baro_manual_backup_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_json jsonb not null,
  row_counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.baro_manual_backup_snapshots enable row level security;
revoke all on public.baro_manual_backup_snapshots from anon,authenticated;
drop policy if exists baro_manual_backups_deny_client_access on public.baro_manual_backup_snapshots;
create policy baro_manual_backups_deny_client_access on public.baro_manual_backup_snapshots
  for all to anon,authenticated using(false) with check(false);
create index if not exists baro_manual_backups_created_idx
  on public.baro_manual_backup_snapshots(created_at desc);

create or replace function public.baro_manual_create_backup_snapshot()
returns uuid
language plpgsql security definer set search_path=''
as $function$
declare v_id uuid;
begin
  insert into public.baro_manual_backup_snapshots(snapshot_json,row_counts)
  values(
    jsonb_build_object(
      'settings',(select to_jsonb(s) from public.baro_manual_settings s where s.id='main'),
      'products',coalesce((select jsonb_agg(to_jsonb(p) order by p.product_code) from public.leo_manual_products p),'[]'::jsonb),
      'orders',coalesce((select jsonb_agg(to_jsonb(o) order by o.created_at) from public.leo_manual_orders o),'[]'::jsonb),
      'order_events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at) from public.leo_manual_order_events e),'[]'::jsonb),
      'suppliers',coalesce((select jsonb_agg(to_jsonb(s) order by s.name) from public.baro_manual_suppliers s),'[]'::jsonb),
      'supplier_products',coalesce((select jsonb_agg(to_jsonb(sp) order by sp.product_code) from public.baro_manual_supplier_products sp),'[]'::jsonb),
      'supplier_events',coalesce((select jsonb_agg(to_jsonb(se) order by se.created_at) from public.baro_manual_supplier_events se),'[]'::jsonb),
      'finance_entries',coalesce((select jsonb_agg(to_jsonb(f) order by f.created_at) from public.baro_manual_finance_entries f),'[]'::jsonb),
      'price_history',coalesce((select jsonb_agg(to_jsonb(h) order by h.created_at) from public.baro_manual_product_price_history h),'[]'::jsonb),
      'staff_permissions',coalesce((select jsonb_agg(to_jsonb(r) order by r.user_id) from public.baro_staff_permissions r),'[]'::jsonb)
    ),
    jsonb_build_object(
      'products',(select count(*) from public.leo_manual_products),
      'orders',(select count(*) from public.leo_manual_orders),
      'finance_entries',(select count(*) from public.baro_manual_finance_entries),
      'suppliers',(select count(*) from public.baro_manual_suppliers)
    )
  ) returning id into v_id;
  delete from public.baro_manual_backup_snapshots where created_at<now()-interval '60 days';
  return v_id;
end;
$function$;
revoke all on function public.baro_manual_create_backup_snapshot() from public,anon,authenticated;
grant execute on function public.baro_manual_create_backup_snapshot() to service_role;

do $block$
declare v_job bigint;
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    select jobid into v_job from cron.job where jobname='baro-manual-daily-backup' limit 1;
    if v_job is not null then
      perform cron.unschedule(v_job);
    end if;
    perform cron.schedule('baro-manual-daily-backup','30 2 * * *','select public.baro_manual_create_backup_snapshot();');
  end if;
end;
$block$;
