import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root=process.cwd();
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const migration=read("supabase/migrations/20261119120000_baro_external_manual_sales.sql");
const edge=read("supabase/functions/baran-baro-manual/index.ts");
const ui=read("baro-management.js");
const index=read("index.html");

test("External BARO sales are separate from customer orders and wallets",()=>{
  assert.match(migration,/create table if not exists public\.baro_manual_external_sales/);
  assert.match(migration,/baro_manual_external_sale_create_atomic/);
  assert.match(migration,/p_execution_confirmed is distinct from true/);
  assert.doesNotMatch(migration,/(?:insert\s+into|update|delete\s+from)\s+public\.(?:leo_manual_orders|[^\s;]*wallet)/i);
  assert.match(edge,/body\.action === "external_sale_create"/);
  assert.match(ui,/مبيعات خارجية منفّذة يدوياً/);
  assert.match(ui,/لا ينشئ طلب زبون ولا يغيّر أي محفظة/);
});

test("External sale and supplier cost are paired atomically and idempotently",()=>{
  assert.match(migration,/external_sale_id,entry_type,title,amount/);
  assert.match(migration,/baro_external_sale_ledger_entry_once/);
  assert.ok(migration.includes("baro-ext-'||v_sale.id::text||'-sale"));
  assert.ok(migration.includes("baro-ext-'||v_sale.id::text||'-cost"));
  assert.match(edge,/salesByExternal/);
  assert.match(edge,/costsByExternal/);
  assert.match(ui,/baro\.external-sale\.pending\.v1/);
});

test("External sales retain supplier and both original currencies with USD equivalents",()=>{
  for(const token of ["supplier_id","supplier_name_snapshot","sale_currency","sale_exchange_rate","sale_usd_equivalent","supplier_cost_currency","supplier_cost_exchange_rate","supplier_cost_usd_equivalent","profit_usd_equivalent","payment_method","customer_reference","supplier_reference"])
    assert.ok(migration.includes(token),token);
  assert.match(ui,/baroExternalSupplier/);
  assert.match(ui,/baroExternalSaleRate/);
  assert.match(ui,/baroExternalCostRate/);
  assert.match(index,/baro-management\.js\?v=20261119-external-sales-1/);
});

test("External sale retains its idempotency key until the finance refresh succeeds",()=>{
  const postIndex=ui.indexOf("await post(payload)");
  const refreshIndex=ui.indexOf("await loadFinance()",postIndex);
  const clearIndex=ui.indexOf("sessionStorage.removeItem(storageKey)",postIndex);
  assert.ok(postIndex>=0&&refreshIndex>postIndex&&clearIndex>refreshIndex);
  assert.match(ui,/if\(committed\)msg\("تم تسجيل البيع فعلياً/);
});
