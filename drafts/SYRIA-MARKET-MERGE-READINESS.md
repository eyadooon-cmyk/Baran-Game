# Syria Market — merge readiness and post-merge plan
Date: 2026-11-25
PR: #177
Branch: `draft/syria-market-display-pricing-review-20261125`
Base: `main`
Current branch head at document preparation: `f54ea45422d250116a9bf65845079c53607407b5`

## 1. What this PR contains
This PR is documentation and a standalone draft HTML preview only. It does not change Baran's customer application code, database schema, product rows, prices, wallet, payments, orders, supplier integration, or fulfillment.

Included files:
1. `drafts/SYRIA-MARKET-PRODUCT-DISPLAY-PRICE-REVIEW.md`
2. `drafts/SYRIA-MARKET-QUANTITY-INPUT-AUDIT.md`
3. `drafts/SYRIA-MARKET-CATEGORY-PLATFORM-CONSISTENCY.md`
4. `drafts/SYRIA-MARKET-PRICE-STRUCTURE-AUDIT.md`
5. `drafts/SYRIA-MARKET-VISUAL-ASSET-AUDIT.md`
6. `drafts/SYRIA-MARKET-LIVE-DISPLAY-CONTRACT-AUDIT.md`
7. `drafts/SYRIA-MARKET-BARAN-CATEGORY-MAPPING-WORKSHEET.md`
8. `drafts/SYRIA-MARKET-BARAN-PRODUCT-CROSSWALK.md`
9. `drafts/syria-market-product-preview.html`

## 2. Pre-merge checks performed
- Branch comparison: 15 commits ahead of `main`, 0 behind at last comparison.
- Diff: 9 files at last comparison, all added; 0 deletions.
- PR state: open, draft, mergeable reported true, not merged.
- Review submissions: none found at last check.
- Inline review threads: none found at last check.
- GitHub Actions PR workflow runs for the latest inspected commit: none returned.
- Commit combined status checks for the latest inspected commit: none returned. This means no reported CI result—not a passing CI suite.
- Standalone preview static checks: HTML5 doctype, Arabic RTL, viewport, search/sort/product grid hooks, balanced script/style tags, no order/checkout action patterns, fixed sample data, explicit supplier-cost label, pending retail label, and disabled-order notice all passed.
- Crosswalk count reconciliation: 35 Baran rows = 14 strong candidates + 3 conditional + 3 related/unresolved + 15 without exact supplier match.
- Active Baran product snapshot: 35 rows; all 35 lack a positive USD price in the inspected field.

## 3. Merge boundary
The merge of these draft documents/preview is not production activation. Even if merged:
- Do not expose the preview as the live customer catalog.
- Do not import supplier products or update categories.
- Do not set customer prices in this PR.
- Do not enable checkout, order submission, supplier API calls, wallet debits, payments, or fulfillment.
- Do not change BARO.
- Keep the 109 deferred classification items deferred.

A human review of the PR description, all 9 included files, and the current branch diff is still required before merge. The branch's mergeable flag does not replace review or CI.

## 4. Post-merge pricing phase (separate task)
After this documentation PR is merged and the user explicitly starts the pricing phase:
1. Re-read the current 35 Baran rows and the latest approved supplier snapshot; do not rely on stale cached prices.
2. Confirm the canonical supplier ID for each accepted product mapping; keep unmatched and conditional rows blocked.
3. Establish the approved retail margin/fee policy, including payment/supplier costs and minimum profit rules.
4. Confirm the SYP exchange-rate source, timestamp/refresh cadence, precision, and rounding policy.
5. Calculate proposed USD and SYP prices in a review-only sheet first; show supplier cost privately and customer price separately.
6. Reconcile every proposal against the product denomination, region/server, delivery method, and current supplier availability.
7. Obtain explicit approval before any production price write.
8. Keep order activation disabled until server-side quote validation, supplier idempotency, wallet checks, failure/refund handling, and audit logging are separately tested and approved.

## 5. Scope protection
- Syria Market only.
- BARO remains separate and untouched.
- The 109 deferred items remain deferred.
- No database writes or supplier calls were performed as part of this readiness review.
