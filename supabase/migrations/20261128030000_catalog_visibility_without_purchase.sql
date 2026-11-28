-- Separate public catalog visibility from purchase activation.
-- HomsCard recovered products can be displayed with prices while remaining non-orderable.
alter table public.products
  add column if not exists catalog_visible boolean not null default false;

update public.products
   set catalog_visible = true,
       updated_at = now()
 where product_code like 'HOMSCARD_GAME_%';

drop policy if exists products_public_read_active_catalog on public.products;
create policy products_public_read_active_catalog
  on public.products
  for select
  to anon
  using (is_active = true or catalog_visible = true);

drop policy if exists products_read_active_catalog on public.products;
create policy products_read_active_catalog
  on public.products
  for select
  to authenticated
  using (is_active = true or catalog_visible = true);

grant select on table public.products to anon, authenticated;
