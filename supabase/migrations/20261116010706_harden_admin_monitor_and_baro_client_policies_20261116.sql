REVOKE ALL ON FUNCTION public.admin_monitor_snapshot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_monitor_snapshot(uuid) TO service_role;

CREATE POLICY leo_manual_products_deny_client_access
ON public.leo_manual_products FOR ALL TO anon, authenticated
USING (false) WITH CHECK (false);

CREATE POLICY leo_manual_orders_deny_client_access
ON public.leo_manual_orders FOR ALL TO anon, authenticated
USING (false) WITH CHECK (false);

CREATE POLICY leo_manual_order_events_deny_client_access
ON public.leo_manual_order_events FOR ALL TO anon, authenticated
USING (false) WITH CHECK (false);
