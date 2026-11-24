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

test("visitor analytics tracker supports explicit test opt-out and sends auth for admins", () => {
  const tracker = read("baran-visitor-analytics.js");
  const admin = read("baran-visitor-analytics-admin.js");
  assert.match(tracker, /baran_analytics/);
  assert.match(tracker, /sessionStorage\.setItem\(OPT_OUT_KEY,"1"\)/);
  assert.match(tracker, /headers\.Authorization="Bearer "/);
  assert.match(tracker, /action:"track"/);
  assert.doesNotMatch(tracker, /email|user_id|navigator\.userAgent/);
  assert.match(admin, /action:"stats"/);
  assert.match(admin, /getSession/);
});

test("visitor analytics Edge Function excludes verified administrators from tracking", () => {
  const fn = read("supabase/functions/baran-visitor-analytics/index.ts");
  assert.match(fn, /auth\.getUser\(token\)/);
  assert.match(fn, /admin\.rpc\("admin_is_user"/);
  assert.match(fn, /excluded: "admin"/);
  assert.match(fn, /eq\("session_id", body\.session_id\)\.eq\("page_path", page\)\.limit\(1\)/);
  assert.match(fn, /One page view per page and browser tab session/);
});
