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
    const host = document.querySelector('[data-admin-panel="customer-experience"]') || document.querySelector('[data-admin-panel="users"]');
    const search = $("opsCustomerSearch");
    if (!host || !search) return;
    let panel = $("baranExperienceSuite");
    const mount = $("baranExperienceSuiteMount");
    if (!panel) {
      panel = node("section", "baran-experience");
      panel.id = "baranExperienceSuite";
      if (mount) mount.append(panel);
      else search.insertAdjacentElement("beforebegin", panel);
    } else if (mount && panel.parentElement !== mount) {
      mount.append(panel);
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
      ["🎫", "تذاكر وملاحظات محمّلة", feedback.length],
      ["🔔", "عملاء لديهم اشتراك إشعارات", customers.filter(c => Number(c.push_subscription_count || 0) > 0).length]
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
    const segmentFilter = node("section", "baran-experience-card");
    segmentFilter.style.cssText = "margin:14px 0;padding:14px;border:1px solid #59436b;border-radius:14px;background:#17121e";
    const filterHead = node("div");
    filterHead.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap";
    filterHead.append(node("h4", "", "🔎 تصنيف وتصفية العملاء"));
    const filterSelect = node("select", "baran-customer-segment-filter");
    filterSelect.style.cssText = "min-width:150px;max-width:100%;padding:11px;border:1px solid #665078;border-radius:10px;background:#100d16;color:#f4eafa;font:inherit";
    [["all","كل العملاء"],["جديد","عملاء جدد"],["نشط","عملاء نشطون"],["وفيّ","عملاء أوفياء"],["غير نشط","عملاء غير نشطين"],["push-enabled","🔔 لديهم اشتراك إشعارات"],["push-disabled","🔕 بلا اشتراك مسجّل"]].forEach(([value,label]) => {
      const option = node("option","",label); option.value=value; filterSelect.append(option);
    });
    filterSelect.addEventListener("change", () => applySegmentFilter(filterSelect.value));
    filterHead.append(filterSelect);
    // Make the push-subscriber statistic an actionable shortcut on mobile.
    const pushStat = stats.children[4];
    if (pushStat) {
      pushStat.style.cursor = "pointer";
      pushStat.setAttribute("role", "button");
      pushStat.setAttribute("tabindex", "0");
      pushStat.setAttribute("aria-label", "عرض العملاء المشتركين بالإشعارات");
      const showPushCustomers = () => {
        filterSelect.value = "push-enabled";
        applySegmentFilter("push-enabled");
        const directory = $("opsCustomers") || $("baranUserDirectoryList");
        if (directory) directory.scrollIntoView({ behavior: "smooth", block: "start" });
      };
      pushStat.addEventListener("click", showPushCustomers);
      pushStat.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          showPushCustomers();
        }
      });
    }
    segmentFilter.append(filterHead);
    segmentFilter.append(node("p","baran-experience-muted", "حالة الاشتراك المسجّل لا تؤكد أن إذن إشعارات الهاتف ما زال مفعّلاً أو أن الجهاز سيستقبل الرسائل."));
    panel.append(segmentFilter);
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
    const lists = [ $("opsCustomers"), $("baranUserDirectoryList") ].filter(Boolean);
    if (!lists.length) return;
    lists.forEach(list => list.querySelectorAll(".customer-directory-item").forEach(card => {
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
      const segment = customerSegment(customer);
      card.dataset.customerSegment = segment;
      if (customer.is_vip && !card.querySelector(".baran-customer-vip-chip")) {
        const vipChip = node("span", "baran-customer-vip-chip", "👑 VIP");
        vipChip.style.cssText = "display:inline-flex;margin:4px;padding:4px 9px;border-radius:20px;background:linear-gradient(120deg,#72521b,#b88b35);color:#fff4ce;font-size:10px;font-weight:900";
        summary.append(vipChip);
      }
      if (!card.querySelector(".baran-customer-segment-chip")) {
        const chip = node("span", "baran-customer-segment-chip", segment === "وفيّ" ? "⭐ عميل وفيّ" : segment === "نشط" ? "نشط" : segment === "غير نشط" ? "غير نشط" : "جديد");
        chip.style.cssText = "display:inline-flex;align-items:center;margin:5px 4px;padding:4px 9px;border:1px solid #765792;border-radius:20px;background:#2b1b3a;color:#e8d5f6;font-size:10px;font-weight:800";
        summary.append(chip);
      }
      const pushCount = Number(customer.push_subscription_count || 0);
      card.dataset.pushSubscribed = pushCount > 0 ? "yes" : "no";
      if (!card.querySelector(".baran-customer-push-chip")) {
        const pushChip = node("span", "baran-customer-push-chip", pushCount > 0 ? ("🔔 اشتراك مسجّل" + (pushCount > 1 ? " · " + pushCount + " أجهزة" : "")) : "🔕 لا يوجد اشتراك");
        pushChip.style.cssText = "display:inline-flex;align-items:center;margin:4px;padding:4px 9px;border:1px solid " + (pushCount > 0 ? "#39785d" : "#66556f") + ";border-radius:20px;background:" + (pushCount > 0 ? "#173528" : "#282033") + ";color:" + (pushCount > 0 ? "#b8f0cf" : "#c8b8d2") + ";font-size:10px;font-weight:850";
        summary.append(pushChip);
      }
      if (!card.querySelector(".baran-open-full-profile")) {
      const button = node("button", "baran-open-full-profile", "فتح الملف الشامل ←");
      button.type = "button";
      button.setAttribute("aria-label", "فتح الملف الشامل للعميل " + (customer.full_name || customer.email || ""));
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openProfile(customer);
      });
        card.append(button);
      }
    }));
  }
  function applySegmentFilter(segment) {
    // Ensure subscription badges/data attributes exist before applying the filter.
    attachProfileButtons();
    const lists = [ $("opsCustomers"), $("baranUserDirectoryList") ].filter(Boolean);
    lists.forEach(list => list.querySelectorAll(".customer-directory-item").forEach(card => {
      const matches = segment === "all" ||
        (segment === "push-enabled" && card.dataset.pushSubscribed === "yes") ||
        (segment === "push-disabled" && card.dataset.pushSubscribed !== "yes") ||
        card.dataset.customerSegment === segment;
      card.style.display = matches ? "" : "none";
    }));
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
    const avatarUrl = [customer.avatar_url, customer.picture].find(value => typeof value === "string" && /^https:\/\//i.test(value));
    const avatar = node("div", "baran-profile-avatar");
    avatar.style.cssText = "width:76px;height:76px;min-width:76px;border-radius:22px;overflow:hidden;display:grid;place-items:center;flex:0 0 76px;background:linear-gradient(145deg,#694080,#30213e);border:2px solid #b58bd2;color:#fff;font-size:30px;font-weight:900;box-shadow:0 5px 18px rgba(0,0,0,.25)";
    if (avatarUrl) {
      const image = document.createElement("img");
      image.src = avatarUrl; image.alt = "صورة " + (customer.full_name || customer.display_name || "العميل");
      image.referrerPolicy = "no-referrer"; image.loading = "eager";
      image.style.cssText = "width:100%;height:100%;object-fit:cover;display:block";
      image.onerror = () => { image.remove(); avatar.textContent = (customer.full_name || customer.display_name || "👤").trim().slice(0,1) || "👤"; };
      avatar.append(image);
    } else {
      avatar.textContent = (customer.full_name || customer.display_name || "👤").trim().slice(0,1) || "👤";
    }
    const title = node("div");
    title.style.cssText = "flex:1;min-width:0";
    title.append(node("span", "baran-experience-kicker", "CUSTOMER PROFILE"));
    title.append(node("h3", "", customer.full_name || customer.display_name || "ملف العميل"));
    title.append(node("p", "", "ID: " + (customer.member_code || "غير متوفر") + " · " + customerSegment(customer)));
    const copyId = node("button", "baran-ban-action", "📋 نسخ ID");
    copyId.type = "button";
    copyId.addEventListener("click", () => copyCustomerId(customer.member_code));
    title.append(copyId);
    const directChat = node("button", "baran-ban-action", "💬 مراسلة العميل مباشرة");
    directChat.type = "button";
    directChat.addEventListener("click", () => {
      if (typeof window.openBaranDirectChatAdmin !== "function") {
        window.alert("صفحة المحادثات غير جاهزة حالياً. حدّث الصفحة وحاول مجدداً.");
        return;
      }
      modal.remove();
      window.openBaranDirectChatAdmin(customer.id);
    });
    title.append(directChat);
    const close = node("button", "baran-profile-close", "×");
    close.type = "button"; close.setAttribute("aria-label","إغلاق");
    close.addEventListener("click", () => modal.remove());
    head.style.cssText = "display:flex;align-items:center;gap:14px";
    head.append(avatar, title, close); dialog.append(head);
    const metrics = node("div", "baran-profile-metrics");
    [["📦","كل الطلبات",customer.order_count||0],["⭐","النقاط",loyalty?.points_balance ?? customer.loyalty_points ?? 0],["💵","مشتريات USD",money(customer.lifetime_spend_usd,"USD")],["💰","مشتريات SYP",money(customer.lifetime_spend_syp,"SYP")]].forEach(([i,l,v])=>{
      const m=node("div","baran-profile-metric");m.append(node("small","",i+" "+l),node("strong","",v));metrics.append(m);
    });
    dialog.append(metrics);
    const segmentBox=node("section","baran-profile-section");
    segmentBox.append(node("h4","","🏷️ تصنيف العميل"));
    const segmentName=customerSegment(customer);
    segmentBox.append(node("p","baran-experience-muted",
      segmentName==="وفيّ"?"عميل وفيّ — لديه خمسة طلبات أو أكثر وآخر طلب خلال 30 يوماً.":
      segmentName==="نشط"?"عميل نشط — لديه طلبات حديثة.":
      segmentName==="غير نشط"?"عميل غير نشط — مرّ أكثر من 30 يوماً على آخر طلب.":
      "عميل جديد — لا توجد طلبات مسجلة له بعد."));
    dialog.append(segmentBox);
    const vipBox=node("section","baran-profile-section");
    vipBox.append(node("h4","","👑 عضوية VIP"));
    vipBox.append(node("p","baran-experience-muted",customer.is_vip?"هذا العميل مُميّز بشارة VIP يدوياً من الإدارة.":"يمكنك منح العميل شارة VIP يدوياً لتمييزه في قائمة المستخدمين."));
    const vipButton=node("button","baran-ban-action",customer.is_vip?"إزالة شارة VIP":"منح شارة VIP");
    vipButton.type="button";
    vipButton.addEventListener("click",()=>updateCustomerVip(customer,!customer.is_vip,vipButton,vipBox));
    vipBox.append(vipButton);
    dialog.append(vipBox);
    const info=node("section","baran-profile-section");info.append(node("h4","","بيانات الحساب"));
    [["البريد",customer.email],["الهاتف",customer.phone],["تاريخ التسجيل",date(customer.created_at)],["آخر نشاط",date(customer.last_activity_at||customer.last_sign_in_at||customer.last_order_at)],["آخر طلب",date(customer.last_order_at)],["الرصيد USD",money(customer.balance_usd,"USD")],["الرصيد SYP",money(customer.balance_syp,"SYP")]].forEach(([k,v])=>{
      const row=node("div","baran-profile-row");row.append(node("span","",k),node("strong","",v||"—"));info.append(row);
    });dialog.append(info);
    const orderBox=node("section","baran-profile-section");orderBox.append(node("h4","","سجل الطلبات المحمّل"));
    if(!orders.length)orderBox.append(node("p","baran-experience-muted","لا توجد طلبات لهذا العميل ضمن آخر السجل المحمّل."));
    orders.slice(0,30).forEach(o=>{
      const row=node("div","baran-profile-record");
      const orderSyp=Number(o.total_price_syp||0)/(Number(o.exchange_rate)>1000?100:1);
      row.append(node("strong","","#"+String(o.id||"").slice(0,8)+" · "+(o.product_code||"طلب")),node("span","",o.status||"—"),node("small","",date(o.created_at)+" · "+(o.total_price_usd!=null?money(o.total_price_usd,"USD"):money(orderSyp,"SYP")+" جديدة")));
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
  async function updateCustomerVip(customer,isVip,button,container){
    if(!window.confirm(isVip?"منح هذا العميل شارة VIP؟":"إزالة شارة VIP عن هذا العميل؟"))return;
    button.disabled=true;button.textContent="جارٍ الحفظ...";
    try{
      const {data:{session},error:sessionError}=await sb.auth.getSession();
      if(sessionError||!session)throw new Error("انتهت جلسة المدير.");
      const response=await fetch(SUPABASE_URL+"/functions/v1/baran-admin",{
        method:"POST",
        headers:{"Authorization":"Bearer "+session.access_token,"apikey":SUPABASE_KEY,"Content-Type":"application/json"},
        body:JSON.stringify({action:"customer_vip_update",target_user_id:customer.id,is_vip:isVip})
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok||result.success!==true)throw new Error(result.error||"تعذر تحديث شارة VIP.");
      customer.is_vip=isVip;
      const sources=[...(Array.isArray(current?.customers)?current.customers:[]),...(Array.isArray(window.baranCustomerDirectory)?window.baranCustomerDirectory:[])];
      sources.forEach(item=>{if(String(item.id||item.user_id||"")===String(customer.id))item.is_vip=isVip;});
      container.querySelector("p").textContent=isVip?"هذا العميل مُميّز بشارة VIP يدوياً من الإدارة.":"يمكنك منح العميل شارة VIP يدوياً لتمييزه في قائمة المستخدمين.";
      button.textContent=isVip?"إزالة شارة VIP":"منح شارة VIP";
      button.disabled=false;
      attachProfileButtons();
      window.alert(isVip?"تم منح شارة VIP.":"تمت إزالة شارة VIP.");
    }catch(error){button.disabled=false;button.textContent=customer.is_vip?"إزالة شارة VIP":"منح شارة VIP";window.alert(error.message||"تعذر تحديث الشارة.");}
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
