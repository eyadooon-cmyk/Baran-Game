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

function readKeyObject(name: string): string | undefined {
  const raw = Deno.env.get(name);
  if (!raw) return undefined;
  try { return JSON.parse(raw).default; } catch { return undefined; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

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
      return json({ error: "Server configuration is incomplete" }, 500);
    }

    console.log("baran-admin: configuration loaded", { hasSecretKey: Boolean(secretKey) });
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return json({ error: "Authentication required" }, 401);

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    const user = authData?.user;
    if (authError || !user) { console.error("baran-admin: auth failed", authError?.message ?? "missing user"); return json({ error: "Invalid session" }, 401); }
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

    if (adminError) { console.error("baran-admin: admin check failed", adminError.message); return json({ error: "Could not verify administrator" }, 500); }
    console.log("baran-admin: admin check completed", { isAdmin: isAdmin === true });
    if (isAdmin !== true) return json({ error: "Administrator access required" }, 403);

    if (req.method === "GET") {
      const { data: requests, error } = await admin
        .from("deposit_requests")
        .select("id,user_id,amount,currency,transfer_reference,receipt_path,status,created_at,request_source")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) { console.error("baran-admin: deposit query failed", error.message, error.code); return json({ error: "Could not load deposit requests" }, 500); }
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
        .select("id,user_id,feedback_type,ticket_code,subject,message,rating,order_id,status,admin_reply,admin_read_at,created_at,updated_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (feedbackError) {
        console.error("baran-admin: feedback query failed", feedbackError.message);
        return json({ error: "Could not load customer feedback" }, 500);
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
        return json({ error: "تعذر تحميل سجل الردود الآلية." }, 500);
      }
      const { data: finance, error: financeError } = await admin.rpc("admin_finance_data", {
        p_admin_id: user.id,
      });
      if (financeError) {
        console.error("baran-admin: finance data failed", financeError.message);
        return json({ error: "Could not load finance data" }, 500);
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
        return json({ error: "فترة التقرير غير صحيحة." }, 400);
      }
      const { data: productReport, error: productReportError } = await admin.rpc(
        "admin_finance_product_report",
        { p_admin_id: user.id, p_month: reportMonth, p_year: reportYear },
      );
      if (productReportError) {
        console.error("baran-admin: product report failed", productReportError.message);
        return json({ error: "تعذر تحميل تقرير أرباح المنتجات." }, 500);
      }
      const financeWithReport = {
        ...finance,
        product_report: productReport ?? [],
        product_report_month: reportMonth,
        product_report_year: reportYear,
      };
      const { data: products, error: productsError } = await admin
        .from("products")
        .select("id,product_code,category,name,description,price_usd,price_syp,is_active,sort_order,created_at,updated_at")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });
      if (productsError) {
        console.error("baran-admin: products query failed", productsError.message);
        return json({ error: "Could not load products" }, 500);
      }
      const { data: settings, error: settingsError } = await admin
        .from("store_settings")
        .select("exchange_rate,updated_at")
        .eq("id", "main")
        .single();
      if (settingsError) {
        console.error("baran-admin: exchange rate query failed", settingsError.message);
        return json({ error: "Could not load exchange rate" }, 500);
      }
      const { data: recoveryAudit, error: recoveryAuditError } = await admin
        .from("account_recovery_audit")
        .select("id,target_user_id,admin_id,action,target_email,verified_facts,verification_notes,created_at")
        .order("created_at", { ascending: false })
        .limit(30);
      if (recoveryAuditError) {
        console.error("baran-admin: recovery audit query failed", recoveryAuditError.message);
        return json({ error: "Could not load account recovery history" }, 500);
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
        return json({ error: "Could not load admin notifications" }, 500);
      }
      const [{ data: suppliers, error: suppliersError }, { data: supplierProducts, error: supplierProductsError },
        { data: orders, error: ordersError }, { data: fulfillmentRows, error: fulfillmentError },
        { data: loyaltyRows, error: loyaltyError }, { count: userCount, error: userCountError },
        { count: orderCount, error: orderCountError }] = await Promise.all([
          admin.from("suppliers").select("id,name,contact_name,contact_phone,contact_email,notes,is_active,created_at,updated_at").order("name"),
          admin.from("supplier_products").select("id,supplier_id,product_id,supplier_sku,unit_cost,currency,is_preferred,lead_time_hours,notes,updated_at"),
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
        return json({ error: "Could not load store operations dashboard" }, 500);
      }
      // Exclude administrator accounts: this directory is for store customers only.
      const { data: adminRows, error: adminRowsError } = await admin.from("admin_users").select("user_id");
      if (adminRowsError) {
        console.error("baran-admin: administrator directory exclusion failed", adminRowsError.message);
        return json({ error:"تعذر التحقق من حسابات الإدارة." },500);
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
          return json({ error:"تعذر تحميل قائمة الزبائن كاملة." },500);
        }
        customerProfiles.push(...(page ?? []).filter((profile) => !adminUserIds.has(profile.id)));
        if (!page || page.length < customerPageSize) break;
      }

      // Read wallet rows in pages too, so accounts beyond the API row limit keep their balances.
      const customerWalletRows: Array<{user_id:string;balance_usd:number|string|null;balance_syp:number|string|null}> = [];
      for (let from = 0; ; from += customerPageSize) {
        const { data: page, error: walletPageError } = await admin
          .from("wallets")
          .select("user_id,balance_usd,balance_syp")
          .range(from, from + customerPageSize - 1);
        if (walletPageError) {
          console.error("baran-admin: customer wallet lookup failed", walletPageError.message);
          return json({ error: "تعذر تحميل أرصدة الزبائن." }, 500);
        }
        customerWalletRows.push(...(page ?? []));
        if (!page || page.length < customerPageSize) break;
      }
      const customerWalletByUser = new Map(customerWalletRows.map((wallet) => [wallet.user_id, wallet]));
      const customers = await Promise.all(customerProfiles.map(async (profile) => {
        const { data: authResult, error: authLookupError } = await admin.auth.admin.getUserById(profile.id);
        if (authLookupError) console.error("baran-admin: customer email lookup failed", authLookupError.message);
        const wallet = customerWalletByUser.get(profile.id);
        return { ...profile, email:authResult?.user?.email ?? null,
          balance_usd:Number(wallet?.balance_usd ?? 0), balance_syp:Number(wallet?.balance_syp ?? 0),
          has_balance:Number(wallet?.balance_usd ?? 0) > 0 || Number(wallet?.balance_syp ?? 0) > 0 };
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
      if (orderStatusError) return json({ error: "Could not load order statistics" }, 500);
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
        return json({ error: "تعذر تحميل عدد تذاكر الدعم غير المقروءة." }, 500);
      }
      const { data: auditLog, error: auditLogError } = await admin
        .from("admin_audit_log").select("id,admin_id,action,entity_type,entity_id,details,created_at")
        .order("created_at",{ascending:false}).limit(100);
      if (auditLogError) return json({ error:"Could not load administrator audit log" },500);
      const { count: productCount, error: productCountError } = await admin
        .from("products").select("id",{count:"exact",head:true});
      const { count: supplierCount, error: supplierCountError } = await admin
        .from("suppliers").select("id",{count:"exact",head:true});
      const { data: supplierIntegration, error: supplierIntegrationError } = await admin.rpc(
        "baran_admin_supplier_integration_data", { p_admin_id: user.id },
      );
      if (supplierIntegrationError) {
        console.error("baran-admin: supplier integration data failed", supplierIntegrationError.message);
        return json({ error: "تعذر تحميل إعدادات ربط المورد." }, 500);
      }
      if (productCountError || supplierCountError) return json({ error: "Could not load catalogue statistics" }, 500);
      return json({
        requests: enriched,
        notifications: notifications ?? [],
        feedback: feedbackEnriched,
        auto_support_queue: autoSupportQueue ?? [],
        finance: financeWithReport,
        products: products ?? [],
        customers,
        suppliers: suppliers ?? [],
        supplier_products: supplierProducts ?? [],
        supplier_integration: supplierIntegration ?? {},
        orders: orderCustomers,
        loyalty_customers: loyaltyCustomers,
        audit_log: auditLog ?? [],
        stats: { users: userCount ?? 0, orders: orderCount ?? 0,
          products: productCount ?? 0, suppliers: supplierCount ?? 0,
          order_statuses: statusCounts, pending_orders: statusCounts.pending ?? 0,
          unread_support_tickets: unreadSupportCount ?? 0 },
        recovery_audit: recoveryAudit ?? [],
        exchange_rate: Number(settings.exchange_rate),
        exchange_rate_updated_at: settings.updated_at,
      });
    }

    if (req.method === "POST") {
      let body: {
        action?: string;
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
        product_id?: string;
        product_code?: string;
        category?: string;
        name?: string;
        description?: string;
        price_usd?: number;
        price_syp?: number;
        is_active?: boolean;
        sort_order?: number;
        exchange_rate?: number;
        feedback_id?: string;
        feedback_status?: string;
        admin_reply?: string;
        search_query?: string;
        target_user_id?: string;
        verification_notes?: string;
        verified_facts?: string[];
        notification_id?: string;
        supplier_id?: string;
        supplier_name?: string;
        contact_name?: string;
        contact_phone?: string;
        contact_email?: string;
        notes?: string;
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
      };
      try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

      if (body.action === "admin_check") return json({ success: true });


      if (body.action === "notification_read") {
        const id = body.notification_id;
        if (typeof id !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
          return json({ error: "معرّف التنبيه غير صحيح." }, 400);
        }
        const { data: updated, error: readError } = await admin.from("baran_notifications")
          .update({ read_at: new Date().toISOString() })
          .eq("id", id).eq("recipient_id", user.id).eq("audience", "admin").is("read_at", null)
          .select("id,read_at").maybeSingle();
        if (readError) {
          console.error("baran-admin: notification read update failed", readError.message);
          return json({ error: "تعذر تحديث التنبيه." }, 500);
        }
        return json({ notification: updated ?? null, success: true });
      }

      if (body.action === "broadcast_announcement") {
        const title = typeof body.notification_title === "string" ? body.notification_title.trim() : "";
        const message = typeof body.notification_body === "string" ? body.notification_body.trim() : "";
        if (title.length < 3 || title.length > 100 || message.length < 5 || message.length > 500) {
          return json({ error: "عنوان الإعلان من 3 إلى 100 حرف، ونصه من 5 إلى 500 حرف." }, 400);
        }
        const { data: profiles, error: profilesError } = await admin
          .from("profiles").select("id").limit(5000);
        if (profilesError) {
          console.error("baran-admin: announcement recipients failed", profilesError.message);
          return json({ error: "تعذر تحميل قائمة الزبائن." }, 500);
        }
        const recipients = (profiles ?? []).map((profile) => ({
          recipient_id: profile.id,
          audience: "customer",
          kind: "announcement",
          title,
          body: message,
          entity_type: null,
          entity_id: null,
        }));
        if (!recipients.length) return json({ success: true, sent_to: 0 });
        const { error: insertError } = await admin.from("baran_notifications").insert(recipients);
        if (insertError) {
          console.error("baran-admin: announcement insert failed", insertError.message);
          return json({ error: "تعذر إرسال الإعلان." }, 500);
        }
        await admin.from("admin_audit_log").insert({
          admin_id: user.id,
          action: "broadcast_announcement",
          entity_type: "baran_notifications",
          details: { title, recipients: recipients.length },
        });
        return json({ success: true, sent_to: recipients.length });
      }

      if (body.action === "recovery_search") {
        const query = typeof body.search_query === "string" ? body.search_query.trim() : "";
        if (query.length < 3 || query.length > 120) return json({ error: "اكتب 3 أحرف على الأقل للبحث عن الزبون." }, 400);
        let candidates: Array<{ id: string; full_name?: string | null; phone?: string | null; created_at?: string | null }> = [];
        if (query.includes("@")) {
          const { data: usersPage, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
          if (usersError) return json({ error: "تعذر البحث عن الحساب." }, 500);
          const match = (usersPage.users ?? []).find((item) => (item.email ?? "").toLowerCase() === query.toLowerCase());
          if (match) {
            const { data: profile } = await admin.from("profiles").select("id,full_name,phone,created_at").eq("id", match.id).maybeSingle();
            candidates = [profile ?? { id: match.id, full_name: null, phone: null, created_at: match.created_at }];
          }
        } else {
          const safeQuery = query.replace(/[%,().]/g, " ").replace(/\s+/g, " ").trim();
          if (safeQuery.length < 3) return json({ error: "عبارة البحث غير صالحة." }, 400);
          const { data: profiles, error: profileError } = await admin.from("profiles")
            .select("id,full_name,phone,created_at")
            .or("full_name.ilike.%" + safeQuery + "%,phone.ilike.%" + safeQuery + "%")
            .order("created_at", { ascending: false }).limit(10);
          if (profileError) return json({ error: "تعذر البحث عن حسابات الزبائن." }, 500);
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
        return json({ customers: enrichedCandidates });
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
          return json({ error: "يلزم تحديد الحساب وتوثيق ملاحظات التحقق واختيار حقيقتين مستقلتين على الأقل." }, 400);
        }
        const { data: targetData, error: targetError } = await admin.auth.admin.getUserById(targetId);
        const target = targetData?.user;
        if (targetError || !target?.email) return json({ error: "لم يتم العثور على حساب ببريد مسجل." }, 404);
        const { data: recentReset, error: recentError } = await admin.from("account_recovery_audit")
          .select("created_at").eq("target_user_id", targetId).eq("action", "password_reset_sent")
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (recentError) return json({ error: "تعذر التحقق من سجل الاستعادة." }, 500);
        if (recentReset && Date.now() - new Date(recentReset.created_at).getTime() < 60_000) {
          return json({ error: "تم إرسال رابط لهذا الحساب مؤخراً. انتظر دقيقة قبل إعادة الإرسال." }, 429);
        }
        const redirectTo = "https://eyadooon-cmyk.github.io/Baran-Game/";
        const { error: resetError } = await userClient.auth.resetPasswordForEmail(target.email, { redirectTo });
        if (resetError) {
          console.error("baran-admin: password reset email failed", resetError.message);
          return json({ error: "تعذر إرسال رابط الاستعادة إلى البريد المسجل." }, 502);
        }
        const { data: auditRow, error: auditError } = await admin.from("account_recovery_audit").insert({
          target_user_id: targetId, admin_id: user.id, action: "password_reset_sent", target_email: target.email,
          verified_facts: facts, verification_notes: notes,
        }).select("id,created_at,target_email,verified_facts,verification_notes").single();
        if (auditError) {
          console.error("baran-admin: recovery audit insert failed", auditError.message);
          return json({ error: "أُرسل الرابط لكن تعذر حفظ سجل التدقيق. راجع سجل الوظيفة قبل إعادة الإرسال." }, 500);
        }
        return json({ recovery: auditRow, message: "تم إرسال رابط إعادة التعيين إلى البريد المسجل." });
      }

      if (body.action === "feedback_mark_read") {
        const id = body.feedback_id;
        if (typeof id !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
          return json({ error: "معرّف تذكرة الدعم غير صحيح." }, 400);
        }
        const { data: updated, error: readError } = await admin.from("customer_feedback")
          .update({ admin_read_at: new Date().toISOString() })
          .eq("id", id).eq("feedback_type", "support").is("admin_read_at", null)
          .select("id,admin_read_at").maybeSingle();
        if (readError) {
          console.error("baran-admin: support ticket read update failed", readError.message);
          return json({ error: "تعذر تحديد تذكرة الدعم كمقروءة." }, 500);
        }
        return json({ success: true, feedback: updated ?? null });
      }

      if (body.action === "support_ticket_delete") {
        const id = body.feedback_id;
        if (typeof id !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
          return json({ error: "معرّف تذكرة الدعم غير صحيح." }, 400);
        }
        const { data: deleted, error: deleteError } = await admin.rpc("admin_delete_support_ticket", {
          p_admin_id: user.id,
          p_feedback_id: id,
        });
        if (deleteError) {
          console.error("baran-admin: support ticket delete failed", deleteError.message, deleteError.code);
          const status = deleteError.code === "P0002" ? 404 : deleteError.code === "42501" ? 403 : 500;
          return json({ error: status === 404 ? "تذكرة الدعم غير موجودة." :
            status === 403 ? "صلاحية المدير غير كافية." : "تعذر حذف تذكرة الدعم." }, status);
        }
        return json({ success: true, deleted });
      }

      if (body.action === "feedback_update") {
        const id = body.feedback_id;
        const nextStatus = body.feedback_status;
        const reply = typeof body.admin_reply === "string" ? body.admin_reply.trim() : "";
        if (typeof id !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ||
            typeof nextStatus !== "string" || reply.length > 2000) {
          return json({ error: "بيانات تحديث الرسالة غير صحيحة." }, 400);
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
          return json({ error: status === 404 ? "الرسالة غير موجودة." :
            status === 403 ? "صلاحية المدير غير كافية." :
            status === 400 ? "حالة غير مناسبة لنوع الرسالة أو بيانات غير صحيحة." :
            "تعذر حفظ الرد وتسجيل العملية." }, status);
        }
        return json({ feedback: updated, notification_created: updated?.notification_created === true, audit_logged: true });
      }

      if (body.action === "exchange_rate_update") {
        const rate = body.exchange_rate;
        if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0 || rate > 100000000) {
          return json({ error: "أدخل سعر صرف صحيحاً أكبر من صفر." }, 400);
        }
        const { data: settings, error: rateError } = await admin
          .from("store_settings")
          .update({ exchange_rate: rate, updated_at: new Date().toISOString(), updated_by: user.id })
          .eq("id", "main")
          .select("exchange_rate,updated_at")
          .single();
        if (rateError) {
          console.error("baran-admin: exchange rate update failed", rateError.message);
          return json({ error: "تعذر تحديث سعر الصرف." }, 400);
        }
        return json({ exchange_rate: Number(settings.exchange_rate), updated_at: settings.updated_at });
      }

      if (body.action === "product_bulk_save") {
        if (!Array.isArray(body.products) || body.products.length < 1 || body.products.length > 30) {
          return json({ error: "أرسل من 1 إلى 30 منتجاً." }, 400);
        }
        const categories = ["game", "ai", "vpn", "gift_card", "app"];
        const { data: settings, error: settingsError } = await admin
          .from("store_settings").select("exchange_rate").eq("id", "main").single();
        if (settingsError) return json({ error: "تعذر قراءة سعر الصرف الحالي." }, 500);
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
        return json({ results, created, skipped, failed, exchange_rate: Number(settings.exchange_rate) });
      }

      if (body.action === "product_save") {
        const categories = ["game", "ai", "vpn", "gift_card", "app"];
        const code = typeof body.product_code === "string" ? body.product_code.trim().toUpperCase() : "";
        const name = typeof body.name === "string" ? body.name.trim() : "";
        const description = typeof body.description === "string" ? body.description.trim() : "";
        const usd = body.price_usd === null || body.price_usd === undefined || body.price_usd === "" ? null : body.price_usd;
        const sortOrder = body.sort_order ?? 100;
        const { data: settings, error: settingsError } = await admin
          .from("store_settings").select("exchange_rate").eq("id", "main").single();
        if (settingsError) {
          console.error("baran-admin: exchange rate lookup failed", settingsError.message);
          return json({ error: "تعذر قراءة سعر الصرف الحالي." }, 500);
        }
        const syp = usd === null ? null : Math.round(Number(usd) * Number(settings.exchange_rate));
        if (!/^[A-Z0-9][A-Z0-9_-]{1,59}$/.test(code)) {
          return json({ error: "رمز المنتج يجب أن يكون من 2 إلى 60 حرفاً إنجليزياً أو رقماً." }, 400);
        }
        if (!categories.includes(body.category ?? "")) return json({ error: "اختر تصنيفاً صحيحاً." }, 400);
        if (name.length < 2 || name.length > 120 || description.length > 500) {
          return json({ error: "تحقق من اسم المنتج والوصف." }, 400);
        }
        if ((usd !== null && (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0 || usd > 100000000)) ||
            !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 100000) {
          return json({ error: "إذا توفر السعر فأدخل قيمة صحيحة أكبر من صفر، وتحقق من ترتيب العرض." }, 400);
        }
        const values = {
          product_code: code,
          category: body.category,
          name,
          description,
          price_usd: usd,
          price_syp: syp,
          is_active: body.is_active !== false,
          sort_order: sortOrder,
          updated_at: new Date().toISOString(),
        };
        let saved;
        let saveError;
        if (body.product_id) {
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.product_id)) {
            return json({ error: "معرّف المنتج غير صحيح." }, 400);
          }
          const result = await admin.from("products").update(values).eq("id", body.product_id)
            .select("id,product_code,category,name,description,price_usd,price_syp,is_active,sort_order,created_at,updated_at").single();
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
          return json({ error: duplicate ? "رمز المنتج مستخدم مسبقاً." : "تعذر حفظ المنتج." }, duplicate ? 409 : 400);
        }
        return json({ product: saved });
      }

      if (body.action === "product_status") {
        if (typeof body.product_id !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.product_id) ||
            typeof body.is_active !== "boolean") {
          return json({ error: "بيانات حالة المنتج غير صحيحة." }, 400);
        }
        const { data: updated, error: statusError } = await admin.from("products")
          .update({ is_active: body.is_active, updated_at: new Date().toISOString() })
          .eq("id", body.product_id)
          .select("id,is_active")
          .single();
        if (statusError) {
          console.error("baran-admin: product status failed", statusError.message);
          return json({ error: "تعذر تحديث حالة المنتج." }, 400);
        }
        return json({ product: updated });
      }

      if (body.action === "supplier_api_config_save") {
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (typeof body.supplier_id !== "string" || !uuidPattern.test(body.supplier_id) ||
            typeof body.adapter_key !== "string" ||
            (body.api_base_url !== null && body.api_base_url !== undefined && typeof body.api_base_url !== "string") ||
            (body.low_balance_threshold !== undefined && (typeof body.low_balance_threshold !== "number" || !Number.isFinite(body.low_balance_threshold))) ||
            !["USD","SYP"].includes(body.balance_currency ?? "")) {
          return json({ error: "تحقق من بيانات إعداد ربط المورد." }, 400);
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
          return json({ error: error.message || "تعذر حفظ إعدادات الربط." }, 400);
        }
        return json({ supplier_integration_config: data });
      }

      if (body.action === "supplier_api_simulate") {
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (typeof body.supplier_id !== "string" || !uuidPattern.test(body.supplier_id)) {
          return json({ error: "اختر مورداً صحيحاً للفحص." }, 400);
        }
        const { data, error } = await admin.rpc("baran_admin_supplier_simulation", {
          p_admin_id: user.id, p_supplier_id: body.supplier_id,
        });
        if (error) {
          console.error("baran-admin: supplier simulation failed", error.message);
          return json({ error: error.message || "تعذر إجراء الفحص التجريبي." }, 400);
        }
        return json({ simulation: data });
      }

      if (body.action === "supplier_order_refund") {
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        const reason = typeof body.failure_reason === "string" ? body.failure_reason.trim() : "";
        if (typeof body.order_id !== "string" || !uuidPattern.test(body.order_id) ||
            reason.length < 3 || reason.length > 500) {
          return json({ error: "يجب تحديد الطلب وسبب الفشل المؤكد." }, 400);
        }
        const { data, error } = await admin.rpc("baran_refund_failed_supplier_order_authorized", {
          p_order_id: body.order_id, p_reason: reason, p_actor_id: user.id,
        });
        if (error) {
          console.error("baran-admin: supplier order refund failed", error.message);
          return json({ error: error.message || "تعذر إعادة المبلغ." }, 400);
        }
        return json({ refund: data });
      }

      if (body.action === "supplier_save") {
        const name = typeof body.supplier_name === "string" ? body.supplier_name.trim() : "";
        const contactName = typeof body.contact_name === "string" ? body.contact_name.trim() : "";
        const phone = typeof body.contact_phone === "string" ? body.contact_phone.trim() : "";
        const email = typeof body.contact_email === "string" ? body.contact_email.trim() : "";
        const notes = typeof body.notes === "string" ? body.notes.trim() : "";
        if (name.length < 2 || name.length > 120 || contactName.length > 120 || phone.length > 40 ||
            email.length > 254 || notes.length > 2000 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
          return json({ error: "تحقق من اسم المورد وبيانات التواصل." }, 400);
        }
        const values = { name, contact_name: contactName || null, contact_phone: phone || null,
          contact_email: email || null, notes, is_active: body.is_active !== false, updated_at: new Date().toISOString() };
        const result = body.supplier_id
          ? await admin.from("suppliers").update(values).eq("id",body.supplier_id).select("*").single()
          : await admin.from("suppliers").insert(values).select("*").single();
        if (result.error) return json({ error: "تعذر حفظ المورد." }, 400);
        await admin.from("admin_audit_log").insert({admin_id:user.id,action:"supplier_save",entity_type:"supplier",
          entity_id:result.data.id,details:{name}});
        return json({ supplier: result.data });
      }

      if (body.action === "supplier_product_save") {
        if (typeof body.supplier_id !== "string" || typeof body.product_id !== "string" ||
            typeof body.unit_cost !== "number" || !Number.isFinite(body.unit_cost) || body.unit_cost < 0 ||
            !["USD","SYP"].includes(body.currency ?? "") ||
            (body.supplier_sku ?? "").toString().length > 120 ||
            (body.notes ?? "").toString().length > 1000) {
          return json({ error: "بيانات سعر المورد غير صحيحة." }, 400);
        }
        const values = { supplier_id:body.supplier_id, product_id:body.product_id,
          supplier_sku:(body.supplier_sku ?? "").toString().trim() || null,
          unit_cost:body.unit_cost, currency:body.currency, is_preferred:body.is_preferred === true,
          lead_time_hours: Number.isInteger(body.lead_time_hours) && (body.lead_time_hours ?? -1) >= 0 ? body.lead_time_hours : null,
          notes:(body.notes ?? "").toString().trim(), updated_at:new Date().toISOString() };
        const result = await admin.from("supplier_products").upsert(values,{onConflict:"supplier_id,product_id"})
          .select("id,supplier_id,product_id,supplier_sku,unit_cost,currency,is_preferred,lead_time_hours,notes,updated_at").single();
        if (result.error) return json({ error: "تعذر حفظ سعر المورد. تأكد من المورد والمنتج." }, 400);
        await admin.from("admin_audit_log").insert({admin_id:user.id,action:"supplier_product_save",entity_type:"product",
          entity_id:body.product_id,details:{supplier_id:body.supplier_id,unit_cost:body.unit_cost,currency:body.currency}});
        return json({ supplier_product:result.data });
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
          return json({ error:"بيانات متابعة المورد غير صحيحة." },400);
        }
        const { data: orderRow, error: orderLookupError } = await admin.from("orders")
          .select("id,quantity,exchange_rate").eq("id",body.order_id).maybeSingle();
        if (orderLookupError || !orderRow) return json({error:"الطلب غير موجود أو تعذر قراءته."},404);
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
              return json({error:"تعذر تحديد سعر الصرف لحفظ تكلفة المورد."},500);
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
        if(result.error) return json({error:"تعذر حفظ متابعة المورد."},400);
        await admin.from("admin_audit_log").insert({admin_id:user.id,action:"order_fulfillment_update",
          entity_type:"order",entity_id:body.order_id,details:{supplier_id:body.supplier_id ?? null,
          supplier_status:body.supplier_status,supplier_unit_cost:unitCost,
          supplier_total_cost:totalCost,supplier_cost_currency:costCurrency,
          supplier_cost_exchange_rate:costRate}});
        return json({fulfillment:result.data, refund_available:body.supplier_status==="failed"});
      }

      if (body.action === "order_status_update") {
        if (typeof body.order_id !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.order_id) ||
            typeof body.new_status !== "string") return json({ error:"بيانات تحديث الطلب غير صحيحة." },400);
        const { data, error } = await admin.rpc("admin_update_order_status",{
          p_admin_id:user.id,p_order_id:body.order_id,p_new_status:body.new_status,
          p_customer_message:typeof body.customer_message==="string"?body.customer_message.trim():""
        });
        if(error) return json({ error:error.message },400);
        return json({ order:data });
      }

      if (body.action === "loyalty_adjust") {
        if (typeof body.target_user_id !== "string" || typeof body.points_delta !== "number" ||
            !Number.isInteger(body.points_delta) || typeof body.description !== "string") {
          return json({ error:"بيانات تعديل النقاط غير صحيحة." },400);
        }
        const { data, error } = await admin.rpc("admin_adjust_loyalty",{
          p_admin_id:user.id,p_user_id:body.target_user_id,p_points:body.points_delta,
          p_description:body.description.trim()
        });
        if(error) return json({ error:error.message },400);
        return json({ loyalty:data });
      }

      if (body.action === "finance_add") {
        if (!["capital", "sale", "expense"].includes(body.entry_type ?? "")) {
          return json({ error: "Invalid finance entry type" }, 400);
        }
        if (!["USD", "SYP"].includes(body.currency ?? "")) {
          return json({ error: "Invalid currency" }, 400);
        }
        if (typeof body.title !== "string" || body.title.trim().length < 2 || body.title.trim().length > 160) {
          return json({ error: "اكتب وصفاً من حرفين إلى 160 حرفاً." }, 400);
        }
        const isSale = body.entry_type === "sale";
        if (isSale) {
          if (typeof body.product_name !== "string" || body.product_name.trim().length < 1 ||
              body.product_name.trim().length > 160 ||
              !Number.isInteger(body.quantity) || (body.quantity ?? 0) < 1 ||
              typeof body.unit_sale_price !== "number" || !Number.isFinite(body.unit_sale_price) || body.unit_sale_price <= 0 ||
              typeof body.unit_cost_price !== "number" || !Number.isFinite(body.unit_cost_price) || body.unit_cost_price < 0) {
            return json({ error: "بيانات البيع أو تكلفة الشراء غير صحيحة." }, 400);
          }
        } else if (typeof body.amount !== "number" || !Number.isFinite(body.amount) || body.amount <= 0) {
          return json({ error: "أدخل مبلغاً صحيحاً أكبر من صفر." }, 400);
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
          return json({ error: financeAddError.message }, 400);
        }
        return json({ entry });
      }

      if (!body.request_id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.request_id)) {
        return json({ error: "Invalid request ID" }, 400);
      }
      if (body.decision !== "approved" && body.decision !== "rejected") {
        return json({ error: "Invalid decision" }, 400);
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
        return json({ error: conflict ? "This request has already been reviewed" : error.message }, conflict ? 409 : 400);
      }
      return json(data);
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (error) {
    console.error("baran-admin request failed", error instanceof Error ? error.message : String(error));
    return json({ error: "Unexpected server error" }, 500);
  }
});
