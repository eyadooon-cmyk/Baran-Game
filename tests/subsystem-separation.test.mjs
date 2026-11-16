import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const syriaPage = read("../syria-market-admin.html");
const baroPage = read("../baro-leo-manual.html");
const syriaApi = read("../supabase/functions/baran-syria-market-read/index.ts");
const baroApi = read("../supabase/functions/baran-baro-manual/index.ts");
const storefront = read("../index.html");

test("Test storefront is isolated from production Supabase", () => {
  assert.match(storefront, /https:\/\/tjvuqgcyvbowyfenrpau\.supabase\.co/);
  assert.doesNotMatch(storefront, /https:\/\/yabpmdzsiuyxxkcqakfs\.supabase\.co/);
  assert.match(storefront, /const BARAN_AUTH_REDIRECT=window\.location\.origin\+window\.location\.pathname/);
  assert.match(storefront, /options:\{redirectTo:BARAN_AUTH_REDIRECT\}/);
});

test("Jawaker customer section exposes only the six approved disabled categories", () => {
  const start = storefront.indexOf('<section id="jawakerStore"');
  const end = storefront.indexOf('<section id="services"', start);
  assert.ok(start >= 0 && end > start, "Jawaker customer section must exist");
  const jawaker = storefront.slice(start, end);
  assert.match(storefront, /showSection\('jawakerStore',null\)/);
  assert.match(storefront, /if\(code\.startsWith\("jawaker"\)\)return "jawakerStore"/);
  for (const label of ["جواكر سيرفر 1", "جواكر سيرفر 2", "المسرّع الأحمر", "المسرّع الأزرق", "المسرّع الأسود", "المسرّع الذهبي"]) {
    assert.ok(jawaker.includes(label), "Missing Jawaker category: " + label);
  }
  assert.equal((jawaker.match(/<button\b[^>]*disabled/g) || []).length, 6);
  assert.match(jawaker, /onclick="showSection\('games',null\)"/);
  assert.doesNotMatch(jawaker, /create_order|order_create|wallet|checkout/i);
});

test("Admin hub routes supplier and manual work to separate pages", () => {
  assert.match(storefront, /window\.location\.href='\.\/syria-market-admin\.html'/);
  assert.match(storefront, /window\.location\.href='\.\/baro-leo-manual\.html'/);
  assert.match(storefront, /if\(id==="suppliers"\)\{window\.location\.href="\.\/syria-market-admin\.html";return;\}/);
  assert.doesNotMatch(storefront, /onclick="showAdminPanel\('suppliers'\)"/);
});

test("Syria Market endpoint requires JWT and administrator authorization", () => {
  assert.match(syriaApi, /auth\.getUser\(token\)/);
  assert.match(syriaApi, /admin_is_user/);
  assert.match(syriaApi, /isAdmin !== true/);
  assert.match(syriaApi, /req\.method !== "GET"/);
});

test("Syria Market endpoint is explicitly read-only and isolated", () => {
  assert.match(syriaApi, /mode: "read_only"/);
  assert.match(syriaApi, /writes_enabled: false/);
  assert.match(syriaApi, /supplier_orders_enabled: false/);
  assert.match(syriaApi, /finance_enabled: false/);
  assert.match(syriaApi, /from\("suppliers"\)/);
  assert.match(syriaApi, /from\("supplier_products"\)/);
  assert.match(syriaApi, /from\("products"\)/);
  assert.doesNotMatch(syriaApi, /from\("(orders|order_fulfillment|leo_manual_orders|leo_manual_products|wallet_transactions)"\)/);
  assert.doesNotMatch(syriaApi, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
});

test("Syria Market page calls only its dedicated read-only endpoint", () => {
  assert.match(syriaPage, /functions\/v1\/baran-syria-market-read/);
  assert.doesNotMatch(syriaPage, /functions\/v1\/(baran-admin|baran-admin-safe-actions|baran-order-gateway|baran-baro-manual)/);
  assert.match(syriaPage, /body\.writes_enabled!==false/);
  assert.match(syriaPage, /body\.supplier_orders_enabled!==false/);
  assert.match(syriaPage, /body\.finance_enabled!==false/);
});

test("BARO LEO page calls only the manual endpoint and exposes no order creation", () => {
  assert.match(baroPage, /functions\/v1\/baran-baro-manual/);
  assert.doesNotMatch(baroPage, /functions\/v1\/(baran-admin|baran-admin-safe-actions|baran-order-gateway|baran-syria-market-read|baran-supplier-manager)/);
  assert.match(baroPage, /action:"product_update"/);
  assert.match(baroPage, /action:"order_update"/);
  assert.doesNotMatch(baroPage, /action:"(create|order_create|submit_order)"/);
});

test("BARO LEO writes use server-side atomic RPCs and never invoke supplier tables", () => {
  assert.match(baroApi, /baro_manual_product_update_atomic/);
  assert.match(baroApi, /baro_manual_order_update_atomic/);
  assert.match(baroApi, /admin_is_user/);
  assert.doesNotMatch(baroApi, /from\("(suppliers|supplier_products|orders|order_fulfillment)"\)/);
});
