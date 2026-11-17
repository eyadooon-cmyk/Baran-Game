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
    const legacyServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const secretKey = readKeyObject("SUPABASE_SECRET_KEYS");
    if (!url || !anonKey || !legacyServiceKey) return json({ error: "Server configuration is incomplete" }, 500);
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

    const admin = createClient(url, secretKey ?? legacyServiceKey, {
      global: { headers: { Authorization: `Bearer ${legacyServiceKey}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: isAdmin, error: adminCheckError } = await admin.rpc("admin_is_user", { p_user_id: user.id });
    if (adminCheckError) return json({ error: "Could not verify support permissions" }, 500);
    const isStaff = isAdmin === true;

    if (req.method === "GET") {
      const ticketId = new URL(req.url).searchParams.get("ticket_id") ?? "";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ticketId)) {
        return json({ error: "معرّف التذكرة غير صحيح." }, 400);
      }
      let ticketQuery = admin.from("customer_feedback")
        .select("id,user_id,feedback_type,ticket_code,subject,message,order_id,status,priority,assigned_admin_id,admin_reply,admin_read_at,created_at,updated_at")
        .eq("id", ticketId).eq("feedback_type", "support");
      if (!isStaff) ticketQuery = ticketQuery.eq("user_id", user.id);
      const { data: ticket, error: ticketError } = await ticketQuery.maybeSingle();
      if (ticketError) return json({ error: "تعذر تحميل التذكرة." }, 500);
      if (!ticket) return json({ error: "التذكرة غير موجودة أو لا تملك صلاحية الوصول إليها." }, 404);

      await admin.from("baran_support_messages").update({ read_at: new Date().toISOString() })
        .eq("feedback_id", ticket.id).is("read_at", null)
        .neq("sender_role", isStaff ? "admin" : "customer");
      const { data: messages, error: messagesError } = await admin.from("baran_support_messages")
        .select("id,feedback_id,sender_id,sender_role,message,message_type,created_at,read_at,attachment_path,attachment_name,attachment_mime,attachment_size")
        .eq("feedback_id", ticket.id).order("created_at", { ascending: true }).limit(250);
      if (messagesError) return json({ error: "تعذر تحميل سجل المحادثة." }, 500);
      const thread = await Promise.all((messages ?? []).map(async (item) => {
        if (!item.attachment_path) return item;
        const { data: signed } = await admin.storage.from("baran-support-attachments")
          .createSignedUrl(item.attachment_path, 300);
        return { ...item, attachment_url: signed?.signedUrl ?? null };
      }));
      if (!thread.some((m) => m.message_type === "ticket_opened")) {
        thread.unshift({ id: "ticket-" + ticket.id, feedback_id: ticket.id, sender_id: ticket.user_id,
          sender_role: "customer", message: ticket.message, message_type: "ticket_opened", created_at: ticket.created_at, read_at: null, attachment_path: null, attachment_name: null, attachment_mime: null, attachment_size: null, attachment_url: null });
      }
      if (ticket.admin_reply && !thread.some((m) => m.message === ticket.admin_reply)) {
        const { data: queue } = await admin.from("baran_auto_support_queue")
          .select("generated_reply,state").eq("feedback_id", ticket.id).maybeSingle();
        thread.push({ id: "legacy-" + ticket.id, feedback_id: ticket.id, sender_id: ticket.user_id,
          sender_role: queue?.state === "sent" && queue.generated_reply === ticket.admin_reply ? "assistant" : "admin",
          message: ticket.admin_reply, message_type: "message", created_at: ticket.updated_at ?? ticket.created_at, read_at: null, attachment_path: null, attachment_name: null, attachment_mime: null, attachment_size: null, attachment_url: null });
      }
      thread.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
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
      let staff: Array<{user_id:string;full_name:string|null}> = [];
      if (isStaff) {
        const { data: adminRows } = await admin.from("admin_users").select("user_id");
        const ids = (adminRows ?? []).map((row) => row.user_id);
        if (ids.length) {
          const { data: profileRows } = await admin.from("profiles").select("id,full_name").in("id", ids);
          const names = new Map((profileRows ?? []).map((row) => [row.id, row.full_name]));
          staff = ids.map((user_id) => ({ user_id, full_name: names.get(user_id) ?? null }));
        }
      }
      return json({ success: true, ticket, messages: thread, customer, is_admin: isStaff, staff });
    }

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "بيانات الطلب غير صالحة." }, 400); }
    const ticketId = typeof body.ticket_id === "string" ? body.ticket_id : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ticketId)) {
      return json({ error: "معرّف التذكرة غير صحيح." }, 400);
    }
    if (body.action === "update_ticket") {
      if (!isStaff) return json({ error: "هذه العملية متاحة لفريق الإدارة فقط." }, 403);
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.status !== undefined) {
        if (!["pending","in_progress","completed","rejected"].includes(String(body.status)))
          return json({ error: "حالة التذكرة غير صحيحة." }, 400);
        updates.status = body.status;
      }
      if (body.priority !== undefined) {
        if (!["low","normal","high","urgent"].includes(String(body.priority)))
          return json({ error: "أولوية التذكرة غير صحيحة." }, 400);
        updates.priority = body.priority;
      }
      if (body.assigned_admin_id !== undefined) {
        if (body.assigned_admin_id !== null && typeof body.assigned_admin_id !== "string")
          return json({ error: "الموظف المحدد غير صالح." }, 400);
        if (body.assigned_admin_id !== null) {
          const { data: staffMember } = await admin.from("admin_users").select("user_id")
            .eq("user_id", body.assigned_admin_id).maybeSingle();
          if (!staffMember) return json({ error: "الموظف المحدد ليس ضمن فريق الإدارة." }, 400);
        }
        updates.assigned_admin_id = body.assigned_admin_id;
      }
      const { data: updated, error: updateError } = await admin.from("customer_feedback")
        .update(updates).eq("id", ticketId).eq("feedback_type", "support")
        .select("id,status,priority,assigned_admin_id,updated_at").maybeSingle();
      if (updateError || !updated) return json({ error: "تعذر تحديث التذكرة." }, 400);
      await admin.from("admin_audit_log").insert({
        admin_id: user.id, action: "support_ticket_update", entity_type: "customer_feedback",
        entity_id: ticketId, details: { status: updated.status, priority: updated.priority, assigned_admin_id: updated.assigned_admin_id },
      });
      return json({ success: true, ticket: updated });
    }
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const attachmentPath = typeof body.attachment_path === "string" ? body.attachment_path : "";
    const attachmentName = typeof body.attachment_name === "string" ? body.attachment_name.trim().slice(0,180) : "";
    const attachmentMime = typeof body.attachment_mime === "string" ? body.attachment_mime : "";
    const attachmentSize = Number(body.attachment_size || 0);
    const hasAttachment = !!attachmentPath;
    if (!message && !hasAttachment) return json({ error: "اكتب رسالة أو أرفق ملفاً." }, 400);
    if (message.length > 2000) return json({ error: "الرسالة طويلة جداً." }, 400);
    if (hasAttachment) {
      const allowed = ["image/jpeg","image/png","image/webp","application/pdf"];
      const expectedPrefix = ticketId + "/" + user.id + "/";
      if (!attachmentPath.startsWith(expectedPrefix) || attachmentPath.includes("..") ||
          !attachmentName || !allowed.includes(attachmentMime) ||
          !Number.isInteger(attachmentSize) || attachmentSize < 1 || attachmentSize > 10485760) {
        return json({ error: "بيانات المرفق غير صالحة أو لا تملك صلاحية استخدامه." }, 400);
      }
      const { data: objectSigned, error: objectError } = await admin.storage.from("baran-support-attachments")
        .createSignedUrl(attachmentPath, 60);
      if (objectError || !objectSigned?.signedUrl) return json({ error: "تعذر التحقق من الملف المرفق." }, 400);
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ticketId)) {
      return json({ error: "معرّف التذكرة غير صحيح." }, 400);
    }
    if (message.length > 2000) return json({ error: "الرسالة يجب ألا تتجاوز 2000 حرف." }, 400);
    let ticketQuery = admin.from("customer_feedback").select("id,user_id,ticket_code,status,feedback_type")
      .eq("id", ticketId).eq("feedback_type", "support");
    if (!isStaff) ticketQuery = ticketQuery.eq("user_id", user.id);
    const { data: ticket, error: ticketError } = await ticketQuery.maybeSingle();
    if (ticketError) return json({ error: "تعذر التحقق من التذكرة." }, 500);
    if (!ticket) return json({ error: "التذكرة غير موجودة أو لا تملك صلاحية الوصول إليها." }, 404);

    const { data: inserted, error: insertError } = await admin.from("baran_support_messages").insert({
      feedback_id: ticket.id, sender_id: user.id, sender_role: isStaff ? "admin" : "customer",
      message: message || "أرفق ملفاً", message_type: "message",
      attachment_path: hasAttachment ? attachmentPath : null,
      attachment_name: hasAttachment ? attachmentName : null,
      attachment_mime: hasAttachment ? attachmentMime : null,
      attachment_size: hasAttachment ? attachmentSize : null,
    }).select("id,feedback_id,sender_id,sender_role,message,message_type,created_at,read_at,attachment_path,attachment_name,attachment_mime,attachment_size").single();
    if (insertError) {
      console.error("baran-support-center: message insert failed", insertError.message);
      return json({ error: "تعذر إرسال الرسالة. حاول مرة أخرى." }, 500);
    }

    const now = new Date().toISOString();
    const { error: ticketUpdateError } = await admin.from("customer_feedback").update({
      updated_at: now,
      ...(isStaff ? { admin_reply: message || "أرفق ملفاً", admin_read_at: now,
        status: body.status === "pending" || body.status === "in_progress" || body.status === "completed" || body.status === "rejected"
          ? body.status : "in_progress" }
        : { admin_read_at: null, ...(ticket.status === "completed" || ticket.status === "rejected" ? { status: "in_progress" } : {}) }),
    }).eq("id", ticket.id);
    if (ticketUpdateError) console.error("baran-support-center: ticket activity update failed", ticketUpdateError.message);

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
