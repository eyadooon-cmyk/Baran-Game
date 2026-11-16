-- Remove the obsolete order-update RPC after the Edge Function legacy action was disabled.
-- All order changes now use baro_manual_order_admin_update_atomic.
drop function if exists public.baro_manual_order_update_atomic(uuid,uuid,text,numeric,text,text,text);
