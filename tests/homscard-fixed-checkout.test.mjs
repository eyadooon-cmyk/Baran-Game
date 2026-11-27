import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const gateway = await readFile(new URL("../supabase/functions/baran-order-gateway/index.ts", import.meta.url), "utf8");

test("fixed HomsCard catalog is separate from variable quantity catalog", () => {
  assert.match(gateway, /homscard_fixed_catalog/);
  assert.match(gateway, /homscard_fixed_quote/);
  assert.match(gateway, /catalog_group",null/);
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
