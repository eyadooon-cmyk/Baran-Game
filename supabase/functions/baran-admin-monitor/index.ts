import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGIN = "https://eyadooon-cmyk.github.io";
const headers = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

function readKeyObject(name: string): string | undefined {
  const raw = Deno.env.get(name);
  if (!raw) return undefined;
  try { return JSON.parse(raw).default; } catch { return undefined; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    const origin = req.headers.get("Origin");
    if (origin && origin !== ORIGIN) return new Response("Forbidden", { status: 403 });
    return new Response("ok", { headers });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const origin = req.headers.get("Origin");
  if (origin && origin !== ORIGIN) return json({ error: "Origin not allowed" }, 403);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? readKeyObject("SUPABASE_PUBLISHABLE_KEYS");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const secretKey = readKeyObject("SUPABASE_SECRET_KEYS");
    if (!url || !anonKey || !serviceKey) {
      return json({ error: "Server configuration is incomplete" }, 500);
    }

    const authorization = req.headers.get("Authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!token) return json({ error: "Authentication required" }, 401);

    const authClient = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) return json({ error: "Invalid session" }, 401);

    const db = createClient(url, secretKey ?? serviceKey, {
      global: { headers: { Authorization: `Bearer ${serviceKey}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: isAdmin, error: adminError } = await db.rpc("admin_is_user", {
      p_user_id: user.id,
    });
    if (adminError) {
      console.error("monitor admin check failed", adminError.message);
      return json({ error: "تعذر التحقق من صلاحية المدير." }, 500);
    }
    if (isAdmin !== true) return json({ error: "Administrator access required" }, 403);

    const { data: monitor, error: monitorError } = await db.rpc("admin_monitor_snapshot", {
      p_admin_id: user.id,
    });
    if (monitorError) {
      console.error("monitor snapshot failed", monitorError.message);
      return json({ error: "تعذر تحميل لقطة المراقبة." }, 502);
    }

    return json({
      monitor: monitor ?? {
        job: null,
        last_run: null,
        latest_check: null,
        active_alerts: [],
        active_alert_count: 0,
      },
      read_only: true,
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("baran-admin-monitor failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "حدث خطأ داخلي أثناء تحميل المراقبة." }, 500);
  }
});
