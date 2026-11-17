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
    const recentTitle = node("h4", "", "آخر ظهور للعملاء");
    const recentBox = node("div", "ops-list");
    recentBox.id = "baranCustomerCenterRecentList";
    recentBox.textContent = "لا توجد بيانات ظهور سابقة بعد.";
    section.append(head, stats, listBox, recentTitle, recentBox);
    const referralPanel = node("div", "ops-form");
    referralPanel.id = "baranCustomerReferralPanel";
    referralPanel.append(node("strong", "", "🎁 برنامج دعوة الأصدقاء"));
    referralPanel.append(node("p", "small", "يُسجّل رمز عضوية الصديق عند إنشاء الحساب. تتحول الدعوة إلى مؤهلة بعد أول طلب مكتمل، وتبقى المكافأة بانتظار مراجعة المدير."));
    const referralStats = node("div", "ops-grid");
    referralStats.id = "baranCustomerReferralStats";
    const referralList = node("div", "ops-list");
    referralList.id = "baranCustomerReferralList";
    referralList.textContent = "جارٍ تحميل سجل الدعوات...";
    referralPanel.append(referralStats, referralList);
    section.append(referralPanel);
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
      renderReferrals(result);
      renderRecentCustomers(result.recent || []);
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

  function renderRecentCustomers(rows) {
    const box = document.getElementById("baranCustomerCenterRecentList");
    if (!box) return;
    box.replaceChildren();
    const offline = (Array.isArray(rows) ? rows : []).filter(row => !row.is_online).slice(0,10);
    if (!offline.length) {
      box.append(node("div","customer-directory-empty","لا توجد سجلات ظهور سابقة لعملاء غير متصلين بعد."));
      return;
    }
    offline.forEach(customer => {
      const item = node("article","ops-item");
      item.append(node("strong","",customer.full_name || "عميل"));
      item.append(node("p","small",(customer.member_code || "عضو في BARAN GAME")+" · آخر ظهور: "+new Date(customer.last_seen_at).toLocaleString("ar")));
      box.append(item);
    });
  }

  function renderReferrals(result) {
    const statsBox = document.getElementById("baranCustomerReferralStats");
    const listBox = document.getElementById("baranCustomerReferralList");
    if (!statsBox || !listBox) return;
    const stats = result.referral_stats || {};
    statsBox.replaceChildren();
    [["دعوات جديدة",stats.pending||0],["مؤهلة",stats.qualified||0],["مكافآت مسجلة",stats.rewarded||0],["مرفوضة",stats.rejected||0]].forEach(([label,value]) => {
      const card = node("div","ops-card");
      card.append(node("div","ops-muted",label),node("div","ops-value",String(value)));
      statsBox.append(card);
    });
    listBox.replaceChildren();
    const rows = Array.isArray(result.referrals) ? result.referrals : [];
    if (!rows.length) {
      listBox.append(node("div","customer-directory-empty","ما في دعوات مسجلة لحد الآن."));
      return;
    }
    const labels = {pending:"بانتظار أول طلب مكتمل",qualified:"مؤهلة — بانتظار مراجعة المكافأة",rewarded:"تم تسجيل المكافأة",rejected:"مرفوضة"};
    rows.forEach(referral => {
      const card = node("article","ops-item");
      card.append(node("strong","", "دعوة من "+(referral.referrer_name||"عميل")+" إلى "+(referral.referred_name||"عميل")));
      card.append(node("p","small","رمز الدعوة: "+(referral.referral_code||"—")+" · "+(labels[referral.status]||referral.status)));
      card.append(node("p","small","تاريخ التسجيل: "+new Date(referral.created_at).toLocaleString("ar")+(referral.qualified_at?" · تأهلت: "+new Date(referral.qualified_at).toLocaleString("ar"):"")));
      if (referral.admin_note) card.append(node("p","small","ملاحظة المدير: "+referral.admin_note));
      listBox.append(card);
    });
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
