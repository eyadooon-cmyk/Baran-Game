import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://eyadooon-cmyk.github.io",
  "https://baran-game.pages.dev",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
]);
const MAX_BODY = 12000;

function json(body: unknown, status = 200, origin = "") {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : "https://baran-game.pages.dev";
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": allowed,
      "Vary": "Origin",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function randomHex(size: number) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return hex(bytes);
}
async function sha256(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function getSecretObject(name: string) {
  try { return JSON.parse(Deno.env.get(name) || "{}").default as string | undefined; }
  catch { return undefined; }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  if (req.method === "OPTIONS") return json({ ok: true }, 200, origin);
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: "Origin not allowed" }, 403, origin);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? getSecretObject("SUPABASE_PUBLISHABLE_KEYS");
    const pepper = Deno.env.get("BARAN_GUEST_SUPPORT_PEPPER");
    const turnstileSecret = Deno.env.get("TURNSTILE_SECRET_KEY");
    if (!url || !serviceKey || !anonKey || !pepper) {
      return json({ error: "خدمة الدعم غير مكتملة الإعداد حالياً." }, 503, origin);
    }

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const bodyText = await req.text();
    if (bodyText.length > MAX_BODY) return json({ error: "حجم الطلب أكبر من المسموح." }, 413, origin);
    let body: Record<string, unknown>;
    try { body = JSON.parse(bodyText); } catch { return json({ error: "بيانات الطلب غير صالحة." }, 400, origin); }
    const action = clean(body.action, 24);
    const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const ipHash = await sha256(pepper + ":ip:" + ip);
    const now = new Date();
    const windowStart = new Date(Math.floor(now.getTime() / 900000) * 900000).toISOString();

    async function rateLimit(limit: number) {
      const { data, error } = await admin.rpc("consume_guest_support_rate_limit", {
        p_key_hash: ipHash,
        p_window_start: windowStart,
        p_limit: limit,
      });
      if (error) throw new Error("تعذر التحقق من حد الطلبات.");
      return data === true;
    }

    async function notifyAdmins(ticketId: string, ticketCode: string, title: string, message: string) {
      const { data: admins, error: adminsError } = await admin.from("admin_users").select("user_id");
      if (adminsError) {
        console.error("guest support admin notification recipients failed", adminsError.message);
        return;
      }
      const recipients = (admins || []).filter((row) => typeof row.user_id === "string");
      if (!recipients.length) return;
      const { error: notificationError } = await admin.from("baran_notifications").insert(recipients.map((row) => ({
        recipient_id: row.user_id,
        audience: "admin",
        kind: "support_new",
        title,
        body: ticketCode + " — " + message,
        entity_type: "baran_guest_support_tickets",
        entity_id: ticketId,
      })));
      if (notificationError) console.error("guest support admin notification insert failed", notificationError.message);
    }

    async function verifyTurnstile(token: string) {
      if (!turnstileSecret || !token || token.length > 2048) return false;
      const form = new FormData();
      form.set("secret", turnstileSecret);
      form.set("response", token);
      if (ip !== "unknown") form.set("remoteip", ip);
      const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        body: form,
      });
      if (!response.ok) return false;
      const result = await response.json();
      return result.success === true && (!result.hostname || ALLOWED_ORIGINS.has("https://" + result.hostname));
    }

    async function adminUser() {
      const auth = req.headers.get("authorization") || "";
      const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!jwt) return null;
      const userClient = createClient(url!, anonKey!, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await userClient.auth.getUser(jwt);
      if (error || !data.user) return null;
      const { data: isAdmin, error: checkError } = await admin.rpc("admin_is_user", { p_user_id: data.user.id });
      if (checkError || isAdmin !== true) return null;
      return data.user;
    }

    if (action === "create") {
      if (!await rateLimit(4)) return json({ error: "وصلت للحد المؤقت لفتح التذاكر. حاول بعد 15 دقيقة." }, 429, origin);
      const email = clean(body.email, 254).toLowerCase();
      const subject = clean(body.subject, 120) || "مشكلة بالدخول أو إنشاء حساب";
      const message = clean(body.message, 5000);
      const captcha = clean(body.turnstile_token, 2048);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "اكتب بريداً إلكترونياً صحيحاً." }, 400, origin);
      if (message.length < 10) return json({ error: "اشرح المشكلة بعشر كلمات أو أكثر حتى نقدر نساعدك." }, 400, origin);
      if (!await verifyTurnstile(captcha)) return json({ error: "فشل التحقق الأمني. حدّث التحقق وحاول مرة ثانية." }, 400, origin);

      const trackingSecret = randomHex(32);
      const secretHash = await sha256(pepper + ":ticket:" + trackingSecret);
      const dateCode = now.toISOString().slice(0, 10).replaceAll("-", "");
      let ticket: { id: string; ticket_code: string } | null = null;
      for (let attempt = 0; attempt < 3 && !ticket; attempt++) {
        const ticketCode = "BG-G-" + dateCode + "-" + randomHex(3).toUpperCase();
        const { data, error } = await admin.from("baran_guest_support_tickets").insert({
          ticket_code: ticketCode,
          email,
          subject,
          initial_message: message,
          secret_hash: secretHash,
          last_customer_message_at: now.toISOString(),
        }).select("id,ticket_code").single();
        if (!error && data) ticket = data;
        else if (error && !String(error.code || "").includes("23505")) throw new Error("تعذر إنشاء التذكرة.");
      }
      if (!ticket) return json({ error: "تعذر إنشاء رقم التذكرة. حاول مرة ثانية." }, 500, origin);
      const { error: messageError } = await admin.from("baran_guest_support_messages").insert({
        ticket_id: ticket.id,
        sender_role: "guest",
        message,
      });
      if (messageError) {
        await admin.from("baran_guest_support_tickets").delete().eq("id", ticket.id);
        throw new Error("تعذر حفظ رسالة التذكرة.");
      }
      await notifyAdmins(ticket.id, ticket.ticket_code, "تذكرة دعم جديدة من زائر", "وصلت تذكرة جديدة وتحتاج إلى مراجعة الفريق.");
      return json({
        success: true,
        ticket_code: ticket.ticket_code,
        tracking_secret: trackingSecret,
        message: "تم فتح تذكرة الدعم. احتفظ برقم التذكرة والرمز السري بمكان آمن.",
      }, 201, origin);
    }

    if (action === "lookup" || action === "guest_reply") {
      if (!await rateLimit(action === "lookup" ? 12 : 5)) {
        return json({ error: "محاولات كثيرة خلال وقت قصير. حاول بعد 15 دقيقة." }, 429, origin);
      }
      const ticketCode = clean(body.ticket_code, 40).toUpperCase();
      const trackingSecret = clean(body.tracking_secret, 128);
      if (!/^BG-G-\d{8}-[A-F0-9]{6}$/.test(ticketCode) || !/^[a-f0-9]{64}$/.test(trackingSecret)) {
        return json({ error: "رقم التذكرة أو الرمز السري غير صحيح." }, 400, origin);
      }
      const { data: ticket, error } = await admin.from("baran_guest_support_tickets")
        .select("id,ticket_code,subject,status,created_at,updated_at,secret_hash")
        .eq("ticket_code", ticketCode).maybeSingle();
      if (error || !ticket) return json({ error: "التذكرة غير موجودة أو بيانات المتابعة غير صحيحة." }, 404, origin);
      const suppliedHash = await sha256(pepper + ":ticket:" + trackingSecret);
      if (!safeEqual(suppliedHash, ticket.secret_hash)) return json({ error: "التذكرة غير موجودة أو بيانات المتابعة غير صحيحة." }, 404, origin);

      if (action === "guest_reply") {
        const message = clean(body.message, 5000);
        if (message.length < 2) return json({ error: "اكتب رسالتك أولاً." }, 400, origin);
        const captcha = clean(body.turnstile_token, 2048);
        if (!await verifyTurnstile(captcha)) return json({ error: "فشل التحقق الأمني. حاول مرة ثانية." }, 400, origin);
        if (ticket.status === "closed") return json({ error: "هذه التذكرة مغلقة. افتح تذكرة جديدة إذا احتجت مساعدة." }, 409, origin);
        const { error: insertError } = await admin.from("baran_guest_support_messages").insert({
          ticket_id: ticket.id, sender_role: "guest", message,
        });
        if (insertError) throw new Error("تعذر إرسال الرسالة.");
        await admin.from("baran_guest_support_tickets").update({
          status: "pending", admin_read_at: null, last_customer_message_at: now.toISOString(), updated_at: now.toISOString(),
        }).eq("id", ticket.id);
        await notifyAdmins(ticket.id, ticket.ticket_code, "رسالة جديدة من زائر", "وصل رد جديد على تذكرة الدعم.");
      }

      const { data: messages, error: messagesError } = await admin.from("baran_guest_support_messages")
        .select("id,sender_role,message,created_at")
        .eq("ticket_id", ticket.id).order("created_at", { ascending: true }).limit(100);
      if (messagesError) throw new Error("تعذر تحميل المحادثة.");
      return json({
        success: true,
        ticket: { ticket_code: ticket.ticket_code, subject: ticket.subject, status: action === "guest_reply" ? "pending" : ticket.status, created_at: ticket.created_at },
        messages: messages || [],
      }, 200, origin);
    }

    if (action === "admin_list" || action === "admin_thread" || action === "admin_reply" || action === "admin_update") {
      const user = await adminUser();
      if (!user) return json({ error: "غير مصرح." }, 401, origin);
      if (action === "admin_list") {
        const { data, error } = await admin.from("baran_guest_support_tickets")
          .select("id,ticket_code,email,subject,initial_message,status,priority,assistant_reason,assistant_draft,admin_read_at,created_at,updated_at,last_customer_message_at,last_admin_message_at")
          .order("updated_at", { ascending: false }).limit(100);
        if (error) throw new Error("تعذر تحميل تذاكر الزوار.");
        return json({ success: true, tickets: data || [] }, 200, origin);
      }
      const ticketId = clean(body.ticket_id, 64);
      if (action === "admin_thread") {
        if (!/^[0-9a-f-]{36}$/i.test(ticketId)) return json({ error: "معرّف التذكرة غير صحيح." }, 400, origin);
        const { data: threadTicket, error: threadError } = await admin.from("baran_guest_support_tickets")
          .select("id,ticket_code,email,subject,initial_message,status,priority,assistant_reason,assistant_draft,created_at,updated_at,last_customer_message_at,last_admin_message_at")
          .eq("id", ticketId).maybeSingle();
        if (threadError || !threadTicket) return json({ error: "التذكرة غير موجودة." }, 404, origin);
        const { data: threadMessages, error: threadMessagesError } = await admin.from("baran_guest_support_messages")
          .select("id,sender_role,message,created_at,read_at")
          .eq("ticket_id", ticketId).order("created_at", { ascending: true }).limit(200);
        if (threadMessagesError) throw new Error("تعذر تحميل محادثة التذكرة.");
        const { error: ticketReadError } = await admin.from("baran_guest_support_tickets")
          .update({ admin_read_at: now.toISOString() }).eq("id", ticketId);
        if (ticketReadError) throw new Error("تعذر تسجيل قراءة التذكرة.");
        const { error: messagesReadError } = await admin.from("baran_guest_support_messages").update({ read_at: now.toISOString() })
          .eq("ticket_id", ticketId).eq("sender_role", "guest").is("read_at", null);
        if (messagesReadError) throw new Error("تعذر تحديث حالة قراءة الرسائل.");
        return json({ success: true, ticket: threadTicket, messages: threadMessages || [] }, 200, origin);
      }
      if (!/^[0-9a-f-]{36}$/i.test(ticketId)) return json({ error: "معرّف التذكرة غير صحيح." }, 400, origin);
      const { data: ticket, error: ticketError } = await admin.from("baran_guest_support_tickets")
        .select("id,status").eq("id", ticketId).maybeSingle();
      if (ticketError || !ticket) return json({ error: "التذكرة غير موجودة." }, 404, origin);
      if (action === "admin_reply") {
        const message = clean(body.message, 5000);
        if (message.length < 2) return json({ error: "اكتب الرد أولاً." }, 400, origin);
        const { error: insertError } = await admin.from("baran_guest_support_messages").insert({
          ticket_id: ticketId, sender_role: "admin", message,
        });
        if (insertError) throw new Error("تعذر حفظ الرد.");
        await admin.from("baran_guest_support_tickets").update({
          status: "answered", last_admin_message_at: now.toISOString(), updated_at: now.toISOString(),
        }).eq("id", ticketId);
        return json({ success: true }, 200, origin);
      }
      const status = clean(body.status, 20);
      const priority = clean(body.priority, 20);
      const patch: Record<string, unknown> = { updated_at: now.toISOString() };
      if (["pending","in_progress","answered","closed"].includes(status)) patch.status = status;
      if (["low","normal","high","urgent"].includes(priority)) patch.priority = priority;
      if (Object.keys(patch).length === 1) return json({ error: "لا يوجد تعديل صالح." }, 400, origin);
      const { error: updateError } = await admin.from("baran_guest_support_tickets").update(patch).eq("id", ticketId);
      if (updateError) throw new Error("تعذر تحديث التذكرة.");
      return json({ success: true }, 200, origin);
    }

    return json({ error: "إجراء غير معروف." }, 400, origin);
  } catch (error) {
    console.error("baran-guest-support error", error);
    return json({ error: error instanceof Error ? error.message : "حدث خطأ غير متوقع." }, 500, origin);
  }
});
