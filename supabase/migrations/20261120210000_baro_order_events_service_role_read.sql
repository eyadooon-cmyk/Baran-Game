-- The BARO admin Edge Function uses the service_role client to read order events.
-- Keep this table private to privileged server-side code; do not grant access to anon/authenticated.
grant select on table public.leo_manual_order_events to service_role;
