import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGIN = "https://baran-game.pages.dev";
const headers = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

function readKeyObject(name: string): string | undefined {
  const raw = Deno.env.get(name);
  if (!raw) return undefined;
  try { return JSON.parse(raw).default; } catch { return undefined; }
}
function deviceType(value: string): "mobile" | "tablet" | "desktop" | "other" {
  if (/ipad|tablet/i.test(value)) return "tablet";
  if (/mobile|android|iphone|ipod/i.test(value)) return "mobile";
  if (/windows|macintosh|linux|x11/i.test(value)) return "desktop";
  return "other";
}
function safePath(value: unknown): string {
  if (typeof value !== "string") return "/";
  const path = value.split("?")[0].split("#")[0].slice(0, 180);
  return path.startsWith("/") ? path : "/";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? readKeyObject("SUPABASE_PUBLISHABLE_KEYS");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const secretKey = readKeyObject("SUPABASE_SECRET_KEYS");
    if (!url || !anonKey || !serviceKey) return json({ error: "Server configuration incomplete" }, 500);
    const admin = createClient(url, secretKey ?? serviceKey, {
      global: { headers: { Authorization: `Bearer ${serviceKey}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return json({ error: "Invalid request" }, 400);

    if (body.action === "track") {
      if (typeof body.session_id !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.session_id)) {
        return json({ error: "Invalid session" }, 400);
      }

      // Exclude authenticated administrators at the server, not just in browser code.
      const auth = req.headers.get("Authorization") || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (token) {
        const userClient = createClient(url, anonKey, {
          global: { headers: { Authorization: `Bearer ${token}` } },
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: authData, error: authError } = await userClient.auth.getUser(token);
        if (authError || !authData?.user) return json({ error: "Invalid session" }, 401);
        const { data: isAdmin, error: adminError } = await admin.rpc("admin_is_user", { p_user_id: authData.user.id });
        if (adminError) return json({ error: "Could not verify visitor role" }, 500);
        if (isAdmin === true) return json({ success: true, excluded: "admin" });
      }

      const page = safePath(body.page_path);
      const since = new Date(Date.now() - 30_000).toISOString();
      const { data: recent, error: recentError } = await admin.from("baran_visitor_events")
        .select("id").eq("session_id", body.session_id).eq("page_path", page).gte("created_at", since).limit(1);
      if (recentError) return json({ error: "Could not record visit" }, 500);
      if (!recent?.length) {
        const country = (req.headers.get("cf-ipcountry") || "").toUpperCase();
        const countryCode = /^[A-Z]{2}$/.test(country) && country !== "XX" ? country : null;
        const { error } = await admin.from("baran_visitor_events").insert({
          session_id: body.session_id,
          page_path: page,
          country_code: countryCode,
          device_type: deviceType(req.headers.get("user-agent") || ""),
        });
        if (error) return json({ error: "Could not record visit" }, 500);
      }
      return json({ success: true });
    }

    if (body.action === "stats") {
      const auth = req.headers.get("Authorization") || "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!token) return json({ error: "Authentication required" }, 401);
      const userClient = createClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: authData, error: authError } = await userClient.auth.getUser(token);
      if (authError || !authData?.user) return json({ error: "Invalid session" }, 401);
      const { data: isAdmin, error: adminError } = await admin.rpc("admin_is_user", { p_user_id: authData.user.id });
      if (adminError || isAdmin !== true) return json({ error: "Administrator access required" }, 403);

      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data: rows, error } = await admin.from("baran_visitor_events")
        .select("session_id,page_path,country_code,device_type,created_at")
        .gte("created_at", since).order("created_at", { ascending: false }).limit(20000);
      if (error) return json({ error: "Could not load visitor analytics" }, 500);
      const events = rows || [];
      const now = Date.now();
      const startToday = new Date(); startToday.setHours(0,0,0,0);
      const startWeek = new Date(now - 7 * 86400000);
      const unique = new Set(events.map((r) => r.session_id));
      const today = events.filter((r) => new Date(r.created_at).getTime() >= startToday.getTime());
      const week = events.filter((r) => new Date(r.created_at).getTime() >= startWeek.getTime());
      const countBy = (list: any[], key: string) => {
        const map = new Map<string, number>();
        list.forEach((r) => { const k = String(r[key] || "غير محدد"); map.set(k, (map.get(k) || 0) + 1); });
        return [...map.entries()].map(([label, count]) => ({ label, count })).sort((a,b) => b.count-a.count).slice(0,8);
      };
      const days = Array.from({length: 7}, (_,i) => {
        const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - (6-i));
        const key = d.toISOString().slice(0,10);
        return { day: key, views: week.filter((r) => new Date(r.created_at).toISOString().slice(0,10) === key).length };
      });
      return json({
        page_views_30d: events.length,
        unique_visitors_30d: unique.size,
        page_views_today: today.length,
        unique_visitors_today: new Set(today.map((r) => r.session_id)).size,
        page_views_7d: week.length,
        unique_visitors_7d: new Set(week.map((r) => r.session_id)).size,
        daily: days,
        devices: countBy(events, "device_type"),
        countries: countBy(events.filter((r) => r.country_code), "country_code"),
        pages: countBy(events, "page_path"),
        capped: events.length === 20000,
        active_now: null
      });
    }
    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("baran-visitor-analytics failed", error instanceof Error ? error.message : String(error));
    return json({ error: "Unexpected server error" }, 500);
  }
});