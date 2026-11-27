-- Ephemeral PostgreSQL integration fixture for the real fixed-order RPC.
BEGIN;
-- Runs only in the GitHub Actions postgres service; never points at Supabase production.
create extension if not exists pgcrypto;
create role anon;
create role authenticated;
create role service_role;

create schema private;
create table public.suppliers (
  id uuid primary key, name text not null, is_active boolean not null default true
);
create table public.products (
  id uuid primary key, product_code text unique not null, name text not null,
  is_active boolean not null default true, catalog_group text,
  price_usd numeric not null, updated_at timestamptz default now()
);
create table public.supplier_products (
  id uuid primary key default gen_random_uuid(), supplier_id uuid not null,
  product_id uuid not null, supplier_sku text not null, is_preferred boolean not null,
  currency text not null, unit_cost numeric not null
);
create table public.baran_homscard_audit_items (
  product_id text not null, product_data jsonb not null, page_data jsonb not null,
  updated_at timestamptz not null default now(), page_status text not null
);
create table public.store_settings (
  id text primary key, product_markup_percent numeric not null,
  market_exchange_rate numeric not null, fx_buffer_percent numeric not null,
  exchange_rate numeric not null
);
create table private.baran_supplier_api_configs (
  supplier_id uuid primary key, integration_enabled boolean not null,
  execution_enabled boolean not null, connection_status text not null,
  create_order_path text, order_status_path text, auth_secret_name text
);
create table public.wallets (
  user_id uuid primary key, balance_usd numeric not null default 0,
  balance_syp numeric not null default 0
);
create table public.orders (
  id uuid primary key default gen_random_uuid(), user_id uuid not null,
  product_code text not null, player_id text, quantity integer not null,
  payment_currency text not null, client_request_id uuid not null,
  status text not null default 'pending', exchange_rate numeric,
  unit_price_usd numeric, unit_price_syp numeric,
  total_price_usd numeric, total_price_syp numeric,
  unique(user_id, client_request_id)
);
create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null,
  amount numeric not null, currency text not null, transaction_type text not null,
  description text, order_id uuid
);
create table public.order_fulfillment (
  order_id uuid primary key, supplier_status text, dispatch_state text,
  supplier_order_uuid uuid, updated_at timestamptz default now()
);
create table private.baran_supplier_order_attempts (
  id uuid primary key default gen_random_uuid(), order_id uuid not null,
  attempt_number integer not null, supplier_order_uuid uuid default gen_random_uuid()
);
create table public.test_supplier_control (
  supplier_id uuid not null, queued boolean not null default true,
  create_attempt boolean not null default true,
  create_supplier_uuid boolean not null default true
);

create or replace function public.baran_supplier_prepare_order(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_supplier uuid; v_queued boolean; v_attempt uuid;
begin
  select supplier_id, queued into v_supplier, v_queued
  from public.test_supplier_control limit 1;
  if v_queued and (select create_attempt from public.test_supplier_control limit 1) then
    insert into private.baran_supplier_order_attempts(order_id,attempt_number,supplier_order_uuid)
    values(p_order_id,1,case when (select create_supplier_uuid from public.test_supplier_control limit 1)
      then gen_random_uuid() else null end)
    returning id into v_attempt;
  end if;
  return jsonb_build_object(
    'supplier_id',v_supplier,'queued',coalesce(v_queued,false),
    'attempt_id',v_attempt,'message','fixture response'
  );
end;
$$;

\ir ../../supabase/migrations/20261127000200_homscard_fixed_order_lifecycle.sql

create or replace function public.test_order_price_snapshot()
returns trigger language plpgsql set search_path = ''
as $$
declare v_price numeric; v_rate numeric;
begin
  select price_usd into v_price from public.products where product_code=new.product_code;
  select market_exchange_rate * (1 + fx_buffer_percent / 100) / 100
    into v_rate from public.store_settings where id='main';
  new.exchange_rate := v_rate;
  new.unit_price_usd := v_price;
  new.unit_price_syp := round(v_price*v_rate);
  new.total_price_usd := round(v_price*new.quantity,4);
  new.total_price_syp := round(v_price*v_rate*new.quantity,2);
  return new;
end;
$$;
create trigger test_order_price before insert on public.orders
for each row execute function public.test_order_price_snapshot();

insert into public.suppliers(id,name,is_active)
values ('10000000-0000-0000-0000-000000000001','HomsCard',true);
insert into public.products(id,product_code,name,catalog_group,price_usd)
values ('20000000-0000-0000-0000-000000000001','PUBGM_60','PUBG 60','homscard_fixed',10);
insert into public.supplier_products(supplier_id,product_id,supplier_sku,is_preferred,currency,unit_cost)
values ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','60',true,'USD',10);
insert into public.baran_homscard_audit_items(product_id,product_data,page_data,page_status)
values ('60',
  '{"product_type":"package","available":true,"params":["Player ID"],"price":10}',
  '{"text":"Enter Player ID"}','success');
insert into public.store_settings(id,product_markup_percent,market_exchange_rate,fx_buffer_percent,exchange_rate)
values ('main',0,10000,2,100);
insert into private.baran_supplier_api_configs
(supplier_id,integration_enabled,execution_enabled,connection_status,create_order_path,order_status_path,auth_secret_name)
values ('10000000-0000-0000-0000-000000000001',false,false,'disabled','/order.php','/check.php','test_secret');
insert into public.wallets(user_id,balance_usd,balance_syp)
values ('30000000-0000-0000-0000-000000000001',100,100000);
insert into public.test_supplier_control(supplier_id,queued)
values ('10000000-0000-0000-0000-000000000001',true);

-- Execute the actual migration RPC against fixture tables, catching failures
-- in subtransactions and asserting that all writes rolled back.
do $$
declare
  v_user uuid := '30000000-0000-0000-0000-000000000001';
  v_supplier uuid := '10000000-0000-0000-0000-000000000001';
  v_request uuid := '40000000-0000-0000-0000-000000000001';
  v_result jsonb;
  v_balance numeric;
  v_count integer;
begin
  if has_function_privilege('anon','public.baran_create_homscard_fixed_order(uuid,text,text,text,uuid)','execute')
     or has_function_privilege('authenticated','public.baran_create_homscard_fixed_order(uuid,text,text,text,uuid)','execute')
     or not has_function_privilege('service_role','public.baran_create_homscard_fixed_order(uuid,text,text,text,uuid)','execute') then
    raise exception 'RPC grants are not server-role-only';
  end if;

  -- Disabled supplier: no order and no wallet mutation.
  begin
    perform public.baran_create_homscard_fixed_order(v_user,'PUBGM_60','player-01','USD',v_request);
    raise exception 'expected disabled supplier rejection';
  exception when others then
    if sqlerrm = 'expected disabled supplier rejection' then raise; end if;
  end;
  select balance_usd into v_balance from public.wallets where user_id=v_user;
  select count(*) into v_count from public.orders;
  if v_balance <> 100 or v_count <> 0 then raise exception 'disabled gate left side effects'; end if;

  update private.baran_supplier_api_configs set integration_enabled=true,
    execution_enabled=true,connection_status='ready' where supplier_id=v_supplier;

  -- Insufficient funds: inserted order must roll back with no ledger/queue rows.
  update public.wallets set balance_usd=1 where user_id=v_user;
  begin
    perform public.baran_create_homscard_fixed_order(v_user,'PUBGM_60','player-01','USD',v_request);
    raise exception 'expected insufficient balance rejection';
  exception when others then
    if sqlerrm = 'expected insufficient balance rejection' then raise; end if;
  end;
  select count(*) into v_count from public.orders;
  if v_count <> 0 then raise exception 'insufficient-balance order was not rolled back'; end if;
  select count(*) into v_count from public.wallet_transactions;
  if v_count <> 0 then raise exception 'insufficient-balance ledger was not rolled back'; end if;
  select balance_usd into v_balance from public.wallets where user_id=v_user;
  if v_balance <> 1 then raise exception 'insufficient-balance wallet changed'; end if;

  -- Supplier mismatch: force the helper to report another supplier.
  update public.wallets set balance_usd=100 where user_id=v_user;
  update public.test_supplier_control set supplier_id='99999999-0000-0000-0000-000000000001';
  begin
    perform public.baran_create_homscard_fixed_order(v_user,'PUBGM_60','player-01','USD',v_request);
    raise exception 'expected supplier mismatch rejection';
  exception when others then
    if sqlerrm = 'expected supplier mismatch rejection' then raise; end if;
  end;
  select count(*) into v_count from public.orders;
  if v_count <> 0 then raise exception 'supplier mismatch order was not rolled back'; end if;
  select count(*) into v_count from public.wallet_transactions;
  if v_count <> 0 then raise exception 'supplier mismatch ledger was not rolled back'; end if;
  select balance_usd into v_balance from public.wallets where user_id=v_user;
  if v_balance <> 100 then raise exception 'supplier mismatch wallet changed'; end if;

  -- A non-numeric HomsCard SKU must fail before any order or wallet write.
  update public.supplier_products set supplier_sku='SKU-60';
  begin
    perform public.baran_create_homscard_fixed_order(v_user,'PUBGM_60','player-01','USD',v_request);
    raise exception 'expected invalid supplier SKU rejection';
  exception when others then
    if sqlerrm = 'expected invalid supplier SKU rejection' then raise; end if;
  end;
  select count(*) into v_count from public.orders;
  select balance_usd into v_balance from public.wallets where user_id=v_user;
  if v_count <> 0 or v_balance <> 100 then raise exception 'invalid SKU left financial side effects'; end if;
  update public.supplier_products set supplier_sku='60';

  -- A queued response without an attempt id must roll back all writes.
  update public.test_supplier_control set create_attempt=false;
  begin
    perform public.baran_create_homscard_fixed_order(v_user,'PUBGM_60','player-01','USD',v_request);
    raise exception 'expected missing supplier attempt rejection';
  exception when others then
    if sqlerrm = 'expected missing supplier attempt rejection' then raise; end if;
  end;
  select count(*) into v_count from public.orders;
  select balance_usd into v_balance from public.wallets where user_id=v_user;
  if v_count <> 0 or v_balance <> 100 then raise exception 'missing attempt left financial side effects'; end if;

  -- An attempt without a supplier UUID must also roll back all writes.
  update public.test_supplier_control set create_attempt=true,create_supplier_uuid=false;
  begin
    perform public.baran_create_homscard_fixed_order(v_user,'PUBGM_60','player-01','USD',v_request);
    raise exception 'expected missing supplier UUID rejection';
  exception when others then
    if sqlerrm = 'expected missing supplier UUID rejection' then raise; end if;
  end;
  select count(*) into v_count from public.orders;
  select balance_usd into v_balance from public.wallets where user_id=v_user;
  if v_count <> 0 or v_balance <> 100 then raise exception 'missing supplier UUID left financial side effects'; end if;

  -- Successful transaction and duplicate retry: exactly one debit and ledger row.
  update public.test_supplier_control set supplier_id=v_supplier,queued=true,
    create_attempt=true,create_supplier_uuid=true;
  v_result := public.baran_create_homscard_fixed_order(v_user,'PUBGM_60','player-01','USD',v_request);
  if coalesce((v_result->>'success')::boolean,false) is not true
     or coalesce((v_result->>'duplicate')::boolean,true) is not false then
    raise exception 'first order did not return a new success';
  end if;
  v_result := public.baran_create_homscard_fixed_order(v_user,'PUBGM_60','player-01','USD',v_request);
  if coalesce((v_result->>'duplicate')::boolean,false) is not true then
    raise exception 'retry was not recognized as duplicate';
  end if;
  select balance_usd into v_balance from public.wallets where user_id=v_user;
  if v_balance <> 90 then raise exception 'expected exactly one USD 10 debit, got %',v_balance; end if;
  select count(*) into v_count from public.orders;
  if v_count <> 1 then raise exception 'expected one order, got %',v_count; end if;
  select count(*) into v_count from public.wallet_transactions;
  if v_count <> 1 then raise exception 'expected one wallet ledger row, got %',v_count; end if;
  select count(*) into v_count from public.order_fulfillment;
  if v_count <> 1 then raise exception 'expected one fulfillment row, got %',v_count; end if;
end;
$$;

rollback;
