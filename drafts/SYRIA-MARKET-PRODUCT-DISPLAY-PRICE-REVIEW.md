# Syria Market — Product Display & Price Review (Draft)

**Status:** Internal review draft only — NOT published  
**Source snapshot:** `public.syrimarket_catalog_cache`  
**Checked:** 2026-11-25  
**Scope:** Syria Market catalog only. BARO is explicitly out of scope.

## Safety boundaries

- Read-only supplier catalog review. No supplier purchase/order calls.
- Do not enable customer ordering, checkout, fulfillment, or automatic shipping.
- Do not write to live products, prices, wallets, orders, payment records, or finance tables.
- Do not change BARO, its manual-shipping catalog, prices, or order flow.
- Keep the 109 deferred review items deferred; they are not a blocker for this phase.
- Any proposed sale price remains a draft value until separately approved.

## Snapshot verified

| Measure | Current value |
|---|---:|
| Cached products | 796 |
| Cached categories | 106 |
| Supplier products in latest completed audit | 785 |
| Supplier IDs missing from live cache | 0 |
| Local/live-only products retained | 11 |

The 785 supplier IDs were all present in the 796-product live cache. The 11 live-only records are retained and must not be removed during this review.

## Display review fields

Each product card/detail should be reviewed for:

1. Product name (Arabic/English as supplied; do not silently rewrite supplier identifiers).
2. Assigned category and category breadcrumb.
3. Product/service type: package, amount, or other explicit supplier type.
4. Supplier cost in USD, visibly labelled **سعر المورد**.
5. Pricing basis: fixed price, per-unit, or per-1,000; never show a per-1,000 rate as the price of one unit.
6. Quantity rules: minimum, maximum, step, and fixed quantity where applicable.
7. Required customer fields/parameters (for example, link, player ID, region/server).
8. Availability state, presented as information only; it must not create an order action.
9. Product image/category image, with a neutral fallback when no usable image exists.

## Price review rules

- The imported `price` / `base_price` is supplier cost, not an approved retail price.
- Keep supplier cost and proposed customer price in separate columns/labels.
- Proposed customer price: **pending** until a markup/fee policy is explicitly approved.
- Do not derive SYP prices until the exchange-rate source, rounding rule, and margin policy are approved.
- Preserve supplier precision during review; apply customer-facing rounding only after approval.
- Flag extremely small per-unit/per-1,000 rates for correct unit labelling, not automatic price correction.

## Items requiring a display-review flag

A read-only check found 3 products with a blank `category_name`:

| Supplier ID | Product | Supplier price | Type / quantity |
|---|---|---:|---|
| 1715 | Mtn Cash | $0.0088 | package; fixed quantity 1 |
| 1738 | usdt code | $1.10 | package; fixed quantity 1 |
| 1742 | نجوم تيليجرام | $0.0218 | amount; range 250–10,000 |

These remain unchanged and should appear in a separate **تصنيف يحتاج مراجعة** bucket in the draft preview. This is a display flag only, not a change to the supplier catalog. It does not replace or reopen the 109 deferred items.

## Review outcome checklist

- [ ] Confirm mobile card layout and readable product names.
- [ ] Confirm category/breadcrumb display for all products.
- [ ] Confirm fixed vs range quantity controls are represented accurately.
- [ ] Confirm required input fields are shown before any future order flow.
- [ ] Confirm USD supplier cost is labelled clearly and never mistaken for retail price.
- [ ] Decide retail markup/fee policy and SYP conversion policy separately.
- [ ] Keep all order, checkout, payment, wallet, and fulfillment actions disabled.

## Approval gate

This draft is for review only. No publication, merge to `main`, customer visibility, order activation, supplier ordering, or financial mutation is authorized by this document.
