import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
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

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) return json({ error: "Server configuration is incomplete" }, 500);

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return json({ error: "Authentication required" }, 401);

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) return json({ error: "Invalid session" }, 401);

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const body = await req.json().catch(() => ({})) as { action?: string; session_id?: string };
    const action = String(body.action || "");

    if (action === "heartbeat") {
      const sessionId = String(body.session_id || "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
        return json({ error: "Invalid session identifier" }, 400);
      }
      const { error } = await admin.from("customer_presence").upsert({
        user_id: user.id,
        session_id: sessionId,
        last_seen_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      if (error) {
        console.error("customer presence heartbeat failed", error.message);
        return json({ error: "تعذر تحديث حالة الاتصال." }, 500);
      }
      return json({ success: true, last_seen_at: new Date().toISOString() });
    }

    if (action === "leave") {
      const sessionId = String(body.session_id || "");
      if (sessionId) {
        const { error } = await admin.from("customer_presence").delete()
          .eq("user_id", user.id).eq("session_id", sessionId);
        if (error) console.error("customer presence leave failed", error.message);
      }
      return json({ success: true });
    }

    if (action === "dashboard") {
      const { data: isAdmin, error: adminError } = await admin.rpc("admin_is_user", { p_user_id: user.id });
      if (adminError) {
        console.error("customer center admin check failed", adminError.message);
        return json({ error: "تعذر التحقق من صلاحيات الإدارة." }, 500);
      }
      if (isAdmin !== true) return json({ error: "Administrator access required" }, 403);

      const cutoff = new Date(Date.now() - 120_000).toISOString();
      const { data: rows, error } = await admin.from("customer_presence")
        .select("user_id,last_seen_at")
        .gte("last_seen_at", cutoff)
        .order("last_seen_at", { ascending: false })
        .limit(1000);
      if (error) {
        console.error("customer center presence query failed", error.message);
        return json({ error: "تعذر تحميل العملاء المتصلين." }, 500);
      }

      const { data: adminRows, error: adminRowsError } = await admin.from("admin_users").select("user_id");
      if (adminRowsError) {
        console.error("customer center administrator exclusion failed", adminRowsError.message);
        return json({ error: "تعذر التحقق من حسابات الإدارة." }, 500);
      }
      const adminIds = new Set((adminRows || []).map((row) => row.user_id));
      const customerRows = (rows || []).filter((row) => !adminIds.has(row.user_id));
      const ids = customerRows.map((row) => row.user_id);
      const { data: profiles, error: profileError } = ids.length
        ? await admin.from("profiles").select("id,full_name,member_code").in("id", ids)
        : { data: [], error: null };
      if (profileError) {
        console.error("customer center profile query failed", profileError.message);
        return json({ error: "تعذر تحميل بيانات العملاء المتصلين." }, 500);
      }
      const profileById = new Map((profiles || []).map((profile) => [profile.id, profile]));
      const online = customerRows.map((row) => ({
        user_id: row.user_id,
        full_name: profileById.get(row.user_id)?.full_name || "عميل",
        member_code: profileById.get(row.user_id)?.member_code || null,
        last_seen_at: row.last_seen_at,
      }));
      return json({ success: true, online, online_count: online.length, checked_at: new Date().toISOString(), stale_after_seconds: 120 });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("baran-customer-center error", error);
    return json({ error: "حدث خطأ غير متوقع في مركز العملاء." }, 500);
  }
});
