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

function normalizeArabic(value: string): string {
  return String(value || "").toLowerCase()
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
function hasAny(value: string, words: string[]): boolean {
  return words.some((word) => value.includes(normalizeArabic(word)));
}
function moneyText(value: unknown, currency: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(number) + " " + currency;
}

function redactSensitiveSupportText(value: string): string {
  let text = String(value || "").slice(0, 1800);
  text = text
    .replace(/(كلمة\s*المرور|كلمه\s*السر|كلمة\s*السر|password|passcode)\s*[:=]\s*[^\s،,;]+/giu, "$1 [محذوف]")
    .replace(/(رمز\s*التحقق|كود\s*التحقق|verification\s*code|otp)\s*(?:[:=]\s*|\s+)(?:هو\s*)?\d{4,10}/giu, "$1 [محذوف]")
    .replace(/(pin|رمز\s*المحفظة|رمز\s*المحفظه|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|bearer)\s*[:=]?\s*[^\s،,;]+/giu, "$1 [محذوف]")
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[رقم بطاقة محذوف]")
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[رمز وصول محذوف]");
  return text.slice(0, 1600);
}

function internalCustomerAnswer(question: string, context: any, conversation: Array<{role:string;content:string}> = []) {
  let q = normalizeArabic(question);
  const priorAssistant = [...conversation].reverse().find((m) => m.role === "assistant")?.content || "";
  const shortNumericFollowup = q.length <= 32 && /\d+/.test(q) &&
    hasAny(q, ["وال", "طيب", "طب", "وكمان", "كمان", "و"]);
  if (shortNumericFollowup && /free\s*fire|فري\s*فاير|فريفاير/i.test(priorAssistant)) {
    q = normalizeArabic(question + " فري فاير اسعار");
  }
  const wallet = context.wallet;
  const orders = Array.isArray(context.recent_orders) ? context.recent_orders : [];
  const deposits = Array.isArray(context.recent_deposits) ? context.recent_deposits : [];
  const products = Array.isArray(context.active_products) ? context.active_products : [];
  const manualProducts = Array.isArray(context.manual_products) ? context.manual_products : [];
  const helpIntent = hasAny(q, [
    "شو فيك تساعدني","شو بتقدر تساعدني","بشو بتساعدني","كيف بتساعدني",
    "شو بتعمل","شو خدماتك","شو بتعرف تعمل","كيف ممكن تساعدني",
    "شو ممكن تساعدني","شو دورك","شو مهامك","شو بتقدم","شو بتقدمو",
    "مساعد باران","المساعد الذكي","شو بتساعد","شو بتعمللي","كيف ممكن تفيدني","بأي شي بتساعدني","بشو ممكن تفيدني"
  ]);
  if (helpIntent) {
    return {
      reply: "أكيد! 🤖 أنا مساعد باران، وفيني ساعدك بهالأمور:\\n• المنتجات والألعاب والاشتراكات وأسعارها المسجلة بالمتجر.\\n• معرفة رصيد محفظتك كما هو مسجل بحسابك.\\n• متابعة آخر طلباتك وحالة كل طلب.\\n• الاستفسار عن طلبات الإيداع وحالتها المسجلة، بدون تأكيد الحوالة أو إضافة رصيد.\\n• إرشادك بمشاكل تسجيل الدخول واستخدام المتجر.\\n• تسجيل طلب دعم وتحويله للإدارة إذا احتجت تدخل موظف.\\n\\nما تبعتلي كلمة مرورك أو رمز التحقق أو PIN المحفظة. شو حابب نبدأ فيه؟",
      escalate: false,
      escalation_subject: "",
      escalation_summary: ""
    };
  }
  const greeting = hasAny(q, ["مرحبا","اهلا","السلام عليكم","صباح الخير","مسا الخير","هاي","هلا"]);
  const hasSpecificQuestion = hasAny(q, ["سعر","اسعار","قديش","بكم","رصيدي","محفظتي","طلباتي","حالة الطلب","فري فاير","فريفاير","ببجي","جواكر","ايداع","حوالة","مشكلة","ما وصل"]);
  if (greeting && q.length < 18 && !hasSpecificQuestion) {
    return { reply: "أهلاً وسهلاً فيك بباران جيم 🌟 أنا مساعدك الداخلي. فيني ساعدك بالمنتجات، الأسعار المسجلة، رصيد محفظتك، ومتابعة طلباتك وإيداعاتك.", escalate: false, escalation_subject: "", escalation_summary: "" };
  }
  if (q.length < 18 && hasAny(q, ["شكرا","يسلمو","مشكور","يعطيك العافيه"])) {
    return { reply: "العفو، أهلاً فيك بأي وقت ❤️ إذا احتجت شي تاني أنا جاهز.", escalate: false, escalation_subject: "", escalation_summary: "" };
  }
  if (hasAny(q, ["رصيدي","رصيد المحفظه","المحفظه","كم معي","قديش معي","balance"])) {
    if (!wallet) return { reply: "ما لقيت سجل محفظة مرتبط بحسابك حالياً. إذا المحفظة ظاهرة عندك وفيها مشكلة، خبرني أو اطلب تحويل الموضوع للدعم.", escalate: true, escalation_subject: "التحقق من المحفظة", escalation_summary: "الزبون لا تظهر له بيانات محفظة في سجل المساعد ويطلب التحقق منها." };
    const usd = moneyText(wallet.balance_usd, "USD");
    const syp = moneyText(wallet.balance_syp, "SYP");
    return { reply: "حسب سجل حسابك الحالي، رصيد محفظتك هو:\n• الدولار: " + (usd ?? "غير مسجل") + "\n• الليرة: " + (syp ?? "غير مسجل") + "\nهاي قراءة للسجل فقط؛ ما أجريت أي تعديل على الرصيد.", escalate: false, escalation_subject: "", escalation_summary: "" };
  }
  if (hasAny(q, ["ايداع","ايدعت","حواله","حوالتي","شام كاش","تحويل","دفعت"])) {
    if (!deposits.length) return { reply: "ما ظهر عندي طلب إيداع مسجل حديثاً على حسابك. إذا كنت محوّل فعلاً، لا تعيد التحويل قبل مراجعة الإدارة. فيني أحوّل الموضوع للدعم ليتحققوا من الحوالة.", escalate: true, escalation_subject: "إيداع غير ظاهر في سجل الزبون", escalation_summary: "الزبون يستفسر عن إيداع أو حوالة غير ظاهرة ضمن آخر سجلات الإيداع المتاحة." };
    const d = deposits[0];
    const status = String(d.status || "").toLowerCase();
    const state = status === "approved" ? "تمت الموافقة على طلب الإيداع حسب السجل."
      : status === "rejected" ? "طلب الإيداع مرفوض حسب السجل. لازم الإدارة تراجع سبب الرفض معك."
      : status === "pending" ? "طلب الإيداع ما زال قيد المراجعة، ولسه ما في تأكيد بالموافقة."
      : "حالة طلب الإيداع المسجلة: " + (d.status || "غير محددة") + ".";
    const amount = moneyText(d.amount, String(d.currency || ""));
    const reply = "آخر طلب إيداع مسجل عندك: " + state + (amount ? "\nالمبلغ المسجل: " + amount + "." : "") + "\nما بقدر أؤكد الحوالة أو أضيف رصيد؛ هالشي حصراً للإدارة.";
    return { reply, escalate: status === "rejected", escalation_subject: "مراجعة طلب إيداع", escalation_summary: "الزبون يستفسر عن آخر طلب إيداع؛ الحالة المسجلة: " + status + "." };
  }
  if (hasAny(q, ["طلبي","طلباتي","حالة الطلب","وين وصل الطلب","تتبع الطلب","طلب شحن","شحنتولي","وصل الشحن","حالة شحنتي","اوردر"])) {
    if (!orders.length) return { reply: "ما لقيت طلبات مسجلة على حسابك ضمن السجلات المتاحة حالياً. إذا كنت أرسلت طلب وما ظهر، خبرني باسم اللعبة ووقت الطلب التقريبي حتى أحوّل الموضوع للدعم.", escalate: true, escalation_subject: "طلب غير ظاهر في سجل الزبون", escalation_summary: "الزبون يقول إن لديه طلباً غير ظاهر في سجل الطلبات المتاح." };
    const order = orders[0];
    const state = String(order.status || "").toLowerCase();
    const labels: Record<string,string> = { pending:"قيد الانتظار",processing:"قيد التنفيذ",in_progress:"قيد التنفيذ",completed:"مكتمل",success:"مكتمل",failed:"فشل",rejected:"مرفوض",cancelled:"ملغي" };
    const product = products.find((p: any) => p.product_code === order.product_code);
    const productName = product?.name || order.product_code || "طلب شحن";
    const reply = "آخر طلب مسجل عندك:\n• المنتج: " + productName + "\n• الحالة: " + (labels[state] || order.status || "غير محددة") + "\n• الكمية: " + (order.quantity ?? "غير مسجلة") + (order.player_id ? "\n• معرّف اللاعب المسجل: " + order.player_id : "") + "\nهاي الحالة كما تظهر بالسجل، وما رح أقول إن الشحن اكتمل إلا إذا الحالة مؤكدة.";
    const customerReportsDeliveryIssue = hasAny(q, ["ما وصل","ما وصلني","ما انشحن","شحنتولي","وصل الشحن","فشل الشحن","مشكلة بالشحن","مشكله بالشحن"]);
    return { reply: customerReportsDeliveryIssue ? reply + "\\nبما أنك عم تبلغ عن مشكلة بوصول الشحن، رح أحوّلها للدعم ليتحققوا من التنفيذ حتى لو الحالة المسجلة مكتمل." : reply, escalate: ["failed","rejected"].includes(state) || customerReportsDeliveryIssue, escalation_subject: "مشكلة في طلب شحن", escalation_summary: "الزبون يستفسر عن آخر طلب شحن أو يبلغ عن عدم وصوله؛ المنتج: " + productName + "؛ الحالة المسجلة: " + state + "." };
  }
  if (hasAny(q, ["منتجات","شو عندكم","شو بتبيعوا","الالعاب","الباقات","الاشتراكات","اسعار","السعر","قديش سعر","بكم","عندكم ببجي","عندكم فري فاير","free fire","pubg","جواكر","chatgpt","فري فاير","فريفاير"])) {
    const asksFreeFire = hasAny(q, ["free fire", "freefire", "فري فاير", "فريفاير", "فري فاير", "فري فاير جواهر"]);
    const asksPubg = q.includes("pubg") || q.includes("ببجي");
    const asksJawaker = q.includes("جواكر");
    const asksChatGpt = q.includes("chatgpt");
    let chosen: any[] = [];

    if (asksFreeFire) {
      // Free Fire sale prices are maintained in the visible LEO manual catalog.
      // Never expose supplier costs or hidden catalog items to customers.
      chosen = manualProducts.filter((p: any) =>
        p.catalog_visible === true &&
        normalizeArabic(String(p.product_code || "")).includes("freefire")
      );
    } else if (asksPubg) {
      chosen = products.filter((p: any) =>
        normalizeArabic(String(p.product_code || "") + " " + String(p.name || "")).includes("pubg") ||
        normalizeArabic(String(p.name || "")).includes("ببجي")
      );
    } else if (asksJawaker) {
      chosen = products.filter((p: any) => normalizeArabic(String(p.name || "") + " " + String(p.product_code || "")).includes("جواكر"));
    } else if (asksChatGpt) {
      chosen = products.filter((p: any) => normalizeArabic(String(p.name || "") + " " + String(p.product_code || "")).includes("chatgpt"));
    } else {
      const terms = q.split(" ").filter((x) => x.length > 2 && !["اسعار","السعر","قديش","عندكم","منتجات","باقات","الالعاب","شو","بكم","عندكن","متوفر","متوفرين","في"].includes(x));
      const allVisible = [...products, ...manualProducts.filter((p: any) => p.catalog_visible === true)];
      chosen = allVisible.filter((p: any) => {
        const name = normalizeArabic(String(p.name || p.product_name || "") + " " + String(p.category || "") + " " + String(p.description || "") + " " + String(p.product_code || ""));
        return terms.length ? terms.some((term) => name.includes(term)) : true;
      });
    }

    const requestedNumbers = q.match(/\d+/g) || [];
    if (requestedNumbers.length) {
      chosen = chosen.filter((p: any) => {
        const identity = normalizeArabic(String(p.product_code || "") + " " + String(p.product_name || p.name || ""));
        return requestedNumbers.some((n) => identity.includes(n));
      });
    }

    chosen = chosen.slice(0, 12);
    if (!chosen.length) {
      const gameLabel = asksFreeFire ? "فري فاير" : asksPubg ? "ببجي" : asksJawaker ? "جواكر" : asksChatGpt ? "ChatGPT" : "المنتج المطلوب";
      return { reply: "ما لقيت حالياً منتجات ظاهرة ومطابقة لـ " + gameLabel + " ضمن الكتالوج المتاح. ما رح أعرض منتجات لعبة ثانية أو أخمّن سعراً. إذا بتحب، تواصل مع فريق الدعم للتأكد.", escalate: false, escalation_subject: "", escalation_summary: "" };
    }

    const rows = chosen.map((p: any) => {
      const productName = p.product_name || p.name || p.product_code || "منتج";
      const priceUsd = moneyText(p.sale_price_usd ?? p.price_usd, "USD");
      const priceSyp = moneyText(p.sale_price_syp ?? p.price_syp, "SYP");
      const price = [priceUsd, priceSyp].filter(Boolean).join(" | ");
      return "• " + productName + (price ? " — " + price : " — السعر غير مسجل حالياً");
    });
    return { reply: "هاي المنتجات والأسعار المسجلة بالكتالوج:\n" + rows.join("\n") + "\nالأسعار المعروضة هي أسعار البيع المسجلة، وليست تكلفة المورد.", escalate: false, escalation_subject: "", escalation_summary: "" };
  }
  if (hasAny(q, ["نسيت كلمه السر","نسيت كلمة المرور","ما عم اقدر فوت","ما بقدر سجل دخول","تسجيل الدخول","كلمه المرور","كلمة السر"])) {
    return { reply: "خلّينا نجرب هالخطوات:\n1. تأكد أنك تستخدم البريد الصحيح للحساب.\n2. من صفحة الدخول اضغط «نسيت كلمة المرور؟».\n3. افتح رسالة الاستعادة من بريدك، وشيّك مجلد الرسائل غير المرغوب فيها.\n4. إذا ما وصل الرابط بعد إعادة محاولة واحدة، خبرني حتى أحوّل المشكلة للدعم.\nولا تبعتلي كلمة مرورك أو رمز التحقق أبداً.", escalate: false, escalation_subject: "", escalation_summary: "" };
  }
  if (hasAny(q, ["ما وصل","ما انشحن","انخصم","انخصمت","فشل الشحن","مشكله بالشحن","مشكلة بالشحن","استرداد","خصم من رصيدي","حسابي مخترق","سرقوا حسابي"])) {
    return { reply: "فهمت عليك. هالمشكلة لازم يراجعها فريق الدعم مع سجل الطلب، وما رح أفترض أن الشحن تم أو أغيّر أي رصيد. رح أحوّل التفاصيل للإدارة حتى يتابعوها.", escalate: true, escalation_subject: "مشكلة في الشحن أو الحساب", escalation_summary: redactSensitiveSupportText("الزبون أبلغ عن مشكلة شحن/خصم/أمان: " + question.slice(0, 1000)) };
  }
  return { reply: "فهمت سؤالك، بس حالياً ما عندي معلومة مؤكدة كافية لأجاوبك بدون تخمين. فيني أساعدك بالمنتجات والأسعار المسجلة، رصيد المحفظة، متابعة الطلبات والإيداعات، ومشاكل تسجيل الدخول. شو الجزء اللي بدك نبدأ فيه؟", escalate: false, escalation_subject: "", escalation_summary: "" };
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
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) {
      console.error("baran-assistant: Supabase server configuration missing");
      return json({ error: "Server configuration is incomplete" }, 500);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return json({ error: "Authentication required" }, 401);

    const userClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) return json({ error: "Invalid session" }, 401);

    let body: { messages?: Array<{ role?: string; content?: string }> };
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
    if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 12) {
      return json({ error: "Invalid conversation" }, 400);
    }
    const messages = body.messages
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-8)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content!.trim().slice(0, 1200) }))
      .filter((m) => m.content.length > 0);
    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return json({ error: "A user message is required" }, 400);
    }
    const latestQuestion = messages[messages.length - 1].content;
    if (latestQuestion.length < 1) return json({ error: "Empty message" }, 400);

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: accountControl, error: accountControlError } = await admin.from("customer_account_controls")
      .select("status,banned_until").eq("user_id", user.id).maybeSingle();
    if (accountControlError) return json({ error: "تعذر التحقق من حالة حماية الحساب." }, 500);
    if (accountControl?.status === "banned" &&
        (!accountControl.banned_until || new Date(accountControl.banned_until).getTime() > Date.now())) {
      return json({ error: "هذا الحساب موقوف حالياً. لا يمكن استخدام المساعد أثناء الحظر." }, 403);
    }

    // Deterministic action: an explicit request for a human agent or a support ticket
    // must create a real ticket server-side; the language model cannot veto this action.
    const explicitHumanRequest =
      /(?:افتح|إنشاء|انشاء|سجّل|سجل|اعمل|قدّم|قدم).{0,35}(?:تذكر(?:ة|ه)|طلب دعم)/iu.test(latestQuestion) ||
      /(?:موظف الدعم|فريق الدعم|الدعم البشري|حوّلني|حولني|تحويل(?:ني)? للإدارة|للموظف)/iu.test(latestQuestion) ||
      (/(?:تذكرة|تذكره)/iu.test(latestQuestion) && /(?:فعلي|حقيقية|الآن|هلق|هلأ|مباشر|سجّل|سجل|افتح)/iu.test(latestQuestion));

    if (explicitHumanRequest) {
      const recentUserMessages = messages
        .filter((m) => m.role === "user")
        .slice(-4)
        .map((m) => redactSensitiveSupportText(m.content.trim()))
        .join("\\n");
      const testTicket = /اختبار نظام الدعم/iu.test(recentUserMessages);
      const subject = testTicket ? "اختبار نظام الدعم" : "طلب موظف الدعم";
      const summary = redactSensitiveSupportText("طلب الزبون فتح تذكرة والتواصل مع موظف الدعم.\\nتفاصيل المحادثة الأخيرة:\\n" +
        recentUserMessages).slice(0, 1800);
      const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const { data: recentTicket, error: recentError } = await admin
        .from("customer_feedback")
        .select("id,ticket_code,message")
        .eq("user_id", user.id)
        .eq("feedback_type", "support")
        .in("status", ["pending", "in_progress"])
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (recentError) {
        console.error("baran-assistant: recent ticket lookup failed", recentError.message);
        return json({ error: "تعذر التحقق من تذكرة الدعم. لم يتم إنشاء تذكرة جديدة؛ حاول مرة أخرى." }, 500);
      }

      let ticketCode: string | null = null;
      let ticketId: string | null = null;
      if (recentTicket?.id) {
        const appended = (String(recentTicket.message || "") + "\\n\\nمتابعة عبر مساعد باران: " + summary).slice(-2000);
        const { error: updateError } = await admin.from("customer_feedback")
          .update({ message: appended, updated_at: new Date().toISOString() })
          .eq("id", recentTicket.id)
          .eq("user_id", user.id);
        if (updateError) {
          console.error("baran-assistant: ticket update failed", updateError.message);
          return json({ error: "تعذر تحديث تذكرة الدعم. لم يتم تأكيد تسجيل الطلب." }, 500);
        }
        ticketCode = recentTicket.ticket_code ?? null;
        ticketId = recentTicket.id;
      } else {
        const { data: inserted, error: insertError } = await admin.from("customer_feedback").insert({
          user_id: user.id,
          feedback_type: "support",
          subject,
          message: summary,
          status: "pending",
        }).select("id,ticket_code").single();
        if (insertError || !inserted) {
          console.error("baran-assistant: explicit ticket creation failed", insertError?.message);
          return json({ error: "ما قدرت سجّل التذكرة حالياً. ما رح أقول إنها انعملت قبل ما أتأكد." }, 500);
        }
        ticketCode = inserted.ticket_code ?? null;
        ticketId = inserted.id;
      }

      if (!ticketId) {
        return json({ error: "تعذر تأكيد تسجيل التذكرة. تواصل مع الدعم من جديد." }, 500);
      }
      const reply = ticketCode
        ? "تم تسجيل طلبك بنجاح وتحويله للإدارة. رقم التذكرة: " + ticketCode + ". رح تتابع الإدارة الطلب من لوحة الدعم."
        : "تم تسجيل طلبك وتحويله للإدارة بنجاح. رح تتابع الإدارة الطلب من لوحة الدعم.";
      return json({ reply, escalated: true, ticket_code: ticketCode, ticket_created: !recentTicket?.id });
    }
    const [
      profileResult,
      walletResult,
      ordersResult,
      depositsResult,
      productsResult,
      manualProductsResult,
    ] = await Promise.all([
      admin.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
      admin.from("wallets").select("balance_usd,balance_syp").eq("user_id", user.id).maybeSingle(),
      admin.from("orders").select("product_code,player_id,quantity,status,created_at,total_price_usd,total_price_syp")
        .eq("user_id", user.id).order("created_at", { ascending: false }).limit(10),
      admin.from("deposit_requests").select("amount,currency,transfer_reference,status,created_at")
        .eq("user_id", user.id).order("created_at", { ascending: false }).limit(10),
      admin.from("products").select("product_code,category,name,description,price_usd,price_syp")
        .eq("is_active", true).order("sort_order", { ascending: true }).limit(50),
      admin.from("leo_manual_products").select("product_code,product_name,sale_price_usd,sale_price_syp,catalog_visible")
        .eq("catalog_visible", true).order("product_name", { ascending: true }).limit(100),
    ]);
    const queryErrors = [profileResult.error, walletResult.error, ordersResult.error, depositsResult.error, productsResult.error, manualProductsResult.error].filter(Boolean);
    if (queryErrors.length) {
      console.error("baran-assistant: customer context query failed", queryErrors.map((e: any) => e.message));
      return json({ error: "تعذر تحميل بعض بيانات حسابك حالياً. جرّب بعد قليل، ولم يتم إجراء أي تغيير على رصيدك أو طلباتك." }, 503);
    }
    const profile = profileResult.data;
    const wallet = walletResult.data;
    const orders = ordersResult.data;
    const deposits = depositsResult.data;
    const products = productsResult.data;
    const manualProducts = manualProductsResult.data;

    const customerContext = {
      customer_name: profile?.full_name ?? null,
      wallet: wallet ? {
        balance_usd: wallet.balance_usd,
        balance_syp: wallet.balance_syp,
      } : null,
      recent_orders: orders ?? [],
      recent_deposits: deposits ?? [],
      active_products: products ?? [],
      manual_products: manualProducts ?? [],
    };

    const internalStarted = Date.now();
    const answer = internalCustomerAnswer(latestQuestion, customerContext, messages);
    const internalCompletedAt = new Date().toISOString();
    const { error: internalLogError } = await admin.from("ai_usage_events").insert({
      function_name: "baran-assistant",
      feature: "customer_support",
      actor_user_id: user.id,
      route: "internal",
      usage_status: "succeeded",
      model: "baran-internal-rules-v1",
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      status_code: 200,
      duration_ms: Math.max(0, Date.now() - internalStarted),
      completed_at: internalCompletedAt
    });
    if (internalLogError) console.error("baran-assistant: internal usage log failed", internalLogError.message);

    let escalated = false;
    let escalationTicketCode: string | null = null;
    if (answer.escalate === true) {
      const subject = (answer.escalation_subject || "طلب مساعدة من المساعد الذكي").trim().slice(0, 120);
      const summary = redactSensitiveSupportText(answer.escalation_summary || latestQuestion).trim().slice(0, 1800);
      if (summary.length >= 10) {
        const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const { data: recentTicket } = await admin.from("customer_feedback")
          .select("id,message,ticket_code").eq("user_id", user.id).eq("feedback_type", "support")
          .in("status", ["pending", "in_progress"]).gte("created_at", cutoff)
          .order("created_at", { ascending: false }).limit(1).maybeSingle();

        if (recentTicket?.id) {
          const appended = (String(recentTicket.message || "") + "\n\nمتابعة عبر المساعد: " + summary).slice(-2000);
          const { error: updateError } = await admin.from("customer_feedback")
            .update({ message: appended, updated_at: new Date().toISOString() })
            .eq("id", recentTicket.id);
          if (!updateError) {
            escalated = true;
            escalationTicketCode = recentTicket.ticket_code ?? null;
          }
        } else {
          const { data: insertedTicket, error: insertError } = await admin.from("customer_feedback").insert({
            user_id: user.id,
            feedback_type: "support",
            subject: subject.length >= 3 ? subject : "طلب مساعدة من المساعد الذكي",
            message: summary.length >= 10 ? summary : "الزبون طلب مساعدة من موظف الدعم.",
            status: "pending",
          }).select("ticket_code").single();
          if (!insertError) {
            escalated = true;
            escalationTicketCode = insertedTicket?.ticket_code ?? null;
          } else console.error("baran-assistant: escalation ticket insert failed", insertError.message);
        }
      }
    }

    return json({ reply: answer.reply.trim().slice(0, 1800), escalated, ticket_code: escalationTicketCode });
  } catch (error) {
    console.error("baran-assistant request failed", error instanceof Error ? error.message : String(error));
    return json({ error: "حدث خطأ غير متوقع. جرّب مرة ثانية." }, 500);
  }
});
