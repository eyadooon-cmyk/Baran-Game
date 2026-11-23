import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://eyadooon-cmyk.github.io",
  "https://baran-game.pages.dev",
]);
function corsHeaders(origin = ""): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
  if (ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}
const categories = new Set(["game", "ai", "vpn", "gift_card", "app"]);
function json(body: unknown, status = 200, origin = "") {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}
function readKeyObject(name: string): string | undefined {
  const raw = Deno.env.get(name);
  if (!raw) return undefined;
  try { return JSON.parse(raw).default; } catch { return undefined; }
}
function normalize(value: string): string {
  return String(value || "").toLowerCase().normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[ـ]/g, " ").replace(/[^\p{L}\p{N}\s_|-]/gu, " ")
    .replace(/\s+/g, " ").trim();
}
function inferCategory(value: string): string | null {
  const q = normalize(value);
  if (/(فري فاير|فريفاير|free fire|freefire|ببجي|pubg|جواكر|jawaker|شدات|جواهر|توكنز|لعبة|game|\buc\b)/i.test(q)) return "game";
  if (/(chatgpt|ذكاء اصطناعي|خدمة ai|\bai\b)/i.test(q)) return "ai";
  if (/(vpn|في بي ان)/i.test(q)) return "vpn";
  if (/(google play|gift card|بطاقة|بطاقات|كرت هدية)/i.test(q)) return "gift_card";
  if (/(تطبيق مدفوع|تطبيقات|app|برنامج مدفوع)/i.test(q)) return "app";
  return null;
}
function contextLabel(value: string): string {
  const q = normalize(value);
  if (q.includes("free fire") || q.includes("freefire") || q.includes("فري فاير") || q.includes("فريفاير")) return "Free Fire";
  if (q.includes("pubg") || q.includes("ببجي")) return "PUBG Mobile";
  if (q.includes("jawaker") || q.includes("جواكر")) return "Jawaker";
  if (q.includes("chatgpt")) return "ChatGPT";
  if (q.includes("google play")) return "Google Play";
  if (q.includes("vpn") || q.includes("في بي ان")) return "VPN";
  return "";
}
function stableCode(name: string, category: string): string {
  let hash = 2166136261;
  for (const char of normalize(name)) {
    hash ^= char.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619);
  }
  return category.toUpperCase() + "_" + (hash >>> 0).toString(36).toUpperCase();
}
function cleanSegment(value: string): string {
  return String(value || "").trim()
    .replace(/^\s*(?:[-*•]|\d+[.)-])\s*/u, "")
    .replace(/^(?:أضف|اضف|ضيف|ضيفلي|أريد إضافة|اريد اضافه|أنشئ|انشئ|إنشاء|انشاء|بدي|بدنا)\s*/u, "")
    .replace(/^(?:منتجات|منتج|باقات|باقة)\s*[:：-]?\s*/u, "")
    .trim();
}
function splitCommand(command: string): string[] {
  return command.split(/\r?\n|[;؛]+/u)
    .flatMap((line) => line.split(/[،,]+/u))
    .map(cleanSegment).filter((part) => part.length >= 2);
}
function parseStructured(part: string): { product_code: string; name: string; category: string; description: string } | null {
  const fields = part.split("|").map((x) => x.trim());
  if (fields.length < 3 || !/^[A-Z0-9][A-Z0-9_-]{1,59}$/i.test(fields[0])) return null;
  const category = fields[2].toLowerCase();
  if (!categories.has(category) || fields[1].length < 2) return null;
  return { product_code: fields[0].toUpperCase(), name: fields[1].slice(0,120), category, description: (fields[3] || "").slice(0,500) };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin") ?? "";
  if (req.method === "OPTIONS") {
    if (origin && !ALLOWED_ORIGINS.has(origin)) return new Response("Forbidden", { status: 403 });
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (origin && !ALLOWED_ORIGINS.has(origin)) return respond({ error: "Origin not allowed" }, 403, origin);
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405, origin);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? readKeyObject("SUPABASE_PUBLISHABLE_KEYS");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const secretKey = readKeyObject("SUPABASE_SECRET_KEYS");
    if (!url || !anonKey || !serviceKey) return respond({ error: "Server configuration is incomplete" }, 500);

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return respond({ error: "Authentication required" }, 401);
    const userClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) return respond({ error: "Invalid session" }, 401);

    const admin = createClient(url, secretKey ?? serviceKey, {
      global: { headers: { Authorization: "Bearer " + serviceKey } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: isAdmin, error: adminError } = await admin.rpc("admin_is_user", { p_user_id: user.id });
    if (adminError) return respond({ error: "تعذر التحقق من صلاحية المدير." }, 500);
    if (isAdmin !== true) return respond({ error: "Administrator access required" }, 403);

    let body: { command?: string };
    try { body = await req.respond(); } catch { return respond({ error: "Invalid JSON" }, 400); }
    const command = typeof body.command === "string" ? body.command.trim().slice(0, 500) : "";
    if (command.length < 3) return respond({ error: "اكتب وصف المنتجات التي تريد إضافتها." }, 400);

    const { data: existingRows, error: existingError } = await admin.from("products")
      .select("product_code,name,sort_order").limit(1000);
    if (existingError) return respond({ error: "تعذر قراءة كتالوج المنتجات للتحقق من التكرار." }, 502);
    const existingCodes = new Set((existingRows ?? []).map((p: any) => String(p.product_code || "").toUpperCase()));
    const existingNames = new Set((existingRows ?? []).map((p: any) => normalize(String(p.name || ""))));
    const maxSort = Math.max(99, ...(existingRows ?? []).map((p: any) => Number(p.sort_order) || 0));

    const globalCategory = inferCategory(command);
    const label = contextLabel(command);
    const rawParts = splitCommand(command);
    const candidates: Array<{product_code?:string;name:string;category:string;description:string}> = [];

    for (const part of rawParts) {
      const structured = parseStructured(part);
      if (structured) {
        candidates.push(structured);
        continue;
      }
      const category = inferCategory(part) || globalCategory;
      if (!category) continue;
      let name = part;
      if (label && category !== "app") {
        const aliases: Record<string, RegExp> = {
          "Free Fire": /free\s*fire|freefire|فري\s*فاير|فريفاير/giu,
          "PUBG Mobile": /pubg\s*mobile|pubg|ببجي/giu,
          "Jawaker": /jawaker|جواكر/giu,
          "ChatGPT": /chatgpt/giu,
          "Google Play": /google\s*play/giu,
          "VPN": /vpn|في\s*بي\s*ان/giu
        };
        const alias = aliases[label];
        const detail = (alias ? part.replace(alias, " ") : part).replace(/[:：]/g, " ").replace(/\s+/g, " ").trim();
        name = (label + " " + detail).trim();
      }
      name = name.replace(/^(?:في|و|ثم)\s*/u, "").trim();
      if (name.length < 2) continue;
      candidates.push({ name: name.slice(0,120), category, description: "" });
    }

    if (candidates.length <= 1 && label) {
      const packageMatches = [...command.matchAll(/(\d+(?:[.,]\d+)?)\s*(جوهرة|جواهر|شدة|شدات|uc|توكن|توكنز|يوم|أيام|شهر|أشهر|gb|جيجا)/giu)];
      if (packageMatches.length >= 2) {
        candidates.length = 0;
        for (const match of packageMatches) {
          candidates.push({ name: (label + " " + match[0]).trim().slice(0,120), category: globalCategory || "game", description: "" });
        }
      }
    }

    if (!candidates.length) {
      return respond({
        error: "ما قدرت أحدد منتجات مؤكدة من النص. اكتب كل منتج بسطر، أو استخدم الصيغة: CODE | اسم المنتج | game/ai/vpn/gift_card/app | وصف اختياري. لم يتم حفظ أي شيء."
      }, 422);
    }
    if (candidates.length > 30) return respond({ error: "الحد الأقصى 30 منتجاً في المعاينة الواحدة." }, 400);

    const seenNames = new Set<string>();
    const products: any[] = [];
    let skippedDuplicates = 0;
    for (let i = 0; i < candidates.length; i++) {
      const item = candidates[i];
      const category = item.category;
      const name = String(item.name || "").trim().slice(0,120);
      const normalizedName = normalize(name);
      if (!categories.has(category) || name.length < 2 || seenNames.has(normalizedName) || existingNames.has(normalizedName)) {
        skippedDuplicates++;
        continue;
      }
      seenNames.add(normalizedName);
      const baseCode = item.product_code || stableCode(name, category);
      let code = baseCode;
      let suffix = 2;
      while (existingCodes.has(code) || products.some((p) => p.product_code === code)) code = baseCode + "_" + suffix++;
      if (!/^[A-Z0-9][A-Z0-9_-]{1,59}$/.test(code)) {
        return respond({ error: "تعذر إنشاء رمز صالح لأحد المنتجات. أعد كتابة اسم المنتج أو أدخل رمزاً واضحاً." }, 422);
      }
      products.push({
        product_code: code, category, name,
        description: String(item.description || "").slice(0,500),
        sort_order: maxSort + 1 + products.length,
        is_active: false, price_usd: null, price_syp: null,
      });
      existingCodes.add(code);
    }
    if (!products.length) return respond({ error: "كل المنتجات المقترحة موجودة مسبقاً أو مكررة؛ لم أجهز إضافة جديدة.", skipped_duplicates: skippedDuplicates }, 409);

    const { error: usageError } = await admin.from("ai_usage_events").insert({
      function_name: "baran-product-assistant", feature: "product_catalog_assistant",
      actor_user_id: user.id, route: "internal", usage_status: "succeeded",
      model: "baran-internal-rules-v1", input_tokens: 0, output_tokens: 0, total_tokens: 0,
      status_code: 200, duration_ms: 0, completed_at: new Date().toISOString()
    });
    if (usageError) console.error("baran-product-assistant: internal usage log failed", usageError.message);

    return respond({ products, count: products.length, skipped_duplicates: skippedDuplicates, prices: "empty", engine: "internal-rules-v1" });
  } catch (error) {
    console.error("baran-product-assistant: unhandled error", error instanceof Error ? error.message : "unknown");
    return respond({ error: "حدث خطأ داخلي أثناء تجهيز معاينة المنتجات." }, 500);
  }
});