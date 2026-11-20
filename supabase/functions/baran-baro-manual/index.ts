import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://eyadooon-cmyk.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function amount(value: unknown, max: number): number | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) return undefined;
  return value;
}
const str = (value: unknown, max = 500) => typeof value === "string" ? value.trim().slice(0, max) : "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!["GET", "POST"].includes(req.method)) return json({ error: "Method not allowed" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anon || !service) return json({ error: "إعدادات BARO غير مكتملة." }, 500);
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return json({ error: "يلزم تسجيل الدخول." }, 401);
    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: "Bearer " + token } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) return json({ error: "جلسة غير صالحة." }, 401);
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: accountControl, error: accountControlError } = await admin.from("customer_account_controls")
      .select("status,banned_until").eq("user_id", user.id).maybeSingle();
    if (accountControlError) {
      console.error("baro-manual account-control lookup failed", accountControlError.message);
      return json({ error: "تعذر التحقق من حالة حماية الحساب." }, 500);
    }
    if (accountControl?.status === "banned" &&
        (!accountControl.banned_until || new Date(accountControl.banned_until).getTime() > Date.now())) {
      return json({ error: "هذا الحساب موقوف حالياً. لا يمكن إرسال طلب BARO." }, 403);
    }
    const hasPermission = async (permission: string) => {
      const { data, error } = await admin.rpc("baro_manual_has_permission", { p_user_id: user.id, p_permission: permission });
      return !error && data === true;
    };
    const isStoreAdmin = async () => {
      const { data, error } = await admin.rpc("admin_is_user", { p_user_id: user.id });
      return !error && data === true;
    };
    const view = new URL(req.url).searchParams.get("view") ?? "admin";

    if (req.method === "GET" && view === "catalog") {
      const [{ data: products, error }, { data: settings, error: settingsError }] = await Promise.all([
        admin.from("leo_manual_products").select("product_code,category_id,group_id,product_name,input_label,purchase_enabled,sale_price_usd,sale_price_syp")
          .eq("catalog_visible", true).order("category_id").order("group_id").order("product_name"),
        admin.from("baro_manual_settings").select("enabled").eq("id", "main").maybeSingle()
      ]);
      if (error || settingsError) return json({ error: "تعذر تحميل كتالوج BARO." }, 500);
      return json({ products: (products ?? []).map((p: any) => ({
        product_code: p.product_code, category_id: p.category_id, group_id: p.group_id,
        product_name: p.product_name, input_label: p.input_label, purchase_enabled: p.purchase_enabled,
        sale_price_usd: p.sale_price_usd, sale_price_syp: p.sale_price_syp
      })), manual_enabled: settings?.enabled === true });
    }

    if (req.method === "GET" && view === "my_orders") {
      const { data, error } = await admin.from("leo_manual_orders")
        .select("id,product_code,player_id,product_name_snapshot,quantity,customer_price_usd,customer_price_syp,displayed_price_usd_snapshot,displayed_price_syp_snapshot,displayed_price_captured_at,status,payment_status,payment_method,customer_message,created_at,updated_at,completed_at,wallet_charge_mode,wallet_charged_at")
        .eq("user_id", user.id).order("created_at", { ascending: false }).limit(50);
      if (error) return json({ error: "تعذر تحميل طلبات BARO." }, 500);
      const ids = (data ?? []).map((o: any) => o.id);
      const [{ data: holds, error: holdError }, { data: events, error: eventsError }] = ids.length
        ? await Promise.all([
            admin.from("baro_manual_wallet_holds").select("order_id,amount,currency,status").in("order_id", ids),
            admin.from("leo_manual_order_events").select("order_id,actor_id,event_type,details,created_at").in("order_id", ids).order("created_at", { ascending: true })
          ])
        : [{ data: [], error: null }, { data: [], error: null }];
      if (holdError) return json({ error: "تعذر تحميل تسويات محفظة BARO." }, 500);
      if (eventsError) return json({ error: "تعذر تحميل سجل مراحل طلبات BARO." }, 500);
      const holdMap = new Map((holds ?? []).map((h: any) => [h.order_id, h]));
      const eventMap = new Map<string, any[]>();
      for (const event of events ?? []) {
        if (!eventMap.has(event.order_id)) eventMap.set(event.order_id, []);
        eventMap.get(event.order_id)!.push(event);
      }
      return json({ orders: (data ?? []).map((o: any) => ({...o,wallet_hold:holdMap.get(o.id) ?? null,events:eventMap.get(o.id) ?? []})) });
    }

    if (req.method === "GET" && view === "my_wallet") {
      const { data, error } = await admin.from("wallets")
        .select("balance_usd,balance_syp").eq("user_id", user.id).maybeSingle();
      if (error) return json({ error: "تعذر تحميل رصيد محفظتك." }, 500);
      return json({ wallet: data ?? {balance_usd:0,balance_syp:0} });
    }

    if (req.method === "GET" && view === "access") {
      const { data: isAdmin } = await admin.rpc("admin_is_user", { p_user_id: user.id });
      const { data: roles } = await admin.from("baro_staff_permissions").select("permission_key")
        .eq("user_id", user.id).eq("is_active", true);
      return json({ is_admin: isAdmin === true, permissions: isAdmin === true
        ? ["view", "catalog", "orders", "finance", "suppliers", "settings", "staff", "audit"]
        : (roles ?? []).map((r: { permission_key: string }) => r.permission_key) });
    }

    if (req.method === "GET" && view === "admin") {
      const access = await Promise.all(["catalog", "orders", "settings", "suppliers", "finance", "view"].map(hasPermission));
      const [canCatalog, canOrders, canSettings, canSuppliers, canFinance, canView] = access;
      if (!access.some(Boolean)) return json({ error: "لا تملك صلاحية عرض لوحة BARO." }, 403);
      const tasks: any[] = [];
      tasks.push(canCatalog
        ? admin.from("leo_manual_products").select("*").order("category_id").order("group_id").order("product_name")
        : canSuppliers
          ? admin.from("leo_manual_products").select("product_code,product_name,category_id,group_id").order("category_id").order("group_id").order("product_name")
          : Promise.resolve({ data: [], error: null }));
      tasks.push(canOrders
        ? admin.from("leo_manual_orders").select("id,user_id,product_code,player_id,product_name_snapshot,quantity,customer_note,customer_price_usd,customer_price_syp,displayed_price_usd_snapshot,displayed_price_syp_snapshot,displayed_price_captured_at,displayed_exchange_rate_snapshot,payment_exchange_rate_snapshot,supplier_id_snapshot,supplier_cost_usd_snapshot,payment_status,payment_method,customer_message,supplier_cost_usd,supplier_reference,status,internal_notes,exception_reason,created_at,updated_at,completed_at,wallet_charge_mode,wallet_charged_at")
          .order("created_at", { ascending: false }).limit(150)
        : Promise.resolve({ data: [], error: null }));
      tasks.push(canSettings
        ? admin.from("baro_manual_settings").select("enabled,usd_syp_rate,low_margin_percent,default_currency,updated_at,updated_by").eq("id", "main").maybeSingle()
        : Promise.resolve({ data: null, error: null }));
      const [productsResult, ordersResult, settingsResult] = await Promise.all(tasks);
      if (productsResult.error || ordersResult.error || settingsResult.error) return json({ error: "تعذر تحميل بيانات BARO اليدوية." }, 500);
      const orders = ordersResult.data ?? [];
      let enriched: any[] = [];
      if (canOrders) {
        const orderIds = orders.map((o: any) => o.id);
        const { data: orderEvents, error: orderEventsError } = orderIds.length
          ? await admin.from("leo_manual_order_events")
              .select("order_id,actor_id,event_type,details,created_at")
              .in("order_id", orderIds).order("created_at", { ascending: true })
          : { data: [], error: null };
        if (orderEventsError) return json({ error: "تعذر تحميل سجل منفذي طلبات BARO." }, 500);
        const actorIds = [...new Set((orderEvents ?? []).map((event: any) => event.actor_id).filter(Boolean))];
        const actorLabels = new Map<string, string>();
        await Promise.all(actorIds.map(async (actorId: string) => {
          const { data } = await admin.auth.admin.getUserById(actorId);
          const metadata = data?.user?.user_metadata ?? {};
          const label = str(metadata.full_name || metadata.name || metadata.display_name, 100);
          actorLabels.set(actorId, label || "عضو الإدارة");
        }));
        const eventsByOrder = new Map<string, any[]>();
        for (const event of orderEvents ?? []) {
          const enrichedEvent = { ...event, actor_label: event.actor_id ? (actorLabels.get(event.actor_id) || "عضو الإدارة") : null };
          if (!eventsByOrder.has(event.order_id)) eventsByOrder.set(event.order_id, []);
          eventsByOrder.get(event.order_id)!.push(enrichedEvent);
        }
        enriched = await Promise.all(orders.map(async (o: any) => {
          const { data } = await admin.auth.admin.getUserById(o.user_id);
          const events = eventsByOrder.get(o.id) ?? [];
          const lastActorEvent = [...events].reverse().find((event: any) => event.actor_id && event.actor_label);
          return { ...o, customer_email: data?.user?.email ?? null, events, last_actor_label: lastActorEvent?.actor_label ?? null };
        }));
      }
      const { data: gate } = await admin.from("baro_manual_settings").select("enabled").eq("id", "main").maybeSingle();
      return json({ products: productsResult.data ?? [], orders: enriched, settings: settingsResult.data ?? null,
        manual_enabled: gate?.enabled === true,
        access: { catalog: canCatalog, orders: canOrders, settings: canSettings, suppliers: canSuppliers, finance: canFinance, view: canView } });
    }

    if (req.method === "GET" && view === "finance") {
      if (!(await hasPermission("finance"))) return json({ error: "لا تملك صلاحية الإدارة المالية لـ BARO." }, 403);

      // Paginate the full ledger and eligible orders for accurate lifetime totals.
      // The UI history remains capped to the latest 500 rows for a lightweight response.
      const pageSize = 1000;
      const allEntries: any[] = [];
      for (let offset = 0; ; offset += pageSize) {
        const { data: page, error } = await admin.from("baro_manual_finance_entries")
          .select("id,order_id,external_sale_id,entry_type,title,amount,currency,exchange_rate,amount_usd_equivalent,status,description,external_reference,created_by,created_at")
          .order("created_at", { ascending: true }).order("id", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (error) return json({ error: "تعذر تحميل السجل المالي الكامل لـ BARO." }, 500);
        allEntries.push(...(page ?? []));
        if (!page || page.length < pageSize) break;
      }

      const eligibleOrders = new Set<string>();
      for (let offset = 0; ; offset += pageSize) {
        const { data: page, error } = await admin.from("leo_manual_orders")
          .select("id").eq("status", "completed").eq("payment_status", "verified")
          .order("id", { ascending: true }).range(offset, offset + pageSize - 1);
        if (error) return json({ error: "تعذر التحقق من جميع طلبات BARO المكتملة." }, 500);
        for (const order of page ?? []) eligibleOrders.add(order.id);
        if (!page || page.length < pageSize) break;
      }

      const totals = {
        sales: 0, realized_sales: 0, unmatched_sales: 0,
        supplier_costs: 0, realized_supplier_costs: 0,
        expenses: 0, commissions: 0, refunds: 0, adjustments: 0, net_profit: 0
      };
      const salesByOrder = new Map<string, number>();
      const costsByOrder = new Map<string, number>();
      const salesByExternal = new Map<string, number>();
      const costsByExternal = new Map<string, number>();

      for (const row of allEntries) {
        if (row.status !== "posted" || row.amount_usd_equivalent === null) continue;
        const n = Number(row.amount_usd_equivalent);
        if (!Number.isFinite(n)) continue;
        if (row.entry_type === "sale_received") {
          totals.sales += n;
          if (row.order_id) salesByOrder.set(row.order_id, (salesByOrder.get(row.order_id) ?? 0) + n);
          if (row.external_sale_id) salesByExternal.set(row.external_sale_id, (salesByExternal.get(row.external_sale_id) ?? 0) + n);
        } else if (row.entry_type === "supplier_cost") {
          totals.supplier_costs += n;
          if (row.order_id) costsByOrder.set(row.order_id, (costsByOrder.get(row.order_id) ?? 0) + n);
          if (row.external_sale_id) costsByExternal.set(row.external_sale_id, (costsByExternal.get(row.external_sale_id) ?? 0) + n);
        } else if (row.entry_type === "expense") totals.expenses += n;
        else if (row.entry_type === "commission") totals.commissions += n;
        else if (row.entry_type === "refund") totals.refunds += n;
        else if (row.entry_type === "adjustment") totals.adjustments += n;
      }

      // Recognize order profit only when both unique posted entries exist for the same
      // order and that order is currently payment-verified and completed.
      for (const orderId of eligibleOrders) {
        if (!salesByOrder.has(orderId) || !costsByOrder.has(orderId)) continue;
        totals.realized_sales += salesByOrder.get(orderId)!;
        totals.realized_supplier_costs += costsByOrder.get(orderId)!;
      }
      // External/manual sales are realized only when the atomic RPC has posted both paired ledger rows.
      for (const [saleId, saleAmount] of salesByExternal) {
        if (!costsByExternal.has(saleId)) continue;
        totals.realized_sales += saleAmount;
        totals.realized_supplier_costs += costsByExternal.get(saleId)!;
      }
      totals.unmatched_sales = Math.max(0, totals.sales - totals.realized_sales);
      totals.net_profit = totals.realized_sales - totals.realized_supplier_costs
        - totals.expenses - totals.commissions - totals.refunds + totals.adjustments;

      const { data: recentEntries, error: recentError } = await admin.from("baro_manual_finance_entries")
        .select("id,order_id,external_sale_id,entry_type,title,amount,currency,exchange_rate,amount_usd_equivalent,status,description,external_reference,created_by,created_at")
        .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(500);
      if (recentError) return json({ error: "تعذر تحميل أحدث حركات دفتر BARO." }, 500);
      const [externalSalesResult, suppliersResult] = await Promise.all([
        admin.from("baro_manual_external_sales").select("id,product_name,customer_name,player_id,supplier_id,supplier_name_snapshot,sale_amount,sale_currency,sale_usd_equivalent,supplier_cost_amount,supplier_cost_currency,supplier_cost_usd_equivalent,profit_usd_equivalent,payment_method,customer_reference,supplier_reference,notes,created_at").order("created_at",{ascending:false}).limit(500),
        admin.from("baro_manual_suppliers").select("id,name").eq("is_active",true).order("name")
      ]);
      if (externalSalesResult.error || suppliersResult.error) return json({ error: "تعذر تحميل سجل المبيعات الخارجية أو الموردين." }, 500);
      return json({ entries: recentEntries ?? [], external_sales: externalSalesResult.data ?? [],
        suppliers: suppliersResult.data ?? [], totals, totals_scope: "all_posted_history" });
    }

    if (req.method === "GET" && view === "suppliers") {
      if (!(await hasPermission("suppliers"))) return json({ error: "لا تملك صلاحية إدارة موردي BARO." }, 403);
      const [suppliers, links, events] = await Promise.all([
        admin.from("baro_manual_suppliers").select("id,name,contact_name,contact_phone,contact_email,notes,is_active,created_at,updated_at").order("name"),
        admin.from("baro_manual_supplier_products").select("id,supplier_id,product_code,supplier_sku,unit_cost,currency,exchange_rate_snapshot,lead_time_hours,is_preferred,is_active,notes,created_at,updated_at").order("product_code"),
        admin.from("baro_manual_supplier_events").select("id,supplier_id,order_id,event_type,rating,details,created_by,created_at").order("created_at", { ascending: false }).limit(200)
      ]);
      if (suppliers.error || links.error || events.error) return json({ error: "تعذر تحميل بيانات الموردين." }, 500);
      return json({ suppliers: suppliers.data ?? [], products: links.data ?? [], events: events.data ?? [] });
    }

    if (req.method === "GET" && view === "settings") {
      if (!(await hasPermission("settings"))) return json({ error: "لا تملك صلاحية إعدادات BARO." }, 403);
      const { data, error } = await admin.from("baro_manual_settings")
        .select("enabled,usd_syp_rate,low_margin_percent,default_currency,settings_json,updated_at,updated_by")
        .eq("id", "main").maybeSingle();
      if (error) return json({ error: "تعذر تحميل إعدادات BARO." }, 500);
      return json({ settings: data });
    }

    if (req.method === "GET" && view === "history") {
      if (!(await hasPermission("catalog"))) return json({ error: "لا تملك صلاحية سجل أسعار BARO." }, 403);
      const { data, error } = await admin.from("baro_manual_product_price_history")
        .select("id,product_code,changed_by,previous_values,new_values,created_at").order("created_at", { ascending: false }).limit(300);
      if (error) return json({ error: "تعذر تحميل سجل تغييرات الأسعار." }, 500);
      return json({ history: data ?? [] });
    }

    if (req.method === "GET" && view === "audit") {
      if (!(await hasPermission("audit"))) return json({ error: "لا تملك صلاحية سجل عمليات BARO." }, 403);
      const { data, error } = await admin.from("admin_audit_log")
        .select("id,admin_id,action,entity_type,entity_id,details,created_at")
        .like("action", "baro%").order("created_at", { ascending: false }).limit(300);
      if (error) return json({ error: "تعذر تحميل سجل عمليات BARO." }, 500);
      return json({ audit: data ?? [] });
    }

    if (req.method === "GET" && view === "backups") {
      if (!(await hasPermission("audit")) && !(await hasPermission("settings"))) return json({ error: "لا تملك صلاحية عرض نسخ BARO الاحتياطية." }, 403);
      const { data, error } = await admin.from("baro_manual_backup_snapshots")
        .select("id,row_counts,created_at").order("created_at", { ascending: false }).limit(60);
      if (error) return json({ error: "تعذر تحميل سجل النسخ الاحتياطية." }, 500);
      return json({ backups: data ?? [] });
    }

    if (req.method === "GET" && view === "staff") {
      if (!(await hasPermission("staff"))) return json({ error: "لا تملك صلاحية إدارة موظفي BARO." }, 403);
      const { data, error } = await admin.from("baro_staff_permissions")
        .select("user_id,permission_key,is_active,granted_by,created_at,updated_at").order("created_at", { ascending: false }).limit(300);
      if (error) return json({ error: "تعذر تحميل صلاحيات BARO." }, 500);
      return json({ staff: data ?? [] });
    }

    let body: Record<string, unknown> = {};
    if (req.method === "POST") {
      try { body = await req.json(); } catch { return json({ error: "بيانات غير صالحة." }, 400); }
    }

    if (req.method === "POST" && body.action === "create_order") {
      const code = str(body.product_code, 60), player = str(body.player_id, 80);
      if (body.player_id_confirmed !== true) return json({ error: "يجب تأكيد صحة رقم ID قبل إرسال الطلب." }, 400);
      const qty = typeof body.quantity === "number" ? body.quantity : Number(body.quantity ?? 1);
      const note = str(body.customer_note, 500);
      const walletCurrency = body.wallet_currency === "USD" ? "USD" : body.wallet_currency === "SYP" ? "SYP" : "";
      if (!/^LEO_[A-Z0-9_]{3,56}$/.test(code) || player.length < 3 || !Number.isInteger(qty) || qty < 1 || qty > 1000000 || !walletCurrency)
        return json({ error: "تحقق من المنتج ومعرّف اللاعب والكمية وعملة المحفظة." }, 400);
      const idempotencyKey = typeof body.idempotency_key === "string" ? body.idempotency_key : "";
      if (!uuidPattern.test(idempotencyKey)) return json({ error: "تعذر التحقق من رقم محاولة الطلب. أعد المحاولة." }, 400);
      const { data, error } = await admin.rpc("baro_manual_create_customer_order_on_completion", {
        p_user_id: user.id, p_product_code: code, p_player_id: player,
        p_quantity: qty, p_customer_note: note, p_idempotency_key: idempotencyKey,
        p_player_id_confirmed: true, p_wallet_currency: walletCurrency
      });
      if (error) return json({ error: error.message || "تعذر تسجيل طلب BARO." }, 400);
      return json({ ...(data ?? { success: true }), message: "تم تسجيل طلب BARO اليدوي دون خصم. سيتم الخصم من المحفظة فقط بعد اكتمال الشحن." });
    }

    if (body.action === "manual_toggle") {
      if (!(await isStoreAdmin())) return json({ error: "فتح وإيقاف استقبال BARO مخصص لمدير المتجر." }, 403);
      if (typeof body.enabled !== "boolean") return json({ error: "حالة BARO غير صحيحة." }, 400);
      const { data, error } = await admin.rpc("baro_manual_set_enabled_atomic", { p_admin_id: user.id, p_enabled: body.enabled });
      if (error || !data?.success) return json({ error: "تعذر تحديث حالة استقبال BARO وتسجيل التدقيق." }, 400);
      return json(data);
    }

    if (body.action === "product_save") {
      if (!(await hasPermission("catalog"))) return json({ error: "لا تملك صلاحية تعديل منتجات BARO." }, 403);
      const code = str(body.product_code, 60), cost = amount(body.supplier_cost_usd, 1000000);
      const usd = amount(body.sale_price_usd, 1000000), syp = amount(body.sale_price_syp, 100000000000);
      const notes = str(body.admin_notes, 1000);
      if (!/^LEO_[A-Z0-9_]{3,56}$/.test(code) || cost === undefined || usd === undefined || syp === undefined
          || typeof body.catalog_visible !== "boolean" || typeof body.purchase_enabled !== "boolean")
        return json({ error: "تحقق من رمز المنتج والأسعار والإتاحة والملاحظات." }, 400);
      if (body.purchase_enabled && (!body.catalog_visible || (usd ?? 0) <= 0 || (syp ?? 0) <= 0))
        return json({ error: "أدخل سعر بيع موجب بالدولار والليرة وأظهر المنتج قبل إتاحة الطلب." }, 400);
      const { data, error } = await admin.rpc("baro_manual_product_save_complete_atomic", {
        p_admin_id: user.id, p_product_code: code, p_supplier_cost_usd: cost,
        p_sale_price_usd: usd, p_sale_price_syp: syp, p_admin_notes: notes,
        p_catalog_visible: body.catalog_visible, p_purchase_enabled: body.purchase_enabled
      });
      if (error || !data?.product) return json({ error: error?.message || "لم يتم حفظ المنتج." }, 400);
      return json(data);
    }

    if (body.action === "order_admin_update") {
      if (!(await hasPermission("orders"))) return json({ error: "لا تملك صلاحية إدارة طلبات BARO." }, 403);
      const id = typeof body.order_id === "string" ? body.order_id : "";
      const status = typeof body.status === "string" ? body.status : "";
      const quote = amount(body.quote_amount, 1000000000000);
      const currency = body.quote_currency === null || body.quote_currency === "" ? null : body.quote_currency;
      const method = str(body.payment_method, 60), payment = typeof body.payment_status === "string" ? body.payment_status : "";
      const customerMessage = str(body.customer_message, 500), cost = amount(body.supplier_cost_usd, 1000000);
      const reference = str(body.supplier_reference, 160), exception = str(body.exception_reason, 500), notes = str(body.internal_notes, 2000);
      if (!uuidPattern.test(id) || !["pending","awaiting_payment","paid","in_progress","awaiting_admin_confirmation","completed","failed","needs_review","cancelled"].includes(status)
          || quote === undefined || (currency !== null && !["USD","SYP"].includes(String(currency)))
          || !["awaiting_quote","awaiting_payment","verified","failed"].includes(payment) || cost === undefined)
        return json({ error: "بيانات تحديث الطلب غير صحيحة." }, 400);
      const { data, error } = await admin.rpc("baro_manual_order_admin_update_wallet_aware", {
        p_admin_id: user.id, p_order_id: id, p_status: status, p_quote_amount: quote,
        p_quote_currency: currency, p_payment_method: method, p_payment_status: payment,
        p_customer_message: customerMessage, p_supplier_cost_usd: cost,
        p_supplier_reference: reference, p_exception_reason: exception, p_internal_notes: notes
      });
      if (error || !data?.order) return json({ error: error?.message || "تعذر تحديث طلب BARO." }, 400);
      return json(data);
    }

    if (body.action === "settings_save") {
      if (!(await hasPermission("settings"))) return json({ error: "لا تملك صلاحية إعدادات BARO." }, 403);
      const rate = amount(body.usd_syp_rate, 1000000000), margin = amount(body.low_margin_percent, 100);
      const currency = body.default_currency === "SYP" ? "SYP" : body.default_currency === "USD" ? "USD" : "";
      if (rate === undefined || margin === undefined || margin === null || !currency)
        return json({ error: "تحقق من سعر الصرف وحد التنبيه والعملة الافتراضية." }, 400);
      const { data, error } = await admin.rpc("baro_manual_settings_save_atomic", {
        p_admin_id: user.id, p_usd_syp_rate: rate, p_low_margin_percent: margin, p_default_currency: currency
      });
      if (error) return json({ error: error.message || "تعذر حفظ إعدادات BARO." }, 400);
      return json(data);
    }

    if (body.action === "finance_entry") {
      if (!(await hasPermission("finance"))) return json({ error: "لا تملك صلاحية تسجيل حركة مالية في BARO." }, 403);
      const orderId = body.order_id === null || body.order_id === "" ? null : String(body.order_id);
      const entryType = String(body.entry_type ?? ""), title = str(body.title, 140), value = amount(body.amount, 1000000000000);
      const currency = body.currency === "SYP" ? "SYP" : body.currency === "USD" ? "USD" : "";
      const rate = amount(body.exchange_rate, 1000000000), description = str(body.description, 1000);
      const external = str(body.external_reference, 160), key = str(body.idempotency_key, 160);
      if ((orderId && !uuidPattern.test(orderId)) || value === undefined || value === null || !currency || rate === undefined)
        return json({ error: "تحقق من مبلغ الحركة والعملة ورقم الطلب." }, 400);
      const { data, error } = await admin.rpc("baro_manual_finance_entry_atomic", {
        p_admin_id: user.id, p_order_id: orderId, p_entry_type: entryType, p_title: title,
        p_amount: value, p_currency: currency, p_exchange_rate: rate,
        p_description: description, p_external_reference: external, p_idempotency_key: key || null
      });
      if (error) return json({ error: error.message || "تعذر تسجيل الحركة المالية." }, 400);
      return json(data);
    }

    if (body.action === "external_sale_create") {
      if (!(await hasPermission("finance"))) return json({ error: "لا تملك صلاحية تسجيل بيع خارجي في BARO." }, 403);
      const supplierId = String(body.supplier_id ?? "");
      const saleAmount = amount(body.sale_amount, 1000000000000);
      const saleRate = amount(body.sale_exchange_rate, 1000000000);
      const costAmount = amount(body.supplier_cost_amount, 1000000000000);
      const costRate = amount(body.supplier_cost_exchange_rate, 1000000000);
      const saleCurrency = body.sale_currency === "SYP" ? "SYP" : body.sale_currency === "USD" ? "USD" : "";
      const costCurrency = body.supplier_cost_currency === "SYP" ? "SYP" : body.supplier_cost_currency === "USD" ? "USD" : "";
      const paymentMethod = ["sham_cash","cash","other"].includes(String(body.payment_method)) ? String(body.payment_method) : "";
      const key = str(body.idempotency_key,160);
      if (!uuidPattern.test(supplierId) || saleAmount === undefined || saleAmount === null || costAmount === undefined || costAmount === null
          || !saleCurrency || !costCurrency || saleRate === undefined || costRate === undefined
          || (saleCurrency === "SYP" && (!saleRate || saleRate <= 0))
          || (costCurrency === "SYP" && (!costRate || costRate <= 0))
          || !paymentMethod || !uuidPattern.test(key) || body.execution_confirmed !== true)
        return json({ error: "أكمل المبالغ والعملات وسعر الصرف والمورد، وأكد القبض وتنفيذ الشحن." }, 400);
      const { data, error } = await admin.rpc("baro_manual_external_sale_create_atomic", {
        p_admin_id: user.id, p_product_name: str(body.product_name,160),
        p_customer_name: str(body.customer_name,120), p_player_id: str(body.player_id,100),
        p_supplier_id: supplierId, p_sale_amount: saleAmount, p_sale_currency: saleCurrency,
        p_sale_exchange_rate: saleRate, p_supplier_cost_amount: costAmount,
        p_supplier_cost_currency: costCurrency, p_supplier_cost_exchange_rate: costRate,
        p_payment_method: paymentMethod, p_customer_reference: str(body.customer_reference,160),
        p_supplier_reference: str(body.supplier_reference,160), p_notes: str(body.notes,1000),
        p_idempotency_key: key, p_execution_confirmed: true
      });
      if (error || !data?.sale) return json({ error: error?.message || "تعذر تسجيل البيع الخارجي." }, 400);
      return json(data);
    }

    if (body.action === "supplier_save") {
      if (!(await hasPermission("suppliers"))) return json({ error: "لا تملك صلاحية إدارة الموردين." }, 403);
      const id = typeof body.supplier_id === "string" && uuidPattern.test(body.supplier_id) ? body.supplier_id : null;
      const name = str(body.name, 120), contact = str(body.contact_name, 120), phone = str(body.contact_phone, 60);
      const email = str(body.contact_email, 160), notes = str(body.notes, 1000), active = body.is_active !== false;
      if (name.length < 2 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))
        return json({ error: "أدخل اسم المورد وبريداً صحيحاً إن وجد." }, 400);
      const payload = { name, contact_name: contact || null, contact_phone: phone || null, contact_email: email || null, notes, is_active: active, updated_at: new Date().toISOString() };
      const query = id
        ? admin.from("baro_manual_suppliers").update(payload).eq("id", id).select("id,name,contact_name,contact_phone,contact_email,notes,is_active").single()
        : admin.from("baro_manual_suppliers").insert(payload).select("id,name,contact_name,contact_phone,contact_email,notes,is_active").single();
      const { data, error } = await query;
      if (error || !data) return json({ error: error?.message || "تعذر حفظ المورد." }, 400);
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "baro_supplier_saved", entity_type: "supplier", entity_id: data.id,
        details: { name: data.name, is_active: data.is_active } });
      return json({ supplier: data });
    }

    if (body.action === "supplier_product_save") {
      if (!(await hasPermission("suppliers"))) return json({ error: "لا تملك صلاحية ربط الموردين بالمنتجات." }, 403);
      const supplierId = String(body.supplier_id ?? ""), productCode = str(body.product_code, 60);
      const cost = amount(body.unit_cost, 1000000000), currency = body.currency === "SYP" ? "SYP" : body.currency === "USD" ? "USD" : "";
      const lead = body.lead_time_hours === null || body.lead_time_hours === "" ? null : Number(body.lead_time_hours);
      if (!uuidPattern.test(supplierId) || !/^LEO_[A-Z0-9_]{3,56}$/.test(productCode) || cost === undefined || cost === null
          || !currency || (lead !== null && (!Number.isInteger(lead) || lead < 0)))
        return json({ error: "بيانات ربط المورد بالمنتج غير صحيحة." }, 400);
      const { data, error } = await admin.rpc("baro_manual_supplier_product_save_atomic", {
        p_admin_id: user.id, p_supplier_id: supplierId, p_product_code: productCode,
        p_supplier_sku: str(body.supplier_sku, 160), p_unit_cost: cost, p_currency: currency,
        p_lead_time_hours: lead, p_is_preferred: body.is_preferred === true,
        p_is_active: body.is_active !== false, p_notes: str(body.notes, 1000)
      });
      if (error) return json({ error: error.message || "تعذر حفظ ربط المورد." }, 400);
      return json(data);
    }

    if (body.action === "supplier_event") {
      if (!(await hasPermission("suppliers"))) return json({ error: "لا تملك صلاحية سجل الموردين." }, 403);
      const supplierId = String(body.supplier_id ?? ""), orderId = body.order_id ? String(body.order_id) : null;
      const type = String(body.event_type ?? ""), rating = body.rating === null || body.rating === "" ? null : Number(body.rating);
      if (!uuidPattern.test(supplierId) || (orderId && !uuidPattern.test(orderId)))
        return json({ error: "معرّف المورد أو الطلب غير صحيح." }, 400);
      const { data, error } = await admin.rpc("baro_manual_add_supplier_event_atomic", {
        p_admin_id: user.id, p_supplier_id: supplierId, p_order_id: orderId,
        p_event_type: type, p_rating: rating, p_details: str(body.details, 1000)
      });
      if (error) return json({ error: error.message || "تعذر تسجيل ملاحظة المورد." }, 400);
      return json(data);
    }

    if (body.action === "backup_now") {
      if (!(await hasPermission("settings")) && !(await hasPermission("audit"))) return json({ error: "لا تملك صلاحية إنشاء نسخة BARO احتياطية." }, 403);
      const { data, error } = await admin.rpc("baro_manual_create_backup_snapshot");
      if (error || !data) return json({ error: error?.message || "تعذر إنشاء النسخة الاحتياطية." }, 400);
      await admin.from("admin_audit_log").insert({
        admin_id: user.id, action: "baro_backup_created", entity_type: "baro_manual_backup_snapshot",
        entity_id: String(data), details: { snapshot_id: data }
      });
      return json({ backup_id: data, success: true });
    }

    if (body.action === "staff_permission_save") {
      if (!(await hasPermission("staff")) || !(await isStoreAdmin()))
        return json({ error: "إدارة صلاحيات الموظفين مخصصة لمدير المتجر." }, 403);
      const staffId = String(body.user_id ?? ""), permission = String(body.permission_key ?? "");
      if (!uuidPattern.test(staffId)) return json({ error: "معرّف الموظف غير صحيح." }, 400);
      const { data, error } = await admin.rpc("baro_manual_staff_permission_save_atomic", {
        p_admin_id: user.id, p_user_id: staffId, p_permission_key: permission, p_is_active: body.is_active === true
      });
      if (error) return json({ error: error.message || "تعذر تحديث صلاحية الموظف." }, 400);
      return json(data);
    }

    return json({ error: "الإجراء غير معروف." }, 400);
  } catch (error) {
    console.error("baro-manual error", error);
    return json({ error: "حدث خطأ داخلي أثناء معالجة BARO." }, 500);
  }
});
