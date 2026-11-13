# BARAN GAME — Launch Readiness Audit

**Audit date:** 2026-11-13  
**Repository:** `eyadooon-cmyk/Baran-Game`  
**Supabase project:** `Baran-Game`

## Executive decision

**Status: NOT READY FOR PUBLIC LAUNCH.** The store has a substantial application and backend foundation, but customer purchasing and automatic fulfilment are not yet connected end-to-end. The storefront currently presents product previews rather than a live purchase flow.

## Verified strengths

- Supabase project status is `ACTIVE_HEALTHY`.
- The storefront is Arabic-first and mobile-oriented, with a PWA manifest configured for standalone display.
- Store areas exist for games, digital services, account, wallet, customer orders, support, notifications, and administration.
- All inspected tables in the `public` and `private` schemas have Row Level Security enabled.
- Sensitive internal, finance, supplier, payment, and admin tables have explicit deny-client policies; customer-facing reads are scoped to the signed-in user where appropriate.
- The inspected privileged wallet, deposit, and order RPCs are not executable by `anon` or `authenticated` roles directly.
- Push delivery infrastructure is deployed. An owner-targeted push was previously confirmed delivered; full closed-app and notification-click testing remains outstanding.
- ShamCash API connectivity was tested successfully, and the webhook endpoint validates a timestamped HMAC signature before storing events.
- ShamCash automatic credit logic is deployed for verified incoming transactions, with duplicate protection in the database flow.
- The order-price snapshot trigger derives a consistent SYP total from the USD price and the exchange-rate snapshot stored with the order.
- Failed supplier orders have a refund path that requires a recorded supplier failure and is idempotent against duplicate refunds. An unknown supplier result is held for reconciliation instead of being automatically refunded or resent.

## Critical launch blockers

### 1. Customer purchase flow is not connected — BLOCKER

- The inspected storefront scripts show product selection and review/preview only. The UI explicitly tells the customer that selecting a product does not create an order or debit a wallet.
- The database function `baran_create_wallet_order` exists, but execution is restricted to `service_role`; it is not callable directly by a customer session.
- No deployed Edge Function in the current project exposes a customer-authenticated order-creation endpoint that calls this RPC.
- Therefore, the current public customer flow is not yet a working purchase journey.

**Required:** build a dedicated authenticated order-creation Edge Function. It must derive the customer identity from the verified JWT, validate product and player inputs, call the protected order RPC, enforce idempotency, and return a safe order status. Do not expose service-role credentials to the browser.

### 2. Supplier API dispatch is not implemented — BLOCKER

- The database has preparation/finalization functions for supplier orders, but preparation only creates a queued attempt and explicitly states that an external API connector is needed to send the request.
- The supplier simulation function explicitly reports `simulation_only=true` and `real_connection=false`; it does not call the supplier.
- The deployed Edge Function inventory contains no supplier-order dispatch/status-polling worker. The inspected supplier-related Edge Functions configure and display suppliers but do not call a supplier's order API.
- No active suppliers or supplier product mappings are currently configured.

**Required:** implement a server-side supplier adapter/dispatcher with secure secret retrieval, HTTPS-only outbound calls, idempotency keys, supplier order references, status polling/webhooks, timeout handling, and reconciliation. Verify a real supplier sandbox/test order before enabling execution.

### 3. Order charge can precede fulfilment readiness — HIGH RISK

The protected order-creation function checks for an active supplier mapping and some enabled API configuration fields, then inserts the order and deducts the customer's wallet. It does not check all the same readiness conditions later required by supplier preparation, including `connection_status='ready'` and a fresh successful supplier-balance snapshot.

The preparation function can subsequently place an already-paid order into `manual_review` if the connection is not ready or the balance snapshot is missing/stale. That path does not automatically refund the customer.

**Required:** before debiting the wallet, enforce the complete supplier readiness checklist and a recent successful balance check, or use a properly designed wallet hold/reservation that is captured only after readiness is confirmed and safely released on failure.

### 4. Manual fulfilment endpoint can mark supplier completion without proof — HIGH RISK

The `baran-admin` action `order_fulfillment_update` accepts a manual `supplier_status='completed'` and supplier cost data. The supplier reference is optional in its validation. A separate admin order-status function permits broad status changes, while the finance trigger posts sales/cost entries when an order becomes completed and cost fields are present.

This is an administrator-only route, not an unauthenticated customer exploit, but it can create a false completion/finance record if used accidentally or without supplier confirmation.

**Required:** make successful completion depend on a verified supplier result recorded by the server-side dispatcher, including a non-empty supplier reference and a successful attempt record. Keep manual overrides as a separately permissioned, reasoned, audited exception path that cannot silently impersonate a supplier API success.

### 5. Product price model needs a clear currency rule — BLOCKER

- 17 catalogue products are marked active; all 17 currently have null USD and SYP prices.
- The order snapshot trigger requires a positive `price_usd` and a valid store exchange rate. It derives SYP from USD and the exchange rate; it does not use the product's `price_syp` value.
- The storefront can display either currency when populated, but the order backend currently requires the USD base price.

**Required:** agree one authoritative base-price model. Either require USD base prices and clearly derive SYP from the exchange-rate snapshot, or revise the snapshot logic to support a true SYP-only product. Then set approved selling prices and supplier costs from a verified supplier catalogue. Do not invent prices.

### 6. ShamCash customer payment test — PENDING

Current configured limits:
- SYP daily cap: 500,000.
- USD daily cap: 50.
- Integration enabled, automatic credit enabled, environment set to live.

The customer verification flow checks the transaction against ShamCash and then invokes the protected deposit processor. Webhook receipt alone records an event; it does not independently prove that a customer's wallet was credited. A controlled small-value test from a separate customer account is still required to prove the full live path and duplicate handling.

### 7. Authentication hardening — WARNING

Supabase Security Advisor reports **Leaked Password Protection Disabled**. This should be addressed before public launch. If the current plan does not provide the setting, choose a supported alternative or plan upgrade rather than claiming the control is active.

### 8. Push notification acceptance tests — PENDING

- Owner push delivery has been confirmed.
- Still test delivery when the browser/app is fully closed, tap-through navigation to the correct notification, customer-targeted delivery, and stale subscription cleanup.

## Additional observations

- Supabase performance advisor reports three backup tables without primary keys and multiple unused indexes. These are informational findings; do not delete backup tables or indexes without reviewing their purpose and retention requirements.
- There are no production orders or customer feedback records yet, so order lifecycle, customer support, and finance reporting have not been validated with real customer activity.
- Supplier SKU is nullable in the supplier-product mapping table. Require a valid supplier SKU or explicit product-specific input mapping before allowing a product to become purchasable.
- The current admin order workflow should distinguish a genuine supplier result from a manual status correction. Any manual correction must be explicit, permissioned, and audited.
- The application has a large single-file storefront. Keep future changes small, reviewed, and backed by a known-good commit.

## Recommended release sequence

1. Complete the controlled ShamCash customer-account test.
2. Build and secure the customer order-creation endpoint; connect the storefront purchase UI to it.
3. Secure a supplier API and implement the real dispatch/status adapter. Do not confuse configuration simulation with a live API test.
4. Enforce supplier readiness before wallet debit; add a safe reservation/rollback path.
5. Decide the authoritative price currency, populate approved product prices, supplier SKU mappings, and supplier costs.
6. Harden the completion path so finance entries can only be posted after a verified supplier success (or a clearly audited manual exception).
7. Complete end-to-end tests: wallet debit, order creation, supplier dispatch, status updates, duplicate prevention, timeout/unknown handling, and refund on confirmed failure.
8. Run mobile acceptance tests for registration/login, Google sign-in, wallet, product selection, support, profile, notifications, and admin permissions.
9. Resolve leaked-password protection and review security/performance findings.
10. Run a limited pilot with a small number of customers; only then prepare the Android APK and store release.

## Safety rules retained

- Never credit a wallet from an unverified webhook payload.
- Never allow a client to set its own wallet balance, order price, supplier cost, or order completion state.
- Never debit a customer's wallet until the full fulfilment path is ready, or until a safe reservation mechanism is in place.
- Keep payment mismatches, duplicates, and uncertain supplier outcomes in a review/reconciliation path.
- Do not activate a supplier or publish a product for purchase until its price, mapping, and fulfilment path are verified.

## Implementation update — secure order preflight (2026-11-13)

- Deployed Edge Function `baran-order-gateway` version 2 with `verify_jwt=true`.
- The endpoint validates the Supabase user session server-side and accepts only the `preflight` action. It does not create orders, reserve stock, call suppliers, or debit wallets.
- Added `public.baran_order_preflight(uuid,text,integer,text,text)` as a read-only SECURITY DEFINER database function. It uses an empty search_path and EXECUTE is granted only to `service_role`; PUBLIC, anon, and authenticated are revoked.
- The preflight checks active product, game Player ID format, approved USD price, exchange rate, wallet sufficiency, active supplier mapping/SKU, enabled and ready supplier API configuration, and a successful supplier balance snapshot no older than 10 minutes.
- A deliberate `FULFILLMENT_GATE_CLOSED` check keeps purchase disabled until supplier dispatch, verified result reconciliation, and safe refund handling are implemented and tested end-to-end.
- Frontend product review now includes a currency selector and “فحص جاهزية الطلب” action that calls the preflight endpoint.
- Verification: a read-only test for `PUBG_MOBILE_60_UC` returned PRODUCT_ACTIVE and PLAYER_ID_VALID, while correctly blocking on PRICE_NOT_APPROVED, SUPPLIER_NOT_READY, and FULFILLMENT_GATE_CLOSED. The result confirmed `charged=false`, `order_created=false`, and `can_purchase=false`.
- Supabase Security Advisor still reports Leaked Password Protection Disabled. Performance Advisor findings on backup tables and unused indexes remain informational and were not changed.
- No customer order, wallet balance, payment control, supplier execution flag, or live supplier credential was changed.

## Implementation update — admin catalogue readiness report (2026-11-13)

- Added public.baran_admin_catalog_readiness() as a read-only JSON report for the full product catalogue. It reports price readiness, supplier mapping, active supplier, SKU/cost presence, API configuration readiness, recent supplier balance, supplier balance coverage, and launch blockers for each product.
- EXECUTE on the report function is revoked from PUBLIC, anon, and authenticated; only service_role can call it.
- Upgraded baran-order-gateway to version 3. The new catalog_report action verifies the signed-in user against public.admin_users before returning the report. It does not trust user metadata and does not expose the service-role key.
- Added an administration-only report panel under لوحة الإدارة ← الموردون والأسعار. It renders summary counts and the blockers for each product. The customer-facing product review no longer contains the technical preflight control.
- Verification against the live database: 17 active catalogue products; 0 products with an approved positive USD price; 0 supplier-product mappings; 0 active suppliers; 0 supplier APIs marked ready; 1 admin account. The report returns 0 launch-ready products because fulfilment remains deliberately closed.
- The report is read-only. It does not set prices, activate suppliers, alter API settings, create orders, or debit wallets.
- Live authenticated UI invocation still requires a manual test from the owner's signed-in admin session. The database report function, its EXECUTE ACL, deployed Edge Function version 3, and committed frontend wiring were independently verified.
