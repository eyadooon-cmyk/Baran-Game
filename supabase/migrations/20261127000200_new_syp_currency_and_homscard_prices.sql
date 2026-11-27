-- BARAN GAME: make all new order snapshots and HomsCard retail prices use new SYP.
-- Supplier costs remain USD. Legacy source rates remain stored in old SYP internally.
create or replace function public.set_product_price_syp_new_currency()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  commercial_rate_new numeric;
begin
  select (s.market_exchange_rate * (1 + s.fx_buffer_percent / 100)) / 100
    into commercial_rate_new
    from public.store_settings s
   where s.id = 'main';

  if commercial_rate_new is null or commercial_rate_new <= 0 then
    raise exception 'Store commercial exchange rate is unavailable';
  end if;

  if new.price_usd is not null and new.price_usd > 0 then
    new.price_syp := round(new.price_usd * commercial_rate_new, 2);
  end if;
  return new;
end;
$function$;

drop trigger if exists set_product_price_syp_new_currency on public.products;
create trigger set_product_price_syp_new_currency
before insert or update on public.products
for each row execute function public.set_product_price_syp_new_currency();

create or replace function public.set_order_price_snapshot()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  current_rate_new numeric;
  current_price numeric;
begin
  select p.price_usd
    into current_price
    from public.products p
   where p.product_code = new.product_code
     and p.is_active = true
   and p.product_code <> 'JAWAKER_TOKENS';

  if current_price is null or current_price <= 0 then
    raise exception 'Product is unavailable or has no valid USD price';
  end if;

  select (s.market_exchange_rate * (1 + s.fx_buffer_percent / 100)) / 100
    into current_rate_new
    from public.store_settings s
   where s.id = 'main';

  if current_rate_new is null or current_rate_new <= 0 then
    raise exception 'Store commercial exchange rate is unavailable';
  end if;

  new.exchange_rate := current_rate_new;
  new.unit_price_usd := current_price;
  new.unit_price_syp := round(current_price * current_rate_new, 2);
  new.total_price_usd := round(current_price * new.quantity, 4);
  new.total_price_syp := round(current_price * current_rate_new * new.quantity, 2);
  return new;
end;
$function$;

-- Apply the approved 3% markup to every active HomsCard USD-mapped fixed product.
-- Variable-quantity products continue to use their audited supplier cost at quote time.
update public.products p
   set price_usd = round(sp.unit_cost * (1 + ss.product_markup_percent / 100), 8),
       updated_at = now()
  from public.supplier_products sp
  join public.suppliers su on su.id = sp.supplier_id
  cross join public.store_settings ss
 where ss.id = 'main'
   and su.is_active = true
   and lower(trim(su.name)) = 'homscard'
   and sp.product_id = p.id
   and upper(sp.currency) = 'USD'
   and sp.unit_cost > 0
   and p.is_active = true
   and p.product_code <> 'JAWAKER_TOKENS';

-- Backfill new-SYP display prices for active mapped products after pricing updates.
update public.products p
   set price_syp = round(
     p.price_usd * (ss.market_exchange_rate * (1 + ss.fx_buffer_percent / 100) / 100), 2
   ),
       updated_at = now()
  from public.supplier_products sp
  join public.suppliers su on su.id = sp.supplier_id
  cross join public.store_settings ss
 where ss.id = 'main'
   and su.is_active = true
   and lower(trim(su.name)) = 'homscard'
   and sp.product_id = p.id
   and upper(sp.currency) = 'USD'
   and sp.unit_cost > 0
   and p.is_active = true
   and p.product_code <> 'JAWAKER_TOKENS';
