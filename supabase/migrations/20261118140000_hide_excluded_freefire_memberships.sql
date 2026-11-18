-- Keep all Free Fire memberships out of the customer-facing BARO preview.
-- The weekly membership is excluded from the current approved catalogue.
-- Diamonds remain hidden pending a separate decision to display them.
begin;

with before_rows as (
  select product_code, catalog_visible, purchase_enabled, supplier_cost_usd,
         supplier_cost_currency, sale_price_usd, sale_price_syp
  from public.leo_manual_products
  where category_id = 'freefire'
    and group_id = 'memberships'
    and (catalog_visible is distinct from false or purchase_enabled is distinct from false)
),
updated as (
  update public.leo_manual_products p
  set catalog_visible = false,
      purchase_enabled = false,
      updated_at = now()
  from before_rows b
  where p.product_code = b.product_code
  returning p.product_code
)
insert into public.baro_manual_product_price_history
  (product_code, changed_by, previous_values, new_values)
select b.product_code, null,
  jsonb_build_object(
    'catalog_visible', b.catalog_visible,
    'purchase_enabled', b.purchase_enabled,
    'supplier_cost_usd', b.supplier_cost_usd,
    'supplier_cost_currency', b.supplier_cost_currency,
    'sale_price_usd', b.sale_price_usd,
    'sale_price_syp', b.sale_price_syp
  ),
  jsonb_build_object(
    'catalog_visible', false,
    'purchase_enabled', false,
    'reason', 'Hide excluded Free Fire memberships from customer BARO preview'
  )
from before_rows b
join updated u using (product_code);

do $$
begin
  if exists (
    select 1 from public.leo_manual_products
    where category_id = 'freefire'
      and group_id = 'memberships'
      and (catalog_visible is distinct from false or purchase_enabled is distinct from false)
  ) then
    raise exception 'Free Fire memberships must remain hidden and non-purchasable.';
  end if;
end $$;

commit;
