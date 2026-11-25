# Syria Market — category and supplier-platform consistency audit
**Snapshot:** 2026-11-25  
**Source:** read-only inspection of `public.syrimarket_catalog_cache`  
**Scope:** category metadata and the 54 SMM records only. The 109 deferred classification items are not reopened.

## Safety boundary
- Draft documentation only. No live catalog or category edits.
- No publication, order activation, price changes, or supplier calls.
- BARO remains separate.
- Do not infer a corrected category or platform from a product title alone.

## 1) SMM category/platform combinations

| Category name | Supplier platform | Count | Product IDs |
|---|---|---:|---|
| خدمات انستجرام | instagram | 3 | 1660, 1661, 1684 |
| خدمات تيك توك | tiktok | 2 | 1108, 1110 |
| خدمات تيك توك | instagram | 3 | 1072, 1109, 1111 |
| خدمات تيليجرام | telegram | 4 | 1663, 1664, 1665, 1667 |
| خدمات تيليجرام | instagram | 1 | 1666 |
| خدمات فيسبوك | facebook | 9 | 1020, 1021, 1022, 1023, 1024, 1025, 1032, 1035, 1127 |
| خدمات واتساب | whatsapp | 5 | 1059, 1060, 1061, 1062, 1063 |
| خدمات واتساب | instagram | 27 | 1007, 1008, 1009, 1010, 1036, 1037, 1038, 1039, 1040, 1041, 1042, 1043, 1044, 1045, 1046, 1047, 1048, 1049, 1050, 1051, 1052, 1053, 1054, 1055, 1056, 1057, 1058 |

**Result:** 31 records have an apparent category/platform mismatch:
- 27 WhatsApp-category products whose supplier platform is `instagram`.
- 3 TikTok-category products whose supplier platform is `instagram`.
- 1 Telegram-category product whose supplier platform is `instagram`.

These are supplier metadata/category conflicts, not proof that either field is wrong. The product titles and category paths can describe WhatsApp/TikTok/Telegram content while the provider platform field says Instagram. Keep these records flagged; do not silently move them or rewrite the provider platform.

## 2) Category list integrity

| Check | Result |
|---|---:|
| Category rows in cache | 106 |
| Duplicate category names | 0 |
| Category rows with a populated `id` field | 0 |
| Products with blank category name | 3 |
| Products whose category name is absent from the category list | 3 |

All 106 category objects currently have a null `id` in the cached category list. Product records do carry `parent_id`, but this snapshot does not provide category IDs to join against. Therefore, category-to-parent-ID integrity **cannot be verified from this cache alone**. Do not manufacture category IDs or treat the null IDs as a confirmed supplier defect without checking the upstream contract.

## 3) Three uncategorized manual products

| Product ID | Name | Family/type | parent_id |
|---|---|---|---:|
| 1715 | Mtn Cash | manual / package | 0 |
| 1738 | usdt code | manual / package | 0 |
| 1742 | نجوم تيليجرام | manual / amount | 0 |

These three remain flagged for later category review only. No category assignment is proposed here.

## 4) Recommended display rules
1. Use the approved category name as the customer-facing navigation label only after review.
2. Keep supplier platform metadata separate from category labels; never use it alone to relocate products.
3. For the 31 mismatches, show a review flag in the internal admin preview and hold customer-facing platform-specific badges until confirmed.
4. Keep the three uncategorized manual products out of category navigation until explicitly classified; do not delete or hide them from the source cache.
5. Request/inspect the upstream category object contract before validating `parent_id` against category IDs.

## 5) Decision
**Category display can proceed for records with a known category name, but the 31 SMM metadata conflicts and 3 blank-category records require review.** Category-ID linkage remains unverified because the cache category objects contain no IDs. This audit does not reopen the 109 deferred items and does not approve order activation.
