/* BARAN GAME — Customer Experience Suite
 * Read-only customer intelligence layer. Financial mutations are intentionally absent.
 */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const node = (tag, cls, value) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (value !== undefined && value !== null) el.textContent = String(value);
    return el;
  };
  const money = (value, currency) => Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 }) + (currency === "USD" ? " $" : " ل.س");
  const date = (value) => value ? new Date(value).toLocaleString("ar") : "—";
  let current = null;

  function customerSegment(c) {
    const count = Number(c.order_count || 0);
    const last = c.last_order_at ? Date.now() - new Date(c.last_order_at).getTime() : Infinity;
    if (!count) return "جديد";
    if (last > 30 * 86400000) return "غير نشط";
    if (count >= 5) return "وفيّ";
    return "نشط";
  }
  function render(data) {
    current = data || {};
    const host = document.querySelector('[data-admin-panel="users"]');
    const search = $("opsCustomerSearch");
    if (!host || !search) return;
    let panel = $("baranExperienceSuite");
    if (!panel) {
      panel = node("section", "baran-experience");
      panel.id = "baranExperienceSuite";
      search.insertAdjacentElement("beforebegin", panel);
    }
    const customers = Array.isArray(current.customers) ? current.customers : [];
    const orders = Array.isArray(current.orders) ? current.orders : [];
    const feedback = Array.isArray(current.feedback) ? current.feedback : [];
    const completed = orders.filter(o => o.status === "completed");
    const failed = orders.filter(o => ["failed", "rejected", "cancelled"].includes(o.status));
    const segments = { "جدد": 0, "نشط": 0, "وفيّ": 0, "غير نشط": 0 };
    customers.forEach(c => segments[customerSegment(c)]++);
    const top = [...customers].sort((a,b) => Number(b.lifetime_spend_usd||0)-Number(a.lifetime_spend_usd||0)).slice(0,3);
    const cards = [
      ["👥", "إجمالي العملاء", customers.length],
      ["🛒", "طلبات مكتملة ضمن آخر السجل", completed.length],
      ["⚠️", "طلبات تحتاج انتباه", failed.length],
      ["🎫", "تذاكر وملاحظات محمّلة", feedback.length]
    ];
    panel.replaceChildren();
    const hero = node("div", "baran-experience-hero");
    const intro = node("div");
    intro.append(node("span", "baran-experience-kicker", "BARAN · CUSTOMER INTELLIGENCE"));
    intro.append(node("h3", "", "مركز تجربة العملاء"));
    intro.append(node("p", "", "لوحة موحّدة لفهم نشاط العملاء ومتابعة تجربتهم — قراءة إدارية آمنة دون أي تعديل مالي."));
    hero.append(intro, node("span", "baran-experience-mark", "✦"));
    panel.append(hero);
    const stats = node("div", "baran-experience-stats");
    cards.forEach(([icon,label,value]) => {
      const card = node("article", "baran-experience-stat");
      card.append(node("span", "baran-experience-stat-icon", icon), node("small", "", label), node("strong", "", Number(value).toLocaleString("en-US")));
      stats.append(card);
    });
    panel.append(stats);
    const lower = node("div", "baran-experience-grid");
    const segmentsBox = node("section", "baran-experience-card");
    segmentsBox.append(node("h4", "", "شرائح العملاء"));
    Object.entries(segments).forEach(([label,count]) => {
      const row = node("div", "baran-experience-segment");
      row.append(node("span", "", label));
      const track = node("span", "baran-experience-track");
      const fill = node("i");
      fill.style.width = (customers.length ? Math.round(count/customers.length*100) : 0) + "%";
      track.append(fill);
      row.append(track, node("b", "", count));
      segmentsBox.append(row);
    });
    const topBox = node("section", "baran-experience-card");
    topBox.append(node("h4", "", "الأعلى إنفاقاً بالدولار"));
    if (!top.length || top.every(c => !Number(c.lifetime_spend_usd||0))) {
      topBox.append(node("p", "baran-experience-muted", "لا توجد مشتريات بالدولار كافية للترتيب بعد."));
    } else {
      top.forEach((c,i) => {
        const row = node("div", "baran-experience-top");
        row.append(node("b", "baran-experience-rank", String(i+1).padStart(2,"0")));
        const identity = node("div");
        identity.append(node("strong", "", c.full_name || c.email || "عميل"), node("small", "", c.member_code || "عضوية BARAN"));
        row.append(identity, node("strong", "", money(c.lifetime_spend_usd,"USD")));
        topBox.append(row);
      });
    }
    lower.append(segmentsBox, topBox);
    panel.append(lower);
    const shortcuts = node("div", "baran-experience-shortcuts");
    [
      ["⭐", "الولاء والنقاط", "قسم الولاء الحالي"],
      ["🎁", "الدعوات والإحالات", "برنامج الدعوات الحالي"],
      ["💬", "الدعم والشكاوى", "تذاكر العملاء الحالية"],
      ["📣", "الإعلانات والعروض", "أدوات الإعلانات الحالية"],
      ["🛡️", "سجل الإدارة والحماية", "سجل التدقيق الحالي"]
    ].forEach(([icon,title,desc]) => {
      const item = node("div", "baran-experience-shortcut");
      item.append(node("span", "", icon), node("div"));
      item.lastChild.append(node("strong", "", title), node("small", "", desc));
      shortcuts.append(item);
    });
    panel.append(shortcuts);
    const note = node("p", "baran-experience-footnote", "تنبيه: بيانات الطلبات المعروضة تفصيلية لآخر 100 طلب محمّل في لوحة الإدارة، بينما إجمالي مشتريات العميل محسوب من سجل الطلبات الكامل. لا تُنفّذ هذه اللوحة شحناً أو استرداداً أو تغييراً للأرصدة.");
    panel.append(note);
    attachProfileButtons();
  }

  function attachProfileButtons() {
    const list = $("opsCustomers");
    if (!list) return;
    list.querySelectorAll(".customer-directory-item").forEach(card => {
      const details = card.querySelector(".customer-directory-details");
      if (!details || details.querySelector(".baran-open-full-profile")) return;
      const summary = card.querySelector(".customer-directory-toggle");
      const label = summary?.querySelector(".customer-directory-identity strong")?.textContent || "";
      const customer = (current?.customers || []).find(c => c.id === card.dataset.customerId) || (current?.customers || []).find(c => (c.full_name || c.email || "زبون") === label);
      if (!customer) return;
      const button = node("button", "baran-open-full-profile", "فتح الملف الشامل ←");
      button.type = "button";
      button.addEventListener("click", () => openProfile(customer));
      details.append(button);
    });
  }
  function openProfile(customer) {
    const orders = (current?.orders || []).filter(o => o.user_id === customer.id);
    const tickets = (current?.feedback || []).filter(f => f.user_id === customer.id);
    const loyalty = (current?.loyalty_customers || []).find(x => x.user_id === customer.id);
    let modal = $("baranCustomerProfileModal");
    if (modal) modal.remove();
    modal = node("div", "baran-profile-overlay");
    modal.id = "baranCustomerProfileModal";
    const dialog = node("section", "baran-profile-dialog");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const head = node("div", "baran-profile-head");
    const title = node("div");
    title.append(node("span", "baran-experience-kicker", "CUSTOMER PROFILE"));
    title.append(node("h3", "", customer.full_name || customer.email || "ملف العميل"));
    title.append(node("p", "", (customer.member_code || "—") + " · " + customerSegment(customer)));
    const close = node("button", "baran-profile-close", "×");
    close.type = "button"; close.setAttribute("aria-label","إغلاق");
    close.addEventListener("click", () => modal.remove());
    head.append(title, close); dialog.append(head);
    const metrics = node("div", "baran-profile-metrics");
    [["📦","كل الطلبات",customer.order_count||0],["⭐","النقاط",loyalty?.points_balance ?? customer.loyalty_points ?? 0],["💵","مشتريات USD",money(customer.lifetime_spend_usd,"USD")],["💰","مشتريات SYP",money(customer.lifetime_spend_syp,"SYP")]].forEach(([i,l,v])=>{
      const m=node("div","baran-profile-metric");m.append(node("small","",i+" "+l),node("strong","",v));metrics.append(m);
    });
    dialog.append(metrics);
    const info=node("section","baran-profile-section");info.append(node("h4","","بيانات الحساب"));
    [["البريد",customer.email],["الهاتف",customer.phone],["تاريخ التسجيل",date(customer.created_at)],["آخر طلب",date(customer.last_order_at)],["الرصيد USD",money(customer.balance_usd,"USD")],["الرصيد SYP",money(customer.balance_syp,"SYP")]].forEach(([k,v])=>{
      const row=node("div","baran-profile-row");row.append(node("span","",k),node("strong","",v||"—"));info.append(row);
    });dialog.append(info);
    const orderBox=node("section","baran-profile-section");orderBox.append(node("h4","","سجل الطلبات المحمّل"));
    if(!orders.length)orderBox.append(node("p","baran-experience-muted","لا توجد طلبات لهذا العميل ضمن آخر السجل المحمّل."));
    orders.slice(0,30).forEach(o=>{
      const row=node("div","baran-profile-record");
      row.append(node("strong","","#"+String(o.id||"").slice(0,8)+" · "+(o.product_code||"طلب")),node("span","",o.status||"—"),node("small","",date(o.created_at)+" · "+(o.total_price_usd!=null?money(o.total_price_usd,"USD"):money(o.total_price_syp,"SYP"))));
      orderBox.append(row);
    });dialog.append(orderBox);
    const support=node("section","baran-profile-section");support.append(node("h4","","التذاكر والتقييمات"));
    if(!tickets.length)support.append(node("p","baran-experience-muted","لا توجد تذاكر أو تقييمات ضمن آخر السجلات المحمّلة."));
    tickets.slice(0,15).forEach(t=>{
      const row=node("div","baran-profile-record");row.append(node("strong","",t.subject||t.ticket_code||t.feedback_type||"تواصل"),node("span","",t.status||"—"),node("small","",date(t.created_at)+" · "+(t.message||"").slice(0,180)));support.append(row);
    });dialog.append(support);
    const accountControl=customer.account_control||{status:"active"};
    const securityBox=node("section","baran-profile-section");
    securityBox.append(node("h4","","🛡️ حماية الحساب وإدارة الحظر"));
    const state=node("p",accountControl.status==="banned"?"baran-account-banned":"baran-account-active",
      accountControl.status==="banned"?"الحساب محظور حالياً":"الحساب غير محظور");
    securityBox.append(state);
    const securityEvents=(current?.customer_security_events||[]).filter(event=>event.user_id===customer.id).slice(0,10);
    const eventTitle=node("h5","","آخر أحداث الحماية المسجلة");
    securityBox.append(eventTitle);
    if(!securityEvents.length){
      securityBox.append(node("p","baran-experience-muted","لا توجد أحداث حماية مسجلة لهذا العميل بعد."));
    }else{
      securityEvents.forEach(event=>{
        const row=node("div","baran-profile-record");
        const label=event.event_type==="customer_banned"?"تم حظر الحساب":
          event.event_type==="customer_unbanned"?"تم إلغاء الحظر":event.event_type;
        row.append(node("strong","",label),node("span","",event.severity||"info"),node("small","",date(event.created_at)));
        securityBox.append(row);
      });
    }
    if(accountControl.status==="banned"){
      securityBox.append(node("small","baran-experience-muted","السبب: "+(accountControl.reason||"غير محدد")+" · حتى: "+date(accountControl.banned_until)));
      const unban=node("button","baran-ban-action baran-unban","إلغاء الحظر");
      unban.type="button";
      unban.addEventListener("click",()=>changeCustomerBan(customer.id,"none",modal));
      securityBox.append(unban);
    }else{
      const reason=node("input","baran-ban-reason");
      reason.type="text";reason.maxLength=500;reason.placeholder="سبب الحظر (إلزامي)";
      const duration=node("select","baran-ban-duration");
      [["1h","ساعة واحدة"],["24h","24 ساعة"],["7d","7 أيام"],["30d","30 يوماً"],["permanent","دائم"]].forEach(([v,l])=>{const op=node("option","",l);op.value=v;duration.append(op);});
      const ban=node("button","baran-ban-action","تأكيد الحظر");
      ban.type="button";
      ban.addEventListener("click",()=>changeCustomerBan(customer.id,duration.value,modal,reason.value));
      securityBox.append(reason,duration,ban);
    }
    dialog.append(securityBox);
    const safe=node("p","baran-profile-safety","الملف للعرض والمتابعة فقط. لا توجد أزرار لتعديل الرصيد أو تنفيذ استرداد أو شحن.");
    dialog.append(safe);modal.append(dialog);
    modal.addEventListener("click",e=>{if(e.target===modal)modal.remove();});
    document.addEventListener("keydown",function esc(e){if(e.key==="Escape"){modal.remove();document.removeEventListener("keydown",esc);}});
    document.body.append(modal);
  }
  async function changeCustomerBan(userId,duration,modal,reason=""){
    if(duration!=="none"&&!reason.trim()){window.alert("اكتب سبب الحظر أولاً.");return;}
    const confirmText=duration==="none"?"تأكيد إلغاء حظر هذا العميل؟":"تأكيد حظر العميل؟";
    if(!window.confirm(confirmText))return;
    try{
      const {data:{session},error:sessionError}=await sb.auth.getSession();
      if(sessionError||!session)throw new Error("انتهت جلسة المدير.");
      const response=await fetch(SUPABASE_URL+"/functions/v1/baran-admin",{
        method:"POST",
        headers:{"Authorization":"Bearer "+session.access_token,"apikey":SUPABASE_KEY,"Content-Type":"application/json"},
        body:JSON.stringify({action:"customer_account_ban",target_user_id:userId,ban_duration:duration,ban_reason:reason.trim()})
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||"تعذر تنفيذ الإجراء.");
      window.alert(duration==="none"?"تم إلغاء الحظر.":"تم تطبيق الحظر.");
      if(modal)modal.remove();
      window.location.reload();
    }catch(error){window.alert(error.message||"تعذر تنفيذ الإجراء.");}
  }
  window.renderBaranCustomerExperience = render;
  const observer = new MutationObserver(attachProfileButtons);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => {
    const list=$("opsCustomers"); if(list)observer.observe(list,{childList:true,subtree:true});
  });
  else { const list=$("opsCustomers"); if(list)observer.observe(list,{childList:true,subtree:true}); }
})();
