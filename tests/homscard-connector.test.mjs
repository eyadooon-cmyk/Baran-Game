import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../supabase/functions/baran-homscard-connector/index.ts", import.meta.url), "utf8");

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

test("HomsCard connector never returns the API token or raw upstream body", () => {
  assert.match(source, /profile\.email/);
  assert.doesNotMatch(source, /return json\(\{[^}]*apiToken/s);
  assert.match(source, /Read-only catalog request/);
});
