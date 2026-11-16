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


## Additional UI/source inventory check — 2026-11-16

A read-only inventory of the complete Git tree at commit `9178877a48c8a040b5b6765f8a9c3565417cc905` and inspection of the current frontend files found:

- The repository tree contains no tracked frontend page or Edge Function source directory named `baran-leo-manual` or `baran-baro-manual`. The test project has deployed functions with those names, but their deployed source is not represented in this branch's tracked tree. This makes the manual workflow difficult to reproduce and review from Git.
- The tracked `manage-products.html` calls the legacy `baran-admin` endpoint for product listing and writes.
- The tracked `admin-operations.js` renders supplier records and supplier fulfillment controls alongside general order administration, and calls the legacy admin API for these operations.
- The tracked `baran-ai-control-center.html` includes a supplier-analysis action that calls `baran-supplier-manager`; this is a legacy combined administration surface, not proof of an isolated Syria Market supplier application.

This inventory strengthens the earlier finding that end-to-end separation is not yet demonstrated. Do not infer that the deployed manual functions are absent from the test project; the finding is specifically that their source and a dedicated manual UI are not tracked in this repository branch. Before any UI acceptance test or release, obtain and review the exact deployed manual function sources, add reproducible source to a dedicated branch, and confirm the frontend's manual workflow calls only the manual endpoint and `leo_manual_*` tables. Keep supplier-management pages and endpoints separate. No source code, database, deployment, or production resource was changed during this inventory check.


## Manual workflow endpoint audit — 2026-11-16

Read-only inspection of the deployed test-project Edge Functions and frontend source established the following:

- `baran-leo-manual` is ACTIVE (version 1, `verify_jwt=true`). It authenticates the user, checks `admin_is_user`, and reads/writes `leo_manual_products`, `leo_manual_orders`, `leo_manual_order_events`, and `admin_audit_log`. Its product/order updates use direct table updates followed by separate audit/event inserts, rather than the atomic RPCs. If the primary update succeeds but a subsequent audit insert fails, the endpoint can return an error after the data change has already occurred. This endpoint should not be used for further edits until reviewed/replaced by the atomic path.
- `baran-baro-manual` is ACTIVE (version 2, `verify_jwt=true`). It also reads the same `leo_manual_products` and `leo_manual_orders` tables, but sends product/order changes through `baro_manual_product_update_atomic` and `baro_manual_order_update_atomic`. Those SQL functions update the `leo_manual_*` records and their audit/event records in one database transaction. They explicitly return `purchase_enabled=false` / `finance_posted=false` / `wallet_changed=false`.
- The two deployed manual endpoints are therefore not separate data systems: both point at the same `leo_manual_*` data. The names alone must not be treated as evidence of two isolated manual systems.
- Neither `baran-leo-manual` nor `baran-baro-manual` appears in the tracked `index.html` frontend source. The inspected customer-facing game/service catalogue only loads active products for display and selection; its selection note says it does not create an order or debit a balance. The tracked customer order page reads the general `orders` table, not `leo_manual_orders`. The frontend currently has no demonstrated end-to-end customer submission flow into the manual order tables.
- The tracked admin dashboard continues to use the legacy `baran-admin` endpoint, which combines supplier records, supplier-product links, general orders, and fulfillment records in one response. The supplier section in `index.html` includes Syria Market catalogue reads, supplier AI, catalogue readiness, and order preflight. These are visibly grouped inside the same admin shell, not an independently navigable Syria Market application.
- Read-only test-project counts at the time of inspection: `leo_manual_products=32`, `leo_manual_orders=0`, `leo_manual_order_events=0`, `suppliers=1`, `supplier_products=0`, `orders=0`, `order_fulfillment=0`. No test order or financial transaction was created.

### Required remediation before UI acceptance

1. Decide the single canonical manual endpoint and retire/disable the duplicate path only after dependency and rollback review. Prefer the atomic RPC-backed implementation; do not call the direct-update endpoint for writes.
2. Store the exact deployed function source for the canonical manual endpoint in Git, with reproducible deployment instructions and version/hash recorded.
3. Build or restore a dedicated mobile-first BARO LEO manual admin UI that calls only the canonical manual endpoint and operates only on `leo_manual_*` tables. Do not reuse the legacy supplier/general-order admin controls.
4. Keep Syria Market in a separate UI/API/permission boundary, with no shared mutation endpoint for supplier management and manual orders.
5. Add a customer manual-order preflight/read-only flow first. Do not create real manual orders, debit wallets, post finance, or send supplier requests during this phase.
6. Before any enablement, test owner/admin access, customer denial, manual product update + atomic audit, manual order status update + atomic event/audit, and verify that no supplier/general-order/finance/wallet tables are touched.

No source code, database records, deployed functions, schedules, or production resources were changed during this audit. Only this test-branch documentation is being updated.


## Recovery of deployed manual function sources — 2026-11-16

The two deployed test function sources have now been recovered verbatim into the test branch for review and reproducibility:

- `supabase/functions/baran-baro-manual/index.ts` — deployed version 2; source SHA-256 `b3749b3dcacec58a6cdc4bd30ad634b3392b20022f46e46da2a74d3ca7c1117c`.
- `supabase/functions/baran-leo-manual/index.ts` — deployed version 1; source SHA-256 `f50dd3e1c9e985a466dbcff34bdf66e0fdcdeffaefa1d7114ad44608488f90a8`.

These are source-recovery commits only; they do not deploy or change either function. The older `baran-leo-manual` endpoint remains deployed but must not be used for writes until its non-atomic update/audit behavior is resolved. The RPC-backed `baran-baro-manual` is the safer candidate for the canonical manual endpoint, but it is not yet connected to a dedicated frontend and has not been UI-acceptance tested. No endpoint has been disabled, no records have been modified, and no order or financial action has been performed.


## Isolated BARO LEO admin page prototype — 2026-11-16

Added `baro-leo-manual.html` to the test branch as a standalone, mobile-first admin page. It uses only the deployed `baran-baro-manual` endpoint for its data path:

- GET loads only the manual product and manual order datasets.
- Product price/cost/notes edits call the RPC-backed `product_update` action.
- Existing manual order status updates call the RPC-backed `order_update` action.
- The UI does not create orders, submit supplier requests, debit wallets, post finance, or call the legacy `baran-admin`, `baran-admin-safe-actions`, or Syria Market endpoints.
- The server-side endpoint still verifies the user's JWT and `admin_is_user`; hiding the page URL is not treated as an authorization control.

This is a branch-only prototype. It has not been deployed, linked from the production storefront, or tested in a live browser session. Do not merge it or expose it to customers yet. Before any UI acceptance, inspect the rendered page on a phone and verify admin access, customer denial, successful atomic audit behavior in a controlled test record, and absence of writes outside `leo_manual_*` plus the expected audit/event records. No manual order or financial transaction was created as part of this page work.


## Syria Market read-only boundary — 2026-11-16

Added a separate read-only Syria Market path in the test environment:

- New Edge Function source: `supabase/functions/baran-syria-market-read/index.ts`.
- Deployed test function: `baran-syria-market-read`, version 1, ACTIVE, `verify_jwt=true`, source SHA-256 `0ba68c724417dea52595580f31eeca12389de90ce7e04f4e53e3be5b4f000bcd`.
- New standalone mobile page: `syria-market-admin.html`.
- The endpoint independently validates the JWT and `admin_is_user`, and only reads `suppliers`, `supplier_products`, and the product catalogue fields needed for supplier mapping. It returns explicit `mode=read_only`, `writes_enabled=false`, `supplier_orders_enabled=false`, and `finance_enabled=false`.
- The page calls only `baran-syria-market-read`. It contains no calls to the legacy `baran-admin`, `baran-admin-safe-actions`, `baran-order-gateway`, or BARO manual endpoint. It provides no edit, purchase, or supplier-order controls.
- Current read-only counts after this work: `suppliers=1`, `supplier_products=0`, `orders=0`, `order_fulfillment=0`, `leo_manual_orders=0`. No rows were created or changed.

### Remaining separation gap

This is a new isolated read-only path, not yet a complete replacement of the legacy combined admin surface. The existing `index.html` still embeds supplier management, Syria Market catalogue reads, preflight, and supplier AI inside the general admin dashboard. The legacy `baran-admin` and `baran-admin-safe-actions` functions still contain combined customer, finance, supplier, and general-order capabilities. They have not been modified or disabled because dependencies and rollback have not yet been fully mapped.

Do not use the legacy supplier controls for ongoing work. Do not claim end-to-end isolation until the legacy supplier UI/API dependencies are removed or restricted after a dedicated regression review. The new page is branch-only and is not linked from the live storefront or deployed to GitHub Pages. Runtime acceptance using a real administrator session and a non-admin session remains pending; ACTIVE deployment status is not proof of successful browser authorization.

No production resources, database records, general orders, manual orders, wallets, supplier requests, or finance records were changed.


## Legacy supplier UI dependency map — 2026-11-16

A follow-up source inventory confirms the remaining shared surface:

- `index.html` embeds the supplier panel inside the general admin navigation. It includes supplier records, supplier-product links, supplier API configuration, Syria Market external catalogue reads, product/supplier preflight, Free Fire region checking, and Supplier Manager AI.
- `admin-operations.js` sends supplier mutations to the legacy `baran-admin` endpoint using actions `supplier_save`, `supplier_product_save`, `supplier_api_config_save`, `supplier_api_simulate`, and `order_fulfillment_update`. It also contains `supplier_order_refund`, which is a sensitive general-order/refund operation and must not be exposed in the independent Syria Market surface.
- `baran-admin` GET combines deposits, support, finance reports, products, suppliers, supplier-product links, general orders, fulfillment, loyalty, profiles, and notifications. Its POST handler also combines customer, finance, product, supplier, and general-order actions. This endpoint is unsuitable as the data source for either isolated subsystem.
- The legacy frontend calls `baran-syrimarket-catalog` and `baran-supplier-manager`; neither function appears in the current test project's deployed Edge Function inventory. Their runtime behavior therefore remains unverified in the test project. Do not reconnect them to the new page without recovering and reviewing their source.
- The standalone Syria Market page intentionally does not use these legacy functions. Its only endpoint is the new read-only `baran-syria-market-read`.

### Safe migration sequence

1. Keep the legacy combined dashboard untouched until every dependency and owner-facing workflow has a replacement.
2. Recover and review source for the missing supplier catalogue/AI functions before any reuse.
3. Create separate Syria Market write actions only after defining atomic audit behavior and explicit supplier-only permissions. Until then, the new page remains read-only.
4. Move legacy supplier controls out of the combined dashboard only after a regression matrix proves that customer support, wallet/finance, general order management, and manual BARO LEO screens remain functional and isolated.
5. Keep refund, wallet, payment, and general order actions outside Syria Market permanently.

No legacy endpoint or frontend control was removed or modified in this step. No supplier write, supplier order, refund, finance action, or wallet operation was performed.


## BARO LEO page-to-endpoint contract check — 2026-11-16

Reviewed the standalone `baro-leo-manual.html` against the deployed test `baran-baro-manual` source:

- Page GET expects `products`, `orders`, and `purchase_enabled`; the endpoint returns those exact fields.
- Product edits send `action=product_update` with `product_code`, `supplier_cost_usd`, `sale_price_usd`, `sale_price_syp`, and `admin_notes`; the endpoint accepts those exact keys and calls `baro_manual_product_update_atomic`.
- Existing order edits send `action=order_update` with `order_id`, `status`, `supplier_cost_usd`, `supplier_reference`, `exception_reason`, and `internal_notes`; the endpoint accepts those exact keys and calls `baro_manual_order_update_atomic`.
- The endpoint returns `purchase_enabled=false` and has no create-order action. The page contains no order-creation action.
- This is a static source-contract review only. No authenticated browser request or write operation was run, so UI acceptance remains pending.

No endpoint or database changes were made during this contract review.
