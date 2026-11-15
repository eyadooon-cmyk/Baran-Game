# BARAN GAME — External Store Manual Fulfilment Specification

Status: catalogue review baseline  
Branch: `feature/external-store-manual-fulfillment`  
Fulfilment mode: the owner purchases top-ups manually from a separate external store. No API integration or automatic top-up is available or assumed.

## 1. Scope lock

BARAN's games catalogue is limited to these three games only:
- PUBG Mobile
- Free Fire
- Jawaker

Do not add unrelated games, VPN products, coupons, or other categories from the external store.

## 2. Catalogue confirmed from the owner's screenshots

The following names and package quantities were read from the screenshots in the owner's archive. Product availability and displayed prices can change; recheck the external store at the time of each purchase.

### PUBG Mobile

**UC top-ups**
| Package | Displayed external-store price (USD) |
|---|---:|
| 60 UC | $0.93 |
| 325 UC | $4.53 |
| 660 UC | $9.03 |
| 1,800 UC | $22.43 |
| 3,850 UC | $45.04 |
| 8,100 UC | $89.50 |

The external-store order screen requests a PUBG ID and shows an ID verification action. BARAN should collect the player's PUBG ID and show a confirmation step before the customer submits an order. Do not claim that BARAN's ID check is connected to the external store unless separately implemented and tested.

**Growth / prosperity packages**
| Package | Displayed external-store price (USD) |
|---|---:|
| حزمة الشراء الأول | $0.90 |
| حزمة ترقية الأسلحة النارية | $2.69 |
| حزمة الشعار الخرافي | $4.48 |
| حزمة الصفقة الأسبوعية 1 | $0.97 |
| حزمة الصفقة الأسبوعية 2 | $2.96 |
| حزمة الشعار الخرافي الأسبوعية | $2.70 |
| Prime (1 شهر) | $0.90 |
| Prime (3 أشهر) | $2.70 |
| Prime (6 أشهر) | $5.39 |
| Prime (12 شهر) | $10.78 |
| Prime Plus (1 شهر) | $8.98 |
| Prime Plus (3 أشهر) | $26.93 |
| Prime Plus (6 أشهر) | $53.44 |
| Prime Plus (12 شهر) | $107.10 |

### Free Fire

**Diamonds**
| Package | Displayed external-store price (USD) |
|---|---:|
| 110 جوهرة | $0.96 |
| 210 جوهرة | $1.91 |
| 583 جوهرة | $4.75 |
| 1,188 جوهرة | $9.69 |
| 2,420 جوهرة | $18.99 |

**Membership**
- عضوية أسبوعية — displayed external-store price: $2.28.
- No other membership duration was visible in the reviewed screenshots; do not invent one.

### Jawaker

**Tokens**
| Product | Displayed external-store price | Quantity rules visible |
|---|---:|---|
| جواكر سيرفر 1 | $1.09 | Minimum 10,000; maximum 1,000,000 |
| جواكر سيرفر 2 | $1.09 | Minimum 10,000; maximum not confirmed in the reviewed detail screen |

The order screen requests the Jawaker ID. Treat the quantity as an entered amount subject to the visible limits, not as a fixed package quantity.

**Boosters**
| Product | Displayed external-store price (USD) | Quantity rule visible |
|---|---:|---|
| مسرع أحمر | $1.64 | 1 |
| مسرع أزرق | $8.43 | 1 |
| مسرع أسود | $14.63 | 1 |
| مسرع ذهبي | $25.77 | 1 |

The booster order screen requests the Jawaker ID.

## 3. Price separation and accounting

The USD figures above are historical screenshot observations of the external store's displayed prices, not BARAN customer selling prices and not guaranteed current costs.

For every BARAN product, keep separate fields for:
- Observed external-store reference price (optional, with observation date).
- Actual purchase cost entered by the owner after checking the live checkout amount.
- Purchase-cost currency and any explicitly entered conversion rate or fee.
- BARAN customer selling price, set independently by the owner.
- BARAN customer selling currency.
- Active/disabled state.

Never copy the external store's displayed price automatically into BARAN's selling-price field. Never infer a purchase cost from an old screenshot when recording a completed order. Profit must use the actual recorded purchase cost and the actual customer sale amount, less only explicitly recorded fees.

## 4. Manual order lifecycle

1. Customer submits a BARAN order with the required game/player ID and selected product.
2. BARAN places the order in an admin-only pending/manual-fulfilment queue. It is not sent to the external store automatically.
3. The owner opens the external store separately and manually completes the top-up.
4. The owner records the actual purchase amount, currency, external transaction/reference if available, and an internal note.
5. The owner checks the result in the external store and the relevant game/account.
6. Only then does the owner confirm fulfilment in BARAN.
7. BARAN stores a final order snapshot and calculates profit from the actual sale and purchase values.
8. Customer sees only a safe order status and BARAN order reference. External-store details, purchase cost, profit, and internal notes remain admin-only.

Suggested statuses: pending, in_progress, awaiting_admin_confirmation, completed, failed, refunded, and needs_review. Unknown outcomes must go to needs_review; do not retry, mark completed, or refund automatically while the result is uncertain.

## 5. Financial and security invariants

- Customer-facing requests must never set purchase cost, external transaction reference, order status, or profit.
- All fulfilment and price mutations must pass through authenticated, server-side admin authorization.
- Manual completion requires explicit admin confirmation, actual purchase cost and currency, and an audit record. If the external store provides no transaction reference, require an explicit exception reason and retain it in the audit log.
- A status change alone must not create a finance entry. Finance posting must be idempotent and based on a validated completed-order snapshot.
- Never expose purchase cost, profit, internal notes, or external-store credentials to customers.
- Do not enable customer purchasing or wallet debit until the order lifecycle, duplicate protection, refund/unknown-outcome handling, and mobile tests pass.
- Do not change the existing Syria Market workflow as part of this workstream.

## 6. Implementation sequence

1. Inspect existing products, orders, fulfilment records, admin authorization, and finance triggers before changing schema.
2. Add only the three approved game groups and the screenshot-confirmed package catalogue.
3. Build an admin-only actual-purchase-cost and BARAN-selling-price editor with validation and audit logging.
4. Build a manual fulfilment queue and confirmation flow with duplicate-safe order updates.
5. Add customer-safe order tracking and receipt details.
6. Test authorization, missing cost/reference, duplicate confirmation, failed/unknown fulfilment, refunds, and profit calculations.
7. Run mobile acceptance tests; only then consider enabling customer purchases.

## 7. Current implementation state (2026-11-15)

- Supabase contains 32 active game products matching the reviewed catalogue: 20 PUBG Mobile, 6 Free Fire, and 6 Jawaker.
- All 32 game products currently have no approved BARAN selling price. They are catalogue entries only; this is not authorization to charge customers.
- Older Free Fire package rows that did not match the screenshots have been deactivated. Unrelated service categories were left unchanged.
- The customer catalogue grouping and admin manual-fulfilment interface changes exist on this feature branch only and have not been deployed to the live GitHub Pages site.
- The admin order panel now uses neutral manual-execution language, has no external-store assignment field, and requires an actual purchase cost plus a transaction reference or a documented reason before it accepts a completed manual fulfilment.
- The `baran-admin` Edge Function source calls a new atomic, admin-authorized database RPC for manual fulfilment and audit logging. The RPC is executable by `service_role` only; the `authenticated` role was verified not to have execute permission. The Edge Function source has not been deployed yet.
- Obsolete supplier-management, API-configuration, API-simulation, and legacy refund actions are explicitly rejected by the updated Edge Function source on this branch. The admin refund button is hidden pending a separate safe-refund test.
- A production database migration now guards the `admin_update_order_status` RPC: an order cannot be marked completed without a recorded successful manual fulfilment, purchase cost, currency, exchange rate, and sale-price snapshots. This preserves the existing finance-posting and loyalty triggers.
- Internal legacy database column names remain unchanged to avoid breaking existing finance, refund, and audit dependencies. They are not shown in the manual-fulfilment interface.
- Current live database check: 0 orders, 32 active game products, and all 32 have no approved BARAN selling price. The order creation and wallet-charging preflight remains closed.
- Because there are no orders, a complete end-to-end order, payment, fulfilment, refund, and profit test cannot yet be performed. Refund handling still needs a dedicated review before launch.

This document records the reviewed catalogue and implementation state. It does not claim that the live storefront or Edge Function has been deployed, or that customer purchasing is operational.
