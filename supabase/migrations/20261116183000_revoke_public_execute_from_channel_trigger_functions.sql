-- Keep trigger-only SECURITY DEFINER functions inaccessible through the public Data API.
-- PostgreSQL checks EXECUTE when the trigger is created; triggers continue to invoke these functions.
revoke all on function public.baran_guard_manual_order_insert() from public, anon, authenticated;
revoke all on function public.baran_link_manual_order_channel() from public, anon, authenticated;
revoke all on function public.baran_sync_manual_order_guard_status() from public, anon, authenticated;

-- Apply the same least-privilege rule to the separate automatic-order guard triggers.
revoke all on function public.baran_guard_automatic_order_insert() from public, anon, authenticated;
revoke all on function public.baran_link_automatic_order_channel() from public, anon, authenticated;
revoke all on function public.baran_sync_automatic_order_guard_status() from public, anon, authenticated;
