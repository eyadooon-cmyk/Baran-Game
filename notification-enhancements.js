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
    if (!window.currentUser || !window.sb || prefsLoading) return;
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
    if (!window.currentUser || !window.sb) return;
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
    if (realtimeChannel && window.sb) sb.removeChannel(realtimeChannel);
    realtimeChannel = null;
    currentRealtimeUser = null;
  }

  function refreshInbox() {
    if (!window.currentUser) return;
    if (typeof window.loadCustomerNotifications === "function") window.loadCustomerNotifications();
  }

  function startRealtime() {
    if (!window.currentUser || !window.sb) return;
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
      #baranNotificationPrefsStatus{min-height:18px;margin:8px 0 0;color:#c8addd}
      @media(max-width:480px){.baran-notification-pref-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  window.startBaranNotificationPolling = startRealtime;
  window.stopBaranNotificationPolling = stopRealtime;
  window.refreshBaranNotificationPreferences = loadPreferences;
  window.addEventListener("online", () => { startRealtime(); refreshInbox(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { startRealtime(); refreshInbox(); }
  });
  document.addEventListener("DOMContentLoaded", () => {
    installStyles();
    mountPreferences();
    if (window.currentUser) startRealtime();
  });
  if (document.readyState !== "loading") {
    installStyles();
    mountPreferences();
    if (window.currentUser) startRealtime();
  }
})();
