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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? readKeyObject("SUPABASE_PUBLISHABLE_KEYS");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? readKeyObject("SUPABASE_SECRET_KEYS");
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

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: isAdmin, error: adminCheckError } = await admin.rpc("admin_is_user", { p_user_id: user.id });
    if (adminCheckError) return json({ error: "Could not verify support permissions" }, 500);
    const isStaff = isAdmin === true;

    if (req.method === "GET") {
      const ticketId = new URL(req.url).searchParams.get("ticket_id") ?? "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ticketId)) {
        return json({ error: "معرّف التذكرة غير صحيح." }, 400);
      }
      let ticketQuery = admin.from("customer_feedback")
        .select("id,user_id,feedback_type,ticket_code,subject,message,order_id,status,admin_reply,created_at,updated_at")
        .eq("id", ticketId).eq("feedback_type", "support");
      if (!isStaff) ticketQuery = ticketQuery.eq("user_id", user.id);
      const { data: ticket, error: ticketError } = await ticketQuery.maybeSingle();
      if (ticketError) return json({ error: "تعذر تحميل التذكرة." }, 500);
      if (!ticket) return json({ error: "التذكرة غير موجودة أو لا تملك صلاحية الوصول إليها." }, 404);

      const { data: messages, error: messagesError } = await admin.from("baran_support_messages")
        .select("id,feedback_id,sender_id,sender_role,message,message_type,created_at")
        .eq("feedback_id", ticket.id).order("created_at", { ascending: true }).limit(250);
      if (messagesError) return json({ error: "تعذر تحميل سجل المحادثة." }, 500);
      const thread = [...(messages ?? [])];
      if (!thread.some((m) => m.message_type === "ticket_opened")) {
        thread.unshift({ id: "ticket-" + ticket.id, feedback_id: ticket.id, sender_id: ticket.user_id,
          sender_role: "customer", message: ticket.message, message_type: "ticket_opened", created_at: ticket.created_at });
      }
      if (ticket.admin_reply && !thread.some((m) => m.message === ticket.admin_reply)) {
        const { data: queue } = await admin.from("baran_auto_support_queue")
          .select("generated_reply,state").eq("feedback_id", ticket.id).maybeSingle();
        thread.push({ id: "legacy-" + ticket.id, feedback_id: ticket.id, sender_id: user.id,
          sender_role: queue?.state === "sent" && queue.generated_reply === ticket.admin_reply ? "assistant" : "admin",
          message: ticket.admin_reply, message_type: "message", created_at: ticket.updated_at ?? ticket.created_at });
      }
      if (isStaff && !ticket.admin_read_at) {
        await admin.from("customer_feedback").update({ admin_read_at: new Date().toISOString() }).eq("id", ticket.id);
      }
      let customer = null;
      if (isStaff) {
        const [{ data: profile }, { data: authUser }] = await Promise.all([
          admin.from("profiles").select("full_name,phone,member_code").eq("id", ticket.user_id).maybeSingle(),
          admin.auth.admin.getUserById(ticket.user_id),
        ]);
        customer = { ...profile, email: authUser?.user?.email ?? null };
      }
      return json({ success: true, ticket, messages: thread, customer, is_admin: isStaff });
    }

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "بيانات الطلب غير صالحة." }, 400); }
    const ticketId = typeof body.ticket_id === "string" ? body.ticket_id : "";
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ticketId)) {
      return json({ error: "معرّف التذكرة غير صحيح." }, 400);
    }
    if (message.length < 1 || message.length > 2000) return json({ error: "الرسالة يجب أن تكون بين حرف و2000 حرف." }, 400);
    let ticketQuery = admin.from("customer_feedback").select("id,user_id,ticket_code,status,feedback_type")
      .eq("id", ticketId).eq("feedback_type", "support");
    if (!isStaff) ticketQuery = ticketQuery.eq("user_id", user.id);
    const { data: ticket, error: ticketError } = await ticketQuery.maybeSingle();
    if (ticketError) return json({ error: "تعذر التحقق من التذكرة." }, 500);
    if (!ticket) return json({ error: "التذكرة غير موجودة أو لا تملك صلاحية الوصول إليها." }, 404);

    const { data: inserted, error: insertError } = await admin.from("baran_support_messages").insert({
      feedback_id: ticket.id, sender_id: user.id, sender_role: isStaff ? "admin" : "customer",
      message, message_type: "message",
    }).select("id,feedback_id,sender_id,sender_role,message,message_type,created_at").single();
    if (insertError) {
      console.error("baran-support-center: message insert failed", insertError.message);
      return json({ error: "تعذر إرسال الرسالة. حاول مرة أخرى." }, 500);
    }

    const now = new Date().toISOString();
    await admin.from("customer_feedback").update({
      updated_at: now,
      ...(isStaff ? { admin_reply: message, admin_read_at: now,
        status: body.status === "pending" || body.status === "in_progress" || body.status === "completed" || body.status === "rejected"
          ? body.status : "in_progress" } : {}),
    }).eq("id", ticket.id);

    if (isStaff) {
      const { error: notifyError } = await admin.from("baran_notifications").insert({
        recipient_id: ticket.user_id, audience: "customer", kind: "support_update",
        title: "رد جديد من فريق دعم Baran Game",
        body: (ticket.ticket_code || "تذكرة الدعم") + " — لديك رسالة جديدة في محادثة الدعم.",
        entity_type: "customer_feedback", entity_id: ticket.id,
      });
      if (notifyError) console.error("baran-support-center: customer notification failed", notifyError.message);
    } else {
      const { data: admins, error: adminsError } = await admin.from("admin_users").select("user_id");
      if (adminsError) console.error("baran-support-center: admin recipients failed", adminsError.message);
      else if (admins?.length) {
        const { error: notifyError } = await admin.from("baran_notifications").insert(admins
          .filter((a) => a.user_id !== user.id).map((a) => ({
            recipient_id: a.user_id, audience: "admin", kind: "support_new",
            title: "رسالة جديدة من زبون",
            body: (ticket.ticket_code || "تذكرة الدعم") + " — وصلت رسالة جديدة في المحادثة.",
            entity_type: "customer_feedback", entity_id: ticket.id,
          })));
        if (notifyError) console.error("baran-support-center: admin notification failed", notifyError.message);
      }
    }
    return json({ success: true, message: inserted });
  } catch (error) {
    console.error("baran-support-center error", error instanceof Error ? error.message : "unknown");
    return json({ error: "حدث خطأ غير متوقع في مركز التواصل." }, 500);
  }
});
