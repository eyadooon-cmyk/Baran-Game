import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../supabase/functions/baran-homscard-connector/index.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20261125110000_add_homscard_supplier_api.sql", import.meta.url), "utf8");
const adminUi = await readFile(new URL("../admin-operations.js", import.meta.url), "utf8");
const auditMigration = await readFile(new URL("../supabase/migrations/20261126100000_add_homscard_audit_storage.sql", import.meta.url), "utf8");

test("HomsCard connector is admin-authenticated and keeps credentials server-side", () => {
  assert.match(source, /admin_is_user/);
  assert.match(source, /Deno\.env\.get\("HOMSCARD_API_TOKEN"\)/);
  assert.doesNotMatch(source, /YOUR_API_TOKEN|hc_x{4,}/i);
});

test("HomsCard connector supports read-only profile and products only", () => {
  assert.match(source, /action === "profile"/);
  assert.match(source, /action === "products"/);
  assert.match(source, /Order creation is intentionally disabled/);
  assert.doesNotMatch(source, /\/order\.php/);
});

test("HomsCard connector supports the documented optional HMAC request signature", () => {
  assert.match(source, /HOMSCARD_HMAC_SECRET/);
  assert.match(source, /X-Timestamp/);
  assert.match(source, /X-Signature/);
  assert.match(source, /HMAC/);
});

test("HomsCard connector preserves missing product_type as unknown instead of assuming package", () => {
  assert.ok(source.includes("product_type: p.product_type ?? null"));
  assert.ok(!source.includes('product_type: p.product_type ?? "package"'));
});

test("HomsCard product page audit is admin-gated, bounded, and read-only", () => {
  assert.ok(source.includes('action === "product_pages"'));
  assert.ok(source.includes("ids.length > 25"));
  assert.ok(source.includes("https://homscard.com/product.php?id="));
  assert.ok(source.includes("Public product-page metadata only"));
  assert.ok(!source.includes("/order.php"));
});

test("Admin catalog audit can enrich products from HomsCard public product pages", () => {
  assert.ok(adminUi.includes("homscardInspectProductPages"));
  assert.ok(adminUi.includes('action:"product_pages"'));
  assert.ok(adminUi.includes("p.page_text"));
  assert.ok(adminUi.includes("للوحدة"));
});
test("HomsCard audit results are persisted and restored through admin-gated server actions", () => {
  assert.match(source, /action === "save_audit_batch"/);
  assert.match(source, /action === "get_latest_audit"/);
  assert.match(source, /baran_homscard_audit_items/);
  assert.match(adminUi, /homscardPersistAuditRows/);
  assert.match(adminUi, /homscardRestoreSavedAudit/);
  assert.match(adminUi, /save_audit_batch/);
  assert.match(adminUi, /homscardPageNeedsRecheck\(p\)/);
  assert.match(adminUi, /await homscardInspectProductPages\(\)/);
});
test("HomsCard audit tables deny direct client access and allow server role", () => {
  assert.match(auditMigration, /enable row level security/i);
  assert.match(auditMigration, /revoke all .* from anon, authenticated/i);
  assert.match(auditMigration, /grant all .* to service_role/i);
  assert.match(auditMigration, /primary key \(run_id, product_id\)/i);
});
test("HomsCard connector never returns the API token or raw upstream body", () => {
  assert.match(source, /profile\.email/);
  assert.doesNotMatch(source, /return json\(\{[^}]*apiToken/s);
  assert.match(source, /Read-only catalog request/);
});

test("HomsCard migration registers the supplier but keeps integration and execution disabled", () => {
  assert.match(migration, /'HomsCard'/);
  assert.match(migration, /'homscard'/);
  assert.match(migration, /'HOMSCARD_API_TOKEN'/);
  assert.match(migration, /integration_enabled=false/);
  assert.match(migration, /execution_enabled=false/);
  assert.match(migration, /'pending_credentials'/);
});

test("HomsCard HMAC signs the exact full upstream path including the reseller prefix", () => {
  assert.match(source, /timestamp \+ "\\nGET\\n" \+ "\/reseller" \+ path \+ "\\n"/);
});

test("HomsCard product page validation rejects upstream error pages and empty metadata", () => {
  assert.match(source, /صفحة المورد تعرض رسالة خطأ بدلاً من تفاصيل المنتج/);
  assert.match(source, /لم تُرجع الصفحة عنواناً أو وصفاً تعريفياً للمنتج/);
  assert.match(adminUi, /function homscardPageHasErrorContent/);
  assert.match(adminUi, /function homscardPageIsUsable/);
  assert.match(adminUi, /function homscardPageNeedsRecheck/);
  assert.match(adminUi, /row\?\.success&&homscardPageIsUsable\(row\)/); 
  assert.match(adminUi, /page_status:p\.page_status\|\|\(homscardPageIsUsable/);
});
