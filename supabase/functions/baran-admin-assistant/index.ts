import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = "https://eyadooon-cmyk.github.io";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
function readKeyObject(name: string): string | undefined {
  const raw = Deno.env.get(name);
  if (!raw) return undefined;
  try { return JSON.parse(raw).default; } catch { return undefined; }
}


function normalizeAdminText(value: string): string {
  return String(value || "").toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
}
function fmtAdminAmount(value: unknown): string {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n) : "غير متاح";
}
function countAdminStatuses(rows: any[], field = "status"): Record<string, number> {
  return (rows || []).reduce((out: Record<string, number>, row: any) => {
    const key = String(row?.[field] ?? "غير محدد");
    out[key] = (out[key] || 0) + 1;
    return out;
  }, {});
}
function internalAdminReply(question: string, ctx: any, flags: any): string {
  const q = normalizeAdminText(question);
  const out: string[] = [];
  const health = ctx.store_health || {};
  const orders = Array.isArray(ctx.recent_orders) ? ctx.recent_orders : [];
  const baroOrders = Array.isArray(ctx.recent_baro_manual_orders) ? ctx.recent_baro_manual_orders : [];
  const tickets = Array.isArray(ctx.recent_support_tickets) ? ctx.recent_support_tickets.filter((t: any) => t.feedback_type === "support") : [];
  const products = Array.isArray(ctx.products) ? ctx.products : [];
  const suppliers = Array.isArray(ctx.suppliers) ? ctx.suppliers : [];
  const deposits = Array.isArray(ctx.recent_deposits) ? ctx.recent_deposits : [];
  if (flags.finance) {
    const baroCompleted = baroOrders.filter((o: any) => o.status === "completed" && o.payment_status === "verified");
    const baroSalesSyp = baroCompleted.reduce((sum: number, o: any) => sum + Number(o.customer_price_syp || 0), 0);
    const baroSalesUsd = baroCompleted.reduce((sum: number, o: any) => sum + Number(o.customer_price_usd || 0), 0);
    const baroSupplierCostUsd = baroCompleted.reduce((sum: number, o: any) => sum + Number(o.supplier_cost_usd_snapshot ?? o.supplier_cost_usd ?? 0), 0);
    const totals = Array.isArray(ctx.finance?.totals) ? ctx.finance.totals : [];
    const period = q.includes("اليوم") ? "today_" : q.includes("الشهر") ? "month_" : "";
    const label = period === "today_" ? "اليوم" : period === "month_" ? "هذا الشهر" : "الإجمالي المسجل";
    if (!totals.length) out.push("البيانات المالية الرسمية غير متاحة في هذه اللقطة؛ لم أستنتج أرقاماً بديلة.");
    else {
      out.push("الملخص المالي — " + label + " (كل عملة منفصلة):");
      for (const row of totals) {
        const sales = row[period + "sales"] ?? (period ? null : row.sales);
        const cost = row[period + "cost"] ?? (period ? null : row.cost);
        const expenses = row[period + "expenses"] ?? (period ? null : row.expenses);
        const profit = row[period + "profit"] ?? (period ? null : row.profit);
        const currency = String(row.currency || "عملة غير محددة");
        out.push("• " + currency + ": المبيعات " + fmtAdminAmount(sales) + "، تكلفة البضاعة " + fmtAdminAmount(cost) + "، المصاريف " + fmtAdminAmount(expenses) + "، صافي الربح المسجل " + fmtAdminAmount(profit) + ".");
      }
      out.push("ملاحظة: الأرقام من سجل الإدارة المالي الرسمي فقط. رأس المال ليس ربحاً، ولا أخلط USD مع SYP.");
    out.push("مبيعات BARO اليدوية المكتملة والمدفوعة الموثقة: " + baroCompleted.length + " طلباً؛ مبيعات الزبائن " + fmtAdminAmount(baroSalesSyp) + " SYP و" + fmtAdminAmount(baroSalesUsd) + " USD؛ تكلفة المورد المسجلة " + fmtAdminAmount(baroSupplierCostUsd) + " USD. هذه مجاميع مستقلة ولا تمثل صافي ربح، ولا تُضاف إلى RPC المالي الرسمي لتجنب الازدواج حتى تتم مطابقة مصدره.");
    }
    const productProfit = Array.isArray(ctx.product_profit_report) ? ctx.product_profit_report : [];
    if (productProfit.length && (q.includes("منتج") || q.includes("المنتجات") || q.includes("افضل") || q.includes("أعلى"))) {
      const top = productProfit.slice().sort((a: any,b: any) => Number(b.gross_profit||0)-Number(a.gross_profit||0)).slice(0,5);
      out.push("أعلى المنتجات ربحاً إجمالياً هذا الشهر:");
      for (const row of top) out.push("• " + row.product_name + " — " + row.currency + ": ربح إجمالي " + fmtAdminAmount(row.gross_profit) + "، مبيعات " + fmtAdminAmount(row.sales) + "، تكلفة " + fmtAdminAmount(row.cost) + ".");
      out.push("هذا ربح إجمالي للمنتج قبل توزيع المصاريف العامة.");
    }
  }
  if (flags.products) {
    const active = products.filter((p: any)=>p.is_active);
    const missing = active.filter((p: any)=>p.price_usd==null && p.price_syp==null);
    const inactive = products.filter((p: any)=>!p.is_active);
    out.push("المنتجات: " + products.length + " ضمن آخر 100 سجل محمّل؛ النشط " + active.length + "، المخفي " + inactive.length + "، النشط بلا سعر مسجل في حقول USD/SYP " + missing.length + ".");
    if (missing.length) out.push("أمثلة تحتاج مراجعة سعر: " + missing.slice(0,8).map((p: any)=>p.name).join("، ") + ".");
    out.push("لم أغيّر أي سعر أو حالة منتج.");
  }
  if (flags.suppliers) {
    const active = suppliers.filter((s: any)=>s.is_active);
    const f = Array.isArray(ctx.recent_fulfillment) ? ctx.recent_fulfillment : [];
    const missingCosts = f.filter((x: any)=>x.supplier_total_cost==null || !x.supplier_cost_currency || !x.supplier_cost_exchange_rate).length;
    out.push("الموردون: " + suppliers.length + " ضمن العينة، النشط " + active.length + "، غير النشط " + (suppliers.length-active.length) + ". سجلات التنفيذ المحمّلة " + f.length + "، منها " + missingCosts + " تفتقد تكلفة أو عملة أو سعر صرف.");
    out.push("وجود مورد أو ربط منتج لا يثبت أن API يعمل أو أن الشحن التلقائي مفعّل؛ لا يوجد أي تعديل.");
  }
  if (flags.orders) {
    const status = countAdminStatuses(orders);
    const manualStatus = countAdminStatuses(baroOrders);
    const open = [...orders, ...baroOrders].filter((o: any)=>["pending","processing","awaiting_supplier"].includes(o.status));
    const failed = [...orders, ...baroOrders].filter((o: any)=>["failed","rejected"].includes(o.status));
    const completedBaro = baroOrders.filter((o: any)=>o.status === "completed");
    out.push("الطلبات: " + (orders.length + baroOrders.length) + " إجمالاً ضمن العينات؛ الطلبات العامة " + orders.length + "، وطلبات BARO اليدوية " + baroOrders.length + " (مكتمل " + completedBaro.length + "). المفتوح " + open.length + "، الفاشل/المرفوض " + failed.length + ". حالات الطلبات العامة: " + JSON.stringify(status) + "؛ حالات BARO: " + JSON.stringify(manualStatus) + ".");
    if (open.length) out.push("أمثلة طلبات مفتوحة: " + open.slice(0,8).map((o: any)=>String(o.product_code||"طلب")+" ["+String(o.status)+"]").join("، ") + ".");
    out.push("لم أغيّر حالة أي طلب ولم أنفذ شحناً.");
  }
  if (flags.support) {
    const open = tickets.filter((t: any)=>["pending","in_progress"].includes(t.status));
    const match = question.match(/BG-\d{8}-[A-Z0-9]{8}/i);
    if (match) {
      const ticket = tickets.find((t: any)=>String(t.ticket_code||"").toUpperCase()===match[0].toUpperCase());
      if (ticket) {
        out.push("التذكرة " + ticket.ticket_code + " — " + (ticket.subject||"دون عنوان") + "، الحالة: " + ticket.status + ".");
        out.push("نص الزبون: " + String(ticket.message||"").slice(0,700));
        if (ticket.admin_reply) out.push("الرد المسجل سابقاً: " + String(ticket.admin_reply).slice(0,500));
        else out.push("مسودة آمنة مقترحة: أهلاً فيك، وصلتنا رسالتك ورح يراجع فريق Baran Game التفاصيل ويتابع معك عبر هالتذكرة. إذا عندك معلومة إضافية غير حساسة بتساعدنا نفهم المشكلة، أرسلها هون.");
      } else out.push("لم أجد التذكرة " + match[0] + " ضمن آخر 50 تذكرة محمّلة. لم يتم إرسال أي رد.");
    } else {
      out.push("الدعم: " + tickets.length + " تذكرة ضمن آخر 50 سجلاً؛ المفتوح " + open.length + ". " + (open.length ? "أحدث التذاكر المفتوحة: " + open.slice(0,10).map((t: any)=>(t.ticket_code||"بدون رقم")+" — "+(t.subject||"دون عنوان")+" ["+t.status+"]").join("؛ ") : "لا توجد تذاكر مفتوحة ضمن العينة.") + ".");
    }
    out.push("التحليل لا يرسل رداً ولا يغيّر حالة التذكرة. الإرسال يحتاج أمراً صريحاً ورقم BG كاملاً.");
  }
  if (flags.deposit) {
    const pending = deposits.filter((d: any)=>d.status==="pending");
    out.push("الإيداعات: " + deposits.length + " من أحدث 50 سجلاً؛ المعلّق ضمن العينة " + pending.length + "، وإجمالي المعلّق حسب العداد الرسمي " + (health.pending_deposits_total ?? "غير متاح") + ".");
    out.push("لا أؤكد حوالة ولا أوافق/أرفض إيداعاً ولا أعدّل رصيداً. يلزم تطابق يدوي مع إثبات شام كاش والسجل.");
  }
  if (flags.audit) {
    const rows = Array.isArray(ctx.recent_admin_audit) ? ctx.recent_admin_audit : [];
    out.push("سجل التدقيق: قرأت أحدث " + rows.length + " حدثاً. توزيع الإجراءات: " + JSON.stringify(countAdminStatuses(rows,"action")) + ". هذا ملخص فقط ولا يعرض أسراراً أو تفاصيل حساسة.");
  }
  if (flags.notifications) {
    const rows = Array.isArray(ctx.admin_notifications) ? ctx.admin_notifications : [];
    const unread = rows.filter((n: any)=>!n.read_at);
    out.push("إشعارات الإدارة: " + rows.length + " ضمن أحدث 30 إشعاراً؛ غير المقروء " + unread.length + ". " + (unread.length ? unread.slice(0,8).map((n: any)=>n.title||n.kind||"إشعار").join("، ") : "لا توجد إشعارات غير مقروءة ضمن العينة.") + ".");
  }
  if (flags.monitoring || out.length===0) {
    const monitoring = ctx.monitoring || {};
    const alerts = Array.isArray(monitoring.active_alerts) ? monitoring.active_alerts : [];
    out.push("المراقبة: التنبيهات النشطة " + (monitoring.active_alert_count ?? alerts.length) + "، الطلبات المفتوحة ضمن أحدث 100 " + (health.open_orders_in_latest_100 ?? "غير متاح") + "، طلبات الإيداع المعلقة " + (health.pending_deposits_total ?? "غير متاح") + "، تذاكر الدعم المفتوحة " + (health.open_support_tickets_total ?? "غير متاح") + ".");
    if (alerts.length) out.push("أبرز التنبيهات: " + alerts.slice(0,6).map((a: any)=>"["+String(a.severity||"تنبيه")+"] "+String(a.message||a.issue_code||"")).join("؛ "));
    if (monitoring.last_run) out.push("آخر تشغيل للمراقبة: " + String(monitoring.last_run.status||"غير محدد") + ".");
  }
  out.push("تاريخ تحديث البيانات: " + String(ctx.data_updated_at || "غير متاح") + ". هذه قراءة وتحليل فقط؛ لم أنفذ أي تغيير تشغيلي أو مالي.");
  return out.join("\n");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    const origin = req.headers.get("Origin");
    if (origin && origin !== allowedOrigin) return new Response("Forbidden", { status: 403 });
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const origin = req.headers.get("Origin");
  if (origin && origin !== allowedOrigin) return json({ error: "Origin not allowed" }, 403);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? readKeyObject("SUPABASE_PUBLISHABLE_KEYS");
    const legacyServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const secretKey = readKeyObject("SUPABASE_SECRET_KEYS");
    if (!url || !anonKey || !legacyServiceKey) {
      console.error("baran-admin-assistant: Supabase server configuration missing");
      return json({ error: "Server configuration is incomplete" }, 500);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return json({ error: "Authentication required" }, 401);

    const userClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) return json({ error: "Invalid session" }, 401);

    const admin = createClient(url, secretKey ?? legacyServiceKey, {
      global: { headers: { Authorization: `Bearer ${legacyServiceKey}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: isAdmin, error: adminError } = await admin.rpc("admin_is_user", { p_user_id: user.id });
    if (adminError) {
      console.error("baran-admin-assistant: administrator check failed", adminError.message);
      return json({ error: "تعذر التحقق من صلاحية المدير." }, 500);
    }
    if (isAdmin !== true) return json({ error: "Administrator access required" }, 403);

    let body: { messages?: Array<{ role?: string; content?: string }> };
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
    if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 12) {
      return json({ error: "Invalid conversation" }, 400);
    }
    const messages = body.messages
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-2)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content!.trim().slice(0, 350) }))
      .filter((m) => m.content.length > 0);
    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return json({ error: "A user message is required" }, 400);
    }

    const latestUserMessage = messages[messages.length - 1].content;
    const rememberMatch = latestUserMessage.match(/^(?:تذكر|احفظ بذاكرتك|سجل بذاكرتك|ضيف للذاكرة)\s*[:：-]?\s*(.{5,1200})$/i);
    if (rememberMatch) {
      const memoryText = rememberMatch[1].trim();
      const secretLike = /(?:api[_ -]?key|secret|service[_ -]?role|access[_ -]?token|refresh[_ -]?token|password|كلمة\s*المرور|رمز\s*التحقق|كود\s*التحقق|مفتاح\s*سري|مفتاح\s*api|بيانات\s*بطاقة|رقم\s*بطاقة)/i;
      if (secretLike.test(memoryText)) return json({ error: "ما بقدر أحفظ كلمات مرور أو رموز تحقق أو مفاتيح وأسرار. احفظ فقط معلومات تشغيلية غير حساسة." }, 400);
      const { data: existingMemory, error: lookupError } = await admin
        .from("baran_admin_memory")
        .select("id,category,content")
        .eq("is_active", true)
        .eq("content", memoryText)
        .limit(1)
        .maybeSingle();
      if (lookupError) {
        console.error("baran-admin-assistant: memory lookup failed", lookupError.message);
        return json({ error: "تعذر الوصول إلى ذاكرة Baran Game." }, 502);
      }
      if (existingMemory) return json({ reply: "هاي المعلومة محفوظة بذاكرتي من قبل، وما كررتها.", memory_saved: false, memory_id: existingMemory.id });
      const { data: savedMemory, error: saveError } = await admin
        .from("baran_admin_memory")
        .insert({ category: "operational", content: memoryText, source: "admin_chat", created_by: user.id })
        .select("id,category,content,created_at")
        .single();
      if (saveError || !savedMemory) {
        console.error("baran-admin-assistant: memory save failed", saveError?.message);
        return json({ error: "تعذر حفظ المعلومة في ذاكرة المشروع." }, 502);
      }
      const { error: memoryAuditError } = await admin.from("admin_audit_log").insert({
        admin_id: user.id,
        action: "admin_memory_saved",
        entity_type: "assistant_memory",
        entity_id: savedMemory.id,
        details: { category: savedMemory.category, source: "admin_chat", content_length: memoryText.length }
      });
      if (memoryAuditError) {
        await admin.from("baran_admin_memory").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", savedMemory.id);
        console.error("baran-admin-assistant: memory audit failed", memoryAuditError.message);
        return json({ error: "لم أحفظ المعلومة لأن سجل التدقيق لم ينجح." }, 502);
      }
      return json({ reply: "تم حفظ المعلومة بذاكرة Baran Game وربطها بسجل التدقيق. رح أرجعلها بالمحادثات القادمة.", memory_saved: true, memory_id: savedMemory.id });
    }

    const memoryRecallQuery = latestUserMessage.trim().replace(/[؟?!.,،؛:]+$/u, "").replace(/\s+/g, " ");
    if (/^(?:شو\s+بتتذكر(?:\s+عن\s+المشروع)?|ماذا\s+تتذكر(?:\s+عن\s+المشروع)?|اعرض\s+(?:ذاكرتك|الذاكرة)|اعرض\s+ما\s+تتذكر|شو\s+حافظ\s+عن\s+المشروع|ماذا\s+تعرف\s+عن\s+المشروع|شو\s+متذكر)$/iu.test(memoryRecallQuery)) {
      const { data: remembered, error: memoryError } = await admin
        .from("baran_admin_memory")
        .select("category,content,updated_at")
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(20);
      if (memoryError) {
        console.error("baran-admin-assistant: memory recall failed", memoryError.message);
        return json({ error: "تعذر قراءة ذاكرة Baran Game." }, 502);
      }
      const memoryReply = (remembered ?? []).map((m: any, i: number) => (i + 1) + ". [" + m.category + "] " + m.content).join("\n") || "ذاكرتي لسا فارغة.";
      return json({ reply: memoryReply, memory_count: remembered?.length ?? 0, memory_recall: true });
    }

    // Deterministic local reports: read-only, administrator-authenticated, internal rules only.
    const localQuery = latestUserMessage.trim().toLowerCase();
    const localIntent =
      /(?:(?:التقرير التشغيلي|تقرير تشغيلي|قائد التشغيل|اجمع التقارير|خطة التشغيل|خطة اليوم|شو أولوياتنا|ما أولوياتنا|شو لازم نعمل|تقييم تشغيلي|تقرير الإدارة اليومي|شو وضع باران|وين وصلنا|شو ناقصنا|اعطيني نظرة شاملة|ملخص شامل|شو المشاكل الفعلية|حلل الأولويات|حلل الاولويات|شو المؤجل))/i.test(localQuery) ? "operations" :
      /(?:تقرير عام|ملخص المتجر|حالة المتجر|صحة المتجر|افحص المتجر|فحص المتجر|اعمل فحص للمتجر|فحص شامل|تقريراً تنفيذياً عن وضع baran game|حلل المراقبة والأعطال|شو حالة المتجر|كيف وضع المتجر|فحص عام)/i.test(localQuery) ? "health" :
      /(?:فحص المنتجات|راجع المنتجات|قائمة المنتجات|اعرض المنتجات|ملخص المنتجات|تقرير المنتجات|تدقيقاً كاملاً لكتالوج المنتجات|شو وضع المنتجات|المنتجات كيف)/i.test(localQuery) ? "products" :
      /(?:فحص الموردين|راجع الموردين|قائمة الموردين|اعرض الموردين|ملخص الموردين|تقرير الموردين|راجع جاهزية الموردين|شو وضع الموردين|الموردين كيف)/i.test(localQuery) ? "suppliers" :
      /(?:ملخص الطلبات|تقرير الطلبات|فحص الطلبات|راجع الطلبات|حالة الطلبات|حلل الطلبات المعلقة|شو وضع الطلبات|الطلبات كيف)/i.test(localQuery) ? "orders" :
      /(?:ملخص التذاكر|تقرير التذاكر|فحص التذاكر|راجع الدعم|ملخص الدعم|حالة الدعم|راجع تذاكر الدعم المفتوحة|شو وضع الدعم|شو وضع التذاكر|التذاكر كيف)/i.test(localQuery) ? "tickets" :
      /(?:ملخص الأمان|تقرير الأمان|فحص الأمان|راجع سجل التدقيق|ملخص سجل التدقيق|شو وضع الأمان|فحص الحماية)/i.test(localQuery) ? "security" : null;

    if (localIntent) {
      const checkedAt = new Date().toISOString();
      const counts = (rows: any[], key: string) => rows.reduce((out: Record<string, number>, row: any) => {
        const value = String(row?.[key] ?? "غير محدد");
        out[value] = (out[value] || 0) + 1;
        return out;
      }, {});
      if (localIntent === "operations") {
        const [
          productResult, supplierResult, linkResult, orderResult, manualOrderResult,
          ticketResult, depositResult, auditResult
        ] = await Promise.all([
          admin.from("products").select("id,name,description,is_active").limit(300),
          admin.from("suppliers").select("id,name,is_active,notes").order("name").limit(200),
          admin.from("supplier_products").select("id,supplier_id,product_id").limit(1000),
          admin.from("orders").select("id,status,created_at").order("created_at", { ascending: false }).limit(100),
          admin.from("leo_manual_orders").select("id,product_code,product_name_snapshot,status,payment_status,customer_price_usd,customer_price_syp,supplier_cost_usd,supplier_cost_usd_snapshot,created_at,completed_at").order("created_at", { ascending: false }).limit(100),
          admin.from("customer_feedback").select("id,ticket_code,subject,status,created_at")
            .eq("feedback_type", "support").order("created_at", { ascending: false }).limit(100),
          admin.from("deposit_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
          admin.from("admin_audit_log").select("id,action,created_at").order("created_at", { ascending: false }).limit(20),
        ]);
        const readErrors = [
          productResult.error && "المنتجات", supplierResult.error && "الموردون",
          linkResult.error && "روابط الموردين", orderResult.error && "الطلبات العامة",
          manualOrderResult.error && "طلبات BARO اليدوية", ticketResult.error && "الدعم", depositResult.error && "طلبات الإيداع",
          auditResult.error && "سجل التدقيق",
        ].filter(Boolean);
        if (readErrors.length) return json({
          error: "تعذر إعداد التقرير التشغيلي بسبب تعذر قراءة: " + readErrors.join("، ") + ". لم يتم إجراء أي تعديل."
        }, 502);

        const productRows = productResult.data ?? [];
        const supplierRows = supplierResult.data ?? [];
        const linkRows = linkResult.data ?? [];
        const orderRows = orderResult.data ?? [];
        const manualOrderRows = manualOrderResult.data ?? [];
        const combinedOrderRows = [...orderRows, ...manualOrderRows];
        const ticketRows = ticketResult.data ?? [];
        const auditRows = auditResult.data ?? [];
        const activeProducts = productRows.filter((x: any) => x.is_active).length;
        const inactiveProducts = productRows.length - activeProducts;
        const missingDescriptions = productRows.filter((x: any) => !String(x.description || "").trim()).length;
        const activeSuppliers = supplierRows.filter((x: any) => x.is_active).length;
        const openOrders = combinedOrderRows.filter((x: any) => ["pending", "processing", "awaiting_supplier"].includes(x.status)).length;
        const failedOrders = combinedOrderRows.filter((x: any) => ["failed", "rejected"].includes(x.status)).length;
        const openTickets = ticketRows.filter((x: any) => ["pending", "in_progress"].includes(x.status)).length;
        const orderStatusCounts = combinedOrderRows.reduce((out: Record<string, number>, row: any) => { const key = String(row.status ?? "غير محدد"); out[key] = (out[key] || 0) + 1; return out; }, {});
        const manualCompleted = manualOrderRows.filter((x: any) => x.status === "completed" && x.payment_status === "verified");
        const manualSalesSyp = manualCompleted.reduce((sum: number, x: any) => sum + Number(x.customer_price_syp || 0), 0);
        const manualSalesUsd = manualCompleted.reduce((sum: number, x: any) => sum + Number(x.customer_price_usd || 0), 0);
        const ticketStatusCounts = ticketRows.reduce((out: Record<string, number>, row: any) => { const key = String(row.status ?? "غير محدد"); out[key] = (out[key] || 0) + 1; return out; }, {});
        const linkedProductIds = new Set(linkRows.map((x: any) => x.product_id));
        const productsWithoutSupplierLink = productRows.filter((x: any) => !linkedProductIds.has(x.id)).length;
        const priorities: Array<{ level: string; area: string; reason: string; next_step: string }> = [];
        const deferredItems = [
          { area: "الموردون وAPI", reason: "مؤجل بقرار إداري؛ لا يُصنّف كعطل حالياً." },
          { area: "الشحن التلقائي", reason: "مؤجل حتى اختيار المورد وإثبات نجاح الربط والاختبار." },
          { area: "الدفع الإلكتروني/شام كاش", reason: "تفعيل الدفع مؤجل؛ لا يُعتبر غياب الربط خطأً تشغيلياً حالياً." }
        ];
        if (supplierRows.length === 0 || activeSuppliers === 0 || linkRows.length === 0) {
          // Deferred by the owner's current rollout decision: informational only, not an incident.
        }
        if (openOrders > 0 || failedOrders > 0) {
          priorities.push({
            level: "عالية",
            area: "الطلبات",
            reason: "هناك طلبات مفتوحة أو فاشلة ضمن أحدث 100 طلب.",
            next_step: "مراجعة الحالات وأسباب الفشل يدوياً قبل أي تغيير أو إعادة تنفيذ."
          });
        }
        if ((depositResult.count ?? 0) > 0) {
          priorities.push({
            level: "عالية",
            area: "الإيداعات",
            reason: "يوجد " + depositResult.count + " طلب إيداع معلق.",
            next_step: "مطابقة كل طلب يدوياً مع إثبات التحويل وسجل شام كاش؛ لا اعتماد تلقائي ولا تعديل رصيد."
          });
        }
        if (openTickets > 0) {
          priorities.push({
            level: "متوسطة",
            area: "الدعم",
            reason: "يوجد " + openTickets + " تذكرة مفتوحة ضمن أحدث 100 تذكرة.",
            next_step: "مراجعة التذاكر المفتوحة وتصنيف الحالات التي تحتاج تدخّل المدير."
          });
        }
        if (inactiveProducts > 0 || missingDescriptions > 0) {
          priorities.push({
            level: "متوسطة",
            area: "المنتجات",
            reason: "هناك منتجات مخفية أو أوصاف ناقصة.",
            next_step: "مراجعة بيانات المنتجات واقتراح التعديلات للمعاينة فقط."
          });
        }
        if (combinedOrderRows.length === 0) {
          // No orders during a pre-launch test is neutral; it is not evidence of a fault.
        }
        if (priorities.length === 0) {
          priorities.push({
            level: "منخفضة",
            area: "المتابعة الدورية",
            reason: "لم تظهر مؤشرات عاجلة ضمن البيانات التي تمت قراءتها.",
            next_step: "الاستمرار بالفحص الدوري ومراجعة التغيرات عند وصول طلبات أو تذاكر جديدة."
          });
        }

        const summary = {
          deferred_items: deferredItems,
          actual_issues_count: priorities.filter((p) => p.area !== "المتابعة الدورية").length,
          readiness_note: "الموردون وAPI والشحن التلقائي والدفع مؤجلة بقرار إداري، وليست أعطالاً.",
          products: { total: productRows.length, active: activeProducts, inactive: inactiveProducts, missing_descriptions: missingDescriptions, without_supplier_link: productsWithoutSupplierLink },
          suppliers: { total: supplierRows.length, active: activeSuppliers, inactive: supplierRows.length - activeSuppliers, product_links: linkRows.length },
          orders_latest_100: { loaded: combinedOrderRows.length, general_orders: orderRows.length, baro_manual_orders: manualOrderRows.length, open: openOrders, failed: failedOrders, by_status: orderStatusCounts },
          baro_manual_sales: { completed_verified_orders: manualCompleted.length, sales_syp: manualSalesSyp, sales_usd: manualSalesUsd },
          support_latest_100: { loaded: ticketRows.length, open: openTickets, by_status: ticketStatusCounts },
          pending_deposit_requests: depositResult.count ?? 0,
          audit_events_latest_20: auditRows.length,
        };
        const reply = [
          "التقرير التشغيلي لـ Baran Game (قراءة فقط)",
          "المنتجات: " + productRows.length + "، النشط " + activeProducts + "، المخفي " + inactiveProducts + "، الأوصاف الناقصة " + missingDescriptions + "، غير المرتبط بمورد " + productsWithoutSupplierLink + ".",
          "الموردون: " + supplierRows.length + "، النشط " + activeSuppliers + "، روابط المنتجات " + linkRows.length + ".",
          "الطلبات ضمن العينات (حتى 100 من كل مصدر): " + combinedOrderRows.length + "؛ العامة " + orderRows.length + "، وBARO اليدوية " + manualOrderRows.length + "، المفتوح " + openOrders + "، الفاشل " + failedOrders + "، توزيع الحالات: " + JSON.stringify(orderStatusCounts) + ".",
          "مبيعات BARO المكتملة والمدفوعة الموثقة: " + manualCompleted.length + " طلباً، " + fmtAdminAmount(manualSalesSyp) + " SYP و" + fmtAdminAmount(manualSalesUsd) + " USD. لا تمثل هذه الأرقام صافي الربح.",
          "الدعم ضمن أحدث 100: " + ticketRows.length + "، المفتوح " + openTickets + "، توزيع الحالات: " + JSON.stringify(ticketStatusCounts) + ".",
          "حالة المورد والشحن: مؤجلة بقرار إداري حالياً؛ عدم وجود مورد نشط أو روابط لا يُسجل كعطل. عند بدء هذه المرحلة يلزم التحقق من API واختبار فعلي موثق.",
          "طلبات الإيداع المعلقة: " + (depositResult.count ?? 0) + " (عدد فقط دون مبالغ).",
          "أحداث التدقيق المقروءة: " + auditRows.length + " من أحدث 20.",
          "المهام المؤجلة (ليست أعطالاً): الموردون وAPI، الشحن التلقائي، وتفعيل الدفع.",
          "المشاكل الفعلية ذات الأولوية:",
          ...priorities.map((p: any, i: number) => (i + 1) + ". [" + p.level + "] " + p.area + ": " + p.reason + " الخطوة التالية: " + p.next_step),
          "كل النتائج مبنية على لقطة البيانات الحالية؛ لم يتم تعديل منتجات أو موردين أو طلبات أو تذاكر أو أرصدة أو إيداعات."
        ].join("\n");
        return json({
          mode: "offline_read_only",
          report: "operations_briefing",
          checked_at: checkedAt,
          summary,
          priorities,
          reply,
          note: "تقرير قراءة فقط. يفرّق بين قرارات التأجيل الإدارية والمشاكل المثبتة؛ غياب الطلبات في مرحلة الاختبار لا يُعد عطلاً. الطلبات والتذاكر محدودة بأحدث 100 سجل وسجل التدقيق بأحدث 20."
        });
      }
      if (localIntent === "products") {
        const { data, error } = await admin.from("products")
          .select("product_code,name,description,category,is_active")
          .order("sort_order", { ascending: true }).limit(200);
        if (error) return json({ error: "تعذر قراءة المنتجات من قاعدة البيانات؛ لم يتم إجراء أي تعديل." }, 502);
        const rows = data ?? [];
        const seen = new Map<string, number>();
        for (const row of rows) {
          const key = String(row.name || "").trim().toLowerCase();
          if (key) seen.set(key, (seen.get(key) || 0) + 1);
        }
        const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([name, count]) => ({ name, count }));
        const missingDescription = rows.filter((x: any) => !String(x.description || "").trim()).map((x: any) => x.name);
        return json({ mode: "offline_read_only", report: "products", checked_at: checkedAt,
          summary: { total_loaded: rows.length, active: rows.filter((x: any) => x.is_active).length,
            inactive: rows.filter((x: any) => !x.is_active).length, duplicate_names: duplicates,
            missing_descriptions: missingDescription },
          reply: "فحص المنتجات (قراءة فقط): " + rows.length + " منتجاً محمّلاً؛ النشط " + rows.filter((x: any) => x.is_active).length + "، المخفي " + rows.filter((x: any) => !x.is_active).length + ". أسماء مكررة: " + (duplicates.map((x: any) => x.name + " (" + x.count + ")").join("، ") || "لا يوجد ضمن البيانات المحمّلة") + ". أوصاف ناقصة: " + (missingDescription.join("، ") || "لا يوجد") + ". لم يتم تعديل أي منتج أو سعر.",
          products: rows.slice(0, 40).map((x: any) => ({ code: x.product_code, name: x.name, category: x.category, active: x.is_active })),
          note: "قراءة فقط؛ لم يتم تغيير أي منتج أو سعر." });
      }
      if (localIntent === "suppliers") {
        const [{ data: supplierRows, error: supplierError }, { data: links, error: linkError }] = await Promise.all([
          admin.from("suppliers").select("id,name,is_active,notes").order("name").limit(200),
          admin.from("supplier_products").select("id,supplier_id,product_id").limit(500),
        ]);
        if (supplierError || linkError) return json({ error: "تعذر قراءة الموردين أو روابط المنتجات؛ لم يتم إجراء أي تعديل." }, 502);
        const rows = supplierRows ?? [];
        const linkRows = links ?? [];
        const linkedSupplierIds = new Set(linkRows.map((x: any) => x.supplier_id));
        return json({ mode: "offline_read_only", report: "suppliers", checked_at: checkedAt,
          summary: { total_loaded: rows.length, active: rows.filter((x: any) => x.is_active).length,
            inactive: rows.filter((x: any) => !x.is_active).length, product_links: linkRows.length,
            suppliers_without_product_links: rows.filter((x: any) => !linkedSupplierIds.has(x.id)).map((x: any) => x.name) },
          reply: "فحص الموردين (قراءة فقط): " + rows.length + " مورداً؛ النشط " + rows.filter((x: any) => x.is_active).length + "، غير النشط " + rows.filter((x: any) => !x.is_active).length + ". روابط المنتجات المسجلة: " + linkRows.length + ". موردون بلا ربط: " + (rows.filter((x: any) => !linkedSupplierIds.has(x.id)).map((x: any) => x.name).join("، ") || "لا يوجد") + ". وجود المورد أو الربط لا يعني أن API يعمل أو أن الشحن تلقائي.",
          suppliers: rows.map((x: any) => ({ name: x.name, active: x.is_active, has_product_links: linkedSupplierIds.has(x.id),
            note: String(x.notes || "").slice(0, 180) })),
          note: "وجود المورد أو رابط المنتج لا يثبت أن API يعمل أو أن الشحن التلقائي مفعّل. قراءة فقط." });
      }
      if (localIntent === "orders") {
        const [{ data: generalRows, error: generalError }, { data: manualRows, error: manualError }] = await Promise.all([
          admin.from("orders").select("id,product_code,quantity,status,created_at").order("created_at", { ascending: false }).limit(100),
          admin.from("leo_manual_orders").select("id,product_code,product_name_snapshot,quantity,status,payment_status,customer_price_usd,customer_price_syp,supplier_cost_usd,supplier_cost_usd_snapshot,created_at,completed_at").order("created_at", { ascending: false }).limit(100),
        ]);
        if (generalError || manualError) return json({ error: "تعذر قراءة أحد مصدري الطلبات؛ لم يتم إجراء أي تعديل." }, 502);
        const general = generalRows ?? [];
        const manual = manualRows ?? [];
        const combined = [...general.map((x: any) => ({ ...x, source: "orders" })), ...manual.map((x: any) => ({ ...x, source: "leo_manual_orders" }))].sort((a: any,b: any) => Date.parse(b.created_at)-Date.parse(a.created_at));
        const completedVerified = manual.filter((x: any) => x.status === "completed" && x.payment_status === "verified");
        const salesSyp = completedVerified.reduce((sum: number, x: any) => sum + Number(x.customer_price_syp || 0), 0);
        const salesUsd = completedVerified.reduce((sum: number, x: any) => sum + Number(x.customer_price_usd || 0), 0);
        return json({ mode: "offline_read_only", report: "orders", checked_at: checkedAt,
          summary: { total_loaded: combined.length, general_orders: general.length, baro_manual_orders: manual.length, statuses: counts(combined, "status"),
            open: combined.filter((x: any) => ["pending","processing","awaiting_supplier"].includes(x.status)).length,
            failed: combined.filter((x: any) => ["failed","rejected"].includes(x.status)).length,
            baro_completed_verified: completedVerified.length, baro_sales_syp: salesSyp, baro_sales_usd: salesUsd },
          orders: combined.slice(0,30).map((x: any) => ({ source: x.source, product: x.product_name_snapshot || x.product_code, status: x.status, payment_status: x.payment_status ?? null, created_at: x.created_at })),
          reply: "ملخص الطلبات من مصدرين (حتى أحدث 100 من كل مصدر): " + combined.length + " إجمالاً؛ الطلبات العامة " + general.length + "، طلبات BARO اليدوية " + manual.length + ". الحالات: " + JSON.stringify(counts(combined, "status")) + ". طلبات BARO المكتملة والمدفوعة الموثقة: " + completedVerified.length + "؛ مبيعاتها " + fmtAdminAmount(salesSyp) + " SYP و" + fmtAdminAmount(salesUsd) + " USD. لم يتم تغيير أي حالة أو تنفيذ شحن.",
          note: "طلبات orders وleo_manual_orders تعرض منفصلة المصدر؛ لا يتم جمع تكلفة USD مع مبيعات SYP ولا احتساب صافي ربح." });
      }
      if (localIntent === "tickets") {
        const { data, error } = await admin.from("customer_feedback")
          .select("ticket_code,subject,status,created_at")
          .eq("feedback_type", "support").order("created_at", { ascending: false }).limit(100);
        if (error) return json({ error: "تعذر قراءة تذاكر الدعم؛ لم يتم إجراء أي تعديل." }, 502);
        const rows = data ?? [];
        return json({ mode: "offline_read_only", report: "tickets", checked_at: checkedAt,
          summary: { latest_loaded: rows.length, statuses: counts(rows, "status"),
            open: rows.filter((x: any) => ["pending","in_progress"].includes(x.status)).length },
          reply: "ملخص الدعم (قراءة فقط): " + rows.length + " تذكرة ضمن أحدث 100؛ المفتوح " + rows.filter((x: any) => ["pending","in_progress"].includes(x.status)).length + ". الحالات: " + JSON.stringify(counts(rows, "status")) + ". لم يتم إرسال أي رد أو تغيير حالة.",
          tickets: rows.slice(0, 20).map((x: any) => ({ code: x.ticket_code, subject: x.subject, status: x.status, created_at: x.created_at })),
          note: "قراءة فقط؛ لم يتم إرسال ردود أو تغيير حالات التذاكر." });
      }
      if (localIntent === "security") {
        const { data, error } = await admin.from("admin_audit_log")
          .select("action,entity_type,created_at")
          .order("created_at", { ascending: false }).limit(100);
        if (error) return json({ error: "تعذر قراءة سجل التدقيق؛ لم يتم إجراء أي تعديل." }, 502);
        const rows = data ?? [];
        return json({ mode: "offline_read_only", report: "security_audit", checked_at: checkedAt,
          summary: { latest_loaded: rows.length, actions: counts(rows, "action"), entity_types: counts(rows, "entity_type") },
          reply: "ملخص سجل الأمان: قرأت أحدث " + rows.length + " حدث تدقيق. أكثر الإجراءات: " + JSON.stringify(counts(rows, "action")) + ". هذا فحص للسجل فقط، دون عرض تفاصيل حساسة أو تعديل الصلاحيات.",
          latest_events: rows.slice(0, 15).map((x: any) => ({ action: x.action, entity_type: x.entity_type, created_at: x.created_at })),
          note: "لا يتم عرض تفاصيل حساسة من سجل التدقيق. هذا فحص لآخر 100 حدث فقط." });
      }
      const [products, suppliers, orders, manualOrders, tickets, deposits] = await Promise.all([
        admin.from("products").select("id,is_active", { count: "exact" }).limit(1),
        admin.from("suppliers").select("id,is_active", { count: "exact" }).limit(1),
        admin.from("orders").select("id,status", { count: "exact" }).order("created_at", { ascending: false }).limit(100),
        admin.from("leo_manual_orders").select("id,status", { count: "exact" }).order("created_at", { ascending: false }).limit(100),
        admin.from("customer_feedback").select("id,status", { count: "exact" }).eq("feedback_type", "support").in("status", ["pending","in_progress"]),
        admin.from("deposit_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
      ]);
      const errors = [products.error && "products", suppliers.error && "suppliers", orders.error && "orders",
        manualOrders.error && "leo_manual_orders", tickets.error && "support_tickets", deposits.error && "pending_deposits"].filter(Boolean);
      if (errors.length) return json({ error: "تعذر إكمال الفحص العام لبعض الأقسام: " + errors.join("، ") + ". لم يتم إجراء أي تعديل." }, 502);
      return json({ mode: "offline_read_only", report: "store_health", checked_at: checkedAt,
        summary: { products_total: products.count ?? null, suppliers_total: suppliers.count ?? null,
          orders_total: (orders.count ?? 0) + (manualOrders.count ?? 0), general_orders_total: orders.count ?? null,
          baro_manual_orders_total: manualOrders.count ?? null, open_support_tickets: tickets.count ?? null,
          pending_deposits: deposits.count ?? null,
          latest_order_statuses: { general: counts(orders.data ?? [], "status"), baro_manual: counts(manualOrders.data ?? [], "status") } },
        reply: "تقرير Baran Game المحلي (قراءة فقط): المنتجات " + (products.count ?? "غير متاح") + "، الموردون " + (suppliers.count ?? "غير متاح") + "، الطلبات " + ((orders.count ?? 0) + (manualOrders.count ?? 0)) + " (العامة " + (orders.count ?? 0) + "، BARO اليدوية " + (manualOrders.count ?? 0) + ")، تذاكر الدعم المفتوحة " + (tickets.count ?? "غير متاح") + "، طلبات الإيداع المعلقة " + (deposits.count ?? "غير متاح") + ". حالات الطلبات العامة: " + JSON.stringify(counts(orders.data ?? [], "status")) + "؛ حالات BARO اليدوية: " + JSON.stringify(counts(manualOrders.data ?? [], "status")) + ". لا يتضمن التقرير مبالغ أو أرصدة، ولم يتم تغيير أي بيانات.",
        note: "تقرير تشغيلي محدود من بيانات قاعدة البيانات الحالية. لا يتضمن أرباحاً أو أرصدة أو تفاصيل إيداعات، ولا يغيّر أي بيانات." });
    }


    const { data: rememberedFacts, error: rememberedFactsError } = await admin
      .from("baran_admin_memory")
      .select("category,content,updated_at")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(8);
    if (rememberedFactsError) {
      console.error("baran-admin-assistant: memory read failed", rememberedFactsError.message);
      return json({ error: "تعذر تحميل ذاكرة Baran Game؛ لم يتم استخدام أي خدمة ذكاء اصطناعي خارجية." }, 502);
    }
    const memoryContext = (rememberedFacts ?? []).map((m: any) => ({
      category: m.category,
      content: String(m.content).slice(0, 300),
      updated_at: m.updated_at
    }));

    const now = new Date();
    const damascus = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Damascus", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(now);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Damascus", year: "numeric", month: "numeric",
    }).formatToParts(now);
    const month = Number(parts.find((p) => p.type === "month")?.value);
    const year = Number(parts.find((p) => p.type === "year")?.value);

    const [
      financeResult, productReportResult, orderResult, manualOrderResult, depositResult, walletTransactionResult, feedbackResult,
      supplierResult, fulfillmentResult, productResult, auditResult, notificationResult,
      userCountResult, orderCountResult, manualOrderCountResult, productCountResult, supplierCountResult,
      settingsResult, openFeedbackCountResult, pendingDepositCountResult, monitorResult,
    ] = await Promise.all([
      admin.rpc("admin_finance_data", { p_admin_id: user.id }),
      admin.rpc("admin_finance_product_report", { p_admin_id: user.id, p_month: month, p_year: year }),
      admin.from("orders").select("id,product_code,quantity,status,created_at,total_price_usd,total_price_syp")
        .order("created_at", { ascending: false }).limit(100),
      admin.from("leo_manual_orders").select("id,product_code,product_name_snapshot,quantity,status,payment_status,created_at,completed_at,customer_price_usd,customer_price_syp,supplier_cost_usd,supplier_cost_usd_snapshot,coupon_discount_usd,wallet_charge_mode")
        .order("created_at", { ascending: false }).limit(100),
      admin.from("deposit_requests").select("id,amount,currency,status,created_at,transfer_reference")
        .order("created_at", { ascending: false }).limit(50),
      admin.from("wallet_transactions").select("id,amount,currency,transaction_type,description,created_at,order_id,deposit_request_id").order("created_at", { ascending: false }).limit(100),
      admin.from("customer_feedback").select("id,ticket_code,feedback_type,subject,message,status,admin_reply,created_at,updated_at,order_id")
        .order("created_at", { ascending: false }).limit(50),
      admin.from("suppliers").select("id,name,is_active,created_at").order("name").limit(100),
      admin.from("order_fulfillment").select("order_id,supplier_status,supplier_total_cost,supplier_cost_currency,supplier_cost_exchange_rate,updated_at")
        .order("updated_at", { ascending: false }).limit(150),
      admin.from("products").select("product_code,name,category,price_usd,price_syp,is_active")
        .order("sort_order", { ascending: true }).limit(100),
      admin.from("admin_audit_log").select("action,entity_type,entity_id,details,created_at")
        .order("created_at", { ascending: false }).limit(40),
      admin.from("baran_notifications").select("kind,title,body,read_at,created_at")
        .eq("recipient_id", user.id).eq("audience", "admin")
        .order("created_at", { ascending: false }).limit(30),
      admin.from("profiles").select("id", { count: "exact", head: true }),
      admin.from("orders").select("id", { count: "exact", head: true }),
      admin.from("leo_manual_orders").select("id", { count: "exact", head: true }),
      admin.from("products").select("id", { count: "exact", head: true }),
      admin.from("suppliers").select("id", { count: "exact", head: true }),
      admin.from("store_settings").select("exchange_rate,updated_at").eq("id", "main").maybeSingle(),
      admin.from("customer_feedback").select("id", { count: "exact", head: true }).in("status", ["pending", "in_progress"]),
      admin.from("deposit_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
      admin.rpc("admin_monitor_snapshot", { p_admin_id: user.id }),
    ]);

    const failures = [
      financeResult.error && "finance", productReportResult.error && "product_report",
      orderResult.error && "orders", manualOrderResult.error && "leo_manual_orders", depositResult.error && "deposits", walletTransactionResult.error && "wallet_transactions", feedbackResult.error && "support_tickets",
      supplierResult.error && "suppliers", fulfillmentResult.error && "fulfillment",
      productResult.error && "products", auditResult.error && "audit_log",
      notificationResult.error && "notifications", settingsResult.error && "store_settings",
      monitorResult.error && "monitor_snapshot",
    ].filter(Boolean);
    if (failures.includes("finance")) {
      console.error("baran-admin-assistant: finance RPC failed", financeResult.error?.message);
      return json({ error: "تعذر تحميل البيانات المالية من السجل الرسمي." }, 502);
    }

    const orders = orderResult.data ?? [];
    const manualOrders = manualOrderResult.data ?? [];
    const fulfillment = fulfillmentResult.data ?? [];
    const fulfillmentByOrder = new Map(fulfillment.map((x) => [x.order_id, x]));
    const enrichedOrders = orders.map((o) => ({
      id: o.id, source: "orders", product_code: o.product_code, quantity: o.quantity, status: o.status,
      created_at: o.created_at, total_price_usd: o.total_price_usd, total_price_syp: o.total_price_syp,
      fulfillment: fulfillmentByOrder.get(o.id) ?? null,
    }));
    const enrichedManualOrders = manualOrders.map((o: any) => ({
      id: o.id, source: "leo_manual_orders", product_code: o.product_code, product_name: o.product_name_snapshot,
      quantity: o.quantity, status: o.status, payment_status: o.payment_status, created_at: o.created_at, completed_at: o.completed_at,
      total_price_usd: o.customer_price_usd, total_price_syp: o.customer_price_syp,
      supplier_cost_usd: o.supplier_cost_usd_snapshot ?? o.supplier_cost_usd, coupon_discount_usd: o.coupon_discount_usd,
      wallet_charge_mode: o.wallet_charge_mode,
    }));
    const allRecentOrders = [...enrichedOrders, ...enrichedManualOrders].sort((a: any,b: any) => Date.parse(b.created_at)-Date.parse(a.created_at));
    const allOpenOrders = [...orders, ...manualOrders].filter((o: any) => ["pending", "processing", "awaiting_supplier"].includes(o.status));
    const openOrders = orders.filter((o) => ["pending", "processing", "awaiting_supplier"].includes(o.status));
    const ordersMissingCost = openOrders.filter((o) => {
      const f = fulfillmentByOrder.get(o.id);
      return !f || f.supplier_total_cost === null || !f.supplier_cost_currency || !f.supplier_cost_exchange_rate;
    });
    const deposits = depositResult.data ?? [];
    const tickets = feedbackResult.data ?? [];

    const sendIntent = /(?:أرسل|ارسل|ابعث|ابعت|إرسال|ارسال).{0,70}(?:الرد|رد|التذكرة|تذكرة|للزبون|للعميل)|(?:رد|الرد).{0,70}(?:وأرسل|وارسل|وابعث|وابعت)/i.test(latestUserMessage);
    let sendTicket: any = null;
    if (sendIntent) {
      const ticketMatch = latestUserMessage.match(/BG-\d{8}-[A-Z0-9]{8}/i);
      if (!ticketMatch) return json({ error: "حتى أرسل الرد بأمان، اكتب رقم التذكرة كاملاً، مثل BG-20261106-2633A8D2." }, 400);
      sendTicket = tickets.find((t: any) => String(t.ticket_code || "").toUpperCase() === ticketMatch[0].toUpperCase());
      if (!sendTicket) {
        const { data: exactTicket, error: exactTicketError } = await admin.from("customer_feedback")
          .select("id,ticket_code,feedback_type,subject,message,status,admin_reply")
          .eq("ticket_code", ticketMatch[0].toUpperCase())
          .eq("feedback_type", "support")
          .maybeSingle();
        if (exactTicketError) {
          console.error("baran-admin-assistant: exact ticket lookup failed", exactTicketError.message);
          return json({ error: "تعذر التحقق من رقم التذكرة؛ لم يُرسل أي رد." }, 502);
        }
        sendTicket = exactTicket;
      }
      if (!sendTicket || sendTicket.feedback_type !== "support") {
        return json({ error: "لم أجد تذكرة دعم بهذا الرقم؛ لم يُرسل أي رد." }, 404);
      }
    }
    const context = {
      data_updated_at: now.toISOString(),
      damascus_date: damascus,
      report_period: { month, year },
      finance: financeResult.data,
      product_profit_report: productReportResult.data ?? [],
      store_health: {
        users_total: userCountResult.count ?? null,
        orders_total: (orderCountResult.count ?? 0) + (manualOrderCountResult.count ?? 0),
        general_orders_total: orderCountResult.count ?? null,
        baro_manual_orders_total: manualOrderCountResult.count ?? null,
        products_total: productCountResult.count ?? null,
        suppliers_total: supplierCountResult.count ?? null,
        open_orders_in_latest_100: allOpenOrders.length,
        orders_missing_supplier_cost_in_latest_100: ordersMissingCost.length,
        pending_deposits_total: pendingDepositCountResult.count ?? null,
        open_support_tickets_total: openFeedbackCountResult.count ?? null,
        active_products_in_latest_100: (productResult.data ?? []).filter((p) => p.is_active).length,
        inactive_suppliers_in_latest_100: (supplierResult.data ?? []).filter((s) => !s.is_active).length,
        recent_data_limitations: failures,
      },
      recent_orders: allRecentOrders,
      recent_general_orders: enrichedOrders,
      recent_baro_manual_orders: enrichedManualOrders,
      recent_deposits: deposits,
      recent_wallet_transactions: walletTransactionResult.data ?? [],
      recent_support_tickets: tickets,
      selected_ticket_for_explicit_send: sendTicket ? { id: sendTicket.id, ticket_code: sendTicket.ticket_code, subject: sendTicket.subject, message: sendTicket.message, status: sendTicket.status, admin_reply: sendTicket.admin_reply } : null,
      suppliers: supplierResult.data ?? [],
      recent_fulfillment: fulfillment,
      products: productResult.data ?? [],
      recent_admin_audit: auditResult.data ?? [],
      admin_notifications: notificationResult.data ?? [],
      monitoring: monitorResult.data ?? null,
      exchange_rate: settingsResult.data ?? null,
    };

    // Send only the data relevant to the latest admin question to reduce TPM usage.
    const q = latestUserMessage.toLowerCase();
    const wantsFinance = /ربح|أرباح|مالي|مالية|مبيعات|تكلفة|تكاليف|مصروف|رأس المال|إيراد|profit|finance|sales|revenue/i.test(q);
    const wantsSupplier = /مورد|موردين|rtc|supplier|api المورد/i.test(q);
    const wantsProduct = /منتج|منتجات|product|سعر المنتج/i.test(q);
    const wantsOrder = /طلب|طلبات|شحن|تنفيذ|order|fulfillment/i.test(q);
    const wantsSupport = /تذكرة|تذاكر|دعم|شكوى|زبون|عميل|support|ticket|BG-\\d{8}-[A-Z0-9]{8}/i.test(q);
    const wantsDeposit = /إيداع|ايداع|محفظة|تحويل|شام كاش|deposit|wallet|خصم|استرداد|حركة مالية|سجل المحفظة|حركات المحفظة/i.test(q);
    const wantsAudit = /سجل التدقيق|التدقيق|audit/i.test(q);
    const wantsNotifications = /إشعار|إشعارات|تنبيه|notifications/i.test(q);
    const wantsMonitoring = /مراقبة|مراقب|صحة المتجر|حالة المتجر|فحص|أعطال|مشاكل|monitor|health|تقرير عام/i.test(q);
    const promptContext: Record<string, unknown> = {
      data_updated_at: context.data_updated_at,
      damascus_date: context.damascus_date,
      store_health: context.store_health,
      operational_memory: memoryContext,
    };
    if (wantsFinance) {
      promptContext.finance = context.finance;
      promptContext.recent_baro_manual_orders = (context.recent_baro_manual_orders as any[]).slice(0, 50);
      promptContext.baro_manual_sales_note = "أدرج فقط الطلبات المكتملة ذات payment_status=verified. اجمع مبيعات SYP وUSD كلٌ على حدة، واعرض تكلفة المورد USD منفصلة؛ لا تسمّها صافي ربح ولا تجمعها مع RPC المالي الرسمي دون إثبات عدم الازدواج.";
      promptContext.product_profit_report = context.product_profit_report;
      promptContext.exchange_rate = context.exchange_rate;
    }
    if (wantsSupplier) {
      promptContext.suppliers = context.suppliers;
      promptContext.recent_fulfillment = (context.recent_fulfillment as any[]).slice(0, 12);
    }
    if (wantsProduct) promptContext.products = (context.products as any[]).slice(0, 25);
    if (wantsOrder) {
      promptContext.recent_orders = (context.recent_orders as any[]).slice(0, 30);
      promptContext.recent_baro_manual_orders = (context.recent_baro_manual_orders as any[]).slice(0, 50);
      promptContext.order_sources_note = "مصدر orders للطلبات العامة ومصدر leo_manual_orders لطلبات BARO اليدوية. لا تعتبر غياب أحد المصدرين دليلاً على عدم وجود طلبات."; 
    }
    if (wantsSupport) {
      promptContext.recent_support_tickets = (context.recent_support_tickets as any[]).slice(0, 10);
      promptContext.selected_ticket_for_explicit_send = context.selected_ticket_for_explicit_send;
      promptContext.open_support_tickets_total = context.store_health.open_support_tickets_total;
    }
    if (wantsDeposit) {
      promptContext.recent_deposits = (context.recent_deposits as any[]).slice(0, 10);
      promptContext.pending_deposits_total = context.store_health.pending_deposits_total;
      promptContext.recent_wallet_transactions = (context.recent_wallet_transactions as any[]).slice(0, 40);
      promptContext.wallet_ledger_note = "العمليات المسجلة فقط؛ لا تفترض اكتمال كل مسارات الشراء والاسترداد.";
    }
    if (wantsAudit) promptContext.recent_admin_audit = (context.recent_admin_audit as any[]).slice(0, 12);
    if (wantsNotifications) promptContext.admin_notifications = (context.admin_notifications as any[]).slice(0, 10);
    if (wantsMonitoring || (!wantsFinance && !wantsSupplier && !wantsProduct && !wantsOrder && !wantsSupport && !wantsDeposit && !wantsAudit && !wantsNotifications)) {
      promptContext.monitoring = context.monitoring;
      promptContext.operational_counts = {
        open_orders_in_latest_100: context.store_health.open_orders_in_latest_100,
        general_orders_total: context.store_health.general_orders_total,
        baro_manual_orders_total: context.store_health.baro_manual_orders_total,
        orders_missing_supplier_cost_in_latest_100: context.store_health.orders_missing_supplier_cost_in_latest_100,
        pending_deposits_total: context.store_health.pending_deposits_total,
        open_support_tickets_total: context.store_health.open_support_tickets_total,
        active_products_in_latest_100: context.store_health.active_products_in_latest_100,
        inactive_suppliers_in_latest_100: context.store_health.inactive_suppliers_in_latest_100,
        recent_data_limitations: context.store_health.recent_data_limitations,
      };
    }


    const internalStarted = Date.now();
    let reply = "";
    if (sendTicket) {
      const cleanReply = ("أهلاً فيك، وصلتنا رسالتك بخصوص: " + String(sendTicket.subject || "طلب الدعم").slice(0,180) + ". فريق Baran Game رح يراجع التفاصيل ويتابع معك عبر هالتذكرة. إذا عندك معلومة إضافية غير حساسة بتساعدنا، أرسلها هون.").slice(0,2000);
      if (String(sendTicket.admin_reply || "").trim() === cleanReply) {
        return json({ reply: cleanReply, sent: false, ticket_code: sendTicket.ticket_code, message: "هذا الرد محفوظ مسبقاً ولم يُنشأ إشعار مكرر.", data_updated_at: now.toISOString() });
      }
      const { data: updatedTicket, error: sendError } = await admin.rpc("admin_update_customer_feedback", {
        p_admin_id: user.id,
        p_feedback_id: sendTicket.id,
        p_status: sendTicket.status,
        p_reply: cleanReply,
      });
      if (sendError) {
        console.error("baran-admin-assistant: internal ticket reply send failed", sendError.message, sendError.code);
        return json({ error: "تعذر حفظ الرد وإرساله. لم أؤكد الإرسال؛ راجع لوحة التذكرة." }, 502);
      }
      reply = cleanReply;
      const { error: usageError } = await admin.from("ai_usage_events").insert({
        function_name: "baran-admin-assistant", feature: "admin_assistant", actor_user_id: user.id,
        route: "internal", usage_status: "succeeded", model: "baran-internal-rules-v1",
        input_tokens: 0, output_tokens: 0, total_tokens: 0, status_code: 200,
        duration_ms: Math.max(0, Date.now()-internalStarted), completed_at: new Date().toISOString()
      });
      if (usageError) console.error("baran-admin-assistant: internal usage log failed", usageError.message);
      return json({ reply, sent: true, ticket_code: sendTicket.ticket_code,
        notification_created: updatedTicket?.notification_created === true, data_updated_at: now.toISOString() });
    }
    reply = internalAdminReply(latestUserMessage, context, {
      finance: wantsFinance, suppliers: wantsSupplier, products: wantsProduct, orders: wantsOrder,
      support: wantsSupport, deposit: wantsDeposit, audit: wantsAudit, notifications: wantsNotifications,
      monitoring: wantsMonitoring
    });
    const { error: usageError } = await admin.from("ai_usage_events").insert({
      function_name: "baran-admin-assistant", feature: "admin_assistant", actor_user_id: user.id,
      route: "internal", usage_status: "succeeded", model: "baran-internal-rules-v1",
      input_tokens: 0, output_tokens: 0, total_tokens: 0, status_code: 200,
      duration_ms: Math.max(0, Date.now()-internalStarted), completed_at: new Date().toISOString()
    });
    if (usageError) console.error("baran-admin-assistant: internal usage log failed", usageError.message);
    return json({ reply: reply.trim(), sent: false, data_updated_at: now.toISOString(), health: context.store_health, monitoring: context.monitoring });

  } catch (error) {
    console.error("baran-admin-assistant: unhandled error", error instanceof Error ? error.message : "unknown");
    return json({ error: "حدث خطأ داخلي أثناء تشغيل مساعد الإدارة." }, 500);
  }
});
