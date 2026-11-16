# BARAN GAME — Test Environment Hardening (2026-11-16)

## Scope and safety boundary

- All database and Edge Function changes in this report were applied only to the isolated Baran-Restore-Test Supabase project (`tjvuqgcyvbowyfenrpau`).
- The production Supabase project was inspected read-only to compare known-good function implementations. No production database, function, secret, payment provider, supplier, or customer data was changed.
- This work is on branch `test-hardening-20261116`. It has not been merged into `main` and does not deploy the GitHub Pages frontend.
- No purchase, wallet debit, deposit approval, refund, supplier order, ShamCash transaction, or external supplier connection was executed.

## Database changes applied

1. Restricted `public.admin_monitor_snapshot(uuid)` to `service_role`.
2. Added explicit deny-all RLS policies for `anon` and `authenticated` on:
   - `public.leo_manual_products`
   - `public.leo_manual_orders`
   - `public.leo_manual_order_events`
3. Restored the read-only `baran_order_preflight` and `baran_admin_catalog_readiness` SECURITY DEFINER functions, with EXECUTE granted only to `service_role`.
   - Preflight always returns `can_create_order=false`, `can_purchase=false`, `charged=false`, and `order_created=false`.
   - Catalog readiness always reports `launch_ready_products=0` and `fulfillment_gate_open=false`.
4. Restricted `private.run_baran_monitor()` to server execution and scheduled a database-only monitoring run every 15 minutes.
5. Added indexes for the two previously uncovered Baro foreign keys:
   - `leo_manual_order_events(actor_id)`
   - `leo_manual_orders(product_code)`
6. Moved `baran_owner_wallet_gateway` behind the JWT-verified, owner-only `baran-owner-wallet` Edge Function. The RPC itself is now service-role-only.
7. Granted only the minimum table privileges required by the automatic support worker:
   - `baran_auto_support_queue`: SELECT, UPDATE
   - `customer_feedback`: SELECT, UPDATE
   - `baran_notifications`: INSERT
8. Scheduled the secret-gated automatic support worker every five minutes. The cron command reads its token from the private database table at run time; the token is not embedded in this repository or cron command.

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
- Security Advisor now reports only the leaked-password protection warning.
- Health Advisor reports no findings.
- The monitoring function was run manually and returned a read-only snapshot with zero stale orders, zero stale deposits, zero open support tickets, and zero open orders missing supplier cost.
- The monitoring cron job is active every 15 minutes.
- The automatic support worker was invoked through `pg_net` in both dry-run and normal mode. Both HTTP requests returned 200 with `processed=0`, because the test queue is empty.
- The automatic support cron job is active every five minutes.
- Order preflight was exercised against an active test catalogue product. It returned `mode=preflight_only`, `charged=false`, and `order_created=false`. The result also showed that product price and supplier readiness are not yet approved.
- The test catalogue currently contains 17 products and reports zero launch-ready products.
- The two uncovered Baro foreign-key indexes were added. Remaining performance INFO findings relate to unused indexes and old backup tables without primary keys; backup tables were deliberately left untouched.

## Remaining blockers — do not treat this project as launch-ready

1. **Leaked-password protection:** still disabled. Supabase documents this as a Dashboard Auth setting and notes availability on Pro plans and above. It must be enabled in the project's Auth settings when the plan supports it.
2. **Push notifications:** the push registration and dispatch functions have not been deployed to this test project because VAPID/webhook secrets have not been verified here. Do not claim push delivery is tested.
3. **Game ID validation:** PUBG/Free Fire checker functions are not deployed here because the required Volsever API secret has not been verified in this test project.
4. **Supplier integration:** supplier manager and external supplier catalog functions remain intentionally undeployed. Supplier credentials and a real supplier integration test are still required.
5. **ShamCash:** registration, verification, and webhook functions remain intentionally undeployed. No payment provider has been connected or activated.
6. **UI acceptance testing:** a real owner/admin session and a normal customer session must still test the frontend flows on a phone. In particular, verify admin access succeeds, a customer is denied, safe admin changes are audited, support replies appear correctly, and the wallet UI reaches only the owner-only Edge Function.
7. **OpenAI key availability in the test project:** the automatic support worker's empty-queue path passed. A real safe support ticket has not been submitted, so OpenAI reply generation and customer-facing delivery have not yet been verified.
8. **Frontend deployment:** this branch is not merged into `main`; the GitHub Pages site has not been changed by this work.

## Release rule

Keep purchasing and fulfillment disabled until supplier execution, result verification, idempotency, refund handling, payment-provider verification, and real owner/customer UI acceptance tests are completed.
