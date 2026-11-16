import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigin = "https://eyadooon-cmyk.github.io";
const headers = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Vary": "Origin",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    const origin = req.headers.get("Origin");
    if (origin && origin !== allowedOrigin) return new Response("Forbidden", { status: 403 });
    return new Response("ok", { headers });
  }
  if (req.method !== "GET") return reply({ error: "Method not allowed" }, 405);
  const origin = req.headers.get("Origin");
  if (origin && origin !== allowedOrigin) return reply({ error: "Origin not allowed" }, 403);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anon || !service) return reply({ error: "Server configuration incomplete" }, 500);

    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return reply({ error: "Authentication required" }, 401);

    const authClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return reply({ error: "Invalid session" }, 401);

    const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: isAdmin, error: adminError } = await db.rpc("admin_is_user", {
      p_user_id: authData.user.id,
    });
    if (adminError || isAdmin !== true) return reply({ error: "Administrator access required" }, 403);

    const [{ data: suppliers, error: suppliersError }, { data: links, error: linksError },
      { data: products, error: productsError }] = await Promise.all([
      db.from("suppliers")
        .select("id,name,contact_name,contact_phone,contact_email,notes,is_active,created_at,updated_at")
        .order("name").limit(200),
      db.from("supplier_products")
        .select("id,supplier_id,product_id,supplier_sku,unit_cost,currency,is_preferred,lead_time_hours,notes,input_schema,updated_at")
        .order("updated_at", { ascending: false }).limit(500),
      db.from("products")
        .select("id,product_code,name,category,is_active,price_usd,price_syp")
        .order("sort_order").limit(500),
    ]);
    if (suppliersError || linksError || productsError) {
      console.error("Syria Market read failed", {
        suppliers: suppliersError?.message,
        links: linksError?.message,
        products: productsError?.message,
      });
      return reply({ error: "تعذر تحميل بيانات سوريا ماركت." }, 502);
    }

    return reply({
      success: true,
      mode: "read_only",
      writes_enabled: false,
      supplier_orders_enabled: false,
      finance_enabled: false,
      suppliers: suppliers ?? [],
      supplier_products: links ?? [],
      products: products ?? [],
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Syria Market read error", error);
    return reply({ error: "Unexpected server error" }, 500);
  }
});
