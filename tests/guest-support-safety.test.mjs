import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20261122170000_baran_guest_support_tickets.sql", import.meta.url), "utf8");
const api = readFileSync(new URL("../supabase/functions/baran-guest-support/index.ts", import.meta.url), "utf8");
const guestUi = readFileSync(new URL("../baran-guest-support.js", import.meta.url), "utf8");
const adminUi = readFileSync(new URL("../baran-guest-support-admin.js", import.meta.url), "utf8");
const assistant = readFileSync(new URL("../supabase/functions/baran-admin-offline/index.ts", import.meta.url), "utf8");
const app = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("guest support tables are isolated behind RLS and service role", () => {
  assert.match(migration, /alter table public\.baran_guest_support_tickets enable row level security/i);
  assert.match(migration, /alter table public\.baran_guest_support_messages enable row level security/i);
  assert.match(migration, /revoke all on table public\.baran_guest_support_tickets from anon, authenticated/i);
  assert.match(migration, /revoke all on table public\.baran_guest_support_messages from anon, authenticated/i);
  assert.match(migration, /grant all on table public\.baran_guest_support_tickets to service_role/i);
  assert.match(migration, /grant execute on function public\.consume_guest_support_rate_limit.*to service_role/is);
});

test("guest tracking secrets are hashed and never stored as plaintext", () => {
  assert.match(api, /crypto\.getRandomValues/);
  assert.match(api, /sha256\(pepper \+ \":ticket:\" \+ trackingSecret\)/);
  assert.match(api, /secret_hash/);
  assert.match(api, /tracking_secret: trackingSecret/);
});

test("public ticket creation and follow-up require server-verified Turnstile", () => {
  assert.match(api, /challenges\.cloudflare\.com\/turnstile\/v0\/siteverify/);
  assert.match(api, /verifyTurnstile\(captcha\)/);
  assert.match(api, /action === \"create\"/);
  assert.match(api, /action === \"guest_reply\"/);
});

test("admin ticket access is authenticated and checked against admin membership", () => {
  assert.match(api, /auth\.getUser\(jwt\)/);
  assert.match(api, /admin_is_user/);
  assert.match(api, /action === \"admin_list\"/);
  assert.match(api, /action === \"admin_reply\"/);
});

test("guest UI calls only the Edge Function and admin replies use the protected API", () => {
  assert.match(guestUi, /functions\/v1\/baran-guest-support/);
  assert.match(guestUi, /baranGuestSupportEntry/);
  assert.match(guestUi, /tracking_secret/);
  assert.match(adminUi, /action:"admin_list"/);
  assert.match(adminUi, /action:"admin_reply"/);
});

test("Baran Assistant reads visitor tickets and proposes drafts without sending them", () => {
  assert.match(assistant, /baran_guest_support_tickets/);
  assert.match(assistant, /guestSupportDraft/);
  assert.match(assistant, /تحتاج مراجعة بشرية قبل الإرسال/);
  assert.match(adminUi, /تحليل واقتراح رد/);
});


test("guest support has a standalone admin destination separate from BARO finance", () => {
  assert.match(app, /onclick="showAdminPanel\(\x27guest-support\x27\)"/);
  assert.match(app, /data-admin-panel="guest-support"[\s\S]*?id="baranGuestAdminMount"/);
  assert.match(app, /if\(id==="guest-support"&&typeof window\.loadBaranGuestSupportAdmin==="function"\)/);
  assert.match(adminUi, /\$\("baranGuestAdminMount"\)/);
  assert.match(adminUi, /mount\.appendChild\(panel\)/);
  assert.doesNotMatch(adminUi, /admin\.appendChild\(panel\)/);
});


test("closing a visitor ticket removes it from the open list and confirms success", () => {
  assert.match(adminUi, /const openTickets=tickets\.filter\(t=>t\.status!==\"closed\"\)/);
  assert.match(adminUi, /لا توجد تذاكر مفتوحة حالياً/);
  assert.match(adminUi, /await load\(\"تم إغلاق التذكرة بنجاح\.\"\)/);
  assert.match(adminUi, /successMessage\|\|/);
});
