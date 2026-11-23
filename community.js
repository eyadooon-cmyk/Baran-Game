const feedbackTypeLabels={review:"تقييم عميل",suggestion:"اقتراح ميزة",support:"طلب دعم"};
const feedbackStatusLabels={pending:"جديد / قيد المراجعة",in_progress:"قيد المعالجة",approved:"تم اعتماد التقييم",rejected:"مرفوض",completed:"تم الحل / الإغلاق"};

let baranNotificationPoll=null;

async function loadCommunity(){
  if(!currentUser)return;
  await Promise.all([loadCompletedOrders(),loadMyFeedback(),loadPublicReviews(),typeof loadCustomerNotifications==="function"?loadCustomerNotifications():loadMyNotifications()]);
  startBaranNotificationPolling();
}

function startBaranNotificationPolling(){
  if(baranNotificationPoll)clearInterval(baranNotificationPoll);
  baranNotificationPoll=setInterval(()=>{
    if(currentUser){if(typeof loadCustomerNotifications==="function")loadCustomerNotifications();else loadMyNotifications();}
  },45000);
}

function stopBaranNotificationPolling(){
  if(baranNotificationPoll)clearInterval(baranNotificationPoll);
  baranNotificationPoll=null;
}

function openCustomerNotifications(){
  const modal=document.getElementById("customerNotificationsModal");
  if(!modal)return;
  modal.classList.remove("hidden");
  if(typeof loadCustomerNotifications==="function")loadCustomerNotifications();
  else loadMyNotifications();
}

async function loadMyNotifications(){
  const box=document.getElementById("myNotifications");
  if(!box)return;
  if(!currentUser){
    box.textContent="سجّل الدخول لعرض إشعاراتك.";
    return;
  }
  box.textContent="جاري تحميل إشعاراتك...";
  const retry=document.createElement("button");
  retry.type="button";
  retry.className="notification-read-action";
  retry.textContent="إعادة المحاولة";
  try{
    // Prevent a stalled network request from leaving the customer-facing loader forever.
    const query=sb.from("baran_notifications")
      .select("id,kind,title,body,entity_type,entity_id,read_at,created_at")
      .eq("recipient_id",currentUser.id).eq("audience","customer")
      .order("created_at",{ascending:false}).limit(30);
    const timeout=new Promise((_,reject)=>window.setTimeout(()=>reject(new Error("انتهت مهلة الاتصال")),12000));
    const {data,error}=await Promise.race([query,timeout]);
    if(error)throw error;
    const items=data||[],unread=items.filter(item=>!item.read_at);
    const badge=document.getElementById("notificationCount");
    if(badge){badge.textContent=unread.length>99?"99+":String(unread.length);badge.classList.toggle("hidden",unread.length===0);}
    box.replaceChildren();
    const heading=document.createElement("div");heading.className="notification-heading";
    const title=document.createElement("strong");title.textContent="آخر التحديثات";
    const markAll=document.createElement("button");markAll.type="button";markAll.className="notification-read-action";
    markAll.textContent=unread.length?"قراءة الكل":"محدّثة";markAll.disabled=!unread.length;
    markAll.onclick=async()=>{
      markAll.disabled=true;
      try{
        const {error:readError}=await sb.rpc("mark_baran_notifications_read",{p_ids:unread.map(item=>item.id)});
        if(readError)throw readError;
        await loadMyNotifications();
      }catch(readError){
        markAll.disabled=false;
        alert("تعذر تحديث الإشعارات. حاول مرة أخرى.");
      }
    };
    heading.append(title,markAll);box.appendChild(heading);
    if(!items.length){
      const empty=document.createElement("div");empty.className="notification-empty-state";
      const icon=document.createElement("span");icon.textContent="✦";
      const label=document.createElement("strong");label.textContent="أنت على اطلاع";
      const copy=document.createElement("p");copy.textContent="رح تظهر هون تحديثات الطلبات والإيداعات ورسائل الدعم.";
      empty.append(icon,label,copy);box.appendChild(empty);return;
    }
    items.forEach(item=>{
      if(typeof buildBaranNotificationCard==="function"){
        box.appendChild(buildBaranNotificationCard(item,"customer"));
        return;
      }
      const card=document.createElement("article");card.className="notification-item notification-clickable"+(item.read_at?"":" unread");
      card.tabIndex=0;card.setAttribute("role","button");card.onclick=()=>openBaranNotificationTarget(item,"customer");
      const name=document.createElement("strong");name.textContent=item.title||"إشعار من Baran Game";
      const body=document.createElement("p");body.textContent=item.body||"";
      const date=document.createElement("time");date.textContent=new Date(item.created_at).toLocaleString("ar");
      card.append(name,body,date);box.appendChild(card);
    });
  }catch(error){
    console.warn("تعذر تحميل إشعارات الزبون:",error);
    box.replaceChildren();
    const message=document.createElement("div");message.className="notification-load-error";
    message.textContent=error?.message==="انتهت مهلة الاتصال"
      ?"استغرق تحميل الإشعارات وقتاً أطول من المعتاد. تحقق من الاتصال وحاول مجدداً."
      :"تعذر تحميل الإشعارات حالياً. حاول مرة أخرى.";
    retry.onclick=()=>loadMyNotifications();
    box.append(message,retry);
  }
}

async function openBaranNotificationTarget(item,audience){
  if(!item)return;
  // Close the notification overlay synchronously, before any awaited read or navigation work.
  if(typeof closeCustomerNotifications==="function")closeCustomerNotifications(false);
  const notificationModal=document.getElementById("customerNotificationsModal");
  if(notificationModal){
    notificationModal.classList.add("hidden");
    notificationModal.inert=true;
    notificationModal.setAttribute("aria-hidden","true");
  }
  document.body.classList.remove("baran-notifications-open");
  const isAdmin=audience==="admin";
  const entityType=String(item.entity_type||"").trim().toLowerCase();
  const kind=String(item.kind||"").trim().toLowerCase();
  const entityId=item.entity_id||null;
  // Notification producers may use different entity/kind labels; inspect the visible
  // title and body too, so support alerts never fall through to the generic admin hub.
  const notificationText=[entityType,kind,item.title,item.body].filter(Boolean).join(" ").toLowerCase();
  const isSupportTarget=
    /support|ticket|feedback|customer.?message|reply|رسالة|دعم|تذكرة|شكوى|استفسار/.test(notificationText) ||
    entityType.includes("ticket") || entityType.includes("feedback");
  const isDepositTarget=["deposit","deposit_request","wallet","wallet_transaction","wallet_transactions"].includes(entityType)||
    /deposit|wallet|payment|transfer|إيداع|محفظة|حوالة|دفع|رصيد/.test(notificationText);
  const isOrderTarget=["order","orders"].includes(entityType)||/order|top.?up|purchase|طلب|شحن|شراء/.test(notificationText);
  const section=isAdmin?"admin":
    (isSupportTarget?"support":isOrderTarget?"orders":isDepositTarget?"wallet":
     entityType==="leo_manual_order"?"baroManual":"account");
  if(!item.read_at){
    try{
      if(isAdmin)await callAdminApi("POST",{action:"notification_read",notification_id:item.id});
      else{
        const {error}=await sb.rpc("baran_mark_notification_read",{p_notification_id:item.id});
        if(error)throw error;
      }
      item.read_at=new Date().toISOString();
    }catch(error){console.warn("تعذر تعليم الإشعار كمقروء:",error);}
  }
  // Dedicated admin deposit route: open the deposits review screen, not the generic admin hub.
  if(isAdmin&&isDepositTarget){
    if(typeof showSection==="function")showSection("admin",null);
    const adminRoot=document.getElementById("admin");
    if(adminRoot)adminRoot.classList.remove("hidden");
    if(typeof showAdminPanel==="function")await showAdminPanel("security");
    if(typeof switchSecurityDepositTab==="function")switchSecurityDepositTab("deposits");
    if(typeof loadAdminPanel==="function")await loadAdminPanel();
    const requests=document.getElementById("adminRequests");
    const exact=entityId&&requests?requests.querySelector('[data-notification-entity-id="'+CSS.escape(String(entityId))+'"]'):null;
    const destination=exact||requests||document.getElementById("securityDepositsView");
    if(destination){
      destination.scrollIntoView({behavior:"smooth",block:"start"});
      destination.classList.add("notification-target-highlight");
    }
    return;
  }

  // Dedicated admin BARO route: load the manual-order workspace and focus the exact order.
  if(isAdmin&&entityType==="leo_manual_order"){
    if(typeof showSection==="function")showSection("admin",null);
    const adminRoot=document.getElementById("admin");
    if(adminRoot)adminRoot.classList.remove("hidden");
    if(typeof showAdminPanel==="function")await showAdminPanel("baro-orders");
    const ordersList=document.getElementById("baroAdminOrders");
    const exact=entityId&&ordersList
      ?ordersList.querySelector('[data-notification-entity-id="'+CSS.escape(String(entityId))+'"]')
      :null;
    const destination=exact||ordersList;
    if(destination){
      destination.scrollIntoView({behavior:"smooth",block:"center"});
      destination.classList.add("notification-target-highlight");
    }
    return;
  }

  // Dedicated admin support route: never let a support alert fall through to the generic admin dashboard.
  if(isAdmin&&isSupportTarget){
    if(typeof showSection==="function")showSection("admin",null);
    const adminRoot=document.getElementById("admin");
    if(adminRoot)adminRoot.classList.remove("hidden");
    let panelReady=false;
    if(typeof showAdminPanel==="function"){
      await showAdminPanel("support");
      panelReady=true;
    }
    if(!panelReady){
      const hub=document.getElementById("adminHub");
      if(hub)hub.classList.add("hidden");
      adminRoot?.querySelectorAll(".admin-subpanel").forEach(panel=>{
        panel.classList.toggle("hidden",panel.dataset.adminPanel!=="support");
      });
      if(typeof loadAdminPanel==="function")await loadAdminPanel();
    }
    if(typeof switchSupportTab==="function")switchSupportTab("tickets");
    const typeFilter=document.getElementById("adminFeedbackTypeFilter");
    const statusFilter=document.getElementById("adminFeedbackStatusFilter");
    const searchInput=document.getElementById("adminFeedbackSearch");
    if(typeFilter)typeFilter.value="support";
    if(statusFilter)statusFilter.value="all";
    if(searchInput)searchInput.value="";
    if(typeof filterAdminFeedback==="function")filterAdminFeedback();
    const ticketId=entityId?String(entityId):"";
    if(ticketId&&typeof openSupportConversation==="function"){
      try{
        await openSupportConversation(ticketId,"admin");
      }catch(error){
        console.warn("تعذر تحميل محادثة إشعار الدعم:",error);
        const box=document.getElementById("adminSupportConversation");
        const messages=document.getElementById("adminSupportConversationMessages");
        if(box)box.classList.remove("hidden");
        if(messages)messages.textContent="وصلنا إلى قسم الدعم، لكن تعذر تحميل هذه المحادثة. افتح التذكرة من القائمة وحاول مجدداً.";
      }
    }
    const conversation=document.getElementById("adminSupportConversation");
    const inbox=document.getElementById("supportTicketsView");
    const destination=conversation&&!conversation.classList.contains("hidden")?conversation:inbox;
    if(destination){
      destination.scrollIntoView({behavior:"smooth",block:"start"});
      destination.classList.add("notification-target-highlight");
    }
    return;
  }

  if(typeof showSection==="function")showSection(section,null);
  if(isAdmin){
    if(typeof loadAdminPanel==="function")await loadAdminPanel();
  }else if(section==="support"&&typeof loadMyFeedback==="function")await loadMyFeedback();
  else if(section==="orders"&&typeof loadMyOrders==="function")await loadMyOrders();
  else if(section==="wallet"){
    if(typeof loadDepositRequests==="function")await loadDepositRequests();
    else if(typeof loadWalletTransactions==="function")await loadWalletTransactions();
  }
  if(isSupportTarget&&entityId&&typeof openSupportConversation==="function"){
    try{await openSupportConversation(String(entityId),isAdmin?"admin":"customer");}
    catch(error){console.warn("تعذر فتح محادثة الدعم من الإشعار:",error);}
  }
  const target=isSupportTarget
    ?(entityId?document.getElementById(isAdmin?"adminSupportConversation":"customerSupportConversation")
      :(isAdmin?(document.getElementById("supportTicketsView")||document.getElementById("adminFeedback")):null))
    :isAdmin&&kind.includes("monitor")
      ?(document.getElementById("opsMonitorAlerts")||document.getElementById("opsMonitorStatus"))
      :(entityId?Array.from(document.querySelectorAll("[data-notification-entity-id]")).find(node=>node.dataset.notificationEntityId===String(entityId)):null);
  if(target){
    target.scrollIntoView({behavior:"smooth",block:"center"});
    target.classList.add("notification-target-highlight");
  }else{
    const sectionTarget=document.getElementById(section);
    if(sectionTarget)sectionTarget.scrollIntoView({behavior:"smooth",block:"start"});
  }
  if(!isAdmin&&typeof loadCustomerNotifications==="function")loadCustomerNotifications();
}

function renderAdminNotifications(items){
  const box=document.getElementById("adminNotifications");
  if(!box)return;
  box.replaceChildren();
  // The admin bell is an alert inbox, not a notification archive: show only unread items.
  const list=Array.isArray(items)?items.filter(item=>!item.read_at):[];
  const summary=document.createElement("div");summary.className="notification-admin-summary";
  const pending=document.createElement("span");pending.textContent="تنبيهات جديدة تحتاج انتباهك: "+list.length;
  summary.appendChild(pending);box.appendChild(summary);
  if(!list.length){
    const empty=document.createElement("div");empty.className="notification-empty-state";
    const icon=document.createElement("span");icon.textContent="✦";
    const title=document.createElement("strong");title.textContent="كل شيء هادئ";
    const copy=document.createElement("p");copy.textContent="لا توجد تنبيهات إدارية جديدة حالياً.";
    empty.append(icon,title,copy);box.appendChild(empty);return;
  }
  list.forEach(item=>{
    if(typeof buildBaranNotificationCard==="function"){box.appendChild(buildBaranNotificationCard(item,"admin"));return;}
    const card=document.createElement("article");card.className="notification-item notification-clickable"+(item.read_at?"":" unread");
    card.tabIndex=0;card.setAttribute("role","button");card.onclick=()=>openBaranNotificationTarget(item,"admin");
    const title=document.createElement("strong");title.textContent=item.title||"تنبيه إداري";
    const body=document.createElement("p");body.textContent=item.body||"";
    const date=document.createElement("time");date.textContent=new Date(item.created_at).toLocaleString("ar");
    card.append(title,body,date);box.appendChild(card);
  });
}

async function loadPublicReviews(){
  const box=document.getElementById("publicReviews");
  if(!box)return;
  box.textContent="جاري تحميل التقييمات المنشورة...";
  try{
    const {data,error}=await sb.from("customer_feedback")
      .select("rating,message,created_at")
      .eq("feedback_type","review")
      .eq("status","approved")
      .order("created_at",{ascending:false})
      .limit(20);
    if(error)throw error;
    box.replaceChildren();
    if(!data?.length){box.textContent="لا توجد تقييمات منشورة بعد. كن أول من يشارك تجربته بعد اكتمال طلبه.";return;}
    data.forEach(item=>{
      const card=document.createElement("div");card.className="deposit-row";
      const stars=document.createElement("strong");stars.textContent="★".repeat(Number(item.rating))+"☆".repeat(5-Number(item.rating));
      const message=document.createElement("p");message.textContent=item.message;
      const date=document.createElement("div");date.className="small";date.textContent=new Date(item.created_at).toLocaleDateString("ar");
      card.append(stars,message,date);box.appendChild(card);
    });
  }catch(error){box.textContent="تعذر تحميل التقييمات: "+error.message;}
}

async function loadCompletedOrders(){
  const select=document.getElementById("reviewOrder");
  const note=document.getElementById("reviewAvailability");
  const button=document.getElementById("reviewSubmitButton");
  if(!select||!note||!button)return;
  select.replaceChildren();
  const initial=document.createElement("option");
  initial.value="";initial.textContent="اختر طلباً مكتملاً";select.appendChild(initial);
  try{
    const {data,error}=await sb.from("orders")
      .select("id,product_code,created_at,status")
      .eq("user_id",currentUser.id)
      .in("status",["completed","fulfilled","delivered"])
      .order("created_at",{ascending:false})
      .limit(50);
    if(error)throw error;
    (data||[]).forEach(order=>{
      const option=document.createElement("option");
      option.value=order.id;
      option.textContent=order.product_code+" — "+new Date(order.created_at).toLocaleDateString("ar");
      select.appendChild(option);
    });
    const hasOrders=(data||[]).length>0;
    button.disabled=!hasOrders;
    note.textContent=hasOrders
      ?"يمكنك تقييم كل طلب مكتمل مرة واحدة. التقييم يظهر بعد مراجعته."
      :"لا توجد طلبات مكتملة مؤهلة للتقييم حالياً. سيُفتح التقييم بعد اكتمال أول طلب.";
  }catch(error){
    button.disabled=true;
    note.textContent="تعذر تحميل الطلبات المكتملة: "+error.message;
  }
}

async function submitCustomerFeedback(type){
  if(!currentUser)return;
  const configs={
    review:{subject:null,messageId:"reviewMessage",statusId:"reviewMessageStatus",buttonId:"reviewSubmitButton"},
    suggestion:{subjectId:"suggestionSubject",messageId:"suggestionMessage",statusId:"suggestionMessageStatus",buttonId:"suggestionSubmitButton"},
    support:{subjectId:"supportSubject",messageId:"supportMessage",statusId:"supportMessageStatus",buttonId:"supportSubmitButton"}
  };
  const config=configs[type];
  if(!config)return;
  const message=document.getElementById(config.messageId).value.trim();
  const status=document.getElementById(config.statusId);
  const button=document.getElementById(config.buttonId);
  const subject=config.subjectId?document.getElementById(config.subjectId).value.trim():null;
  if(message.length<10){status.textContent="اكتب تفاصيل أوضح (10 أحرف على الأقل).";return;}
  if(subject!==null&&subject.length<3){status.textContent="اكتب عنواناً من 3 أحرف على الأقل.";return;}
  const payload={user_id:currentUser.id,feedback_type:type,message,status:"pending"};
  if(type==="review"){
    const orderId=document.getElementById("reviewOrder").value;
    if(!orderId){status.textContent="التقييم متاح فقط بعد اكتمال طلب.";return;}
    payload.order_id=orderId;
    payload.rating=Number(document.getElementById("reviewRating").value);
  }else{
    payload.subject=subject;
  }
  button.disabled=true;status.textContent="جاري إرسال رسالتك...";
  try{
    const {error}=await sb.from("customer_feedback").insert(payload);
    if(error)throw error;
    document.getElementById(config.messageId).value="";
    if(config.subjectId)document.getElementById(config.subjectId).value="";
    status.textContent=type==="review"
      ?"وصل تقييمك، وسيظهر بعد المراجعة."
      :type==="suggestion"?"وصل اقتراحك، شكراً لمساعدتنا على التطوير.":"وصلت رسالتك إلى الدعم.";
    await loadMyFeedback();
    if(type==="review")await loadCompletedOrders();
  }catch(error){
    if(error.code==="23505")status.textContent="سبق أن قيّمت هذا الطلب.";
    else status.textContent="تعذر إرسال الرسالة: "+error.message;
  }finally{button.disabled=false;}
}

async function loadMyFeedback(){
  const box=document.getElementById("myFeedbackList");
  if(!box||!currentUser)return;
  box.textContent="جاري تحميل رسائلك...";
  try{
    const {data,error}=await sb.from("customer_feedback")
      .select("id,feedback_type,ticket_code,subject,message,rating,status,admin_reply,created_at")
      .eq("user_id",currentUser.id)
      .order("created_at",{ascending:false})
      .limit(30);
    if(error)throw error;
    box.replaceChildren();
    if(!data?.length){box.textContent="ما أرسلت أي تقييم أو اقتراح أو رسالة دعم بعد.";return;}
    data.forEach(item=>{
      const card=document.createElement("div");card.className="deposit-row";card.dataset.notificationEntityId=item.id;
      const title=document.createElement("strong");
      title.textContent=(feedbackTypeLabels[item.feedback_type]||item.feedback_type)+(item.feedback_type==="support"&&item.ticket_code?" — "+item.ticket_code:"");
      const details=document.createElement("p");
      details.textContent=(item.subject?item.subject+" — ":"")+
        (item.rating?"التقييم: "+item.rating+"/5 — ":"")+
        item.message+" | الحالة: "+(feedbackStatusLabels[item.status]||item.status);
      card.append(title,details);
      if(item.feedback_type==="support"){
        const chat=document.createElement("button");chat.type="button";chat.className="full support-open-chat";
        chat.textContent="💬 فتح محادثة الدعم";
        chat.onclick=()=>openSupportConversation(item.id,"customer");
        card.appendChild(chat);
      }
      if(item.admin_reply){
        const reply=document.createElement("p");reply.className="small";reply.textContent="رد الإدارة: "+item.admin_reply;card.appendChild(reply);
      }
      const date=document.createElement("div");date.className="small";date.textContent=new Date(item.created_at).toLocaleString("ar");card.appendChild(date);
      box.appendChild(card);
    });
  }catch(error){box.textContent="تعذر تحميل رسائلك: "+error.message;}
}

function renderAdminFeedback(items){
  const box=document.getElementById("adminFeedback");
  if(!box)return;
  box.replaceChildren();
  const rows=[...(items||[])].sort((a,b)=>{
    const rank=x=>x.feedback_type==="support"&&["pending","in_progress"].includes(x.status)?0:
      x.feedback_type==="suggestion"&&["pending","in_progress"].includes(x.status)?1:2;
    return rank(a)-rank(b)||new Date(b.created_at)-new Date(a.created_at);
  });
  const openTickets=rows.filter(x=>x.feedback_type==="support"&&["pending","in_progress"].includes(x.status)).length;
  const summary=document.createElement("div");
  summary.className="ops-item";
  summary.textContent="تذاكر الدعم المفتوحة: "+openTickets+" | إجمالي الرسائل: "+rows.length+
    " — تظهر الحالات المفتوحة أولاً.";
  box.appendChild(summary);
  if(!rows.length){box.appendChild(document.createTextNode("لا توجد آراء أو اقتراحات أو رسائل دعم بعد."));return;}
  rows.forEach(item=>{
    const card=document.createElement("div");card.className="admin-request";card.dataset.notificationEntityId=item.id;
    const title=document.createElement("strong");
    title.textContent=(feedbackTypeLabels[item.feedback_type]||item.feedback_type)+
      (item.feedback_type==="support"&&item.ticket_code?" — "+item.ticket_code:"")+" — "+(item.customer_email||item.user_id);
    const body=document.createElement("p");
    body.textContent=(item.subject?item.subject+" | ":"")+
      (item.rating?"التقييم: "+item.rating+"/5 | ":"")+
      item.message+" | الحالة: "+(feedbackStatusLabels[item.status]||item.status)+
      " | "+new Date(item.created_at).toLocaleString("ar");
    card.append(title,body);
    if(item.feedback_type==="support"){
      card.dataset.feedbackId=item.id;
      const chat=document.createElement("button");chat.type="button";chat.className="full support-open-chat";
      chat.textContent="💬 فتح المحادثة الكاملة";
      chat.onclick=()=>openSupportConversation(item.id,"admin");
      card.appendChild(chat);
    }
    if(item.order_id){const order=document.createElement("div");order.className="small";order.textContent="رقم الطلب المرتبط: "+item.order_id;card.appendChild(order);}
    if(item.admin_reply){const previous=document.createElement("p");previous.className="small";previous.textContent="آخر رد محفوظ: "+item.admin_reply;card.appendChild(previous);}
    if(item.feedback_type==="support"&&!item.admin_read_at){
      const readButton=document.createElement("button");
      readButton.type="button";readButton.className="full secondary";
      readButton.textContent="✓ تحديد التذكرة كمقروءة";
      readButton.onclick=()=>markAdminFeedbackRead(item.id,readButton);
      card.appendChild(readButton);
    }
    const replyLabel=document.createElement("label");replyLabel.textContent="الرد الذي سيصل للزبون كإشعار داخل المتجر";card.appendChild(replyLabel);
    const reply=document.createElement("textarea");reply.rows=3;reply.maxLength=2000;reply.placeholder="اكتب رداً واضحاً للزبون";reply.value=item.admin_reply||"";card.appendChild(reply);
    const statusLabel=document.createElement("label");statusLabel.textContent="حالة التذكرة";card.appendChild(statusLabel);
    const status=document.createElement("select");
    const choices=item.feedback_type==="review"
      ?[["approved","اعتماد التقييم"],["rejected","رفض التقييم"]]
      :[["pending","جديدة / قيد المراجعة"],["in_progress","قيد المعالجة"],["completed","تم الحل / الإغلاق"],["rejected","مرفوضة"]];
    choices.forEach(([value,label])=>{const option=document.createElement("option");option.value=value;option.textContent=label;status.appendChild(option);});
    status.value=item.status;
    card.appendChild(status);
    if(item.feedback_type==="support"){
      const analyze=document.createElement("button");
      analyze.type="button";analyze.className="full secondary";
      analyze.textContent="🧠 حلّل هذه التذكرة بالمساعد الإداري";
      analyze.onclick=()=>{
        const code=item.ticket_code||item.id;
        if(typeof askBaranAdminPrompt!=="function"){alert("مساعد الإدارة غير متاح حالياً.");return;}
        askBaranAdminPrompt("راجع تذكرة الدعم المحددة رقم "+code+" من بيانات التذاكر المحمّلة لديك. اعرض المشكلة كما كتبها الزبون، صنّفها وحدد الأولوية وسببها، اذكر المعلومات الناقصة وخطوات التشخيص، ثم اكتب مسودة رد مناسبة باللهجة الشامية. لا ترسل الرد ولا تغيّر الحالة.");
        const assistant=document.getElementById("baranAdminAssistant");
        if(assistant)assistant.scrollIntoView({behavior:"smooth",block:"start"});
      };
      card.appendChild(analyze);
    }
    const save=document.createElement("button");save.type="button";save.className="full";save.textContent="حفظ الرد والحالة وإشعار الزبون";
    save.onclick=()=>saveAdminFeedback(item.id,status.value,reply.value,save,item.feedback_type);
    card.appendChild(save);box.appendChild(card);
  });
}

async function markAdminFeedbackRead(id,button){
  if(button)button.disabled=true;
  try{
    await callAdminApi("POST",{action:"feedback_mark_read",feedback_id:id});
    await loadAdminPanel();
  }catch(error){
    if(button)button.disabled=false;
    alert("تعذر تحديد التذكرة كمقروءة: "+error.message);
  }
}
async function saveAdminFeedback(id,status,reply,button,feedbackType){
  if(!confirm("تأكيد حفظ الرد وتحديث حالة الرسالة؟"))return;
  button.disabled=true;
  try{
    await callAdminApi("POST",{action:"feedback_update",feedback_id:id,feedback_status:status,admin_reply:reply});
    if(feedbackType==="support"){
      try{await callAdminApi("POST",{action:"feedback_mark_read",feedback_id:id});}
      catch(readError){console.warn("تم حفظ رد الدعم لكن تعذر تحديث علامة القراءة:",readError);}
    }
    await loadAdminPanel();
  }catch(error){
    alert("تعذر تحديث الرسالة: "+error.message);
    button.disabled=false;
  }
}

/* Unified ticket conversation center — all access is mediated by the authenticated Edge Function. */
let activeSupportConversation={id:null,audience:null};
async function supportCenterRequest(method,ticketId,payload){
  const {data:{session},error:sessionError}=await sb.auth.getSession();
  if(sessionError||!session)throw new Error("انتهت الجلسة. سجّل الدخول مجدداً.");
  const endpoint=SUPABASE_URL+"/functions/v1/baran-support-center";
  const url=method==="GET"?endpoint+"?ticket_id="+encodeURIComponent(ticketId):endpoint;
  const response=await fetch(url,{method,headers:{
    "Authorization":"Bearer "+session.access_token,"apikey":SUPABASE_KEY,"Content-Type":"application/json"
  },body:method==="GET"?undefined:JSON.stringify(payload||{})});
  let result={};try{result=await response.json();}catch(_){}
  if(!response.ok)throw new Error(result.error||"تعذر الاتصال بمركز الدعم.");
  return result;
}
function closeSupportConversation(audience){
  const box=document.getElementById(audience==="admin"?"adminSupportConversation":"customerSupportConversation");
  if(box)box.classList.add("hidden");
  if(activeSupportConversation.audience===audience)activeSupportConversation={id:null,audience:null};
}
function renderSupportConversation(data,audience){
  const prefix=audience==="admin"?"admin":"customer";
  const title=document.getElementById(prefix+"SupportConversationTitle");
  const meta=document.getElementById(prefix+"SupportConversationMeta");
  const list=document.getElementById(prefix+"SupportConversationMessages");
  if(!title||!meta||!list)return;
  const ticket=data.ticket||{};
  title.textContent=(ticket.ticket_code||"تذكرة الدعم")+" — "+(ticket.subject||"محادثة الدعم");
  const statusLabels={pending:"بانتظار الرد",in_progress:"قيد المعالجة",completed:"مكتملة",rejected:"مغلقة"};
  meta.textContent="الحالة: "+(statusLabels[ticket.status]||ticket.status||"—")+
    (data.customer?( " · الزبون: "+(data.customer.full_name||data.customer.email||"حساب زبون")):"")+
    (ticket.order_id?" · طلب مرتبط: "+ticket.order_id:"");
  list.replaceChildren();
  const messages=Array.isArray(data.messages)?data.messages:[];
  if(!messages.length){const empty=document.createElement("p");empty.className="small";empty.textContent="لا توجد رسائل بعد.";list.appendChild(empty);}
  messages.forEach(item=>{
    const bubble=document.createElement("article");bubble.className="support-message "+(item.sender_role||"system");
    const content=document.createElement("div");content.textContent=item.message||"";
    bubble.appendChild(content);
    if(item.attachment_url){
      const attachment=document.createElement("a");attachment.className="support-message-attachment";
      attachment.href=item.attachment_url;attachment.target="_blank";attachment.rel="noopener noreferrer";
      attachment.textContent=(item.attachment_mime||"").startsWith("image/")?"عرض الصورة المرفقة":"عرض الملف المرفق";
      if((item.attachment_mime||"").startsWith("image/")){
        const image=document.createElement("img");image.src=item.attachment_url;image.alt="مرفق من المحادثة";
        image.loading="lazy";image.className="support-message-attachment-image";attachment.appendChild(image);
      }else{attachment.textContent="📎 "+(item.attachment_name||"ملف مرفق")+" · فتح الملف";}
      bubble.appendChild(attachment);
    }
    if(!document.getElementById("baran-admin-message-name-style")){
      const style=document.createElement("style");style.id="baran-admin-message-name-style";
      style.textContent=".support-message-admin-name{display:inline-flex;align-items:center;gap:5px;margin:0 0 8px;padding:4px 9px;border:1px solid rgba(225,190,119,.62);border-radius:999px;background:linear-gradient(110deg,#4b2d61,#302039);color:#f5d99a;font-size:11px;font-weight:900;letter-spacing:.1px;box-shadow:0 2px 10px #0003}.support-message.admin .support-message-admin-name{background:linear-gradient(110deg,#5a3972,#302039);border-color:#d2a85d}.support-message.admin{border-color:#9870ad}";
      document.head.appendChild(style);
    }
    if(item.sender_role==="admin"){
      const adminName=document.createElement("div");adminName.className="support-message-admin-name";
      adminName.textContent="✦ مدير BARAN GAME";
      bubble.appendChild(adminName);
    }
    const stamp=document.createElement("time");stamp.className="support-message-meta";
    const role=item.sender_role==="customer"?"الزبون":item.sender_role==="assistant"?"مساعد باران":item.sender_role==="admin"?"المدير":"النظام";
    const receipt=item.sender_role===(audience==="admin"?"admin":"customer")?(item.read_at?" · قُرئت":" · تم الإرسال"):"";
    stamp.textContent=role+" · "+(item.created_at?new Date(item.created_at).toLocaleString("ar"):"")+receipt;
    bubble.appendChild(stamp);list.appendChild(bubble);
  });
  list.scrollTop=list.scrollHeight;
  if(audience==="admin"){
    const status=document.getElementById("adminSupportConversationStatus");
    if(status)status.value=ticket.status||"pending";
    const priority=document.getElementById("adminSupportConversationPriority");
    if(priority)priority.value=ticket.priority||"normal";
    const attachmentToggle=document.getElementById("adminSupportAttachmentsEnabled");
    if(attachmentToggle)attachmentToggle.checked=ticket.attachments_enabled===true;
    const adminAttachmentWrap=document.getElementById("adminSupportAttachmentControls");
    if(adminAttachmentWrap)adminAttachmentWrap.hidden=ticket.attachments_enabled!==true;
    const customerAttachmentWrap=document.getElementById("customerSupportAttachmentControls");
    if(customerAttachmentWrap)customerAttachmentWrap.hidden=true;
    const assignee=document.getElementById("adminSupportConversationAssignee");
    if(assignee){
      const staff=Array.isArray(data.staff)?data.staff:[];
      const selected=ticket.assigned_admin_id||"";
      assignee.replaceChildren();
      const unassigned=document.createElement("option");unassigned.value="";unassigned.textContent="غير مسندة";assignee.appendChild(unassigned);
      staff.forEach(member=>{const option=document.createElement("option");option.value=member.user_id;option.textContent=member.full_name||("موظف "+member.user_id.slice(0,8));assignee.appendChild(option);});
      assignee.value=selected;
    }
  }else{
    const customerAttachmentWrap=document.getElementById("customerSupportAttachmentControls");
    if(customerAttachmentWrap)customerAttachmentWrap.hidden=ticket.attachments_enabled!==true;
  }
}
async function updateSupportTicketMeta(){
  if(!activeSupportConversation.id||activeSupportConversation.audience!=="admin")return;
  const status=document.getElementById("adminSupportConversationStatus")?.value||"pending";
  const priority=document.getElementById("adminSupportConversationPriority")?.value||"normal";
  const assigned=document.getElementById("adminSupportConversationAssignee")?.value||"";
  const attachmentsEnabled=document.getElementById("adminSupportAttachmentsEnabled")?.checked===true;
  try{
    await supportCenterRequest("POST",null,{action:"update_ticket",ticket_id:activeSupportConversation.id,status,priority,assigned_admin_id:assigned||null,attachments_enabled:attachmentsEnabled});
    const meta=document.getElementById("adminSupportConversationMeta");
    if(meta)meta.dataset.saved="1";
    await openSupportConversation(activeSupportConversation.id,"admin");
    // Refresh the admin bell immediately so resolved-ticket alerts disappear without waiting for polling.
    if(typeof loadAdminPanel==="function")await loadAdminPanel();
  }catch(error){alert("تعذر تحديث التذكرة: "+error.message);}
}
function ensureSupportComposerExtras(){
  ["customer","admin"].forEach(audience=>{
    const prefix=audience==="admin"?"admin":"customer";
    const form=document.querySelector("#"+prefix+"SupportConversation .support-conversation-compose");
    if(form&&!document.getElementById(prefix+"SupportAttachment")){
      const wrap=document.createElement("div");wrap.id=prefix+"SupportAttachmentControls";wrap.className="support-attachment-controls";wrap.hidden=true;
      const label=document.createElement("label");label.textContent="📎 إرفاق صورة أو PDF (حتى 10MB · 3 ملفات كحد أقصى للتذكرة)";
      label.htmlFor=prefix+"SupportAttachment";
      const file=document.createElement("input");file.type="file";file.id=prefix+"SupportAttachment";
      file.accept="image/jpeg,image/png,image/webp,application/pdf";
      const status=document.createElement("small");status.id=prefix+"SupportAttachmentStatus";status.className="small";status.setAttribute("role","status");
      wrap.append(label,file,status);form.insertBefore(wrap,form.firstChild);
    }
  });
  const tools=document.querySelector("#adminSupportConversation .support-conversation-admin-tools");
  if(tools&&!document.getElementById("adminSupportConversationPriority")){
    const label=document.createElement("label");label.htmlFor="adminSupportConversationPriority";label.textContent="أولوية التذكرة";
    const select=document.createElement("select");select.id="adminSupportConversationPriority";
    [["low","منخفضة"],["normal","عادية"],["high","عالية"],["urgent","عاجلة"]].forEach(([v,t])=>{const o=document.createElement("option");o.value=v;o.textContent=t;select.appendChild(o);});
    select.addEventListener("change",updateSupportTicketMeta);
    tools.append(label,select);
    const assigneeLabel=document.createElement("label");assigneeLabel.htmlFor="adminSupportConversationAssignee";assigneeLabel.textContent="الموظف المسؤول";
    const assignee=document.createElement("select");assignee.id="adminSupportConversationAssignee";
    const unassigned=document.createElement("option");unassigned.value="";unassigned.textContent="غير مسندة";assignee.appendChild(unassigned);
    assignee.addEventListener("change",updateSupportTicketMeta);
    tools.append(assigneeLabel,assignee);
    const attachmentLabel=document.createElement("label");attachmentLabel.htmlFor="adminSupportAttachmentsEnabled";attachmentLabel.textContent="السماح للزبون بإرفاق ملفات";
    const attachmentToggle=document.createElement("input");attachmentToggle.type="checkbox";attachmentToggle.id="adminSupportAttachmentsEnabled";attachmentToggle.checked=false;
    attachmentToggle.addEventListener("change",updateSupportTicketMeta);
    tools.append(attachmentLabel,attachmentToggle);
    const status=document.getElementById("adminSupportConversationStatus");if(status)status.addEventListener("change",updateSupportTicketMeta);
  }
}
document.addEventListener("DOMContentLoaded",ensureSupportComposerExtras);
new MutationObserver(ensureSupportComposerExtras).observe(document.documentElement,{childList:true,subtree:true});
ensureSupportComposerExtras();
async function openSupportConversation(ticketId,audience){
  const prefix=audience==="admin"?"admin":"customer";
  const box=document.getElementById(prefix+"SupportConversation");
  const list=document.getElementById(prefix+"SupportConversationMessages");
  if(!box||!list)throw new Error("واجهة المحادثة غير متاحة.");
  activeSupportConversation={id:String(ticketId),audience};
  box.classList.remove("hidden");list.textContent="جاري تحميل المحادثة...";
  box.scrollIntoView({behavior:"smooth",block:"start"});
  try{
    const data=await supportCenterRequest("GET",ticketId);
    renderSupportConversation(data,audience);
    const input=document.getElementById(prefix+"SupportConversationInput");
    if(input)input.focus({preventScroll:true});
    return data;
  }catch(error){list.textContent="تعذر تحميل المحادثة: "+error.message;throw error;}
}
async function sendSupportConversationMessage(event,audience){
  if(event)event.preventDefault();
  const prefix=audience==="admin"?"admin":"customer";
  const input=document.getElementById(prefix+"SupportConversationInput");
  const button=document.getElementById(prefix+"SupportConversationSend");
  const message=String(input?.value||"").trim();
  const ticketId=activeSupportConversation.id;
  const fileInput=document.getElementById(prefix+"SupportAttachment");
  const file=fileInput?.files?.[0]||null;
  if(!ticketId||activeSupportConversation.audience!==audience){alert("افتح التذكرة أولاً.");return;}
  if(!message&&!file){input?.focus();return;}
  const attachmentWrap=document.getElementById(prefix+"SupportAttachmentControls");
  if(file&&attachmentWrap?.hidden){alert("المرفقات مغلقة لهذه التذكرة حالياً.");return;}
  if(message.length>2000){alert("الرسالة طويلة جداً.");return;}
  if(file){
    const allowed=["image/jpeg","image/png","image/webp","application/pdf"];
    if(!allowed.includes(file.type)){alert("المسموح صور JPG وPNG وWEBP أو PDF فقط.");return;}
    if(file.size>10*1024*1024){alert("حجم الملف الأقصى 10 ميغابايت.");return;}
  }
  if(button)button.disabled=true;
  const sendStatus=document.getElementById(prefix+"SupportAttachmentStatus");
  try{
    const payload={ticket_id:ticketId,message};
    if(audience==="admin")payload.status=document.getElementById("adminSupportConversationStatus")?.value||"in_progress";
    if(file){
      if(sendStatus)sendStatus.textContent="جاري رفع المرفق بأمان...";
      const {data:{session},error:sessionError}=await sb.auth.getSession();
      if(sessionError||!session)throw new Error("انتهت الجلسة. سجّل الدخول مجدداً.");
      const extension=({ "image/jpeg":"jpg","image/png":"png","image/webp":"webp","application/pdf":"pdf" })[file.type];
      const path=ticketId+"/"+session.user.id+"/"+crypto.randomUUID()+"."+extension;
      const {error:uploadError}=await sb.storage.from("baran-support-attachments").upload(path,file,{cacheControl:"3600",upsert:false,contentType:file.type});
      if(uploadError)throw new Error("تعذر رفع المرفق: "+uploadError.message);
      payload.attachment_path=path;payload.attachment_name=file.name;payload.attachment_mime=file.type;payload.attachment_size=file.size;
    }
    await supportCenterRequest("POST",null,payload);
    if(input)input.value="";
    if(fileInput)fileInput.value="";
    if(sendStatus)sendStatus.textContent="";
    await openSupportConversation(ticketId,audience);
    if(audience==="customer")await loadMyFeedback();
  }catch(error){if(sendStatus)sendStatus.textContent="";alert("تعذر إرسال الرسالة: "+error.message);}
  finally{if(button)button.disabled=false;}
}
