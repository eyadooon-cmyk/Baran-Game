import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const ui = read("../baro.js");
const edge = read("../supabase/functions/baran-baro-manual/index.ts");
const schema = read("../supabase/migrations/20261116000100_leo_manual_fulfillment.sql");
const gates = read("../supabase/migrations/20261116125528_baro_manual_global_switch_and_order_gate.sql");
const hardening = read("../supabase/migrations/20261116141910_harden_baro_manual_workflow.sql");
const baroFinance = read("../supabase/migrations/20261117090000_baro_complete_management.sql");
const baroPermissions = read("../supabase/migrations/20261117093000_baro_complete_permissions.sql");
const baroReporting = read("../supabase/migrations/20261117100000_baro_reporting_and_alert_hardening.sql");
const baroIsolation = read("../supabase/migrations/20261117110000_baro_supplier_isolation_and_backups.sql");
const baroPaymentFx = read("../supabase/migrations/20261117120000_baro_payment_fx_snapshots.sql");
const management = read("../baro-management.js");

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
  assert.match(edge, /p_user_id:\s*user\.id/);
  assert.match(edge, /baro_manual_create_customer_order/);
  assert.match(edge, /admin\.from\("leo_manual_orders"\)[\s\S]*?\.eq\("user_id",\s*user\.id\)/);
});

test("BARO manual switch is OFF by default and independent of automatic fulfilment", () => {
  assert.match(gates, /create table if not exists public\.baro_manual_settings/);
  assert.match(gates, /enabled boolean not null default false/);
  assert.match(gates, /coalesce\(v_enabled,false\) is not true/);
  assert.doesNotMatch(gates, /baran_automatic_fulfillment_settings/);
});

test("BARO product pricing and visibility are saved through one atomic RPC", () => {
  assert.match(ui, /action:"product_save"/);
  assert.match(edge, /baro_manual_product_save_complete_atomic/);
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
  assert.match(edge, /p_idempotency_key:\s*idempotencyKey/);
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

test("Customer BARO catalogue exposes names only and never price or supplier fields", () => {
  const catalogBlock = edge.split('if (req.method === "GET" && view === "catalog")')[1]?.split('if (req.method === "GET" && view === "my_orders")')[0] ?? "";
  assert.match(catalogBlock, /product_code,category_id,group_id,product_name,input_label/);
  assert.doesNotMatch(catalogBlock, /sale_price_usd|sale_price_syp|supplier_cost_usd/);
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
  assert.ok(channelGuard.includes("route_enabled = false"));
});

const channelStatus = read("../supabase/migrations/20261116181000_sync_channel_guard_order_statuses.sql");
test("Automatic supplier pending and unknown states keep the cross-channel claim reserved", () => {
  assert.match(channelStatus, /awaiting_supplier/);
  assert.match(channelStatus, /'processing'/);
  assert.match(channelStatus, /'needs_review'/);
  assert.match(channelStatus, /'failed','rejected'/);
});


const triggerGrantHardening = read("../supabase/migrations/20261116183000_revoke_public_execute_from_channel_trigger_functions.sql");
test("Channel SECURITY DEFINER trigger functions are not callable through the Data API", () => {
  for (const fn of [
    "baran_guard_manual_order_insert",
    "baran_link_manual_order_channel",
    "baran_sync_manual_order_guard_status",
    "baran_guard_automatic_order_insert",
    "baran_link_automatic_order_channel",
    "baran_sync_automatic_order_guard_status"
  ]) {
    assert.match(triggerGrantHardening, new RegExp("revoke all on function public\\."+fn+"\\(\\) from public, anon, authenticated"));
  }
});


test("BARO customer catalogue keeps grouped sections and is not overwritten by the legacy renderer", () => {
  const customerCatalogue = ui.slice(ui.indexOf("function renderBaroCustomerCatalog(products)"), ui.indexOf("async function loadBaroCustomer()"));
  assert.match(customerCatalogue, /const categoryOrder=\["pubg","freefire","jawaker"\]/);
  assert.match(customerCatalogue, /const groupOrder=/);
  assert.match(customerCatalogue, /baro-catalog-category/);
  assert.doesNotMatch(ui, /function baroRenderCustomerProductCards\(\)/);
  assert.doesNotMatch(ui, /loadBaroCustomer=async function\(\)/);
  assert.doesNotMatch(ui, /catalog\.textContent="كتالوج BARO للمعاينة فقط/);
  assert.match(ui, /renderBaroCustomerCatalog\(baroCustomerProducts\)/);
  assert.doesNotMatch(customerCatalogue, /baroMoney\(p\.sale_price_usd,"USD"\)/);
  assert.doesNotMatch(customerCatalogue, /baroMoney\(p\.sale_price_syp,"SYP"\)/);
  const app = read("../index.html");
  assert.match(app, /class="game-checkout hidden"/);
  assert.match(app, /id="baroSubmitOrder" class="full" type="button" hidden/);
  assert.match(baroFinance, /displayed_price_usd_snapshot/);
  assert.match(baroFinance, /displayed_price_syp_snapshot/);
  assert.match(baroFinance, /displayed_exchange_rate_snapshot/);
});

test("BARO has a separate append-only finance ledger and records confirmed payments and supplier costs", () => {
  assert.match(baroFinance, /create table if not exists public\.baro_manual_finance_entries/);
  assert.match(baroFinance, /enable row level security/);
  assert.match(baroFinance, /revoke all on public\.baro_manual_finance_entries from anon,authenticated/);
  assert.match(baroFinance, /baro_finance_order_sale_once/);
  assert.match(baroFinance, /baro_finance_order_supplier_cost_once/);
  assert.match(baroReporting, /payment_status='verified'/);
  assert.match(baroReporting, /new\.status='completed'/);
  assert.match(edge, /baro_manual_finance_entry_atomic/);
  assert.match(management, /الإدارة المالية المستقلة/);
  assert.match(management, /تصدير كشف BARO المالي CSV/);
});

test("BARO supplier records and settings are isolated from automatic supplier data", () => {
  assert.match(baroIsolation, /create table if not exists public\.baro_manual_suppliers/);
  assert.match(baroIsolation, /references public\.baro_manual_suppliers/);
  assert.match(edge, /admin\.from\(\"baro_manual_suppliers\"\)/);
  assert.doesNotMatch(edge, /admin\.from\(\"suppliers\"\)/);
  assert.match(baroFinance, /usd_syp_rate/);
  assert.match(baroFinance, /low_margin_percent/);
  assert.match(edge, /baro_manual_settings_save_atomic/);
  assert.match(management, /إعدادات BARO المستقلة/);
});

test("BARO staff permissions are scoped and do not grant BARAN-wide administrator rights", () => {
  assert.match(baroFinance, /create table if not exists public\.baro_staff_permissions/);
  assert.match(baroPermissions, /baro_manual_has_permission/);
  assert.match(baroFinance, /public\.admin_is_user\(p_admin_id\)/);
  assert.match(baroPermissions, /baro_manual_has_permission\(p_admin_id,'orders'\)/);
  assert.match(edge, /baro_manual_staff_permission_save_atomic/);
  assert.match(management, /صلاحيات موظفي BARO/);
});

test("BARO price history, audit, customer notifications and scheduled private backups are enabled", () => {
  assert.match(baroFinance, /baro_manual_product_price_history/);
  assert.match(baroFinance, /baro_manual_capture_price_history/);
  assert.match(baroReporting, /baran_notifications/);
  assert.match(baroIsolation, /baro_manual_backup_snapshots/);
  assert.match(baroIsolation, /cron\.schedule\('baro-manual-daily-backup'/);
  assert.match(edge, /baro_manual_create_backup_snapshot/);
  assert.match(management, /إنشاء نسخة احتياطية الآن/);
});

test("BARO management dashboard loads as a separate admin workspace and automatic control is moved out", () => {
  const app = read("../index.html");
  assert.match(app, /baro-management\.js/);
  assert.match(app, /data-admin-panel="suppliers">[\s\S]*?baranAutomaticToggle/);
  const baroPanel = app.split('data-admin-panel="baro"')[1]?.split('data-admin-panel="suppliers"')[0] ?? "";
  assert.doesNotMatch(baroPanel, /baranAutomaticToggle/);
  assert.match(app, /if\(id==="suppliers"&&typeof loadBaranAutomaticControl==="function"\)/);
  assert.match(management, /BARO CONTROL/);
  assert.match(management, /تحديث بيانات BARO/);
});


test("BARO snapshots the exchange rate used when SYP payment is actually verified", () => {
  assert.match(baroPaymentFx, /payment_exchange_rate_snapshot/);
  assert.match(baroPaymentFx, /new\.payment_status='verified'/);
  assert.match(baroPaymentFx, /لا يمكن تأكيد دفع بالليرة قبل تحديد سعر الصرف/);
  assert.match(baroPaymentFx, /new\.payment_exchange_rate_snapshot:=v_rate/);
  assert.match(baroPaymentFx, /exchange_rate_snapshot/);
  assert.match(edge, /payment_exchange_rate_snapshot/);
  assert.match(management, /سعر الصرف/);
});


test("BARO customer order form is hidden in static HTML until the backend confirms the gate is open", () => {
  const app = read("../index.html");
  assert.match(app, /class="game-checkout hidden"/);
  assert.match(app, /id="baroSubmitOrder" class="full" type="button" hidden/);
  assert.match(ui, /if\(submitButton\)\{submitButton\.hidden=!canOrder;submitButton\.disabled=!canOrder;\}/);
  assert.match(ui, /if\(!baroManualEnabled\)\{message\.textContent=/);
});

test("BARO staff without catalog or order permissions cannot see those admin panels", () => {
  assert.match(management, /productList\.hidden=!can\("catalog"\)/);
  assert.match(management, /orderList\.hidden=!can\("orders"\)/);
});


test("BARO manual requests require explicit player ID confirmation in UI, Edge Function, and database", () => {
  const app = read("../index.html");
  const confirmationMigration = read("../supabase/migrations/20261117210000_baro_player_id_confirmation_and_status_notifications.sql");
  assert.match(app, /id="baroPlayerIdConfirmed" type="checkbox"/);
  assert.match(ui, /playerIdConfirmed\?\.checked===true/);
  assert.match(ui, /player_id_confirmed:true/);
  assert.match(edge, /body\.player_id_confirmed !== true/);
  assert.match(edge, /p_player_id_confirmed: true/);
  assert.match(confirmationMigration, /p_player_id_confirmed boolean/);
  assert.match(confirmationMigration, /player_id_confirmed/);
});

test("BARO status quick actions send customer-facing in-progress and completion notifications", () => {
  const notificationMigration = read("../supabase/migrations/20261117210000_baro_player_id_confirmation_and_status_notifications.sql");
  assert.match(ui, /بدء الشحن اليدوي/);
  assert.match(ui, /تأكيد اكتمال الشحن/);
  assert.match(ui, /تم استلام طلبك، والشحن حالياً قيد التنفيذ/);
  assert.match(ui, /تم شحن طلبك بنجاح/);
  assert.match(notificationMigration, /تم استلام طلبك، والشحن حالياً قيد التنفيذ/);
  assert.match(notificationMigration, /تم شحن طلبك بنجاح/);
  assert.match(notificationMigration, /baran_notifications/);
});
