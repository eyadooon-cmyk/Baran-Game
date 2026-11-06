// Baran Game — secure AI admin assistant.
// Financial and customer data are loaded only by the administrator-only Edge Function.
(function () {
  "use strict";
  let history = [];
  let busy = false;

  function addMessage(value, role, isError) {
    const box = document.getElementById("baranAdminAssistantMessages");
    if (!box) return null;
    const node = document.createElement("div");
    node.className = "ai-chat-message " + (role === "user" ? "user" : "bot") + (isError ? " error" : "");
    node.textContent = String(value || "");
    box.appendChild(node);
    box.scrollTop = box.scrollHeight;
    return node;
  }

  async function send(question) {
    if (busy) return;
    const clean = String(question || "").trim();
    if (!clean) return;
    if (clean.length > 1200) {
      addMessage("اختصر السؤال إلى 1200 حرف كحد أقصى.", "bot", true);
      return;
    }
    if (typeof sb === "undefined" || !sb) {
      addMessage("تعذر الاتصال بقاعدة بيانات المتجر. حدّث الصفحة وسجّل الدخول من جديد.", "bot", true);
      return;
    }
    addMessage(clean, "user");
    history.push({ role: "user", content: clean });
    history = history.slice(-10);
    const pending = addMessage("عم راجع بيانات الإدارة الحقيقية وبحلل طلبك…", "bot");
    const input = document.getElementById("baranAdminAssistantInput");
    const button = document.getElementById("baranAdminAssistantSend");
    busy = true;
    if (input) input.disabled = true;
    if (button) button.disabled = true;
    try {
      const { data: sessionData, error: sessionError } = await sb.auth.getSession();
      const session = sessionData?.session;
      if (sessionError || !session) throw new Error("انتهت جلسة الدخول. سجّل دخولك من جديد.");
      const response = await fetch(SUPABASE_URL + "/functions/v1/baran-admin-assistant", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + session.access_token,
          "apikey": SUPABASE_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ messages: history })
      });
      let result = {};
      try { result = await response.json(); } catch (_) {}
      if (!response.ok) throw new Error(result.error || "تعذر الوصول إلى مساعد الإدارة.");
      if (!result.reply) throw new Error("وصل رد غير مكتمل من المساعد.");
      if (pending) pending.remove();
      addMessage(result.reply, "bot");
      history.push({ role: "assistant", content: result.reply });
      history = history.slice(-10);
      if (result.data_updated_at) {
        const stamp = new Date(result.data_updated_at).toLocaleString("ar");
        const status = document.getElementById("baranAdminAssistantStatus");
        if (status) status.textContent = "آخر تحديث للبيانات: " + stamp + " — قراءة وتحليل مباشر من قاعدة البيانات.";
      }
    } catch (error) {
      if (pending) pending.remove();
      addMessage(error?.message || "تعذر تشغيل المساعد حالياً.", "bot", true);
    } finally {
      busy = false;
      if (input) { input.disabled = false; input.focus(); }
      if (button) button.disabled = false;
    }
  }

  window.askBaranAdminAssistant = function (event) {
    if (event) event.preventDefault();
    const input = document.getElementById("baranAdminAssistantInput");
    const question = input?.value || "";
    if (input) input.value = "";
    void send(question);
  };

  window.runBaranAdminHealthCheck = function () {
    void send("اعمل فحصاً تشغيلياً شاملاً للمتجر الآن. راجع الأرباح المسجلة اليوم وهذا الشهر، الطلبات المفتوحة وتكاليف الموردين الناقصة، الإيداعات المعلقة، تذاكر الدعم المفتوحة، المنتجات والموردين والتنبيهات وسجل التدقيق. افصل الحقائق عن الاحتمالات، رتّب المشاكل حسب الخطورة، واكتب لكل مشكلة الدليل والخطوة المقترحة لحلها. لا تنفذ أي تعديل.");
  };
})();