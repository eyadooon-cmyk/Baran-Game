import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://baran-game.pages.dev",
  "https://eyadooon-cmyk.github.io",
]);
const json = (body: unknown, status = 200, origin = "https://baran-game.pages.dev") =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
async function signHmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

Deno.serve(async (req: Request) => {
  const originHeader = req.headers.get("Origin") ?? "";
  const origin = ALLOWED_ORIGINS.has(originHeader) ? originHeader : "https://baran-game.pages.dev";
  if (req.method === "OPTIONS") {
    if (originHeader && !ALLOWED_ORIGINS.has(originHeader)) return new Response("Forbidden", { status: 403 });
    return new Response("ok", { headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
    }});
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  if (originHeader && !ALLOWED_ORIGINS.has(originHeader)) return json({ error: "Origin not allowed" }, 403, origin);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const apiToken = Deno.env.get("HOMSCARD_API_TOKEN");
    const hmacSecret = Deno.env.get("HOMSCARD_HMAC_SECRET") ?? "";
    if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Server configuration incomplete" }, 503, origin);

    const authorization = req.headers.get("Authorization") ?? "";
    const jwt = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!jwt) return json({ error: "Authentication required" }, 401, origin);
    const userClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await userClient.auth.getUser(jwt);
    if (authError || !authData.user) return json({ error: "Invalid session" }, 401, origin);

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: isAdmin, error: adminError } = await admin.rpc("admin_is_user", { p_user_id: authData.user.id });
    if (adminError || isAdmin !== true) return json({ error: "Administrator access required" }, 403, origin);
    if (!apiToken) return json({ error: "HOMSCARD_API_TOKEN is not configured in Supabase secrets" }, 503, origin);

    let body: any;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400, origin); }
    const action = body?.action;
    const query = new URLSearchParams();
    let path = "";
    if (action === "profile") {
      path = "/profile.php";
    } else if (action === "products") {
      path = "/products.php";
      if (body.available_only !== false) query.set("available", "1");
      if (Array.isArray(body.products_id) && body.products_id.length) {
        const ids = body.products_id.map((v: unknown) => String(v));
        if (ids.length > 100 || ids.some((v: string) => !/^\d{1,10}$/.test(v))) {
          return json({ error: "Invalid products_id filter" }, 400, origin);
        }
        query.set("products_id", ids.join(","));
      }
    } else {
      return json({ error: "Allowed actions: profile, products. Order creation is intentionally disabled." }, 400, origin);
    }
    if (query.size) path += "?" + query.toString();

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const headers: Record<string, string> = { "api-token": apiToken, "Accept": "application/json" };
    if (hmacSecret) {
      const signature = await signHmac(hmacSecret, timestamp + "\nGET\n" + "/reseller" + path + "\n");
      headers["X-Timestamp"] = timestamp;
      headers["X-Signature"] = signature;
    }
    const response = await fetch("https://homscard.com/reseller" + path, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(20000),
    });
    const raw = await response.text();
    let data: any;
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: "Invalid JSON response" }; }
    if (!response.ok || data?.status !== "OK") {
      console.error("HOMSCARD_API_READ_FAILED", { action, status: response.status, code: data?.error?.code ?? null });
      return json({ success: false, provider: "HomsCard", action, upstream_status: response.status,
        error: data?.error?.message ?? "HomsCard API request failed", code: data?.error?.code ?? null }, 502, origin);
    }
    if (action === "profile") {
      const profile = data.data ?? {};
      const balance = Number(profile.balance);
      if (Number.isFinite(balance) && balance >= 0) {
        const { data: supplier } = await admin.from("suppliers").select("id")
          .eq("name", "HomsCard").maybeSingle();
        if (supplier?.id) {
          const [{ error: healthError }, { error: balanceError }] = await Promise.all([
            admin.rpc("baran_supplier_record_health_check", {
              p_supplier_id: supplier.id, p_is_healthy: true, p_http_status: response.status,
              p_error_message: null,
            }),
            admin.rpc("baran_supplier_record_balance", {
              p_supplier_id: supplier.id, p_balance: balance, p_currency: "USD",
              p_details: { source: "homscard_api_profile", discount: profile.discount ?? null },
            }),
          ]);
          if (healthError) console.error("HOMSCARD_HEALTH_RECORD_FAILED", healthError.message);
          if (balanceError) console.error("HOMSCARD_BALANCE_RECORD_FAILED", balanceError.message);
        }
      }
      return json({ success: true, provider: "HomsCard", action, data: {
        name: profile.name ?? null, email: profile.email ?? null, balance: profile.balance ?? null,
        currency: profile.currency ?? "USD", discount: profile.discount ?? null,
      }, fetched_at: new Date().toISOString() }, 200, origin);
    }
    const products = Array.isArray(data.data) ? data.data : null;
    if (!products) return json({ error: "Unexpected HomsCard products response shape" }, 502, origin);
    return json({ success: true, provider: "HomsCard", action, count: products.length,
      data: products.map((p: any) => ({
        id: p.id, name: p.name, price: p.price, category: p.category,
        available: p.available === true, product_type: p.product_type ?? null,
        qty_values: p.qty_values ?? null, params: Array.isArray(p.params) ? p.params : [],
        image: typeof p.image === "string" && p.image.startsWith("https://") ? p.image : null,
      })), fetched_at: new Date().toISOString(),
      note: "Read-only catalog request. No order was created and no balance was charged." }, 200, origin);
  } catch (error) {
    console.error("baran-homscard-connector failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "تعذر الاتصال بحمص كارد حالياً." }, 500);
  }
});
