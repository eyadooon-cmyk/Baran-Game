begin;

with changed as (
  update public.leo_manual_products
     set catalog_visible = true,
         purchase_enabled = false,
         updated_at = now()
   where category_id = 'freefire'
     and group_id = 'diamonds'
     and product_code in (
       'LEO_FREEFIRE_DIAMONDS_110',
       'LEO_FREEFIRE_DIAMONDS_210',
       'LEO_FREEFIRE_DIAMONDS_583',
       'LEO_FREEFIRE_DIAMONDS_1188',
       'LEO_FREEFIRE_DIAMONDS_2420'
     )
     and (catalog_visible is distinct from true or purchase_enabled is distinct from false)
  returning product_code,
            jsonb_build_object('catalog_visible', false, 'purchase_enabled', false) as previous_values,
            jsonb_build_object('catalog_visible', catalog_visible, 'purchase_enabled', purchase_enabled,
                               'sale_price_syp', sale_price_syp) as new_values
)
insert into public.baro_manual_product_price_history
  (product_code, changed_by, previous_values, new_values)
select product_code, null, previous_values, new_values
from changed;

update public.leo_manual_products
   set catalog_visible = false,
       purchase_enabled = false,
       updated_at = now()
 where category_id = 'freefire'
   and group_id = 'memberships'
   and (catalog_visible is distinct from false or purchase_enabled is distinct from false);

do $$
declare
  visible_diamonds integer;
  orderable_diamonds integer;
  visible_memberships integer;
  manual_enabled boolean;
begin
  select count(*) into visible_diamonds
    from public.leo_manual_products
   where category_id='freefire' and group_id='diamonds'
     and product_code in (
       'LEO_FREEFIRE_DIAMONDS_110','LEO_FREEFIRE_DIAMONDS_210',
       'LEO_FREEFIRE_DIAMONDS_583','LEO_FREEFIRE_DIAMONDS_1188',
       'LEO_FREEFIRE_DIAMONDS_2420'
     ) and catalog_visible = true;
  select count(*) into orderable_diamonds
    from public.leo_manual_products
   where category_id='freefire' and group_id='diamonds'
     and product_code in (
       'LEO_FREEFIRE_DIAMONDS_110','LEO_FREEFIRE_DIAMONDS_210',
       'LEO_FREEFIRE_DIAMONDS_583','LEO_FREEFIRE_DIAMONDS_1188',
       'LEO_FREEFIRE_DIAMONDS_2420'
     ) and purchase_enabled = true;
  select count(*) into visible_memberships
    from public.leo_manual_products
   where category_id='freefire' and group_id='memberships'
     and catalog_visible = true;
  select enabled into manual_enabled
    from public.baro_manual_settings where id='main';

  if visible_diamonds <> 5 or orderable_diamonds <> 0
     or visible_memberships <> 0 or coalesce(manual_enabled,false) is not false then
    raise exception 'Free Fire catalogue safety assertion failed';
  end if;
end $$;

commit;
