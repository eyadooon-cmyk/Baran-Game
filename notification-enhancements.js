/* BARAN GAME — notification center enhancements */
(function () {
  "use strict";
  let realtimeChannel = null;
  let fallbackTimer = null;
  let currentRealtimeUser = null;
  let prefsLoading = false;
  const defaults = {
    support_enabled: true,
    wallet_enabled: true,
    orders_enabled: true,
    offers_enabled: true,
    security_enabled: true,
    quiet_hours_enabled: false,
    quiet_hours_start: "22:00:00",
    quiet_hours_end: "08:00:00",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  };

  function el(tag, attrs, text) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (key === "class") node.className = value;
      else if (key === "checked" || key === "disabled") node[key] = Boolean(value);
      else node.setAttribute(key, value);
    });
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function settingsHost() {
    const message = document.getElementById("pushSettingsMessage");
    return message?.parentElement || document.querySelector("#settings .deposit-card");
  }

  function status(message) {
    const node = document.getElementById("baranNotificationPrefsStatus");
    if (node) node.textContent = message;
  }

  function mountPreferences() {
    const host = settingsHost();
    if (!host || document.getElementById("baranNotificationPreferences")) return;
    const panel = el("section", { id: "baranNotificationPreferences", class: "baran-notification-preferences" });
    panel.append(
      el("h3", {}, "تفضيلات الإشعارات"),
      el("p", { class: "small" }, "اختار أنواع التنبيهات التي تريد استقبالها. تنبيهات الأمان والمحفظة المهمة تبقى مفعّلة دائماً.")
    );
    const grid = el("div", { class: "baran-notification-pref-grid" });
    const options = [
      ["support_enabled", "رسائل الدعم والردود"],
      ["orders_enabled", "تحديثات الطلبات والشحن"],
      ["offers_enabled", "العروض والإعلانات"],
      ["wallet_enabled", "المحفظة والحركات المالية"],
      ["security_enabled", "الأمان وتسجيل الدخول"]
    ];
    options.forEach(([key, label]) => {
      const locked = key === "wallet_enabled" || key === "security_enabled";
      const input = el("input", { type: "checkbox", id: "baran-pref-" + key, "data-pref": key, disabled: locked });
      const text = el("span", {}, label + (locked ? " · إلزامي" : ""));
      const row = el("label", { class: "baran-notification-pref-row" });
      row.append(input, text);
      grid.appendChild(row);
    });
    const quietRow = el("label", { class: "baran-notification-pref-row baran-notification-quiet" });
    const quiet = el("input", { type: "checkbox", id: "baran-pref-quiet", "data-pref": "quiet_hours_enabled" });
    quietRow.append(quiet, el("span", {}, "كتم العروض والإعلانات خلال ساعات الهدوء"));
    const times = el("div", { class: "baran-notification-time-row" });
    const startWrap = el("label", {}, "من");
    const start = el("input", { type: "time", id: "baran-pref-start", value: "22:00" });
    startWrap.appendChild(start);
    const endWrap = el("label", {}, "إلى");
    const end = el("input", { type: "time", id: "baran-pref-end", value: "08:00" });
    endWrap.appendChild(end);
    times.append(startWrap, endWrap);
    panel.append(grid, quietRow, times, el("p", { id: "baranNotificationPrefsStatus", class: "small", role: "status", "aria-live": "polite" }));
    host.appendChild(panel);

    panel.addEventListener("change", async event => {
      if (!event.target.matches("[data-pref],#baran-pref-start,#baran-pref-end")) return;
      await savePreferences();
    });
    loadPreferences();
  }

  async function loadPreferences() {
    if (typeof currentUser === "undefined" || !currentUser || typeof sb === "undefined" || prefsLoading) return;
    prefsLoading = true;
    try {
      const { data, error } = await sb.from("baran_notification_preferences")
        .select("support_enabled,wallet_enabled,orders_enabled,offers_enabled,security_enabled,quiet_hours_enabled,quiet_hours_start,quiet_hours_end,timezone")
        .eq("user_id", currentUser.id).maybeSingle();
      if (error) throw error;
      const prefs = { ...defaults, ...(data || {}) };
      ["support_enabled","wallet_enabled","orders_enabled","offers_enabled","security_enabled"].forEach(key => {
        const input = document.querySelector('[data-pref="' + key + '"]');
        if (input) input.checked = key === "wallet_enabled" || key === "security_enabled" ? true : Boolean(prefs[key]);
      });
      const quiet = document.getElementById("baran-pref-quiet");
      const start = document.getElementById("baran-pref-start");
      const end = document.getElementById("baran-pref-end");
      if (quiet) quiet.checked = Boolean(prefs.quiet_hours_enabled);
      if (start) start.value = String(prefs.quiet_hours_start || "22:00").slice(0,5);
      if (end) end.value = String(prefs.quiet_hours_end || "08:00").slice(0,5);
      status(data ? "تم تحميل تفضيلاتك." : "الإعدادات الافتراضية مفعّلة. احفظ أي تعديل لتثبيتها.");
    } catch (error) {
      status("تعذر تحميل التفضيلات حالياً. " + (error.message || ""));
    } finally {
      prefsLoading = false;
    }
  }

  async function savePreferences() {
    if (typeof currentUser === "undefined" || !currentUser || typeof sb === "undefined") return;
    const read = key => Boolean(document.querySelector('[data-pref="' + key + '"]')?.checked);
    const payload = {
      user_id: currentUser.id,
      support_enabled: read("support_enabled"),
      orders_enabled: read("orders_enabled"),
      offers_enabled: read("offers_enabled"),
      wallet_enabled: true,
      security_enabled: true,
      quiet_hours_enabled: Boolean(document.getElementById("baran-pref-quiet")?.checked),
      quiet_hours_start: (document.getElementById("baran-pref-start")?.value || "22:00") + ":00",
      quiet_hours_end: (document.getElementById("baran-pref-end")?.value || "08:00") + ":00",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      updated_at: new Date().toISOString()
    };
    status("جاري حفظ التفضيلات...");
    try {
      const { error } = await sb.from("baran_notification_preferences").upsert(payload, { onConflict: "user_id" });
      if (error) throw error;
      status("تم حفظ تفضيلات الإشعارات بنجاح.");
    } catch (error) {
      status("تعذر حفظ التفضيلات: " + (error.message || "خطأ غير معروف"));
    }
  }

  function stopRealtime() {
    if (fallbackTimer) clearInterval(fallbackTimer);
    fallbackTimer = null;
    if (realtimeChannel && sb) sb.removeChannel(realtimeChannel);
    realtimeChannel = null;
    currentRealtimeUser = null;
  }

  function refreshInbox() {
    if (!currentUser) return;
    if (typeof window.loadCustomerNotifications === "function") window.loadCustomerNotifications();
  }

  function startRealtime() {
    if (typeof currentUser === "undefined" || !currentUser || typeof sb === "undefined") return;
    if (realtimeChannel && currentRealtimeUser === currentUser.id) return;
    stopRealtime();
    currentRealtimeUser = currentUser.id;
    refreshInbox();
    realtimeChannel = sb.channel("baran-notifications-" + currentUser.id)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "baran_notifications",
        filter: "recipient_id=eq." + currentUser.id
      }, () => refreshInbox())
      .subscribe(state => {
        if (state === "SUBSCRIBED") {
          if (fallbackTimer) clearInterval(fallbackTimer);
          fallbackTimer = null;
        } else if (!fallbackTimer) {
          fallbackTimer = setInterval(refreshInbox, 90000);
        }
      });
    window.baranNotificationRealtimeChannel = realtimeChannel;
  }

  function installStyles() {
    if (document.getElementById("baran-notification-enhancement-styles")) return;
    const style = el("style", { id: "baran-notification-enhancement-styles" });
    style.textContent = `
      .baran-notification-preferences{margin-top:14px;padding:13px;border:1px solid #493957;border-radius:14px;background:#17131e}
      .baran-notification-preferences h3{margin:0 0 6px}
      .baran-notification-pref-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}
      .baran-notification-pref-row{display:flex;align-items:center;gap:9px;padding:10px;border:1px solid #40314a;border-radius:11px;background:#201a29;color:#eee5f5;font-size:12px}
      .baran-notification-pref-row input{accent-color:#a77bd0;width:17px;height:17px;flex:0 0 auto}
      .baran-notification-pref-row input:disabled{opacity:.7}
      .baran-notification-time-row{display:flex;gap:10px;margin-top:8px}
      .baran-notification-time-row label{display:flex;flex:1;align-items:center;gap:7px;color:#cbbbd8;font-size:12px}
      .baran-notification-time-row input{min-width:0;width:100%;padding:9px;border:1px solid #594667;border-radius:9px;background:#100d15;color:#fff}
      #baranNotificationPrefsStatus{min-height:18px;margin:8px 0 0;color:#c8addd}\n
      .baran-push-monitor{margin-top:14px;padding:13px;border:1px solid #493957;border-radius:14px;background:#17131e}
      .baran-push-monitor h4{margin:0 0 6px}
      .baran-push-monitor button{padding:9px 12px;border:1px solid #69517b;border-radius:10px;background:#2b2035;color:#f6edff}
      .baran-push-monitor-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:12px}
      .baran-push-monitor-card{padding:9px;border:1px solid #40314a;border-radius:10px;background:#211a2a}
      .baran-push-monitor-card small,.baran-push-monitor-card strong{display:block}
      .baran-push-monitor-card small{color:#b9a9c8;font-size:10px}
      .baran-push-monitor-card strong{margin-top:4px;font-size:18px}
      .baran-push-monitor-line{display:flex;justify-content:space-between;gap:8px;padding:7px 0;border-bottom:1px solid #33283d;font-size:11px}

      @media(max-width:480px){.baran-notification-pref-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }


  async function refreshPushMonitor() {
    const box = document.getElementById("baranPushMonitorResults");
    const button = document.getElementById("baranPushMonitorRefresh");
    if (!box || typeof window.callAdminApi !== "function") return;
    if (button) button.disabled = true;
    box.textContent = "جاري قراءة سجل الإرسال لآخر 7 أيام...";
    try {
      const result = await window.callAdminApi("POST", { action: "push_delivery_stats" });
      if (!result?.success || !result.stats) throw new Error(result?.error || "تعذر قراءة السجل.");
      const s = result.stats;
      box.replaceChildren();
      const grid = el("div", { class: "baran-push-monitor-grid" });
      [["إجمالي المحاولات", s.attempts], ["وصلت", s.sent], ["فشلت", s.failed], ["قيد المعالجة", s.processing], ["اشتراكات منتهية", s.expired]].forEach(([label, value]) => {
        const card = el("div", { class: "baran-push-monitor-card" });
        card.append(el("small", {}, label), el("strong", {}, String(value ?? 0)));
        grid.appendChild(card);
      });
      box.appendChild(grid);
      const note = el("p", { class: "small" }, "عدد سجلات الأجهزة خلال آخر 7 أيام: " + s.total + (s.last_updated ? " · آخر تحديث: " + new Date(s.last_updated).toLocaleString("ar") : ""));
      box.appendChild(note);
      (result.recent || []).slice(0, 6).forEach(row => {
        const line = el("div", { class: "baran-push-monitor-line" });
        const left = el("span", {}, row.status + " · " + row.attempt_count + " محاولة");
        const right = el("small", {}, row.http_status ? "HTTP " + row.http_status : new Date(row.created_at).toLocaleString("ar"));
        line.append(left, right); box.appendChild(line);
      });
    } catch (error) {
      box.textContent = error.message || "تعذر تحميل سجل الإشعارات.";
    } finally {
      if (button) button.disabled = false;
    }
  }

  function mountPushMonitor() {
    const anchor = document.getElementById("adminNotifications");
    if (!anchor || document.getElementById("baranPushMonitor")) return;
    const panel = el("section", { id: "baranPushMonitor", class: "baran-push-monitor" });
    panel.append(
      el("h4", {}, "مراقبة إرسال إشعارات الهاتف"),
      el("p", { class: "small" }, "ملخص محاولات الإرسال والنجاح والفشل وإعادة المحاولة لآخر 7 أيام."),
      el("button", { id: "baranPushMonitorRefresh", type: "button", class: "secondary" }, "تحديث سجل الإرسال"),
      el("div", { id: "baranPushMonitorResults", class: "small", role: "status", "aria-live": "polite" }, "اضغط تحديث لعرض حالة الإرسال.")
    );
    anchor.insertAdjacentElement("afterend", panel);
    document.getElementById("baranPushMonitorRefresh")?.addEventListener("click", refreshPushMonitor);
  }
\n  window.startBaranNotificationPolling = startRealtime;
  window.stopBaranNotificationPolling = stopRealtime;
  window.refreshBaranNotificationPreferences = loadPreferences;
  window.addEventListener("online", () => { startRealtime(); refreshInbox(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { startRealtime(); refreshInbox(); }
  });
  if (typeof sb !== "undefined" && sb.auth?.onAuthStateChange) {\n    sb.auth.onAuthStateChange((_event, session) => {\n      if (session?.user?.id) { startRealtime(); loadPreferences(); }\n      else stopRealtime();\n    });\n  }\n  document.addEventListener("DOMContentLoaded", () => {
    installStyles();
    mountPreferences();
    if (typeof currentUser !== "undefined" && currentUser) { startRealtime(); loadPreferences(); }
  });
  if (document.readyState !== "loading") {
    installStyles();
    mountPreferences();
    if (typeof currentUser !== "undefined" && currentUser) { startRealtime(); loadPreferences(); }
  }
})();
