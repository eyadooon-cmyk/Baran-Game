# BARAN GAME — Manual Supplier Fulfilment Specification

Status: implementation baseline  
Branch: `feature/manual-supplier-fulfillment`  
Supplier mode: manual fulfilment through the supplier platform app; no supplier platform API or automatic top-up is assumed.

## 1. Scope lock

The supplier platform workstream is limited to these games and product groups:

### Free Fire
- Diamonds
- Memberships

### PUBG Mobile
- UC packages (six package slots; proposed quantities remain provisional until checked against the supplier platform catalogue):
  - 60 UC
  - 325 UC (300 + 25)
  - 660 UC (600 + 60)
  - 1,800 UC (1,500 + 300)
  - 3,850 UC (3,000 + 850)
  - 8,100 UC (6,000 + 2,100)
- Growth/prosperity packages:
  1. حزمة الشراء الأول
  2. حزمة ترقية الأسلحة النارية
  3. حزمة الشعار الخرافي
  4. حزمة الصفقة الأسبوعية 1
  5. حزمة الصفقة الأسبوعية 2
  6. حزمة الشعار الخرافي الأسبوعية
  7. Prime (1 شهر)
  8. Prime (3 أشهر)
  9. Prime (6 أشهر)
  10. Prime (12 شهر)
  11. Prime Plus (1 شهر)
  12. Prime Plus (3 أشهر)
  13. Prime Plus (6 أشهر)
  14. Prime Plus (12 شهر)

### Jawaker
- Tokens: Server 1 and Server 2 (package definitions still to be supplied from supplier platform)
- Boosters: red, blue, black, and gold (package sizes still to be supplied from supplier platform)

No other games, VPN products, coupons, or unrelated supplier platform categories are in scope.

## 2. Commercial data rules

Every sellable package must have its own product record and its own:
- Supplier purchase cost, entered by the store owner from the actual supplier platform price.
- Supplier cost currency and, if needed, the conversion rate used for reporting.
- BARAN customer selling price, set independently by the store owner.
- Customer selling currency.
- Active/disabled state.

Never copy a supplier platform displayed retail price into the BARAN selling-price field automatically. Never invent missing supplier costs, package quantities, or customer prices. A product without an approved BARAN selling price is not purchasable. A product without a confirmed supplier cost cannot contribute a confirmed profit figure.

Profit is calculated per fulfilled order from the recorded sale amount less the actual supplier cost (and only explicitly recorded fees). Keep revenue, supplier cost, and profit as separate values.

## 3. Manual order lifecycle

1. Customer submits a BARAN order with the required game/player identifier and selected package.
2. The order is created in a pending/manual-fulfilment queue. It is not sent to supplier platform automatically.
3. Admin opens supplier platform separately and performs the purchase/top-up.
4. Admin records the actual supplier platform transaction/reference, actual unit cost, cost currency, and a short internal note.
5. Admin confirms fulfilment only after checking the supplier platform result and the customer/game account.
6. BARAN records the final status and computes the order's cost/profit snapshot.
7. Customer can see a clear status and order reference; internal supplier cost and notes remain admin-only.

Suggested statuses: pending, in_progress, awaiting_admin_confirmation, completed, failed, refunded, and needs_review. Unknown/uncertain supplier outcomes must go to needs_review; never retry or refund automatically when the outcome is unknown.

## 4. Financial and security invariants

- A customer-facing request must never be able to set supplier cost, supplier reference, order status, or profit.
- All fulfilment and price mutations must pass through authenticated, server-side admin authorization.
- Manual completion must require an explicit admin confirmation, a non-empty supplier platform transaction/reference where supplier platform provides one, actual cost and currency, and an audit record. If supplier platform provides no transaction reference, require an explicit exception reason and retain it in the audit log.
- A status change alone must not create a finance entry. Finance posting must be idempotent and based on a validated completed-order snapshot.
- Keep supplier purchase cost and customer selling price separate. Never expose cost, profit, internal notes, or supplier credentials to customers.
- Do not enable customer purchasing or wallet debit until the order lifecycle, duplicate protection, refund/unknown-outcome handling, and mobile tests pass.
- Do not change the existing Syria Market workflow as part of this workstream.

## 5. Implementation sequence

1. Inspect existing products, orders, supplier mappings, fulfilment records, admin authorization, and finance triggers before changing schema.
2. Add a dedicated supplier platform catalogue grouping and product-level commercial fields without altering existing supplier integrations.
3. Build an admin-only supplier platform cost/selling-price editor with validation and audit logging.
4. Build a manual fulfilment queue and confirmation flow with duplicate-safe order updates.
5. Add customer-safe order tracking and receipt details.
6. Add tests for authorization, missing cost/reference, duplicate confirmation, failed/unknown fulfilment, refunds, and profit calculations.
7. Run mobile acceptance tests; only then consider enabling purchases.

## 6. Explicitly unresolved data

The following must remain unpriced/unpublished until the owner supplies the exact supplier platform catalogue details:
- Free Fire diamond package labels and quantities.
- Free Fire membership package names/durations.
- Exact PUBG UC package confirmation against supplier platform.
- Jawaker Server 1 and Server 2 token package labels/quantities.
- Jawaker booster package sizes.
- All supplier platform purchase costs and all BARAN selling prices.

This document is a scope and safety baseline, not a claim that the database or live store has already been changed.
