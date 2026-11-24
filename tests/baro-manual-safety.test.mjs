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
  assert.match(edge, /baro_manual_create_customer_order_on_completion/);
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
  assert.doesNotMatch(ui, /nextStates=/);
  assert.match(ui, /if\(nextStatus!=="completed"\)return/);
});

test("BARO remains isolated from wallet debit and automatic dispatch", () => {
  assert.match(hardening, /'wallet_changed',false/);
  assert.match(hardening, /'finance_posted',false/);
  assert.match(gates, /public\.baro_manual_settings/);
  assert.doesNotMatch(gates, /baran_supplier_prepare_order/);
  assert.doesNotMatch(edge, /admin\.from\("wallets"\)\.(?:update|insert)|baro_manual_wallet_charge|dispatch_supplier_order/i);
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

test("Customer BARO catalogue exposes approved Free Fire SYP sale prices only, never supplier costs", () => {
  const catalogBlock = edge.split('if (req.method === "GET" && view === "catalog")')[1]?.split('if (req.method === "GET" && view === "my_orders")')[0] ?? "";
  assert.match(catalogBlock, /product_code,category_id,group_id,product_name,input_label,purchase_enabled,sale_price_usd,sale_price_syp/);
  assert.match(catalogBlock, /sale_price_usd: p\.sale_price_usd, sale_price_syp: p\.sale_price_syp/);
  assert.doesNotMatch(catalogBlock, /supplier_cost_usd|supplier_cost_currency/);
});


test("BARO is embedded inside the existing BARAN customer app and admin panel", () => {
  const app = read("../index.html");
  assert.match(app, /<section id="baroManual" class="hidden">/);
  assert.match(app, /onclick="showSection\('manualGames',this\)"/);
  assert.match(app, /data-admin-panel="baro"/);
  assert.match(app, /onclick="showAdminPanel\('baro'\)"/);
  assert.match(app, /loadBaroAdmin\(\)/);
  assert.match(app, /loadBaranAutomaticControl\(\)/);
});

test("Signed-out visitors can read only the public BARO catalogue, never customer or finance data", () => {
  assert.match(edge, /if \(!token && req\.method === "GET" && requestedView === "catalog"\)/);
  const publicCatalog = edge.split('if (!token && req.method === "GET" && requestedView === "catalog")')[1]?.split('if (!token) return json')[0] ?? "";
  assert.match(publicCatalog, /leo_manual_products/);
  assert.match(publicCatalog, /sale_price_usd,sale_price_syp/);
  assert.doesNotMatch(publicCatalog, /leo_manual_orders|wallets|supplier_cost|admin_audit_log/);
  assert.match(ui, /const publicCatalogRequest=method==="GET"&&view==="catalog"/);
  assert.match(ui, /if\(!currentUser\)[\s\S]*تسجيل الدخول مطلوب لمتابعة طلبات BARO/);
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
  assert.match(customerCatalogue, /const categoryOrder=\["freefire","pubg","jawaker"\]/);
  assert.match(customerCatalogue, /const groupOrder=/);
  assert.match(customerCatalogue, /baro-catalog-category/);
  assert.doesNotMatch(ui, /function baroRenderCustomerProductCards\(\)/);
  assert.doesNotMatch(ui, /loadBaroCustomer=async function\(\)/);
  assert.doesNotMatch(ui, /catalog\.textContent="كتالوج BARO للمعاينة فقط/);
  assert.match(ui, /renderBaroCustomerCatalog\(baroCustomerProducts\)/);
  assert.doesNotMatch(customerCatalogue, /baroMoney\(p\.sale_price_usd,"USD"\)/);
  assert.doesNotMatch(customerCatalogue, /baroMoney\(p\.sale_price_syp,"SYP"\)/);
  assert.match(customerCatalogue, /category==="freefire"&&group==="diamonds"/);
  assert.match(customerCatalogue, /" SYP"/);
  assert.match(customerCatalogue, /استقبال الطلبات مغلق حالياً/);
  assert.match(customerCatalogue, /createElement\("button"\);card\.type="button";card\.className="baro-catalog-product-card/);
  const app = read("../index.html");
  assert.match(app, /<div class="game-checkout"><h3>بيانات طلب الشحن اليدوي<\/h3>/);
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
  assert.match(management, /مالية BARO المستقلة/);
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


test("BARO customer ID form stays visible while order submission remains gated", () => {
  const app = read("../index.html");
  assert.match(app, /<div class="game-checkout"><h3>بيانات طلب الشحن اليدوي<\/h3>/);
  assert.match(app, /id="baroSubmitOrder" class="full" type="button" hidden/);
  assert.match(ui, /if\(checkout\)checkout\.classList\.remove\("hidden"\);/);
  assert.match(ui, /if\(submitButton\)\{submitButton\.hidden=!canOrder;submitButton\.disabled=!canOrder;\}/);
  assert.match(ui, /op\.textContent=.*معاينة فقط/);
  assert.match(ui, /استقبال الطلبات مغلق حالياً ولن يتم إرسال أي طلب/);
  assert.match(ui, /if\(!baroManualEnabled\)\{message\.textContent=/);
});

test("BARO finance separates realized ledger results from estimated catalogue unit margins", () => {
  assert.match(management, /ربح كل باقة — تقديري قبل البيع/);
  assert.match(management, /costUsd.*rate/);
  assert.match(management, /sale_price_syp/);
  assert.match(management, /costUsd.*rate/);
  assert.match(management, /دفتر الحركات المالية الفعلية/);
  assert.match(management, /هذا الدفتر مستقل عن محافظ الزبائن والشحن الآلي والحسابات العامة/);
  assert.match(management, /سعر الصرف: 1 USD =/);
});

test("BARO financial workspace is a dedicated admin hub section separate from BARO operations", () => {
  const index = read("../index.html");
  assert.match(index, /data-admin-panel="baro-finance"/);
  assert.match(index, /onclick="showAdminPanel\('baro-finance'\)"/);
  assert.match(index, /id="baroFinanceStandaloneMount"/);
  assert.match(management, /function financeRoot\(\)/);
  assert.match(management, /window\.loadBaroFinanceWorkspace=loadBaroFinanceWorkspace/);
  assert.doesNotMatch(management, /data-tab="finance"/);
  assert.doesNotMatch(management, /data-tab="settings"/);
  assert.match(management, /جميع التكاليف وسعر الصرف والمبيعات والأرباح والحركات المالية موجودة في قسم/);
  assert.match(management, /إعدادات مالية BARO/);
});

test("BARO staff without catalog or order permissions cannot see those admin panels", () => {
  assert.match(management, /productList\.hidden=!can\("catalog"\)/);
  assert.match(management, /orderList\.hidden=!can\("orders"\)/);
});


test("BARO manual requests require explicit player ID confirmation in UI, Edge Function, and database", () => {
  const app = read("../index.html");
  const confirmationMigration = read("../supabase/migrations/20261117210000_baro_player_id_confirmation_and_status_notifications.sql");
  assert.match(app, /id="baroPlayerIdConfirmed" type="checkbox"/);
  assert.match(ui, /playerIdConfirmed=baroEl\("baroPlayerIdConfirmed"\)\?\.checked===true/);
  assert.match(ui, /player_id_confirmed:true/);
  assert.match(edge, /body\.player_id_confirmed !== true/);
  assert.match(edge, /p_player_id_confirmed: true/);
  assert.match(confirmationMigration, /p_player_id_confirmed boolean/);
  assert.match(confirmationMigration, /player_id_confirmed/);
});

test("BARO manual top-up sends only the completion notification from the one-step admin action", () => {
  const notificationMigration = read("../supabase/migrations/20261117210000_baro_player_id_confirmation_and_status_notifications.sql");
  assert.match(ui, /if\(nextStatus!=="completed"\)return/);
  assert.match(ui, /تم شحن طلبك بنجاح/);
  assert.doesNotMatch(ui, /تم استلام طلبك، والشحن حالياً قيد التنفيذ/);
  assert.match(notificationMigration, /تم شحن طلبك بنجاح/);
  assert.match(notificationMigration, /baran_notifications/);
});


test("Prepared Free Fire prices are internal only and all BARO purchase gates stay closed", () => {
  const pricing = read("../supabase/migrations/20261118090000_prepare_freefire_prices_keep_baro_closed.sql");
  assert.match(pricing, /usd_syp_rate = 156/);
  for (const [code, cost, sale] of [
    ["LEO_FREEFIRE_DIAMONDS_110", "147", "160"],
    ["LEO_FREEFIRE_DIAMONDS_210", "293", "310"],
    ["LEO_FREEFIRE_DIAMONDS_583", "727", "790"],
    ["LEO_FREEFIRE_DIAMONDS_1188", "1483", "1595"],
    ["LEO_FREEFIRE_DIAMONDS_2420", "2906", "3165"]
  ]) {
    assert.ok(pricing.includes(code), code + " is present");
    assert.ok(pricing.includes(cost + "::numeric"), code + " has the agreed supplier cost");
    assert.ok(pricing.includes(sale + "::numeric"), code + " has the agreed sale price");
  }
  assert.match(pricing, /supplier_cost_currency = 'USD'/);
  assert.match(pricing, /supplier_cost_usd_equivalent/);
  assert.match(pricing, /source_cost_currency', 'SYP'/);
  assert.match(pricing, /set enabled = false/);
  assert.match(pricing, /LEO_FREEFIRE_DIAMONDS_110\x27, 147::numeric, 160::numeric/);
  assert.match(pricing, /catalog_visible = false/);
  assert.match(pricing, /purchase_enabled = false/);
  assert.match(pricing, /price_history/);
  assert.doesNotMatch(pricing, /insert into public\.leo_manual_orders/i);
  assert.doesNotMatch(pricing, /insert into public\.baro_manual_finance_entries/i);
});


const walletCheckout = read("../supabase/migrations/20261119190000_baro_wallet_checkout_and_refunds.sql");
test("BARO wallet checkout reserves funds atomically and is idempotent", () => {
  assert.match(walletCheckout, /baro_manual_wallet_holds/);
  assert.match(walletCheckout, /p_wallet_currency text/);
  assert.match(walletCheckout, /for update/);
  assert.match(walletCheckout, /balance_usd=balance_usd-v_price/);
  assert.match(walletCheckout, /balance_syp=balance_syp-v_price/);
  assert.match(walletCheckout, /status,payment_status,payment_method,idempotency_key/);
  assert.match(walletCheckout, /replayed',true/);
  assert.match(walletCheckout, /baro_manual_order_hold/);
  assert.match(walletCheckout, /grant execute on function public\.baro_manual_create_customer_order/);
});
test("BARO wallet funds are captured only on completion and refunded once on failed fulfilment", () => {
  assert.match(walletCheckout, /status='captured'/);
  assert.match(walletCheckout, /new\.status='failed' or new\.status='cancelled'/);
  assert.match(walletCheckout, /balance_usd=balance_usd\+v_hold\.amount/);
  assert.match(walletCheckout, /balance_syp=balance_syp\+v_hold\.amount/);
  assert.match(walletCheckout, /baro_manual_order_refund/);
  assert.match(walletCheckout, /baro-wallet-refund-/);
  assert.match(walletCheckout, /تم رد مبلغ هذا الطلب إلى المحفظة/);
});
test("BARO wallet API exposes balances and keeps wallet settlement private", () => {
  assert.match(edge, /view === "my_wallet"/);
  assert.match(edge, /baro_manual_wallet_holds/);
  assert.match(edge, /p_wallet_currency: walletCurrency/);
  assert.match(ui, /baroWalletCurrency/);
  assert.match(ui, /wallet_currency:walletCurrency/);
  assert.match(ui, /حجز المبلغ من المحفظة/);
  assert.match(read("../index.html"), /id="baroWalletBalance"/);
});


const deferredWallet = read("../supabase/migrations/20261120180000_baro_wallet_charge_on_completion.sql");
test("New BARO manual orders are marked for deferred wallet charge; legacy orders are untouched", () => {
  assert.match(deferredWallet, /wallet_charge_mode text not null default 'legacy_reserved'/);
  assert.match(deferredWallet, /wallet_on_completion/);
  assert.match(deferredWallet, /status,payment_status,payment_method,idempotency_key,wallet_charge_mode/);
  assert.match(deferredWallet, /'pending','awaiting_quote','wallet_'/);
  assert.match(deferredWallet, /'wallet_changed',false/);
  assert.doesNotMatch(deferredWallet, /insert into public\.baro_manual_wallet_holds/);
});
test("BARO wallet debit occurs only inside completion transaction and is idempotent", () => {
  assert.match(deferredWallet, /select \* into v_order from public\.leo_manual_orders where id=p_order_id for update/);
  assert.match(deferredWallet, /select \* into v_wallet from public\.wallets where user_id=v_order\.user_id for update/);
  assert.match(deferredWallet, /v_target_status='completed' and v_order\.wallet_charged_at is null/);
  assert.match(deferredWallet, /transaction_type='baro_manual_wallet_charge'/);
  assert.match(deferredWallet, /wallet_charged_at=case when v_target_status='completed'/);
  assert.match(deferredWallet, /wallet_charge_replayed',true/);
  assert.match(deferredWallet, /رصيد العميل غير كافٍ لإكمال الشحن/);
  assert.match(deferredWallet, /baro-wallet-sale-/);
  assert.match(deferredWallet, /v_amount:=case when v_currency='USD' then v_order\.customer_price_usd/);
  assert.match(deferredWallet, /wallet_transactions_baro_manual_order_charge_uidx/);
  assert.match(deferredWallet, /baro_manual_order_id/);
  assert.match(deferredWallet, /transaction_type,description,baro_manual_order_id/);
});
test("BARO deferred wallet workflow is isolated from legacy admin payment flow and automatic fulfilment", () => {
  assert.match(deferredWallet, /if v_order\.wallet_charge_mode is distinct from 'wallet_on_completion' then/);
  assert.match(deferredWallet, /return public\.baro_manual_order_admin_update_atomic/);
  assert.match(edge, /baro_manual_order_admin_update_wallet_aware/);
  assert.match(edge, /baro_manual_create_customer_order_on_completion/);
  assert.match(ui, /لن يُخصم أي مبلغ عند إرسال الطلب/);
  assert.match(ui, /تم تسجيل طلبك دون خصم من المحفظة/);
  assert.match(ui, /لن يتم الخصم إلا بعد اكتمال الشحن/);
  assert.match(ui, /wallet_charge_mode/);
  assert.match(ui, /if\(nextStatus!=="completed"\)return/);
  assert.match(ui, /✓ تم الشحن — مكتمل/);
  assert.match(ui, /payment_status:"verified"/);
  assert.doesNotMatch(ui, /▶ جاري التنفيذ/);
});


test("BARO admin order cards expose notification entity ids for direct navigation", () => {
  const source = read("../baro.js");
  assert.match(source, /card\.dataset\.notificationEntityId\s*=\s*String\(o\.id\)/);
});

test("BARO admin panel waits for its data before resolving navigation", () => {
  const source = read("../index.html");
  assert.match(source, /return typeof loadBaroAdmin==="function"\?Promise\.resolve\(loadBaroAdmin\(\)\):Promise\.resolve\(\)/);
});

test("Admin BARO notifications open the BARO panel and target the matching order", () => {
  const source = read("../community.js");
  assert.match(source, /if\(isAdmin&&entityType==="leo_manual_order"\)/);
  assert.match(source, /ordersList\.querySelector\(/);
  assert.match(source, /await showAdminPanel\("baro-orders"\)/);
  assert.match(source, /ordersList\.querySelector\(/);
});


test("BARO manual orders show a copyable player ID and a single completion action", () => {
  const source = read("../baro.js");
  assert.match(source, /PLAYER ID المطلوب الشحن إليه/);
  assert.match(source, /copy\.textContent="نسخ ID"/);
  assert.match(source, /baroCopyPlayerId\(o\.player_id,copy\)/);
  assert.match(source, /complete\.textContent="✓ تم الشحن — مكتمل"/);
  assert.match(source, /\["pending","in_progress"\]\.includes\(o\.status\)/);
  assert.match(source, /if\(nextStatus!=="completed"\)return/);
  assert.match(deferredWallet, /v_order\.status='pending' and v_target_status not in \('pending','in_progress','completed'/);
  assert.doesNotMatch(source, /start\.textContent="▶ جاري التنفيذ"/);
  assert.doesNotMatch(source, /تعديل التفاصيل الإضافية \(اختياري\)/);
});


test("BARO catalogue and manual orders are separate admin workspaces", () => {
  const app = read("../index.html");
  const catalogue = app.split('data-admin-panel="baro"')[1]?.split('data-admin-panel="baro-orders"')[0] ?? "";
  const orders = app.split('data-admin-panel="baro-orders"')[1]?.split('data-admin-panel="baro-finance"')[0] ?? "";
  assert.match(catalogue, /id="baroAdminProducts"/);
  assert.doesNotMatch(catalogue, /id="baroAdminOrders"/);
  assert.match(orders, /id="baroAdminOrders"/);
  assert.doesNotMatch(orders, /id="baroAdminProducts"/);
});


test("Targeted notification sender gives explicit success or failure feedback", () => {
  const source = read("../index.html");
  const sender = source.slice(source.indexOf("async function sendBaranTargetedNotification"), source.indexOf("async function sendBaranAnnouncement"));
  assert.match(sender, /result\?\.success!==true\|\|Number\(result\.sent_to\)!==1/);
  assert.match(sender, /تم إرسال الإشعار بنجاح/);
  assert.match(sender, /فشل إرسال الإشعار/);
  assert.match(sender, /بقي النص محفوظاً/);
  assert.match(sender, /button\.textContent="جاري الإرسال\.\.\."/);
});
