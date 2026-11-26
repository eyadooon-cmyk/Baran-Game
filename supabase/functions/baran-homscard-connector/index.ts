import { createClient } from "npm:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = new Set([
  "https://baran-game.pages.dev",
  "https://eyadooon-cmyk.github.io",
  "https://64f38ad6.baran-game.pages.dev",
  "https://feature-homscard-auto-produc.baran-game.pages.dev",
]);
const json = (body: unknown, status = 200, origin = "https://baran-game.pages.dev") =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
async function signHmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)));
}
function htmlAttr(tag: string, name: string): string {
  const match = tag.match(new RegExp("\\b" + name + "\\s*=\\s*(['\"])(.*?)\\1", "i"));
  return decodeHtml(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
}
function extractProductPage(html: string) {
  const title = decodeHtml((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/<[^>]+>/g, " ").trim());
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map(m => m[0]);
  const metaValue = (names: string[]) => {
    for (const tag of metas) {
      const key = (htmlAttr(tag, "name") || htmlAttr(tag, "property")).toLowerCase();
      if (names.includes(key)) return htmlAttr(tag, "content");
    }
    return "";
  };
  const description = metaValue(["description", "og:description", "twitter:description"]);
  const canonicalTag = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*>/i)?.[0] ?? "";
  const images: string[] = [];
  const addImage = (value: string) => {
    const raw = decodeHtml(value).trim();
    if (!raw || /^(data:|blob:|javascript:)/i.test(raw)) return;
    try {
      const url = new URL(raw, "https://homscard.com/");
      if (url.protocol === "https:" && /(homscard\.com|amazonaws\.com|cloudfront\.net)$/i.test(url.hostname) && !images.includes(url.href)) images.push(url.href);
    } catch {}
  };
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    for (const attr of ["src", "data-src", "data-lazy-src", "data-original", "srcset"]) {
      const value = htmlAttr(tag, attr);
      if (value) addImage(attr === "srcset" ? value.split(",")[0].trim().split(/\s+/)[0] : value);
    }
  }
  for (const tag of metas) {
    const property = (htmlAttr(tag, "property") || htmlAttr(tag, "name")).toLowerCase();
    if (property === "og:image" || property === "twitter:image") addImage(htmlAttr(tag, "content"));
  }
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  const text = decodeHtml(body
    .replace(/<(script|style|noscript|svg|iframe)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()).slice(0, 30000);
  const normalized = text.normalize("NFKC").replace(/\s+/g, " ");
  const upstreamError = /(عذراً،?\s*حدث خطأ في الاتصال|حدث خطأ في الاتصال|connection error|temporarily unavailable|cloudflare.*error)/i.test(normalized);
  const hasProductMarker = /(تفاصيل المنتج|اسم المنتج|نوع العملية|سعر المنتج|للوحدة|الكمية\s*\(|product details)/i.test(normalized);
  const unavailable = /(غير متاح|غير متوفر|نفد المخزون|out of stock|unavailable)/i.test(normalized);
  const available = !unavailable && /(متاح 24\/7|متوفر الآن|متاح الآن|available now|in stock)/i.test(normalized);
  const availability = unavailable ? "unavailable" : available ? "available" : "unknown";
  return {
    title, description, canonical: htmlAttr(canonicalTag, "href"), text, images: images.slice(0, 30),
    availability, extraction_status: upstreamError ? "upstream_error" : hasProductMarker ? "extracted" : "unverified",
    extraction_note: upstreamError ? "صفحة المورد أعادت رسالة خطأ اتصال ضمن محتواها." : hasProductMarker ? null : "لم تظهر علامة مؤكدة على تفاصيل المنتج؛ يلزم التحقق.",
    html_length: html.length
  };
}
Deno.serve(async (req: Request) => {
  const originHeader = req.headers.get("Origin") ?? "";
  const origin = ALLOWED_ORIGINS.has(originHeader) ? originHeader : "https://baran-game.pages.dev";
  if (req.method === "OPTIONS") {
    if (originHeader && !ALLOWED_ORIGINS.has(originHeader)) return new Response("Forbidden", { status: 403 });
    return new Response("ok", { headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Vary": "Origin",
    }});
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  if (originHeader && !ALLOWED_ORIGINS.has(originHeader)) return json({ error: "Origin not allowed" }, 403, origin);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const apiToken = Deno.env.get("HOMSCARD_API_TOKEN");
    const hmacSecret = Deno.env.get("HOMSCARD_HMAC_SECRET") ?? "";
    if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Server configuration incomplete" }, 503, origin);

    const authorization = req.headers.get("Authorization") ?? "";
    const jwt = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!jwt) return json({ error: "Authentication required" }, 401, origin);
    const userClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await userClient.auth.getUser(jwt);
    if (authError || !authData.user) return json({ error: "Invalid session" }, 401, origin);

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: isAdmin, error: adminError } = await admin.rpc("admin_is_user", { p_user_id: authData.user.id });
    if (adminError || isAdmin !== true) return json({ error: "Administrator access required" }, 403, origin);
    let body: any;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400, origin); }
    const action = body?.action;
    if (action === "save_audit_batch") {
      const runId = String(body.run_id ?? "");
      const rows = Array.isArray(body.rows) ? body.rows : [];
      if (!/^[0-9a-f-]{36}$/i.test(runId) || !rows.length || rows.length > 50) return json({ error: "Invalid audit batch" }, 400, origin);
      const { data: existingRun, error: existingRunError } = await admin.from("baran_homscard_audit_runs").select("created_by").eq("run_id", runId).maybeSingle();
      if (existingRunError) return json({ error: "تعذر التحقق من ملكية سجل التدقيق." }, 500, origin);
      if (existingRun && existingRun.created_by !== authData.user.id) return json({ error: "سجل التدقيق لا يخص هذا المدير." }, 403, origin);
      const now = new Date().toISOString();
      const { error: runError } = await admin.from("baran_homscard_audit_runs").upsert({run_id:runId,created_by:authData.user.id,catalog_count:Number.isInteger(body.catalog_count)?Math.max(0,Math.min(body.catalog_count,10000)):rows.length,updated_at:now},{onConflict:"run_id"});
      if (runError) { console.error("HOMSCARD_AUDIT_RUN_SAVE_FAILED",runError.message); return json({error:"تعذر حفظ سجل التدقيق في قاعدة البيانات."},500,origin); }
      const records = [];
      for (const row of rows) {
        const id=String(row?.product_id??"");
        if (!/^\d{1,10}$/.test(id) || !row?.product_data || typeof row.product_data!=="object") return json({error:"Invalid product record in audit batch"},400,origin);
        const pageStatus=["not_checked","success","failed"].includes(row.page_status)?row.page_status:"not_checked";
        records.push({run_id:runId,product_id:id,product_name:String(row.product_name??"").slice(0,500),product_data:row.product_data,page_data:row.page_data&&typeof row.page_data==="object"?row.page_data:{},page_status:pageStatus,page_error:String(row.page_error??"").slice(0,500)||null,audit_data:row.audit_data&&typeof row.audit_data==="object"?row.audit_data:{},updated_at:now});
      }
      const {error:itemError}=await admin.from("baran_homscard_audit_items").upsert(records,{onConflict:"run_id,product_id"});
      if(itemError){console.error("HOMSCARD_AUDIT_ITEMS_SAVE_FAILED",itemError.message);return json({error:"تعذر حفظ تفاصيل منتجات التدقيق."},500,origin);}
      return json({success:true,action,run_id:runId,saved:records.length,saved_at:now},200,origin);
    }
    if (action === "get_latest_audit") {
      const {data:run,error:runError}=await admin.from("baran_homscard_audit_runs").select("run_id,catalog_count,created_at,updated_at").eq("created_by",authData.user.id).order("updated_at",{ascending:false}).limit(1).maybeSingle();
      if(runError)return json({error:"تعذر قراءة سجل التدقيق المحفوظ."},500,origin);
      if(!run)return json({success:true,action,run:null,data:[]},200,origin);
      const {data:items,error:itemsError}=await admin.from("baran_homscard_audit_items").select("product_id,product_name,product_data,page_data,page_status,page_error,audit_data,updated_at").eq("run_id",run.run_id).order("product_id",{ascending:true});
      if(itemsError)return json({error:"تعذر قراءة تفاصيل التدقيق المحفوظ."},500,origin);
      return json({success:true,action,run,count:items?.length??0,data:items??[]},200,origin);
    }
    if (!apiToken) return json({ error: "HOMSCARD_API_TOKEN is not configured in Supabase secrets" }, 503, origin);
    const query = new URLSearchParams();
    let path = "";
    if (action === "profile") {
      path = "/profile.php";
    } else if (action === "product_pages") {
      const ids = Array.isArray(body.products_id) ? body.products_id.map((v: unknown) => String(v)) : [];
      if (!ids.length || ids.length > 25 || ids.some((v: string) => !/^\d{1,10}$/.test(v))) {
        return json({ error: "product_pages requires 1–25 valid numeric product IDs" }, 400, origin);
      }
      const pages: Array<Record<string, unknown>> = [];
      for (let offset = 0; offset < ids.length; offset += 5) {
        const batch = await Promise.all(ids.slice(offset, offset + 5).map(async (id: string) => {
        try {
          const pageResponse = await fetch("https://homscard.com/product.php?id=" + encodeURIComponent(id), {
            headers: { "Accept": "text/html", "User-Agent": "Mozilla/5.0 (compatible; BaranCatalogAudit/1.0)" },
            signal: AbortSignal.timeout(12000),
          });
          if (!pageResponse.ok) return { id, success: false, page_status: "http_error", error: "HTTP " + pageResponse.status };
          const html = await pageResponse.text();
          if (!html || html.length > 2_000_000) return { id, success: false, page_status: "invalid_response", error: "Invalid or oversized product page" };
          const extracted = extractProductPage(html);
          const valid = extracted.extraction_status === "extracted";
          return { id, success: valid, page_status: extracted.extraction_status, error: valid ? null : extracted.extraction_note, ...extracted };
        } catch {
          return { id, success: false, error: "تعذر جلب صفحة المنتج" };
        }
        }));
        pages.push(...batch);
      }
      return json({ success: true, provider: "HomsCard", action, count: pages.length, data: pages,
        note: "Public product-page metadata only. Read-only; no order or payment action." }, 200, origin);
    } else if (action === "products") {
      path = "/products.php";
      if (body.available_only === true) query.set("available", "1");
      if (Array.isArray(body.products_id) && body.products_id.length) {
        const ids = body.products_id.map((v: unknown) => String(v));
        if (ids.length > 100 || ids.some((v: string) => !/^\d{1,10}$/.test(v))) {
          return json({ error: "Invalid products_id filter" }, 400, origin);
        }
        query.set("products_id", ids.join(","));
      }
    } else {
      return json({ error: "Allowed actions: profile, products, product_pages. Order creation is intentionally disabled." }, 400, origin);
    }
    if (query.size) path += "?" + query.toString();

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const headers: Record<string, string> = { "api-token": apiToken, "Accept": "application/json" };
    if (hmacSecret) {
      const signature = await signHmac(hmacSecret, timestamp + "\nGET\n" + "/reseller" + path + "\n");
      headers["X-Timestamp"] = timestamp;
      headers["X-Signature"] = signature;
    }
    const response = await fetch("https://homscard.com/reseller" + path, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(20000),
    });
    const raw = await response.text();
    let data: any;
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: "Invalid JSON response" }; }
    if (!response.ok || data?.status !== "OK") {
      console.error("HOMSCARD_API_READ_FAILED", { action, status: response.status, code: data?.error?.code ?? null });
      return json({ success: false, provider: "HomsCard", action, upstream_status: response.status,
        error: data?.error?.message ?? "HomsCard API request failed", code: data?.error?.code ?? null }, 502, origin);
    }
    if (action === "profile") {
      const profile = data.data ?? {};
      const balance = Number(profile.balance);
      if (Number.isFinite(balance) && balance >= 0) {
        const { data: supplier } = await admin.from("suppliers").select("id")
          .eq("name", "HomsCard").maybeSingle();
        if (supplier?.id) {
          const [{ error: healthError }, { error: balanceError }] = await Promise.all([
            admin.rpc("baran_supplier_record_health_check", {
              p_supplier_id: supplier.id, p_is_healthy: true, p_http_status: response.status,
              p_error_message: null,
            }),
            admin.rpc("baran_supplier_record_balance", {
              p_supplier_id: supplier.id, p_balance: balance, p_currency: "USD",
              p_details: { source: "homscard_api_profile", discount: profile.discount ?? null },
            }),
          ]);
          if (healthError) console.error("HOMSCARD_HEALTH_RECORD_FAILED", healthError.message);
          if (balanceError) console.error("HOMSCARD_BALANCE_RECORD_FAILED", balanceError.message);
        }
      }
      return json({ success: true, provider: "HomsCard", action, data: {
        name: profile.name ?? null, email: profile.email ?? null, balance: profile.balance ?? null,
        currency: profile.currency ?? "USD", discount: profile.discount ?? null,
      }, fetched_at: new Date().toISOString() }, 200, origin);
    }
    const products = Array.isArray(data.data) ? data.data : null;
    if (!products) return json({ error: "Unexpected HomsCard products response shape" }, 502, origin);
    return json({ success: true, provider: "HomsCard", action, count: products.length,
      data: products.map((p: any) => ({
        id: p.id, name: p.name, price: p.price, category: p.category,
        available: typeof p.available === "boolean" ? p.available : null, availability: typeof p.available === "boolean" ? (p.available ? "available" : "unavailable") : "unknown",
        product_type: p.product_type ?? null,
        qty_values: p.qty_values ?? null, params: p.params ?? [],
        image: typeof p.image === "string" && /^https:\\/\\//i.test(p.image) ? p.image : null,
        description: p.description ?? null,
      })), fetched_at: new Date().toISOString(),
      note: "Read-only catalog request. No order was created and no balance was charged." }, 200, origin);
  } catch (error) {
    console.error("baran-homscard-connector failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "تعذر الاتصال بحمص كارد حالياً." }, 500);
  }
});
