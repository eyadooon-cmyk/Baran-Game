import { createClient } from "npm:@supabase/supabase-js@2";

const OWNER_ID = "7c6f69ed-7786-43ce-b340-78c4c1f9a4d7";
const corsHeaders = {
  "Access-Control-Allow-Origin": "https://eyadooon-cmyk.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
function readKeyObject(name: string): string | undefined {
  const raw = Deno.env.get(name);
  if (!raw) return undefined;
  try { return JSON.parse(raw).default; } catch { return undefined; }
}

const actionAllowlist = new Set([
  "exchange_currency",
  "find_recipient",
  "get_exchange_settings",
  "submit_funding_request",
  "submit_usd_sale_request",
  "update_exchange_rates",
]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? readKeyObject("SUPABASE_PUBLISHABLE_KEYS");
    const legacyServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const secretKey = readKeyObject("SUPABASE_SECRET_KEYS");
    if (!url || !anonKey || !legacyServiceKey) {
      console.error("baran-owner-wallet: missing server configuration", {
        hasUrl: Boolean(url), hasAnonKey: Boolean(anonKey),
        hasServiceRoleJwt: Boolean(legacyServiceKey), hasSecretKey: Boolean(secretKey),
      });
      return json({ error: "Server configuration is incomplete" }, 500);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Authentication required" }, 401);
    const token = authHeader.slice(7).trim();
    if (!token) return json({ error: "Authentication required" }, 401);

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) return json({ error: "Invalid session" }, 401);
    if (user.id !== OWNER_ID) return json({ error: "هذه الخدمة متاحة لمالك المتجر فقط." }, 403);

    let body: unknown;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid request" }, 400);
    const payload = body as Record<string, unknown>;
    if (typeof payload.action !== "string" || !actionAllowlist.has(payload.action)) {
      return json({ error: "Unsupported wallet action" }, 400);
    }
    const args = payload.args === undefined ? {} : payload.args;
    if (!args || typeof args !== "object" || Array.isArray(args)) return json({ error: "Invalid action arguments" }, 400);

    const admin = createClient(url, secretKey ?? legacyServiceKey, {
      global: { headers: { Authorization: `Bearer ${legacyServiceKey}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.rpc("baran_owner_wallet_gateway", {
      p_actor_id: user.id,
      p_action: payload.action,
      p_args: args,
    });
    if (error) {
      console.error("baran-owner-wallet RPC failed", { action: payload.action, message: error.message });
      return json({ error: error.message || "Wallet operation failed" }, 400);
    }
    return json(data);
  } catch (error) {
    console.error("baran-owner-wallet unexpected error", error);
    return json({ error: "Unexpected server error" }, 500);
  }
});