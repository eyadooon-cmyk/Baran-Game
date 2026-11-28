import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://eyadooon-cmyk.github.io",
  "https://baran-game.pages.dev",
]);
function corsHeaders(origin = ""): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
  if (ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(body: unknown, status = 200, origin = "") {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}

function readKeyObject(name: string): string | undefined {
  const raw = Deno.env.get(name);
  if (!raw) return undefined;
  try { return JSON.parse(raw).default; } catch { return undefined; }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin") ?? "";
  const respond = (body: unknown, status = 200, responseOrigin = origin) => json(body, status, responseOrigin);
  if (req.method === "OPTIONS") {
    if (origin && !ALLOWED_ORIGINS.has(origin)) return new Response("Forbidden", { status: 403 });
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (origin && !ALLOWED_ORIGINS.has(origin)) return respond({ error: "Origin not allowed" }, 403, origin);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? readKeyObject("SUPABASE_PUBLISHABLE_KEYS");
    const legacyServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const secretKey = readKeyObject("SUPABASE_SECRET_KEYS");

    if (!url || !anonKey || !legacyServiceKey) {
      console.error("baran-admin configuration missing", {
        hasUrl: Boolean(url),
        hasPublishableKey: Boolean(anonKey),
        hasLegacyServiceRoleKey: Boolean(legacyServiceKey),
        hasSecretKey: Boolean(secretKey),
      });
      return respond({ error: "Server configuration is incomplete" }, 500);
    }

    console.log("baran-admin: configuration loaded", { hasSecretKey: Boolean(secretKey) });
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return respond({ error: "Authentication required" }, 401);

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) { console.error("baran-admin: auth failed", authError?.message ?? "missing user"); return respond({ error: "Invalid session" }, 401); }
    console.log("baran-admin: user authenticated");

    // New sb_secret keys belong in apikey only. Keep the legacy service-role JWT
    // in Authorization so downstream Supabase APIs do not try to parse sb_secret as a JWT.
    const admin = createClient(url, secretKey ?? legacyServiceKey, {
      global: {
        headers: { Authorization: `Bearer ${legacyServiceKey}` },
      },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    console.log("baran-admin: admin client created");
    const { data: isAdmin, error: adminError } = await admin.rpc("admin_is_user", {
      p_user_id: user.id,
    });

    if (adminError) { console.error("baran-admin: admin check failed", adminError.message); return respond({ error: "Could not verify administrator" }, 500); }
    console.log("baran-admin: admin check completed", { isAdmin: isAdmin === true });
    if (isAdmin !== true) return respond({ error: "Administrator access required" }, 403);

    if (req.method === "GET") {
      const { data: requests, error } = await admin
        .from("deposit_requests")
        .select("id,user_id,amount,currency,transfer_reference,receipt_path,status,created_at,request_source")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) { console.error("baran-admin: deposit query failed", error.message, error.code); return respond({ error: "Could not load deposit requests" }, 500); }
      console.log("baran-admin: deposit requests loaded", { count: requests?.length ?? 0 });

      console.log("baran-admin: starting customer email lookup");
      const enriched = await Promise.all((requests ?? []).map(async (item) => {
        const { data, error: userLookupError } = await admin.auth.admin.getUserById(item.user_id);
        if (userLookupError) console.error("baran-admin: customer lookup failed", userLookupError.message);
        let receipt_url: string | null = null;
        if (item.receipt_path) {
          const { data: signedReceipt, error: receiptError } = await admin.storage
            .from("shamcash-receipts")
            .createSignedUrl(item.receipt_path, 600);
          if (receiptError) console.error("baran-admin: receipt signing failed", receiptError.message);
          receipt_url = signedReceipt?.signedUrl ?? null;
        }
        return { ...item, customer_email: data?.user?.email ?? null, receipt_url };
      }));
      console.log("baran-admin: customer email lookup completed");

      const { data: feedback, error: feedbackError } = await admin
        .from("customer_feedback")
        .select("id,user_id,feedback_type,ticket_code,subject,message,rating,order_id,status,priority,assigned_admin_id,admin_reply,admin_read_at,created_at,updated_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (feedbackError) {
        console.error("baran-admin: feedback query failed", feedbackError.message);
        return respond({ error: "Could not load customer feedback" }, 500);
      }
      const feedbackEnriched = await Promise.all((feedback ?? []).map(async (item) => {
        const { data, error: lookupError } = await admin.auth.admin.getUserById(item.user_id);
        if (lookupError) console.error("baran-admin: feedback customer lookup failed", lookupError.message);
        return { ...item, customer_email: data?.user?.email ?? null };
      }));

      const { data: autoSupportQueue, error: autoSupportQueueError } = await admin
        .from("baran_auto_support_queue")
        .select("id,feedback_id,ticket_code,state,reason,generated_reply,attempts,last_error,created_at,updated_at,processed_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (autoSupportQueueError) {
        console.error("baran-admin: auto support queue query failed", autoSupportQueueError.message);
        return respond({ error: "تعذر تحميل سجل الردود الآلية." }, 500);
      }
      const { data: treasury, error: treasuryError } = await admin.rpc("admin_treasury_data", { p_admin_id: user.id });
      if (treasuryError) { console.error("baran-admin: treasury data failed", treasuryError.message); return respond({ error: "تعذر تحميل بيانات الخزينة." }, 500); }
      const { data: finance, error: financeError } = await admin.rpc("admin_finance_data", {
        p_admin_id: user.id,
      });
      if (financeError) {
        console.error("baran-admin: finance data failed", financeError.message);
        return respond({ error: "Could not load finance data" }, 500);
      }
      const reportParams = new URL(req.url).searchParams;
      const damascusParts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Damascus", year: "numeric", month: "numeric",
      }).formatToParts(new Date());
      const damascusYear = Number(damascusParts.find((part) => part.type === "year")?.value);
      const damascusMonth = Number(damascusParts.find((part) => part.type === "month")?.value);
      const reportMonth = reportParams.has("finance_month")
        ? Number(reportParams.get("finance_month")) : damascusMonth;
      const reportYear = reportParams.has("finance_year")
        ? Number(reportParams.get("finance_year")) : damascusYear;
      if (!Number.isInteger(reportMonth) || reportMonth < 1 || reportMonth > 12 ||
          !Number.isInteger(reportYear) || reportYear < 2020 || reportYear > 2100) {
        return respond({ error: "فترة التقرير غير صحيحة." }, 400);
      }
      const { data: productReport, error: productReportError } = await admin.rpc(
        "admin_finance_product_report",
        { p_admin_id: user.id, p_month: reportMonth, p_year: reportYear },
      );
      if (productReportError) {
        console.error("baran-admin: product report failed", productReportError.message);
        return respond({ error: "تعذر تحميل تقرير أرباح المنتجات." }, 500);
      }
      const financeWithReport = {
        ...finance,
        product_report: productReport ?? [],
        product_report_month: reportMonth,
        product_report_year: reportYear,
      };
      const { data: products, error: productsError } = await admin
        .from("products")
        .select("id,product_code,category,name,description,price_usd,price_syp,markup_percent,is_active,sort_order,created_at,updated_at")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });
      if (productsError) {
        console.error("baran-admin: products query failed", productsError.message);
        return respond({ error: "Could not load products" }, 500);
      }
      const { data: settings, error: settingsError } = await admin
        .from("store_settings")
        .select("exchange_rate,updated_at,market_exchange_rate,fx_buffer_percent,product_markup_percent,pricing_updated_at,pricing_updated_by")
        .eq("id", "main")
        .single();
      if (settingsError) {
        console.error("baran-admin: exchange rate query failed", settingsError.message);
        return respond({ error: "Could not load exchange rate" }, 500);
      }
      const { data: recoveryAudit, error: recoveryAuditError } = await admin
        .from("account_recovery_audit")
        .select("id,target_user_id,admin_id,action,target_email,verified_facts,verification_notes,created_at")
        .order("created_at", { ascending: false })
        .limit(30);
      if (recoveryAuditError) {
        console.error("baran-admin: recovery audit query failed", recoveryAuditError.message);
        return respond({ error: "Could not load account recovery history" }, 500);
      }
      const { data: notifications, error: notificationsError } = await admin
        .from("baran_notifications")
        .select("id,kind,title,body,entity_type,entity_id,read_at,created_at")
        .eq("recipient_id", user.id)
        .eq("audience", "admin")
        .order("created_at", { ascending: false })
        .limit(50);
      if (notificationsError) {
        console.error("baran-admin: notification query failed", notificationsError.message);
        return respond({ error: "Could not load admin notifications" }, 500);
      }
      // Keep support-ticket alerts in the admin bell only while their ticket is open.
      // Notifications remain stored for history; this only hides alerts for resolved/closed tickets.
      const closedSupportTicketIds = new Set(
        (feedback ?? [])
          .filter((ticket) =>
            ticket.feedback_type === "support" &&
            ["completed", "rejected"].includes(String(ticket.status || "").toLowerCase())
          )
          .map((ticket) => String(ticket.id))
      );
      const visibleNotifications = (notifications ?? []).filter((notification) => {
        const isSupportTicketAlert =
          String(notification.entity_type || "").toLowerCase() === "customer_feedback";
        return !(
          isSupportTicketAlert &&
          closedSupportTicketIds.has(String(notification.entity_id || ""))
        );
      });
      const [{ data: suppliers, error: suppliersError }, { data: supplierProducts, error: supplierProductsError },
        { data: orders, error: ordersError }, { data: fulfillmentRows, error: fulfillmentError },
        { data: loyaltyRows, error: loyaltyError }, { count: userCount, error: userCountError },
        { count: orderCount, error: orderCountError }] = await Promise.all([
          admin.from("suppliers").select("id,name,contact_name,contact_phone,contact_email,notes,is_active,created_at,updated_at").order("name"),
          admin.from("supplier_products").select("id,supplier_id,product_id,supplier_sku,unit_cost,currency,is_preferred,lead_time_hours,notes,input_schema,updated_at"),
          admin.from("orders").select("id,user_id,product_code,player_id,quantity,status,created_at,exchange_rate,unit_price_usd,unit_price_syp,total_price_usd,total_price_syp").order("created_at",{ascending:false}).limit(100),
          admin.from("order_fulfillment").select("order_id,supplier_id,supplier_reference,supplier_status,internal_notes,supplier_unit_cost,supplier_total_cost,supplier_cost_currency,supplier_cost_exchange_rate,updated_at"),
          admin.from("customer_loyalty").select("user_id,points_balance,lifetime_earned,updated_at").order("updated_at",{ascending:false}).limit(100),
          admin.from("profiles").select("id",{count:"exact",head:true}),
          admin.from("orders").select("id",{count:"exact",head:true}),
        ]);
      if (suppliersError || supplierProductsError || ordersError || fulfillmentError || loyaltyError || userCountError || orderCountError) {
        console.error("baran-admin: operations dashboard query failed",
          suppliersError?.message || supplierProductsError?.message || ordersError?.message ||
          fulfillmentError?.message || loyaltyError?.message || userCountError?.message || orderCountError?.message);
        return respond({ error: "Could not load store operations dashboard" }, 500);
      }
      // Exclude administrator accounts: this directory is for store customers only.
      const { data: adminRows, error: adminRowsError } = await admin.from("admin_users").select("user_id");
      if (adminRowsError) {
        console.error("baran-admin: administrator directory exclusion failed", adminRowsError.message);
        return respond({ error:"تعذر التحقق من حسابات الإدارة." },500);
      }
      const adminUserIds = new Set((adminRows ?? []).map((row) => row.user_id));
      // Load every customer in stable pages; do not silently cap the directory at 100.
      const customerProfiles: Array<{id:string;member_code:string|null;full_name:string|null;phone:string|null;created_at:string}> = [];
      const customerPageSize = 500;
      for (let from = 0; ; from += customerPageSize) {
        const { data: page, error: pageError } = await admin
          .from("profiles")
          .select("id,member_code,full_name,phone,created_at")
          .order("created_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, from + customerPageSize - 1);
        if (pageError) {
          console.error("baran-admin: customer directory query failed", pageError.message);
          return respond({ error:"تعذر تحميل قائمة الزبائن كاملة." },500);
        }
        customerProfiles.push(...(page ?? []).filter((profile) => !adminUserIds.has(profile.id)));
        if (!page || page.length < customerPageSize) break;
      }

      // Count registered push subscriptions per customer without exposing endpoint/key material.
      const pushSubscriptionCounts = new Map<string, number>();
      for (let from = 0; ; from += customerPageSize) {
        const { data: page, error: pushPageError } = await admin
          .from("baran_push_subscriptions")
          .select("user_id")
          .range(from, from + customerPageSize - 1);
        if (pushPageError) {
          console.error("baran-admin: customer push subscription lookup failed", pushPageError.message);
          return respond({ error: "تعذر تحميل حالات اشتراكات الإشعارات." }, 500);
        }
        for (const row of page ?? []) {
          if (!adminUserIds.has(row.user_id)) pushSubscriptionCounts.set(row.user_id, (pushSubscriptionCounts.get(row.user_id) ?? 0) + 1);
        }
        if (!page || page.length < customerPageSize) break;
      }
      const pushSubscribedCustomerCount = [...pushSubscriptionCounts.values()].filter(count => count > 0).length;
      // Read wallet rows in pages too, so accounts beyond the API row limit keep their balances.
      const customerWalletRows: Array<{user_id:string;balance_usd:number|string|null;balance_syp:number|string|null}> = [];
      for (let from = 0; ; from += customerPageSize) {
        const { data: page, error: walletPageError } = await admin
          .from("wallets")
          .select("user_id,balance_usd,balance_syp")
          .range(from, from + customerPageSize - 1);
        if (walletPageError) {
          console.error("baran-admin: customer wallet lookup failed", walletPageError.message);
          return respond({ error: "تعذر تحميل أرصدة الزبائن." }, 500);
        }
        customerWalletRows.push(...(page ?? []));
        if (!page || page.length < customerPageSize) break;
      }
      const customerWalletByUser = new Map(customerWalletRows.map((wallet) => [wallet.user_id, wallet]));
      // Build lifetime customer activity from every order page; this is analytics only.
      const customerOrderStats = new Map<string, { count:number; spendUsd:number; spendSyp:number; lastOrderAt:string|null }>();
      for (let from = 0; ; from += customerPageSize) {
        const { data: page, error: orderStatsError } = await admin
          .from("orders")
          .select("user_id,total_price_usd,total_price_syp,created_at")
          .order("created_at", { ascending: false })
          .range(from, from + customerPageSize - 1);
        if (orderStatsError) {
          console.error("baran-admin: customer order analytics failed", orderStatsError.message);
          return respond({ error:"تعذر تحميل إحصائيات نشاط الزبائن." },500);
        }
        for (const order of page ?? []) {
          const current = customerOrderStats.get(order.user_id) ?? { count:0, spendUsd:0, spendSyp:0, lastOrderAt:null };
          current.count += 1;
          current.spendUsd += Number(order.total_price_usd ?? 0);
          current.spendSyp += Number(order.total_price_syp ?? 0);
          if (!current.lastOrderAt && order.created_at) current.lastOrderAt = order.created_at;
          customerOrderStats.set(order.user_id,current);
        }
        if (!page || page.length < customerPageSize) break;
      }
      const loyaltyByUser = new Map((loyaltyRows ?? []).map((row) => [row.user_id, Number(row.points_balance ?? 0)]));
      const { data: accountControlRows, error: accountControlError } = await admin
        .from("customer_account_controls").select("user_id,status,reason,banned_until,updated_at");
      if (accountControlError) {
        console.error("baran-admin: customer account controls failed", accountControlError.message);
        return respond({ error: "تعذر تحميل حالات حماية الحسابات." }, 500);
      }
      const accountControlsByUser = new Map((accountControlRows ?? []).map((row) => {
        const activeBan = row.status === "banned" &&
          (!row.banned_until || new Date(row.banned_until).getTime() > Date.now());
        return [row.user_id, activeBan ? row : { ...row, status: "active" }];
      }));
      const { data: customerPresenceRows, error: customerPresenceError } = await admin
        .from("customer_presence").select("user_id,last_seen_at").order("last_seen_at", { ascending: false });
      if (customerPresenceError) {
        console.error("baran-admin: customer presence lookup failed", customerPresenceError.message);
        return respond({ error: "تعذر تحميل آخر نشاط للعملاء." }, 500);
      }
      const customerLastSeenByUser = new Map<string, string>();
      for (const presence of customerPresenceRows ?? []) {
        if (!customerLastSeenByUser.has(presence.user_id) && presence.last_seen_at) {
          customerLastSeenByUser.set(presence.user_id, presence.last_seen_at);
        }
      }
      const { data: customerAdminNotes, error: customerAdminNotesError } = await admin
        .from("customer_admin_notes").select("user_id,note,updated_at,updated_by");
      const { data: customerVipRows, error: customerVipError } = await admin
        .from("customer_vip_tags").select("user_id,is_vip,updated_at,updated_by");
      if (customerVipError) {
        console.error("baran-admin: customer VIP tags failed", customerVipError.message);
        return respond({ error: "تعذر تحميل شارات VIP للعملاء." }, 500);
      }
      const customerVipByUser = new Map((customerVipRows ?? []).map((row) => [row.user_id, row]));
      if (customerAdminNotesError) {
        console.error("baran-admin: customer admin notes failed", customerAdminNotesError.message);
        return respond({ error: "تعذر تحميل الملاحظات الإدارية للعملاء." }, 500);
      }
      const customerNotesByUser = new Map((customerAdminNotes ?? []).map((row) => [row.user_id, row]));
      const customers = await Promise.all(customerProfiles.map(async (profile) => {
        const { data: authResult, error: authLookupError } = await admin.auth.admin.getUserById(profile.id);
        if (authLookupError) console.error("baran-admin: customer email lookup failed", authLookupError.message);
        const wallet = customerWalletByUser.get(profile.id);
        const activity = customerOrderStats.get(profile.id);
        const metadata = authResult?.user?.user_metadata ?? {};
        const identityData = authResult?.user?.identities?.find((identity) => identity.provider === "google")?.identity_data ?? {};
        const displayName = profile.full_name || metadata.full_name || metadata.name ||
          identityData.full_name || identityData.name || identityData.given_name || null;
        const avatarUrl = metadata.avatar_url || metadata.picture || metadata.avatar ||
          identityData.avatar_url || identityData.picture || null;
        return { ...profile, email:authResult?.user?.email ?? null,
          display_name:displayName,
          avatar_url:avatarUrl,
          last_sign_in_at:authResult?.user?.last_sign_in_at ?? null,
          last_activity_at:customerLastSeenByUser.get(profile.id) ?? authResult?.user?.last_sign_in_at ?? activity?.lastOrderAt ?? null,
          balance_usd:Number(wallet?.balance_usd ?? 0), balance_syp:Number(wallet?.balance_syp ?? 0),
          has_balance:Number(wallet?.balance_usd ?? 0) > 0 || Number(wallet?.balance_syp ?? 0) > 0,
          order_count:activity?.count ?? 0, lifetime_spend_usd:activity?.spendUsd ?? 0,
          lifetime_spend_syp:activity?.spendSyp ?? 0, last_order_at:activity?.lastOrderAt ?? null,
          loyalty_points:loyaltyByUser.get(profile.id) ?? 0,
          admin_note:customerNotesByUser.get(profile.id)?.note ?? "",
          admin_note_updated_at:customerNotesByUser.get(profile.id)?.updated_at ?? null,
          is_vip:customerVipByUser.get(profile.id)?.is_vip === true,
          push_subscription_count:pushSubscriptionCounts.get(profile.id) ?? 0,
          vip_updated_at:customerVipByUser.get(profile.id)?.updated_at ?? null,
          account_control:accountControlsByUser.get(profile.id) ?? { status: "active", reason: null, banned_until: null } };
      }));
      const fulfillmentByOrder = new Map((fulfillmentRows ?? []).map((row) => [row.order_id, row]));
      const orderCustomers = await Promise.all((orders ?? []).map(async (item) => {
        const [{ data: authResult }, { data: profile }] = await Promise.all([
          admin.auth.admin.getUserById(item.user_id),
          admin.from("profiles").select("full_name,phone").eq("id",item.user_id).maybeSingle(),
        ]);
        return { ...item, customer_email: authResult?.user?.email ?? null,
          customer_name: profile?.full_name ?? null, customer_phone: profile?.phone ?? null,
          fulfillment: fulfillmentByOrder.get(item.id) ?? null };
      }));
      const loyaltyCustomers = await Promise.all((loyaltyRows ?? []).map(async (item) => {
        const [{ data: authResult }, { data: profile }] = await Promise.all([
          admin.auth.admin.getUserById(item.user_id),
          admin.from("profiles").select("full_name,phone").eq("id",item.user_id).maybeSingle(),
        ]);
        return { ...item, customer_email: authResult?.user?.email ?? null,
          customer_name: profile?.full_name ?? null, customer_phone: profile?.phone ?? null };
      }));
      const { data: orderStatusCounts, error: orderStatusError } = await admin
        .from("orders").select("status");
      if (orderStatusError) return respond({ error: "Could not load order statistics" }, 500);
      const statusCounts = (orderStatusCounts ?? []).reduce((acc: Record<string,number>, row) => {
        acc[row.status] = (acc[row.status] ?? 0) + 1; return acc;
      }, {});
      const { count: unreadSupportCount, error: unreadSupportError } = await admin
        .from("customer_feedback")
        .select("id", { count: "exact", head: true })
        .eq("feedback_type", "support")
        .in("status", ["pending", "in_progress"])
        .is("admin_read_at", null);
      if (unreadSupportError) {
        console.error("baran-admin: unread support count failed", unreadSupportError.message);
        return respond({ error: "تعذر تحميل عدد تذاكر الدعم غير المقروءة." }, 500);
      }
      const { data: auditLog, error: auditLogError } = await admin
        .from("admin_audit_log").select("id,admin_id,action,entity_type,entity_id,details,created_at")
        .order("created_at",{ascending:false}).limit(100);
      if (auditLogError) return respond({ error:"Could not load administrator audit log" },500);
      const { data: customerSecurityEvents, error: customerSecurityEventsError } = await admin
        .from("customer_security_events")
        .select("id,user_id,actor_id,event_type,severity,details,created_at")
        .order("created_at", { ascending: false }).limit(100);
      if (customerSecurityEventsError) {
        console.error("baran-admin: customer security events failed", customerSecurityEventsError.message);
        return respond({ error: "تعذر تحميل سجل أحداث حماية العملاء." }, 500);
      }
      const { count: productCount, error: productCountError } = await admin
        .from("products").select("id",{count:"exact",head:true});
      const { count: supplierCount, error: supplierCountError } = await admin
        .from("suppliers").select("id",{count:"exact",head:true});
      const { data: supplierIntegration, error: supplierIntegrationError } = await admin.rpc(
        "baran_admin_supplier_integration_data", { p_admin_id: user.id },
      );
      if (supplierIntegrationError) {
        console.error("baran-admin: supplier integration data failed", supplierIntegrationError.message);
        return respond({ error: "تعذر تحميل إعدادات ربط المورد." }, 500);
      }
      if (productCountError || supplierCountError) return respond({ error: "Could not load catalogue statistics" }, 500);
      return respond({
        requests: enriched,
        notifications: visibleNotifications,
        feedback: feedbackEnriched,
        auto_support_queue: autoSupportQueue ?? [],
        finance: financeWithReport,
        treasury: treasury ?? { balances: [], entries: [] },
        products: products ?? [],
        customers,
        suppliers: suppliers ?? [],
        supplier_products: supplierProducts ?? [],
        supplier_integration: supplierIntegration ?? {},
        orders: orderCustomers,
        loyalty_customers: loyaltyCustomers,
        audit_log: auditLog ?? [],
        customer_security_events: customerSecurityEvents ?? [],
        stats: { users: userCount ?? 0, orders: orderCount ?? 0,
          products: productCount ?? 0, suppliers: supplierCount ?? 0,
          order_statuses: statusCounts, pending_orders: statusCounts.pending ?? 0,
          unread_support_tickets: unreadSupportCount ?? 0,
          push_subscribed_customers: pushSubscribedCustomerCount },
        recovery_audit: recoveryAudit ?? [],
        exchange_rate: Number(settings.exchange_rate),
        exchange_rate_updated_at: settings.updated_at,
        pricing_policy: {
          market_exchange_rate: Number(settings.market_exchange_rate),
          fx_buffer_percent: Number(settings.fx_buffer_percent),
          product_markup_percent: Number(settings.product_markup_percent),
          commercial_exchange_rate: Number(settings.market_exchange_rate) * (1 + Number(settings.fx_buffer_percent) / 100),
          updated_at: settings.pricing_updated_at,
          updated_by: settings.pricing_updated_by,
        },
      });
    }

    if (req.method === "POST") {
      let body: {
        action?: string;
        ban_duration?: string;
        ban_reason?: string;
        request_id?: string;
        decision?: string;
        entry_type?: string;
        title?: string;
        product_name?: string;
        amount?: number;
        quantity?: number;
        unit_sale_price?: number;
        unit_cost_price?: number;
        currency?: string;
        treasury_entry_type?: string;
        reference?: string;
        notes?: string;
        product_id?: string;
        product_code?: string;
        category?: string;
        name?: string;
        description?: string;
        price_usd?: number | string | null;
        price_syp?: number;
        is_active?: boolean;
        sort_order?: number;
        exchange_rate?: number;
        market_exchange_rate?: number;
        fx_buffer_percent?: number;
        product_markup_percent?: number;
        feedback_id?: string;
        feedback_status?: string;
        admin_reply?: string;
        search_query?: string;
        target_user_id?: string;
        display_name?: string;
        is_vip?: boolean;
        note?: string;
        verification_notes?: string;
        verified_facts?: string[];
        notification_id?: string;
        recipient_id?: string;
        supplier_id?: string;
        supplier_name?: string;
        contact_name?: string;
        contact_phone?: string;
        contact_email?: string;
        supplier_sku?: string;
        supplier_reference?: string;
        supplier_status?: string;
        internal_notes?: string;
        supplier_unit_cost?: number | null;
        supplier_cost_currency?: string;
        adapter_key?: string;
        api_base_url?: string | null;
        health_path?: string | null;
        balance_path?: string | null;
        create_order_path?: string | null;
        order_status_path?: string | null;
        auth_secret_name?: string | null;
        auth_header_name?: string;
        auth_prefix?: string;
        low_balance_threshold?: number;
        balance_currency?: string;
        integration_enabled?: boolean;
        failure_reason?: string;
        unit_cost?: number;
        lead_time_hours?: number;
        is_preferred?: boolean;
        order_id?: string;
        new_status?: string;
        customer_message?: string;
        points_delta?: number;
        notification_title?: string;
        notification_body?: string;
        audience_segment?: string;
        products?: any[];
        input_schema?: any;
      };
      try { body = await req.json(); } catch { return respond({ error: "Invalid JSON" }, 400); }

      if (body.action === "customer_admin_note_update") {
        const targetId = typeof body.target_user_id === "string" ? body.target_user_id : "";
        const note = typeof body.note === "string" ? body.note.trim() : "";
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidPattern.test(targetId) || note.length > 1000) {
          return respond({ error: "تحقق من معرّف العميل. الحد الأقصى للملاحظة 1000 حرف." }, 400);
        }
        const { data: targetAdmin, error: targetAdminError } = await admin.rpc("admin_is_user", { p_user_id: targetId });
        if (targetAdminError) return respond({ error: "تعذر التحقق من نوع الحساب المستهدف." }, 500);
        if (targetAdmin === true) return respond({ error: "لا يمكن إضافة ملاحظة إلى حساب إداري من مركز العملاء." }, 403);
        const { data: targetProfile, error: targetProfileError } = await admin.from("profiles")
          .select("id").eq("id", targetId).maybeSingle();
        if (targetProfileError) return respond({ error: "تعذر التحقق من حساب العميل." }, 500);
        if (!targetProfile) return respond({ error: "حساب العميل غير موجود." }, 404);
        let updatedAt: string | null = null;
        if (note) {
          const { data: savedNote, error: saveError } = await admin.from("customer_admin_notes").upsert({
            user_id: targetId, note, updated_by: user.id, updated_at: new Date().toISOString(),
          }, { onConflict: "user_id" }).select("user_id,note,updated_at").single();
          if (saveError) {
            console.error("baran-admin: customer note save failed", saveError.message);
            return respond({ error: "تعذر حفظ الملاحظة الإدارية." }, 500);
          }
          updatedAt = savedNote.updated_at;
        } else {
          const { error: deleteError } = await admin.from("customer_admin_notes").delete().eq("user_id", targetId);
          if (deleteError) {
            console.error("baran-admin: customer note delete failed", deleteError.message);
            return respond({ error: "تعذر حذف الملاحظة الإدارية." }, 500);
          }
        }
        const { error: auditError } = await admin.from("admin_audit_log").insert({
          admin_id: user.id, action: "customer_admin_note_update", entity_type: "customer", entity_id: targetId,
          details: { note_saved: Boolean(note), note_length: note.length },
        });
        if (auditError) {
          console.error("baran-admin: customer note audit failed", auditError.message);
          return respond({ error: "تم حفظ الملاحظة لكن تعذر تسجيل العملية في سجل الإدارة." }, 500);
        }
        return respond({ success: true, user_id: targetId, note: note || "", updated_at: updatedAt });
      }

      if (body.action === "customer_vip_update") {
        const targetId = typeof body.target_user_id === "string" ? body.target_user_id : "";
        const isVip = body.is_vip;
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidPattern.test(targetId) || typeof isVip !== "boolean") return respond({ error: "بيانات شارة VIP غير صحيحة." }, 400);
        const { data: targetAdmin, error: targetAdminError } = await admin.rpc("admin_is_user", { p_user_id: targetId });
        if (targetAdminError) return respond({ error: "تعذر التحقق من نوع الحساب المستهدف." }, 500);
        if (targetAdmin === true) return respond({ error: "لا يمكن منح شارة VIP لحساب إداري." }, 403);
        const { data: targetProfile, error: targetProfileError } = await admin.from("profiles").select("id").eq("id", targetId).maybeSingle();
        if (targetProfileError) return respond({ error: "تعذر التحقق من حساب العميل." }, 500);
        if (!targetProfile) return respond({ error: "حساب العميل غير موجود." }, 404);
        let newlyGrantedVip = false;
        if (isVip) {
          const { data: existingVip, error: existingVipError } = await admin.from("customer_vip_tags").select("is_vip").eq("user_id", targetId).maybeSingle();
          if (existingVipError) { console.error("baran-admin: VIP tag lookup failed", existingVipError.message); return respond({ error: "تعذر التحقق من عضوية VIP الحالية." }, 500); }
          newlyGrantedVip = existingVip?.is_vip !== true;
          const { error } = await admin.from("customer_vip_tags").upsert({ user_id: targetId, is_vip: true, updated_by: user.id, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
          if (error) { console.error("baran-admin: VIP tag save failed", error.message); return respond({ error: "تعذر حفظ شارة VIP." }, 500); }
        } else {
          const { error } = await admin.from("customer_vip_tags").delete().eq("user_id", targetId);
          if (error) { console.error("baran-admin: VIP tag delete failed", error.message); return respond({ error: "تعذر إزالة شارة VIP." }, 500); }
        }
        const { error: auditError } = await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "customer_vip_update", entity_type: "customer", entity_id: targetId, details: { is_vip: isVip } });
        if (auditError) { console.error("baran-admin: VIP tag audit failed", auditError.message); return respond({ error: "تم تحديث الشارة لكن تعذر تسجيل العملية في سجل الإدارة." }, 500); }

        let notificationCreated = false;
        if (isVip && newlyGrantedVip) {
          const { error: notificationError } = await admin.from("baran_notifications").insert({
            recipient_id: targetId,
            audience: "customer",
            kind: "customer_vip",
            title: "👑 مبروك! أصبحت من عملاء VIP",
            body: "تمت ترقيتك إلى عضوية VIP في BARAN GAME. شكراً لثقتك بنا!",
            entity_type: "customer_vip",
            entity_id: targetId,
          });
          if (notificationError) {
            console.error("baran-admin: VIP notification creation failed", notificationError.message);
          } else {
            notificationCreated = true;
          }
        }
        return respond({ success: true, user_id: targetId, is_vip: isVip, notification_created: notificationCreated });
      }

      if (body.action === "customer_profile_update") {
        const targetId = typeof body.target_user_id === "string" ? body.target_user_id : "";
        const displayName = typeof body.display_name === "string" ? body.display_name.trim().replace(/\s+/g, " ") : "";
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!uuidPattern.test(targetId) || displayName.length < 2 || displayName.length > 60) {
          return respond({ error: "الاسم يجب أن يكون بين حرفين و60 حرفاً." }, 400);
        }
        const { data: targetAdmin, error: targetAdminError } = await admin.rpc("admin_is_user", { p_user_id: targetId });
        if (targetAdminError) return respond({ error: "تعذر التحقق من نوع الحساب المستهدف." }, 500);
        if (targetAdmin === true) return respond({ error: "لا يمكن تعديل اسم حساب إداري من مركز العملاء." }, 403);
        const { data: updatedProfile, error: profileUpdateError } = await admin
          .from("profiles").update({ full_name: displayName }).eq("id", targetId)
          .select("id,full_name").maybeSingle();
        if (profileUpdateError) {
          console.error("baran-admin: customer profile name update failed", profileUpdateError.message);
          return respond({ error: "تعذر حفظ اسم العميل." }, 500);
        }
        if (!updatedProfile) return respond({ error: "حساب العميل غير موجود." }, 404);
        const { error: auditError } = await admin.from("admin_audit_log").insert({
          admin_id: user.id, action: "customer_name_update", entity_type: "customer", entity_id: targetId,
          details: { full_name: displayName },
        });
        if (auditError) {
          console.error("baran-admin: customer name audit failed", auditError.message);
          return respond({ error: "تم حفظ الاسم، لكن تعذر تسجيل العملية في سجل الإدارة." }, 500);
        }
        return respond({ success: true, user_id: targetId, full_name: updatedProfile.full_name });
      }

      if (body.action === "customer_account_ban") {
        const targetId = body.target_user_id ?? "";
        const reason = typeof body.ban_reason === "string" ? body.ban_reason.trim() : "";
        const duration = body.ban_duration ?? "24h";
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        const allowedDurations = new Set(["1h","24h","7d","30d","permanent","none"]);
        if (!uuidPattern.test(targetId) || !allowedDurations.has(duration) ||
            (duration !== "none" && (reason.length < 5 || reason.length > 500))) {
          return respond({ error: "حدد حساباً صحيحاً وسبباً واضحاً ومدة حظر صالحة." }, 400);
        }
        const { data: targetAdmin, error: targetAdminError } = await admin.rpc("admin_is_user", { p_user_id: targetId });
        if (targetAdminError) return respond({ error: "تعذر التحقق من نوع الحساب المستهدف." }, 500);
        if (targetAdmin === true) return respond({ error: "لا يمكن حظر حساب إداري من مركز العملاء." }, 403);
        const banDuration = duration === "none" ? "none" :
          duration === "permanent" ? "876000h" :
          duration === "1h" ? "1h" : duration === "24h" ? "24h" :
          duration === "7d" ? "168h" : "720h";
        const { data: targetUser, error: targetLookupError } = await admin.auth.admin.getUserById(targetId);
        if (targetLookupError || !targetUser?.user) return respond({ error: "حساب العميل غير موجود." }, 404);
        const { data: previousControl, error: previousControlError } = await admin.from("customer_account_controls")
          .select("user_id,status,reason,banned_until,updated_by,updated_at")
          .eq("user_id", targetId).maybeSingle();
        if (previousControlError) return respond({ error: "تعذر قراءة حالة الحماية السابقة." }, 500);
        const bannedUntil = duration === "none" || duration === "permanent" ? null : new Date(Date.now() +
          (duration === "1h" ? 3600000 : duration === "24h" ? 86400000 :
           duration === "7d" ? 604800000 : 2592000000)).toISOString();
        const nextControl = {
          user_id: targetId, status: duration === "none" ? "active" : "banned",
          reason: duration === "none" ? null : reason, banned_until: bannedUntil,
          updated_by: user.id, updated_at: new Date().toISOString(),
        };
        // Save the server-side deny state first so an old JWT is blocked during the Auth update.
        const { error: controlError } = await admin.from("customer_account_controls")
          .upsert(nextControl, { onConflict: "user_id" });
        if (controlError) {
          console.error("baran-admin: customer control save failed", controlError.message);
          return respond({ error: "تعذر حفظ حالة حماية الحساب؛ لم يتم تغيير جلسة الدخول." }, 500);
        }
        const { data: authUpdate, error: authUpdateError } = await admin.auth.admin.updateUserById(targetId, {
          ban_duration: banDuration,
        });
        if (authUpdateError) {
          console.error("baran-admin: customer ban auth sync failed", authUpdateError.message);
          if (previousControl) {
            const { error: rollbackError } = await admin.from("customer_account_controls")
              .upsert(previousControl, { onConflict: "user_id" });
            if (rollbackError) console.error("baran-admin: customer ban rollback failed", rollbackError.message);
          } else {
            const { error: rollbackError } = await admin.from("customer_account_controls")
              .delete().eq("user_id", targetId);
            if (rollbackError) console.error("baran-admin: customer ban rollback failed", rollbackError.message);
          }
          await admin.from("customer_security_events").insert({
            user_id: targetId, actor_id: user.id, event_type: "customer_ban_auth_sync_failed",
            severity: "critical", details: { requested_duration: duration, error: authUpdateError.message.slice(0, 300) },
          });
          return respond({ error: "تعذر مزامنة الحظر مع تسجيل الدخول. تم التراجع عن تغيير الحالة؛ تحقق من سجل الحماية." }, 500);
        }
        const { error: securityEventError } = await admin.from("customer_security_events").insert({
          user_id: targetId, actor_id: user.id,
          event_type: duration === "none" ? "customer_unbanned" : "customer_banned",
          severity: duration === "none" ? "info" : "warning",
          details: { duration, reason: duration === "none" ? null : reason },
        });
        const { error: auditInsertError } = await admin.from("admin_audit_log").insert({
          admin_id: user.id, action: duration === "none" ? "customer_unban" : "customer_ban",
          entity_type: "customer", entity_id: targetId,
          details: { duration, reason: duration === "none" ? null : reason },
        });
        if (securityEventError || auditInsertError) {
          console.error("baran-admin: ban audit write failed", securityEventError?.message || auditInsertError?.message);
          return respond({ error: "تم تغيير حالة الحظر، لكن تعذر حفظ سجل التدقيق كاملاً. راجع سجلات الإدارة." }, 500);
        }
        return respond({ success: true, user_id: targetId, status: duration === "none" ? "active" : "banned",
          banned_until: bannedUntil, auth_user_updated: Boolean(authUpdate?.user) });
      }

      if (body.action === "admin_check") return respond({ success: true });


      if (body.action === "notification_read") {
        const id = body.notification_id;
        if (typeof id !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
          return respond({ error: "معرّف التنبيه غير صحيح." }, 400);
        }
        const { data: updated, error: readError } = await admin.from("baran_notifications")
          .update({ read_at: new Date().toISOString() })
          .eq("id", id).eq("recipient_id", user.id).eq("audience", "admin").is("read_at", null)
          .select("id,read_at").maybeSingle();
        if (readError) {
          console.error("baran-admin: notification read update failed", readError.message);
          return respond({ error: "تعذر تحديث التنبيه." }, 500);
        }
        return respond({ notification: updated ?? null, success: true });
      }

      if (body.action === "push_delivery_stats") {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { data: deliveries, error: deliveryError } = await admin
          .from("baran_push_delivery_logs")
          .select("status,attempt_count,http_status,error_code,last_error,created_at,updated_at,sent_at")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(1000);
        if (deliveryError) {
          console.error("baran-admin: push delivery report failed", deliveryError.message);
          return respond({ error: "تعذر تحميل سجل إرسال الإشعارات." }, 500);
        }
        const rows = deliveries || [];
        const stats = {
          total: rows.length,
          sent: rows.filter((row) => row.status === "sent").length,
          failed: rows.filter((row) => row.status === "failed").length,
          processing: rows.filter((row) => row.status === "processing").length,
          expired: rows.filter((row) => row.status === "expired").length,
          attempts: rows.reduce((sum, row) => sum + Number(row.attempt_count || 0), 0),
          last_updated: rows[0]?.updated_at || null
        };
        return respond({ success: true, period_days: 7, stats, recent: rows.slice(0, 12) });
      }

      if (body.action === "notification_customer_search") {
        const query = typeof body.search_query === "string" ? body.search_query.trim() : "";
        if (query.length < 3 || query.length > 120) return respond({ error: "اكتب 3 أحرف أو أرقام على الأقل للبحث." }, 400);
        const safeQuery = query.replace(/[%,().]/g, " ").replace(/\s+/g, " ").trim();
        if (safeQuery.length < 3) return respond({ error: "عبارة البحث غير صالحة." }, 400);
        const { data: profiles, error: profileError } = await admin.from("profiles")
          .select("id,full_name,phone,member_code")
          .or("full_name.ilike.%" + safeQuery + "%,phone.ilike.%" + safeQuery + "%,member_code.ilike.%" + safeQuery + "%")
          .order("created_at", { ascending: false }).limit(10);
        if (profileError) {
          console.error("baran-admin: notification customer search failed", profileError.message);
          return respond({ error: "تعذر البحث عن حسابات الزبائن." }, 500);
        }
        const { data: adminRows, error: adminRowsError } = await admin.from("admin_users").select("user_id");
        if (adminRowsError) return respond({ error: "تعذر التحقق من حسابات الإدارة." }, 500);
        const adminIds = new Set((adminRows ?? []).map((row) => row.user_id));
        const customers = (profiles ?? []).filter((profile) => !adminIds.has(profile.id))
          .map((profile) => ({ id: profile.id, full_name: profile.full_name ?? null, phone: profile.phone ?? null, member_code: profile.member_code ?? null }));
        return respond({ success: true, customers });
      }

      if (body.action === "send_targeted_notification") {
        const recipientId = typeof body.recipient_id === "string" ? body.recipient_id.trim() : "";
        const title = typeof body.notification_title === "string" ? body.notification_title.trim() : "";
        const message = typeof body.notification_body === "string" ? body.notification_body.trim() : "";
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(recipientId)) {
          return respond({ error: "حساب المستلم غير صالح." }, 400);
        }
        if (title.length < 3 || title.length > 100 || message.length < 5 || message.length > 500) {
          return respond({ error: "عنوان الإشعار من 3 إلى 100 حرف، ونصه من 5 إلى 500 حرف." }, 400);
        }
        const { data: recipient, error: recipientError } = await admin.from("profiles")
          .select("id,full_name").eq("id", recipientId).maybeSingle();
        if (recipientError) return respond({ error: "تعذر التحقق من حساب المستلم." }, 500);
        if (!recipient) return respond({ error: "لم يتم العثور على حساب المستلم." }, 404);
        const { data: recipientAdmin, error: recipientAdminError } = await admin.from("admin_users")
          .select("user_id").eq("user_id", recipientId).maybeSingle();
        if (recipientAdminError) return respond({ error: "تعذر التحقق من صلاحيات المستلم." }, 500);
        if (recipientAdmin) return respond({ error: "لا يمكن إرسال إشعار العملاء إلى حساب إداري." }, 400);
        const { error: insertError } = await admin.from("baran_notifications").insert({
          recipient_id: recipientId, audience: "customer", kind: "store_announcement",
          title, body: message, entity_type: null, entity_id: null,
        });
        if (insertError) {
          console.error("baran-admin: targeted notification insert failed", insertError.message);
          return respond({ error: "تعذر تسجيل الإشعار للمستلم." }, 500);
        }
        await admin.from("admin_audit_log").insert({
          admin_id: user.id, action: "send_targeted_notification",
          entity_type: "baran_notifications",
          details: { title, recipient_id: recipientId },
        });
        return respond({ success: true, sent_to: 1, recipient_id: recipientId });
      }

      if (body.action === "broadcast_announcement") {
        const title = typeof body.notification_title === "string" ? body.notification_title.trim() : "";
        const message = typeof body.notification_body === "string" ? body.notification_body.trim() : "";
        const segment = typeof body.audience_segment === "string" ? body.audience_segment : "all";
        const allowedSegments = ["all","pubg","freefire","jawaker","ai","vpn","gift_card","app"];
        if (title.length < 3 || title.length > 100 || message.length < 5 || message.length > 500) {
          return respond({ error: "عنوان الإعلان من 3 إلى 100 حرف، ونصه من 5 إلى 500 حرف." }, 400);
        }
        if (!allowedSegments.includes(segment)) return respond({ error: "فئة المستلمين غير صالحة." }, 400);
        let recipientIds: string[] = [];
        if (segment === "all") {
          const { data: adminRows, error: adminRowsError } = await admin.from("admin_users").select("user_id");
          if (adminRowsError) return respond({ error: "تعذر التحقق من حسابات الإدارة." }, 500);
          const adminIds = new Set((adminRows ?? []).map((row) => row.user_id));
          for (let offset = 0; offset < 100000; offset += 1000) {
            const { data: profiles, error: profilesError } = await admin.from("profiles")
              .select("id").order("id").range(offset, offset + 999);
            if (profilesError) {
              console.error("baran-admin: announcement recipients failed", profilesError.message);
              return respond({ error: "تعذر تحميل قائمة الزبائن." }, 500);
            }
            recipientIds.push(...(profiles ?? []).filter((profile) => !adminIds.has(profile.id)).map((profile) => profile.id));
            if (!profiles || profiles.length < 1000) break;
          }
        } else {
          const { data: products, error: productsError } = await admin.from("products")
            .select("product_code,category").eq("is_active", true);
          if (productsError) return respond({ error: "تعذر تحديد منتجات الفئة المطلوبة." }, 500);
          const productCodes = (products ?? []).filter((product) => {
            const code = String(product.product_code || "").toUpperCase();
            if (segment === "pubg") return code.startsWith("PUBG_");
            if (segment === "freefire") return code.startsWith("FREEFIRE_");
            if (segment === "jawaker") return code.startsWith("JAWAKER_");
            return product.category === segment;
          }).map((product) => product.product_code);
          if (productCodes.length) {
            const matchedUsers = new Set<string>();
            for (let offset = 0; offset < 100000; offset += 1000) {
              const { data: orders, error: ordersError } = await admin.from("orders")
                .select("user_id,product_code").in("product_code", productCodes)
                .order("created_at", { ascending: false }).order("id", { ascending: true }).range(offset, offset + 999);
              if (ordersError) return respond({ error: "تعذر تحديد الزبائن المهتمين بهذه الفئة." }, 500);
              for (const order of orders ?? []) if (order.user_id) matchedUsers.add(order.user_id);
              if (!orders || orders.length < 1000) break;
            }
            recipientIds = [...matchedUsers];
          }
        }
        const recipients = [...new Set(recipientIds)].map((recipient_id) => ({
          recipient_id, audience: "customer", kind: "store_announcement",
          title, body: message, entity_type: null, entity_id: null,
        }));
        if (!recipients.length) return respond({ success: true, sent_to: 0, segment });
        for (let offset = 0; offset < recipients.length; offset += 500) {
          const { error: insertError } = await admin.from("baran_notifications").insert(recipients.slice(offset, offset + 500));
          if (insertError) {
            console.error("baran-admin: announcement insert failed", insertError.message);
            return respond({ error: "تعذر إرسال الإعلان بالكامل. راجع سجل الإدارة قبل إعادة المحاولة لتجنب التكرار." }, 500);
          }
        }
        await admin.from("admin_audit_log").insert({
          admin_id: user.id, action: "broadcast_announcement",
          entity_type: "baran_notifications",
          details: { title, recipients: recipients.length, segment },
        });
        return respond({ success: true, sent_to: recipients.length, segment });
      }

      if (body.action === "recovery_search") {
        const query = typeof body.search_query === "string" ? body.search_query.trim() : "";
        if (query.length < 3 || query.length > 120) return respond({ error: "اكتب 3 أحرف على الأقل للبحث عن الزبون." }, 400);
        let candidates: Array<{ id: string; full_name?: string | null; phone?: string | null; created_at?: string | null }> = [];
        if (query.includes("@")) {
          const { data: usersPage, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
          if (usersError) return respond({ error: "تعذر البحث عن الحساب." }, 500);
          const match = (usersPage.users ?? []).find((item) => (item.email ?? "").toLowerCase() === query.toLowerCase());
          if (match) {
            const { data: profile } = await admin.from("profiles").select("id,full_name,phone,created_at").eq("id", match.id).maybeSingle();
            candidates = [profile ?? { id: match.id, full_name: null, phone: null, created_at: match.created_at }];
          }
        } else {
          const safeQuery = query.replace(/[%,().]/g, " ").replace(/\s+/g, " ").trim();
          if (safeQuery.length < 3) return respond({ error: "عبارة البحث غير صالحة." }, 400);
          const { data: profiles, error: profileError } = await admin.from("profiles")
            .select("id,full_name,phone,created_at")
            .or("full_name.ilike.%" + safeQuery + "%,phone.ilike.%" + safeQuery + "%")
            .order("created_at", { ascending: false }).limit(10);
          if (profileError) return respond({ error: "تعذر البحث عن حسابات الزبائن." }, 500);
          candidates = profiles ?? [];
        }
        const enrichedCandidates = await Promise.all(candidates.map(async (candidate) => {
          const [{ data: authResult }, { data: orders }, { data: deposits }] = await Promise.all([
            admin.auth.admin.getUserById(candidate.id),
            admin.from("orders").select("id,product_code,player_id,quantity,status,created_at,total_price_usd,total_price_syp")
              .eq("user_id", candidate.id).order("created_at", { ascending: false }).limit(5),
            admin.from("deposit_requests").select("amount,currency,transfer_reference,status,created_at")
              .eq("user_id", candidate.id).order("created_at", { ascending: false }).limit(5),
          ]);
          return { id: candidate.id, full_name: candidate.full_name ?? null, phone: candidate.phone ?? null,
            created_at: candidate.created_at ?? null, customer_email: authResult?.user?.email ?? null,
            orders: orders ?? [], deposits: deposits ?? [] };
        }));
        return respond({ customers: enrichedCandidates });
      }

      if (body.action === "recovery_send_reset") {
        const targetId = body.target_user_id;
        const notes = typeof body.verification_notes === "string" ? body.verification_notes.trim() : "";
        const allowedFacts = ["old_transfer_reference","previous_order_details","player_id","deposit_amount_date","account_creation_details"];
        const facts = Array.isArray(body.verified_facts)
          ? [...new Set(body.verified_facts.filter((fact): fact is string => typeof fact === "string" && allowedFacts.includes(fact)))]
          : [];
        if (typeof targetId !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetId) ||
            notes.length < 30 || notes.length > 2000 || facts.length < 2) {
          return respond({ error: "يلزم تحديد الحساب وتوثيق ملاحظات التحقق واختيار حقيقتين مستقلتين على الأقل." }, 400);
        }
        const { data: targetData, error: targetError } = await admin.auth.admin.getUserById(targetId);
        const target = targetData?.user;
        if (targetError || !target?.email) return respond({ error: "لم يتم العثور على حساب ببريد مسجل." }, 404);
        const { data: recentReset, error: recentError } = await admin.from("account_recovery_audit")
          .select("created_at").eq("target_user_id", targetId).eq("action", "password_reset_sent")
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (recentError) return respond({ error: "تعذر التحقق من سجل الاستعادة." }, 500);
        if (recentReset && Date.now() - new Date(recentReset.created_at).getTime() < 60_000) {
          return respond({ error: "تم إرسال رابط لهذا الحساب مؤخراً. انتظر دقيقة قبل إعادة الإرسال." }, 429);
        }
        const redirectTo = origin === "https://eyadooon-cmyk.github.io" ? "https://eyadooon-cmyk.github.io/Baran-Game/" : "https://baran-game.pages.dev/";
        const { error: resetError } = await userClient.auth.resetPasswordForEmail(target.email, { redirectTo });
        if (resetError) {
          console.error("baran-admin: password reset email failed", resetError.message);
          return respond({ error: "تعذر إرسال رابط الاستعادة إلى البريد المسجل." }, 502);
        }
        const { data: auditRow, error: auditError } = await admin.from("account_recovery_audit").insert({
          target_user_id: targetId, admin_id: user.id, action: "password_reset_sent", target_email: target.email,
          verified_facts: facts, verification_notes: notes,
        }).select("id,created_at,target_email,verified_facts,verification_notes").single();
        if (auditError) {
          console.error("baran-admin: recovery audit insert failed", auditError.message);
          return respond({ error: "أُرسل الرابط لكن تعذر حفظ سجل التدقيق. راجع سجل الوظيفة قبل إعادة الإرسال." }, 500);
        }
        return respond({ recovery: auditRow, message: "تم إرسال رابط إعادة التعيين إلى البريد المسجل." });
      }

      if (body.action === "feedback_mark_read") {
        const id = body.feedback_id;
        if (typeof id !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
          return respond({ error: "معرّف تذكرة الدعم غير صحيح." }, 400);
        }
        const { data: updated, error: readError } = await admin.from("customer_feedback")
          .update({ admin_read_at: new Date().toISOString() })
          .eq("id", id).eq("feedback_type", "support").is("admin_read_at", null)
          .select("id,admin_read_at").maybeSingle();
        if (readError) {
          console.error("baran-admin: support ticket read update failed", readError.message);
          return respond({ error: "تعذر تحديد تذكرة الدعم كمقروءة." }, 500);
        }
        return respond({ success: true, feedback: updated ?? null });
      }

      if (body.action === "support_ticket_delete") {
        const id = body.feedback_id;
        if (typeof id !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
          return respond({ error: "معرّف تذكرة الدعم غير صحيح." }, 400);
        }
        const { data: deleted, error: deleteError } = await admin.rpc("admin_delete_support_ticket", {
          p_admin_id: user.id,
          p_feedback_id: id,
        });
        if (deleteError) {
          console.error("baran-admin: support ticket delete failed", deleteError.message, deleteError.code);
          const status = deleteError.code === "P0002" ? 404 : deleteError.code === "42501" ? 403 : 500;
          return respond({ error: status === 404 ? "تذكرة الدعم غير موجودة." :
            status === 403 ? "صلاحية المدير غير كافية." : "تعذر حذف تذكرة الدعم." }, status);
        }
        return respond({ success: true, deleted });
      }

      if (body.action === "feedback_update") {
        const id = body.feedback_id;
        const nextStatus = body.feedback_status;
        const reply = typeof body.admin_reply === "string" ? body.admin_reply.trim() : "";
        if (typeof id !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ||
            typeof nextStatus !== "string" || reply.length > 2000) {
          return respond({ error: "بيانات تحديث الرسالة غير صحيحة." }, 400);
        }
        const { data: updated, error: updateError } = await admin.rpc("admin_update_customer_feedback", {
          p_admin_id: user.id,
          p_feedback_id: id,
          p_status: nextStatus,
          p_reply: reply,
        });
        if (updateError) {
          console.error("baran-admin: feedback transaction failed", updateError.message, updateError.code);
          const status = updateError.code === "P0002" ? 404 :
            updateError.code === "42501" ? 403 :
            updateError.code === "22023" ? 400 : 500;
          return respond({ error: status === 404 ? "الرسالة غير موجودة." :
            status === 403 ? "صلاحية المدير غير كافية." :
            status === 400 ? "حالة غير مناسبة لنوع الرسالة أو بيانات غير صحيحة." :
            "تعذر حفظ الرد وتسجيل العملية." }, status);
        }
        return respond({ feedback: updated, notification_created: updated?.notification_created === true, audit_logged: true });
      }

      if (body.action === "pricing_policy_update") {
        const marketRate = body.market_exchange_rate;
        const fxBuffer = body.fx_buffer_percent;
        const productMarkup = body.product_markup_percent;
        if (typeof marketRate !== "number" || !Number.isFinite(marketRate) || marketRate <= 0 || marketRate > 100000000 ||
            typeof fxBuffer !== "number" || !Number.isFinite(fxBuffer) || fxBuffer < 0 || fxBuffer > 25 ||
            typeof productMarkup !== "number" || !Number.isFinite(productMarkup) || productMarkup < 0 || productMarkup > 100) {
          return respond({ error: "تحقق من سعر السوق وفرق التحويل والزيادة على تكلفة المنتج." }, 400);
        }
        const { data: pricingPolicy, error: pricingPolicyError } = await admin.rpc("admin_update_pricing_policy", {
          p_admin_id: user.id,
          p_market_exchange_rate: marketRate,
          p_fx_buffer_percent: fxBuffer,
          p_product_markup_percent: productMarkup,
        });
        if (pricingPolicyError) {
          console.error("baran-admin: pricing policy update failed", pricingPolicyError.message);
          return respond({ error: pricingPolicyError.message || "تعذر حفظ سياسة التسعير." }, 400);
        }
        return respond({ pricing_policy: pricingPolicy });
      }

      if (body.action === "exchange_rate_update") {
        const rate = body.exchange_rate;
        if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0 || rate > 100000000) {
          return respond({ error: "أدخل سعر صرف صحيحاً أكبر من صفر." }, 400);
        }
        const { data: settings, error: rateError } = await admin
          .from("store_settings")
          .update({ exchange_rate: rate, updated_at: new Date().toISOString(), updated_by: user.id })
          .eq("id", "main")
          .select("exchange_rate,updated_at")
          .single();
        if (rateError) {
          console.error("baran-admin: exchange rate update failed", rateError.message);
          return respond({ error: "تعذر تحديث سعر الصرف." }, 400);
        }
        return respond({ exchange_rate: Number(settings.exchange_rate), updated_at: settings.updated_at });
      }

      if (body.action === "product_bulk_save") {
        if (!Array.isArray(body.products) || body.products.length < 1 || body.products.length > 30) {
          return respond({ error: "أرسل من 1 إلى 30 منتجاً." }, 400);
        }
        const categories = ["game", "ai", "vpn", "gift_card", "app"];
        const { data: settings, error: settingsError } = await admin
          .from("store_settings").select("exchange_rate").eq("id", "main").single();
        if (settingsError) return respond({ error: "تعذر قراءة سعر الصرف الحالي." }, 500);
        const results: Array<{ product_code: string; status: string; name?: string }> = [];
        for (const item of body.products) {
          const code = typeof item?.product_code === "string" ? item.product_code.trim().toUpperCase() : "";
          const name = typeof item?.name === "string" ? item.name.trim() : "";
          const description = typeof item?.description === "string" ? item.description.trim() : "";
          const category = item?.category;
          const sortOrder = item?.sort_order ?? 100;
          if (!/^[A-Z0-9][A-Z0-9_-]{1,59}$/.test(code) || name.length < 2 || name.length > 120 ||
              description.length > 500 || !categories.includes(category) ||
              !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100000) {
            results.push({ product_code: code || "غير معروف", status: "invalid" });
            continue;
          }
          const { data: existing, error: lookupError } = await admin.from("products")
            .select("product_code").eq("product_code", code).maybeSingle();
          if (lookupError) {
            results.push({ product_code: code, status: "error" });
            continue;
          }
          if (existing) {
            results.push({ product_code: code, status: "skipped_duplicate", name });
            continue;
          }
          const { error: insertError } = await admin.from("products").insert({
            product_code: code, category, name, description,
            price_usd: null, price_syp: null, is_active: item?.is_active !== false,
            sort_order: sortOrder, updated_at: new Date().toISOString()
          });
          results.push({ product_code: code, status: insertError ? "error" : "created", name });
          if (insertError) console.error("baran-admin: bulk product insert failed", code, insertError.message);
        }
        const created = results.filter((x) => x.status === "created").length;
        const skipped = results.filter((x) => x.status === "skipped_duplicate").length;
        const failed = results.filter((x) => x.status !== "created" && x.status !== "skipped_duplicate").length;
        return respond({ results, created, skipped, failed, exchange_rate: Number(settings.exchange_rate) });
      }

      if (body.action === "product_save") {
        const categories = ["game", "ai", "vpn", "gift_card", "app"];
        const code = typeof body.product_code === "string" ? body.product_code.trim().toUpperCase() : "";
        const name = typeof body.name === "string" ? body.name.trim() : "";
        const description = typeof body.description === "string" ? body.description.trim() : "";
        const usd = body.price_usd === null || body.price_usd === undefined || body.price_usd === "" ? null : body.price_usd;
        const markupPercent = body.markup_percent === undefined ? 4 : Number(body.markup_percent);
        const sortOrder = body.sort_order ?? 100;
        const { data: settings, error: settingsError } = await admin
          .from("store_settings").select("exchange_rate").eq("id", "main").single();
        if (settingsError) {
          console.error("baran-admin: exchange rate lookup failed", settingsError.message);
          return respond({ error: "تعذر قراءة سعر الصرف الحالي." }, 500);
        }
        const syp = usd === null ? null : Math.round(Number(usd) * Number(settings.exchange_rate));
        if (!/^[A-Z0-9][A-Z0-9_-]{1,59}$/.test(code)) {
          return respond({ error: "رمز المنتج يجب أن يكون من 2 إلى 60 حرفاً إنجليزياً أو رقماً." }, 400);
        }
        if (!categories.includes(body.category ?? "")) return respond({ error: "اختر تصنيفاً صحيحاً." }, 400);
        if (name.length < 2 || name.length > 120 || description.length > 500) {
          return respond({ error: "تحقق من اسم المنتج والوصف." }, 400);
        }
        if ((usd !== null && (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0 || usd > 100000000)) ||
            !Number.isFinite(markupPercent) || markupPercent < 0 || markupPercent > 100 ||
            !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100000) {
          return respond({ error: "إذا توفر السعر فأدخل قيمة صحيحة أكبر من صفر، وتحقق من ترتيب العرض." }, 400);
        }
        const values = {
          product_code: code,
          category: body.category,
          name,
          description,
          price_usd: usd,
          price_syp: syp,
          markup_percent: markupPercent,
          is_active: body.is_active !== false,
          sort_order: sortOrder,
          updated_at: new Date().toISOString(),
        };
        let saved;
        let saveError;
        if (body.product_id) {
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.product_id)) {
            return respond({ error: "معرّف المنتج غير صحيح." }, 400);
          }
          const result = await admin.from("products").update(values).eq("id", body.product_id)
            .select("id,product_code,category,name,description,price_usd,price_syp,markup_percent,is_active,sort_order,created_at,updated_at").single();
          saved = result.data;
          saveError = result.error;
        } else {
          const result = await admin.from("products").insert(values)
            .select("id,product_code,category,name,description,price_usd,price_syp,is_active,sort_order,created_at,updated_at").single();
          saved = result.data;
          saveError = result.error;
        }
        if (saveError) {
          console.error("baran-admin: product save failed", saveError.message);
          const duplicate = saveError.code === "23505";
          return respond({ error: duplicate ? "رمز المنتج مستخدم مسبقاً." : "تعذر حفظ المنتج." }, duplicate ? 409 : 400);
        }
        return respond({ product: saved });
      }

      if (body.action === "product_status") {
        if (typeof body.product_id !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.product_id) ||
            typeof body.is_active !== "boolean") {
          return respond({ error: "بيانات حالة المنتج غير صحيحة." }, 400);
        }
        const { data: updated, error: statusError } = await admin.from("products")
          .update({ is_active: body.is_active, updated_at: new Date().toISOString() })
          .eq("id", body.product_id)
          .select("id,is_active")
          .single();
        if (statusError) {
          console.error("baran-admin: product status failed", statusError.message);
          return respond({ error: "تعذر تحديث حالة المنتج." }, 400);
        }
        return respond({ product: updated });
      }

      if (body.action === "supplier_api_config_save") {
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (typeof body.supplier_id !== "string" || !uuidPattern.test(body.supplier_id) ||
            typeof body.adapter_key !== "string" ||
            (body.api_base_url !== null && body.api_base_url !== undefined && typeof body.api_base_url !== "string") ||
            (body.low_balance_threshold !== undefined && (typeof body.low_balance_threshold !== "number" || !Number.isFinite(body.low_balance_threshold))) ||
            !["USD","SYP"].includes(body.balance_currency ?? "")) {
          return respond({ error: "تحقق من بيانات إعداد ربط المورد." }, 400);
        }
        const { data, error } = await admin.rpc("baran_admin_save_supplier_api_config", {
          p_admin_id: user.id,
          p_supplier_id: body.supplier_id,
          p_adapter_key: body.adapter_key,
          p_api_base_url: body.api_base_url ?? null,
          p_health_path: body.health_path ?? null,
          p_balance_path: body.balance_path ?? null,
          p_create_order_path: body.create_order_path ?? null,
          p_order_status_path: body.order_status_path ?? null,
          p_auth_secret_name: body.auth_secret_name ?? null,
          p_auth_header_name: body.auth_header_name ?? "Authorization",
          p_auth_prefix: body.auth_prefix ?? "Bearer ",
          p_low_balance_threshold: body.low_balance_threshold ?? 0,
          p_balance_currency: body.balance_currency,
          p_integration_enabled: body.integration_enabled === true,
        });
        if (error) {
          console.error("baran-admin: supplier API config save failed", error.message);
          return respond({ error: error.message || "تعذر حفظ إعدادات الربط." }, 400);
        }
        return respond({ supplier_integration_config: data });
      }

      if (body.action === "supplier_api_simulate") {
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (typeof body.supplier_id !== "string" || !uuidPattern.test(body.supplier_id)) {
          return respond({ error: "اختر مورداً صحيحاً للفحص." }, 400);
        }
        const { data, error } = await admin.rpc("baran_admin_supplier_simulation", {
          p_admin_id: user.id, p_supplier_id: body.supplier_id,
        });
        if (error) {
          console.error("baran-admin: supplier simulation failed", error.message);
          return respond({ error: error.message || "تعذر إجراء الفحص التجريبي." }, 400);
        }
        return respond({ simulation: data });
      }

      if (body.action === "supplier_order_refund") {
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        const reason = typeof body.failure_reason === "string" ? body.failure_reason.trim() : "";
        if (typeof body.order_id !== "string" || !uuidPattern.test(body.order_id) ||
            reason.length < 3 || reason.length > 500) {
          return respond({ error: "يجب تحديد الطلب وسبب الفشل المؤكد." }, 400);
        }
        const { data, error } = await admin.rpc("baran_refund_failed_supplier_order_authorized", {
          p_order_id: body.order_id, p_reason: reason, p_actor_id: user.id,
        });
        if (error) {
          console.error("baran-admin: supplier order refund failed", error.message);
          return respond({ error: error.message || "تعذر إعادة المبلغ." }, 400);
        }
        return respond({ refund: data });
      }

      if (body.action === "supplier_save") {
        const name = typeof body.supplier_name === "string" ? body.supplier_name.trim() : "";
        const contactName = typeof body.contact_name === "string" ? body.contact_name.trim() : "";
        const phone = typeof body.contact_phone === "string" ? body.contact_phone.trim() : "";
        const email = typeof body.contact_email === "string" ? body.contact_email.trim() : "";
        const notes = typeof body.notes === "string" ? body.notes.trim() : "";
        if (name.length < 2 || name.length > 120 || contactName.length > 120 || phone.length > 40 ||
            email.length > 254 || notes.length > 2000 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
          return respond({ error: "تحقق من اسم المورد وبيانات التواصل." }, 400);
        }
        const values = { name, contact_name: contactName || null, contact_phone: phone || null,
          contact_email: email || null, notes, is_active: body.is_active !== false, updated_at: new Date().toISOString() };
        const result = body.supplier_id
          ? await admin.from("suppliers").update(values).eq("id",body.supplier_id).select("*").single()
          : await admin.from("suppliers").insert(values).select("*").single();
        if (result.error) return respond({ error: "تعذر حفظ المورد." }, 400);
        await admin.from("admin_audit_log").insert({admin_id:user.id,action:"supplier_save",entity_type:"supplier",
          entity_id:result.data.id,details:{name}});
        return respond({ supplier: result.data });
      }

      if (body.action === "supplier_product_save") {
        if (typeof body.supplier_id !== "string" || typeof body.product_id !== "string" ||
            typeof body.unit_cost !== "number" || !Number.isFinite(body.unit_cost) || body.unit_cost < 0 ||
            !["USD","SYP"].includes(body.currency ?? "") ||
            (body.supplier_sku ?? "").toString().length > 120 ||
            (body.notes ?? "").toString().length > 1000) {
          return respond({ error: "بيانات سعر المورد غير صحيحة." }, 400);
        }
        const rawSchema=body.input_schema??[];
        if(!Array.isArray(rawSchema)||rawSchema.length>12)return respond({error:"يمكن تعريف 12 حقلاً كحد أقصى."},400);
        const allowedFieldKeys=new Set(["key","label","type","required","placeholder","min_length","max_length","options"]);
        const seenFieldKeys=new Set<string>();
        const inputSchema=[];
        for(const field of rawSchema){
          if(!field||typeof field!=="object"||Array.isArray(field)||Object.keys(field).some((key)=>!allowedFieldKeys.has(key))||
             typeof field.key!=="string"||!/^[a-z][a-z0-9_]{1,39}$/.test(field.key)||seenFieldKeys.has(field.key)||
             typeof field.label!=="string"||field.label.trim().length<2||field.label.trim().length>60||
             !["text","number","email","select"].includes(field.type)||
             (field.required!==undefined&&typeof field.required!=="boolean")||
             (field.placeholder!==undefined&&(typeof field.placeholder!=="string"||field.placeholder.length>80))||
             (field.min_length!==undefined&&(!Number.isInteger(field.min_length)||field.min_length<0||field.min_length>200))||
             (field.max_length!==undefined&&(!Number.isInteger(field.max_length)||field.max_length<1||field.max_length>200))||
             (field.min_length!==undefined&&field.max_length!==undefined&&field.min_length>field.max_length)||
             (field.type==="select"&&(!Array.isArray(field.options)||field.options.length<1||field.options.length>30||field.options.some((option:any)=>typeof option!=="string"||option.trim().length<1||option.length>60)))||
             (field.type!=="select"&&field.options!==undefined)){
            return respond({error:"تعريف أحد حقول الطلب غير صالح. راجع key وlabel وtype والخيارات."},400);
          }
          seenFieldKeys.add(field.key);
          inputSchema.push({key:field.key,label:field.label.trim(),type:field.type,required:field.required===true,
            ...(field.placeholder?{placeholder:field.placeholder}:{}),
            ...(field.min_length!==undefined?{min_length:field.min_length}:{}),
            ...(field.max_length!==undefined?{max_length:field.max_length}:{}),
            ...(field.type==="select"?{options:field.options.map((option:string)=>option.trim())}:{})});
        }
        const values = { supplier_id:body.supplier_id, product_id:body.product_id,
          supplier_sku:(body.supplier_sku ?? "").toString().trim() || null,
          unit_cost:body.unit_cost, currency:body.currency, is_preferred:body.is_preferred === true,
          lead_time_hours: Number.isInteger(body.lead_time_hours) && (body.lead_time_hours ?? -1) >= 0 ? body.lead_time_hours : null,
          notes:(body.notes ?? "").toString().trim(), input_schema:inputSchema, updated_at:new Date().toISOString() };
        const result = await admin.from("supplier_products").upsert(values,{onConflict:"supplier_id,product_id"})
          .select("id,supplier_id,product_id,supplier_sku,unit_cost,currency,is_preferred,lead_time_hours,notes,input_schema,updated_at").single();
        if (result.error) return respond({ error: "تعذر حفظ سعر المورد. تأكد من المورد والمنتج." }, 400);
        await admin.from("admin_audit_log").insert({admin_id:user.id,action:"supplier_product_save",entity_type:"product",
          entity_id:body.product_id,details:{supplier_id:body.supplier_id,unit_cost:body.unit_cost,currency:body.currency}});
        return respond({ supplier_product:result.data });
      }

      if (body.action === "order_fulfillment_update") {
        const allowedSupplierStatuses = ["not_sent","sent","accepted","processing","completed","failed"];
        if (typeof body.order_id !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.order_id) ||
            (body.supplier_id !== null && body.supplier_id !== undefined &&
              (typeof body.supplier_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.supplier_id))) ||
            !allowedSupplierStatuses.includes(body.supplier_status ?? "") ||
            (body.supplier_reference ?? "").toString().length > 160 ||
            (body.internal_notes ?? "").toString().length > 2000 ||
            (body.supplier_unit_cost !== null && body.supplier_unit_cost !== undefined &&
              (typeof body.supplier_unit_cost !== "number" || !Number.isFinite(body.supplier_unit_cost) || body.supplier_unit_cost < 0)) ||
            (body.supplier_unit_cost !== null && body.supplier_unit_cost !== undefined &&
              !["USD","SYP"].includes(body.supplier_cost_currency ?? ""))) {
          return respond({ error:"بيانات متابعة المورد غير صحيحة." },400);
        }
        const { data: orderRow, error: orderLookupError } = await admin.from("orders")
          .select("id,quantity,exchange_rate").eq("id",body.order_id).maybeSingle();
        if (orderLookupError || !orderRow) return respond({error:"الطلب غير موجود أو تعذر قراءته."},404);
        let costRate: number | null = null;
        let totalCost: number | null = null;
        const unitCost = body.supplier_unit_cost === null || body.supplier_unit_cost === undefined
          ? null : body.supplier_unit_cost;
        const costCurrency = unitCost === null ? null : body.supplier_cost_currency!;
        if (unitCost !== null) {
          costRate = Number(orderRow.exchange_rate || 0);
          if (!Number.isFinite(costRate) || costRate <= 0) {
            const { data: rateRow, error: rateLookupError } = await admin.from("store_settings")
              .select("exchange_rate").eq("id","main").single();
            if (rateLookupError || !rateRow || Number(rateRow.exchange_rate) <= 0)
              return respond({error:"تعذر تحديد سعر الصرف لحفظ تكلفة المورد."},500);
            costRate = Number(rateRow.exchange_rate);
          }
          totalCost = Number((unitCost * Number(orderRow.quantity)).toFixed(4));
        }
        const result = await admin.from("order_fulfillment").upsert({
          order_id:body.order_id,supplier_id:body.supplier_id ?? null,
          supplier_reference:(body.supplier_reference ?? "").toString().trim() || null,
          supplier_status:body.supplier_status,
          internal_notes:(body.internal_notes ?? "").toString().trim(),
          supplier_unit_cost:unitCost,supplier_total_cost:totalCost,
          supplier_cost_currency:costCurrency,supplier_cost_exchange_rate:costRate,
          dispatch_state:body.supplier_status==="failed"?"failed":body.supplier_status==="completed"?"succeeded":body.supplier_status==="not_sent"?"not_queued":"awaiting_result",
          refund_status:body.supplier_status==="failed"?"pending":"not_required",
          failure_reason:body.supplier_status==="failed"?(body.internal_notes||"تم تأكيد فشل التنفيذ") : null,
          updated_by:user.id,updated_at:new Date().toISOString()
        },{onConflict:"order_id"}).select("order_id,supplier_id,supplier_reference,supplier_status,internal_notes,supplier_unit_cost,supplier_total_cost,supplier_cost_currency,supplier_cost_exchange_rate,updated_at").single();
        if(result.error) return respond({error:"تعذر حفظ متابعة المورد."},400);
        await admin.from("admin_audit_log").insert({admin_id:user.id,action:"order_fulfillment_update",
          entity_type:"order",entity_id:body.order_id,details:{supplier_id:body.supplier_id ?? null,
          supplier_status:body.supplier_status,supplier_unit_cost:unitCost,
          supplier_total_cost:totalCost,supplier_cost_currency:costCurrency,
          supplier_cost_exchange_rate:costRate}});
        return respond({fulfillment:result.data, refund_available:body.supplier_status==="failed"});
      }

      if (body.action === "order_status_update") {
        if (typeof body.order_id !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.order_id) ||
            typeof body.new_status !== "string") return respond({ error:"بيانات تحديث الطلب غير صحيحة." },400);
        const { data, error } = await admin.rpc("admin_update_order_status",{
          p_admin_id:user.id,p_order_id:body.order_id,p_new_status:body.new_status,
          p_customer_message:typeof body.customer_message==="string"?body.customer_message.trim():""
        });
        if(error) return respond({ error:error.message },400);
        return respond({ order:data });
      }

      if (body.action === "loyalty_adjust") {
        if (typeof body.target_user_id !== "string" || typeof body.points_delta !== "number" ||
            !Number.isInteger(body.points_delta) || typeof body.description !== "string") {
          return respond({ error:"بيانات تعديل النقاط غير صحيحة." },400);
        }
        const { data, error } = await admin.rpc("admin_adjust_loyalty",{
          p_admin_id:user.id,p_user_id:body.target_user_id,p_points:body.points_delta,
          p_description:body.description.trim()
        });
        if(error) return respond({ error:error.message },400);
        return respond({ loyalty:data });
      }

      if (body.action === "treasury_add") {
        const allowedTypes = ["opening_balance","capital_in","capital_out","cash_in","cash_out","transfer_in","transfer_out","correction_in","correction_out"];
        if (!allowedTypes.includes(body.treasury_entry_type ?? "")) return respond({ error: "نوع حركة الخزينة غير صحيح." }, 400);
        if (!["USD","SYP"].includes(body.currency ?? "")) return respond({ error: "العملة غير صحيحة." }, 400);
        if (typeof body.title !== "string" || body.title.trim().length < 2 || body.title.trim().length > 160)
          return respond({ error: "اكتب وصفاً من حرفين إلى 160 حرفاً." }, 400);
        if (typeof body.amount !== "number" || !Number.isFinite(body.amount) || body.amount <= 0)
          return respond({ error: "أدخل مبلغاً صحيحاً أكبر من صفر." }, 400);
        if (body.reference !== undefined && (typeof body.reference !== "string" || body.reference.length > 120))
          return respond({ error: "المرجع يجب ألا يتجاوز 120 حرفاً." }, 400);
        if (body.notes !== undefined && (typeof body.notes !== "string" || body.notes.length > 500))
          return respond({ error: "الملاحظات يجب ألا تتجاوز 500 حرف." }, 400);
        const { data: entry, error } = await admin.rpc("admin_treasury_add", {
          p_admin_id: user.id, p_entry_type: body.treasury_entry_type,
          p_title: body.title.trim(), p_amount: body.amount, p_currency: body.currency,
          p_reference: body.reference ?? null, p_notes: body.notes ?? "",
        });
        if (error) return respond({ error: error.message }, 400);
        return respond({ entry });
      }

      if (body.action === "finance_add") {
        if (!["capital", "sale", "expense"].includes(body.entry_type ?? "")) {
          return respond({ error: "Invalid finance entry type" }, 400);
        }
        if (!["USD", "SYP"].includes(body.currency ?? "")) {
          return respond({ error: "Invalid currency" }, 400);
        }
        if (typeof body.title !== "string" || body.title.trim().length < 2 || body.title.trim().length > 160) {
          return respond({ error: "اكتب وصفاً من حرفين إلى 160 حرفاً." }, 400);
        }
        const isSale = body.entry_type === "sale";
        if (isSale) {
          if (typeof body.product_name !== "string" || body.product_name.trim().length < 1 ||
              body.product_name.trim().length > 160 ||
              !Number.isInteger(body.quantity) || (body.quantity ?? 0) < 1 ||
              typeof body.unit_sale_price !== "number" || !Number.isFinite(body.unit_sale_price) || body.unit_sale_price <= 0 ||
              typeof body.unit_cost_price !== "number" || !Number.isFinite(body.unit_cost_price) || body.unit_cost_price < 0) {
            return respond({ error: "بيانات البيع أو تكلفة الشراء غير صحيحة." }, 400);
          }
        } else if (typeof body.amount !== "number" || !Number.isFinite(body.amount) || body.amount <= 0) {
          return respond({ error: "أدخل مبلغاً صحيحاً أكبر من صفر." }, 400);
        }

        const { data: entry, error: financeAddError } = await admin.rpc("admin_finance_add", {
          p_admin_id: user.id,
          p_entry_type: body.entry_type,
          p_title: body.title.trim(),
          p_product_name: isSale ? body.product_name!.trim() : null,
          p_amount: isSale ? null : body.amount,
          p_quantity: isSale ? body.quantity : null,
          p_unit_sale_price: isSale ? body.unit_sale_price : null,
          p_unit_cost_price: isSale ? body.unit_cost_price : null,
          p_currency: body.currency,
        });
        if (financeAddError) {
          console.error("baran-admin: finance add failed", financeAddError.message);
          return respond({ error: financeAddError.message }, 400);
        }
        return respond({ entry });
      }

      if (!body.request_id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.request_id)) {
        return respond({ error: "Invalid request ID" }, 400);
      }
      if (body.decision !== "approved" && body.decision !== "rejected") {
        return respond({ error: "Invalid decision" }, 400);
      }

      // The owner/admin gateway has already authenticated the user.
      // This RPC is now executable only by service_role and independently checks admin membership for p_reviewer_id.
      const { data, error } = await admin.rpc("admin_review_deposit", {
        p_request_id: body.request_id,
        p_decision: body.decision,
        p_reviewer_id: user.id,
      });
      if (error) {
        const conflict = /already reviewed/i.test(error.message);
        return respond({ error: conflict ? "This request has already been reviewed" : error.message }, conflict ? 409 : 400);
      }
      return respond(data);
    }

    return respond({ error: "Method not allowed" }, 405);
  } catch (error) {
    console.error("baran-admin request failed", error instanceof Error ? error.message : String(error));
    return respond({ error: "Unexpected server error" }, 500);
  }
});
