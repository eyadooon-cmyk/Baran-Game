# Syria Market — full MARKET catalog review (public-safe draft)
Date: 2026-11-25
Status: catalog inventory and release-gate review only. No production changes.

## 1. Non-negotiable catalog ownership
- Every product sourced from Syria Market remains in **MARKET**, whether automatic, manual, gift card, subscription, social-media service, or SMS/number product.
- No Syria Market item may be moved into BARO, deleted, or reclassified as BARO because it is manual.
- Manual products remain in MARKET and must display a clear manual-fulfillment label and customer instructions once the workflow is verified.
- BARO is a separate catalog with its own independent products.
- Unresolved products remain attached to MARKET with a held/review status, not discarded.
- This is a placement rule only. It does not approve sale, retail prices, supplier activation, payments, or order execution.

## 2. Latest supplier cache snapshot
Read-only verification of `public.syrimarket_catalog_cache`:
- Sync status: success
- Snapshot time: 2026-11-25 01:35:02 UTC
- Products: 796
- Source categories: 106
- Cached availability flag: 774 available / 22 unavailable
- These flags are supplier-cache indicators only. They do not prove live stock, successful delivery, automatic fulfillment, region suitability, or legal/commercial approval.

## 3. Product-family inventory

| Supplier family | Products | Cached available | Held/unavailable | Product schema | Review treatment |
|---|---:|---:|---:|---|---|
| app | 567 | 552 | 15 | 370 package, 194 amount, 3 specificPackage | Verify fulfillment, region, server and required player fields per SKU |
| manual | 42 | 39 | 3 | 34 package, 8 amount | Keep in MARKET; manual workflow only; 3 paused |
| smm | 54 | 50 | 4 | 54 amount | Validate URL/username, quantity limits, unit/rate and cancel/refill rules |
| sms | 133 | 133 | 0 | 133 package | State field is missing; availability does not establish OTP behavior or permission to sell |
| **Total** | **796** | **774** | **22** |  | All 796 remain MARKET |

All cached products have a positive numeric supplier price and USD currency in this snapshot. Supplier costs and all customer-price calculations are deliberately excluded from this public repository document. Keep detailed cost sheets in private storage only; never expose supplier cost in customer-facing UI.

## 4. Manual fulfillment conflicts and holds
Nine products belong to the `app` family while their names explicitly indicate manual fulfillment:
- PUBG products labelled 3,850 UC manual and 8,100 UC manual: supplier availability is true, but the name conflicts with the direct-top-up metadata. Keep in MARKET and mark fulfillment unresolved; do not advertise as automatic until confirmed.
- Seven Free Fire membership/manual products: all currently in maintenance. Keep in MARKET and hold from sale until supplier state changes.

Additional groups requiring holds/rechecks:
- Free Fire membership category: 9 products, 0 available, all maintenance.
- Jawaker accelerators: 6 products, 4 available and 2 held; verify each product individually.
- MTN: 2 products, both unavailable.
- TikTok SMM: 5 products, 2 available and 3 in price_refreshing.
- Manual family: 42 products, 39 available and 3 paused.
- App family: 567 products, 552 available and 15 held.
- SMM family: 54 products, 50 available and 4 held/price_refreshing.
- SMS family: 133 entries have `available=true` but no `service_state`; hold from activation pending coverage, number type, OTP flow, terms and compliance review.

## 5. Required product classification fields
For each of the 796 records, preserve:
- Supplier product ID and public product ID (never confuse supplier IDs with Baran product IDs)
- Exact source product name and source category
- `service_family`, `product_type`, `service_state`, `available`
- Currency and supplier price (internal only; not public UI)
- Required `params`, quantity mode/min/max/step/options
- SMM-specific pricing unit, rate, URL/username validation, cancel/refill support
- Region/server and fulfillment method, with evidence/source for the classification
- Customer-facing status: available, manual, held, or unresolved

Do not equate `service_family=app` with automatic fulfillment. The supplier's category and flags must be checked against product name, required fields, documented endpoint behavior and a controlled test before an automatic label is used.

## 6. Family-specific controls
### App / game / gift card / subscription products
- Confirm game region/server, exact denomination and player-ID fields.
- For gift cards, confirm redemption country, denomination, restrictions and code delivery.
- For subscriptions, AI, VPN and software services, confirm duration, activation/account method, region, warranty and refund policy.
- A product name containing manual overrides any assumption of automatic delivery until confirmed.

### Manual products
- Stay in MARKET.
- Require a defined internal work queue, customer instructions, expected handling time, completion evidence and cancellation/refund process.
- Never debit or fulfill automatically until the manual workflow and controls are implemented and tested.

### SMM products
- Validate the required URL/username format and quantity min/max/step.
- Respect per-1,000 or other rate units; do not calculate them as fixed package prices.
- Confirm cancel/refill support and eligibility before display.

### SMS / number products
- Confirm country, operator, number lifetime, OTP support, allowed usage and supplier terms.
- Keep inactive until a separate legal/compliance review and technical flow validation are complete.

## 7. Pricing governance — no public cost data
- Supplier cost is confidential business data. Keep it out of this public repository, public preview builds, browser bundles, customer API responses and customer-facing screens.
- Store supplier cost separately from retail price with strict server-side access control.
- Retail price formula for eligible fixed-price packages: supplier landed cost (including verified fees) divided by (1 − approved gross margin).
- SMM rate products require unit-aware quantity calculations; SMS requires separate commercial/compliance validation.
- FX rate must have an explicit basis, source, timestamp and refresh policy. Do not reuse a stale database rate as a current quote.
- Before publication, account for payment fees, FX spread, refunds, failed-order risk and operating overhead.
- Requote or verify supplier cost before charging the customer; reject stale supplier price changes safely.
- Never force competitor parity if it creates a loss.
- Existing 5%, 8%, 10% margin comparisons are internal scenarios only; no single margin or retail price is approved.
- No supplier costs, wholesale price tables, margin tables or customer selling prices are included in this public document.

## 8. Source category inventory — 106 labels
Preserve source spelling and region. Do not merge regional variants or collapse similar names without an explicit mapping:

Age Of Empires Mobile; Black Clover m Black Crystals; Blood Strike (MENA) العرب; ⁨Bolt⁩; Bullet Echo; canva; CAPCUT; Cash Ball; chatgpt; City Of Crime Gang War; Claude Ai; Coin Ball; Coursera; Crystal of Atlan; Cursor AI; Delta force Global; ElevenLabs⁩; FarLight84; Figma; Framer Pro; Gemini; Genshin Impact; Grok; Guns of glory; Honor of king; identity v; IP TV; ITUNES الامارات; iTunes السعودية; iTunes المانيا; iTunes امريكا; iTunes بريطانيا; iTunes تركيا; King Shot; ⁨Kling AI⁩; LivU; LOOK TV 4K; Lords mobile; ⁨Lovable⁩; Ludo Club; Manu; MTN; n8n; ⁨Notion⁩; Oxide : Survival Island; PlayStation (الامارات); PlayStation (امريكا); PlayStation (قطر); PlayStation (لبنان); Proton Vpn; PUBG New State; Razer Gold (BR); Razer Gold (CA); Razer Gold (CL); Razer Gold (EU); Razer Gold (Global); Razer Gold (TR); Razer Gold (US); Replit; Roblox CAD; Roblox KSA; Roblox UAE; Roblox USA; Runway; ⁨Spotify⁩; Super SUS; SYRIATEL; TradingView; TUMILE; V Ultra TV; Valorant TR; Valorant امريكي; Watch tv; Whiteout Survival; X twitter; Yalla Ludo Diamonds; ZAIN TV; أشتراك شامنا; أشتراك نتفلكس; أكواد بوبجي; ارقام Gmail; ارقام فيسبوك; ارقام واتساب; انغامي بلس; بطاقات قوقل اماراتية; بطاقات قوقل امريكية; بطاقات قوقل تركيا; بوبجي عالمي; خدمات انستجرام; خدمات تيك توك; خدمات تيليجرام; خدمات فيسبوك; خدمات واتساب; شاهد VIP; شحن الالعاب; شحن البرامج; شحن التطبيقات; شحن الرصيد; شحن جواكر; عضويات بوبجي; عضويات فري فاير; فري فاير Free Fire ID; مسرعات جواكر; موبايل ليجند تركيا; موبايل ليجند عالمي; يلا فزعة اكواد.

## 9. Release checklist
- [ ] Map all 796 source products without dropping any source record.
- [ ] Preserve the 106 source categories and regional distinctions.
- [ ] Verify fulfillment mode for every product, including the nine manual-name conflicts.
- [ ] Keep all manual products in MARKET and define the manual workflow.
- [ ] Keep unavailable, maintenance and price_refreshing items held, not deleted.
- [ ] Validate all player input fields, regions and server rules.
- [ ] Validate gift-card redemption region and code delivery.
- [ ] Validate SMM unit/quantity/cancel/refill semantics.
- [ ] Validate SMS coverage, OTP flow, terms and compliance before activation.
- [ ] Prepare internal landed-cost and margin sheet in private storage only.
- [ ] Confirm current FX basis, fees, reserve and approved rounding.
- [ ] Approve customer prices separately before production writes.
- [ ] Keep supplier integration, wallet/payment changes and order execution disabled until separately tested and approved.

## 10. Production safety statement
This review was read-only against the supplier cache. No Baran production products, retail prices, supplier mappings, exchange-rate settings, payment settings, order routes, fulfillment flags, supplier activation or order execution were changed.


## 11. Confidentiality check — public repository and Supabase cache
- The GitHub repository is public. The public catalog preview was updated on 2026-11-25 to remove numeric supplier costs, cost-based sorting, and cost-bearing text; it now shows supplier cost as not displayed and retail price as under review.
- The public PR review document contains no supplier cost or wholesale-price table.
- Read-only Supabase metadata inspection found `public.syrimarket_catalog_cache` has RLS enabled, no anon/authenticated grants, and no policies. This is consistent with keeping the cache inaccessible to normal client roles; continue to access it only through trusted server-side/service-role operations and never expose its cost fields in customer APIs.
- Important limitation: earlier public Git commits may still be reachable through repository history even after the current branch/file was sanitized. The current branch and default-branch file are redacted, but this review does not claim that old Git objects have been purged from GitHub's historical storage. For full historical removal, repository-history rewriting or making the repository private would require a separate, carefully planned action because it can affect deployment and integrations.


## 12. Per-record metadata completeness audit — 2026-11-25
A fresh read-only aggregation was run against the latest `main` cache snapshot (796 products; fetched_at 2026-11-25 01:38:02 UTC). No supplier cost fields were selected or copied into this report.

| Family / state | Products | Missing/empty params | Fulfillment metadata |
|---|---:|---:|---|
| app / ready / available | 552 | 160 | fulfillment_mode and delivery_source absent at family level |
| app / maintenance / unavailable | 14 | 2 | fulfillment_mode and delivery_source absent |
| app / disabled / unavailable | 1 | 0 | fulfillment_mode and delivery_source absent |
| manual / ready / available | 39 | 22 | Mixed account, activation and manual modes; 4 inventory-sourced account entries need special review |
| manual / paused / unavailable | 3 | 2 | activation + manual source |
| smm / ready / available | 50 | 0 | SMM schema present; quantity and URL validation available |
| smm / price_refreshing / unavailable | 4 | 0 | Keep held until refreshed |
| sms / state missing / available flag true | 133 | 133 | No params, service_state, fulfillment_mode or delivery_source in the aggregate |
| **Total** | **796** | **322** | Not launch-ready |

### Findings requiring SKU-level mapping
- **322 records have missing or empty `params`**. This includes 160 app-family records and all 133 SMS records. Do not publish an order form for these records until the required customer input contract is established.
- **All 567 app-family records lack explicit `fulfillment_mode` and `delivery_source` in this cache shape**. The family label alone is not evidence of automatic fulfillment. Require SKU-level supplier documentation or a controlled test before labelling automatic.
- **SMS 133/133** have no service state, no params and no fulfillment metadata despite the supplier availability flag being true. Keep all SMS products held.
- **Manual family** has mixed fulfillment metadata: 4 account + inventory, 4 account + manual, 21 activation + manual, 10 manual + manual; 3 paused activation/manual. All remain MARKET. The 4 inventory-sourced account products must not be treated as automatic without explicit evidence.
- The 9 app-family names containing manual wording remain unresolved/held as described above; name and metadata conflicts must be resolved per SKU.
- SMM records have structured quantity and link fields; they still require separate per-1,000 calculation and supplier behavior checks. No SMM rates or supplier costs are published here.

### Next operational classification sequence
1. Map every SKU to its exact customer input fields and fulfillment evidence.
2. Resolve the 160 app records with missing params, then the 133 SMS records (held).
3. Validate the 4 inventory-sourced manual-family account records.
4. Validate each SMM service's min/max/step, URL rules, cancel/refill behavior and unit semantics.
5. Only after metadata completeness, prepare the private landed-cost worksheet and compare the previously requested 5%, 8%, and 10% gross-margin scenarios. No retail price is approved by this audit.
