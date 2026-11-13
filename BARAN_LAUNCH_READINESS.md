# BARAN GAME — Launch Readiness Audit

**Audit date:** 2026-11-13  
**Repository:** `eyadooon-cmyk/Baran-Game`  
**Supabase project:** `Baran-Game`

## Executive decision

**Status: NOT READY FOR PUBLIC LAUNCH.** The store has a substantial application and backend foundation, but real customer purchasing cannot be enabled safely until supplier activation, product pricing, and end-to-end order fulfillment are completed and tested.

## Verified strengths

- Supabase project status is `ACTIVE_HEALTHY`.
- The storefront is Arabic-first and responsive/mobile-oriented, with a PWA manifest configured for standalone display.
- Store areas exist for games, digital services, account, wallet, customer orders, support, notifications, and administration.
- All inspected tables in the `public` and `private` schemas have Row Level Security enabled.
- Sensitive internal, finance, supplier, payment, and admin tables have explicit deny-client policies; customer-facing reads are scoped to the signed-in user where appropriate.
- The inspected wallet, deposit, order, and supplier privileged RPCs are not executable by `anon` or `authenticated` roles directly.
- Push delivery infrastructure is deployed. An owner-targeted push was previously confirmed delivered; full closed-app and notification-click testing remains outstanding.
- ShamCash API connectivity was tested successfully, and the webhook endpoint validates a timestamped HMAC signature before storing events.
- ShamCash automatic credit logic is deployed for verified incoming transactions, with duplicate protection in the database flow.

## Launch blockers

### 1. Supplier and fulfilment — BLOCKER

Current database snapshot:
- Suppliers: 1 record; active suppliers: 0.
- Supplier product mappings: 0.
- The existing RTC MARKET record is inactive; its API approval and a real top-up test are still pending.
- Orders: 0.

**Required:** obtain and verify a supplier API, activate the supplier only after credentials and terms are validated, map supplier product codes, and test successful, pending, failed, and refunded orders.

### 2. Product catalogue and prices — BLOCKER

- 17 catalogue products are marked active.
- All 17 currently have null USD and SYP prices.
- The current storefront deliberately disables selection when no approved price exists and displays the catalogue as a preview; it does not create an order or debit a wallet.

**Required:** set approved selling prices and supplier costs after the supplier catalogue is confirmed. Do not invent prices or enable purchase buttons before this.

### 3. ShamCash customer payment test — PENDING

Current configured limits:
- SYP daily cap: 500,000.
- USD daily cap: 50.
- Integration enabled, automatic credit enabled, environment set to live.

The customer verification flow checks the transaction against ShamCash and then invokes the protected deposit processor. Webhook receipt alone records an event; it does not independently prove that a customer's wallet was credited. A controlled small-value test from a separate customer account is still required to prove the full live path and duplicate handling.

### 4. Authentication hardening — WARNING

Supabase Security Advisor reports **Leaked Password Protection Disabled**. This should be addressed before public launch. If the current plan does not provide the setting, choose a supported alternative or plan upgrade rather than claiming the control is active.

### 5. Push notification acceptance tests — PENDING

- Owner push delivery has been confirmed.
- Still test delivery when the browser/app is fully closed, tap-through navigation to the correct notification, customer-targeted delivery, and stale subscription cleanup.

## Additional observations

- Supabase performance advisor reports three backup tables without primary keys and multiple unused indexes. These are informational findings; do not delete backup tables or indexes without reviewing their purpose and retention requirements.
- There are no production orders or customer feedback records yet, so order lifecycle, customer support, and finance reporting have not been validated with real customer activity.
- The application has a large single-file storefront. Keep future changes small, reviewed, and backed by a known-good commit.

## Release sequence

1. Complete the controlled ShamCash customer-account test.
2. Secure a supplier API and verify the supplier's real catalogue and delivery behavior.
3. Set approved product prices and supplier cost mappings.
4. Complete end-to-end tests: wallet debit, order creation, supplier dispatch, status updates, duplicate prevention, timeout handling, and refund on confirmed failure.
5. Run mobile acceptance tests for registration/login, Google sign-in, wallet, product selection, support, profile, notifications, and admin permissions.
6. Resolve leaked-password protection and review security/performance findings.
7. Run a limited pilot with a small number of customers; only then prepare the Android APK and store release.

## Safety rules retained

- Never credit a wallet from an unverified webhook payload.
- Never allow a client to set its own wallet balance, order price, supplier cost, or order completion state.
- Keep payment mismatches, duplicates, and uncertain supplier outcomes in a review/reconciliation path.
- Do not activate a supplier or publish a product for purchase until its price, mapping, and fulfilment path are verified.
