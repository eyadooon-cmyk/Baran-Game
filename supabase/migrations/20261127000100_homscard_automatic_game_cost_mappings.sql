-- Preserve HomsCard unit-cost precision and seed only verified automatic game mappings.
-- This migration does not enable supplier execution or change customer selling prices.
alter table public.supplier_products
  alter column unit_cost type numeric(20,8)
  using unit_cost::numeric(20,8);

with mapping(product_code, supplier_sku, unit_cost) as (
  values
    ('PUBG_MOBILE_60_UC', '78', 0.94281462::numeric),
    ('PUBG_MOBILE_325_UC', '79', 4.71407310::numeric),
    ('PUBG_MOBILE_660_UC', '80', 9.47938613::numeric),
    ('PUBG_MOBILE_1800_UC', '81', 23.57036550::numeric),
    ('PUBG_MOBILE_3850_UC', '82', 47.14073100::numeric),
    ('PUBG_MOBILE_8100_UC', '83', 94.28146200::numeric),
    ('FREEFIRE_ROBOT_110', '95', 0.96652641::numeric),
    ('FREEFIRE_ROBOT_210', '96', 1.95406427::numeric),
    ('FREEFIRE_ROBOT_583', '92', 4.88516065::numeric),
    ('FREEFIRE_ROBOT_1188', '93', 9.58785746::numeric),
    ('FREEFIRE_ROBOT_2420', '94', 19.17571491::numeric),
    ('FREEFIRE_ROBOT_MEMBERSHIP_WEEKLY', '483', 2.05984499::numeric),
    ('JAWAKER_BOOSTER_RED', '89', 1.62481803::numeric),
    ('JAWAKER_BOOSTER_BLUE', '90', 8.38190891::numeric),
    ('JAWAKER_BOOSTER_BLACK', '91', 15.66711947::numeric),
    ('JAWAKER_BOOSTER_GOLD', '649', 25.63261876::numeric)
)
insert into public.supplier_products (
  supplier_id, product_id, supplier_sku, unit_cost, currency, is_preferred, notes
)
select
  s.id,
  p.id,
  m.supplier_sku,
  m.unit_cost,
  'USD',
  true,
  'Verified HomsCard catalog match; read-only cost mapping. Supplier execution remains disabled.'
from mapping m
join public.suppliers s on s.name = 'HomsCard'
join public.products p on p.product_code = m.product_code
where p.category = 'game' and p.is_active
on conflict (supplier_id, product_id) do update
set supplier_sku = excluded.supplier_sku,
    unit_cost = excluded.unit_cost,
    currency = excluded.currency,
    is_preferred = true,
    notes = excluded.notes,
    updated_at = now();


-- Consolidate Jawaker tokens into one HomsCard product; server splitting belonged to a previous supplier.
update public.products
set product_code = 'JAWAKER_TOKENS',
    name = 'جواكر — توكنز',
    description = 'شحن توكنز جواكر عبر Player ID. الكمية المتاحة لدى HomsCard من 10000 إلى 10000000 توكن.',
    updated_at = now()
where product_code = 'JAWAKER_TOKENS_SERVER_1';

update public.products
set is_active = false,
    description = 'منتج مكرر قديم خاص بتقسيم سيرفرات مورد سابق؛ تم إيقافه واعتماد منتج جواكر الموحد المرتبط بـ HomsCard.',
    updated_at = now()
where product_code = 'JAWAKER_TOKENS_SERVER_2';

with token_mapping as (
  select s.id as supplier_id, p.id as product_id
  from public.suppliers s
  join public.products p on p.product_code = 'JAWAKER_TOKENS'
  where s.name = 'HomsCard' and p.is_active
)
insert into public.supplier_products (
  supplier_id, product_id, supplier_sku, unit_cost, currency, is_preferred, notes
)
select supplier_id, product_id, '865', 0.00010693::numeric, 'USD', true,
       'Verified HomsCard quantity product; cost per token in USD; Player ID only; quantity range 10000–10000000. Read-only mapping; execution remains disabled.'
from token_mapping
on conflict (supplier_id, product_id) do update
set supplier_sku = excluded.supplier_sku,
    unit_cost = excluded.unit_cost,
    currency = excluded.currency,
    is_preferred = true,
    notes = excluded.notes,
    updated_at = now();

update public.supplier_products sp
set is_preferred = (sp.supplier_id = (select id from public.suppliers where name = 'HomsCard')),
    updated_at = now()
where sp.product_id in (
  select id from public.products
  where is_active and (
    product_code like 'PUBG_MOBILE_%'
    or product_code like 'FREEFIRE_ROBOT_%'
    or product_code like 'JAWAKER_%'
  )
);

update public.supplier_products sp
set is_preferred = false,
    notes = 'Legacy duplicate for former server split; unified product JAWAKER_TOKENS is the active HomsCard mapping.',
    updated_at = now()
where sp.product_id = (
  select id from public.products where product_code = 'JAWAKER_TOKENS_SERVER_2'
);
