import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const ui = read("../baro.js");
const edge = read("../supabase/functions/baran-baro-manual/index.ts");
const schema = read("../supabase/migrations/20261116000100_leo_manual_fulfillment.sql");
const gates = read("../supabase/migrations/20261116125528_baro_manual_global_switch_and_order_gate.sql");
const hardening = read("../supabase/migrations/20261116141910_harden_baro_manual_workflow.sql");

test("Leo catalogue contains exactly the reviewed 30 products and remains hidden by default", () => {
  const seeded = schema.match(/\('LEO_[A-Z0-9_]+',/g) ?? [];
  assert.equal(seeded.length, 30);
  assert.doesNotMatch(schema, /LEO_PUBG_UC_(?:3850|8100)/);
  assert.match(hardening, /delete from public\.leo_manual_products[\s\S]*LEO_PUBG_UC_3850[\s\S]*LEO_PUBG_UC_8100/);
  assert.match(schema, /catalog_visible boolean not null default false/);
  assert.match(schema, /purchase_enabled boolean not null default false/);
});

test("BARO customer orders are authenticated and use the signed-in user's ID", () => {
  assert.match(edge, /auth\.getUser\(token\)/);
  assert.match(edge, /p_user_id:user\.id/);
  assert.match(edge, /baro_manual_create_customer_order/);
  assert.match(edge, /admin\.from\("leo_manual_orders"\).*\.eq\("user_id",user\.id\)/s);
});

test("BARO manual switch is OFF by default and independent of automatic fulfilment", () => {
  assert.match(gates, /create table if not exists public\.baro_manual_settings/);
  assert.match(gates, /enabled boolean not null default false/);
  assert.match(gates, /coalesce\(v_enabled,false\) is not true/);
  assert.doesNotMatch(gates, /baran_automatic_fulfillment_settings/);
});

test("BARO product pricing and visibility are saved through one atomic RPC", () => {
  assert.match(ui, /action:"product_save"/);
  assert.match(edge, /baro_manual_product_save_atomic/);
  assert.match(hardening, /baro_manual_product_update_atomic\([\s\S]*?baro_manual_product_configure_atomic/);
  assert.match(hardening, /p_purchase_enabled[\s\S]*?sale_price_syp/);
});

test("Order status transitions prevent reopening terminal orders", () => {
  assert.match(hardening, /when 'completed' then false[\s\S]*when 'cancelled' then false/);
  assert.match(hardening, /انتقال حالة الطلب غير مسموح/);
  assert.match(ui, /nextStates=/);
});

test("BARO remains isolated from wallet debit and automatic dispatch", () => {
  assert.match(hardening, /'wallet_changed',false/);
  assert.match(hardening, /'finance_posted',false/);
  assert.match(gates, /public\.baro_manual_settings/);
  assert.doesNotMatch(gates, /baran_supplier_prepare_order/);
  assert.doesNotMatch(edge, /wallet_(?:debit|charge)|dispatch_supplier_order/i);
});

test("Legacy BARO order update endpoint is disabled", () => {
  assert.equal(edge.includes('body.action==="order_update"'), false);
  assert.doesNotMatch(edge, /baro_manual_order_update_atomic/);
  assert.match(edge, /order_admin_update/);
});

test("Customer catalogue does not expose internal supplier cost or unquoted sale prices", () => {
  const catalogBlock = edge.split('if(req.method==="GET"&&view==="catalog")')[1]?.split('if(req.method==="GET"&&view==="my_orders")')[0] ?? "";
  assert.match(catalogBlock, /select\("product_code,category_id,group_id,product_name,input_label,purchase_enabled"\)/);
  assert.doesNotMatch(catalogBlock, /supplier_cost_usd|sale_price_usd|sale_price_syp/);
});
