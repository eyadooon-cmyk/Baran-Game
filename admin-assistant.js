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
      addMessage((result.sent ? "✅ تم إرسال الرد إلى صاحب التذكرة " + result.ticket_code + " ووصل إشعار داخل المتجر.\\n\\n" : "") + result.reply, "bot");
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

  window.askBaranAdminPrompt = function (question) {
    const input = document.getElementById("baranAdminAssistantInput");
    const prompt = String(question || "");
    if (input) input.value = "";
    void send(prompt);
  };

  window.askBaranAdminAssistant = function (event) {
    if (event) event.preventDefault();
    const input = document.getElementById("baranAdminAssistantInput");
    const question = input?.value || "";
    if (input) input.value = "";
    void send(question);
  };

  // Department-focused AI team: uses the existing admin-only, read-only data context.
  const teamTasks = [
    ["🧭", "قائد الفريق", "أنت الآن قائد فريق Baran Game. أعطني تقريراً تنفيذياً مختصراً عن حالة المتجر من البيانات المتاحة: أهم 3 أولويات، ما يعمل جيداً، ما تعطل، وما يحتاج تدخلي أنا. لا تنفذ أي إجراء."],
    ["📦", "مسؤول الطلبات", "حلل الطلبات المسجلة: المعلقة والمتأخرة والفاشلة والمكتملة، واربطها ببيانات تنفيذ المورد إن وجدت. اذكر رقم الطلب والحالة والدليل والخطوة المقترحة. لا تغيّر أي حالة ولا تنفذ شحناً أو استرداداً."],
    ["🎧", "مسؤول خدمة الزبائن", "راجع تذاكر الدعم المفتوحة فقط، صنّفها حسب الأولوية والموضوع، لخّص المشكلة واقترح مسودة رد مناسبة لكل حالة. لا تحفظ أو ترسل أي رد ولا تغيّر حالة التذكرة."],
    ["💰", "المحلل المالي", "حلل المبيعات والتكاليف والمصاريف والأرباح من السجلات المتاحة، وافصل USD عن SYP، وميّز الربح الإجمالي عن صافي الربح. اذكر النواقص التي تمنع حساباً دقيقاً. قراءة فقط دون أي حركة مالية."],
    ["🛡️", "مسؤول الأمان", "راجع سجل التدقيق والتنبيهات ومحاولات الدخول والأحداث الأمنية المتاحة. صنّف المخاطر حسب الخطورة، واذكر الدليل والإجراء الوقائي المقترح. لا تغيّر صلاحيات أو إعدادات."],
    ["⚙️", "مسؤول التشغيل", "حلل حالة المراقبة والأعطال والتنبيهات والطلبات التي تنتظر المورد وتكاليف المورد الناقصة. فرّق بين المشكلة المؤكدة والاحتمال، ورتّب خطوات الفحص دون تنفيذ تغييرات."]
  ];

  function installDepartmentTeam() {
    const host = document.getElementById("baranAdminAssistant");
    if (!host || document.getElementById("baranAiTeam")) return;
    const panel = document.createElement("div");
    panel.id = "baranAiTeam";
    panel.style.cssText = "margin-top:16px;padding:14px;border:1px solid #675078;border-radius:14px;background:#100b16";
    const heading = document.createElement("h3");
    heading.textContent = "🤖 فريق Baran AI — مساعدين متخصصين";
    heading.style.margin = "0 0 6px";
    const note = document.createElement("p");
    note.className = "small";
    note.textContent = "اختر القسم ليعمل المساعد بدور متخصص ويحلل بيانات المتجر الحقيقية. جميع الأدوار للقراءة والتحليل فقط.";
    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:8px";
    teamTasks.forEach(([emoji, label, prompt]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = emoji + " " + label;
      button.style.cssText = "width:100%;min-height:46px;padding:10px;font-size:13px";
      button.addEventListener("click", () => { void send(prompt); });
      grid.appendChild(button);
    });
    const safety = document.createElement("div");
    safety.className = "ops-muted";
    safety.style.marginTop = "10px";
    safety.textContent = "🔒 ممنوع على الفريق: تعديل الأرصدة أو الموافقة على الإيداعات أو الاسترداد أو الشحن أو تغيير الأسعار والموردين أو إعدادات API.";
    panel.append(heading, note, grid, safety);
    const status = document.getElementById("baranAdminAssistantStatus");
    if (status && status.parentNode === host) status.insertAdjacentElement("afterend", panel);
    else host.appendChild(panel);
  }

  installDepartmentTeam();

  window.runBaranAdminHealthCheck = function () {
    void send("اعمل فحصاً تشغيلياً شاملاً للمتجر الآن. راجع الأرباح المسجلة اليوم وهذا الشهر، الطلبات المفتوحة وتكاليف الموردين الناقصة، الإيداعات المعلقة، تذاكر الدعم المفتوحة، المنتجات والموردين والتنبيهات وسجل التدقيق. افصل الحقائق عن الاحتمالات، رتّب المشاكل حسب الخطورة، واكتب لكل مشكلة الدليل والخطوة المقترحة لحلها. لا تنفذ أي تعديل.");
  };
})();