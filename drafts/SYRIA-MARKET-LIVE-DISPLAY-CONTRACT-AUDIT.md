# Syria Market — Live Display Contract Audit
Date: 2026-11-25
Scope: read-only review of the current `main` front-end paths against the separate Syria Market supplier-catalog preview.
Status: internal draft; no production edits.

## Executive finding
The Syria Market supplier snapshot and the currently rendered Baran customer catalog are **not yet a drop-in data match**. The reviewed customer-facing paths read the Baran `products` table and expect Baran's own display/retail fields. The Syria Market snapshot contains supplier catalog structures (supplier category names, quantity modes, option arrays, SMM fields, supplier costs, and relative image paths). Do not point the customer UI directly at the supplier snapshot or copy supplier costs into customer prices.

## Verified current front-end contract
The following paths were inspected on `main`:

- `index.html` — `loadBaranStoreSearchProducts()` reads:
  `id, product_code, name, description, category, price_usd, price_syp, is_active, sort_order`
  from `products`, filtering `is_active = true`.
- `index.html` — `loadBaranServiceCatalog(category,...)` reads:
  `id, product_code, name, description, price_usd, price_syp, sort_order`
  from `products`, filtering the selected Baran category and active records.
- `products.js` — `loadCatalog()` reads:
  `id, product_code, category, name, description, price_usd, sort_order, created_at`
  from `products`, filtering active records.
- The current service-card path renders a category icon, name, description, and Baran price; it marks products as “السعر مسجل · الشراء غير مفعّل” or “قيد التجهيز”. Its selection button is explicitly “اختيار للمراجعة”, not an order action.
- The customer catalog note says purchase/shipping are not enabled until the order path and supplier availability checks are ready.

These are Baran catalog fields, not proof of a live Syria Market supplier integration. No direct supplier-cache mapping was established by the reviewed display paths.

## Supplier-to-display mapping still required
Before any approved Syria Market products can appear in the customer catalog, define and test a server-side adapter with explicit mappings:

| Supplier source concept | Baran/customer display contract | Required handling |
|---|---|---|
| Supplier product ID | Internal supplier reference / mapped Baran product | Preserve source ID; do not assume it is a Baran product ID |
| Supplier name | `products.name` | Trim surrounding whitespace at presentation/import boundary; preserve raw source |
| Supplier category name / `parent_id` | Baran `products.category` | Use an explicit approved mapping table; do not infer from labels or missing category IDs |
| Supplier cost / unit rate | Not a customer price field | Keep private; calculate a separate approved retail price on the server |
| Supplier quantity mode / min / max | Product detail/input schema | Validate per product type; do not invent a default quantity |
| Supplier option packages and price arrays | Explicit selectable options | Preserve option-to-price pairing and validate server-side |
| SMM fields and per-1000 rates | Validated customer input + server quote | Validate URL/quantity and calculate the quote server-side; never expose raw supplier rate as retail price |
| Supplier `category_img` relative path | No image field in reviewed Baran card query | Resolve only through a verified asset host or approved local asset map; never guess a host |
| Supplier SKU (null in snapshot) | Baran product code / internal reference | Keep supplier ID as traceable reference; do not invent a supplier SKU |

## Preview-specific safety notes
- The standalone preview currently uses ten fixed examples and local browser filtering only. It is not a live catalog, not a full 796-product browsing page, and not deployed.
- The preview's cards are built with `innerHTML`. This is acceptable only while every value remains fixed, reviewed sample data. If the preview is ever fed live supplier data, rebuild card contents with DOM nodes and `textContent` (or rigorously escaped templates) before loading untrusted names/categories.
- The preview labels supplier cost separately from retail price and has no purchase/order action. Keep that boundary.
- For variable quantity, option packages, and SMM, the displayed minimum or per-1000 cost is supplier-cost context only; it is not a final customer quote.

## Required approval gates before implementation
1. Approve the category mapping table, including the 31 flagged SMM platform/category conflicts and 3 uncategorized manual items; do not silently repair them.
2. Approve the product-by-product display name and customer-facing description.
3. Confirm image asset host/paths from an authoritative source, or use approved Baran-owned category artwork.
4. Approve retail markup, exchange-rate source, rounding, and customer-visible USD/SYP policy separately from supplier cost.
5. Approve quantity/option/input schemas and server-side validation for each product family.
6. Implement a server-side import/quote adapter and tests; never let the browser choose or alter supplier cost.
7. Keep all Syria Market order/fulfillment activation disabled until supplier reliability, idempotency, wallet checks, and error/refund handling are separately reviewed.

## Explicitly unchanged
- No live database writes, supplier calls, product imports, price changes, wallet/payment/order/fulfillment changes, or deployment.
- No BARO changes; BARO remains separate.
- The 109 deferred classification items remain deferred and were not reopened.
- This report is review documentation only and must not be treated as approval to merge or publish.
