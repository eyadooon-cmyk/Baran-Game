import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const gateway = await readFile(new URL("../supabase/functions/baran-order-gateway/index.ts", import.meta.url), "utf8");
const storefront = await readFile(new URL("../baran-homscard-instant-apps.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../baran-homscard-instant-apps.css", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

test("HomsCard instant app catalog is restricted to the approved variable-quantity IDs", () => {
  assert.match(gateway, /action === "homscard_app_catalog"/);
  assert.match(gateway, /const allowedAppIds = \["18","280","49","37","3","1","45","8","43","25","893","910"\]/);
  assert.match(gateway, /data\.product_type !== "quantity"/);
  assert.match(gateway, /data\.available !== true/);
  assert.match(gateway, /sale_unit_usd/);
});

test("instant app checkout requests a server quote and never creates an order or charges a wallet", () => {
  assert.match(storefront, /action:"homscard_app_quote"/);
  assert.match(storefront, /معرّف الحساب/);
  assert.match(storefront, /الكمية المطلوبة/);
  assert.match(storefront, /مراجعة السعر/);
  assert.match(gateway, /mode: "read_only_quote"/);
  assert.match(gateway, /can_create_order: false/);
  assert.match(gateway, /charged: false/);
  assert.doesNotMatch(storefront, /wallet_deduct|create_order|fulfill_order/);
});

test("mobile-first HomsCard app catalog assets are loaded by the customer storefront", () => {
  assert.match(html, /baran-homscard-instant-apps\.css/);
  assert.match(html, /baran-homscard-instant-apps\.js/);
  assert.match(styles, /@media\(max-width:360px\)/);
  assert.match(styles, /\.baran-ia-modal/);
});
