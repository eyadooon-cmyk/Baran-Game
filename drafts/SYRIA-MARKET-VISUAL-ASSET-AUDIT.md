# Syria Market — visual asset and product-name display audit
**Snapshot:** 2026-11-25  
**Source:** read-only inspection of cached product/category JSON.  
**Scope:** display metadata only; no asset URLs are rewritten and no catalog data is changed.

## 1) Image metadata coverage

| Check | Result |
|---|---:|
| Products inspected | 796 |
| Products with `category_img` path | 625 |
| Products without `category_img` path | 171 |
| Distinct `category_img` paths | 105 |
| Category objects with image/image_url/category_img field | 0 |
| Product objects with a populated `image` field | 0 |

The current product cache exposes `category_img` paths, not a separate populated product-image field. Category objects contain only `id` and `name`; they do not provide category-image URLs.

The `category_img` values are relative paths (for example, `/static/uploads/products/...`). Their origin host and public accessibility are not proven by this cache. Do not convert them into absolute URLs by guessing a supplier domain. Until the official asset base URL is confirmed, the preview should use a neutral category visual/fallback rather than broken image links.

## 2) Product-name cleanup flag

One product name contains leading and trailing newline characters:

| Product ID | Category | Issue |
|---|---|---|
| 1036 | خدمات واتساب | Name starts and ends with newline characters |

Do not rewrite the cached supplier name. In a future display layer, trim outer whitespace for presentation while preserving the original source value for traceability.

## 3) SKU field

All 796 products have a null `sku` field in this cache. The product `id` is populated and unique for all 796 records, so the display/admin reference should use the product ID unless the supplier later supplies a stable SKU contract.

## 4) Display recommendations
1. Use existing approved BARAN category artwork as a visual fallback where a product image is not supplied.
2. Do not expose raw relative `category_img` paths as browser image sources until the supplier asset host is confirmed and tested.
3. Add lazy-loaded images only after URL accessibility is verified.
4. Trim leading/trailing whitespace in rendered product names only; preserve source values in audit/admin data.
5. Use supplier product ID as the stable internal reference; do not depend on null SKU values.

## 5) Decision
**Visual asset readiness is partial.** 625 records carry a category-image path, but no absolute asset host is verified; 171 have no such path. The current cache does not supply individual product images or category-level image metadata. This is a presentation limitation, not a reason to alter the supplier cache or block the separate draft review.
