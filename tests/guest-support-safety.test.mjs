import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20261122170000_baran_guest_support_tickets.sql", import.meta.url), "utf8");
const api = readFileSync(new URL("../supabase/functions/baran-guest-support/index.ts", import.meta.url), "utf8");
const guestUi = readFileSync(new URL("../baran-guest-support.js", import.meta.url), "utf8");
const adminUi = readFileSync(new URL("../baran-guest-support-admin.js", import.meta.url), "utf8");
const assistant = readFileSync(new URL("../supabase/functions/baran-admin-offline/index.ts", import.meta.url), "utf8");
const registeredAutoReply = readFileSync(new URL("../supabase/functions/baran-auto-support-reply/index.ts", import.meta.url), "utf8");
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

test("routine guest issues receive safe automatic replies while other cases remain with humans", () => {
  assert.match(api, /function safeGuestAutoReply/);
  assert.match(api, /sender_role: "assistant"/);
  assert.match(api, /status: "answered"/);
  assert.match(api, /const autoReply = safeGuestAutoReply\(subject, message\)/);
  assert.match(api, /const autoReply = safeGuestAutoReply\(ticket\.subject, message\)/);
  assert.match(api, /let resultingStatus = ticket\.status/);
  assert.match(api, /status: resultingStatus/);
  assert.match(api, /auto_replied: Boolean\(autoReply\)/);
  assert.match(api, /requires_human_review: !autoReply/);
  assert.match(api, /function guestHumanReview/);
  assert.match(api, /priority: "high"/);
  assert.match(api, /priority: "urgent"/);
  assert.match(api, /assistant_reason: manualReview\.reason/);
  assert.match(api, /رصيد\|محفظه\|محفظة\|شحن/);
  assert.match(api, /احتيال\|نصب\|سرقه\|اختراق/);
  assert.match(adminUi, /تذكرة حساسة أمنياً أو متعلقة بالخصوصية/);
  assert.match(guestUi, /data\.auto_replied&&data\.auto_reply_message/);
  assert.match(guestUi, /تحتاج رسالتك إلى مراجعة فريق الدعم/);
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

test("financial guest tickets are explicitly escalated and never treated as an automatic financial action", () => {
  assert.match(assistant, /تصنيف مالي — يحتاج مراجعة بشرية/);
  assert.match(assistant, /لا تنفذ أو تعدّل رصيداً أو دفعة أو استرداداً/);
  assert.match(adminUi, /تذكرة مالية حساسة: يجب تحويلها لمراجعة بشرية/);
  assert.match(adminUi, /لا ترسل كلمة المرور أو رمز التحقق أو بيانات البطاقة/);
  assert.match(api, /action === "admin_reply"/);
});


test("guest and registered-customer tickets share one admin support workspace", () => {
  assert.match(app, /id="supportTabGuests"[\s\S]*?switchSupportTab\('guests'\)/);
  assert.match(app, /baran-guest-support-admin\.js\?v=20261125-unified-support-2/);
  assert.match(app, /id="supportGuestView"[\s\S]*?id="baranGuestAdminMount"/);
  assert.match(app, /function switchSupportTab\(tab\)[\s\S]*?selected==="guests"[\s\S]*?loadBaranGuestSupportAdmin/);
  assert.match(app, /data-admin-panel="guest-support"[\s\S]*?showAdminPanel\('support'\)/);
  assert.match(adminUi, /\$\("baranGuestAdminMount"\)/);
  assert.match(adminUi, /mount\.appendChild\(panel\)/);
  assert.doesNotMatch(adminUi, /admin\.appendChild\(panel\)/);
});


test("admin ticket center exposes conversation history, filters, priority, and all statuses", () => {
  assert.match(api, /action === "admin_thread"/);
  assert.match(api, /notifyAdmins\(\s*ticket\.id,\s*ticket\.ticket_code/);
  assert.match(api, /admin_read_at: null/);
  assert.match(api, /admin_is_user/);
  assert.match(api, /baran_guest_support_messages/);
  assert.match(adminUi, /عرض سجل المحادثة/);
  assert.match(adminUi, /admin_thread/);
  assert.match(adminUi, /filterStatus/);
  assert.match(adminUi, /searchText/);
  assert.match(adminUi, /prioritySelect/);
  assert.match(adminUi, /closed/);
  assert.match(adminUi, /await load\("تم إغلاق التذكرة بنجاح\."/);
});

test("registered-customer manual-review queue links directly to its support ticket", () => {
  assert.match(registeredAutoReply, /function sensitiveReason/);
  assert.match(registeredAutoReply, /state: "needs_admin"/);
  assert.match(registeredAutoReply, /admin_update_customer_feedback/);
  assert.match(registeredAutoReply, /const hardStop = sensitiveReason\(ticket\.subject \?\? "", ticket\.message \?\? ""\)/);
  assert.match(registeredAutoReply, /if \(hardStop\)/);
  assert.match(registeredAutoReply, /decision !== "reply"/);
  assert.match(app, //فتح التذكرة في صندوق دعم العملاء/);
  assert.match(app, //switchSupportTab\("tickets"\)/);
  assert.match(app, //dataset\.feedbackId===String\(item\.feedback_id\|\|""\)/);
  assert.match(app, //سبب التحويل\/المعالجة/);
  assert.match(app, //لا يرسل المساعد رداً نهائياً/);
});
