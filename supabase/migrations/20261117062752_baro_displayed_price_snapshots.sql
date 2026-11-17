-- Capture the exact prices shown to the customer when a BARO manual order is created.
alter table public.leo_manual_orders
  add column if not exists displayed_price_usd_snapshot numeric(20,6),
  add column if not exists displayed_price_syp_snapshot numeric(20,2),
  add column if not exists displayed_price_captured_at timestamptz;
