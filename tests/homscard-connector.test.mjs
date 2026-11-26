import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../supabase/functions/baran-homscard-connector/index.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../supabase/migrations/20261125110000_add_homscard_supplier_api.sql", import.meta.url), "utf8");
const adminUi = await readFile(new URL("../admin-operations.js", import.meta.url), "utf8");
const intelligenceUi = await readFile(new URL("../homscard-intelligence.js", import.meta.url), "utf8");
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
  assert.ok(adminUi.includes("p.page_text"));
});
test("HomsCard audit requires explicit subscription evidence and reports low-confidence items for review", () => {
  assert.match(adminUi, /explicitSubscriptionWords/);
  assert.match(adminUi, /hasExplicitSubscription/);
  assert.match(adminUi, /إشارة زمنية في هوية المنتج فقط/);
  assert.match(adminUi, /needsReview=kind==="غير محسوم"\|\|confidence==="منخفض"/);
  assert.match(adminUi, /تصنيفاً مبدئياً بثقة متوسطة أو أعلى/);
});

test("HomsCard audit results are persisted and restored through admin-gated server actions", () => {
  assert.match(source, /action === "save_audit_batch"/);
  assert.match(source, /action === "get_latest_audit"/);
  assert.match(source, /baran_homscard_audit_items/);
  assert.match(adminUi, /homscardPersistAuditRows/);
  assert.match(adminUi, /homscardRestoreSavedAudit/);
  assert.match(adminUi, /save_audit_batch/);
  assert.match(adminUi, /p\.page_status!=="success"/);
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

test("HomsCard catalog includes unavailable products unless available_only is explicitly true", () => {
  assert.match(source, /if \(body\.available_only === true\) query\.set\("available", "1"\)/);
  assert.match(source, /availability: typeof p\.available === "boolean"/);
});
test("HomsCard page extraction captures images and distinguishes upstream error pages", () => {
  assert.match(source, /data-lazy-src/);
  assert.match(source, /images: images\.slice\(0, 30\)/);
  assert.match(source, /extraction_status: upstreamError \? "upstream_error"/);
  assert.match(source, /const valid = extracted\.extraction_status === "extracted"/);
});
test("HomsCard page audit does not mark an error message as successful extraction", () => {
  assert.match(source, /hasProductMarker/);
  assert.match(source, /upstreamError/);
  assert.match(adminUi, /p\.page_extraction_status!==\"extracted\"/);
});
test("Admin loads the full HomsCard catalog and persists page images and availability", () => {
  assert.match(adminUi, /available_only:false/);
  assert.match(adminUi, /images:p\.page_images\|\|\[\]/);
  assert.match(adminUi, /availability:p\.page_availability\|\|"unknown"/);
});

test("Admin catalog cards expose the extracted supplier description, text and image gallery", () => {
  assert.match(adminUi, /تفاصيل صفحة حمص كارد الكاملة/);
  assert.match(adminUi, /homscard-page-image-gallery/);
  assert.match(adminUi, /p\.page_text/);
});

test("HomsCard saved audit combines the latest catalog with previously successful page extractions", () => {
  assert.match(source, /\.limit\(50\)/);
  assert.match(source, /bestPageByProduct/);
  assert.match(source, /page_data:best\.page_data,page_status:"success"/);
  assert.match(source, /successful_page_run_id/);
  assert.match(adminUi, /homscardMergeSavedSuccessfulPages/);
  assert.match(adminUi, /Preserve current API catalog fields/);
  assert.match(adminUi, /لم تُستبدل أي صفحة ناجحة بخطأ مؤقت/);
});

test("HomsCard classification ignores generic page-template text as product evidence", () => {
  assert.match(adminUi, /const identity=homscardAutoAuditText\(\[name,category,pageTitle\]/);
  assert.match(adminUi, /explicitSubscriptionWords\.test\(identity\)/);
  assert.match(adminUi, /hasVariableEvidence=options\.length>0\|\|typeVariable/);
  assert.doesNotMatch(adminUi, /unitPriceEvidence/);
  assert.match(adminUi, /hasPackEvidence=.*identity/);
  assert.match(adminUi, /pageText=homscardAutoAuditText/);
});


test("Restoring HomsCard audit starts a new run and preserves historical audit records", () => {
  assert.match(adminUi, /Reclassification creates a fresh audit run/);
  assert.match(adminUi, /homscardAuditRunId=crypto\.randomUUID\(\);/);
});


test("HomsCard page audit summary reports authoritative totals without hiding unaccounted successes", () => {
  assert.match(adminUi, /const totalSuccessful=homscardCatalogCache\.filter\(p=>p\.page_status===\"success\"\)\.length/);
  assert.match(adminUi, /const totalFailed=homscardCatalogCache\.filter\(p=>p\.page_status===\"failed\"\)\.length/);
  assert.match(adminUi, /const unaccountedSuccessful=Math\.max\(0,totalSuccessful-restored-inspected\)/);
  assert.match(adminUi, /صفحة ناجحة موجودة في السجل ولم تدخل ضمن عدادي الاستعادة والفحص الحالي/);
  assert.match(adminUi, /totalFailed.*homscardCatalogCache\.length/);
});

test("Agreed HomsCard page audit is restricted to the exact 15 approved product IDs", () => {
  const ids = ["18","3","280","8","910","37","43","1","893","25","49","45","283","282","458"];
  assert.match(adminUi, /HOMSCARD_AGREED_PRODUCT_IDS=Object\.freeze\(/);
  for (const id of ids) assert.ok(adminUi.includes('"'+id+'"'));
  assert.match(adminUi, /products_id:HOMSCARD_AGREED_PRODUCT_IDS/);
  assert.match(adminUi, /products\.length!==15/);
  assert.match(adminUi, /opsHomsAgreedPageAuditButton/);
  assert.match(adminUi, /homscardPersistAuditRows\(products,auditRows\)/);
});

test("HomsCard intelligence reads, exports, and rechecks only the 15 agreed products", () => {
  const ids = ["18","3","280","8","910","37","43","1","893","25","49","45","283","282","458"];
  for (const id of ids) assert.ok(intelligenceUi.includes('"'+id+'"'));
  assert.match(intelligenceUi, /const matched=savedRows\.filter\(r=>agreedIds\.has\(r\.product_id\)\)/);
  assert.match(intelligenceUi, /const missing=\[\.\.\.agreedIds\]/);
  assert.match(intelligenceUi, /rows=matched/);
  assert.match(intelligenceUi, /const targets=rows\.filter/);
});

test("HomsCard intelligence separates confirmed fixed WePlay packages from unresolved audit labels and counts missing rows", () => {
  assert.match(intelligenceUi, /USER_CONFIRMED_FIXED_PACKAGE_IDS=new Set\(\["283","282","458"\]\)/);
  assert.match(intelligenceUi, /باقة ثابتة \(تأكيد المستخدم\)/);
  assert.match(intelligenceUi, /rowsWithMissing=rows\.filter\(r=>missing\(r\)\.length>0\)\.length/);
  assert.match(intelligenceUi, /savedMissing=rows\.filter\(r=>Array\.isArray\(r\.audit_data\?\.missing\)/);
});
test("Supplier directory supports search, supplier editing, and reversible activation without deleting links", () => {
  assert.match(adminUi, /function opsResetSupplierForm\(\)/);
  assert.match(adminUi, /async function opsToggleSupplierStatus\(supplier\)/);
  assert.match(adminUi, /supplier_id:supplierId\|\|undefined/);
  assert.match(adminUi, /window\.__baranSuppliersCache=suppliers/);
  assert.match(adminUi, /المنتجات المرتبطة:/);
  assert.match(adminUi, /لم تُحذف روابط المنتجات أو الأسعار/);
});

test("Supplier directory search does not rebuild or clear the product-link form", () => {
  assert.match(adminUi, /function renderOpsSuppliers\(suppliers,links,products,searchOnly=false\)/);
  assert.match(adminUi, /if\(searchOnly\)return;\s*const supplierSelect=document\.getElementById\("opsSupplierSelect"\)/);
  assert.match(adminUi, /روابط المورد المفضل/);
  assert.match(indexHtml, /opsSupplierLinksCache/);
});
