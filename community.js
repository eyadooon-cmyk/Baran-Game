const feedbackTypeLabels={review:"تقييم عميل",suggestion:"اقتراح ميزة",support:"طلب دعم"};
const feedbackStatusLabels={pending:"جديد / قيد المراجعة",in_progress:"قيد المعالجة",approved:"تم اعتماد التقييم",rejected:"مرفوض",completed:"تم التنفيذ / الإغلاق"};

async function loadCommunity(){
  if(!currentUser)return;
  await Promise.all([loadCompletedOrders(),loadMyFeedback()]);
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
      .select("id,feedback_type,subject,message,rating,status,admin_reply,created_at")
      .eq("user_id",currentUser.id)
      .order("created_at",{ascending:false})
      .limit(30);
    if(error)throw error;
    box.replaceChildren();
    if(!data?.length){box.textContent="ما أرسلت أي تقييم أو اقتراح أو رسالة دعم بعد.";return;}
    data.forEach(item=>{
      const card=document.createElement("div");card.className="deposit-row";
      const title=document.createElement("strong");
      title.textContent=feedbackTypeLabels[item.feedback_type]||item.feedback_type;
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
  if(!items.length){box.textContent="لا توجد آراء أو اقتراحات أو رسائل دعم بعد.";return;}
  items.forEach(item=>{
    const card=document.createElement("div");card.className="admin-request";
    const title=document.createElement("strong");
    title.textContent=(feedbackTypeLabels[item.feedback_type]||item.feedback_type)+" — "+(item.customer_email||item.user_id);
    const body=document.createElement("p");
    body.textContent=(item.subject?item.subject+" | ":"")+
      (item.rating?"التقييم: "+item.rating+"/5 | ":"")+
      item.message+" | الحالة: "+(feedbackStatusLabels[item.status]||item.status)+
      " | "+new Date(item.created_at).toLocaleString("ar");
    card.append(title,body);
    const replyLabel=document.createElement("label");replyLabel.textContent="رد الإدارة";card.appendChild(replyLabel);
    const reply=document.createElement("textarea");reply.rows=2;reply.maxLength=2000;reply.placeholder="اكتب رداً للعميل";reply.value=item.admin_reply||"";card.appendChild(reply);
    const statusLabel=document.createElement("label");statusLabel.textContent="تحديث الحالة";card.appendChild(statusLabel);
    const status=document.createElement("select");
    const choices=item.feedback_type==="review"
      ?[["approved","اعتماد التقييم"],["rejected","رفض التقييم"]]
      :[["in_progress","قيد المعالجة"],["completed","تم التنفيذ / الإغلاق"],["rejected","رفض"]];
    choices.forEach(([value,label])=>{const option=document.createElement("option");option.value=value;option.textContent=label;status.appendChild(option);});
    if(choices.some(x=>x[0]===item.status))status.value=item.status;
    card.appendChild(status);
    const save=document.createElement("button");save.type="button";save.className="full";save.textContent="حفظ الرد والحالة";
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
