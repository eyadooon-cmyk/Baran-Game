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

test("BARO customer order retries are idempotent and serialized per user", () => {
  const migration = read("../supabase/migrations/20261116153000_baro_manual_idempotent_customer_orders.sql");
  assert.match(migration, /add column if not exists idempotency_key uuid/);
  assert.match(migration, /unique index if not exists leo_manual_orders_user_idempotency_uidx/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /where user_id=p_user_id and idempotency_key=p_idempotency_key/);
  assert.match(migration, /replayed',true/);
  assert.doesNotMatch(migration, /baro_manual_create_customer_order_without_global_gate\(/);
  assert.match(edge, /p_idempotency_key:idempotencyKey/);
  assert.match(edge, /uuidPattern\.test\(idempotencyKey\)/);
  assert.match(ui, /baroPendingSubmission/);
  assert.ok(ui.includes('globalThis.sessionStorage?.setItem("baro_pending_order_retry"') || ui.includes('sessionStorage?.setItem("baro_pending_order_retry"'));
  assert.ok(ui.includes('globalThis.sessionStorage?.getItem("baro_pending_order_retry"') || ui.includes('sessionStorage?.getItem("baro_pending_order_retry"'));
  assert.match(ui, /idempotency_key:pending\.idempotency_key/);
  assert.match(ui, /catch\{message\.textContent=successMessage/);
});

test("Legacy BARO order update endpoint is disabled", () => {
  assert.equal(edge.includes('body.action==="order_update"'), false);
  assert.doesNotMatch(edge, /baro_manual_order_update_atomic/);
  assert.match(edge, /order_admin_update/);
});

test("BARO data tables remain private and legacy update RPC is removed", () => {
  for (const table of ["leo_manual_products","leo_manual_orders","leo_manual_order_events"]) {
    assert.ok(schema.includes("alter table public."+table+" enable row level security"));
    assert.ok(schema.includes("revoke all on public."+table+" from anon, authenticated"));
  }
  const dropLegacy = read("../supabase/migrations/20261116153300_remove_legacy_baro_order_update_rpc.sql");
  assert.ok(dropLegacy.includes("drop function if exists public.baro_manual_order_update_atomic"));
  const settingsIndex = read("../supabase/migrations/20261116153200_index_baro_manual_settings_updated_by.sql");
  assert.match(settingsIndex, /baro_manual_settings_updated_by_idx/);
});

test("Customer catalogue does not expose internal supplier cost or unquoted sale prices", () => {
  const catalogBlock = edge.split('if(req.method==="GET"&&view==="catalog")')[1]?.split('if(req.method==="GET"&&view==="my_orders")')[0] ?? "";
  assert.match(catalogBlock, /select\("product_code,category_id,group_id,product_name,input_label,purchase_enabled"\)/);
  assert.doesNotMatch(catalogBlock, /supplier_cost_usd|sale_price_usd|sale_price_syp/);
});


test("BARO is embedded inside the existing BARAN customer app and admin panel", () => {
  const app = read("../index.html");
  assert.match(app, /<section id="baroManual" class="hidden">/);
  assert.match(app, /onclick="showSection\('baroManual',this\);loadBaroCustomer\(\)"/);
  assert.match(app, /data-admin-panel="baro"/);
  assert.match(app, /onclick="showAdminPanel\('baro'\)"/);
  assert.match(app, /loadBaroAdmin\(\)/);
  assert.match(app, /loadBaranAutomaticControl\(\)/);
});

test("BARO and automatic fulfilment remain separate client modules and controls", () => {
  const app = read("../index.html");
  const automatic = read("../automatic-fulfillment.js");
  assert.match(app, /src="\.\/automatic-fulfillment\.js/);
  assert.match(app, /src="\.\/baro\.js/);
  assert.match(automatic, /baranAutomaticEnabled/);
  assert.match(automatic, /baran-automatic-fulfillment-control/);
  assert.doesNotMatch(automatic, /baroEndpoint|baro_manual/);
  assert.doesNotMatch(ui, /baranAutomaticControlUrl|baran_supplier_prepare_order/);
});

const channelGuard = read("../supabase/migrations/20261116170000_shared_channel_order_guard_and_product_routes.sql");

test("Automatic and manual orders share one per-user request lock", () => {
  assert.match(channelGuard, /create table if not exists public\.baran_order_channel_guard/);
  assert.match(channelGuard, /primary key \(user_id,client_request_id\)/);
  assert.match(channelGuard, /baran_claim_order_channel/);
  assert.match(channelGuard, /v_claim\.channel is distinct from p_channel/);
  assert.match(channelGuard, /baran_guard_manual_order_insert/);
  assert.match(channelGuard, /baran_guard_automatic_order_insert/);
  assert.match(channelGuard, /new\.idempotency_key,'manual'/);
  assert.match(channelGuard, /new\.client_request_id,'automatic'/);
  assert.match(channelGuard, /baran_link_manual_order_channel/);
  assert.match(channelGuard, /baran_link_automatic_order_channel/);
  assert.match(channelGuard, /No function here releases a claim/);
});

test("Product route candidates are not executable until reviewed and approved", () => {
  assert.match(channelGuard, /create table if not exists public\.baran_channel_product_routes/);
  assert.match(channelGuard, /mapping_status text not null default 'pending_review'/);
  assert.match(channelGuard, /route_enabled boolean not null default false/);
  assert.match(channelGuard, /check \(route_enabled = false or mapping_status = 'approved'\)/);
  assert.match(channelGuard, /مرشح فقط/);
  assert.match(channelGuard, /route_enabled=false/);
});
