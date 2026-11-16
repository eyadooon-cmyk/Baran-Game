import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://eyadooon-cmyk.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function optionalAmount(value: unknown, max: number): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) return undefined;
  return value;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) return json({ error: "إعدادات الخدمة غير مكتملة." }, 500);

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return json({ error: "يلزم تسجيل الدخول." }, 401);

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) return json({ error: "جلسة غير صالحة." }, 401);

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: isAdmin, error: adminError } = await admin.rpc("admin_is_user", { p_user_id: user.id });
    if (adminError || isAdmin !== true) return json({ error: "هذه الصفحة مخصصة لمدير المتجر." }, 403);

    if (req.method === "GET") {
      const [{ data: products, error: productsError }, { data: orders, error: ordersError }] = await Promise.all([
        admin.from("leo_manual_products").select("*").order("category_id").order("group_id").order("product_name"),
        admin.from("leo_manual_orders").select("id,user_id,product_code,player_id,product_name_snapshot,customer_price_usd,customer_price_syp,supplier_cost_usd,supplier_reference,status,internal_notes,exception_reason,created_at,updated_at,completed_at").order("created_at", { ascending: false }).limit(100),
      ]);
      if (productsError || ordersError) {
        console.error("leo-manual load failed", productsError?.message || ordersError?.message);
        return json({ error: "تعذر تحميل بيانات كتالوج ليو." }, 500);
      }
      return json({ products: products ?? [], orders: orders ?? [], purchase_enabled: false });
    }

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "بيانات غير صالحة." }, 400); }

    if (body.action === "product_update") {
      const code = typeof body.product_code === "string" ? body.product_code.trim() : "";
      const supplierCost = optionalAmount(body.supplier_cost_usd, 1000000);
      const saleUsd = optionalAmount(body.sale_price_usd, 1000000);
      const saleSyp = optionalAmount(body.sale_price_syp, 100000000000);
      const notes = typeof body.admin_notes === "string" ? body.admin_notes.trim() : "";
      if (!/^LEO_[A-Z0-9_]{3,56}$/.test(code) || supplierCost === undefined || saleUsd === undefined ||
          saleSyp === undefined || notes.length > 1000) {
        return json({ error: "تحقق من رمز المنتج والأسعار والملاحظات." }, 400);
      }
      const { data: product, error } = await admin.from("leo_manual_products").update({
        supplier_cost_usd: supplierCost,
        sale_price_usd: saleUsd,
        sale_price_syp: saleSyp,
        admin_notes: notes,
        purchase_enabled: false,
        updated_at: new Date().toISOString(),
      }).eq("product_code", code).select("*").maybeSingle();
      if (error || !product) return json({ error: "تعذر حفظ المنتج. تأكد من وجوده." }, 400);
      const { error: auditError } = await admin.from("admin_audit_log").insert({
        admin_id: user.id,
        action: "leo_manual_product_update",
        entity_type: "leo_manual_product",
        entity_id: code,
        details: { supplier_cost_usd: supplierCost, sale_price_usd: saleUsd, sale_price_syp: saleSyp, purchase_enabled: false },
      });
      if (auditError) {
        console.error("leo-manual product audit failed", auditError.message);
        return json({ error: "تم حفظ بيانات المنتج، لكن تعذر تسجيل سجل التدقيق. أوقف أي تعديل إضافي وراجع سجل الإدارة." }, 500);
      }
      return json({ product, purchase_enabled: false });
    }

    if (body.action === "order_update") {
      const orderId = typeof body.order_id === "string" ? body.order_id : "";
      const status = typeof body.status === "string" ? body.status : "";
      const allowed = ["pending", "in_progress", "awaiting_admin_confirmation", "completed", "failed", "needs_review", "cancelled"];
      const cost = optionalAmount(body.supplier_cost_usd, 1000000);
      const reference = typeof body.supplier_reference === "string" ? body.supplier_reference.trim() : "";
      const exception = typeof body.exception_reason === "string" ? body.exception_reason.trim() : "";
      const notes = typeof body.internal_notes === "string" ? body.internal_notes.trim() : "";
      if (!uuidPattern.test(orderId) || !allowed.includes(status) || cost === undefined ||
          reference.length > 160 || exception.length > 500 || notes.length > 2000) {
        return json({ error: "بيانات الطلب غير صحيحة." }, 400);
      }
      if (status === "completed" && (!(cost !== null && cost > 0) ||
          !((reference.length >= 2) || (exception.length >= 5)))) {
        return json({ error: "لا يمكن إكمال الطلب دون تسجيل التكلفة الفعلية ورقم العملية أو سبب استثناء موثق." }, 400);
      }
      const { data: current, error: currentError } = await admin.from("leo_manual_orders")
        .select("id,status").eq("id", orderId).maybeSingle();
      if (currentError || !current) return json({ error: "طلب ليو غير موجود." }, 404);
      const update: Record<string, unknown> = {
        status, supplier_cost_usd: cost, supplier_reference: reference || null,
        exception_reason: exception || null, internal_notes: notes, updated_at: new Date().toISOString(),
        completed_at: status === "completed" ? new Date().toISOString() : null,
      };
      const { data: order, error } = await admin.from("leo_manual_orders").update(update)
        .eq("id", orderId).select("*").single();
      if (error) return json({ error: "تعذر تحديث طلب ليو." }, 400);
      const { error: eventError } = await admin.from("leo_manual_order_events").insert({
        order_id: orderId, actor_id: user.id, event_type: "admin_status_update",
        details: { from: current.status, to: status, supplier_cost_usd: cost, supplier_reference: reference || null, exception_reason: exception || null },
      });
      const { error: auditError } = await admin.from("admin_audit_log").insert({
        admin_id: user.id, action: "leo_manual_order_update", entity_type: "leo_manual_order",
        entity_id: orderId, details: { from: current.status, to: status },
      });
      if (eventError || auditError) {
        console.error("leo-manual order audit failed", eventError?.message || auditError?.message);
        return json({ error: "تحدّثت حالة الطلب، لكن تعذر إكمال سجل التدقيق. راجع الطلب قبل أي متابعة." }, 500);
      }
      return json({ order, finance_posted: false, wallet_changed: false });
    }

    return json({ error: "الإجراء غير معروف." }, 400);
  } catch (error) {
    console.error("leo-manual error", error);
    return json({ error: "حدث خطأ داخلي أثناء معالجة طلب ليو." }, 500);
  }
});
