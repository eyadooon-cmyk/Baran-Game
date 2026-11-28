import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const pricingMigration = read("../supabase/migrations/20261128145932_per_product_margin_and_homscard_auto_repricing.sql");
const marginTriggerMigration = read("../supabase/migrations/20261128145956_reprice_homscard_product_when_margin_changes.sql");
const variableOrderMigration = read("../supabase/migrations/20261128150243_use_product_specific_margin_for_homscard_variable_orders.sql");
const gateway = read("../supabase/functions/baran-order-gateway/index.ts");
const admin = read("../supabase/functions/baran-admin/index.ts");
const manager = read("../manage-products.html");
const products = read("../products.js");

test("HomsCard products have independent margins and a 4% default", () => {
  assert.match(pricingMigration, /markup_percent numeric\(6,3\) NOT NULL DEFAULT 4\.000/i);
  assert.match(pricingMigration, /product_markup_percent = 4\.000/);
  assert.match(pricingMigration, /PUBG_MOBILE_%' THEN 3\.000/);
  assert.match(pricingMigration, /FREEFIRE_ROBOT_%' THEN 3\.000/);
  assert.match(pricingMigration, /JAWAKER_BOOSTER_RED' THEN 5\.000/);
  assert.match(pricingMigration, /HOMSCARD_WALLET_USDT_BEP20/);
});

test("Supplier cost and margin changes automatically reprice without lowering the price floor", () => {
  assert.match(pricingMigration, /CREATE OR REPLACE FUNCTION public\.sync_homscard_product_usd_price/);
  assert.match(pricingMigration, /greatest\(\s*coalesce\(p\.price_usd, 0\)/);
  assert.match(marginTriggerMigration, /BEFORE UPDATE OF markup_percent/);
  assert.match(marginTriggerMigration, /greatest\(coalesce\(OLD\.price_usd, 0\), coalesce\(NEW\.price_usd, 0\), calculated_usd\)/);
});

test("Fixed, variable and Jawaker quote paths use each product's margin", () => {
  assert.match(gateway, /markup_percent:productMarkup/);
  assert.match(gateway, /marginBySku/);
  assert.match(gateway, /productMarkupPercent/);
  assert.match(gateway, /Array\.isArray\(marginMapping\?\.products\)/);
  assert.match(gateway, /mappedProduct\?\.markup_percent/);
  assert.match(gateway, /product\.markup_percent \?\? settings\.product_markup_percent/);
  assert.match(variableOrderMigration, /coalesce\(p\.markup_percent,ss\.product_markup_percent\)/);
});

test("Admin can view and edit product margin safely", () => {
  assert.match(admin, /markup_percent,is_active,sort_order/);
  assert.match(admin, /markupPercent < 0 \|\| markupPercent > 100/);
  assert.match(admin, /markup_percent: markupPercent/);
  assert.match(manager, /id="productMarkupPercent"/);
  assert.match(products, /productMarkupPercent/);
  assert.match(products, /markup_percent:markupPercent/);
});
