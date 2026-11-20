self.addEventListener("push", event => {
  event.waitUntil((async () => {
    let payload = { title: "BARAN GAME", body: "لديك إشعار جديد", url: "./" };
    try {
      if (event.data) {
        const raw = event.data.text();
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") payload = { ...payload, ...parsed };
          else payload.body = String(parsed || payload.body);
        } catch (_) {
          if (raw) payload.body = raw.slice(0, 240);
        }
      }
    } catch (_) {}

    const title = String(payload.title || "BARAN GAME").slice(0, 100);
    const options = {
      body: String(payload.body || "لديك إشعار جديد").slice(0, 240),
      data: payload,
      tag: String(payload.tag || ("baran-" + Date.now())),
      renotify: false,
      dir: "rtl",
      lang: "ar"
    };

    try {
      await self.registration.showNotification(title, options);
    } catch (error) {
      console.error("BARAN push display failed:", error);
      // Retry with the smallest supported notification option set.
      await self.registration.showNotification(title, { body: options.body, data: payload });
    }
  })());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const payload = event.notification.data || {};
  const scopeUrl = new URL(self.registration.scope);
  let target;
  try {
    target = new URL(payload.url || "./", self.registration.scope);
    if (target.origin !== scopeUrl.origin || !target.pathname.startsWith(scopeUrl.pathname)) {
      target = new URL("./", self.registration.scope);
    }
  } catch (_) {
    target = new URL("./", self.registration.scope);
  }

  const notificationId = payload.notification_id || payload.notificationId || payload.baran_notification;
  if (notificationId) {
    target.searchParams.set("baran_notification", String(notificationId));
  } else if (payload.entity_type && payload.entity_id) {
    target.searchParams.set("baran_entity_type", String(payload.entity_type));
    target.searchParams.set("baran_entity_id", String(payload.entity_id));
    if (payload.kind) target.searchParams.set("baran_kind", String(payload.kind));
    if (payload.audience) target.searchParams.set("baran_audience", String(payload.audience));
  }

  const targetUrl = target.href;
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if (!client.url.startsWith(self.registration.scope)) continue;
      try {
        const navigated = await client.navigate(targetUrl);
        if (navigated) {
          await navigated.focus();
          return;
        }
      } catch (_) {}
    }
    await clients.openWindow(targetUrl);
  })());
});

self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});
