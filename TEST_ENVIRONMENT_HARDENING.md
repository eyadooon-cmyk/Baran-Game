# BARAN GAME — Test Environment Hardening (2026-11-16)

## Scope and safety boundary

- All database and Edge Function changes in this report were applied only to the isolated Baran-Restore-Test Supabase project (`tjvuqgcyvbowyfenrpau`).
- The production Supabase project was inspected read-only. No production database, function, secret, payment provider, supplier, or customer data was changed.
- This work is on branch `test-hardening-20261116`. It has not been merged into `main` and does not deploy the GitHub Pages frontend.
- No purchase, wallet debit, deposit approval, refund, supplier order, ShamCash transaction, or external supplier connection was executed.
- No Supabase plan upgrade is authorized or required for this test work. Keep the current plan; do not upgrade to Pro.

## Mandatory system separation

The project contains two distinct business systems and they must remain independent:

1. **BARO LEO manual fulfillment** — the manual product/order workflow represented by `leo_manual_products`, `leo_manual_orders`, and `leo_manual_order_events`. It must continue to operate independently of external supplier availability and supplier order APIs.
2. **Syria Market supplier system** — supplier registry/catalog/integration workflows (including `suppliers`, `supplier_products`, and private supplier configuration/event/attempt tables). This is a separate future integration track. Supplier ordering and automation remain deferred until separately approved and tested.

Do not merge their product catalogs, order state machines, execution paths, permissions, or financial actions. A future supplier integration must not become a hidden dependency of BARO LEO manual orders. Keep separate endpoints, authorization checks, audit trails, and enablement gates.

## Database changes applied

1. Restricted `public.admin_monitor_snapshot(uuid)` to `service_role`.
2. Added explicit deny-all RLS policies for `anon` and `authenticated` on:
   - `public.leo_manual_products`
   - `public.leo_manual_orders`
   - `public.leo_manual_order_events`
3. Restored the read-only `baran_order_preflight` and `baran_admin_catalog_readiness` SECURITY DEFINER functions, with EXECUTE granted only to `service_role`.
   - Preflight always returns `can_create_order=false`, `can_purchase=false`, `charged=false`, and `order_created=false`.
   - Catalog readiness always reports `launch_ready_products=0` and `fulfillment_gate_open=false`.
4. Restricted `private.run_baran_monitor()` to server execution and scheduled a database-only monitoring run every 15 minutes. **The schedule row is active, but actual execution is currently blocked by the pg_cron run-id sequence mismatch described below.**
5. Added indexes for the two previously uncovered Baro foreign keys:
   - `leo_manual_order_events(actor_id)`
   - `leo_manual_orders(product_code)`
6. Moved `baran_owner_wallet_gateway` behind the JWT-verified, owner-only `baran-owner-wallet` Edge Function. The RPC itself is now service-role-only.
7. Granted only the minimum table privileges required by the automatic support worker:
   - `baran_auto_support_queue`: SELECT, UPDATE
   - `customer_feedback`: SELECT, UPDATE
   - `baran_notifications`: INSERT
8. Scheduled the secret-gated automatic support worker every five minutes. The cron command reads its token from the private database table at run time; the token is not embedded in this repository or cron command. **The schedule row is active, but actual scheduled execution is currently blocked by the pg_cron run-id sequence mismatch described below.**

## Edge Functions deployed to the test project

All are ACTIVE. JWT verification is enabled except for the automatic support worker, which authenticates using its private cron token and the database verification RPC.

- `baran-leo-manual`
- `baran-baro-manual`
- `baran-admin`
- `baran-admin-assistant`
- `baran-admin-work-plan`
- `baran-admin-monitor`
- `baran-admin-safe-actions`
- `baran-admin-offline`
- `baran-moderator-assistant`
- `baran-staff-portal`
- `baran-ai-usage-stats`
- `baran-order-gateway`
- `baran-assistant`
- `baran-product-assistant`
- `baran-owner-wallet`
- `baran-auto-support-reply` (custom secret authentication; `verify_jwt=false` by design)

## Verification performed

- RLS is enabled on all 43 tables in the `public` and `private` schemas; no RLS-enabled table in those schemas is left without a policy.
- No SECURITY DEFINER function in `public` or `private` is executable by `anon` or `authenticated`.
- Security Advisor reports only the leaked-password protection warning. This setting requires a Pro plan according to the current project warning/docs; **do not upgrade**. Record as a plan limitation and use the protections available on the current plan.
- Health Advisor reports no findings.
- The monitoring function was run manually and returned a read-only snapshot with zero stale orders, zero stale deposits, zero open support tickets, and zero open orders missing supplier cost.
- The monitoring cron job is configured and active every 15 minutes, but is **not currently executing**.
- The automatic support worker was invoked manually through `pg_net` in both dry-run and normal mode. Those HTTP requests returned 200 with `processed=0`, because the test queue was empty. This proves the function's empty-queue HTTP path only; it does not prove scheduled execution or real customer reply delivery.
- Order preflight was exercised against an active test catalogue product. It returned `mode=preflight_only`, `charged=false`, and `order_created=false`. The result also showed that product price and supplier readiness are not yet approved.
- The test catalogue currently contains 17 products and reports zero launch-ready products.
- The two uncovered Baro foreign-key indexes were added. Remaining performance INFO findings relate to unused indexes and old backup tables without primary keys; backup tables were deliberately left untouched.

## Critical current blocker — pg_cron sequence drift

Observed on 2026-11-16 in the test project:

- Both scheduled jobs remain marked active:
  - `baran-auto-support-worker` — every 5 minutes.
  - `baran-game-admin-monitor-15m` — every 15 minutes.
- The most recent recorded cron runs are still from 2026-11-11; there have been no new `cron.job_run_details` rows in the last 24 hours.
- PostgreSQL logs show the pg_cron launcher repeatedly exiting after:
  `duplicate key value violates unique constraint "job_run_details_pkey"`.
- `cron.job_run_details` has max `runid=7918`, while `cron.runid_seq` reports `last_value=2` (called=true). The sequence owner is `supabase_admin`.
- Attempts to synchronize the sequence with `setval` through both `execute_sql` and `apply_migration` were rejected with `permission denied for sequence runid_seq`.
- Do not change sequence ownership, bypass Supabase-managed permissions, or repeatedly retry SQL. Escalate this precise pg_cron internal sequence mismatch to Supabase support or use a Supabase-provided administrative repair. Recheck cron run history and launcher logs after repair before declaring the schedules operational.

## Newly confirmed separation gap — legacy admin APIs

A read-only review of the current `main` branch source found that the legacy `baran-admin` dashboard API returns supplier records, supplier-product mappings, general `orders`, and `order_fulfillment` in the same response as the general store administration data. The `baran-admin-safe-actions` source also contains mutation paths for supplier records, supplier-product links, and general order status. These are not the dedicated `leo_manual_*` tables.

This does **not** prove that BARO LEO manual orders currently call those legacy paths, but it means the codebase still has a shared legacy admin surface and the architectural separation is not yet fully demonstrated. Do not claim full end-to-end separation until:
- BARO LEO manual UI reads and writes only through its dedicated manual endpoint and `leo_manual_*` tables.
- Syria Market supplier management has a separate endpoint, permissions, and audit path.
- The legacy combined admin API is either split safely or explicitly prevented from managing either new system's data.
- Owner and customer UI acceptance tests confirm the separation.

No source code or live function was changed as part of this read-only finding.

## Remaining blockers — do not treat this project as launch-ready

1. **Leaked-password protection:** disabled and unavailable under the current plan per the project warning. Do not upgrade. Keep this as a documented plan limitation and apply the available password/session protections.
2. **pg_cron:** scheduled worker and monitor are not executing due to the run-id sequence mismatch above.
3. **System separation:** legacy `baran-admin` and `baran-admin-safe-actions` still expose shared supplier/general-order administration paths; dedicated BARO LEO end-to-end isolation has not yet been proven.
4. **Push notifications:** push registration and dispatch functions have not been deployed to this test project because VAPID/webhook secrets have not been verified here. Do not claim push delivery is tested.
5. **Game ID validation:** PUBG/Free Fire checker functions are not deployed here because the required Volsever API secret has not been verified in this test project.
6. **Supplier integration:** Syria Market supplier automation is a separate future system. Supplier manager and external supplier catalog functions remain intentionally undeployed. Supplier credentials and a separately approved supplier integration test are still required.
7. **ShamCash:** registration, verification, and webhook functions remain intentionally undeployed. No payment provider has been connected or activated.
8. **UI acceptance testing:** a real owner/admin session and a normal customer session must still test the frontend flows on a phone. In particular, verify admin access succeeds, a customer is denied, safe admin changes are audited, support replies appear correctly, and the wallet UI reaches only the owner-only Edge Function.
9. **OpenAI key availability in the test project:** the automatic support worker's empty-queue path passed. A real safe support ticket has not been submitted, so OpenAI reply generation and customer-facing delivery have not yet been verified.
10. **Frontend deployment:** this branch is not merged into `main`; the GitHub Pages site has not been changed by this work.

## Release rule

Keep BARO LEO manual fulfillment and Syria Market supplier integration separate. Keep purchasing, wallet debits, and fulfillment disabled until the relevant system has its own successful owner/customer UI acceptance tests, idempotency checks, audit verification, and enablement approval. Supplier execution, payment-provider verification, refund handling, and external integrations must be tested independently before they are enabled.
