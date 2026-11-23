import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const read = (name) => readFileSync(join(import.meta.dirname, "..", name), "utf8");
test("visitor analytics has a standalone admin hub card and panel", () => {
  const html = read("index.html");
  assert.match(html, /strong>إحصائيات الزوار<\/strong>[\s\S]*?showAdminPanel\('visitor-analytics'\)/);
  assert.match(html, /data-admin-panel="visitor-analytics"/);
  assert.match(html, /id==="visitor-analytics"[\s\S]*?loadBaranVisitorAnalytics/);
});
test("visitor analytics uses its own tracker and authenticated admin loader", () => {
  const tracker = read("baran-visitor-analytics.js");
  const admin = read("baran-visitor-analytics-admin.js");
  assert.match(tracker, /action:"track"/);
  assert.doesNotMatch(tracker, /email|user_id|navigator\.userAgent/);
  assert.match(admin, /action:"stats"/);
  assert.match(admin, /getSession/);
});
