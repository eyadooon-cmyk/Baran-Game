import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://eyadooon-cmyk.github.io",
  "Access-Control-Allow-Headers": "content-type, x-baran-hook-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const expected = Deno.env.get("BARAN_PUSH_WEBHOOK_SECRET");
  const supplied = req.headers.get("x-baran-hook-secret");
  if (!expected || !supplied || supplied !== expected) return json({ error: "Unauthorized" }, 401);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const vapidPublic = Deno.env.get("BARAN_VAPID_PUBLIC_KEY");
    const vapidPrivate = Deno.env.get("BARAN_VAPID_PRIVATE_KEY");
    if (!url || !service || !vapidPublic || !vapidPrivate) {
      console.error("push dispatch configuration incomplete");
      return json({ error: "Push sender is not configured" }, 503);
    }
    const body = await req.json().catch(() => null);
    const notificationId = body?.notification_id;
    if (typeof notificationId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(notificationId)) {
      return json({ error: "Invalid notification id" }, 400);
    }

    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: notification, error: notificationError } = await admin
      .from("baran_notifications")
      .select("id,recipient_id,audience,kind,title,body,entity_type,entity_id")
      .eq("id", notificationId).maybeSingle();
    if (notificationError || !notification) return json({ error: "Notification not found" }, 404);

    const { data: preferences } = await admin.from("baran_notification_preferences")
      .select("support_enabled,wallet_enabled,orders_enabled,offers_enabled,security_enabled,quiet_hours_enabled,quiet_hours_start,quiet_hours_end,timezone")
      .eq("user_id", notification.recipient_id).maybeSingle();
    const textForCategory = [notification.kind, notification.title, notification.body, notification.entity_type]
      .filter(Boolean).join(" ").toLowerCase();
    const category = /support|ticket|reply|رسالة|دعم|تذكرة/.test(textForCategory) ? "support"
      : /deposit|wallet|payment|transfer|إيداع|محفظة|حوالة|دفع|رصيد/.test(textForCategory) ? "wallet"
      : /order|top.?up|purchase|طلب|شحن|شراء/.test(textForCategory) ? "orders"
      : /security|login|password|أمان|دخول|حماية/.test(textForCategory) ? "security"
      : /announcement|promotion|offer|coupon|إعلان|عرض|كوبون|خصم/.test(textForCategory) ? "offers" : "general";
    const categoryEnabled = category === "support" ? preferences?.support_enabled
      : category === "wallet" ? preferences?.wallet_enabled
      : category === "orders" ? preferences?.orders_enabled
      : category === "offers" ? preferences?.offers_enabled
      : category === "security" ? preferences?.security_enabled : true;
    if (!["wallet", "security"].includes(category) && categoryEnabled === false) {
      return json({ success: true, sent: 0, reason: "category_muted", category });
    }
    if (preferences?.quiet_hours_enabled && !["wallet", "security", "support", "orders"].includes(category)) {
      let quiet = false;
      try {
        const timezone = preferences.timezone || "UTC";
        const parts = new Intl.DateTimeFormat("en-GB", {
          timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23"
        }).formatToParts(new Date());
        const part = (name: string) => Number(parts.find((item) => item.type === name)?.value || 0);
        const nowMinutes = part("hour") * 60 + part("minute");
        const toMinutes = (value: string) => {
          const [hour, minute] = String(value || "00:00").split(":").map(Number);
          return hour * 60 + minute;
        };
        const start = toMinutes(preferences.quiet_hours_start);
        const end = toMinutes(preferences.quiet_hours_end);
        quiet = start !== end && (start < end
          ? nowMinutes >= start && nowMinutes < end
          : nowMinutes >= start || nowMinutes < end);
      } catch (error) {
        console.warn("invalid quiet-hours timezone; push not muted", error instanceof Error ? error.message : "unknown");
      }
      if (quiet) return json({ success: true, sent: 0, reason: "quiet_hours", category });
    }

    const { data: subscriptions, error: subscriptionsError } = await admin
      .from("baran_push_subscriptions")
      .select("id,endpoint,p256dh,auth")
      .eq("user_id", notification.recipient_id);
    if (subscriptionsError) return json({ error: "Could not load subscriptions" }, 500);
    if (!subscriptions?.length) return json({ success: true, sent: 0, reason: "no_subscriptions" });

    webpush.setVapidDetails("mailto:support@barangame.example", vapidPublic, vapidPrivate);
    const payload = JSON.stringify({
      title: String(notification.title || "Baran Game").slice(0, 100),
      body: String(notification.body || "لديك إشعار جديد").slice(0, 240),
      url: "./?baran_notification=" + encodeURIComponent(notification.id),
      tag: "baran-" + notification.id,
      notification_id: notification.id,
      entity_type: notification.entity_type,
      entity_id: notification.entity_id,
      kind: notification.kind,
      audience: notification.audience
    });

    let sent = 0, removed = 0, failed = 0, skipped = 0;
    for (const sub of subscriptions) {
      let delivered = false, expired = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data: claimed, error: claimError } = await admin.rpc("baran_claim_push_delivery", {
          p_notification_id: notification.id,
          p_subscription_id: sub.id,
          p_max_attempts: 3
        });
        if (claimError) {
          console.error("push delivery claim failed", claimError.message);
          failed++;
          break;
        }
        if (!claimed) { skipped++; break; }
        try {
          await webpush.sendNotification({
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth }
          }, payload, { TTL: 86400 });
          await admin.from("baran_push_delivery_logs").update({
            status: "sent", sent_at: new Date().toISOString(), updated_at: new Date().toISOString(),
            http_status: 201, error_code: null, last_error: null
          }).eq("notification_id", notification.id).eq("subscription_id", sub.id);
          sent++;
          delivered = true;
          break;
        } catch (error) {
          const status = Number((error as { statusCode?: number })?.statusCode || 0);
          const message = String((error as { body?: string; message?: string })?.body ||
            (error as { message?: string })?.message || "Push delivery failed").slice(0, 300);
          if (status === 404 || status === 410) {
            await admin.from("baran_push_delivery_logs").update({
              status: "expired", http_status: status, error_code: String(status),
              last_error: "Subscription expired", updated_at: new Date().toISOString()
            }).eq("notification_id", notification.id).eq("subscription_id", sub.id);
            await admin.from("baran_push_subscriptions").delete().eq("id", sub.id);
            removed++;
            expired = true;
            break;
          }
          await admin.from("baran_push_delivery_logs").update({
            status: "failed", http_status: status || null,
            error_code: status ? String(status) : "NETWORK_ERROR",
            last_error: message, updated_at: new Date().toISOString()
          }).eq("notification_id", notification.id).eq("subscription_id", sub.id);
          if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
      if (!delivered && !expired && skipped === 0) failed++;
    }
    return json({ success: true, sent, removed, failed, skipped, retries: 3 });
  } catch (error) {
    console.error("push dispatch error", error instanceof Error ? error.message : String(error));
    return json({ error: "Unexpected push dispatch error" }, 500);
  }
});
