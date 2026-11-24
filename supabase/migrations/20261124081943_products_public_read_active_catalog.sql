-- Allow signed-out visitors to browse active storefront products only.
-- The products table contains public catalog fields; no order, wallet, or supplier data is stored here.
grant select on table public.products to anon;

create policy products_public_read_active_catalog
on public.products
for select
to anon
using (is_active = true);
