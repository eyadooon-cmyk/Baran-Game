import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://eyadooon-cmyk.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
function readKeyObject(name: string): string | undefined {
  const raw = Deno.env.get(name);
  if (!raw) return undefined;
  try { return JSON.parse(raw).default; } catch { return undefined; }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? readKeyObject("SUPABASE_PUBLISHABLE_KEYS");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const secretKey = readKeyObject("SUPABASE_SECRET_KEYS");
    if (!url || !anonKey || !serviceKey || !(secretKey || serviceKey)) return json({ error: "Server configuration is incomplete" }, 500);
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return json({ error: "Authentication required" }, 401);

    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) return json({ error: "Invalid session" }, 401);

    const db = createClient(url, secretKey ?? serviceKey, { global: { headers: { Authorization: `Bearer ${serviceKey}` } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: adminFlag, error: adminErr } = await db.rpc("admin_is_user", { p_user_id: user.id });
    if (adminErr) return json({ error: "تعذر التحقق من صلاحيات الحساب." }, 500);
    const isAdmin = adminFlag === true;

    if (!isAdmin) {
      const { data: control, error: controlErr } = await db.from("customer_account_controls").select("status,banned_until").eq("user_id", user.id).maybeSingle();
      if (controlErr) return json({ error: "تعذر التحقق من حالة الحساب." }, 500);
      if (control?.status === "banned" && (!control.banned_until || new Date(control.banned_until).getTime() > Date.now())) {
        return json({ error: "هذا الحساب موقوف حالياً. تواصل مع الإدارة." }, 403);
      }
    }

    if (req.method === "GET") {
      const params = new URL(req.url).searchParams;
      if (isAdmin && params.get("action") === "customers") {
        const q = (params.get("q") || "").trim().slice(0, 80);
        let query = db.from("profiles").select("id,full_name,phone,member_code,created_at").order("created_at", { ascending: false }).limit(100);
        if (q) query = query.or(`full_name.ilike.%${q.replace(/[,%()]/g, "")}%,phone.ilike.%${q.replace(/[,%()]/g, "")}%,member_code.ilike.%${q.replace(/[,%()]/g, "")}%`);
        const { data: profiles, error } = await query;
        if (error) return json({ error: "تعذر تحميل قائمة العملاء." }, 500);
        const ids = (profiles || []).map((p) => p.id);
        const [{ data: authUsers }, { data: convs }] = await Promise.all([
          db.auth.admin.listUsers({ page: 1, perPage: 1000 }),
          ids.length ? db.from("baran_direct_conversations").select("id,customer_id,last_message,last_message_at").in("customer_id", ids) : Promise.resolve({ data: [] }),
        ]);
        const emailById = new Map((authUsers?.users || []).map((u) => [u.id, u.email || null]));
        const convByUser = new Map((convs || []).map((c) => [c.customer_id, c]));
        return json({ success: true, customers: (profiles || []).map((p) => ({ ...p, email: emailById.get(p.id) || null, conversation: convByUser.get(p.id) || null })) });
      }

      const requestedId = params.get("conversation_id");
      if (isAdmin && !requestedId) {
        const { data: convs, error } = await db.from("baran_direct_conversations").select("id,customer_id,started_by,created_at,updated_at,last_message,last_message_at").order("last_message_at", { ascending: false, nullsFirst: false }).limit(100);
        if (error) return json({ error: "تعذر تحميل المحادثات." }, 500);
        const ids = (convs || []).map((c) => c.customer_id);
        const { data: profiles } = ids.length ? await db.from("profiles").select("id,full_name,phone,member_code").in("id", ids) : { data: [] };
        const profileMap = new Map((profiles || []).map((p) => [p.id, p]));
        return json({ success: true, conversations: (convs || []).map((c) => ({ ...c, customer: profileMap.get(c.customer_id) || null })) });
      }

      let convQuery = db.from("baran_direct_conversations").select("id,customer_id,started_by,created_at,updated_at,last_message,last_message_at");
      if (requestedId && uuid.test(requestedId)) convQuery = convQuery.eq("id", requestedId);
      else if (!isAdmin) convQuery = convQuery.eq("customer_id", user.id);
      else return json({ success: true, conversation: null, messages: [] });
      const { data: conv, error: convError } = await convQuery.maybeSingle();
      if (convError) return json({ error: "تعذر تحميل المحادثة." }, 500);
      if (!conv || (!isAdmin && conv.customer_id !== user.id)) return json({ success: true, conversation: null, messages: [] });
      await db.from("baran_direct_messages").update({ read_at: new Date().toISOString() }).eq("conversation_id", conv.id).neq("sender_id", user.id).is("read_at", null);
      const { data: messages, error: msgError } = await db.from("baran_direct_messages").select("id,conversation_id,sender_id,sender_role,message,created_at,read_at").eq("conversation_id", conv.id).order("created_at", { ascending: true }).limit(300);
      if (msgError) return json({ error: "تعذر تحميل الرسائل." }, 500);
      let customer = null;
      if (isAdmin) {
        const { data: profile } = await db.from("profiles").select("full_name,phone,member_code").eq("id", conv.customer_id).maybeSingle();
        const { data: authUser } = await db.auth.admin.getUserById(conv.customer_id);
        customer = { ...profile, email: authUser?.user?.email || null };
      }
      return json({ success: true, conversation: conv, customer, messages: messages || [], is_admin: isAdmin });
    }

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "بيانات الطلب غير صالحة." }, 400); }
    if (body.action === "start") {
      if (!isAdmin) return json({ error: "بدء المحادثة متاح للإدارة فقط." }, 403);
      const customerId = typeof body.customer_id === "string" ? body.customer_id : "";
      if (!uuid.test(customerId) || customerId === user.id) return json({ error: "حدد حساب عميل صحيح." }, 400);
      const { data: target } = await db.auth.admin.getUserById(customerId);
      if (!target?.user) return json({ error: "العميل غير موجود." }, 404);
      const { data: existing } = await db.from("baran_direct_conversations").select("id").eq("customer_id", customerId).maybeSingle();
      const { data: conv, error } = await db.from("baran_direct_conversations").upsert({ customer_id: customerId, started_by: user.id }, { onConflict: "customer_id" }).select("*").single();
      if (error || !conv) return json({ error: "تعذر فتح المحادثة." }, 500);
      if (!existing) {
        const { error: noticeErr } = await db.from("baran_notifications").insert({
          recipient_id: customerId, audience: "customer", kind: "support_update",
          title: "رسالة مباشرة من إدارة باران",
          body: "بدأت الإدارة محادثة مباشرة معك. اضغط لفتح الرسائل.",
          entity_type: "direct_chat", entity_id: conv.id
        });
        if (noticeErr) console.error("direct-chat start notification failed", noticeErr.message);
      }
      return json({ success: true, conversation: conv });
    }

    if (body.action === "send") {
      const conversationId = typeof body.conversation_id === "string" ? body.conversation_id : "";
      const message = typeof body.message === "string" ? body.message.trim() : "";
      if (!uuid.test(conversationId) || message.length < 1 || message.length > 2000) return json({ error: "اكتب رسالة من 1 إلى 2000 حرف." }, 400);
      const { data: conv, error: convError } = await db.from("baran_direct_conversations").select("id,customer_id").eq("id", conversationId).maybeSingle();
      if (convError || !conv || (!isAdmin && conv.customer_id !== user.id)) return json({ error: "المحادثة غير موجودة أو لا تملك صلاحية الوصول." }, 404);
      const { data: inserted, error: insertError } = await db.from("baran_direct_messages").insert({
        conversation_id: conv.id, sender_id: user.id, sender_role: isAdmin ? "admin" : "customer", message
      }).select("id,conversation_id,sender_id,sender_role,message,created_at,read_at").single();
      if (insertError || !inserted) return json({ error: "تعذر إرسال الرسالة." }, 500);
      await db.from("baran_direct_conversations").update({ last_message: message.slice(0, 240), last_message_at: inserted.created_at, updated_at: inserted.created_at }).eq("id", conv.id);
      const recipients: Array<{ recipient_id: string; audience: string }> = [];
      if (isAdmin) recipients.push({ recipient_id: conv.customer_id, audience: "customer" });
      else {
        const { data: admins } = await db.from("admin_users").select("user_id");
        for (const a of admins || []) if (a.user_id !== user.id) recipients.push({ recipient_id: a.user_id, audience: "admin" });
      }
      if (recipients.length) {
        const title = isAdmin ? "رسالة جديدة من إدارة باران" : "رسالة جديدة من عميل";
        const bodyText = message.length > 430 ? message.slice(0, 427) + "..." : message;
        const { error: noticeErr } = await db.from("baran_notifications").insert(recipients.map((r) => ({
          ...r, kind: "support_update", title, body: bodyText, entity_type: "direct_chat", entity_id: conv.id
        })));
        if (noticeErr) console.error("direct-chat message notification failed", noticeErr.message);
      }
      return json({ success: true, message: inserted });
    }
    return json({ error: "عملية غير معروفة." }, 400);
  } catch (error) {
    console.error("baran-direct-chat error", error);
    return json({ error: "حدث خطأ غير متوقع في المحادثات المباشرة." }, 500);
  }
});