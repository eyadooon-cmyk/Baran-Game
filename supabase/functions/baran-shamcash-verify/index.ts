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
function normCurrency(value: unknown): string {
  if (typeof value === "string") return value.toUpperCase();
  if (value && typeof value === "object" && typeof (value as any).code === "string") {
    return (value as any).code.toUpperCase();
  }
  return "";
}
async function shamGet(path: string, token: string): Promise<any> {
  const response = await fetch("https://api.shamcash-api.com/v1" + path, {
    method: "GET",
    headers: { Authorization: "Bearer " + token, Accept: "application/json" },
  });
  let payload: any;
  try { payload = await response.json(); } catch { throw new Error("SHAMCASH_BAD_RESPONSE"); }
  if (!response.ok || payload?.status !== "success") {
    const code = String(payload?.code || "SHAMCASH_API_ERROR");
    if (code === "SUBSCRIPTION_UNAVAILABLE") throw new Error("SHAMCASH_SUBSCRIPTION_UNAVAILABLE");
    if (code === "RATE_LIMIT_EXCEEDED") throw new Error("SHAMCASH_RATE_LIMIT");
    if (code === "AUTH_INVALID" || code === "AUTH_MISSING") throw new Error("SHAMCASH_TOKEN_INVALID");
    throw new Error("SHAMCASH_API_ERROR:" + code);
  }
  return payload.data;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "طريقة الطلب غير مسموحة." }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? readKeyObject("SUPABASE_PUBLISHABLE_KEYS");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? readKeyObject("SUPABASE_SECRET_KEYS");
    const apiToken = Deno.env.get("SHAMCASH_API_TOKEN");
    if (!url || !anonKey || !serviceKey || !apiToken) {
      console.error("BARAN_VERIFY_CONFIG_MISSING", {
        supabaseUrl: !!url,
        publishableKey: !!anonKey,
        secretKey: !!serviceKey,
        shamcashToken: !!apiToken,
      });
      const missing = [
        !url ? "SUPABASE_URL" : null,
        !anonKey ? "SUPABASE_PUBLISHABLE_KEYS/default" : null,
        !serviceKey ? "SUPABASE_SECRET_KEYS/default" : null,
        !apiToken ? "SHAMCASH_API_TOKEN" : null,
      ].filter(Boolean);
      return json({ error: "إعداد التحقق غير مكتمل على الخادم.", code: "SERVER_CONFIG_MISSING", missing }, 503);
    }
    const auth = req.headers.get("Authorization") ?? "";
    const accessToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!accessToken) return json({ error: "سجّل الدخول أولاً." }, 401);
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: "Bearer " + accessToken } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser(accessToken);
    const user = authData?.user;
    if (authError || !user) return json({ error: "انتهت الجلسة. سجّل الدخول مجدداً." }, 401);

    let body: any;
    try { body = await req.json(); } catch { return json({ error: "بيانات الطلب غير صالحة." }, 400); }
    let transactionId = typeof body?.transaction_id === "string" ? body.transaction_id.trim() : "";
    const amount = Number(body?.amount);
    const currency = typeof body?.currency === "string" ? body.currency.toUpperCase() : "";
    if (!/^[0-9]{1,30}$/.test(transactionId) || BigInt(transactionId) <= 0n) return json({ error: "أدخل رقم حوالة شام كاش صحيحاً بالأرقام فقط." }, 400);
    transactionId = BigInt(transactionId).toString();
    if (!Number.isFinite(amount) || amount <= 0 || !["USD", "SYP"].includes(currency) ||
        (currency === "SYP" && !Number.isInteger(amount)) ||
        (currency === "USD" && Math.round(amount * 100) !== amount * 100)) {
      return json({ error: "تحقق من المبلغ والعملة." }, 400);
    }

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: accountControl, error: accountControlError } = await admin.from("customer_account_controls")
      .select("status,banned_until").eq("user_id", user.id).maybeSingle();
    if (accountControlError) {
      console.error("BARAN_VERIFY_ACCOUNT_CONTROL_FAILED", accountControlError.message);
      return json({ error: "تعذر التحقق من حالة حماية الحساب." }, 500);
    }
    if (accountControl?.status === "banned" &&
        (!accountControl.banned_until || new Date(accountControl.banned_until).getTime() > Date.now())) {
      return json({ error: "هذا الحساب موقوف حالياً. لا يمكن إرسال طلب شحن رصيد أثناء الحظر." }, 403);
    }
    const { data: controlRows, error: controlError } = await admin.rpc("baran_get_shamcash_control");
    const control = Array.isArray(controlRows) ? controlRows[0] : null;
    if (controlError || !control?.integration_enabled) {
      console.error("BARAN_VERIFY_CONTROL_CHECK_FAILED", {
        databaseError: !!controlError,
        integrationEnabled: !!control?.integration_enabled,
      });
      return json({ error: "التحقق عبر شام كاش غير مفعّل حالياً.", code: "INTEGRATION_DISABLED" }, 503);
    }

    const { data: duplicate, error: duplicateError } = await admin.from("deposit_requests")
      .select("id,status").eq("payment_method", "sham_cash")
      .ilike("transfer_reference", transactionId).limit(1).maybeSingle();
    if (duplicateError) return json({ error: "تعذر فحص تكرار رقم الحوالة." }, 500);
    if (duplicate) return json({ error: "رقم الحوالة مستخدم مسبقاً في طلب شحن." }, 409);

    const accountsData = await shamGet("/accounts", apiToken);
    const accounts = Array.isArray(accountsData) ? accountsData :
      Array.isArray(accountsData?.accounts) ? accountsData.accounts : [];
    const activeAccounts = accounts.filter((a: any) => a && a.status === "active" && typeof a.id === "string");
    if (activeAccounts.length === 0) return json({ error: "ما في حساب شام كاش مرتبط ونشط على API. اربط الحساب وفعّل التجربة أو الاشتراك." }, 409);
    if (activeAccounts.length > 1) return json({ error: "يوجد أكثر من حساب شام كاش نشط. يلزم تحديد حساب الاستقبال من الإعدادات قبل التحقق." }, 409);
    const accountId = activeAccounts[0].id;

    const params = new URLSearchParams({ account_id: accountId, transaction_ids: transactionId, limit: "1" });
    const txData = await shamGet("/transactions?" + params.toString(), apiToken);
    const transactions = Array.isArray(txData) ? txData :
      Array.isArray(txData?.transactions) ? txData.transactions : [];
    const tx = transactions.find((item: any) => String(item?.transaction_id ?? item?.id ?? "") === transactionId);
    if (!tx) return json({ error: "لم نعثر على حوالة واردة بهذا الرقم في حساب الاستقبال. تأكد من الرقم وانتظر قليلاً ثم أعد المحاولة." }, 404);
    // ShamCash GET /transactions is documented to return incoming received transfers only.
    // Some API payload versions may omit direction; if supplied, it must still be incoming.
    const transactionDirection = typeof tx.direction === "string"
      ? tx.direction.toLowerCase()
      : "";
    if (transactionDirection && transactionDirection !== "incoming") {
      return json({ error: "هذه الحوالة ليست حوالة واردة إلى حساب الاستقبال، لذلك لم يتم إضافة أي رصيد." }, 409);
    }
    const receivedAmount = Number(tx.amount);
    const receivedCurrency = normCurrency(tx.currency ?? tx.currency_code);
    if (!Number.isFinite(receivedAmount) || receivedCurrency !== currency ||
        (currency === "USD" ? Math.round(receivedAmount * 100) !== Math.round(amount * 100) :
          Math.round(receivedAmount) !== Math.round(amount))) {
      return json({ error: "الحوالة موجودة، لكن المبلغ أو العملة لا يطابقان البيانات المدخلة." }, 409);
    }

    const { data: processed, error: processError } = await admin.rpc(
      "baran_process_verified_shamcash_deposit",
      {
        p_user_id: user.id,
        p_amount: amount,
        p_currency: currency,
        p_transfer_reference: transactionId,
        p_dry_run: false,
      },
    );
    if (processError) {
      console.error("ShamCash verified deposit processing failed", processError.code);
      return json({ error: "تم التحقق من الحوالة لكن تعذرت معالجة طلب الشحن بأمان. تواصل مع الدعم." }, 500);
    }
    if (processed?.duplicate) {
      return json({ error: "رقم الحوالة مستخدم مسبقاً في طلب شحن." }, 409);
    }
    if (!processed?.success || !processed?.request_id) {
      return json({ error: "تعذر إنشاء طلب الشحن بعد التحقق." }, 500);
    }
    const walletCredited = processed.wallet_credited === true;
    return json({
      success: true,
      message: walletCredited
        ? "تم التحقق من الحوالة وإضافة الرصيد تلقائياً إلى محفظتك."
        : "تم التحقق من الحوالة وإنشاء طلب الشحن. الشحن التلقائي غير مفعّل حالياً.",
      request: {
        id: processed.request_id,
        amount,
        currency,
        transfer_reference: transactionId,
        status: processed.status,
      },
      verified: { transaction_id: transactionId, amount: receivedAmount, currency: receivedCurrency },
      wallet_credited: walletCredited,
      mode: processed.mode ?? (walletCredited ? "automatic" : "manual_fallback"),
    }, 200);
  } catch (error) {
    const code = error instanceof Error ? error.message : String(error);
    if (code === "SHAMCASH_SUBSCRIPTION_UNAVAILABLE") return json({ error: "اشتراك حساب شام كاش API غير نشط. فعّل التجربة أو الاشتراك ثم أعد المحاولة." }, 503);
    if (code === "SHAMCASH_RATE_LIMIT") return json({ error: "طلبات التحقق كثيرة حالياً. انتظر قليلاً ثم أعد المحاولة." }, 429);
    if (code === "SHAMCASH_TOKEN_INVALID") return json({ error: "مفتاح ShamCash API غير صالح أو منتهي. راجع إعدادات المنصة." }, 503);
    if (code === "SHAMCASH_BAD_RESPONSE") return json({ error: "استجابة ShamCash API غير مفهومة حالياً." }, 502);
    console.error("BARAN_VERIFY_UPSTREAM_OR_RUNTIME_ERROR", { code });
    return json({ error: "تعذر الاتصال بخدمة ShamCash API حالياً. حاول لاحقاً." }, 502);
  }
});