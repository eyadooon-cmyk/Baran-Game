-- Validate existing fulfillment rows against safety constraints after a zero-violation audit.
alter table public.order_fulfillment
  validate constraint order_fulfillment_dispatch_attempt_count_check;
alter table public.order_fulfillment
  validate constraint order_fulfillment_dispatch_state_check;
alter table public.order_fulfillment
  validate constraint order_fulfillment_refund_status_check;
