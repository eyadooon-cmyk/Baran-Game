-- Let each signed-in customer read only their own VIP flag.
-- No customer can read other VIP rows or update/delete VIP status.
grant select (is_vip) on table public.customer_vip_tags to authenticated;
create policy "Customers can read their own VIP flag"
  on public.customer_vip_tags
  for select
  to authenticated
  using ((select auth.uid()) = user_id);
