-- Prepare the agreed Free Fire BARO price list for admin review only.
-- This migration is intentionally safe: BARO global intake stays OFF and every
-- Free Fire product remains hidden and non-purchasable. No orders or finance
-- entries are created by preparing catalogue prices.

do $$
begin
  if not exists (
    select 1 from public.baro_manual_settings where id = 'main'
  ) then
    raise exception 'BARO settings row is missing; refusing to prepare prices.';
  end if;
end $$;

update public.baro_manual_settings
set enabled = false,
    usd_syp_rate = 156,
    default_currency = 'SYP',
    updated_at = now()
where id = 'main';

with input(product_code, cost_syp, sale_syp, note) as (
  values
    ('LEO_FREEFIRE_DIAMONDS_110', 147::numeric, null::numeric,
      'تكلفة ليو 147 ليرة جديدة؛ سعر البيع غير معتمد بعد.'),
    ('LEO_FREEFIRE_DIAMONDS_210', 293::numeric, 310::numeric,
      'تكلفة ليو 293 ليرة جديدة؛ سعر البيع المعتمد بالدراسة 310.'),
    ('LEO_FREEFIRE_DIAMONDS_583', 727::numeric, 790::numeric,
      'تكلفة ليو 727 ليرة جديدة؛ سعر البيع المعتمد بالدراسة 790.'),
    ('LEO_FREEFIRE_DIAMONDS_1188', 1483::numeric, 1595::numeric,
      'تكلفة ليو 1483 ليرة جديدة؛ سعر البيع المعتمد بالدراسة 1595.'),
    ('LEO_FREEFIRE_DIAMONDS_2420', 2906::numeric, 3165::numeric,
      'تكلفة ليو 2906 ليرة جديدة؛ سعر البيع المعتمد بالدراسة 3165.')
),
before_rows as materialized (
  select p.product_code, p.supplier_cost_usd, p.supplier_cost_currency,
         p.sale_price_usd, p.sale_price_syp, p.catalog_visible,
         p.purchase_enabled, p.admin_notes, i.cost_syp, i.sale_syp, i.note
  from public.leo_manual_products p
  join input i using (product_code)
),
updated as (
  update public.leo_manual_products p
  set supplier_cost_usd = round(i.cost_syp / 156, 4),
      supplier_cost_currency = 'SYP',
      sale_price_usd = case when i.sale_syp is null then null
                            else round(i.sale_syp / 156, 4) end,
      sale_price_syp = i.sale_syp,
      catalog_visible = false,
      purchase_enabled = false,
      admin_notes = i.note || ' سعر الصرف المرجعي: 156 ليرة جديدة لكل دولار. بيانات داخلية للإدارة فقط.',
      updated_at = now()
  from input i
  where p.product_code = i.product_code
  returning p.product_code
),
history_rows as (
  insert into public.baro_manual_product_price_history
    (product_code, changed_by, previous_values, new_values)
  select b.product_code, null,
    jsonb_build_object(
      'supplier_cost_usd_equivalent', b.supplier_cost_usd,
      'supplier_cost_currency', b.supplier_cost_currency,
      'sale_price_usd', b.sale_price_usd,
      'sale_price_syp', b.sale_price_syp,
      'catalog_visible', b.catalog_visible,
      'purchase_enabled', b.purchase_enabled
    ),
    jsonb_build_object(
      'supplier_cost_syp', b.cost_syp,
      'supplier_cost_usd_equivalent', round(b.cost_syp / 156, 4),
      'supplier_cost_currency', 'SYP',
      'sale_price_syp', b.sale_syp,
      'sale_price_usd', case when b.sale_syp is null then null
                             else round(b.sale_syp / 156, 4) end,
      'catalog_visible', false,
      'purchase_enabled', false,
      'supplier_source_note', b.note,
      'usd_syp_rate', 156
    )
  from before_rows b
  returning id
)
select
  (select count(*) from updated) as products_prepared,
  (select count(*) from history_rows) as price_history_rows;

-- Explicit final safety assertion: never leave BARO or any Free Fire item open.
do $$
begin
  if exists (select 1 from public.baro_manual_settings where id='main' and enabled is distinct from false) then
    raise exception 'BARO intake must remain disabled.';
  end if;
  if exists (
    select 1 from public.leo_manual_products
    where category_id='freefire' and (catalog_visible is true or purchase_enabled is true)
  ) then
    raise exception 'Free Fire products must remain hidden and non-purchasable.';
  end if;
end $$;
