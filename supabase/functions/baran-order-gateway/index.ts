import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

function readKeyObject(name: string): string | undefined {
  const raw = Deno.env.get(name);
  if (!raw) return undefined;
  try { return JSON.parse(raw).default; } catch { return undefined; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "طريقة الطلب غير مسموحة." }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? readKeyObject("SUPABASE_PUBLISHABLE_KEYS");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? readKeyObject("SUPABASE_SECRET_KEYS");
    if (!url || !anonKey || !serviceKey) {
      console.error("BARAN_ORDER_GATEWAY_CONFIG_MISSING", {
        url: !!url, publishableKey: !!anonKey, serviceKey: !!serviceKey,
      });
      return json({ error: "إعدادات بوابة الطلبات غير مكتملة على الخادم.", code: "SERVER_CONFIG_MISSING" }, 503);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const accessToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!accessToken) return json({ error: "سجّل الدخول أولاً." }, 401);

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: "Bearer " + accessToken } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser(accessToken);
    const user = authData?.user;
    if (authError || !user) return json({ error: "انتهت الجلسة. سجّل الدخول مجدداً." }, 401);

    const rawBody = await req.text();
    if (rawBody.length > 8192) return json({ error: "حجم البيانات أكبر من المسموح." }, 413);
    let body: any;
    try { body = JSON.parse(rawBody); } catch { return json({ error: "بيانات الطلب غير صالحة." }, 400); }

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    if (body?.action !== "catalog_report") {
      const { data: control, error: controlError } = await admin.from("customer_account_controls")
        .select("status,banned_until").eq("user_id", user.id).maybeSingle();
      if (controlError) return json({ error: "تعذر التحقق من حالة حماية الحساب." }, 500);
      if (control?.status === "banned" &&
          (!control.banned_until || new Date(control.banned_until).getTime() > Date.now())) {
        return json({ error: "هذا الحساب موقوف حالياً. تواصل مع الإدارة." }, 403);
      }
    }

    if (body?.action === "catalog_report") {
      const { data: adminRecord, error: adminCheckError } = await admin
        .from("admin_users")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (adminCheckError) {
        console.error("BARAN_CATALOG_REPORT_ADMIN_CHECK_FAILED", adminCheckError.message);
        return json({ error: "تعذر التحقق من صلاحية الإدارة." }, 500);
      }
      if (!adminRecord) return json({ error: "هذا التقرير مخصص لحسابات الإدارة فقط." }, 403);

      const { data: report, error: reportError } = await admin.rpc("baran_admin_catalog_readiness");
      if (reportError) {
        console.error("BARAN_CATALOG_REPORT_RPC_FAILED", reportError.message);
        return json({ error: "تعذر إنشاء تقرير جاهزية المنتجات." }, 500);
      }
      return json({ success: true, report });
    }

    if ((body?.action === "homscard_app_catalog" || body?.action === "homscard_variable_catalog")) {
      const variableCategories = new Set(["ألعاب", "تطبيقات", "اتصالات", "محافظ"]);
      const { data: auditRows, error: auditError } = await admin.from("baran_homscard_audit_items")
        .select("product_id,product_name,product_data,page_data,page_status,updated_at")
        .eq("page_status", "success")
        .order("updated_at", { ascending: false }).limit(1000);
      if (auditError) return json({ success: false, error: "تعذر تحميل كتالوج المنتجات المتغيرة الكمية." }, 503);
      const { data: settings, error: settingsError } = await admin.from("store_settings")
        .select("market_exchange_rate,fx_buffer_percent,product_markup_percent").eq("id", "main").maybeSingle();
      if (settingsError || !settings) return json({ success: false, error: "إعدادات التسعير غير متاحة." }, 503);
      const marketRate = Number(settings.market_exchange_rate), buffer = Number(settings.fx_buffer_percent), markup = Number(settings.product_markup_percent);
      if (![marketRate,buffer,markup].every(Number.isFinite) || marketRate <= 0 || buffer < 0 || markup < 0)
        return json({ success: false, error: "إعدادات التسعير غير صالحة." }, 503);
      const latest = new Map<string, any>();
      for (const row of auditRows ?? []) if (!latest.has(String(row.product_id))) latest.set(String(row.product_id), row);
      const result = [];
      for (const [id, row] of latest) {
        const data = row?.product_data ?? {}, page = row?.page_data ?? {};
        const category = String(data.category || "").trim().replace(/^ال/, "");
        if (!row || ![...variableCategories].some(value => category.startsWith(value)) ||
            data.product_type !== "quantity" || data.available !== true ||
            !(Number(data.price) > 0) || typeof page.text !== "string") continue;
        const limits = String(page.text).match(/الكمية[\s\S]{0,100}?من\s*([0-9,]+)\s*إلى\s*([0-9,]+)/);
        if (!limits) continue;
        const min = Number(limits[1].replace(/,/g, "")), max = Number(limits[2].replace(/,/g, ""));
        const cost = Number(data.price);
        if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1 || max < min || !Number.isFinite(cost) || cost <= 0) continue;
        const images = [data.image_url,data.image,data.img,data.photo,page.images?.[0]].filter(v => typeof v === "string");
        const image = images.find(v => /^https:\/\//i.test(v)) ?? "";
        const fieldRules = [
          { pattern: /player\\s*id|معرّف اللاعب|ايدي اللاعب/i, label: "Player ID" },
          { pattern: /رقم الهاتف|رقم الموبايل|phone|mobile/i, label: "رقم الهاتف" },
          { pattern: /رقم المحفظة|wallet/i, label: "رقم المحفظة" },
          { pattern: /معرّف الحساب|رقم الحساب|account\\s*id|user\\s*id|\\buid\\b/i, label: "معرّف الحساب" },
        ];
        const targetField = fieldRules.find(rule => rule.pattern.test(page.text));
        result.push({
          product_id: id, name: String(row.product_name || data.name || "منتج").slice(0, 100),
          category: String(data.category), min_quantity: min, max_quantity: max, image,
          requires_target: !!targetField, target_label: targetField?.label ?? "بيانات الحساب (إن لزمت)",
          sale_unit_usd: Number((cost * (1 + markup / 100)).toFixed(8)),
        });
      }
      return json({ success: true, products: result, provider: "HomsCard", mode: "read_only_catalog", scope: "all_variable_quantity_categories" });
    }

    if ((body?.action === "homscard_app_quote" || body?.action === "homscard_variable_quote")) {
      const productId = typeof body.product_id === "string" ? body.product_id.trim() : "";
      const quantity = Number(body.quantity);
      const playerId = typeof body.player_id === "string" ? body.player_id.trim() : "";
      const currency = typeof body.payment_currency === "string" ? body.payment_currency.toUpperCase() : "SYP";
      if (!/^[0-9]{1,10}$/.test(productId)) return json({ success: false, error: "معرّف المنتج غير صالح." }, 400);
      if (!Number.isSafeInteger(quantity) || quantity <= 0) return json({ success: false, error: "أدخل كمية صحيحة." }, 400);
      if (playerId.length > 100) return json({ success: false, error: "بيانات الحساب أطول من المسموح." }, 400);
      if (!["USD","SYP"].includes(currency)) return json({ success: false, error: "عملة الدفع غير مدعومة." }, 400);

      const { data: auditRows, error: auditError } = await admin.from("baran_homscard_audit_items")
        .select("product_id,product_name,product_data,page_data,page_status,updated_at")
        .eq("product_id", productId).eq("page_status", "success")
        .order("updated_at", { ascending: false }).limit(8);
      if (auditError) return json({ success: false, error: "تعذر قراءة تدقيق منتج HomsCard." }, 503);
      const audited = (auditRows ?? []).find((row: any) =>
        ["ألعاب", "تطبيقات", "اتصالات", "محافظ"].some(value => String(row?.product_data?.category || "").trim().replace(/^ال/, "").startsWith(value)) &&
        row?.product_data?.product_type === "quantity" &&
        row?.product_data?.available === true &&
        Number(row?.product_data?.price) > 0 &&
        typeof row?.page_data?.text === "string"
      );
      if (!audited) return json({ success: false, error: "تكلفة أو تفاصيل هذا المنتج غير مؤكدة حالياً." }, 503);
      const pageText = String(audited.page_data.text);
      const requiresTarget = /player\\s*id|معرّف اللاعب|ايدي اللاعب|رقم الهاتف|رقم الموبايل|phone|mobile|رقم المحفظة|wallet|معرّف الحساب|رقم الحساب|account\\s*id|user\\s*id|\\buid\\b/i.test(pageText);
      if (requiresTarget && playerId.length < 2) return json({ success: false, error: "أدخل بيانات الحساب المطلوبة لهذا المنتج أولاً." }, 400);
      const limits = pageText.match(/الكمية[\s\S]{0,100}?من\s*([0-9,]+)\s*إلى\s*([0-9,]+)/);
      if (!limits) return json({ success: false, error: "حدود الكمية لم تُستخرج بشكل موثوق من صفحة المورد." }, 503);
      const minQuantity = Number(limits[1].replace(/,/g, ""));
      const maxQuantity = Number(limits[2].replace(/,/g, ""));
      if (!Number.isSafeInteger(minQuantity) || !Number.isSafeInteger(maxQuantity) || minQuantity < 1 || maxQuantity < minQuantity || quantity < minQuantity || quantity > maxQuantity) {
        return json({ success: false, error: "الكمية لهذا المنتج يجب أن تكون بين " + minQuantity.toLocaleString("en-US") + " و" + maxQuantity.toLocaleString("en-US") + "." }, 400);
      }
      const unitCost = Number(audited.product_data.price);
      if (!Number.isFinite(unitCost) || unitCost <= 0) return json({ success: false, error: "سعر وحدة المورد غير صالح." }, 503);

      const { data: settings, error: settingsError } = await admin.from("store_settings")
        .select("market_exchange_rate,fx_buffer_percent,product_markup_percent")
        .eq("id", "main").maybeSingle();
      if (settingsError || !settings) return json({ success: false, error: "إعدادات التسعير غير متاحة." }, 503);
      const marketRate = Number(settings.market_exchange_rate);
      const bufferPercent = Number(settings.fx_buffer_percent);
      const markupPercent = Number(settings.product_markup_percent);
      if (![marketRate,bufferPercent,markupPercent].every(Number.isFinite) || marketRate <= 0 || bufferPercent < 0 || markupPercent < 0) {
        return json({ success: false, error: "إعدادات سعر الصرف أو هامش الربح غير صالحة." }, 503);
      }
      const commercialRate = marketRate * (1 + bufferPercent / 100);
      const totalCost = unitCost * quantity;
      const round = (value: number, digits: number) => Number((value + Number.EPSILON).toFixed(digits));
      const saleUsd = round(totalCost * (1 + markupPercent / 100), 2);
      const saleSyp = Math.round(totalCost * (1 + markupPercent / 100) * commercialRate);
      const { data: adminRecord, error: adminCheckError } = await admin.from("admin_users")
        .select("user_id").eq("user_id", user.id).maybeSingle();
      if (adminCheckError) return json({ success: false, error: "تعذر التحقق من صلاحية الإدارة." }, 500);
      const isAdmin = !!adminRecord;
      const quote: Record<string, unknown> = {
        product_id: productId,
        product_name: audited.product_name,
        quantity,
        min_quantity: minQuantity,
        max_quantity: maxQuantity,
        sale_usd: saleUsd,
        sale_syp: saleSyp,
        commercial_rate: round(commercialRate, 2),
        markup_percent: markupPercent,
        currency,
      };
      if (isAdmin) {
        quote.cost_usd = round(totalCost, 6);
        quote.profit_usd = round(saleUsd - totalCost, 6);
        quote.profit_syp = saleSyp - Math.round(totalCost * commercialRate);
        quote.is_admin = true;
      }
      return json({
        success: true,
        mode: "read_only_quote",
        can_create_order: false,
        can_purchase: false,
        charged: false,
        order_created: false,
        quote,
        message: "تم حساب سعر المعاينة فقط من تكلفة وحدة HomsCard وإعدادات باران. لم يتم إنشاء طلب أو تنفيذ شحن أو خصم رصيد.",
      });
    }

    if (body?.action === "jawaker_quote") {
      const quantity = Number(body.quantity);
      const playerId = typeof body.player_id === "string" ? body.player_id.trim() : "";
      const currency = typeof body.payment_currency === "string" ? body.payment_currency.toUpperCase() : "SYP";
      if (!Number.isSafeInteger(quantity) || quantity < 10000 || quantity > 10000000) {
        return json({ success: false, error: "الكمية يجب أن تكون عدداً صحيحاً بين 10,000 و10,000,000." }, 400);
      }
      if (!playerId || playerId.length < 3 || playerId.length > 100) {
        return json({ success: false, error: "أدخل Player ID صالحاً." }, 400);
      }
      if (!["USD", "SYP"].includes(currency)) return json({ success: false, error: "عملة الدفع غير مدعومة." }, 400);

      const { data: product, error: productError } = await admin.from("products")
        .select("id,product_code,name,category,is_active")
        .eq("product_code", "JAWAKER_TOKENS").eq("is_active", true).maybeSingle();
      if (productError || !product || product.category !== "game") {
        return json({ success: false, error: "منتج جواكر توكنز غير متاح حالياً." }, 404);
      }
      const { data: supplier, error: supplierError } = await admin.from("suppliers")
        .select("id").eq("name", "HomsCard").eq("is_active", true).maybeSingle();
      if (supplierError || !supplier) return json({ success: false, error: "تعذر التحقق من مورد HomsCard." }, 503);
      const { data: mapping, error: mappingError } = await admin.from("supplier_products")
        .select("supplier_sku,unit_cost,currency")
        .eq("product_id", product.id).eq("supplier_id", supplier.id)
        .eq("supplier_sku", "865").maybeSingle();
      if (mappingError || !mapping || mapping.currency !== "USD" || !Number.isFinite(Number(mapping.unit_cost)) || Number(mapping.unit_cost) <= 0) {
        return json({ success: false, error: "تكلفة جواكر توكنز غير معتمدة في ربط المورد." }, 503);
      }
      const { data: settings, error: settingsError } = await admin.from("store_settings")
        .select("market_exchange_rate,fx_buffer_percent,product_markup_percent")
        .eq("id", "main").maybeSingle();
      if (settingsError || !settings) return json({ success: false, error: "إعدادات التسعير غير متاحة." }, 503);
      const marketRate = Number(settings.market_exchange_rate);
      const bufferPercent = Number(settings.fx_buffer_percent);
      const markupPercent = Number(settings.product_markup_percent);
      if (![marketRate, bufferPercent, markupPercent].every(Number.isFinite) || marketRate <= 0 || bufferPercent < 0 || markupPercent < 0) {
        return json({ success: false, error: "إعدادات سعر الصرف أو هامش الربح غير صالحة." }, 503);
      }
      const commercialRate = marketRate * (1 + bufferPercent / 100);
      const unitCost = Number(mapping.unit_cost);
      const totalCost = unitCost * quantity;
      const exactSaleUsd = totalCost * (1 + markupPercent / 100);
      const exactSaleSyp = exactSaleUsd * commercialRate;
      const round = (value: number, digits: number) => Number((value + Number.EPSILON).toFixed(digits));
      const { data: adminRecord, error: adminCheckError } = await admin.from("admin_users")
        .select("user_id").eq("user_id", user.id).maybeSingle();
      if (adminCheckError) return json({ success: false, error: "تعذر التحقق من صلاحية الإدارة." }, 500);
      const isAdmin = !!adminRecord;
      const quote: Record<string, unknown> = {
        quantity,
        sale_usd: round(exactSaleUsd, 2),
        sale_syp: Math.round(exactSaleSyp),
        commercial_rate: round(commercialRate, 2),
        markup_percent: markupPercent,
        currency,
      };
      if (isAdmin) {
        quote.cost_usd = round(totalCost, 6);
        quote.profit_usd = round(exactSaleUsd - totalCost, 6);
        quote.profit_syp = Math.round((exactSaleUsd - totalCost) * commercialRate);
        quote.is_admin = true;
      }
      return json({
        success: true,
        mode: "read_only_quote",
        can_create_order: false,
        can_purchase: false,
        charged: false,
        order_created: false,
        quote,
        message: "تم حساب سعر المعاينة فقط. لم يتم إنشاء طلب أو الاتصال بواجهة تنفيذ المورد أو خصم رصيد.",
      });
    }

    if (body?.action !== "preflight") {
      return json({ error: "هذه البوابة تدعم فحص المنتج أو تقرير الإدارة فقط؛ لا تنشئ طلباً ولا تخصم رصيداً.", code: "READ_ONLY_GATEWAY" }, 409);
    }

    const productCode = typeof body.product_code === "string" ? body.product_code.trim().toUpperCase() : "";
    const quantity = Number(body.quantity ?? 1);
    const currency = typeof body.payment_currency === "string" ? body.payment_currency.toUpperCase() : "";
    const playerId = typeof body.player_id === "string" ? body.player_id.trim() : "";

    if (!/^[A-Z0-9][A-Z0-9_-]{1,59}$/.test(productCode)) return json({ error: "رمز المنتج غير صالح." }, 400);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) return json({ error: "الكمية يجب أن تكون بين 1 و100." }, 400);
    if (!["USD", "SYP"].includes(currency)) return json({ error: "عملة الدفع غير مدعومة." }, 400);

    const { data: preflight, error: preflightError } = await admin.rpc("baran_order_preflight", {
      p_user_id: user.id,
      p_product_code: productCode,
      p_quantity: quantity,
      p_payment_currency: currency,
      p_player_id: playerId || null,
    });
    if (preflightError) {
      console.error("BARAN_ORDER_PREFLIGHT_RPC_FAILED", preflightError.message);
      return json({ error: "تعذر إكمال فحص الجاهزية. لم يتم إنشاء طلب ولم يُخصم أي رصيد." }, 500);
    }
    return json(preflight ?? {
      success: false,
      can_create_order: false,
      can_purchase: false,
      charged: false,
      order_created: false,
      error: "لم تصل نتيجة فحص صالحة.",
    });
  } catch (error) {
    console.error("BARAN_ORDER_GATEWAY_FAILED", error instanceof Error ? error.message : String(error));
    return json({ error: "تعذر فحص جاهزية الطلب حالياً. لم يتم إنشاء طلب ولم يُخصم أي رصيد." }, 500);
  }
});