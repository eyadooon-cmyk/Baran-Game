import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = "https://eyadooon-cmyk.github.io";
const corsHeaders = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
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
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? readKeyObject("SUPABASE_PUBLISHABLE_KEYS");
    const legacyServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const secretKey = readKeyObject("SUPABASE_SECRET_KEYS");
    if (!url || !anonKey || !legacyServiceKey) return json({ error: "Server configuration is incomplete" }, 500);
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return json({ error: "Authentication required" }, 401);
    const userClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) return json({ error: "Invalid session" }, 401);
    const admin = createClient(url, secretKey ?? legacyServiceKey, {
      global: { headers: { Authorization: `Bearer ${legacyServiceKey}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: isAdmin, error: adminError } = await admin.rpc("admin_is_user", { p_user_id: user.id });
    if (adminError) return json({ error: "تعذر التحقق من صلاحية المدير." }, 500);
    if (isAdmin !== true) return json({ error: "Administrator access required" }, 403);
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
    if (body?.action === "list") {
      const { data, error } = await admin.from("baran_admin_work_plan")
        .select("id,task_code,title,area,priority,evidence,impact,next_step,success_criteria,status,requires_approval,approval_note,assigned_to,moderator_note,created_at,updated_at,completed_at")
        .order("priority", { ascending: true }).order("created_at", { ascending: true });
      if (error) return json({ error: "تعذر تحميل خطة العمل." }, 502);
      const { data: roleRows, error: roleError } = await admin.from("baran_staff_roles")
        .select("user_id").eq("role", "moderator").eq("is_active", true);
      if (roleError) return json({ error: "تعذر تحميل قائمة المشرفات النشطات." }, 502);
      const ids = (roleRows ?? []).map((row: any) => row.user_id);
      let moderators: any[] = [];
      if (ids.length) {
        const { data: profiles, error: profileError } = await admin.from("profiles")
          .select("id,full_name,member_code").in("id", ids);
        if (profileError) return json({ error: "تعذر تحميل بيانات المشرفات." }, 502);
        moderators = (profiles ?? []).map((profile: any) => ({ user_id: profile.id, full_name: profile.full_name, member_code: profile.member_code }));
      }
      return json({ tasks: data ?? [], moderators, read_only: true, checked_at: new Date().toISOString() });
    }
    if (body?.action === "assign_task") {
      if (body.confirm !== true) return json({ error: "تأكيد المالك مطلوب لإسناد المهمة." }, 400);
      if (typeof body.task_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.task_id)) return json({ error: "معرّف المهمة غير صالح." }, 400);
      const assignedTo = body.assigned_to === null || body.assigned_to === "" ? null : body.assigned_to;
      if (assignedTo !== null && (typeof assignedTo !== "string" || !/^[0-9a-f-]{36}$/i.test(assignedTo))) return json({ error: "حساب المشرفة غير صالح." }, 400);
      if (assignedTo !== null) {
        const { data: role, error: roleError } = await admin.from("baran_staff_roles")
          .select("user_id").eq("user_id", assignedTo).eq("role", "moderator").eq("is_active", true).maybeSingle();
        if (roleError) return json({ error: "تعذر التحقق من صلاحية المشرفة." }, 502);
        if (!role) return json({ error: "الحساب المحدد ليس مشرفة نشطة." }, 403);
      }
      const { data: previous, error: previousError } = await admin.from("baran_admin_work_plan")
        .select("id,task_code,title,assigned_to").eq("id", body.task_id).maybeSingle();
      if (previousError) return json({ error: "تعذر قراءة إسناد المهمة الحالي." }, 502);
      if (!previous) return json({ error: "المهمة غير موجودة." }, 404);
      if (previous.assigned_to === assignedTo) return json({ task: previous, message: assignedTo ? "المهمة مسندة بالفعل لهذه المشرفة." : "المهمة غير مسندة أصلاً." });
      const { data: task, error: updateError } = await admin.from("baran_admin_work_plan")
        .update({ assigned_to: assignedTo, updated_by: user.id, updated_at: new Date().toISOString() })
        .eq("id", body.task_id).select("id,task_code,title,assigned_to").maybeSingle();
      if (updateError) return json({ error: "تعذر تحديث إسناد المهمة." }, 502);
      if (!task) return json({ error: "المهمة غير موجودة." }, 404);
      const action = assignedTo === null ? "admin_work_plan_unassigned" : "admin_work_plan_assigned";
      const { error: auditError } = await admin.from("admin_audit_log").insert({
        admin_id: user.id, action, entity_type: "baran_admin_work_plan",
        entity_id: task.id, details: { task_code: task.task_code, previous_assigned_to: previous.assigned_to, assigned_to: task.assigned_to }
      });
      if (auditError) console.error("work plan assignment audit failed", auditError.message);
      return json({ task, message: assignedTo === null ? "تم إلغاء إسناد المهمة وتسجيل العملية." : "تم إسناد المهمة للمشرفة وتسجيل العملية." });
    }
    if (body?.action === "status_update") {
      const validStatuses = ["new", "in_review", "in_progress", "blocked", "completed"];
      if (body.confirm !== true) return json({ error: "تأكيد المدير مطلوب لتحديث حالة المهمة." }, 400);
      if (typeof body.task_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.task_id)) return json({ error: "معرّف المهمة غير صالح." }, 400);
      if (!validStatuses.includes(body.expected_status) || !validStatuses.includes(body.new_status)) return json({ error: "حالة المهمة غير صالحة." }, 400);
      if (body.expected_status === body.new_status) return json({ error: "الحالة المختارة مطابقة للحالة الحالية." }, 400);
      const { data, error } = await admin.rpc("admin_update_work_plan_status", {
        p_task_id: body.task_id,
        p_expected_status: body.expected_status,
        p_new_status: body.new_status,
        p_admin_id: user.id,
        p_approval_note: typeof body.approval_note === "string" ? body.approval_note.slice(0, 500) : null,
      });
      if (error) {
        console.error("work plan status update failed", error.message);
        return json({ error: "تعذر تحديث الحالة. حدّث الصفحة وتأكد أن المهمة لم تتغير من جلسة أخرى." }, 409);
      }
      return json({ task: data, message: "تم تحديث حالة المهمة وتسجيل العملية في سجل التدقيق." });
    }
    return json({ error: "إجراء غير معروف." }, 400);
  } catch (error) {
    console.error("baran-admin-work-plan error", error);
    return json({ error: "حدث خطأ غير متوقع أثناء معالجة خطة العمل." }, 500);
  }
});