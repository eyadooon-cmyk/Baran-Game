/**
 * Pure HomsCard check-response parser. No network, database, or money side effects.
 */
export function parseHomsCardCheck(payload, expectedUuid) {
  if (!payload || payload.status !== "OK" || !Array.isArray(payload.data)) {
    return { kind: "unknown", reason: "Malformed or unsuccessful supplier response" };
  }
  const row = payload.data.find((item) =>
    item && String(item.order_uuid ?? "").toLowerCase() === String(expectedUuid).toLowerCase()
  );
  if (!row) return { kind: "unknown", reason: "Supplier response did not contain the exact order UUID" };

  const status = String(row.status ?? "").toLowerCase();
  if (status === "pending") return { kind: "pending", supplierOrderId: safeText(row.order_id, 160) };
  if (status === "cancelled") {
    return { kind: "failed", supplierOrderId: safeText(row.order_id, 160), reason: "HomsCard confirmed the order was cancelled" };
  }
  if (status === "completed") {
    const price = Number(row.price);
    const quantity = Number(row.quantity);
    const delivery = typeof row.delivery === "string" ? row.delivery.trim() : "";
    const supplierOrderId = safeText(row.order_id, 160);
    if (!supplierOrderId || !Number.isFinite(price) || price < 0 ||
        !Number.isSafeInteger(quantity) || quantity < 1 || !delivery || delivery.length > 4000) {
      return { kind: "unknown", reason: "Completed response is missing verified order, cost, quantity, or delivery data" };
    }
    return { kind: "completed", supplierOrderId, totalCost: price, quantity, delivery };
  }
  return { kind: "unknown", reason: "Unrecognized supplier order status" };
}

function safeText(value, max) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= max ? text : null;
}

export function retryDelaySeconds(kind, retryAfterHeader) {
  if (kind === "rate_limited") {
    const parsed = Number(retryAfterHeader);
    return Number.isFinite(parsed) ? Math.min(300, Math.max(30, Math.ceil(parsed))) : 60;
  }
  if (kind === "timeout" || kind === "network_error") return 60;
  return 30;
}

export function buildCheckPath(uuid) {
  if (typeof uuid !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)) {
    throw new TypeError("Invalid supplier order UUID");
  }
  return "/reseller/check.php?uuid=1&orders=" + encodeURIComponent(uuid);
}
