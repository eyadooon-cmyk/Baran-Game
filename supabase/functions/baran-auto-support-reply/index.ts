import { createClient } from "npm:@supabase/supabase-js@2";

const ADMIN_ID = "7c6f69ed-7786-43ce-b340-78c4c1f9a4d7";
const MAX_PER_RUN = 2;
const MAX_PER_DAY = 50;

function readKeyObject(name: string): string | undefined {
  const raw = Deno.env.get(name);
  if (!raw) return undefined;
  try { return JSON.parse(raw).default; } catch { return undefined; }
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
function sensitiveReason(subject: string, message: string): string | null {
  const s = normalizeSupportText(subject + " " + message);
  const rules: Array<[RegExp, string]> = [
    [/شام\s*كاش|sham\s*cash|تحويل|حواله|ايداع|دفعة|دفع|اثبات\s*الدفع|فاتوره|فاتورة|تسديد|سداد|خصم|انخصم|سحب|استرجاع|استرداد|تعويض|رصيد|محفظه|refund|payment|deposit|wallet|balance|transfer|chargeback|money|billing|invoice/i, "موضوع مالي أو تحويل أو رصيد يحتاج مراجعة المدير"],
    [/شحن|تسليم|تفعيل\s*(?:طلب|اشتراك)|طلب\s*(?:شحن|شراء)|اوردر|order\s*(?:delivery|fulfillment)|top\s*up|topup|fulfil/i, "طلب شحن أو تسليم يحتاج تحققاً تشغيلياً"],
    [/احتيال|نصب|سرقه|اختراق|تهديد|ابتزاز|محامي|قانوني|شكوى\s*رسميه|خصوصيه|بياناتي|حذف\s*(?:الحساب|البيانات)|fraud|scam|hacked|stolen|legal|privacy|delete\s*(?:account|data)/i, "شكوى أمنية أو قانونية أو خصوصية تحتاج المدير"],
    [/(?:كلمه\s*المرور|كلمه\s*السر|password|passcode|رمز\s*التحقق|كود\s*التحقق|verification\s*code|otp|pin|api[_ -]?key|access[_ -]?token).{0,45}(?:[:=]|ارسل|ابعث|اعطني|اعطيني|مشاركه|send|share|give)|(?:send|share|give).{0,30}(?:password|otp|verification\s*code|pin)|(?:password|passcode|otp|pin)\s*[:=]\s*\S+/i, "طلب أو إفصاح متعلق ببيانات اعتماد أو رموز سرية"],
    [/\b(?:\d[ -]*?){13,19}\b|(?:رقم\s*البطاقه|بطاقه\s*بنكيه|credit\s*card|card\s*number)/i, "بيانات بطاقة أو وسيلة دفع حساسة تحتاج مراجعة المدير"],
  ];
  for (const [pattern, reason] of rules) if (pattern.test(s)) return reason;
  return null;
}

function normalizeSupportText(value: string): string {
  return String(value || "").toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
function classifySupportTicket(subject: string, message: string): { decision: "reply" | "needs_admin"; reason: string; reply: string } {
  const text = normalizeSupportText(subject + " " + message);
  if (/(نسيت|ناسي|ضاعت).{0,25}(كلمه المرور|كلمة السر|الباسورد)|ما عم اقدر فوت|ما بقدر سجل دخول|مشكل[هة] تسجيل الدخول|login|password reset/i.test(text)) {
    return {
      decision: "reply",
      reason: "إرشادات استعادة الدخول الآمنة",
      reply: "أهلاً فيك، منساعدك ❤️ جرّب الخطوات التالية:\n1. تأكد من البريد الإلكتروني المرتبط بحسابك.\n2. من صفحة الدخول اضغط «نسيت كلمة المرور؟».\n3. افتح رسالة الاستعادة، وتحقق أيضاً من مجلد الرسائل غير المرغوب فيها.\n4. إذا ما وصلك الرابط بعد إعادة محاولة واحدة، رد علينا هون حتى يتابع فريق الدعم المشكلة.\nمهم: لا ترسل كلمة مرورك أو رمز التحقق لأي شخص."
    };
  }
  if (/(الموقع|الصفحه|التطبيق).{0,25}(ما بيفتح|ما عم يفتح|بطيء|بطيئ|علق|معلق)|ما عم يفتح معي|المتجر ما بيفتح|loading|site not loading/i.test(text)) {
    return {
      decision: "reply",
      reason: "خطوات استكشاف عطل فتح الموقع",
      reply: "أهلاً فيك، جرّب هالخطوات بالترتيب:\n1. تأكد من اتصال الإنترنت.\n2. حدّث صفحة المتجر.\n3. سكّر Chrome وافتحه من جديد.\n4. إذا استمرت المشكلة، جرّب فتح المتجر بمتصفح آخر ورد علينا بالنتيجة.\nلا تحذف بيانات حسابك أو التطبيق."
    };
  }
  if (/(الاشعارات|اشعارات|التنبيهات).{0,30}(ما عم توصل|ما بتوصل|ما عم تظهر|ما عم تجي)|ما عم توصلني اشعارات|notifications/i.test(text)) {
    return {
      decision: "reply",
      reason: "إرشادات تفعيل إشعارات المتجر",
      reply: "أهلاً فيك 🌟 تأكد من هالأمور:\n1. اسمح بالإشعارات لموقع BARAN GAME من إعدادات Chrome.\n2. من إعدادات الهاتف افتح التطبيقات ثم Chrome وتأكد أن الإشعارات مسموحة.\n3. افتح المتجر مرة ثانية وتأكد أن خيار الإشعارات مفعّل من داخل الحساب.\n4. جرّب إشعاراً جديداً بعد هالخطوات. إذا ما وصل، رد علينا بنوع جهازك وإصدار Android."
    };
  }
  return {
    decision: "needs_admin",
    reason: "الموضوع يحتاج فهماً أو تحققاً خاصاً قبل إرسال رد تلقائي",
    reply: ""
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? readKeyObject("SUPABASE_SECRET_KEYS");
    if (!url || !serviceKey) return json({ error: "Server configuration is incomplete" }, 500);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const secret = req.headers.get("x-baran-cron-secret") ?? "";
    const { data: authorized, error: authError } = await admin.rpc("baran_auto_support_check_secret", { p_token: secret });
    if (authError || authorized !== true) return json({ error: "Unauthorized" }, 401);

    let body: { dry_run?: boolean } = {};
    try { body = await req.json(); } catch {}
    const dryRun = body.dry_run === true;
    const { data: enabled, error: enabledError } = await admin.rpc("baran_auto_support_is_enabled");
    if (enabledError) return json({ error: "تعذر قراءة إعداد الرد الآلي" }, 500);
    if (!enabled && !dryRun) { console.log("baran-auto-support: disabled"); return json({ ok: true, disabled: true, processed: 0 }); }

    if (!dryRun) {
      await admin.from("baran_auto_support_queue").update({ state: "queued", reason: "استعادة مهمة توقفت قبل إكمالها", updated_at: new Date().toISOString() })
        .eq("state", "processing").lt("updated_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count } = await admin.from("baran_auto_support_queue").select("id", { count: "exact", head: true })
        .eq("state", "sent").gte("processed_at", since);
      if ((count ?? 0) >= MAX_PER_DAY) return json({ ok: true, daily_limit_reached: true, processed: 0 });
    }

    const { data: jobs, error: jobsError } = await admin.from("baran_auto_support_queue")
      .select("id,feedback_id,ticket_code,state,attempts").eq("state", "queued").lte("updated_at", new Date().toISOString())
      .order("created_at", { ascending: true }).limit(dryRun ? 1 : MAX_PER_RUN);
    if (jobsError) return json({ error: "تعذر قراءة طابور التذاكر" }, 500);
    if (!jobs?.length) { console.log("baran-auto-support: no queued tickets"); return json({ ok: true, processed: 0, message: "لا توجد تذاكر بانتظار المعالجة" }); }
    console.log("baran-auto-support: queue loaded", { enabled, dryRun, count: jobs.length });

    const results: Array<Record<string, unknown>> = [];
    for (const job of jobs) {
      if (!dryRun) {
        const { data: claimed, error: claimError } = await admin.from("baran_auto_support_queue")
          .update({ state: "processing", attempts: job.attempts + 1, updated_at: new Date().toISOString(), last_error: null })
          .eq("id", job.id).eq("state", "queued").select("id").maybeSingle();
        if (claimError || !claimed) continue;
      }

      const { data: ticket, error: ticketError } = await admin.from("customer_feedback")
        .select("id,ticket_code,feedback_type,subject,message,status,admin_reply,created_at,user_id")
        .eq("id", job.feedback_id).maybeSingle();

      if (ticketError || !ticket || ticket.feedback_type !== "support") {
        if (!dryRun) await admin.from("baran_auto_support_queue").update({
          state: "needs_admin", reason: "تعذر التحقق من بيانات التذكرة", updated_at: new Date().toISOString(), processed_at: new Date().toISOString()
        }).eq("id", job.id);
        results.push({ ticket_code: job.ticket_code, decision: "needs_admin", reason: "تعذر التحقق من بيانات التذكرة" });
        continue;
      }
      const hardStop = sensitiveReason(ticket.subject ?? "", ticket.message ?? "");
      if (hardStop) {
        if (!dryRun) {
          await admin.from("baran_auto_support_queue").update({
            state: "needs_admin", reason: hardStop, updated_at: new Date().toISOString(), processed_at: new Date().toISOString()
          }).eq("id", job.id);
          await admin.from("baran_notifications").insert({
            recipient_id: ADMIN_ID, audience: "admin", kind: "support_new",
            title: "تذكرة تحتاج تدخلك", body: (ticket.ticket_code || "تذكرة دعم") + ": " + hardStop,
            entity_type: "customer_feedback", entity_id: ticket.id
          });
        }
        results.push({ ticket_code: ticket.ticket_code, decision: "needs_admin", reason: hardStop });
        continue;
      }
      if (String(ticket.admin_reply ?? "").trim()) {
        if (!dryRun) await admin.from("baran_auto_support_queue").update({
          state: "sent", reason: "يوجد رد سابق محفوظ؛ لم يتم إرسال رد مكرر", updated_at: new Date().toISOString(), processed_at: new Date().toISOString()
        }).eq("id", job.id);
        results.push({ ticket_code: ticket.ticket_code, decision: "skip", reason: "يوجد رد سابق" });
        continue;
      }
      if (!["pending", "in_progress"].includes(ticket.status)) {
        if (!dryRun) await admin.from("baran_auto_support_queue").update({
          state: "needs_admin", reason: "حالة التذكرة ليست مفتوحة", updated_at: new Date().toISOString(), processed_at: new Date().toISOString()
        }).eq("id", job.id);
        results.push({ ticket_code: ticket.ticket_code, decision: "needs_admin", reason: "حالة التذكرة ليست مفتوحة" });
        continue;
      }



      const internalStarted = Date.now();
      const classification = classifySupportTicket(ticket.subject ?? "", ticket.message ?? "");
      let decision = classification.decision;
      let reason = classification.reason;
      let customerReply = classification.reply;
      if (!dryRun) {
        const { error: usageError } = await admin.from("ai_usage_events").insert({
          function_name: "baran-auto-support-reply",
          feature: "automatic_support",
          actor_user_id: ticket.user_id ?? null,
          route: "internal",
          usage_status: "succeeded",
          model: "baran-internal-rules-v1",
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          status_code: 200,
          duration_ms: Math.max(0, Date.now() - internalStarted),
          completed_at: new Date().toISOString()
        });
        if (usageError) console.error("baran-auto-support: internal usage log failed", usageError.message);
      }

      if (dryRun) {
        results.push({ ticket_code: ticket.ticket_code, decision, reason, reply_preview: customerReply });
        continue;
      }

      if (decision !== "reply") {
        await admin.from("baran_auto_support_queue").update({
          state: "needs_admin", reason, updated_at: new Date().toISOString(), processed_at: new Date().toISOString()
        }).eq("id", job.id);
        await admin.from("baran_notifications").insert({
          recipient_id: ADMIN_ID, audience: "admin", kind: "support_new",
          title: "تذكرة تحتاج مراجعتك", body: (ticket.ticket_code || "تذكرة دعم") + ": " + reason.slice(0, 350),
          entity_type: "customer_feedback", entity_id: ticket.id
        });
        results.push({ ticket_code: ticket.ticket_code, decision: "needs_admin", reason });
        continue;
      }

      const { data: sent, error: sendError } = await admin.rpc("admin_update_customer_feedback", {
        p_admin_id: ADMIN_ID, p_feedback_id: ticket.id, p_status: ticket.status, p_reply: customerReply,
      });
      if (sendError) {
        await admin.from("baran_auto_support_queue").update({
          state: "failed", reason: "تم توليد الرد لكن تعذر حفظه وإرساله", last_error: sendError.message.slice(0, 500),
          updated_at: new Date().toISOString()
        }).eq("id", job.id);
        results.push({ ticket_code: ticket.ticket_code, decision: "failed", reason: "تعذر حفظ الرد وإرساله" });
        continue;
      }

      await admin.from("baran_auto_support_queue").update({
        state: "sent", reason, generated_reply: customerReply, updated_at: new Date().toISOString(),
        processed_at: new Date().toISOString(), last_error: null
      }).eq("id", job.id);
      const { error: historyError } = await admin.from("baran_support_messages").insert({
        feedback_id: ticket.id, sender_id: ADMIN_ID, sender_role: "assistant",
        message: customerReply, message_type: "message"
      });
      if (historyError) console.error("baran-auto-support: conversation history write failed", historyError.message);
      results.push({ ticket_code: ticket.ticket_code, decision: "sent", notification_created: sent?.notification_created === true });
    }
    console.log("baran-auto-support: completed", { dryRun, results: results.map((r) => ({ ticket_code: r.ticket_code, decision: r.decision, reason: r.reason })) });
    return json({ ok: true, dry_run: dryRun, processed: results.length, results });
  } catch (error) {
    console.error("baran-auto-support-reply failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "حدث خطأ داخلي أثناء معالجة تذاكر الدعم" }, 500);
  }
});