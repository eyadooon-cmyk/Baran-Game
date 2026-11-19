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
    const segments = { "جديد": 0, "نشط": 0, "وفيّ": 0, "غير نشط": 0 };
    customers.forEach(c => {
      const segment = customerSegment(c);
      if (Object.prototype.hasOwnProperty.call(segments, segment)) segments[segment] += 1;
    });
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
      row.append(node("span", "", label === "جديد" ? "جدد" : label));
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
        identity.append(node("strong", "", c.full_name || c.display_name || "مستخدم جديد"), node("small", "", c.email || c.member_code || "عضوية BARAN"));
        row.append(identity, node("strong", "", money(c.lifetime_spend_usd,"USD")));
        topBox.append(row);
      });
    }
    lower.append(segmentsBox, topBox);
    panel.append(lower);
    const securityEvents = Array.isArray(current.customer_security_events) ? current.customer_security_events : [];
    const loginReports = securityEvents.filter(event => event.event_type === "login_failed_reported");
    const newDeviceEvents = securityEvents.filter(event => event.event_type === "customer_new_device_detected");
    const securityPanel = node("section", "baran-experience-card");
    securityPanel.append(node("h4", "", "🛡️ مراقبة الدخول والأجهزة"));
    const securityStats = node("div", "baran-experience-stats");
    [[ "محاولات دخول فاشلة مُبلّغ عنها", loginReports.length ], [ "أجهزة أو شبكات جديدة", newDeviceEvents.length ]].forEach(([label,value]) => {
      const card = node("article", "baran-experience-stat");
      card.append(node("small", "", label), node("strong", "", Number(value).toLocaleString("en-US")));
      securityStats.append(card);
    });
    securityPanel.append(securityStats);
    securityPanel.append(node("p", "baran-experience-muted", "محاولات الدخول الفاشلة مصدرها بلاغ واجهة الدخول وليست تأكيداً مستقلاً من خادم المصادقة. اكتشاف الجهاز الجديد مبني على جلسات Supabase الفعلية."));
    const latestSecurity = securityEvents.filter(event => ["login_failed_reported","customer_new_device_detected","customer_login_session_created"].includes(event.event_type)).slice(0,8);
    if (!latestSecurity.length) securityPanel.append(node("p", "baran-experience-muted", "لا توجد أحداث دخول مسجلة بعد."));
    latestSecurity.forEach(event => {
      const row = node("div", "baran-experience-segment");
      const label = event.event_type === "login_failed_reported" ? "محاولة دخول فاشلة مُبلّغ عنها" :
        event.event_type === "customer_new_device_detected" ? "دخول من جهاز أو شبكة جديدة" : "إنشاء جلسة دخول";
      const details = event.details || {};
      row.append(node("span", "", label + " · " + date(event.created_at)));
      row.append(node("b", "", event.severity || "info"));
      securityPanel.append(row);
    });
    panel.append(securityPanel);
    const shortcuts = node("div", "baran-experience-shortcuts");
    [
      ["⭐", "الولاء والنقاط", "فتح إدارة نقاط الولاء", "loyalty"],
      ["🎁", "الدعوات والإحالات", "برنامج الدعوات الحالي", ""],
      ["💬", "الدعم والشكاوى", "فتح تذاكر العملاء", "support"],
      ["📣", "الإعلانات والعروض", "فتح إدارة العروض والكوبونات", "promotions"],
      ["🛡️", "سجل الإدارة والحماية", "فتح سجل الأمان وعمليات الإدارة", "security-log"]
    ].forEach(([icon,title,desc,target]) => {
      const item = node("button", "baran-experience-shortcut", "");
      item.type = "button";
      item.disabled = !target;
      item.setAttribute("aria-label", title);
      item.append(node("span", "", icon), node("span", "baran-experience-shortcut-copy"));
      item.lastChild.append(node("strong", "", title), node("small", "", desc));
      if (target) {
        item.addEventListener("click", () => {
          if (typeof window.showAdminPanel !== "function") {
            window.alert("تعذر فتح القسم حالياً. حدّث الصفحة وحاول مجدداً.");
            return;
          }
          if (target === "security-log") {
            Promise.resolve(window.showAdminPanel("security")).then(() => {
              if (typeof window.switchSecurityDepositTab === "function") {
                window.switchSecurityDepositTab("security");
              }
            });
          } else {
            window.showAdminPanel(target);
          }
        });
      }
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
      if (card.querySelector(".baran-open-full-profile")) return;
      const summary = card.querySelector(".customer-directory-toggle");
      if (!summary) return;
      const label = summary.querySelector(".customer-directory-identity strong")?.textContent || "";
      // The directory and the experience endpoint may return different customer shapes.
      // Resolve from both sources and normalize IDs before matching.
      const sources = [
        ...(Array.isArray(current?.customers) ? current.customers : []),
        ...(Array.isArray(window.baranCustomerDirectory) ? window.baranCustomerDirectory : [])
      ];
      const customer = sources.find(c => String(c.id || c.user_id || "") === String(card.dataset.customerId || "")) ||
        sources.find(c => (c.full_name || c.email || "زبون") === label);
      if (!customer) return;
      const button = node("button", "baran-open-full-profile", "فتح الملف الشامل ←");
      button.type = "button";
      button.setAttribute("aria-label", "فتح الملف الشامل للعميل " + (customer.full_name || customer.email || ""));
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openProfile(customer);
      });
      card.append(button);
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
    title.append(node("h3", "", customer.full_name || customer.display_name || "ملف العميل"));
    title.append(node("p", "", "ID: " + (customer.member_code || "غير متوفر") + " · " + customerSegment(customer)));
    const copyId = node("button", "baran-ban-action", "📋 نسخ ID");
    copyId.type = "button";
    copyId.addEventListener("click", () => copyCustomerId(customer.member_code));
    title.append(copyId);
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
    [["البريد",customer.email],["الهاتف",customer.phone],["تاريخ التسجيل",date(customer.created_at)],["آخر نشاط",date(customer.last_sign_in_at||customer.last_order_at)],["آخر طلب",date(customer.last_order_at)],["الرصيد USD",money(customer.balance_usd,"USD")],["الرصيد SYP",money(customer.balance_syp,"SYP")]].forEach(([k,v])=>{
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
    const nameBox=node("section","baran-profile-section");
    nameBox.append(node("h4","","✏️ اسم العميل الظاهر"));
    nameBox.append(node("p","baran-experience-muted","يمكنك تعديل الاسم الذي يظهر في دليل المستخدمين دون تغيير البريد أو بيانات الدخول."));
    const nameInput=node("input","baran-ban-reason");
    nameInput.type="text";nameInput.maxLength=60;nameInput.value=customer.full_name||customer.display_name||"";nameInput.placeholder="اكتب اسم العميل";
    const saveName=node("button","baran-ban-action","حفظ الاسم");
    saveName.type="button";
    saveName.addEventListener("click",()=>updateCustomerName(customer,nameInput.value,saveName,title));
    nameBox.append(nameInput,saveName);
    dialog.append(nameBox);
    const noteBox=node("section","baran-profile-section");
    noteBox.append(node("h4","","📝 ملاحظات إدارية خاصة"));
    noteBox.append(node("p","baran-experience-muted","هذه الملاحظة داخلية لفريق الإدارة فقط، ولا تظهر للعميل."));
    const noteInput=node("textarea","baran-admin-customer-note");
    noteInput.maxLength=1000;noteInput.rows=4;noteInput.placeholder="مثال: عميل دائم، يفضّل التواصل عبر الدعم، يحتاج طلباته مراجعة...";
    noteInput.value=customer.admin_note||"";
    noteInput.style.cssText="width:100%;min-height:100px;padding:12px;border-radius:12px;border:1px solid #59436b;background:#100d15;color:#f4eafa;font:inherit;resize:vertical";
    const noteStatus=node("small","baran-experience-muted","");
    const saveNote=node("button","baran-ban-action","حفظ الملاحظة");
    saveNote.type="button";
    saveNote.addEventListener("click",()=>saveCustomerAdminNote(customer,noteInput.value,saveNote,noteStatus));
    noteBox.append(noteInput,saveNote,noteStatus);
    dialog.append(noteBox);
    const safe=node("p","baran-profile-safety","الملف للعرض والمتابعة فقط. لا توجد أزرار لتعديل الرصيد أو تنفيذ استرداد أو شحن.");
    dialog.append(safe);modal.append(dialog);
    modal.addEventListener("click",e=>{if(e.target===modal)modal.remove();});
    document.addEventListener("keydown",function esc(e){if(e.key==="Escape"){modal.remove();document.removeEventListener("keydown",esc);}});
    document.body.append(modal);
  }
  async function copyCustomerId(memberCode){
    const code=String(memberCode||"").trim();
    if(!/^BG-[0-9]{6,}$/.test(code)){window.alert("معرّف العميل غير متوفر حالياً.");return;}
    try{await navigator.clipboard.writeText(code);window.alert("تم نسخ معرّف العميل.");}
    catch(error){window.prompt("انسخ معرّف العميل:",code);}
  }
  async function saveCustomerAdminNote(customer,value,button,status){
    const note=String(value||"").trim();
    if(note.length>1000){window.alert("الملاحظة يجب ألا تتجاوز 1000 حرف.");return;}
    button.disabled=true;button.textContent="جارٍ الحفظ...";
    try{
      const {data:{session},error:sessionError}=await sb.auth.getSession();
      if(sessionError||!session)throw new Error("انتهت جلسة المدير.");
      const response=await fetch(SUPABASE_URL+"/functions/v1/baran-admin",{
        method:"POST",
        headers:{"Authorization":"Bearer "+session.access_token,"apikey":SUPABASE_KEY,"Content-Type":"application/json"},
        body:JSON.stringify({action:"customer_admin_note_update",target_user_id:customer.id,note})
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||"تعذر حفظ الملاحظة.");
      customer.admin_note=result.note||"";customer.admin_note_updated_at=result.updated_at||null;
      const sources=[...(Array.isArray(current?.customers)?current.customers:[]),...(Array.isArray(window.baranCustomerDirectory)?window.baranCustomerDirectory:[])];
      sources.forEach(item=>{if(String(item.id||item.user_id||"")===String(customer.id)){item.admin_note=customer.admin_note;item.admin_note_updated_at=customer.admin_note_updated_at;}});
      if(status)status.textContent=note?"تم حفظ الملاحظة الإدارية.":"تم حذف الملاحظة الإدارية.";
      window.alert(note?"تم حفظ الملاحظة الإدارية.":"تم حذف الملاحظة الإدارية.");
    }catch(error){window.alert(error.message||"تعذر حفظ الملاحظة.");}
    finally{button.disabled=false;button.textContent="حفظ الملاحظة";}
  }

  async function updateCustomerName(customer,value,button,title){
    const displayName=String(value||"").trim().replace(/\s+/g," ");
    if(displayName.length<2||displayName.length>60){window.alert("الاسم يجب أن يكون بين حرفين و60 حرفاً.");return;}
    button.disabled=true;button.textContent="جارٍ الحفظ...";
    try{
      const {data:{session},error:sessionError}=await sb.auth.getSession();
      if(sessionError||!session)throw new Error("انتهت جلسة المدير.");
      const response=await fetch(SUPABASE_URL+"/functions/v1/baran-admin",{
        method:"POST",
        headers:{"Authorization":"Bearer "+session.access_token,"apikey":SUPABASE_KEY,"Content-Type":"application/json"},
        body:JSON.stringify({action:"customer_profile_update",target_user_id:customer.id,display_name:displayName})
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(result.error||"تعذر حفظ الاسم.");
      customer.full_name=result.full_name||displayName;customer.display_name=customer.full_name;
      const sources=[...(Array.isArray(current?.customers)?current.customers:[]),...(Array.isArray(window.baranCustomerDirectory)?window.baranCustomerDirectory:[])];
      sources.forEach(item=>{if(String(item.id||item.user_id||"")===String(customer.id)){item.full_name=customer.full_name;item.display_name=customer.full_name;}});
      if(title?.querySelector("h3"))title.querySelector("h3").textContent=customer.full_name;
      if(typeof window.renderBaranCustomerDirectory==="function")window.renderBaranCustomerDirectory(window.baranCustomerDirectory||current?.customers||[]);
      window.alert("تم تحديث اسم العميل بنجاح.");
    }catch(error){window.alert(error.message||"تعذر حفظ الاسم.");}
    finally{button.disabled=false;button.textContent="حفظ الاسم";}
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
  window.openBaranCustomerProfile = openProfile;
  window.renderBaranCustomerExperience = render;
  const observer = new MutationObserver(attachProfileButtons);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => {
    const list=$("opsCustomers"); if(list)observer.observe(list,{childList:true,subtree:true});
  });
  else { const list=$("opsCustomers"); if(list)observer.observe(list,{childList:true,subtree:true}); }
})();
