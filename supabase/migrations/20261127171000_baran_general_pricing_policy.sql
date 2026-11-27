-- BARAN general finance pricing policy.
-- This policy is deliberately separate from the legacy exchange_rate field:
-- it does not rewrite existing customer prices, wallets, or order snapshots.
alter table public.store_settings
  add column if not exists market_exchange_rate numeric(20,6) not null default 15300,
  add column if not exists fx_buffer_percent numeric(6,3) not null default 2,
  add column if not exists product_markup_percent numeric(6,3) not null default 3,
  add column if not exists pricing_updated_at timestamptz,
  add column if not exists pricing_updated_by uuid references auth.users(id) on delete set null;

alter table public.store_settings
  drop constraint if exists store_settings_market_exchange_rate_check;
alter table public.store_settings
  add constraint store_settings_market_exchange_rate_check
  check (market_exchange_rate > 0 and market_exchange_rate <= 100000000);

alter table public.store_settings
  drop constraint if exists store_settings_fx_buffer_percent_check;
alter table public.store_settings
  add constraint store_settings_fx_buffer_percent_check
  check (fx_buffer_percent >= 0 and fx_buffer_percent <= 25);

alter table public.store_settings
  drop constraint if exists store_settings_product_markup_percent_check;
alter table public.store_settings
  add constraint store_settings_product_markup_percent_check
  check (product_markup_percent >= 0 and product_markup_percent <= 100);

create or replace function public.admin_update_pricing_policy(
  p_admin_id uuid,
  p_market_exchange_rate numeric,
  p_fx_buffer_percent numeric,
  p_product_markup_percent numeric
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_settings public.store_settings%rowtype;
  v_commercial_rate numeric;
begin
  if p_admin_id is null or not exists (
    select 1 from public.admin_users where user_id = p_admin_id
  ) then
    raise exception using errcode = '42501', message = 'Administrator access required';
  end if;

  if p_market_exchange_rate is null or p_market_exchange_rate <= 0 or p_market_exchange_rate > 100000000
     or p_fx_buffer_percent is null or p_fx_buffer_percent < 0 or p_fx_buffer_percent > 25
     or p_product_markup_percent is null or p_product_markup_percent < 0 or p_product_markup_percent > 100 then
    raise exception using errcode = '22023', message = 'بيانات سياسة التسعير غير صحيحة.';
  end if;

  update public.store_settings
  set market_exchange_rate = p_market_exchange_rate,
      fx_buffer_percent = p_fx_buffer_percent,
      product_markup_percent = p_product_markup_percent,
      pricing_updated_at = now(),
      pricing_updated_by = p_admin_id
  where id = 'main'
  returning * into v_settings;

  if not found then
    raise exception using errcode = 'P0002', message = 'إعدادات المتجر الرئيسية غير موجودة.';
  end if;

  v_commercial_rate := v_settings.market_exchange_rate * (1 + v_settings.fx_buffer_percent / 100);

  insert into public.admin_audit_log(admin_id, action, entity_type, entity_id, details)
  values (
    p_admin_id,
    'pricing_policy_updated',
    'store_settings',
    'main',
    jsonb_build_object(
      'market_exchange_rate', v_settings.market_exchange_rate,
      'fx_buffer_percent', v_settings.fx_buffer_percent,
      'product_markup_percent', v_settings.product_markup_percent,
      'commercial_exchange_rate', v_commercial_rate
    )
  );

  return jsonb_build_object(
    'market_exchange_rate', v_settings.market_exchange_rate,
    'fx_buffer_percent', v_settings.fx_buffer_percent,
    'product_markup_percent', v_settings.product_markup_percent,
    'commercial_exchange_rate', v_commercial_rate,
    'updated_at', v_settings.pricing_updated_at,
    'updated_by', v_settings.pricing_updated_by
  );
end;
$function$;

revoke all on function public.admin_update_pricing_policy(uuid,numeric,numeric,numeric) from public, anon, authenticated;
grant execute on function public.admin_update_pricing_policy(uuid,numeric,numeric,numeric) to service_role;
