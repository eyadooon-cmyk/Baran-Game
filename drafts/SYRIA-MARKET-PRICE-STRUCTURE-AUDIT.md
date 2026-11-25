# Syria Market — supplier price-structure integrity audit
**Snapshot:** 2026-11-25  
**Source:** read-only checks against `public.syrimarket_catalog_cache`  
**Scope:** 796 cached products. This validates internal field consistency only; it does not approve retail prices.

## Safety boundary
- No live price or catalog changes.
- No retail markup, SYP conversion, wallet, order, or payment changes.
- No publication or order activation.
- BARO remains separate.

## 1) Price-field consistency

| Check | Result |
|---|---:|
| Products inspected | 796 |
| `price` differs from `base_price` | 0 |
| `price` differs from `pricing.unit_price` when both exist | 0 |
| SMM products not using `per_1000` pricing | 0 |
| SMM products missing unit/minimum pricing fields | 0 |
| SMM minimum total differs from unit price × minimum quantity | 0 |

These results mean the cached price fields are internally aligned for the checks above. They do **not** mean supplier prices are guaranteed current or that the same value should be displayed as a customer total.

## 2) Option-package consistency

All three `specificPackage` products have matching quantity-option and price-option counts, and every quantity value has a matching price record:

| Product ID | Product | Quantity options | Price options | Unmatched values |
|---|---|---:|---:|---:|
| 1671 | FALLA | 8 | 8 | 0 |
| 1686 | رصيد فوري سيرياتيل | 43 | 43 | 0 |
| 1694 | رصيد فوري MTN | 47 | 47 | 0 |

**Total:** 98 selectable options, with no missing price match in the cached records.

Display rule: the selected option value must be sent to the server and matched to the corresponding option price. Never calculate a selected package price from a different option's unit rate. A server quote/validation remains the authority before order activation.

## 3) SMM per-1000 pricing

All 54 SMM products are marked `per_1000`. Their cached minimum totals reconcile with the unit price multiplied by the minimum quantity in this snapshot.

Customer-facing display must distinguish:
- supplier rate per 1,000 units;
- minimum allowed quantity;
- minimum order total;
- final quoted total for the requested quantity.

Do not show the raw `price` field as if it were the complete order price. The final amount must come from the supplier/server quote and be checked again at submission.

## 4) Display and commercial approval still required
1. Treat these as supplier costs, not retail prices.
2. Do not apply a markup or currency conversion until the pricing policy is explicitly approved.
3. Confirm supplier price freshness and quote expiry at order time.
4. Show USD clearly wherever supplier cost is visible internally; keep supplier costs hidden from customers.
5. Preserve precision for calculations; round only according to the server/supplier contract.

## 5) Decision
**The cached supplier price structures passed the tested consistency checks.** This is a data-integrity result only, not a commercial approval and not permission to activate orders.
