# Syria Market → Baran category mapping worksheet
Date: 2026-11-25
Status: draft mapping proposal only — no supplier product is approved for import, sale, or ordering.

## 1. Read-only snapshot of the current Baran product table
A read-only SQL query was run against `public.products` in Supabase project `yabpmdzsiuyxxkcqakfs`, filtering `is_active = true`.

| Current Baran category | Active rows | Rows with missing or non-positive USD price | Readiness |
|---|---:|---:|---|
| `game` | 32 | 32 | Not price-ready |
| `ai` | 1 | 1 | Not price-ready |
| `gift_card` | 2 | 2 | Not price-ready |
| **Total** | **35** | **35** | **No active row has a usable positive USD price** |

The 35 records are existing Baran catalog rows, not proof that any Syria Market supplier item has been imported or linked. `is_active = true` must not be interpreted as purchase approval. The reviewed UI code separately labels products with missing/non-positive price as in preparation and keeps ordering disabled.

No VPN or generic app row appeared in this active-row snapshot. The front-end contains category handling/aliases for `vpn` and `app`, but that is not evidence of active products in those categories.

## 2. Proposed top-level mapping — pending approval
These are candidate groupings only, based on the current Baran category vocabulary and supplier category labels. They are not automated mapping rules.

| Syria Market supplier family / label | Candidate Baran category | Status | Reason / restriction |
|---|---|---|---|
| PUBG UC / PUBG global top-ups | `game` | Proposed — review names and region | Confirm game, region/server, and delivery method per SKU |
| PUBG Prime / Prime Plus / memberships | `game` | Proposed — separate subtype | Do not merge memberships with UC packages; retain duration and entitlement |
| Free Fire ID top-ups / diamonds | `game` | Proposed — review | Confirm ID/server fields and each exact diamond package |
| Jawaker tokens / boosters | `game` | Proposed — separate subtypes | Keep server 1 and server 2 separate; keep red/blue/black/gold boosters distinct |
| Google Play gift cards | `gift_card` | Proposed — review region/value | Preserve country/region, currency denomination, and redemption restrictions |
| ChatGPT Plus / AI subscriptions | `ai` | Proposed — review duration/account method | Do not mix plans, durations, or activation methods |
| VPN subscriptions | `vpn` | No active Baran row verified | Candidate category exists in front-end vocabulary; product/term/region still need review |
| Other paid applications | `app` | No active Baran row verified | Candidate category exists in front-end vocabulary; review one product family at a time |
| SMM (Instagram/Facebook/TikTok/Telegram/WhatsApp) | **Unmapped** | Hold | Requires a distinct approved service taxonomy and validated fields; 31 platform/category conflicts remain unresolved |
| SMS / verification services | **Unmapped** | Hold | Supplier offer/input behavior is not sufficiently established from the cached quantity schema |
| Manual credits / MTN / Syriatel / Falla / other manual products | **Unmapped** | Hold | Confirm country, operator, denomination, recipient fields, and manual fulfillment process |
| Unknown / blank supplier category | **Unmapped** | Hold | Never infer a customer category from a blank label or parent ID |

## 3. Product-level mapping register template
Create one row per supplier product only after category decisions are reviewed. Required columns:

- Supplier product ID (source identity; immutable)
- Raw supplier product name (preserve exactly)
- Customer display name (approved, separately stored)
- Supplier category name (raw)
- Supplier platform/type (raw)
- Approved Baran category (`game`, `ai`, `gift_card`, `vpn`, `app`, or a separately approved new category)
- Product subtype (e.g. PUBG UC, PUBG membership, Free Fire ID, Jawaker tokens)
- Region/server/country restriction
- Input schema (none / player ID / UUID / URL / phone / option selection / other)
- Quantity mode (fixed / range / options / supplier-defined offer / SMM per-1000)
- Supplier cost reference (private; never a customer price)
- Approved retail USD price (separate field; blank until approved)
- Approved SYP display price and exchange-rate version (blank until approved)
- Image source and verification status
- Review status and reviewer/date
- Ordering gate (must remain disabled until all required checks pass)

## 4. Mandatory validation rules
1. Keep the raw supplier row unchanged and retain the supplier product ID as the traceable source reference.
2. Never use supplier `parent_id` as a Baran category ID unless an explicit verified mapping record exists.
3. Never expose supplier cost, per-1000 supplier rate, or minimum supplier total as the retail price.
4. Never accept price, quantity, platform, recipient ID, or supplier product ID as trusted merely because it came from the browser; the server must resolve and validate the approved product and calculate the quote.
5. Preserve option-to-price pairing; reject missing, duplicate, or mismatched option mappings.
6. For SMM, validate service/platform compatibility, URL format, quantity limits, and server-side quote before any future order action.
7. For fixed packages, do not display a quantity field unless the supplier contract explicitly requires it.
8. For manual products, show a manual-fulfillment notice and keep order activation blocked until the operator workflow and refund/error path are defined.
9. Image URLs must come from a verified host or Baran-owned asset mapping. Do not construct a URL from a relative supplier path by guessing a domain.
10. Customer-visible price must be positive, approved, and consistent in USD/SYP display. Missing or non-positive price means “قيد التجهيز” and no order.

## 5. Current blockers before any product can be marked sale-ready
- All 35 currently active Baran product rows have null or non-positive USD prices in the read-only snapshot; none is price-ready based on that field.
- Retail margin, rounding, exchange-rate source, and SYP policy are not approved.
- 31 SMM category/platform conflicts remain unresolved.
- 3 supplier products have blank category names.
- Category-to-parent-ID linkage is not provable from the supplier cache snapshot.
- The supplier asset host is not verified; 171 products have no category image path.
- No direct supplier-cache-to-Baran product mapping was established in the reviewed front-end code.

## 6. Scope and safety
- This worksheet does not modify Supabase, import products, set prices, activate orders, or call the supplier.
- The 109 deferred classification items remain deferred.
- BARO remains completely separate.
- Do not merge this draft or activate Syria Market ordering without explicit approval after the mapping and pricing reviews.
