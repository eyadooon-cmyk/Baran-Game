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
  if(!box||!currentUser)return;
  try{
    const {data,error}=await sb.from("baran_notifications")
      .select("id,kind,title,body,entity_type,entity_id,read_at,created_at")
      .eq("recipient_id",currentUser.id)
      .eq("audience","customer")
      .order("created_at",{ascending:false})
      .limit(30);
    if(error)throw error;
    const items=data||[];
    const unread=items.filter(item=>!item.read_at);
    const badge=document.getElementById("notificationCount");
    if(badge){
      badge.textContent=unread.length>99?"99+":String(unread.length);
      badge.classList.toggle("hidden",unread.length===0);
    }
    box.replaceChildren();
    const heading=document.createElement("div");
    heading.className="notification-heading";
    const title=document.createElement("strong");title.textContent="🔔 إشعاراتك";
    const markAll=document.createElement("button");markAll.type="button";markAll.className="secondary";
    markAll.textContent=unread.length?"قراءة الكل":"محدّثة";
    markAll.disabled=!unread.length;
    markAll.onclick=async()=>{
      markAll.disabled=true;
      const {error:readError}=await sb.rpc("mark_baran_notifications_read",{p_ids:unread.map(item=>item.id)});
      if(readError){markAll.disabled=false;alert("تعذر تحديث الإشعارات.");return;}
      await loadMyNotifications();
    };
    heading.append(title,markAll);box.appendChild(heading);
    if(!items.length){
      const empty=document.createElement("p");empty.className="small";empty.textContent="ما عندك إشعارات حالياً. رح تظهر هون تحديثات الطلبات والإيداعات وتذاكر الدعم.";
      box.appendChild(empty);return;
    }
    items.forEach(item=>{
      const card=document.createElement("div");card.className="notification-item notification-clickable"+(item.read_at?"":" unread");
      card.tabIndex=0;card.setAttribute("role","button");card.onclick=()=>openBaranNotificationTarget(item,"customer");
      card.onkeydown=event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();openBaranNotificationTarget(item,"customer");}};
      const name=document.createElement("strong");name.textContent=item.title;
      const body=document.createElement("p");body.textContent=item.body;
      const date=document.createElement("div");date.className="small";date.textContent=new Date(item.created_at).toLocaleString("ar");
      card.append(name,body,date);
      if(!item.read_at){
        const read=document.createElement("button");read.type="button";read.className="secondary";read.textContent="تحديد كمقروء";
        read.onclick=async(event)=>{
          event.stopPropagation();read.disabled=true;
          const {error:readError}=await sb.rpc("mark_baran_notifications_read",{p_ids:[item.id]});
          if(readError){read.disabled=false;alert("تعذر تحديث الإشعار.");return;}
          await loadMyNotifications();
        };
        card.appendChild(read);
      }
      box.appendChild(card);
    });
  }catch(error){
    box.textContent="تعذر تحميل الإشعارات حالياً.";
  }
}

async function openBaranNotificationTarget(item,audience){
  if(!item)return;
  const isAdmin=audience==="admin";
  const entityType=String(item.entity_type||"").toLowerCase();
  const kind=String(item.kind||"").toLowerCase();
  const entityId=item.entity_id||null;
  const section=isAdmin?"admin":
    (entityType==="ticket"||kind.includes("support")?"support":
     entityType==="order"||kind.includes("order")?"orders":
     entityType==="deposit_request"||entityType==="wallet"||kind.includes("deposit")||kind.includes("wallet")?"wallet":"account");
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
  if(typeof showSection==="function")showSection(section,null);
  if(isAdmin){
    if(typeof loadAdminPanel==="function")await loadAdminPanel();
  }else if(section==="support"&&typeof loadMyFeedback==="function")await loadMyFeedback();
  else if(section==="orders"&&typeof loadMyOrders==="function")await loadMyOrders();
  const target=isAdmin&&kind.includes("monitor")
    ?(document.getElementById("opsMonitorAlerts")||document.getElementById("opsMonitorStatus"))
    :(entityId?document.querySelector('[data-notification-entity-id="'+entityId+'"]'):null);
  if(target){target.scrollIntoView({behavior:"smooth",block:"center"});target.classList.add("notification-target-highlight");}
  else{const sectionTarget=document.getElementById(section);if(sectionTarget)sectionTarget.scrollIntoView({behavior:"smooth",block:"start"});}
  if(!isAdmin&&typeof loadCustomerNotifications==="function")loadCustomerNotifications();
}

function renderAdminNotifications(items){
  const box=document.getElementById("adminNotifications");
  if(!box)return;
  box.replaceChildren();
  const unread=(items||[]).filter(item=>!item.read_at);
  const badge=document.getElementById("notificationCount");
  if(badge){
    badge.textContent=unread.length>99?"99+":String(unread.length);
    badge.classList.toggle("hidden",unread.length===0);
  }
  const heading=document.createElement("div");heading.className="notification-heading";
  const title=document.createElement("strong");title.textContent="🔔 تنبيهات الإدارة ("+unread.length+" غير مقروء)";
  const refresh=document.createElement("button");refresh.type="button";refresh.className="secondary";refresh.textContent="تحديث";
  refresh.onclick=()=>loadAdminPanel();
  heading.append(title,refresh);box.appendChild(heading);
  if(!items?.length){const empty=document.createElement("p");empty.className="small";empty.textContent="لا توجد تنبيهات جديدة حالياً.";box.appendChild(empty);return;}
  items.forEach(item=>{
    const card=document.createElement("div");card.className="notification-item notification-clickable"+(item.read_at?"":" unread");
    card.tabIndex=0;card.setAttribute("role","button");card.onclick=()=>openBaranNotificationTarget(item,"admin");
    card.onkeydown=event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();openBaranNotificationTarget(item,"admin");}};
    const name=document.createElement("strong");name.textContent=item.title;
    const body=document.createElement("p");body.textContent=item.body;
    const date=document.createElement("div");date.className="small";date.textContent=new Date(item.created_at).toLocaleString("ar");
    card.append(name,body,date);
    if(!item.read_at){
      const read=document.createElement("button");read.type="button";read.className="secondary";read.textContent="تحديد كمقروء";
      read.onclick=async(event)=>{
        event.stopPropagation();read.disabled=true;
        try{await callAdminApi("POST",{action:"notification_read",notification_id:item.id});await loadAdminPanel();}
        catch(error){read.disabled=false;alert("تعذر تحديث التنبيه: "+error.message);}
      };
      card.appendChild(read);
    }
    box.appendChild(card);
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
    if(item.order_id){const order=document.createElement("div");order.className="small";order.textContent="رقم الطلب المرتبط: "+item.order_id;card.appendChild(order);}
    if(item.admin_reply){const previous=document.createElement("p");previous.className="small";previous.textContent="آخر رد محفوظ: "+item.admin_reply;card.appendChild(previous);}
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
    save.onclick=()=>saveAdminFeedback(item.id,status.value,reply.value,save);
    card.appendChild(save);box.appendChild(card);
  });
}

async function saveAdminFeedback(id,status,reply,button){
  if(!confirm("تأكيد حفظ الرد وتحديث حالة الرسالة؟"))return;
  button.disabled=true;
  try{
    await callAdminApi("POST",{action:"feedback_update",feedback_id:id,feedback_status:status,admin_reply:reply});
    await loadAdminPanel();
  }catch(error){
    alert("تعذر تحديث الرسالة: "+error.message);
    button.disabled=false;
  }
}
