import { createClient } from "npm:@supabase/supabase-js@2";

const OWNER_ID = "7c6f69ed-7786-43ce-b340-78c4c1f9a4d7";
const ORIGIN = "https://eyadooon-cmyk.github.io";
const headers = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}
function readKeyObject(name: string): string | undefined {
  const raw = Deno.env.get(name);
  if (!raw) return undefined;
  try { return JSON.parse(raw).default; } catch { return undefined; }
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
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? readKeyObject("SUPABASE_PUBLISHABLE_KEYS");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const secretKey = readKeyObject("SUPABASE_SECRET_KEYS");
    if (!url || !anonKey || !serviceKey) return json({ error: "Server configuration is incomplete" }, 500);

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!token) return json({ error: "Authentication required" }, 401);

    const authClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) return json({ error: "Invalid session" }, 401);

    const db = createClient(url, secretKey ?? serviceKey, {
      global: { headers: { Authorization: `Bearer ${serviceKey}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let isOwner = user.id === OWNER_ID;
    let isModerator = false;
    if (!isOwner) {
      const { data: role, error: roleError } = await db
        .from("baran_staff_roles")
        .select("role,is_active")
        .eq("user_id", user.id)
        .eq("role", "moderator")
        .eq("is_active", true)
        .maybeSingle();
      if (roleError) {
        console.error("staff role lookup failed", roleError.message);
        return json({ error: "تعذر التحقق من صلاحية المشرفة." }, 500);
      }
      isModerator = !!role;
    }
    if (!isOwner && !isModerator) return json({ error: "Staff access required" }, 403);

    let body: any;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
    if (!body || typeof body.action !== "string") return json({ error: "Invalid request" }, 400);

    if (["staff_find_user", "staff_list", "staff_set_moderator"].includes(body.action) && !isOwner) {
      return json({ error: "Owner access required" }, 403);
    }

    if (body.action === "staff_find_user") {
      const email = typeof body.email === "string" ? body.email.trim() : "";
      if (email.length < 5 || email.length > 254) return json({ error: "البريد الإلكتروني غير صالح." }, 400);
      const { data, error } = await db.rpc("baran_staff_find_user_internal", {
        p_actor_id: user.id,
        p_email: email,
      });
      if (error) {
        console.error("staff user lookup failed", error.message);
        return json({ error: "تعذر البحث عن الحساب." }, 502);
      }
      return json({ result: data });
    }

    if (body.action === "staff_list") {
      const { data, error } = await db.rpc("baran_staff_list_internal", {
        p_actor_id: user.id,
      });
      if (error) {
        console.error("staff list failed", error.message);
        return json({ error: "تعذر تحميل قائمة المشرفين." }, 502);
      }
      return json({ result: data ?? [] });
    }

    if (body.action === "staff_set_moderator") {
      const email = typeof body.email === "string" ? body.email.trim() : "";
      if (email.length < 5 || email.length > 254 || typeof body.enabled !== "boolean") {
        return json({ error: "بيانات تعيين المشرف غير صحيحة." }, 400);
      }
      const { data, error } = await db.rpc("baran_staff_set_moderator_internal", {
        p_actor_id: user.id,
        p_email: email,
        p_enabled: body.enabled,
      });
      if (error) {
        console.error("staff role update failed", error.message);
        return json({ error: "تعذر تحديث صلاحية المشرف." }, 400);
      }
      return json({ result: data });
    }

    if (body.action === "my_tasks") {
      if (!isModerator) return json({ error: "Moderator access required" }, 403);
      const { data, error } = await db.from("baran_admin_work_plan")
        .select("id,task_code,title,area,priority,evidence,impact,next_step,success_criteria,status,assigned_to,moderator_note,moderator_updated_at,updated_at,created_at")
        .eq("assigned_to", user.id)
        .order("priority", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) {
        console.error("moderator tasks read failed", error.message);
        return json({ error: "تعذر تحميل المهام المسندة للمشرفة." }, 502);
      }
      return json({ role: "moderator", tasks: data ?? [], generated_at: new Date().toISOString() });
    }

    if (body.action === "update_my_task") {
      if (!isModerator) return json({ error: "Moderator access required" }, 403);
      const taskId = typeof body.task_id === "string" ? body.task_id : "";
      const expected = typeof body.expected_status === "string" ? body.expected_status : "";
      const next = typeof body.new_status === "string" ? body.new_status : "";
      const note = typeof body.note === "string" ? body.note.trim() : "";
      const allowed = ["in_progress", "blocked", "completed"];
      if (!/^[0-9a-f-]{36}$/i.test(taskId) || !["new","in_review","in_progress","blocked","completed"].includes(expected) || !allowed.includes(next) || note.length > 1000) {
        return json({ error: "بيانات تحديث المهمة غير صالحة." }, 400);
      }
      if (expected === "completed") return json({ error: "المهمة المكتملة لا يمكن تعديلها من حساب المشرفة." }, 409);
      const { data, error } = await db.from("baran_admin_work_plan")
        .update({
          status: next,
          moderator_note: note || null,
          moderator_updated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          updated_by: user.id,
          completed_at: next === "completed" ? new Date().toISOString() : null
        })
        .eq("id", taskId)
        .eq("assigned_to", user.id)
        .eq("status", expected)
        .select("id,task_code,title,status,moderator_note,moderator_updated_at,updated_at")
        .maybeSingle();
      if (error) {
        console.error("moderator task update failed", error.message);
        return json({ error: "تعذر تحديث المهمة. حدّث القائمة وتأكد من حالتها." }, 502);
      }
      if (!data) return json({ error: "المهمة غير مسندة لهذا الحساب أو تغيرت حالتها. حدّث القائمة." }, 409);
      const { error: auditError } = await db.from("admin_audit_log").insert({
        admin_id: user.id,
        action: "moderator_task_updated",
        entity_type: "baran_admin_work_plan",
        entity_id: data.id,
        details: { task_code: data.task_code, new_status: next, note_length: note.length }
      });
      if (auditError) console.error("moderator task audit log failed", auditError.message);
      return json({ success: true, task: data, message: "تم تحديث المهمة وتسجيل العملية." });
    }

    if (body.action === "dashboard") {
      const [ticketsResult, ordersResult, profilesResult] = await Promise.all([
        db.from("customer_feedback")
          .select("id,ticket_code,user_id,subject,message,status,admin_reply,created_at,updated_at,order_id")
          .eq("feedback_type", "support")
          .order("created_at", { ascending: false })
          .limit(100),
        db.from("orders")
          .select("id,user_id,product_code,player_id,quantity,status,created_at")
          .order("created_at", { ascending: false })
          .limit(100),
        db.from("profiles")
          .select("id,full_name,member_code,created_at")
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      if (ticketsResult.error || ordersResult.error || profilesResult.error) {
        console.error("staff dashboard read failed", {
          tickets: ticketsResult.error?.message,
          orders: ordersResult.error?.message,
          profiles: profilesResult.error?.message,
        });
        return json({ error: "تعذر تحميل بيانات لوحة المشرفة." }, 502);
      }
      return json({
        role: isOwner ? "owner" : "moderator",
        tickets: ticketsResult.data ?? [],
        orders: ordersResult.data ?? [],
        customers: profilesResult.data ?? [],
        generated_at: new Date().toISOString(),
        limits: { tickets: 100, orders: 100, customers: 100 },
      });
    }

    if (body.action === "reply_ticket") {
      const ticketCode = typeof body.ticket_code === "string" ? body.ticket_code.trim() : "";
      const reply = typeof body.reply === "string" ? body.reply.trim() : "";
      if (!/^BG-[A-Za-z0-9-]{6,40}$/.test(ticketCode)) return json({ error: "رقم التذكرة غير صالح." }, 400);
      if (reply.length < 2 || reply.length > 2000) return json({ error: "الرد يجب أن يكون بين حرفين و2000 حرف." }, 400);

      const { data: ticket, error: ticketError } = await db
        .from("customer_feedback")
        .select("id,ticket_code,user_id,subject")
        .eq("ticket_code", ticketCode)
        .eq("feedback_type", "support")
        .maybeSingle();
      if (ticketError || !ticket) return json({ error: "لم يتم العثور على تذكرة دعم بهذا الرقم." }, 404);

      const { error: updateError } = await db
        .from("customer_feedback")
        .update({ admin_reply: reply, updated_at: new Date().toISOString() })
        .eq("id", ticket.id)
        .eq("feedback_type", "support");
      if (updateError) {
        console.error("staff ticket reply failed", updateError.message);
        return json({ error: "تعذر حفظ الرد على التذكرة." }, 502);
      }

      const { error: auditError } = await db.from("admin_audit_log").insert({
        admin_id: user.id,
        action: "staff_ticket_reply",
        entity_type: "support_ticket",
        entity_id: ticket.id,
        details: { ticket_code: ticket.ticket_code, role: isOwner ? "owner" : "moderator" },
      });
      if (auditError) console.error("staff reply audit log failed", auditError.message);

      return json({ success: true, ticket_code: ticket.ticket_code, notification_triggered: true });
    }

    return json({ error: "Unsupported staff action" }, 400);
  } catch (error) {
    console.error("baran-staff-portal unexpected error", error);
    return json({ error: "Unexpected server error" }, 500);
  }
});