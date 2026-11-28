import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read("../supabase/migrations/20261127171000_baran_general_pricing_policy.sql");
const edge = read("../supabase/functions/baran-admin/index.ts");
const index = read("../index.html");
const pricing = read("../finance-pricing.js");

test("BARAN pricing policy is separate from the legacy exchange rate and has agreed launch defaults", () => {
  assert.match(migration, /market_exchange_rate numeric\(20,6\) not null default 15300/);
  assert.match(migration, /fx_buffer_percent numeric\(6,3\) not null default 2/);
  assert.match(migration, /product_markup_percent numeric\(6,3\) not null default 3/);
  assert.match(migration, /pricing_updated_at/);
  assert.match(migration, /pricing_updated_by/);
  assert.match(migration, /revoke all on function public\.admin_update_pricing_policy[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.admin_update_pricing_policy[\s\S]*to service_role/);
});

test("Pricing policy updates are validated server-side and audited", () => {
  assert.match(edge, /body\.action === "pricing_policy_update"/);
  assert.match(edge, /admin_update_pricing_policy/);
  assert.match(edge, /pricing_policy: \{/);
  assert.match(edge, /commercial_exchange_rate:/);
  assert.match(migration, /pricing_policy_updated/);
  assert.match(migration, /admin_audit_log/);
});

test("Finance hub loads the dedicated pricing policy and HomsCard USD preview", () => {
  assert.match(index, /id="financePricingPolicyMount"/);
  assert.match(index, /renderFinancePricingPolicy\(result\)/);
  assert.match(index, /finance-pricing\.js\?v=20261127-new-syp-v4/);
  assert.match(pricing, /String\(supplier\.name \|\| ""\).*homscard/);
  assert.match(pricing, /link\.currency \|\| ""\).*USD/);
  assert.match(pricing, /product_markup_percent/);
  assert.match(pricing, /saleSyp/);
  assert.match(pricing, /profitUsd: saleUsd - costUsd/);
  assert.match(pricing, /ربحنا المتوقع USD/);
  assert.match(pricing, /لا يتم تغيير أسعار المنتجات الحالية/);
});

test("Preview reports gross spread against market cost in new SYP, not a net-profit claim", () => {
  assert.match(pricing, /profitSyp: \(saleUsd \* commercial - costUsd \* market\) \/ 100/);
  assert.match(pricing, /الفارق الإجمالي قبل الرسوم/);
  assert.match(pricing, /إعادة شراء الدولار/);
});

test("All customer-facing HomsCard prices are converted to new SYP", () => {
  assert.match(pricing, /سعر الدولار بالسوق السورية \(ل\.س جديدة\)/);
  assert.match(pricing, /saleSyp: saleUsd \* commercial \/ 100/);
  assert.match(pricing, /syp\(Number\(state\.applied_rate_old\)\/100\)/);
});
