import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCheckPath, parseHomsCardCheck, retryDelaySeconds } from "./core.mjs";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
});

async function signedGet(path: string, token: string, secret: string): Promise<{ response: Response; payload: unknown }> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const headers: Record<string, string> = { "api-token": token, "Accept": "application/json" };
  if (secret) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const message = timestamp + "\nGET\n" + path + "\n";
    const signature = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message))),
      (b) => b.toString(16).padStart(2, "0")).join("");
    headers["X-Timestamp"] = timestamp;
    headers["X-Signature"] = signature;
  }
  const response = await fetch("https://homscard.com" + path, {
    method: "GET", headers, signal: AbortSignal.timeout(15000),
  });
  const raw = await response.text();
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch { /* malformed response stays unknown */ }
  return { response, payload };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const token = Deno.env.get("HOMSCARD_API_TOKEN");
  const hmacSecret = Deno.env.get("HOMSCARD_HMAC_SECRET") ?? "";
  if (!url || !serviceKey || !token) return json({ error: "Worker server configuration is incomplete" }, 503);

  const rawBody = await req.text();
  let body: unknown;
  try { body = rawBody ? JSON.parse(rawBody) : null; } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!body || typeof body !== "object" || (body as { source?: string }).source !== "cron") {
    return json({ error: "Invalid worker payload" }, 400);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const timestamp = req.headers.get("x-baran-timestamp") ?? "";
  const signature = req.headers.get("x-baran-signature") ?? "";
  const { data: signatureValid, error: signatureError } = await admin.rpc(
    "baran_verify_homscard_reconcile_signature",
    { p_timestamp: timestamp, p_body: rawBody, p_signature: signature },
  );
  if (signatureError || signatureValid !== true) return json({ error: "Unauthorized" }, 401);
  const { data: supplier, error: supplierError } = await admin.from("suppliers")
    .select("id").eq("name", "HomsCard").maybeSingle();
  if (supplierError || !supplier?.id) return json({ error: "HomsCard supplier record is unavailable" }, 503);

  const now = new Date().toISOString();
  const { data: rows, error: rowsError } = await admin.from("order_fulfillment")
    .select("order_id,supplier_id,supplier_order_uuid,dispatch_state,supplier_status,next_retry_at")
    .eq("supplier_id", supplier.id)
    .in("dispatch_state", ["awaiting_result", "sent", "processing"])
    .or("next_retry_at.is.null,next_retry_at.lte." + now)
    .not("supplier_order_uuid", "is", null)
    .order("updated_at", { ascending: true })
    .limit(3);
  if (rowsError) {
    console.error("BARAN_HOMSCARD_RECONCILE_QUEUE_READ_FAILED", rowsError.message);
    return json({ error: "Unable to load reconciliation queue" }, 500);
  }

  const summary = { scanned: rows?.length ?? 0, completed: 0, failed: 0, pending: 0, unknown: 0, errors: 0 };
  for (const row of rows ?? []) {
    try {
      const uuid = String(row.supplier_order_uuid ?? "");
      const path = buildCheckPath(uuid);
      const { data: attempts, error: attemptError } = await admin.rpc(
        "baran_get_homscard_reconcile_attempt", { p_order_id: row.order_id },
      );
      const attempt = Array.isArray(attempts) ? attempts[0] : null;
      if (attemptError || !attempt || attempt.supplier_order_uuid !== uuid) {
        await admin.from("order_fulfillment").update({
          dispatch_state: "awaiting_result", supplier_status: "processing",
          next_retry_at: new Date(Date.now() + 300000).toISOString(),
          failure_reason: "Reconciliation paused: supplier attempt UUID does not match fulfillment UUID",
        }).eq("order_id", row.order_id);
        summary.unknown++;
        console.warn("BARAN_HOMSCARD_RECONCILE_ATTEMPT_MISMATCH", row.order_id);
        continue;
      }

      const { response, payload } = await signedGet(path, token, hmacSecret);
      if (response.status === 429) {
        const delay = retryDelaySeconds("rate_limited", response.headers.get("Retry-After"));
        await admin.from("order_fulfillment").update({
          dispatch_state: "awaiting_result", supplier_status: "processing",
          next_retry_at: new Date(Date.now() + delay * 1000).toISOString(),
          failure_reason: "HomsCard rate limit; scheduled a read-only status check",
        }).eq("order_id", row.order_id);
        summary.pending++;
        continue;
      }
      if (!response.ok) {
        const delay = retryDelaySeconds("network_error");
        await admin.from("order_fulfillment").update({
          dispatch_state: "awaiting_result", supplier_status: "processing",
          next_retry_at: new Date(Date.now() + delay * 1000).toISOString(),
          failure_reason: "Supplier status lookup returned HTTP " + response.status,
        }).eq("order_id", row.order_id);
        summary.unknown++;
        continue;
      }

      const result = parseHomsCardCheck(payload, uuid) as
        | { kind: "pending"; supplierOrderId?: string | null }
        | { kind: "failed"; supplierOrderId?: string | null; reason: string }
        | { kind: "unknown"; reason: string }
        | { kind: "completed"; supplierOrderId: string; totalCost: number; quantity: number; delivery: string };
      if (result.kind === "pending") {
        await admin.from("order_fulfillment").update({
          dispatch_state: "awaiting_result", supplier_status: "processing",
          next_retry_at: new Date(Date.now() + retryDelaySeconds("pending") * 1000).toISOString(),
          failure_reason: "HomsCard confirms the order is still pending",
        }).eq("order_id", row.order_id);
        summary.pending++;
        continue;
      }
      if (result.kind === "unknown") {
        await admin.from("order_fulfillment").update({
          dispatch_state: "awaiting_result", supplier_status: "processing",
          next_retry_at: new Date(Date.now() + retryDelaySeconds("network_error") * 1000).toISOString(),
          failure_reason: result.reason.slice(0, 500),
        }).eq("order_id", row.order_id);
        summary.unknown++;
        continue;
      }

      if (result.kind === "failed") {
        const { error: finalizeError } = await admin.rpc("baran_supplier_finalize_order", {
          p_order_id: row.order_id, p_result: "failed",
          p_supplier_reference: result.supplierOrderId,
          p_supplier_unit_cost: null, p_cost_currency: null,
          p_reason: result.reason,
        });
        if (finalizeError) throw new Error("Failure settlement RPC failed: " + finalizeError.message);
        summary.failed++;
        continue;
      }

      const { error: deliveryError } = await admin.from("order_fulfillment").update({
        supplier_delivery: result.delivery,
      }).eq("order_id", row.order_id).eq("supplier_order_uuid", uuid);
      if (deliveryError) throw new Error("Supplier delivery could not be stored: " + deliveryError.message);

      const unitCost = result.totalCost / result.quantity;
      const { error: finalizeError } = await admin.rpc("baran_supplier_finalize_order", {
        p_order_id: row.order_id, p_result: "succeeded",
        p_supplier_reference: result.supplierOrderId,
        p_supplier_unit_cost: unitCost, p_cost_currency: "USD",
        p_reason: null,
      });
      if (finalizeError) throw new Error("Success settlement RPC failed: " + finalizeError.message);
      summary.completed++;
    } catch (error) {
      summary.errors++;
      const message = error instanceof Error ? error.message : String(error);
      console.error("BARAN_HOMSCARD_RECONCILE_ITEM_FAILED", row.order_id, message.slice(0, 300));
      await admin.from("order_fulfillment").update({
        dispatch_state: "awaiting_result", supplier_status: "processing",
        next_retry_at: new Date(Date.now() + 60000).toISOString(),
        failure_reason: "Reconciliation error; will retry read-only status lookup",
      }).eq("order_id", row.order_id);
    }
  }

  return json({ success: true, mode: "read_only_supplier_status_reconciliation", summary, checked_at: new Date().toISOString() });
});
