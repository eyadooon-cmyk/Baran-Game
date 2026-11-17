import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://eyadooon-cmyk.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const origin = req.headers.get("Origin");
  if (origin && origin !== "https://eyadooon-cmyk.github.io") return json({ error: "Origin not allowed" }, 403);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anon || !service) return json({ error: "Server configuration is incomplete" }, 500);

    const auth = req.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return json({ error: "Authentication required" }, 401);

    const userClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Invalid session" }, 401);

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return json({ error: "Invalid request body" }, 400);

    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    if (body.action !== "remove") {
      const { data: control, error: controlError } = await admin.from("customer_account_controls")
        .select("status,banned_until").eq("user_id", authData.user.id).maybeSingle();
      if (controlError) return json({ error: "تعذر التحقق من حالة حماية الحساب." }, 500);
      if (control?.status === "banned" &&
          (!control.banned_until || new Date(control.banned_until).getTime() > Date.now())) {
        return json({ error: "هذا الحساب موقوف حالياً. لا يمكن تفعيل الإشعارات أثناء الحظر." }, 403);
      }
    }

    // Unsubscribe requests need only the endpoint; do not require a subscription payload.
    if (body.action === "remove") {
      const endpoint = body.endpoint;
      if (typeof endpoint !== "string" || !endpoint.startsWith("https://")) {
        return json({ error: "Invalid endpoint" }, 400);
      }
      const { error: deleteError } = await admin.from("baran_push_subscriptions")
        .delete().eq("user_id", authData.user.id).eq("endpoint", endpoint);
      if (deleteError) return json({ error: "Could not remove subscription" }, 500);
      return json({ success: true, removed: true });
    }

    const sub = body.subscription;
    if (!sub || typeof sub.endpoint !== "string" || !sub.endpoint.startsWith("https://") ||
        typeof sub.keys?.p256dh !== "string" || typeof sub.keys?.auth !== "string") {
      return json({ error: "Invalid push subscription" }, 400);
    }

    const { error } = await admin.from("baran_push_subscriptions").upsert({
      user_id: authData.user.id,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      expiration_time: typeof sub.expirationTime === "number" ? sub.expirationTime : null,
      user_agent: String(req.headers.get("user-agent") || "").slice(0, 300),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,endpoint" });
    if (error) {
      console.error("push subscription save failed", error.message);
      return json({ error: "Could not save notification subscription" }, 500);
    }
    return json({ success: true });
  } catch (error) {
    console.error("push register failed", error instanceof Error ? error.message : String(error));
    return json({ error: "Unexpected server error" }, 500);
  }
});