import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = "https://eyadooon-cmyk.github.io";
const headers = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
function readKeyObject(name: string): string | undefined {
  const raw = Deno.env.get(name);
  if (!raw) return undefined;
  try { return JSON.parse(raw).default; } catch { return undefined; }
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const origin = req.headers.get("Origin");
  if (origin && origin !== allowedOrigin) return json({ error: "Origin not allowed" }, 403);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? readKeyObject("SUPABASE_PUBLISHABLE_KEYS");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const secretKey = readKeyObject("SUPABASE_SECRET_KEYS");
    if (!url || !anonKey || !serviceKey) return json({ error: "Server configuration is incomplete" }, 500);
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return json({ error: "Authentication required" }, 401);
    const userClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Invalid session" }, 401);
    const admin = createClient(url, secretKey ?? serviceKey, {
      global: { headers: { Authorization: `Bearer ${serviceKey}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: isAdmin, error: adminError } = await admin.rpc("admin_is_user", { p_user_id: authData.user.id });
    if (adminError || isAdmin !== true) return json({ error: "Administrator access required" }, 403);
    const now = Date.now();
    const since = new Date(now - 30 * 86400000).toISOString();
    const { data, error } = await admin.from("admin_audit_log")
      .select("details,created_at").eq("action", "baran_ai_usage").gte("created_at", since).order("created_at", { ascending: false }).limit(5000);
    if (error) {
      console.error("baran-ai-usage-stats: query failed", error.message);
      return json({ error: "تعذر قراءة إحصائيات الاستخدام من سجل الإدارة." }, 500);
    }
    const rows = data ?? [];
    const openai = rows.filter((x: any) => x.details?.route === "openai").length;
    const offline = rows.filter((x: any) => x.details?.route === "offline").length;
    const recent = rows.filter((x: any) => new Date(x.created_at).getTime() >= now - 86400000);
    const openai24h = recent.filter((x: any) => x.details?.route === "openai").length;
    const offline24h = recent.filter((x: any) => x.details?.route === "offline").length;
    const total = openai + offline;
    const tokenRows = rows.filter((x: any) => x.details?.route === "openai" && x.details?.usage_status === "succeeded");
    const tokensInput = tokenRows.reduce((sum: number, x: any) => sum + Number(x.details?.input_tokens || 0), 0);
    const tokensOutput = tokenRows.reduce((sum: number, x: any) => sum + Number(x.details?.output_tokens || 0), 0);
    const tokensTotal = tokenRows.reduce((sum: number, x: any) => sum + Number(x.details?.total_tokens || 0), 0);
    const tokenDataRecords = tokenRows.filter((x: any) => x.details?.total_tokens != null).length;
    return json({
      period_days: 30, openai_attempts: openai, offline_reports: offline,
      openai_attempts_24h: openai24h, offline_reports_24h: offline24h,
      direct_route_percent: total ? Math.round(offline / total * 100) : 0,
      total_recorded: total, records_scanned: rows.length,
      openai_successful_with_token_data: tokenDataRecords,
      openai_input_tokens: tokensInput, openai_output_tokens: tokensOutput, openai_total_tokens: tokensTotal,
      checked_at: new Date().toISOString(),
      note: "عداد مجاني من سجل قاعدة البيانات؛ التقارير المباشرة لا تستدعي OpenAI. الرموز متاحة للطلبات الجديدة فقط. لا يتم احتساب تكلفة بالدولار ولا إجراء أي استدعاء إضافي."
    });
  } catch (error) {
    console.error("baran-ai-usage-stats: request failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "حدث خطأ داخلي أثناء تحميل الإحصائيات." }, 500);
  }
});