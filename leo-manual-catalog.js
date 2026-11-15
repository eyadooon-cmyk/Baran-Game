// BARAN GAME — Leo manual fulfilment catalogue
// Source: user's Leo app screenshots in ليـو.zip (uploaded 2026-11-15).
// These are observed supplier costs for internal reference only, NOT customer sale prices.
// Do not connect this catalogue to Syria Market or to the supplier API dispatcher.
// All items remain disabled for purchase until the manual workflow is built and tested.

export const LEO_MANUAL_CATALOG = Object.freeze({
  source: "leo_app",
  sourceLabel: "Leo mobile app",
  fulfilmentMode: "manual",
  supplierApi: false,
  observedAt: "2026-11-15",
  currency: "USD",
  pricesAre: "observed_cost_snapshot",
  purchaseEnabled: false,
  categories: [
    {
      id: "pubg",
      title: "PUBG MOBILE",
      inputLabel: "PUBG Player ID",
      groups: [
        {
          id: "uc",
          title: "شدّات UC",
          products: [
            { code: "LEO_PUBG_UC_60", name: "60 UC", observedCostUsd: 0.93 },
            { code: "LEO_PUBG_UC_325", name: "325 UC", observedCostUsd: 4.53 },
            { code: "LEO_PUBG_UC_660", name: "660 UC", observedCostUsd: 9.03 },
            { code: "LEO_PUBG_UC_1800", name: "1800 UC", observedCostUsd: 22.43 },
            { code: "LEO_PUBG_UC_3850", name: "3850 UC", observedCostUsd: 45.04 },
            { code: "LEO_PUBG_UC_8100", name: "8100 UC", observedCostUsd: 89.50 }
          ]
        },
        {
          id: "growth",
          title: "حزم الازدهار",
          products: [
            { code: "LEO_PUBG_GROWTH_FIRST_PURCHASE", name: "حزمة الشراء الأول", observedCostUsd: 0.90 },
            { code: "LEO_PUBG_GROWTH_WEAPON_UPGRADE", name: "حزمة ترقية الأسلحة النارية", observedCostUsd: 2.69 },
            { code: "LEO_PUBG_GROWTH_MYTHIC_EMBLEM", name: "حزمة الشعار الخرافي", observedCostUsd: 4.48 },
            { code: "LEO_PUBG_GROWTH_WEEKLY_DEAL_1", name: "حزمة الصفقة الأسبوعية 1", observedCostUsd: 0.97 },
            { code: "LEO_PUBG_GROWTH_WEEKLY_DEAL_2", name: "حزمة الصفقة الأسبوعية 2", observedCostUsd: 2.96 },
            { code: "LEO_PUBG_GROWTH_WEEKLY_MYTHIC_EMBLEM", name: "حزمة الشعار الخرافي الأسبوعية", observedCostUsd: 2.70 },
            { code: "LEO_PUBG_PRIME_1M", name: "Prime — شهر واحد", observedCostUsd: 0.90 },
            { code: "LEO_PUBG_PRIME_3M", name: "Prime — 3 أشهر", observedCostUsd: 2.70 },
            { code: "LEO_PUBG_PRIME_6M", name: "Prime — 6 أشهر", observedCostUsd: 5.39 },
            { code: "LEO_PUBG_PRIME_12M", name: "Prime — 12 شهراً", observedCostUsd: 10.78 },
            { code: "LEO_PUBG_PRIME_PLUS_1M", name: "Prime Plus — شهر واحد", observedCostUsd: 8.98 },
            { code: "LEO_PUBG_PRIME_PLUS_3M", name: "Prime Plus — 3 أشهر", observedCostUsd: 26.93 },
            { code: "LEO_PUBG_PRIME_PLUS_6M", name: "Prime Plus — 6 أشهر", observedCostUsd: 53.44 },
            { code: "LEO_PUBG_PRIME_PLUS_12M", name: "Prime Plus — 12 شهراً", observedCostUsd: 107.10 }
          ]
        }
      ]
    },
    {
      id: "freefire",
      title: "FREE FIRE",
      inputLabel: "Free Fire Player ID",
      groups: [
        {
          id: "diamonds",
          title: "الجواهر",
          products: [
            { code: "LEO_FREEFIRE_DIAMONDS_110", name: "110 جوهرة", observedCostUsd: 0.96 },
            { code: "LEO_FREEFIRE_DIAMONDS_210", name: "210 جوهرة", observedCostUsd: 1.91 },
            { code: "LEO_FREEFIRE_DIAMONDS_583", name: "583 جوهرة", observedCostUsd: 4.75 },
            { code: "LEO_FREEFIRE_DIAMONDS_1188", name: "1188 جوهرة", observedCostUsd: 9.69 },
            { code: "LEO_FREEFIRE_DIAMONDS_2420", name: "2420 جوهرة", observedCostUsd: 18.99 }
          ]
        },
        {
          id: "memberships",
          title: "العضويات",
          products: [
            { code: "LEO_FREEFIRE_MEMBERSHIP_WEEKLY", name: "عضوية أسبوعية", observedCostUsd: 2.28 }
          ]
        }
      ]
    },
    {
      id: "jawaker",
      title: "Jawaker",
      inputLabel: "Jawaker ID",
      groups: [
        {
          id: "tokens",
          title: "جواكر توكنز",
          products: [
            { code: "LEO_JAWAKER_TOKENS_SERVER_1", name: "جواكر سيرفر 1 — الحد الأدنى 10,000 توكن", observedCostUsd: 1.09 },
            { code: "LEO_JAWAKER_TOKENS_SERVER_2", name: "جواكر سيرفر 2 — الحد الأدنى 10,000 توكن", observedCostUsd: 1.09 }
          ]
        },
        {
          id: "boosters",
          title: "مسرّعات جواكر",
          products: [
            { code: "LEO_JAWAKER_BOOSTER_RED", name: "المسرّع الأحمر", observedCostUsd: 1.64 },
            { code: "LEO_JAWAKER_BOOSTER_BLUE", name: "المسرّع الأزرق", observedCostUsd: 8.43 },
            { code: "LEO_JAWAKER_BOOSTER_BLACK", name: "المسرّع الأسود", observedCostUsd: 14.63 },
            { code: "LEO_JAWAKER_BOOSTER_GOLD", name: "المسرّع الذهبي", observedCostUsd: 25.77 }
          ]
        }
      ]
    }
  ]
});

export function flattenLeoManualCatalog(catalog = LEO_MANUAL_CATALOG) {
  return catalog.categories.flatMap(category =>
    category.groups.flatMap(group =>
      group.products.map(product => ({
        ...product,
        categoryId: category.id,
        categoryTitle: category.title,
        groupId: group.id,
        groupTitle: group.title,
        inputLabel: category.inputLabel,
        fulfilmentMode: "manual",
        source: "leo_app",
        purchaseEnabled: false,
        salePriceUsd: null
      }))
    )
  );
}
