CREATE INDEX IF NOT EXISTS leo_manual_order_events_actor_id_idx
ON public.leo_manual_order_events(actor_id);

CREATE INDEX IF NOT EXISTS leo_manual_orders_product_code_idx
ON public.leo_manual_orders(product_code);
