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
    ["🧭", "قائد الفريق", "اعمل تقريراً تنفيذياً عن وضع Baran Game من البيانات الحالية: ملخص الحالة، أهم 3 أولويات، ما يعمل جيداً، ما تعطل، وما يحتاج تدخلي. رتّب كل مشكلة حسب أثرها واذكر الدليل والخطوة التالية. لا تنفذ أي إجراء."],
    ["📦", "مسؤول الطلبات", "حلل الطلبات المعلقة والمتأخرة والفاشلة والمكتملة، واربطها بتنفيذ المورد وتكلفته إن وجدت. اعرض الحالات التي تحتاج متابعة مع رقم الطلب والحالة والدليل. لا تغيّر حالة ولا تنفذ شحناً أو استرداداً."],
    ["🎧", "مسؤول خدمة الزبائن", "راجع تذاكر الدعم المفتوحة فقط، اجمع المشاكل المتشابهة، صنّف الأولوية وسببها، واكتب مسودات ردود قصيرة باللهجة الشامية. لا ترسل أي رد ولا تغيّر حالة تذكرة."],
    ["💰", "المحلل المالي", "حلل المبيعات والتكاليف والمصاريف والأرباح من السجلات المتاحة. افصل USD عن SYP، وميّز الإجمالي عن الصافي، واشرح ما ينقص للوصول لحساب دقيق. قراءة فقط دون أي حركة مالية."],
    ["🛡️", "مسؤول الأمان", "راجع سجل التدقيق والتنبيهات والأحداث الأمنية المتاحة. صنّف المخاطر، اذكر الدليل والأثر والإجراء الوقائي. لا تعرض أسراراً أو بيانات شخصية ولا تغيّر صلاحيات أو إعدادات."],
    ["⚙️", "مسؤول التشغيل", "حلل المراقبة والأعطال والتنبيهات والطلبات التي تنتظر المورد وتكاليف المورد الناقصة. افصل المشكلة المؤكدة عن الاحتمال، ورتّب خطوات الفحص دون تنفيذ تغييرات."],
    ["🛍️", "مدير المنتجات", "اعمل تدقيقاً كاملاً لكتالوج المنتجات: التكرار، الرموز، الأسماء، التصنيفات، الأوصاف، الأسعار الفارغة، المنتجات المخفية والترتيب. اقترح تحسينات محددة دون تعديل أو حفظ أي منتج."],
    ["🔌", "خبير الموردين وAPI", "راجع جاهزية الموردين وربط المنتجات وتكاليف الشراء وحالات التنفيذ والبيانات الناقصة. حدّد ما هو مربوط فعلياً وما هو مجرد تسجيل يدوي، وما المعلومات المطلوبة قبل تفعيل API. لا تدّع وجود تكامل غير مثبت ولا تنفذ طلبات."],
    ["📣", "مدير تجربة الزبون", "حلل آراء وتذاكر الزبائن المتاحة لاكتشاف أكثر أسباب الشكاوى والاحتياجات المتكررة. اقترح تحسينات واضحة في رحلة الشراء والواجهة والرسائل، دون كشف معلومات شخصية."],
    ["🚀", "مخطط التطوير", "ضع خطة تطوير عملية لـ Baran Game اعتماداً على حالة المتجر الفعلية: ما الذي يمنع الإطلاق، ما الأولوية التالية، وما الذي يمكن تأجيله. قسّم الخطة إلى مراحل صغيرة مع معيار نجاح لكل مرحلة، ولا تفترض أن ميزة غير منفذة تعمل."]
  ];;

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
    note.textContent = "اختر خبيراً من فريق Baran AI. كل خبير يراجع بيانات المتجر المتاحة ويعطيك تشخيصاً وأولويات وخطوات عملية. الفريق لا ينفذ تغييرات بنفسه.";
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
    safety.textContent = "🔒 الفريق للتحليل والتخطيط فقط. لا يغيّر الأرصدة أو الإيداعات أو الاستردادات أو الطلبات أو الأسعار أو الموردين أو إعدادات API، ولا يدّعي تنفيذ شيء لم ينفذه.";
    panel.append(heading, note, grid, safety);
    const status = document.getElementById("baranAdminAssistantStatus");
    if (status && status.parentNode === host) status.insertAdjacentElement("afterend", panel);
    else host.appendChild(panel);
  }


  // Safe administrative actions: AI drafts a restricted product edit; administrator previews and confirms.
  let pendingSafeProposal = null;
  async function callSafeAction(payload) {
    const { data: sessionData, error: sessionError } = await sb.auth.getSession();
    const session = sessionData?.session;
    if (sessionError || !session) throw new Error("انتهت جلسة الدخول. سجّل دخولك من جديد.");
    const response = await fetch(SUPABASE_URL + "/functions/v1/baran-admin-safe-actions", {
      method: "POST",
      headers: {"Authorization":"Bearer " + session.access_token,"apikey":SUPABASE_KEY,"Content-Type":"application/json"},
      body: JSON.stringify(payload)
    });
    let result = {};
    try { result = await response.json(); } catch (_) {}
    if (!response.ok) throw new Error(result.error || "تعذر تنفيذ طلب الإدارة الآمن.");
    return result;
  }
  function installSafeActions() {
    const host = document.getElementById("baranSafeActionsHost");
    if (!host || document.getElementById("baranSafeActions")) return;
    const panel = document.createElement("section");
    panel.id = "baranSafeActions";
    panel.style.cssText = "margin-top:16px;padding:14px;border:1px solid #8b6ab0;border-radius:14px;background:#171020";
    const heading = document.createElement("h3"); heading.textContent = "🛠️ تنفيذ المهام الإدارية الآمنة"; heading.style.margin = "0 0 6px";
    const note = document.createElement("p"); note.className = "small";
    note.textContent = "الملاحظات الداخلية الآمنة تُنفّذ تلقائياً بعد التحقق وتُسجّل بالتدقيق. أي تغيير قد يؤثر على الزبون يحتاج موافقتك، والعمليات المالية محظورة على المساعد.";
    const input = document.createElement("textarea"); input.id = "baranSafeActionInput"; input.rows = 3; input.maxLength = 700;
    input.placeholder = "مثال: غيّر حالة طلب معلّق إلى قيد المعالجة، أو حدّث ملاحظة تنفيذ طلب";
    input.style.cssText = "width:100%;box-sizing:border-box;margin:8px 0;padding:11px;border-radius:9px;background:#0e0a13;color:#fff;border:1px solid #69527c";
    const plan = document.createElement("button"); plan.type = "button"; plan.textContent = "جهّز معاينة التعديل"; plan.style.cssText = "width:100%;min-height:44px;margin:4px 0;padding:10px";
    const preview = document.createElement("div"); preview.id = "baranSafeActionPreview";
    preview.style.cssText = "display:none;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:10px;padding:12px;border:1px solid #554363;border-radius:10px;background:#0d0a12;font-size:13px;line-height:1.7";
    const confirm = document.createElement("button"); confirm.type = "button"; confirm.textContent = "أوافق على تنفيذ التعديل المعروض";
    confirm.style.cssText = "display:none;width:100%;min-height:46px;margin-top:9px;padding:10px;background:#6d3fa0;color:#fff;border:0;border-radius:9px";
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "إلغاء المعاينة";
    cancel.style.cssText = "display:none;width:100%;min-height:40px;margin-top:6px;padding:8px";
    const status = document.createElement("p"); status.className = "small"; status.style.marginTop = "8px"; status.setAttribute("aria-live","polite");
    const safe = document.createElement("p"); safe.className = "ops-muted";
    safe.textContent = "🔒 المسموح بعد المعاينة وموافقتك: تعديل بيانات المنتجات غير السعرية؛ تغيير حالة تذاكر الدعم؛ اعتماد/رفض التقييمات؛ إضافة مورد أو تعديل اسمه وملاحظاته وحالة نشاطه؛ تعديل الملاحظات الداخلية لتنفيذ طلب موجود؛ تعديل ملاحظات ربط المورد بالمنتج؛ وتغيير حالة الطلب فقط من pending إلى processing أو من processing إلى failed. تغيير حالة الطلب قد يرسل إشعاراً للزبون. لا يغيّر حالة مكتمل أو ملغي أو تم تسليمه، ولا بيانات الشحن أو الاسترداد أو التكلفة أو العملة أو SKU أو أولوية المورد أو مهلة التنفيذ. لا يغيّر بيانات الزبائن أو نقاط الولاء أو المحافظ أو الإيداعات أو الأسعار أو سعر الصرف أو مفاتيح API أو الصلاحيات. يمكنه إنشاء مسودة إعلان صيانة أو توقف خدمة أو عودة خدمة، ولا تُرسل للزبائن إلا بطلب نشر منفصل ومعاينة وموافقة صريحة. النشر ينشئ إشعارات داخل المتجر ويحاول إرسال إشعارات الهاتف عبر مسار Push الحالي. تبقى الإجراءات المالية ومفاتيح API والصلاحيات محمية.";
    panel.append(heading,note,input,plan,preview,confirm,cancel,status,safe);
    const headingNode = host.querySelector("h2");
    if (headingNode && headingNode.parentNode === host) headingNode.insertAdjacentElement("afterend", panel);
    else host.insertBefore(panel, host.firstChild);

    plan.addEventListener("click", async () => {
      const command = input.value.trim();
      if (command.length < 5) { status.textContent = "اكتب طلباً واضحاً أولاً."; return; }
      plan.disabled = true; confirm.style.display = "none"; cancel.style.display = "none"; pendingSafeProposal = null;
      status.textContent = "عم حضّر اقتراحاً وأتحقق من حدود الصلاحيات…";
      try {
        const result = await callSafeAction({mode:"plan",command});
        if (result.auto_execute === true) {
          const p = result.proposal;
          if (!p || !["fulfillment_note","supplier_product_note","supplier"].includes(p.target_type) ||
              (p.target_type === "supplier" && (Object.keys(p.changes || {}).length !== 1 || !Object.prototype.hasOwnProperty.call(p.changes,"notes")))) {
            throw new Error("رفضت الواجهة التنفيذ التلقائي لأن نوع المهمة لا يطابق قائمة المهام الداخلية المسموحة.");
          }
          preview.textContent = "مهمة داخلية آمنة: " + p.target_name + " (" + p.target_key + ")\n" +
            "التغيير: " + JSON.stringify(p.changes,null,2) + "\n" +
            "سيتم حفظ الملاحظة الداخلية فقط، مع سجل تدقيق، دون إشعار الزبون.";
          preview.style.display = "block";
          status.textContent = "تم التحقق من أنها مهمة داخلية فقط. جاري التنفيذ والتسجيل…";
          const done = await callSafeAction({mode:"execute",confirm:true,proposal:p});
          preview.textContent += "\n\nالنتيجة المسجلة:\n" + JSON.stringify(done.record || {},null,2);
          status.textContent = done.warning || "✅ " + (done.message || "تم تنفيذ المهمة الداخلية وتسجيلها في سجل التدقيق.");
          return;
        }
        pendingSafeProposal = result.proposal; const p = result.proposal;
        preview.textContent = (p.target_type === "ticket" ? "تذكرة الدعم: " : p.target_type === "review" ? "تقييم الزبون: " : (p.target_type === "supplier" || p.target_type === "supplier_create") ? "المورد: " : p.target_type === "fulfillment_note" ? "ملاحظات تنفيذ الطلب: " : p.target_type === "supplier_product_note" ? "ملاحظات ربط المورد بالمنتج: " : p.target_type === "order_status" ? "حالة الطلب: " : (p.target_type === "announcement_create" || p.target_type === "announcement_publish") ? "إعلان المتجر: " : "المنتج: ") + p.target_name + " (" + p.target_key + ")\nسبب التعديل: " + p.reason +
          "\n\nالقيم الحالية:\n" + JSON.stringify(p.before,null,2) +
          "\n\nالقيم المقترحة:\n" + JSON.stringify(p.changes,null,2) +
          "\n\n" + (p.target_type === "ticket" ? "تنبيه: تغيير حالة التذكرة قد يرسل إشعاراً للزبون. " : p.target_type === "review" ? "سيتم اعتماد التقييم أو رفضه فقط، دون كتابة رد أو حذف. " : p.target_type === "order_status" ? "تنبيه: تغيير الحالة قد يرسل إشعاراً للزبون، ولا يسمح بإكمال الطلب أو إلغائه. " : p.target_type === "announcement_create" ? "سيتم إنشاء مسودة فقط دون إرسال إشعارات. " : p.target_type === "announcement_publish" ? "تنبيه: سيتم إرسال إشعار لكل حساب زبون غير إداري، وقد تصل إشعارات الهاتف حسب الاشتراك. لا يمكن التراجع عن الإرسال. " : "") + "لن يتم الحفظ إلا بعد موافقتك الصريحة.";
        preview.style.display = "block"; confirm.style.display = "block"; cancel.style.display = "block";
        status.textContent = "المعاينة جاهزة. راجع كل قيمة قبل التأكيد.";
      } catch(error) { preview.style.display = "none"; status.textContent = error?.message || "تعذر إعداد المعاينة."; }
      finally { plan.disabled = false; }
    });
    cancel.addEventListener("click", () => {
      pendingSafeProposal = null; preview.style.display = "none"; confirm.style.display = "none"; cancel.style.display = "none";
      status.textContent = "تم إلغاء المعاينة؛ لم يتم تغيير أي بيانات.";
    });
    confirm.addEventListener("click", async () => {
      if (!pendingSafeProposal) { status.textContent = "لا توجد معاينة صالحة للتنفيذ."; return; }
      confirm.disabled = true; cancel.disabled = true; status.textContent = "عم نفّذ التعديل المؤكد وأسجّل العملية…";
      try {
        const result = await callSafeAction({mode:"execute",confirm:true,proposal:pendingSafeProposal});
        pendingSafeProposal = null; confirm.style.display = "none"; cancel.style.display = "none";
        status.textContent = result.warning || "✅ " + (result.message || "تم تنفيذ التعديل وتسجيله.");
        preview.textContent = "النتيجة المسجلة:\n" + JSON.stringify(result.record || result.product || {},null,2);
      } catch(error) { status.textContent = error?.message || "تعذر تنفيذ التعديل."; }
      finally { confirm.disabled = false; cancel.disabled = false; }
    });
  }

  function initializeAdminEnhancements() {
    try { installSafeActions(); } catch (error) { console.error("Baran safe actions UI:", error); }
    try { installDepartmentTeam(); } catch (error) { console.error("Baran AI team UI:", error); }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeAdminEnhancements, { once: true });
  } else {
    initializeAdminEnhancements();
  }
  // Retry when the admin panel is rendered or revealed after login/navigation.
  const adminUiObserver = new MutationObserver(() => {
    const assistantHost = document.getElementById("baranAdminAssistant");
    const safeHost = document.getElementById("baranSafeActionsHost");
    if ((assistantHost && !document.getElementById("baranAiTeam")) || (safeHost && !document.getElementById("baranSafeActions"))) initializeAdminEnhancements();
  });
  adminUiObserver.observe(document.documentElement, { childList: true, subtree: true });

  window.runBaranAdminHealthCheck = function () {
    void send("اعمل فحصاً تشغيلياً شاملاً للمتجر الآن. راجع الأرباح المسجلة اليوم وهذا الشهر، الطلبات المفتوحة وتكاليف الموردين الناقصة، الإيداعات المعلقة، تذاكر الدعم المفتوحة، المنتجات والموردين والتنبيهات وسجل التدقيق. افصل الحقائق عن الاحتمالات، رتّب المشاكل حسب الخطورة، واكتب لكل مشكلة الدليل والخطوة المقترحة لحلها. لا تنفذ أي تعديل.");
  };
})();