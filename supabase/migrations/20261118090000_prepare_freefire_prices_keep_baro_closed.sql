-- Prepare reviewed Free Fire BARO prices for internal administration only.
-- BARO and every Free Fire product remain hidden/non-purchasable. No orders,
-- wallet changes, finance entries, or supplier calls are performed.

begin;

do $$
begin
  if not exists (
    select 1 from public.baro_manual_settings where id = 'main'
  ) then
    raise exception 'BARO settings row is missing; refusing to prepare prices.';
  end if;

  if (
    select count(*) from public.leo_manual_products
    where product_code in (
      'LEO_FREEFIRE_DIAMONDS_110','LEO_FREEFIRE_DIAMONDS_210',
      'LEO_FREEFIRE_DIAMONDS_583','LEO_FREEFIRE_DIAMONDS_1188',
      'LEO_FREEFIRE_DIAMONDS_2420'
    )
  ) <> 5 then
    raise exception 'Expected all five Free Fire diamond products; refusing partial pricing update.';
  end if;
end $$;

create temporary table baro_ff_price_before on commit drop as
select product_code, supplier_cost_usd, supplier_cost_currency,
       sale_price_usd, sale_price_syp, catalog_visible, purchase_enabled
from public.leo_manual_products
where product_code in (
  'LEO_FREEFIRE_DIAMONDS_110','LEO_FREEFIRE_DIAMONDS_210',
  'LEO_FREEFIRE_DIAMONDS_583','LEO_FREEFIRE_DIAMONDS_1188',
  'LEO_FREEFIRE_DIAMONDS_2420'
);

update public.baro_manual_settings
set enabled = false,
    usd_syp_rate = 156,
    default_currency = 'SYP',
    updated_at = now()
where id = 'main';

with input(product_code, cost_syp, sale_syp, note) as (
  values
    ('LEO_FREEFIRE_DIAMONDS_110', 147::numeric, 160::numeric,
      '110 جوهرة (100+10): تكلفة ليو 147 ليرة جديدة؛ سعر البيع المعتمد 160.'),
    ('LEO_FREEFIRE_DIAMONDS_210', 293::numeric, 310::numeric,
      'تكلفة ليو 293 ليرة جديدة؛ سعر البيع المعتمد 310.'),
    ('LEO_FREEFIRE_DIAMONDS_583', 727::numeric, 790::numeric,
      'تكلفة ليو 727 ليرة جديدة؛ سعر البيع المعتمد 790.'),
    ('LEO_FREEFIRE_DIAMONDS_1188', 1483::numeric, 1595::numeric,
      'تكلفة ليو 1483 ليرة جديدة؛ سعر البيع المعتمد 1595.'),
    ('LEO_FREEFIRE_DIAMONDS_2420', 2906::numeric, 3165::numeric,
      'تكلفة ليو 2906 ليرة جديدة؛ سعر البيع المعتمد 3165.')
)
update public.leo_manual_products p
set supplier_cost_usd = round(i.cost_syp / 156, 4),
    supplier_cost_currency = 'SYP',
    sale_price_usd = round(i.sale_syp / 156, 4),
    sale_price_syp = i.sale_syp,
    catalog_visible = false,
    purchase_enabled = false,
    admin_notes = i.note || ' سعر الصرف المرجعي: 156 ليرة جديدة لكل دولار. بيانات داخلية للإدارة فقط.',
    updated_at = now()
from input i
where p.product_code = i.product_code;

insert into public.baro_manual_product_price_history
  (product_code, changed_by, previous_values, new_values)
select
  b.product_code,
  null,
  jsonb_build_object(
    'supplier_cost_usd', b.supplier_cost_usd,
    'supplier_cost_currency', b.supplier_cost_currency,
    'sale_price_usd', b.sale_price_usd,
    'sale_price_syp', b.sale_price_syp,
    'catalog_visible', b.catalog_visible,
    'purchase_enabled', b.purchase_enabled
  ),
  jsonb_build_object(
    'supplier_cost_syp', case b.product_code
      when 'LEO_FREEFIRE_DIAMONDS_110' then 147
      when 'LEO_FREEFIRE_DIAMONDS_210' then 293
      when 'LEO_FREEFIRE_DIAMONDS_583' then 727
      when 'LEO_FREEFIRE_DIAMONDS_1188' then 1483
      when 'LEO_FREEFIRE_DIAMONDS_2420' then 2906 end,
    'sale_price_syp', case b.product_code
      when 'LEO_FREEFIRE_DIAMONDS_110' then 160
      when 'LEO_FREEFIRE_DIAMONDS_210' then 310
      when 'LEO_FREEFIRE_DIAMONDS_583' then 790
      when 'LEO_FREEFIRE_DIAMONDS_1188' then 1595
      when 'LEO_FREEFIRE_DIAMONDS_2420' then 3165 end,
    'usd_syp_rate', 156,
    'catalog_visible', false,
    'purchase_enabled', false
  )
from baro_ff_price_before b;

do $$
begin
  if (select count(*) from public.leo_manual_products
      where product_code in (
        'LEO_FREEFIRE_DIAMONDS_110','LEO_FREEFIRE_DIAMONDS_210',
        'LEO_FREEFIRE_DIAMONDS_583','LEO_FREEFIRE_DIAMONDS_1188',
        'LEO_FREEFIRE_DIAMONDS_2420'
      )
      and catalog_visible = false and purchase_enabled = false) <> 5 then
    raise exception 'All five Free Fire diamond products must remain hidden and non-purchasable.';
  end if;

  if exists (select 1 from public.baro_manual_settings where id='main' and enabled is distinct from false) then
    raise exception 'BARO intake must remain disabled.';
  end if;
end $$;

commit;
