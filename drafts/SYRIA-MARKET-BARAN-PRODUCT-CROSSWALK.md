# Syria Market → Baran product-level crosswalk (draft)
Date: 2026-11-25
Branch: `draft/syria-market-display-pricing-review-20261125`
Status: read-only reconciliation worksheet; not an import plan or approval.

## Scope and evidence
- Baran side: read-only snapshot of the 35 active rows in `public.products` in project `yabpmdzsiuyxxkcqakfs`.
- Supplier side: read-only latest `public.syrimarket_catalog_cache.products` snapshot (796 rows; fetched_at 2026-11-25 00:44:02 UTC).
- Matching is by product meaning, denomination, region/server and fulfillment method—not by similar wording alone.
- Supplier product IDs below are source IDs only. They are not Baran product IDs.
- Supplier costs are recorded only as internal evidence here. They are not retail prices.
- All Baran active rows currently have null USD and SYP prices. No row is price-ready.

## A. Verified candidate matches (still not approved for import or sale)

| Baran product_code | Baran display product | Supplier ID | Supplier item | Match assessment | Remaining gate |
|---|---|---:|---|---|---|
| PUBG_MOBILE_60_UC | PUBG Mobile — 60 شدة | 1827 | 60 شدة روبوت | Strong package/quantity match | Confirm region/server and robot delivery route |
| PUBG_MOBILE_325_UC | PUBG Mobile — 325 شدة | 1825 | 325 شدة روبوت | Strong package/quantity match | Confirm region/server and robot delivery route |
| PUBG_MOBILE_660_UC | PUBG Mobile — 660 شدة | 1828 | 660 شدة روبوت | Strong package/quantity match | Confirm region/server and robot delivery route |
| PUBG_GROWTH_FIRST_PURCHASE | PUBG — حزمة الشراء الأول | — | No exact supplier item verified | Unmatched | Hold; do not substitute UC or another growth bundle |
| PUBG_GROWTH_WEAPON_UPGRADE | PUBG — حزمة ترقية الأسلحة النارية | — | No exact supplier item verified | Unmatched | Hold |
| PUBG_GROWTH_MYTHIC_EMBLEM | PUBG — حزمة الشعار الخرافي | — | No exact supplier item verified | Unmatched | Hold |
| PUBG_GROWTH_WEEKLY_DEAL_1 | PUBG — حزمة الصفقة الأسبوعية 1 | — | No exact supplier item verified | Unmatched | Hold |
| PUBG_GROWTH_WEEKLY_DEAL_2 | PUBG — حزمة الصفقة الأسبوعية 2 | — | No exact supplier item verified | Unmatched | Hold |
| PUBG_GROWTH_WEEKLY_MYTHIC_EMBLEM | PUBG — حزمة الشعار الخرافي الأسبوعية | — | No exact supplier item verified | Unmatched | Hold |
| PUBG_PRIME_1M | PUBG Prime — شهر واحد | 429 | Prime ( من الشهور 1) | Strong duration match | Confirm activation method, account/ID fields and region |
| PUBG_PRIME_3M | PUBG Prime — 3 أشهر | — | No exact 3-month supplier item verified | Unmatched | Hold; 1-month offer is not a substitute |
| PUBG_PRIME_6M | PUBG Prime — 6 أشهر | — | No exact 6-month supplier item verified | Unmatched | Hold |
| PUBG_PRIME_12M | PUBG Prime — 12 شهراً | — | No exact 12-month supplier item verified | Unmatched | Hold |
| PUBG_PRIME_PLUS_1M | PUBG Prime Plus — شهر واحد | — | No exact Prime Plus item verified | Unmatched | Hold; ordinary Prime is not equivalent |
| PUBG_PRIME_PLUS_3M | PUBG Prime Plus — 3 أشهر | — | No exact Prime Plus item verified | Unmatched | Hold |
| PUBG_PRIME_PLUS_6M | PUBG Prime Plus — 6 أشهر | — | No exact Prime Plus item verified | Unmatched | Hold |
| PUBG_PRIME_PLUS_12M | PUBG Prime Plus — 12 شهراً | — | No exact Prime Plus item verified | Unmatched | Hold |
| PUBG_MOBILE_1800_UC | PUBG Mobile — 1800 شدة | 1824 | 1800 شدة روبوت | Strong package/quantity match | Confirm region/server and robot delivery route |
| PUBG_MOBILE_3850_UC | PUBG Mobile — 3850 شدة | 1826 | 3850 شدة يدوي | Quantity matches; fulfillment differs (manual vs Baran description) | Hold until manual fulfillment is explicitly accepted and documented |
| PUBG_MOBILE_8100_UC | PUBG Mobile — 8100 شدة | 1829 | 8100 شدة يدوي | Quantity matches; fulfillment differs (manual vs Baran description) | Hold until manual fulfillment is explicitly accepted and documented |
| FREEFIRE_ROBOT_110 | Free Fire — 110 جوهرة | 1842 | 100 + 10 FreeFire By ID | Strong total-quantity match (110) | Confirm region/server and ID delivery route |
| FREEFIRE_ROBOT_210 | Free Fire — 210 جوهرة | — | Supplier offer is 210 + 21 = 231 | Not an exact match | Hold; do not map 231 to 210 |
| FREEFIRE_ROBOT_583 | Free Fire — 583 جوهرة | 1844 | 530 + 53 FreeFire By ID | Strong total-quantity match (583) | Confirm region/server and ID delivery route |
| FREEFIRE_ROBOT_1188 | Free Fire — 1188 جوهرة | 1845 | 1080 + 108 FreeFire By ID | Strong total-quantity match (1188) | Confirm region/server and ID delivery route |
| FREEFIRE_ROBOT_2420 | Free Fire — 2420 جوهرة | 1846 | 2200 + 220 FreeFire By ID | Strong total-quantity match (2420) | Confirm region/server and ID delivery route |
| FREEFIRE_ROBOT_MEMBERSHIP_WEEKLY | Free Fire — عضوية أسبوعية | — | No exact weekly membership item verified | Unmatched | Hold |
| JAWAKER_TOKENS_SERVER_1 | جواكر توكنز — سيرفر 1 | — | Supplier ID 1853: JAWAKER amount offer, no server distinction | Related service only; not a safe match | Hold until supplier server selection is confirmed |
| JAWAKER_TOKENS_SERVER_2 | جواكر توكنز — سيرفر 2 | — | Supplier ID 1853: JAWAKER amount offer, no server distinction | Related service only; not a safe match | Hold until server 2 is explicitly supported |
| JAWAKER_BOOSTER_RED | مسرّع جواكر — أحمر | — | Supplier ID 1443 is labelled red premium +plus, not the same confirmed booster | Not equivalent on current evidence | Hold |
| JAWAKER_BOOSTER_BLUE | مسرّع جواكر — أزرق | 1355 | مسرع ازرق | Strong name/color match | Confirm exact booster entitlement and delivery method |
| JAWAKER_BOOSTER_BLACK | مسرّع جواكر — أسود | 1356 | مسرع اسود | Strong name/color match | Confirm exact booster entitlement and delivery method |
| JAWAKER_BOOSTER_GOLD | مسرّع جواكر — ذهبي | 55 / 1444 | مسرع ذهبي / GOLD BOOSTER | Duplicate-looking candidates; not uniquely resolved | Hold until one canonical supplier ID is verified |
| GOOGLE_PLAY_CARD_10_USD | بطاقة Google Play بقيمة 10 دولارات | 94 | بطاقة غوغل 10$ امريكي | Denomination and US region match | Confirm US redemption restriction and code delivery process |
| GOOGLE_PLAY_CARD_25_USD | بطاقة Google Play بقيمة 25 دولاراً | 95 | بطاقة غوغل 25$ امريكي | Denomination and US region match | Confirm US redemption restriction and code delivery process |
| CHATGPT_PLUS_1_MONTH | اشتراك ChatGPT Plus لمدة شهر | 1688 | chatgpt plus | Product/term label broadly matches; supplier family is manual | Confirm duration, account method, eligibility, and manual fulfillment before any sale |

## B. Supplier candidates deliberately not mapped
- Google Play US $5 (supplier ID 93): no corresponding Baran product row in the 35-row active snapshot.
- Google Play UAE and Turkey denominations (supplier IDs 104–105 and 111–114): region/denomination differs from Baran's two US-card rows.
- PUBG New State NC (supplier IDs 449–454): different game/product family; not PUBG Mobile UC.
- PUBG code 60 (supplier ID 1833): code-based amount offer, not the same as the robot UC package.
- Supplier PUBG 3850 and 8100 are manual fulfillment, unlike the matching robot offers for the smaller UC packages; kept separate.
- Supplier Jawaker generic amount service (ID 1853) does not prove separate server 1/server 2 support.
- Red Jawaker premium +plus (ID 1443) is not accepted as equivalent to the Baran red booster.
- Gold Jawaker has two candidate IDs (55 and 1444); no canonical choice is made.

## C. Mapping counts (based on this exact snapshot)
- Strong candidate matches: 13 Baran rows (including the two Google Play cards and ChatGPT product-level candidate).
- Partial/conditional candidates: 3 Baran rows (PUBG 3850, PUBG 8100, Jawaker gold).
- Related but not safely mapped: 3 Baran rows (Jawaker server 1, server 2, red booster).
- No exact supplier item verified: 16 Baran rows.
- These are review classifications, not import approvals.

## D. Price and activation gate
All 35 active Baran products have null/non-positive `price_usd` in the current snapshot and no usable `price_syp`. Therefore:
1. Do not copy supplier cost into Baran retail price.
2. Do not calculate SYP until exchange-rate source, rate timestamp, rounding and margin are approved.
3. Keep all product purchase/order controls disabled.
4. Keep supplier costs private; all future quotes must be resolved and calculated server-side.
5. For per-quantity or manual items, confirm input fields and delivery method before exposing an order form.

## E. Scope protection
- Read-only database queries only; no writes or supplier API calls.
- No product imports, price edits, category changes, wallet/payment/order/fulfillment changes.
- BARO remains completely separate.
- The 109 deferred classification items remain deferred and were not reopened.
- This worksheet is draft evidence for human review only; do not merge or publish without explicit approval.
