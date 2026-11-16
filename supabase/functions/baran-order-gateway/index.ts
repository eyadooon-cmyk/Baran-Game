import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = "https://eyadooon-cmyk.github.io";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

function readKeyObject(name: string): string | undefined {
  const raw = Deno.env.get(name);
  if (!raw) return undefined;
  try { return JSON.parse(raw).default; } catch { return undefined; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "طريقة الطلب غير مسموحة." }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? readKeyObject("SUPABASE_PUBLISHABLE_KEYS");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? readKeyObject("SUPABASE_SECRET_KEYS");
    if (!url || !anonKey || !serviceKey) {
      console.error("BARAN_ORDER_GATEWAY_CONFIG_MISSING", {
        url: !!url, publishableKey: !!anonKey, serviceKey: !!serviceKey,
      });
      return json({ error: "إعدادات بوابة الطلبات غير مكتملة على الخادم.", code: "SERVER_CONFIG_MISSING" }, 503);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!accessToken) return json({ error: "سجّل الدخول أولاً." }, 401);

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: "Bearer " + accessToken } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser(accessToken);
    const user = authData?.user;
    if (authError || !user) return json({ error: "انتهت الجلسة. سجّل الدخول مجدداً." }, 401);

    const rawBody = await req.text();
    if (rawBody.length > 8192) return json({ error: "حجم البيانات أكبر من المسموح." }, 413);
    let body: any;
    try { body = JSON.parse(rawBody); } catch { return json({ error: "بيانات الطلب غير صالحة." }, 400); }

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    if (body?.action === "catalog_report") {
      const { data: adminRecord, error: adminCheckError } = await admin
        .from("admin_users")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (adminCheckError) {
        console.error("BARAN_CATALOG_REPORT_ADMIN_CHECK_FAILED", adminCheckError.message);
        return json({ error: "تعذر التحقق من صلاحية الإدارة." }, 500);
      }
      if (!adminRecord) return json({ error: "هذا التقرير مخصص لحسابات الإدارة فقط." }, 403);

      const { data: report, error: reportError } = await admin.rpc("baran_admin_catalog_readiness");
      if (reportError) {
        console.error("BARAN_CATALOG_REPORT_RPC_FAILED", reportError.message);
        return json({ error: "تعذر إنشاء تقرير جاهزية المنتجات." }, 500);
      }
      return json({ success: true, report });
    }

    if (body?.action !== "preflight") {
      return json({ error: "هذه البوابة تدعم فحص المنتج أو تقرير الإدارة فقط؛ لا تنشئ طلباً ولا تخصم رصيداً.", code: "READ_ONLY_GATEWAY" }, 409);
    }

    const productCode = typeof body.product_code === "string" ? body.product_code.trim().toUpperCase() : "";
    const quantity = Number(body.quantity ?? 1);
    const currency = typeof body.payment_currency === "string" ? body.payment_currency.toUpperCase() : "";
    const playerId = typeof body.player_id === "string" ? body.player_id.trim() : "";

    if (!/^[A-Z0-9][A-Z0-9_-]{1,59}$/.test(productCode)) return json({ error: "رمز المنتج غير صالح." }, 400);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) return json({ error: "الكمية يجب أن تكون بين 1 و100." }, 400);
    if (!["USD", "SYP"].includes(currency)) return json({ error: "عملة الدفع غير مدعومة." }, 400);

    const { data: preflight, error: preflightError } = await admin.rpc("baran_order_preflight", {
      p_user_id: user.id,
      p_product_code: productCode,
      p_quantity: quantity,
      p_payment_currency: currency,
      p_player_id: playerId || null,
    });
    if (preflightError) {
      console.error("BARAN_ORDER_PREFLIGHT_RPC_FAILED", preflightError.message);
      return json({ error: "تعذر إكمال فحص الجاهزية. لم يتم إنشاء طلب ولم يُخصم أي رصيد." }, 500);
    }
    return json(preflight ?? {
      success: false,
      can_create_order: false,
      can_purchase: false,
      charged: false,
      order_created: false,
      error: "لم تصل نتيجة فحص صالحة.",
    });
  } catch (error) {
    console.error("BARAN_ORDER_GATEWAY_FAILED", error instanceof Error ? error.message : String(error));
    return json({ error: "تعذر فحص جاهزية الطلب حالياً. لم يتم إنشاء طلب ولم يُخصم أي رصيد." }, 500);
  }
});