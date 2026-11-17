/* BARAN GAME — Customer Center presence + live customer overview */
(() => {
  "use strict";
  const client = window.baranSupabaseClient;
  if (!client || !client.auth) return;

  const sessionId = (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === "x" ? r : (r & 3 | 8)).toString(16);
      });
  let heartbeatTimer = null;
  let heartbeatBusy = false;
  let currentAccessToken = null;

  async function sendPresence(action) {
    if (heartbeatBusy || !currentAccessToken) return;
    heartbeatBusy = true;
    try {
      await fetch("https://yabpmdzsiuyxxkcqakfs.supabase.co/functions/v1/baran-customer-center", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + currentAccessToken,
          "apikey": "sb_publishable_lAcsTuoMnqyAv8jAz-SCVg_Jyc6T6Un",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ action, session_id: sessionId }),
        cache: "no-store"
      });
    } catch (_) {
      // Presence is best-effort; it must never interrupt shopping or checkout.
    } finally {
      heartbeatBusy = false;
    }
  }

  async function syncSession() {
    const { data } = await client.auth.getSession();
    const token = data?.session?.access_token || null;
    if (token === currentAccessToken) return;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    currentAccessToken = token;
    if (!token) return;
    void sendPresence("heartbeat");
    heartbeatTimer = setInterval(() => {
      if (document.visibilityState === "visible") void sendPresence("heartbeat");
    }, 45000);
  }

  client.auth.onAuthStateChange((_event, session) => {
    currentAccessToken = session?.access_token || null;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    if (currentAccessToken) {
      void sendPresence("heartbeat");
      heartbeatTimer = setInterval(() => {
        if (document.visibilityState === "visible") void sendPresence("heartbeat");
      }, 45000);
    } else if (window.baranCustomerCenterPoll) {
      clearInterval(window.baranCustomerCenterPoll);
      window.baranCustomerCenterPoll = null;
    }
  });
  void syncSession();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void sendPresence("heartbeat");
  });

  function node(tag, cls, value) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (value !== undefined) el.textContent = value;
    return el;
  }

  function installPanel() {
    const host = document.querySelector('[data-admin-panel="users"]');
    const list = document.getElementById("opsCustomers");
    if (!host || !list || document.getElementById("baranCustomerCenterLive")) return;
    const section = node("section", "finance-section");
    section.id = "baranCustomerCenterLive";
    section.style.margin = "16px 0";
    const head = node("div", "finance-section-heading");
    const copy = node("div");
    copy.append(node("span", "finance-kicker", "CUSTOMER CENTER"));
    copy.append(node("h3", "", "🟢 العملاء المتصلون الآن"));
    copy.append(node("p", "small", "تحديث مباشر تقريباً؛ يُعتبر العميل غير متصل إذا لم يصل تحديث خلال دقيقتين."));
    const refresh = node("button", "secondary", "تحديث القائمة");
    refresh.type = "button";
    refresh.addEventListener("click", loadOnline);
    head.append(copy, refresh);
    const stats = node("div", "customer-directory-stats");
    stats.id = "baranCustomerCenterStats";
    const listBox = node("div", "ops-list");
    listBox.id = "baranCustomerCenterOnlineList";
    listBox.setAttribute("aria-live", "polite");
    listBox.textContent = "اضغط تحديث لعرض المتصلين حالياً.";
    section.append(head, stats, listBox);
    list.insertAdjacentElement("afterend", section);

    const customerTools = node("div", "ops-form");
    customerTools.append(node("strong", "", "تصنيف العملاء"));
    customerTools.append(node("p", "small", "يعتمد التصنيف على عدد الطلبات وتاريخ آخر طلب، ويُحدّث عند تحميل بيانات الإدارة."));
    const segmentBox = node("div", "ops-grid");
    segmentBox.id = "baranCustomerSegments";
    segmentBox.textContent = "تُعرض التصنيفات بعد تحديث بيانات الإدارة.";
    customerTools.append(segmentBox);
    section.append(customerTools);
    void loadOnline();
    if (!window.baranCustomerCenterPoll) {
      window.baranCustomerCenterPoll = setInterval(() => {
        if (document.visibilityState === "visible") void loadOnline();
      }, 30000);
    }
  }

  async function loadOnline() {
    const box = document.getElementById("baranCustomerCenterOnlineList");
    const stats = document.getElementById("baranCustomerCenterStats");
    if (!box || !stats) return;
    box.textContent = "جارٍ تحديث حالة الاتصال...";
    try {
      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError || !sessionData?.session?.access_token) throw new Error("انتهت جلسة المدير.");
      const response = await fetch("https://yabpmdzsiuyxxkcqakfs.supabase.co/functions/v1/baran-customer-center", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + sessionData.session.access_token,
          "apikey": "sb_publishable_lAcsTuoMnqyAv8jAz-SCVg_Jyc6T6Un",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ action: "dashboard" }),
        cache: "no-store"
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success !== true) throw new Error(result.error || "تعذر تحميل القائمة.");
      stats.replaceChildren();
      const card = node("div", "customer-stat-card customer-stat-primary");
      card.append(node("span", "customer-stat-icon", "🟢"));
      const copy = node("div", "customer-stat-copy");
      copy.append(node("span", "", "متصلون الآن"));
      copy.append(node("strong", "", String(result.online_count || 0)));
      card.append(copy);
      stats.append(card);
      const updated = node("div", "small", "آخر تحديث: " + new Date(result.checked_at).toLocaleTimeString("ar"));
      stats.append(updated);
      box.replaceChildren();
      if (!result.online?.length) {
        box.append(node("div", "customer-directory-empty", "لا يوجد عملاء متصلون حالياً."));
        return;
      }
      result.online.forEach(customer => {
        const item = node("article", "ops-item");
        const title = node("strong", "", "🟢 " + (customer.full_name || "عميل"));
        const meta = node("p", "small", (customer.member_code || "عضو في BARAN GAME") + " · آخر نشاط: " + new Date(customer.last_seen_at).toLocaleTimeString("ar"));
        item.append(title, meta);
        box.append(item);
      });
    } catch (error) {
      box.textContent = "تعذر تحديث المتصلين: " + (error?.message || "خطأ غير معروف");
    }
  }

  function updateSegments() {
    const box = document.getElementById("baranCustomerSegments");
    if (!box || !Array.isArray(window.baranCustomerDirectory)) return;
    const rows = window.baranCustomerDirectory;
    const counts = {new:0, active:0, loyal:0, inactive:0};
    rows.forEach(customer => {
      const count = Number(customer.order_count || 0);
      const last = customer.last_order_at ? new Date(customer.last_order_at).getTime() : 0;
      const days = last ? (Date.now() - last) / 86400000 : Infinity;
      if (!count) counts.new++;
      else if (days > 30) counts.inactive++;
      else if (count >= 5) counts.loyal++;
      else counts.active++;
    });
    box.replaceChildren();
    [["🆕","جدد",counts.new],["⚡","نشطون",counts.active],["⭐","دائمون",counts.loyal],["🌙","غير نشطين",counts.inactive]].forEach(([icon,label,count]) => {
      const card=node("div","ops-card");
      card.append(node("div","ops-muted",icon+" "+label),node("div","ops-value",String(count)));
      box.append(card);
    });
  }

  window.loadBaranCustomerCenter = loadOnline;
  window.refreshBaranCustomerSegments = updateSegments;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", installPanel);
  else installPanel();
  const observer = new MutationObserver(() => {
    if (!document.getElementById("baranCustomerCenterLive")) installPanel();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
