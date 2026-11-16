import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGIN = "https://eyadooon-cmyk.github.io";
const BASE = "https://api.syrimarket.com/client/api/v1";
const headers = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

async function upstream(path: string, token: string, method = "GET", payload?: unknown) {
  const response = await fetch(BASE + path, {
    method,
    headers: {
      "Authorization": "Bearer " + token,
      "Accept": "application/json",
      ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    signal: AbortSignal.timeout(20000),
  });
  const raw = await response.text();
  let data: unknown;
  try { data = raw ? JSON.parse(raw) : {}; }
  catch { data = { unparsed_response: raw.slice(0, 2000) }; }
  return { ok: response.ok, status: response.status, data };
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supplierToken = Deno.env.get("SYRIAMARKET_API_TOKEN");
    if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Server configuration incomplete" }, 500);
    if (!supplierToken) return json({ error: "SYRIAMARKET_API_TOKEN is not configured in Edge Function secrets" }, 503);

    const authorization = req.headers.get("Authorization") ?? "";
    const jwt = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!jwt) return json({ error: "Authentication required" }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser(jwt);
    if (authError || !authData.user) return json({ error: "Invalid session" }, 401);

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: isAdmin, error: adminError } = await admin.rpc("admin_is_user", {
      p_user_id: authData.user.id,
    });
    if (adminError || isAdmin !== true) return json({ error: "Administrator access required" }, 403);

    let body: any;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
    const action = body?.action;
    const routes: Record<string, string> = {
      profile: "/profile",
      products: "/catalog/products",
      categories: "/catalog/categories/0",
      docs: "/docs",
      openapi: "/openapi.json",
    };
    let result;
    if (typeof action === "string" && routes[action]) {
      result = await upstream(routes[action], supplierToken);
    } else if (action === "quote") {
      const payload = body?.quote_payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return json({ error: "quote_payload object is required" }, 400);
      }
      const productId = payload.product_id;
      const qty = Number(payload.qty);
      if (!(typeof productId === "string" || (typeof productId === "number" && Number.isFinite(productId))) ||
          !Number.isFinite(qty) || qty <= 0 || !payload.params || typeof payload.params !== "object" ||
          Array.isArray(payload.params)) {
        return json({ error: "Quote requires product_id, positive qty, and params object" }, 400);
      }
      result = await upstream("/financial/quote", supplierToken, "POST", payload);
    } else {
      return json({ error: "Allowed actions: profile, products, categories, docs, openapi, quote" }, 400);
    }

    if (!result.ok) {
      console.error("Syria Market API error", action, result.status);
      return json({
        success: false,
        provider: "Syria Market",
        action,
        upstream_status: result.status,
        result: result.data,
      }, 502);
    }
    return json({
      success: true,
      provider: "Syria Market",
      action,
      fetched_at: new Date().toISOString(),
      data: result.data,
      note: action === "quote"
        ? "Quote only. No order was created and no supplier balance was charged."
        : "Read-only supplier request. No order was created.",
    });
  } catch (error) {
    console.error("Syria Market connector error", error instanceof Error ? error.message : "unknown");
    return json({ error: "Unable to contact Syria Market at this time" }, 500);
  }
});
