# BARAN GAME — Leo Manual Fulfilment

Status: feature-branch implementation baseline  
Branch: `feature/lio-manual-fulfillment`  
Provider: Leo mobile application  
Fulfilment mode: manual by the store administrator; Leo has no API integration in this workflow.

## 1. Strict separation

Leo is a standalone manual fulfilment route. It must never be routed through, or share operational records with:
- Syria Market API catalogue and supplier dispatcher.
- Existing `products`, `orders`, `supplier_products`, or `order_fulfillment` workflows.
- Existing supplier API credentials, mappings, execution gates, or automated order dispatch.

Leo has its own `leo_manual_products`, `leo_manual_orders`, and `leo_manual_order_events` tables, its own admin-only Edge Function (`baran-leo-manual`), and its own admin page (`leo-manual-admin.html`).

## 2. Catalogue scope

- PUBG MOBILE: 6 UC packages and 14 Growth / Prime / Prime Plus packages.
- Free Fire: 5 diamond packages and one weekly membership.
- Jawaker:
  - `جواكر توكنز`: Server 1 and Server 2.
  - `مسرّعات جواكر`: red, blue, black, and gold; a sibling group beside Tokens, not nested under it.

The 32 reference costs were transcribed from the owner's Leo screenshots dated 2026-11-15. They are historic observations only, not confirmed current costs. They are stored in `reference_cost_usd`; actual current supplier cost remains null until the owner verifies it in Leo.

## 3. Commercial controls

Each product has separate fields for:
- Reference cost from screenshots.
- Current confirmed supplier cost (USD).
- BARAN sale price (USD).
- BARAN sale price (SYP).
- Catalogue visibility remains locked off until a separate customer-facing catalogue integration is reviewed.
- Purchase-enabled state.

No screenshot cost is copied into the actual cost or sale-price fields. No sale price is invented. The database migration constrains `purchase_enabled = false`; the Edge Function also forces it to false. The customer catalogue shows products as unavailable.

## 4. Admin workflow currently implemented

- Dedicated admin page linked from the admin supplier section.
- Server-side administrator verification through `admin_is_user`.
- Product cost and sale-price fields can be saved only through the Edge Function.
- Product changes are written to `admin_audit_log`.
- Orders are read only when present; status-update handler is reserved for the later manual queue.
- Completion requires an actual supplier cost and either a supplier transaction reference or a documented exception reason.
- Order status changes append a separate `leo_manual_order_events` row and an admin audit entry.

## 5. Financial and security boundaries

- No customer order creation is exposed yet.
- No wallet debit, credit, refund, payment confirmation, or finance ledger posting is implemented in the Leo route.
- The function does not call the Syria Market dispatcher or the generic order gateway.
- Direct `anon` and `authenticated` table access is revoked; RLS is enabled. The Edge Function uses a server key only after verifying the user's session and administrator role.
- Unknown or uncertain manual fulfilment outcomes must be marked `needs_review`; never auto-retry or auto-refund.
- Do not expose internal costs, admin notes, supplier references, or exception reasons to customers.

## 6. Deployment state

All changes are on `feature/lio-manual-fulfillment` only. Do not merge to `main`, apply the migration to the production database, or deploy the Edge Function until the owner reviews and approves the implementation. GitHub Pages currently builds from `main`, so this feature branch is not the published storefront.

## 7. Remaining work before any real order

1. Review the migration and apply it only after approval.
2. Deploy `baran-leo-manual` only after the tables exist and the admin role check is tested.
3. Test admin access with an admin and a normal customer; confirm the latter receives 403.
4. Test product updates, validation failures, audit logging, and disabled purchase state.
5. Build the dedicated manual order intake and queue, but keep customer checkout disabled.
6. Add ID/name verification and duplicate-order protections.
7. Test success, failure, unknown outcome, and manual review paths.
8. Only after all tests, review whether a customer order submission and any financial integration should be enabled. No activation is implied by this specification.
