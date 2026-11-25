# Syria Market — quantity & customer-input audit
**Snapshot:** 2026-11-25  
**Source:** read-only inspection of `public.syrimarket_catalog_cache`  
**Scope:** 796 cached products. This is a display/UX audit only.

## Safety boundary
- Draft only. No live catalog, supplier, wallet, payment, order, or fulfillment changes.
- No publication and no order activation.
- Syria Market remains separate from BARO.
- The 109 deferred classification items remain deferred and are not reopened by this audit.

## 1) Structural overview

| Product family/type | Quantity mode | Count | Input metadata |
|---|---:|---:|---|
| app / package | fixed | 370 | 232 have non-empty `params` |
| app / amount | range | 194 | 170 have non-empty `params` |
| sms / package | omitted | 133 | no params in cache |
| smm / amount | range | 54 | all 54 have `params` and structured `smm.fields` |
| manual / package | fixed | 34 | 10 have non-empty `params` |
| manual / amount | range | 8 | all 8 have non-empty `params` |
| app / specificPackage | options | 3 | all 3 have `params` |

Total: **796** products.

## 2) Recommended display behaviour

### A. Fixed packages (370 app + 34 manual)
- Show each as a selectable product/package card.
- Do not show a quantity stepper when the source says `mode=fixed`.
- If `params` contains labels, treat them as customer-input labels to be reviewed (e.g. player ID / server); do not invent field types or validation rules from a label alone.
- If `params` is empty, do not fabricate an input. Confirm fulfilment requirements with the supplier contract before enabling order submission.

### B. Variable amount / range (194 app + 54 SMM + 8 manual)
- Render a numeric quantity control using source `min`, `max`, and `step`; validate bounds on the server too.
- For ordinary app/manual amount products, use `params` as labels only until the authoritative input schema is confirmed.
- For SMM, prefer the structured `smm.fields[]` metadata: field id, Arabic/English label, type, required flag, and validation metadata. Example: URL field with `url_or_username` format and a maximum length.
- SMM pricing uses `pricing.unit` such as `per_1000`. Show the unit clearly (e.g. “السعر لكل 1000”) and calculate a preview only from a server quote; never present `price`/unit price as the full order total.

### C. Option packages (3 app / specificPackage)
- Render a dropdown/selector from `quantity.options[]`.
- Match the selected `value` to its corresponding `pricing.options[].price`.
- Do not infer prices from the minimum/maximum or from `unit_price` when an exact option price exists.
- Example records include FALLA with UUID input and mobile credit products with phone-number input. These are examples of metadata, not approval to open orders.

### D. SMS products (133)
- These records have no `quantity` object and no `params` in this cache snapshot.
- Treat them as fixed supplier-defined offers for display only.
- Do not assume that no customer data is required. Before activation, confirm the supplier's order contract and required fields separately.

## 3) Validation results

| Check | Result |
|---|---:|
| Total products inspected | 796 |
| Missing product ID or name | 0 |
| Missing currency | 0 |
| Missing or negative price | 0 |
| Invalid min/max range (min > max) | 0 |
| `amount` products missing range mode | 0 |
| `specificPackage` products missing options mode | 0 |
| SMM products with structured fields | 54 |

The 133 SMS package records have no quantity mode; this is a family-specific shape in the current cache, not automatically an error. The 3 option-package records have `mode=options` and populated option lists.

## 4) Required next review before any activation
1. Confirm each supplier family’s actual order payload and mandatory customer fields.
2. Confirm whether package products with empty `params` truly need no user input.
3. Confirm all option labels and their matching option prices.
4. Confirm SMM validation and server-side quote/submit behaviour.
5. Add customer-facing help text/examples only after field semantics are confirmed.
6. Keep the supplier cost private; retail pricing and any SYP conversion remain a separate approval step.

## 5) Decision
**Ready for display-design review, not ready for order activation.** The cached structure is internally consistent for the checks above, but metadata labels alone are not a substitute for supplier-side order validation.
