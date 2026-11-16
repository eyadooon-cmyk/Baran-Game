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
        console.error("baro-manual load failed", productsError?.message || ordersError?.message);
        return json({ error: "تعذر تحميل بيانات كتالوج بارو." }, 500);
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
      const { data: result, error: rpcError } = await admin.rpc("baro_manual_product_update_atomic", {
        p_admin_id: user.id,
        p_product_code: code,
        p_supplier_cost_usd: supplierCost,
        p_sale_price_usd: saleUsd,
        p_sale_price_syp: saleSyp,
        p_admin_notes: notes,
      });
      if (rpcError || !result?.product) {
        console.error("baro-manual atomic product update failed", rpcError?.message);
        return json({ error: rpcError?.code === "P0002" ? "المنتج غير موجود." : "لم يتم حفظ المنتج أو سجل التدقيق. لم يُعتمد أي تعديل." }, 400);
      }
      return json(result);
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
      const { data: result, error: rpcError } = await admin.rpc("baro_manual_order_update_atomic", {
        p_admin_id: user.id,
        p_order_id: orderId,
        p_status: status,
        p_supplier_cost_usd: cost,
        p_supplier_reference: reference || null,
        p_exception_reason: exception || null,
        p_internal_notes: notes,
      });
      if (rpcError || !result?.order) {
        console.error("baro-manual atomic order update failed", rpcError?.message);
        return json({ error: rpcError?.code === "P0002" ? "طلب بارو غير موجود." : "لم يتم تحديث الطلب أو سجلاته. لم يُعتمد أي تعديل." }, 400);
      }
      return json(result);
    }

    return json({ error: "الإجراء غير معروف." }, 400);
  } catch (error) {
    console.error("baro-manual error", error);
    return json({ error: "حدث خطأ داخلي أثناء معالجة طلب بارو." }, 500);
  }
});
