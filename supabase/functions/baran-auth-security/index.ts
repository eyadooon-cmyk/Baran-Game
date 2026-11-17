import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = "https://eyadooon-cmyk.github.io";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });
function readKeyObject(name: string): string | undefined {
  const raw = Deno.env.get(name);
  if (!raw) return undefined;
  try { return JSON.parse(raw).default; } catch { return undefined; }
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? readKeyObject("SUPABASE_SECRET_KEYS");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const publishableKey = readKeyObject("SUPABASE_PUBLISHABLE_KEYS");
    if (!url || !service || (!anonKey && !publishableKey)) return json({ error: "Server configuration incomplete" }, 503);
    const suppliedKey = req.headers.get("apikey") ?? "";
    const acceptedKeys = [anonKey, publishableKey].filter((key): key is string => Boolean(key));
    if (!acceptedKeys.includes(suppliedKey)) return json({ error: "Invalid API key" }, 401);
    const body = await req.json().catch(() => null) as { identifier_hash?: string } | null;
    const identifierHash = body?.identifier_hash ?? "";
    if (!/^[0-9a-f]{64}$/.test(identifierHash)) return json({ error: "Invalid telemetry payload" }, 400);
    const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const ipHash = await sha256(forwarded);
    const admin = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.rpc("baran_record_login_failure", {
      p_identifier_hash: identifierHash,
      p_ip_hash: ipHash,
      p_user_agent: req.headers.get("user-agent")?.slice(0, 250) ?? "",
    });
    if (error) {
      console.error("baran-auth-security telemetry failed", error.message);
      return json({ error: "Unable to record security event" }, 500);
    }
    return json({ recorded: data?.accepted === true, rate_limited: data?.rate_limited === true });
  } catch (error) {
    console.error("baran-auth-security failed", error instanceof Error ? error.message : String(error));
    return json({ error: "Unable to process security event" }, 500);
  }
});
