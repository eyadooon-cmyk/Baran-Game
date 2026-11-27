import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const gateway = await readFile(new URL("../supabase/functions/baran-order-gateway/index.ts", import.meta.url), "utf8");
const fixedUi = await readFile(new URL("../baran-homscard-fixed-checkout.js", import.meta.url), "utf8");
const variableUi = await readFile(new URL("../baran-homscard-instant-apps-20261127-v3.js", import.meta.url), "utf8");

test("fixed HomsCard catalog is separate from variable quantity catalog", () => {
  assert.match(gateway, /homscard_fixed_catalog/);
  assert.match(gateway, /homscard_fixed_quote/);
  assert.match(gateway, /catalog_group\.is\.null,catalog_group\.eq\.homscard_fixed/);
  assert.match(gateway, /data\.product_type!=="package"/);
  assert.match(gateway, /homscard_variable_catalog/);
});

test("fixed HomsCard products require a fresh supplier audit and matching supplier cost", () => {
  assert.match(gateway, /Date\.now\(\)-24\*60\*60\*1000/);
  assert.match(gateway, /Math\.abs\(Number\(data\.price\)-Number\(m\.unit_cost\)\)>0\.000001/);
  assert.match(gateway, /MEMBERSHIP\|SUBSCRIPTION\|WEEKLY/);
  assert.match(gateway, /is_preferred",true/);
  assert.match(gateway, /target_label:"Player ID"/);
});

test("fixed quote is read-only and cannot create orders or charge wallets", () => {
  assert.match(gateway, /mode:"read_only_fixed_quote"/);
  assert.match(gateway, /can_create_order:false,can_purchase:false/);
  assert.match(gateway, /charged:false,order_created:false/);
  assert.match(gateway, /لا يوجد إنشاء طلب أو خصم رصيد/);
});

test("fixed and variable products use separate customer interfaces", () => {
  assert.match(fixedUi, /baranFixedCheckout/);
  assert.match(fixedUi, /homscard_fixed_catalog/);
  assert.match(fixedUi, /homscard_fixed_quote/);
  assert.match(fixedUi, /\.baran-package-button/);
  assert.match(fixedUi, /\.baran-service-select-button/);
  assert.match(gateway, /product_id:p\.id,product_code:p\.product_code/);
  assert.match(variableUi, /baranInstantAppsRoot/);
  assert.match(variableUi, /homscard_variable_catalog/);
  assert.match(variableUi, /homscard_variable_quote/);
  assert.match(fixedUi, /purchase\.disabled=true/);
  assert.match(fixedUi, /action:"homscard_fixed_create_order"/);
});

const migration = await readFile(new URL("../supabase/migrations/20261127000200_homscard_fixed_order_lifecycle.sql", import.meta.url), "utf8");

test("fixed order RPC is transactional, idempotent, and service-role only", () => {
  assert.match(migration, /baran_create_homscard_fixed_order/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /client_request_id/);
  assert.match(migration, /for update/);
  assert.match(migration, /wallet_transactions/);
  assert.match(migration, /baran_supplier_prepare_order/);
  assert.match(migration, /supplier_id.*is distinct from v_supplier_id/);
  assert.match(migration, /execution_enabled/);
  assert.match(migration, /revoke all on function public\.baran_create_homscard_fixed_order/);
  assert.match(migration, /to service_role/);
});

test("fixed order price snapshot uses new Syrian lira commercial conversion", () => {
  assert.match(migration, /product_group = 'homscard_fixed'/);
  assert.match(migration, /market_rate \* \(1 \+ fx_buffer \/ 100\) \/ 100/);
  assert.match(migration, /market_exchange_rate \* \(1 \+ ss\.fx_buffer_percent \/ 100\) \/ 100/);
});

test("fixed gateway creates fixed orders only through the dedicated RPC", () => {
  assert.match(gateway, /homscard_fixed_create_order/);
  assert.match(gateway, /baran_create_homscard_fixed_order/);
  assert.match(gateway, /homscard_fixed_check_order/);
  assert.match(gateway, /p_product_code:productCode/);
  assert.match(gateway, /created\?\.supplier_sku/);
});
