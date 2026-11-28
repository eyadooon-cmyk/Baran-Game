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

function parseHomsCardCheck(payload: any, expectedUuid: string) {
  if (!payload || payload.status !== "OK" || !Array.isArray(payload.data))
    return { kind: "unknown" as const, reason: "Malformed or unsuccessful supplier response" };
  const row = payload.data.find((item: any) =>
    item && String(item.order_uuid ?? "").toLowerCase() === expectedUuid.toLowerCase()
  );
  if (!row) return { kind: "unknown" as const, reason: "Supplier response did not contain the exact order UUID" };
  const status = String(row.status ?? "").toLowerCase();
  const supplierOrderId = typeof row.order_id === "string" ? row.order_id.trim() : "";
  if (status === "pending") return { kind: "pending" as const, supplierOrderId: supplierOrderId || null };
  if (status === "cancelled") return { kind: "failed" as const, supplierOrderId: supplierOrderId || null, reason: "HomsCard confirmed the order was cancelled" };
  if (status === "completed") {
    const totalCost = Number(row.price);
    const quantity = Number(row.quantity);
    const delivery = typeof row.delivery === "string" ? row.delivery.trim() : "";
    if (!supplierOrderId || supplierOrderId.length > 160 || !Number.isFinite(totalCost) || totalCost < 0 ||
        !Number.isSafeInteger(quantity) || quantity < 1 || !delivery || delivery.length > 4000)
      return { kind: "unknown" as const, reason: "Completed response is missing verified order, cost, quantity, or delivery data" };
    return { kind: "completed" as const, supplierOrderId, totalCost, quantity, delivery };
  }
  return { kind: "unknown" as const, reason: "Unrecognized supplier order status" };
}

function safeSupplierText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= max ? text : null;
}

// Keep the deployed Edge Function self-contained; sibling function folders are not deployment dependencies.
function normalizeHomsCardCreate(payload: any, expectedUuid: string, expectedQuantity: number) {
  if (!payload || payload.status !== "OK" || !payload.data ||
      typeof payload.data !== "object" || Array.isArray(payload.data)) return null;
  const row = payload.data;
  const status = String(row.status ?? "").toLowerCase();
  const supplierOrderId = safeSupplierText(row.order_id, 160);
  if (status === "pending" || status === "cancelled") {
    return { status: "OK", data: [{ order_uuid: expectedUuid, order_id: supplierOrderId, status }] };
  }
  if (status !== "completed") return null;
  const quantity = Number(row.quantity);
  const price = Number(row.price);
  const delivery = typeof row.delivery === "string" ? row.delivery.trim() : "";
  if (!supplierOrderId || !Number.isSafeInteger(quantity) || quantity !== expectedQuantity ||
      !Number.isFinite(price) || price < 0 || !delivery || delivery.length > 4000) return null;
  return { status: "OK", data: [{ order_uuid: expectedUuid, order_id: supplierOrderId,
    status: "completed", price, quantity, delivery }] };
}

function homscardConfirmedRejection(code: number) {
  return [100, 103, 109, 110, 112, 113, 114].includes(Number(code));
}

function readKeyObject(name: string): string | undefined {
  const raw = Deno.env.get(name);
  if (!raw) return undefined;
  try { return JSON.parse(raw).default; } catch { return undefined; }
}

async function homscardRequest(path: string, method: "GET" | "POST", data?: Record<string, unknown>) {
  const token = Deno.env.get("HOMSCARD_API_TOKEN");
  if (!token) throw new Error("HOMSCARD_API_TOKEN_MISSING");
  const body = data ? JSON.stringify(data) : "";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const headers: Record<string,string> = { "api-token": token, "Accept": "application/json" };
  const secret = Deno.env.get("HOMSCARD_HMAC_SECRET") ?? "";
  if (secret) {
    const key = await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),
      {name:"HMAC",hash:"SHA-256"},false,["sign"]);
    const message = timestamp + "\n" + method + "\n" + path + "\n" + body;
    const signature = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(message))),
      b=>b.toString(16).padStart(2,"0")).join("");
    headers["X-Timestamp"] = timestamp;
    headers["X-Signature"] = signature;
  }
  if (method === "POST") headers["Content-Type"] = "application/json";
  const response = await fetch("https://homscard.com/reseller" + path, {
    method, headers, body: method === "POST" ? body : undefined,
    signal: AbortSignal.timeout(method === "POST" ? 60000 : 20000),
  });
  const raw = await response.text();
  let payload: any;
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }
  return { http_status: response.status, payload };
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
    const requestPlayerId = typeof body.player_id === "string" ? body.player_id.trim() : "";

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


    // Fixed HomsCard products have a separate catalog and quote contract.
    // This path is read-only until a dedicated fixed-order transaction is reviewed and enabled.
    if (body?.action === "homscard_fixed_catalog" || body?.action === "homscard_fixed_quote") {
      const isQuote = body.action === "homscard_fixed_quote";
      const productCode = typeof body.product_code === "string" ? body.product_code.trim().toUpperCase() : "";
      const currency = typeof body.payment_currency === "string" ? body.payment_currency.toUpperCase() : "SYP";
      if (isQuote && (!/^[A-Z0-9_]{3,80}$/.test(productCode) || requestPlayerId.length < 2 || requestPlayerId.length > 100))
        return json({success:false,error:"اختر منتجاً ثابتاً وأدخل Player ID صالحاً."},400);
      if (!["USD","SYP"].includes(currency))
        return json({success:false,error:"عملة الدفع غير مدعومة."},400);

      const {data: settings,error:settingsError}=await admin.from("store_settings")
        .select("market_exchange_rate,fx_buffer_percent,product_markup_percent").eq("id","main").maybeSingle();
      if(settingsError||!settings)return json({success:false,error:"إعدادات التسعير غير متاحة."},503);
      const marketRate=Number(settings.market_exchange_rate),buffer=Number(settings.fx_buffer_percent),markup=Number(settings.product_markup_percent);
      if(![marketRate,buffer,markup].every(Number.isFinite)||marketRate<=0||buffer<0||markup<0)
        return json({success:false,error:"إعدادات التسعير غير صالحة."},503);

      const {data:supplier,error:supplierError}=await admin.from("suppliers")
        .select("id").ilike("name","HomsCard").eq("is_active",true).maybeSingle();
      if(supplierError||!supplier)return json({success:false,error:"مورد HomsCard غير متاح."},503);

      const {data:productRows,error:productsError}=await admin.from("products")
        .select("id,product_code,name,description,category,price_usd,price_syp,markup_percent,catalog_group,sort_order")
        .eq("is_active",true).gt("price_usd",0).or("catalog_group.is.null,catalog_group.eq.homscard_fixed")
        .order("sort_order",{ascending:true}).limit(250);
      if(productsError)return json({success:false,error:"تعذر تحميل كتالوج المنتجات الثابتة."},503);
      const ids=(productRows??[]).map((p:any)=>p.id);
      if(!ids.length)return json({success:true,products:[],mode:"read_only_fixed_catalog",can_purchase:false});
      const {data:mappings,error:mappingError}=await admin.from("supplier_products")
        .select("product_id,supplier_sku,unit_cost,currency,is_preferred,input_schema")
        .eq("supplier_id",supplier.id).eq("is_preferred",true).in("product_id",ids);
      if(mappingError)return json({success:false,error:"تعذر قراءة ربط منتجات HomsCard."},503);
      const mappingByProduct=new Map((mappings??[]).map((m:any)=>[String(m.product_id),m]));
      const skus=[...new Set((mappings??[]).map((m:any)=>String(m.supplier_sku||"")).filter(Boolean))];
      const {data:auditRows,error:auditError}=await admin.from("baran_homscard_audit_items")
        .select("product_id,product_name,product_data,page_data,page_status,updated_at")
        .in("product_id",skus.length?skus:["__none__"]).eq("page_status","success")
        .order("updated_at",{ascending:false}).limit(500);
      if(auditError)return json({success:false,error:"تعذر التحقق من تدقيق منتجات HomsCard."},503);
      const latestAudit=new Map<string,any>();
      for(const row of auditRows??[])if(!latestAudit.has(String(row.product_id)))latestAudit.set(String(row.product_id),row);
      const ready=[];
      for(const p of productRows??[]){
        const m:any=mappingByProduct.get(String(p.id));
        if(!m||m.currency!=="USD"||!Number.isFinite(Number(m.unit_cost))||Number(m.unit_cost)<=0)continue;
        // Subscription products are outside the approved current catalog.
        if(/MEMBERSHIP|SUBSCRIPTION|WEEKLY/i.test(String(p.product_code))||String(p.product_code).toUpperCase()==="JAWAKER_TOKENS")continue;
        const audit=latestAudit.get(String(m.supplier_sku));
        const data=audit?.product_data??{},page=audit?.page_data??{};
        if(!audit||new Date(audit.updated_at).getTime()<Date.now()-24*60*60*1000||
           data.product_type!=="package"||data.available!==true||
           Math.abs(Number(data.price)-Number(m.unit_cost))>0.000001||
           !Array.isArray(data.params)||data.params.length!==1||
           !/player\s*id/i.test(String(data.params[0]))||
           !/player\s*id/i.test(String(page.text||"")))continue;
        const productMarkup=Number(p.markup_percent ?? markup);
        const minimumSaleUsd=Number((Number(m.unit_cost)*(1+productMarkup/100)).toFixed(2));
        const saleUsd=Number(Number(p.price_usd).toFixed(2));
        if(!(saleUsd>0)||!Number.isFinite(productMarkup)||productMarkup<0||saleUsd+0.000001<minimumSaleUsd)continue;
        const saleSyp=Number((saleUsd*marketRate*(1+buffer/100)/100).toFixed(2));
        ready.push({product_id:p.id,product_code:p.product_code,name:p.name,description:p.description,category:p.category,
          supplier_sku:String(m.supplier_sku),target_label:"Player ID",sale_usd:saleUsd,sale_syp:saleSyp,
          markup_percent:productMarkup,currency,can_purchase:false});
      }
      if(!isQuote)return json({success:true,mode:"read_only_fixed_catalog",can_purchase:false,products:ready});
      const selected=ready.find((p:any)=>p.product_code===productCode);
      if(!selected)return json({success:false,error:"المنتج الثابت غير معتمد حالياً أو يحتاج تحديث تدقيق المورد."},404);
      const quote={product_code:selected.product_code,product_name:selected.name,player_id_masked:requestPlayerId.length>4?requestPlayerId.slice(0,2)+"•••"+requestPlayerId.slice(-2):"••••",
        sale_usd:selected.sale_usd,sale_syp:selected.sale_syp,currency,markup_percent:selected.markup_percent,
        commercial_rate:Number((marketRate*(1+buffer/100)/100).toFixed(4))};
      return json({success:true,mode:"read_only_fixed_quote",can_create_order:false,can_purchase:false,
        charged:false,order_created:false,quote,
        message:"تم تأكيد سعر المنتج الثابت فقط. لا يوجد إنشاء طلب أو خصم رصيد حتى اكتمال مسار الشراء الآمن."});
    }

    if ((body?.action === "homscard_app_catalog" || body?.action === "homscard_variable_catalog")) {
      const variableCategories = new Set(["ألعاب", "جواكر", "تطبيقات", "اتصالات", "محافظ"]);
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
      const { data: variableSupplier, error: variableSupplierError } = await admin.from("suppliers")
        .select("id").ilike("name", "HomsCard").eq("is_active", true).maybeSingle();
      if (variableSupplierError || !variableSupplier) return json({ success: false, error: "مورد HomsCard غير متاح." }, 503);
      const { data: variableMappings, error: variableMappingsError } = await admin.from("supplier_products")
        .select("supplier_sku,products(markup_percent)")
        .eq("supplier_id", variableSupplier.id).eq("is_preferred", true);
      if (variableMappingsError) return json({ success: false, error: "تعذر قراءة هوامش المنتجات." }, 503);
      const marginBySku = new Map((variableMappings ?? []).map((m: any) =>
        [String(m.supplier_sku), Number(m.products?.markup_percent ?? markup)]));
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
        const itemMarkup = marginBySku.get(String(id)) ?? markup;
        const images = [data.image_url,data.image,data.img,data.photo,page.images?.[0]].filter(v => typeof v === "string");
        const image = images.find(v => /^https:\/\//i.test(v)) ?? "";
        const fieldRules = [
          { pattern: /player\s*id|معرّف اللاعب|ايدي اللاعب/i, label: "Player ID" },
          { pattern: /رقم الهاتف|رقم الموبايل|phone|mobile/i, label: "رقم الهاتف" },
          { pattern: /رقم المحفظة|wallet/i, label: "رقم المحفظة" },
          { pattern: /معرّف الحساب|رقم الحساب|account\s*id|user\s*id|\buid\b/i, label: "معرّف الحساب" },
        ];
        const params = Array.isArray(data.params) ? data.params.filter((v: unknown) => typeof v === "string" && v.trim()) : [];
        const targetField = params.length ? { label: String(params[0]).slice(0, 60) } : fieldRules.find(rule => rule.pattern.test(page.text));
        result.push({
          product_id: id, name: String(row.product_name || data.name || "منتج").slice(0, 100),
          category: category === "جواكر" ? "ألعاب" : String(data.category), source_category: category, min_quantity: min, max_quantity: max, image,
          requires_target: !!targetField, target_label: targetField?.label ?? "بيانات الحساب (إن لزمت)",
          markup_percent: itemMarkup,
          sale_unit_usd: Number((cost * (1 + itemMarkup / 100)).toFixed(8)),
          sale_unit_syp: Number((cost * (1 + itemMarkup / 100) * marketRate * (1 + buffer / 100) / 100).toFixed(8)),
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
        typeof row?.page_data?.text === "string" &&
        new Date(row.updated_at).getTime() >= Date.now() - 24 * 60 * 60 * 1000
      );
      if (!audited) return json({ success: false, error: "تكلفة أو تفاصيل هذا المنتج غير مؤكدة حالياً." }, 503);
      const pageText = String(audited.page_data.text);
      const requiresTarget = (Array.isArray(audited.product_data?.params) && audited.product_data.params.length > 0) ||
        /player\s*id|معرّف اللاعب|ايدي اللاعب|رقم الهاتف|رقم الموبايل|phone|mobile|رقم المحفظة|wallet|معرّف الحساب|رقم الحساب|account\s*id|user\s*id|\buid\b/i.test(pageText);
      // Quote-only preview: allow pricing before target ID is entered. The order RPC still enforces required account fields.
      const limits = pageText.match(/الكمية[\s\S]{0,100}?من\s*([0-9,]+)\s*إلى\s*([0-9,]+)/);
      const minQuantity = Number(audited.product_data?.qty_values?.min ?? limits?.[1]?.replace(/,/g, ""));
      const maxQuantity = Number(audited.product_data?.qty_values?.max ?? limits?.[2]?.replace(/,/g, ""));
      if (!Number.isFinite(minQuantity) || !Number.isFinite(maxQuantity)) return json({ success: false, error: "حدود الكمية لم تُستخرج بشكل موثوق من صفحة المورد." }, 503);
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
      const { data: variableSupplier, error: variableSupplierError } = await admin.from("suppliers")
        .select("id").ilike("name", "HomsCard").eq("is_active", true).maybeSingle();
      if (variableSupplierError || !variableSupplier) return json({ success: false, error: "مورد HomsCard غير متاح." }, 503);
      const { data: marginMapping, error: marginMappingError } = await admin.from("supplier_products")
        .select("products(markup_percent)")
        .eq("supplier_id", variableSupplier.id).eq("supplier_sku", productId).eq("is_preferred", true).maybeSingle();
      if (marginMappingError) return json({ success: false, error: "تعذر قراءة هامش ربح المنتج." }, 503);
      const mappedProduct: any = Array.isArray(marginMapping?.products)
        ? marginMapping.products[0]
        : marginMapping?.products;
      const productMarkupPercent = Number(mappedProduct?.markup_percent ?? markupPercent);
      if (!Number.isFinite(productMarkupPercent) || productMarkupPercent < 0)
        return json({ success: false, error: "هامش ربح المنتج غير صالح." }, 503);
      const commercialRate = marketRate * (1 + bufferPercent / 100);
      const totalCost = unitCost * quantity;
      const round = (value: number, digits: number) => Number((value + Number.EPSILON).toFixed(digits));
      const saleUsd = round(totalCost * (1 + productMarkupPercent / 100), 4);
      const saleSyp = Number((totalCost * (1 + productMarkupPercent / 100) * commercialRate / 100).toFixed(2));
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
        commercial_rate: round(commercialRate / 100, 2),
        markup_percent: productMarkupPercent,
        currency,
      };
      if (isAdmin) {
        quote.cost_usd = round(totalCost, 6);
        quote.profit_usd = round(saleUsd - totalCost, 6);
        quote.profit_syp = Number(((saleUsd - totalCost) * commercialRate / 100).toFixed(2));
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


    if (body?.action === "homscard_variable_create_order") {
      const productId = typeof body.product_id === "string" ? body.product_id.trim() : "";
      // Jawaker custom tokens remain preview-only until the product is formally approved.
      const { data: jawakerProduct } = await admin.from("products")
        .select("id").eq("product_code", "JAWAKER_TOKENS").maybeSingle();
      if (jawakerProduct?.id) {
        const { data: jawakerMappings } = await admin.from("supplier_products")
          .select("supplier_sku").eq("product_id", jawakerProduct.id);
        if (String(jawakerProduct.id) === productId ||
            (jawakerMappings || []).some((mapping: any) => String(mapping.supplier_sku) === productId)) {
          return json({
            success: false,
            code: "PRODUCT_NOT_READY",
            error: "منتج جواكر غير جاهز للطلب حالياً. يمكنك مراجعة السعر فقط؛ لم يتم إنشاء طلب أو إرسال أي شيء للمورد.",
            can_create_order: false,
            order_created: false,
            charged: false,
          }, 409);
        }
      }
      const quantity = Number(body.quantity);
      const currency = typeof body.payment_currency === "string" ? body.payment_currency.toUpperCase() : "SYP";
      const playerId = typeof body.player_id === "string" ? body.player_id.trim() : "";
      const requestId = typeof body.request_id === "string" ? body.request_id.trim() : "";
      if (!/^[0-9]{1,10}$/.test(productId) || !Number.isSafeInteger(quantity) || quantity < 1 ||
          !["USD","SYP"].includes(currency) ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId) ||
          playerId.length > 100) return json({success:false,error:"بيانات الطلب غير صالحة."},400);
      if (!Deno.env.get("HOMSCARD_API_TOKEN")) return json({success:false,error:"مفتاح HomsCard API غير مضبوط على الخادم؛ لم يتم إنشاء طلب أو خصم رصيد.",code:"SUPPLIER_SECRET_MISSING"},503);

      const {data: created,error:createError}=await admin.rpc("baran_create_homscard_variable_order",{
        p_user_id:user.id,p_product_id:productId,p_quantity:quantity,
        p_payment_currency:currency,p_player_id:playerId||null,p_request_id:requestId,
      });
      if(createError){
        console.error("HOMSCARD_VARIABLE_ORDER_CREATE_FAILED",createError.message);
        return json({success:false,error:createError.message||"تعذر إنشاء الطلب. لم يتم إرسال طلب إلى المورد."},400);
      }
      const orderId=String(created?.order_id||"");
      const supplierUuid=String(created?.supplier_order_uuid||"");
      if(!orderId||!supplierUuid)return json({success:false,error:"تم تسجيل الطلب لكن بيانات متابعة المورد غير مكتملة. أوقفنا الإرسال للمراجعة.",order_id:orderId||null},503);

      const checkPath="/check.php?uuid=1&orders="+encodeURIComponent(supplierUuid);
      const settle=async (payload:any)=>{
        const rows=Array.isArray(payload?.data)?payload.data:
          payload?.data&&typeof payload.data==="object"?[payload.data]:[];
        const parsed=parseHomsCardCheck({status:payload?.status,data:rows},supplierUuid);
        if(parsed.kind==="completed"){
          if(parsed.quantity!==quantity || parsed.delivery.length>2000){
            await admin.rpc("baran_supplier_finalize_order",{p_order_id:orderId,p_result:"unknown",p_reason:"بيانات نجاح المورد لا تطابق UUID أو كمية الطلب أو حد بيانات التسليم."});
            return {status:"awaiting_supplier",message:"وصل رد غير مطابق للطلب؛ أبقيناه قيد التحقق دون تسوية مالية."};
          }
          const {error:deliveryError}=await admin.from("order_fulfillment")
            .update({supplier_delivery:parsed.delivery}).eq("order_id",orderId);
          if(deliveryError) throw deliveryError;
          const {error}=await admin.rpc("baran_supplier_finalize_order",{
            p_order_id:orderId,p_result:"succeeded",p_supplier_reference:parsed.supplierOrderId,
            p_supplier_unit_cost:parsed.totalCost/parsed.quantity,p_cost_currency:"USD",p_reason:null,
          });
          if(error)throw error;
          return {status:"completed",message:"تم تأكيد تنفيذ الطلب من HomsCard."};
        }
        if(parsed.kind==="failed"){
          const {error}=await admin.rpc("baran_supplier_finalize_order",{
            p_order_id:orderId,p_result:"failed",p_supplier_reference:parsed.supplierOrderId,
            p_reason:"أكد HomsCard إلغاء الطلب؛ تم طلب استرداد المبلغ لمحفظة الزبون.",
          });
          if(error)throw error;
          return {status:"rejected",message:"أُلغي الطلب لدى المورد وتمت معالجة الاسترداد."};
        }
        await admin.rpc("baran_supplier_finalize_order",{
          p_order_id:orderId,p_result:"unknown",
          p_reason:parsed.reason||"الطلب ما زال pending أو لم تصل نتيجة مؤكدة من HomsCard.",
        });
        return {status:"awaiting_supplier",message:"الطلب قيد التنفيذ أو التحقق؛ لن نكرر الإرسال أو الاسترداد قبل تأكيد النتيجة."};
      };

      if(created.duplicate===true){
        try{
          const checked=await homscardRequest(checkPath,"GET");
          const rows=Array.isArray(checked.payload?.data)?checked.payload.data:
            checked.payload?.data&&typeof checked.payload.data==="object"?[checked.payload.data]:[];
          if(rows.length){const result=await settle(checked.payload);return json({success:true,duplicate:true,order_id:orderId,...result});}
        }catch(error){console.error("HOMSCARD_DUPLICATE_CHECK_FAILED",String(error));}
        return json({success:true,duplicate:true,order_id:orderId,status:"awaiting_supplier",
          message:"الطلب مسجل مسبقاً. نتحقق من نفس UUID لمنع أي خصم أو شحن مكرر."});
      }

      try{
        const sent=await homscardRequest("/order.php","POST",{
          product_id:Number(productId),order_uuid:supplierUuid,qty:quantity,...(playerId?{player_id:playerId}:{})
        });
        if(sent.payload?.status==="OK"&&sent.payload?.data){
          const normalizedCreate=normalizeHomsCardCreate(sent.payload,supplierUuid,quantity);
          if(normalizedCreate){
            const result=await settle(normalizedCreate);
            return json({success:true,order_id:orderId,...result});
          }
          await admin.rpc("baran_supplier_finalize_order",{p_order_id:orderId,p_result:"unknown",
            p_reason:"رد order.php لا يطابق صيغة النجاح/الحالة الموثقة أو ينقصه تحقق السعر/الكمية/التسليم."});
          return json({success:true,order_id:orderId,status:"awaiting_supplier",
            message:"وصل رد إنشاء غير مكتمل أو غير مطابق؛ أبقينا الطلب قيد التحقق دون استرداد أو إعادة إرسال."});
        }
        const code=Number(sent.payload?.error?.code);
        if(homscardConfirmedRejection(code)){
          const reasons:Record<number,string>={
            100:"رصيد حساب HomsCard غير كافٍ؛ رفض المورد الطلب.",
            103:"بيانات اللاعب المطلوبة غير مكتملة؛ رفض المورد الطلب.",
            109:"معرّف المنتج غير موجود لدى HomsCard.",
            110:"المنتج غير متاح لدى HomsCard.",
            112:"الكمية أقل من الحد الأدنى لدى المورد.",
            113:"الكمية أكبر من الحد الأعلى لدى المورد.",
            114:"أكد HomsCard رفض الطلب؛ يعالج المورد إعادة المبلغ إلى رصيد حسابه.",
          };
          const {error:settleError}=await admin.rpc("baran_supplier_finalize_order",{
            p_order_id:orderId,p_result:"failed",
            p_reason:"رفض مؤكد من HomsCard (code "+code+"): "+reasons[code],
          });
          if(settleError)throw settleError;
          return json({success:true,order_id:orderId,status:"rejected",refunded:true,
            supplier_error_code:code,message:"رفض المورد الطلب وتمت معالجة استرداد رصيد الزبون في باران."});
        }
        if(sent.http_status>=500||code===500||code===102){
          const checked=await homscardRequest(checkPath,"GET");
          const rows=Array.isArray(checked.payload?.data)?checked.payload.data:
            checked.payload?.data&&typeof checked.payload.data==="object"?[checked.payload.data]:[];
          if(rows.length){const result=await settle(checked.payload);return json({success:true,order_id:orderId,...result});}
          await admin.rpc("baran_supplier_finalize_order",{p_order_id:orderId,p_result:"unknown",p_reason:"انقطع أو تعذر حسم رد إنشاء الطلب؛ تم فحص UUID ولم تظهر نتيجة مؤكدة."});
          return json({success:true,order_id:orderId,status:"awaiting_supplier",message:"الطلب قيد التحقق لدى المورد؛ لم نعد إرساله ولم نسترد المبلغ."});
        }
        await admin.rpc("baran_supplier_finalize_order",{
          p_order_id:orderId,p_result:"unknown",
          p_reason:String(sent.payload?.error?.message||"لم يصل رد نجاح مؤكد من HomsCard؛ لا يمكن إثبات أن الطلب لم يُنشأ.").slice(0,500),
        });
        return json({success:true,order_id:orderId,status:"awaiting_supplier",
          message:"لم يصل تأكيد نهائي من المورد. أبقينا الطلب قيد التحقق دون إعادة إرسال أو استرداد حتى لا يحدث شحن أو خصم مزدوج."});
      }catch(error){
        console.error("HOMSCARD_ORDER_DISPATCH_UNCERTAIN",String(error));
        try{
          const checked=await homscardRequest(checkPath,"GET");
          const rows=Array.isArray(checked.payload?.data)?checked.payload.data:
            checked.payload?.data&&typeof checked.payload.data==="object"?[checked.payload.data]:[];
          if(rows.length){const result=await settle(checked.payload);return json({success:true,order_id:orderId,...result});}
        }catch(checkError){console.error("HOMSCARD_ORDER_STATUS_CHECK_FAILED",String(checkError));}
        await admin.rpc("baran_supplier_finalize_order",{p_order_id:orderId,p_result:"unknown",p_reason:"انقطع الاتصال أثناء الإرسال وتعذر التحقق؛ الطلب معلّق لمنع التكرار."});
        return json({success:true,order_id:orderId,status:"awaiting_supplier",
          message:"انقطع الاتصال أثناء الإرسال. حفظنا UUID ونعلّق الطلب للتحقق؛ لا يوجد إعادة إرسال أو استرداد تلقائي."});
      }
    }

    if (body?.action === "homscard_fixed_create_order") {
      const productCode = typeof body.product_code === "string" ? body.product_code.trim().toUpperCase() : "";
      const quantity = 1;
      const currency = typeof body.payment_currency === "string" ? body.payment_currency.toUpperCase() : "SYP";
      const playerId = typeof body.player_id === "string" ? body.player_id.trim() : "";
      const requestId = typeof body.request_id === "string" ? body.request_id.trim() : "";
      if (!/^[A-Z0-9_]{3,100}$/.test(productCode) ||
          !["USD","SYP"].includes(currency) ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId) ||
          playerId.length > 100) return json({success:false,error:"بيانات الطلب غير صالحة."},400);
      if (!Deno.env.get("HOMSCARD_API_TOKEN")) return json({success:false,error:"مفتاح HomsCard API غير مضبوط على الخادم؛ لم يتم إنشاء طلب أو خصم رصيد.",code:"SUPPLIER_SECRET_MISSING"},503);

      const {data: created,error:createError}=await admin.rpc("baran_create_homscard_fixed_order",{
        p_user_id:user.id,p_product_code:productCode,p_player_id:playerId,
        p_payment_currency:currency,p_request_id:requestId,
      });
      if(createError){
        console.error("HOMSCARD_FIXED_ORDER_CREATE_FAILED",createError.message);
        return json({success:false,error:createError.message||"تعذر إنشاء الطلب الثابت. لم يتم إرسال طلب إلى المورد."},400);
      }
      const orderId=String(created?.order_id||"");
      const productId=String(created?.supplier_sku||"");
      const supplierUuid=String(created?.supplier_order_uuid||"");
      if(!/^[0-9]{1,10}$/.test(productId))return json({success:false,error:"معرّف منتج المورد غير مكتمل؛ أوقفنا الإرسال للمراجعة.",order_id:orderId||null},503);
      if(!orderId||!supplierUuid)return json({success:false,error:"تم تسجيل الطلب لكن بيانات متابعة المورد غير مكتملة. أوقفنا الإرسال للمراجعة.",order_id:orderId||null},503);

      const checkPath="/check.php?uuid=1&orders="+encodeURIComponent(supplierUuid);
      const settle=async (payload:any)=>{
        const rows=Array.isArray(payload?.data)?payload.data:
          payload?.data&&typeof payload.data==="object"?[payload.data]:[];
        const parsed=parseHomsCardCheck({status:payload?.status,data:rows},supplierUuid);
        if(parsed.kind==="completed"){
          if(parsed.quantity!==quantity || parsed.delivery.length>2000){
            await admin.rpc("baran_supplier_finalize_order",{p_order_id:orderId,p_result:"unknown",p_reason:"بيانات نجاح المورد لا تطابق UUID أو كمية الطلب أو حد بيانات التسليم."});
            return {status:"awaiting_supplier",message:"وصل رد غير مطابق للطلب؛ أبقيناه قيد التحقق دون تسوية مالية."};
          }
          const {error:deliveryError}=await admin.from("order_fulfillment")
            .update({supplier_delivery:parsed.delivery}).eq("order_id",orderId);
          if(deliveryError) throw deliveryError;
          const {error}=await admin.rpc("baran_supplier_finalize_order",{
            p_order_id:orderId,p_result:"succeeded",p_supplier_reference:parsed.supplierOrderId,
            p_supplier_unit_cost:parsed.totalCost/parsed.quantity,p_cost_currency:"USD",p_reason:null,
          });
          if(error)throw error;
          return {status:"completed",message:"تم تأكيد تنفيذ الطلب من HomsCard."};
        }
        if(parsed.kind==="failed"){
          const {error}=await admin.rpc("baran_supplier_finalize_order",{
            p_order_id:orderId,p_result:"failed",p_supplier_reference:parsed.supplierOrderId,
            p_reason:"أكد HomsCard إلغاء الطلب؛ تم طلب استرداد المبلغ لمحفظة الزبون.",
          });
          if(error)throw error;
          return {status:"rejected",message:"أُلغي الطلب لدى المورد وتمت معالجة الاسترداد."};
        }
        await admin.rpc("baran_supplier_finalize_order",{
          p_order_id:orderId,p_result:"unknown",
          p_reason:parsed.reason||"الطلب ما زال pending أو لم تصل نتيجة مؤكدة من HomsCard.",
        });
        return {status:"awaiting_supplier",message:"الطلب قيد التنفيذ أو التحقق؛ لن نكرر الإرسال أو الاسترداد قبل تأكيد النتيجة."};
      };

      if(created.duplicate===true){
        try{
          const checked=await homscardRequest(checkPath,"GET");
          const rows=Array.isArray(checked.payload?.data)?checked.payload.data:
            checked.payload?.data&&typeof checked.payload.data==="object"?[checked.payload.data]:[];
          if(rows.length){const result=await settle(checked.payload);return json({success:true,duplicate:true,order_id:orderId,...result});}
        }catch(error){console.error("HOMSCARD_DUPLICATE_CHECK_FAILED",String(error));}
        return json({success:true,duplicate:true,order_id:orderId,status:"awaiting_supplier",
          message:"الطلب مسجل مسبقاً. نتحقق من نفس UUID لمنع أي خصم أو شحن مكرر."});
      }

      try{
        const sent=await homscardRequest("/order.php","POST",{
          product_id:Number(productId),order_uuid:supplierUuid,qty:quantity,...(playerId?{player_id:playerId}:{})
        });
        if(sent.payload?.status==="OK"&&sent.payload?.data){
          const normalizedCreate=normalizeHomsCardCreate(sent.payload,supplierUuid,quantity);
          if(normalizedCreate){
            const result=await settle(normalizedCreate);
            return json({success:true,order_id:orderId,...result});
          }
          await admin.rpc("baran_supplier_finalize_order",{p_order_id:orderId,p_result:"unknown",
            p_reason:"رد order.php لا يطابق صيغة النجاح/الحالة الموثقة أو ينقصه تحقق السعر/الكمية/التسليم."});
          return json({success:true,order_id:orderId,status:"awaiting_supplier",
            message:"وصل رد إنشاء غير مكتمل أو غير مطابق؛ أبقينا الطلب قيد التحقق دون استرداد أو إعادة إرسال."});
        }
        const code=Number(sent.payload?.error?.code);
        if(homscardConfirmedRejection(code)){
          const reasons:Record<number,string>={
            100:"رصيد حساب HomsCard غير كافٍ؛ رفض المورد الطلب.",
            103:"بيانات اللاعب المطلوبة غير مكتملة؛ رفض المورد الطلب.",
            109:"معرّف المنتج غير موجود لدى HomsCard.",
            110:"المنتج غير متاح لدى HomsCard.",
            112:"الكمية أقل من الحد الأدنى لدى المورد.",
            113:"الكمية أكبر من الحد الأعلى لدى المورد.",
            114:"أكد HomsCard رفض الطلب؛ يعالج المورد إعادة المبلغ إلى رصيد حسابه.",
          };
          const {error:settleError}=await admin.rpc("baran_supplier_finalize_order",{
            p_order_id:orderId,p_result:"failed",
            p_reason:"رفض مؤكد من HomsCard (code "+code+"): "+reasons[code],
          });
          if(settleError)throw settleError;
          return json({success:true,order_id:orderId,status:"rejected",refunded:true,
            supplier_error_code:code,message:"رفض المورد الطلب وتمت معالجة استرداد رصيد الزبون في باران."});
        }
        if(sent.http_status>=500||code===500||code===102){
          const checked=await homscardRequest(checkPath,"GET");
          const rows=Array.isArray(checked.payload?.data)?checked.payload.data:
            checked.payload?.data&&typeof checked.payload.data==="object"?[checked.payload.data]:[];
          if(rows.length){const result=await settle(checked.payload);return json({success:true,order_id:orderId,...result});}
          await admin.rpc("baran_supplier_finalize_order",{p_order_id:orderId,p_result:"unknown",p_reason:"انقطع أو تعذر حسم رد إنشاء الطلب؛ تم فحص UUID ولم تظهر نتيجة مؤكدة."});
          return json({success:true,order_id:orderId,status:"awaiting_supplier",message:"الطلب قيد التحقق لدى المورد؛ لم نعد إرساله ولم نسترد المبلغ."});
        }
        await admin.rpc("baran_supplier_finalize_order",{
          p_order_id:orderId,p_result:"unknown",
          p_reason:String(sent.payload?.error?.message||"لم يصل رد نجاح مؤكد من HomsCard؛ لا يمكن إثبات أن الطلب لم يُنشأ.").slice(0,500),
        });
        return json({success:true,order_id:orderId,status:"awaiting_supplier",
          message:"لم يصل تأكيد نهائي من المورد. أبقينا الطلب قيد التحقق دون إعادة إرسال أو استرداد حتى لا يحدث شحن أو خصم مزدوج."});
      }catch(error){
        console.error("HOMSCARD_ORDER_DISPATCH_UNCERTAIN",String(error));
        try{
          const checked=await homscardRequest(checkPath,"GET");
          const rows=Array.isArray(checked.payload?.data)?checked.payload.data:
            checked.payload?.data&&typeof checked.payload.data==="object"?[checked.payload.data]:[];
          if(rows.length){const result=await settle(checked.payload);return json({success:true,order_id:orderId,...result});}
        }catch(checkError){console.error("HOMSCARD_ORDER_STATUS_CHECK_FAILED",String(checkError));}
        await admin.rpc("baran_supplier_finalize_order",{p_order_id:orderId,p_result:"unknown",p_reason:"انقطع الاتصال أثناء الإرسال وتعذر التحقق؛ الطلب معلّق لمنع التكرار."});
        return json({success:true,order_id:orderId,status:"awaiting_supplier",
          message:"انقطع الاتصال أثناء الإرسال. حفظنا UUID ونعلّق الطلب للتحقق؛ لا يوجد إعادة إرسال أو استرداد تلقائي."});
      }
    }

    if (body?.action === "homscard_variable_check_order" || body?.action === "homscard_fixed_check_order") {
      const orderId=typeof body.order_id==="string"?body.order_id.trim():"";
      if(!/^[0-9a-f-]{36}$/i.test(orderId))return json({success:false,error:"معرّف الطلب غير صالح."},400);
      const isFixedCheck=body.action==="homscard_fixed_check_order";
      const {data:order,error:orderError}=await admin.from("orders")
        .select("id,user_id,product_code,quantity,status")
        .eq("id",orderId).eq("user_id",user.id).maybeSingle();
      if(orderError||!order)return json({success:false,error:"الطلب غير موجود أو لا تملك صلاحية الاطلاع عليه."},404);
      if(isFixedCheck){
        const {data:product,error:productError}=await admin.from("products")
          .select("catalog_group").eq("product_code",order.product_code).maybeSingle();
        if(productError||product?.catalog_group!=="homscard_fixed")
          return json({success:false,error:"هذا الطلب ليس من كتالوج HomsCard الثابت."},403);
        if(Number(order.quantity)!==1)
          return json({success:false,error:"كمية الطلب لا تطابق نظام المنتجات الثابتة."},409);
      }
      const {data:fulfillment,error:fulfillmentError}=await admin.from("order_fulfillment")
        .select("supplier_order_uuid,supplier_id,supplier_delivery,dispatch_state")
        .eq("order_id",orderId).maybeSingle();
      if(fulfillmentError||!fulfillment?.supplier_order_uuid||!fulfillment.supplier_id)
        return json({success:false,error:"لا توجد بيانات متابعة HomsCard لهذا الطلب."},404);
      const {data:orderSupplier,error:supplierError}=await admin.from("suppliers")
        .select("name").eq("id",fulfillment.supplier_id).maybeSingle();
      if(supplierError||String(orderSupplier?.name||"").toLowerCase()!=="homscard")
        return json({success:false,error:"مورد هذا الطلب لا يطابق HomsCard؛ أوقفنا الاستعلام."},403);
      if(["succeeded","refunded","failed"].includes(String(fulfillment.dispatch_state))){
        return json({success:true,order_id:orderId,status:order.status,dispatch_state:fulfillment.dispatch_state,delivery:fulfillment.supplier_delivery});
      }
      const uuid=String(fulfillment.supplier_order_uuid);
      try{
        const checked=await homscardRequest("/check.php?uuid=1&orders="+encodeURIComponent(uuid),"GET");
        const parsed=parseHomsCardCheck(checked.payload,uuid);
        if(parsed.kind==="completed"){
          if(parsed.quantity!==Number(order.quantity)||parsed.delivery.length>2000)
            return json({success:true,order_id:orderId,status:"awaiting_supplier",message:"رد المورد لا يطابق كمية الطلب أو بيانات التسليم؛ بقي قيد المراجعة."});
          const {error:deliveryError}=await admin.from("order_fulfillment")
            .update({supplier_delivery:parsed.delivery}).eq("order_id",orderId);
          if(deliveryError)throw deliveryError;
          const {error}=await admin.rpc("baran_supplier_finalize_order",{
            p_order_id:orderId,p_result:"succeeded",p_supplier_reference:parsed.supplierOrderId,
            p_supplier_unit_cost:parsed.totalCost/parsed.quantity,p_cost_currency:"USD",p_reason:null,
          });
          if(error)throw error;
          return json({success:true,order_id:orderId,status:"completed",delivery:parsed.delivery});
        }
        if(parsed.kind==="failed"){
          const {error}=await admin.rpc("baran_supplier_finalize_order",{
            p_order_id:orderId,p_result:"failed",p_supplier_reference:parsed.supplierOrderId,
            p_reason:"أكد HomsCard إلغاء الطلب.",
          });
          if(error)throw error;
          return json({success:true,order_id:orderId,status:"rejected",refunded:true});
        }
        const {error:unknownError}=await admin.rpc("baran_supplier_finalize_order",{
          p_order_id:orderId,p_result:"unknown",p_reason:parsed.reason||"ما زال الطلب pending لدى HomsCard.",
        });
        if(unknownError)throw unknownError;
        return json({success:true,order_id:orderId,status:"awaiting_supplier",message:"الطلب ما زال قيد التحقق؛ لم نكرر الإرسال أو الاسترداد."});
      }catch(error){
        console.error("HOMSCARD_ORDER_POLL_FAILED",String(error));
        return json({success:false,order_id:orderId,status:"awaiting_supplier",error:"تعذر التحقق حالياً؛ لم نكرر الإرسال أو الاسترداد."},503);
      }
    }

    if (body?.action === "jawaker_quote") {
      const quantity = Number(body.quantity);
      const playerId = typeof body.player_id === "string" ? body.player_id.trim() : "";
      const currency = typeof body.payment_currency === "string" ? body.payment_currency.toUpperCase() : "SYP";
      if (!Number.isSafeInteger(quantity) || quantity < 10000 || quantity > 10000000) {
        return json({ success: false, error: "الكمية يجب أن تكون عدداً صحيحاً بين 10,000 و10,000,000." }, 400);
      }
      if (!["USD", "SYP"].includes(currency)) return json({ success: false, error: "عملة الدفع غير مدعومة." }, 400);

      const { data: product, error: productError } = await admin.from("products")
        .select("id,product_code,name,category,is_active,markup_percent")
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
      const markupPercent = Number(product.markup_percent ?? settings.product_markup_percent);
      if (![marketRate, bufferPercent, markupPercent].every(Number.isFinite) || marketRate <= 0 || bufferPercent < 0 || markupPercent < 0) {
        return json({ success: false, error: "إعدادات سعر الصرف أو هامش الربح غير صالحة." }, 503);
      }
      const commercialRate = marketRate * (1 + bufferPercent / 100);
      const unitCost = Number(mapping.unit_cost);
      const totalCost = unitCost * quantity;
      const exactSaleUsd = totalCost * (1 + markupPercent / 100);
      const exactSaleSyp = exactSaleUsd * commercialRate / 100;
      const round = (value: number, digits: number) => Number((value + Number.EPSILON).toFixed(digits));
      const { data: adminRecord, error: adminCheckError } = await admin.from("admin_users")
        .select("user_id").eq("user_id", user.id).maybeSingle();
      if (adminCheckError) return json({ success: false, error: "تعذر التحقق من صلاحية الإدارة." }, 500);
      const isAdmin = !!adminRecord;
      const quote: Record<string, unknown> = {
        quantity,
        sale_usd: round(exactSaleUsd, 2),
        sale_syp: Number(exactSaleSyp.toFixed(2)),
        commercial_rate: round(commercialRate / 100, 2),
        markup_percent: markupPercent,
        currency,
      };
      if (isAdmin) {
        quote.cost_usd = round(totalCost, 6);
        quote.profit_usd = round(exactSaleUsd - totalCost, 6);
        quote.profit_syp = Number(((exactSaleUsd - totalCost) * commercialRate / 100).toFixed(2));
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