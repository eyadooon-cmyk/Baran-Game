# BARAN GAME — HomsCard Chat Apps Catalog Draft

**Prepared:** 2026-11-27  
**Status:** Review-ready draft only — not published, not imported into `public.products`, and not connected to checkout or fulfillment.  
**Supplier source:** saved read-only audit run `0dd93de4-34f5-4c2d-a6d5-8dc644c26605` (2026-11-26).  
**Scope:** the 12 agreed chat/social-live apps only. All other categories are out of scope.

## Approved shortlist from the saved audit

All 12 rows below had API `available=true`, supplier page audit `success`, page availability `available`, product type `quantity`, and an empty audit `missing` list. Supplier product images below are the API image fields from the saved audit. Use these as product artwork in the draft; do not use the HomsCard logo or the malformed template image URL found among page image candidates.

| App | HomsCard product ID | API cost (USD/unit) | HomsCard page price (USD/unit) | Min–max quantity | Customer input |
|---|---:|---:|---:|---:|---|
| BIGO LIVE | 18 | 0.01799992 | 0.0182 | 50–1,000,000 | Player ID |
| Poppo Live | 3 | 0.00010544 | 0.000107 | 100–10,000,000 | Player ID |
| Chamet | 280 | 0.00017337 | 0.000175 | 15,000–10,000,000 | Player ID |
| Tango | 8 | 0.00563239 | 0.005689 | 200–150,000 | Player ID |
| Likee | 910 | 0.01868778 | 0.0189 | 50–50,000 | USER ID |
| MICO Live | 37 | 0.00033809 | 0.000342 | 100–10,000,000 | Player ID |
| TopTop | 43 | 0.00003035 | 0.000031 | 15,000–25,000,000 | Player ID |
| Soul Chill | 1 | 0.00177999 | 0.001798 | 1,000–600,000 | Player ID |
| SUGO | 893 | 0.00014473 | 0.000146 | 10,000–4,000,000 | ID User |
| YoHo | 25 | 0.00010379 | 0.000105 | 10,000–5,000,000 | Player ID |
| Hawa | 49 | 0.00057013 | 0.000576 | 1,000–1,000,000 | Player ID |
| Taka | 45 | 0.00010461 | 0.000106 | 100–10,000,000 | Player ID |

## Product artwork

Use the following exact API image URLs from the saved audit for the 12 shortlist cards.

| App | Image |
|---|---|
| BIGO LIVE | https://dailycard-media.s3.amazonaws.com/product_packages_images/تنزيل_19.jpeg |
| Poppo Live | https://dailycard-media.s3.amazonaws.com/product_packages_images/تنزيل_29.jpeg |
| Chamet | https://dailycard-media.s3.amazonaws.com/product_packages_images/تنزيل_88.jpeg |
| Tango | https://dailycard-media.s3.amazonaws.com/product_packages_images/تنزيل_4.jpeg |
| Likee | https://dailycard-media.s3.amazonaws.com/product_packages_images/1000499218.png |
| MICO Live | https://dailycard-media.s3.amazonaws.com/product_packages_images/تنزيل_7.png |
| TopTop | https://dailycard-media.s3.amazonaws.com/product_packages_images/تنزيل_10.png |
| Soul Chill | https://dailycard-media.s3.amazonaws.com/product_packages_images/s.png |
| SUGO | https://dailycard-media.s3.amazonaws.com/product_packages_images/تنزيل.png |
| YoHo | https://dailycard-media.s3.amazonaws.com/product_packages_images/تنزيل_3.png |
| Hawa | https://dailycard-media.s3.amazonaws.com/product_packages_images/تنزيل_47.jpeg |
| Taka | https://dailycard-media.s3.amazonaws.com/product_packages_images/تنزيل_43.jpeg |

## Items intentionally isolated — do not show in the main 12-card list

- **WePlay** (IDs 283, 282, 458): package-type rows; quantity/options contract is not established by the saved audit. Keep isolated pending a clear product/variant contract.
- **Saya Likee** (ID 392): supplier product page audit failed with an embedded connection-error message. This does not prove the product is unavailable; keep isolated.
- **BIGO HK** (ID 498): regional variant; do not merge with BIGO LIVE until regional targeting is explicitly decided.
- **SUGO TR** (IDs 1276–1282): regional package variants; keep separate from the base SUGO quantity product.
- **SUGO fixed package** (ID 384): API reported unavailable; keep isolated.
- **Yohoo Star** (ID 464): distinct star product, not the base YoHo item; keep isolated.

## Display and safety contract for the future storefront card

- Category label: **الدردشة والبث المباشر**.
- Each card shows app image, app name, unit label, and customer-entered quantity.
- Quantity input must enforce the exact min/max range in the table; reject values outside it.
- Show exactly one required ID field using the label in the table. Trim whitespace; do not invent extra fields.
- Keep API unit cost and supplier page unit price internal to admin review. Neither is an approved BARAN retail price.
- Retail price, margin, rounding, currency conversion, and customer-facing final price remain unset until a separate pricing decision.
- No supplier purchase, top-up, wallet debit, order submission, or live API request is enabled by this draft.
- Before production release, verify image loading in the actual storefront and perform a separately authorized fulfillment-contract test.

## Data-quality notes

- The supplier page image arrays also contained the HomsCard logo and a malformed literal template URL. Those are deliberately excluded from the card artwork list.
- The min/max and unit-price values above are from the previously completed audit review; do not infer them from the API image or product name.
- “Available” reflects the saved audit snapshot only, not a guarantee of future stock or successful fulfillment.
