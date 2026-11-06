// Baran Game AI customer-support chat
// The AI key stays on the server; this browser file contains no provider secret.
let baranAssistantHistory = [];
let baranAssistantBusy = false;

function toggleBaranAssistant(force) {
  const panel = document.getElementById("aiAssistantPanel");
  const fab = document.getElementById("aiAssistantFab");
  if (!panel || !fab) return;
  const shouldOpen = typeof force === "boolean" ? force : panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !shouldOpen);
  fab.setAttribute("aria-expanded", shouldOpen ? "true" : "false");
  if (shouldOpen) {
    const input = document.getElementById("aiAssistantInput");
    if (input) setTimeout(() => input.focus(), 50);
  }
}

function appendBaranAssistantMessage(text, role = "bot", isError = false) {
  const container = document.getElementById("aiAssistantMessages");
  if (!container) return;
  const bubble = document.createElement("div");
  bubble.className = "ai-chat-message " + role + (isError ? " error" : "");
  bubble.textContent = String(text || "");
  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
  return bubble;
}

async function sendBaranAssistantMessage(event) {
  if (event) event.preventDefault();
  if (baranAssistantBusy) return;
  const input = document.getElementById("aiAssistantInput");
  const button = document.getElementById("aiAssistantSend");
  const question = (input?.value || "").trim();
  if (!question) return;
  if (!currentUser) {
    appendBaranAssistantMessage("سجّل دخولك أولاً حتى أقدر أساعدك ببيانات حسابك.", "bot", true);
    return;
  }
  if (question.length > 1200) {
    appendBaranAssistantMessage("الرسالة طويلة. اختصرها إلى 1200 حرف.", "bot", true);
    return;
  }

  appendBaranAssistantMessage(question, "user");
  input.value = "";
  baranAssistantHistory.push({ role: "user", content: question });
  baranAssistantHistory = baranAssistantHistory.slice(-10);
  const pending = appendBaranAssistantMessage("لحظة، عم أراجع سؤالك وبيانات حسابك…");
  baranAssistantBusy = true;
  if (button) button.disabled = true;
  if (input) input.disabled = true;

  try {
    const { data: { session }, error: sessionError } = await sb.auth.getSession();
    if (sessionError || !session) throw new Error("انتهت الجلسة. سجّل الدخول من جديد.");
    const response = await fetch(SUPABASE_URL + "/functions/v1/baran-assistant", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + session.access_token,
        "apikey": SUPABASE_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ messages: baranAssistantHistory })
    });
    let result = {};
    try { result = await response.json(); } catch (_) {}
    if (!response.ok) {
      if (response.status === 503) throw new Error("المساعد الذكي قيد التفعيل حالياً. جرّب لاحقاً أو أرسل للدعم الفني.");
      if (response.status === 429) throw new Error("وصلنا للحد المؤقت للرسائل. انتظر قليلاً ثم جرّب.");
      throw new Error(result.error || "تعذر الوصول إلى المساعد حالياً.");
    }
    if (!result.reply) throw new Error("وصل رد غير مكتمل. أعد المحاولة.");
    if (pending) pending.remove();
    appendBaranAssistantMessage(result.reply, "bot");
    baranAssistantHistory.push({ role: "assistant", content: result.reply });
    baranAssistantHistory = baranAssistantHistory.slice(-10);
    if (result.escalated) {
      appendBaranAssistantMessage("حوّلت الموضوع لفريق الإدارة، ورح يراجعوا رسالتك من لوحة الدعم.", "bot");
    }
  } catch (error) {
    if (pending) pending.remove();
    appendBaranAssistantMessage(error?.message || "صار خطأ غير متوقع. جرّب مرة ثانية.", "bot", true);
  } finally {
    baranAssistantBusy = false;
    if (button) button.disabled = false;
    if (input) { input.disabled = false; input.focus(); }
  }
}
