// Baran Game AI customer-support chat
// The AI key stays on the server; this browser file contains no provider secret.
let baranAssistantHistory = [];
let baranAssistantBusy = false;

function openBaranSupportAssistant() {
  if (!currentUser) return;
  const support = document.getElementById("support");
  const isOpen = support && !support.classList.contains("hidden");
  if (isOpen) {
    closeBaranSupportAssistant();
    return;
  }
  if (typeof showSection === "function") showSection("support", null);
  const fab = document.getElementById("aiAssistantFab");
  if (fab) { fab.classList.add("is-open"); fab.setAttribute("aria-expanded", "true"); }
  const panel = document.getElementById("aiAssistantPanel");
  if (panel) panel.classList.add("baran-chat-enter");
  const input = document.getElementById("aiAssistantInput");
  if (input) setTimeout(() => input.focus(), 220);
}

function closeBaranSupportAssistant() {
  const support = document.getElementById("support");
  if (support && !support.classList.contains("hidden")) {
    const previous = Array.isArray(window.baranSectionHistory) ? window.baranSectionHistory : [];
    const last = previous.pop();
    if (last && typeof showSection === "function") showSection(last, null, { fromHistory: true });
    else if (typeof showSection === "function") showSection("home", null, { fromHistory: true });
  }
  const fab = document.getElementById("aiAssistantFab");
  if (fab) { fab.classList.remove("is-open"); fab.setAttribute("aria-expanded", "false"); }
}

// Compatibility alias for older button references.
function toggleBaranAssistant() { openBaranSupportAssistant(); }

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
      const ticketText = result.ticket_code ? " رقم تذكرتك: " + result.ticket_code + "." : "";
      appendBaranAssistantMessage("حوّلت الموضوع لفريق الإدارة، ورح يراجعوا رسالتك من لوحة الدعم."+ticketText, "bot");
      if (typeof loadMyFeedback === "function") await loadMyFeedback();
      if (typeof loadMyNotifications === "function") await loadMyNotifications();
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


// Allow customers to move the floating support robot away from navigation controls.
(function initBaranSupportDrag(){
  function setup(){
    const btn=document.getElementById("aiAssistantFab");
    if(!btn||btn.dataset.dragReady==="1")return;
    btn.dataset.dragReady="1";
    const KEY="baran_support_robot_position_v1";
    let startX=0,startY=0,startLeft=0,startTop=0,moved=false,pointerId=null;
    const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
    function applyPosition(left,top){
      const maxLeft=Math.max(8,window.innerWidth-btn.offsetWidth-8);
      const maxTop=Math.max(8,window.innerHeight-btn.offsetHeight-8);
      btn.style.left=clamp(left,8,maxLeft)+"px";
      btn.style.top=clamp(top,8,maxTop)+"px";
      btn.style.right="auto";btn.style.bottom="auto";
    }
    try{
      const saved=JSON.parse(localStorage.getItem(KEY)||"null");
      if(saved&&Number.isFinite(saved.left)&&Number.isFinite(saved.top))applyPosition(saved.left,saved.top);
    }catch(_){}
    btn.addEventListener("pointerdown",function(e){
      if(e.button!==undefined&&e.button!==0)return;
      pointerId=e.pointerId;startX=e.clientX;startY=e.clientY;
      const rect=btn.getBoundingClientRect();startLeft=rect.left;startTop=rect.top;
      moved=false;
      try{btn.setPointerCapture(pointerId)}catch(_){}
    });
    btn.addEventListener("pointermove",function(e){
      if(pointerId===null||e.pointerId!==pointerId)return;
      const dx=e.clientX-startX,dy=e.clientY-startY;
      if(!moved&&Math.hypot(dx,dy)<7)return;
      moved=true;btn.classList.add("baran-support-dragging");
      applyPosition(startLeft+dx,startTop+dy);
      e.preventDefault();
    });
    function finish(e){
      if(pointerId===null||(e&&e.pointerId!==pointerId))return;
      if(moved){
        const rect=btn.getBoundingClientRect();
        try{localStorage.setItem(KEY,JSON.stringify({left:rect.left,top:rect.top}))}catch(_){}
        btn.dataset.dragged="1";
      }
      pointerId=null;btn.classList.remove("baran-support-dragging");
    }
    btn.addEventListener("pointerup",finish);
    btn.addEventListener("pointercancel",finish);
    btn.addEventListener("click",function(e){
      if(btn.dataset.dragged==="1"){
        e.preventDefault();e.stopImmediatePropagation();delete btn.dataset.dragged;
      }
    },true);
    window.addEventListener("resize",function(){
      const rect=btn.getBoundingClientRect();
      if(btn.style.top)applyPosition(rect.left,rect.top);
    });
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",setup,{once:true});
  else setup();
})();
