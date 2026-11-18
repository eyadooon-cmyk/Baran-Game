import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../supabase/migrations/20261118152000_baro_order_finance_integrity.sql");
const edge = read("../supabase/functions/baran-baro-manual/index.ts");
const management = read("../baro-management.js");
const ui = read("../baro.js");

test("BARO verified customer payment snapshots cannot be changed after posting", () => {
  assert.match(migration, /v_current\.payment_status='verified'/);
  assert.match(migration, /p_payment_status<>'verified'/);
  assert.match(migration, /p_quote_amount is distinct from v_current\.customer_price_usd/);
  assert.match(migration, /p_quote_amount is distinct from v_current\.customer_price_syp/);
});

test("BARO supplier cost is immutable after completed order posting", () => {
  assert.match(migration, /v_current\.status='completed' and p_supplier_cost_usd is distinct from v_current\.supplier_cost_usd/);
  assert.match(migration, /استخدم تسوية مالية موثقة/);
});

test("BARO cannot commit a completed order unless both posted financial entries exist", () => {
  assert.match(migration, /v_order\.payment_status='verified' and not v_sale_posted/);
  assert.match(migration, /v_order\.status='completed' and \(not v_sale_posted or not v_cost_posted\)/);
  assert.match(migration, /'finance_posted',\(v_order\.status='completed' and v_order\.payment_status='verified' and v_sale_posted and v_cost_posted\)/);
});

test("BARO realized profit only includes completed, verified orders with both ledger entries", () => {
  assert.match(edge, /o\.status === "completed" && o\.payment_status === "verified"/);
  assert.match(edge, /if \(!salesByOrder\.has\(orderId\) \|\| !costsByOrder\.has\(orderId\)\) continue/);
  assert.match(edge, /totals\.net_profit = totals\.realized_sales - totals\.realized_supplier_costs/);
  assert.match(management, /مبيعات لم يكتمل تنفيذها/);
  assert.match(management, /المبيعات المحققة/);
  assert.match(ui, /updateResult\.finance_posted/);
  assert.doesNotMatch(ui, /لا يوجد خصم أو ترحيل مالي تلقائي/);
});
