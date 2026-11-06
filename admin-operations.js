let latestBaranOperations=null;

function opsText(value){return value===null||value===undefined||value===""?"—":String(value);}
function opsDate(value){return value?new Date(value).toLocaleString("ar"): "—";}
function opsMoney(value,currency){return Number(value||0).toLocaleString("en-US",{maximumFractionDigits:2})+(currency==="USD"?" $":" ل.س");}
function opsNode(tag,className,text){const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el;}
function opsOption(select,value,label){const o=document.createElement("option");o.value=value;o.textContent=label;select.appendChild(o);}

function renderOpsNotifications(rows){
  const box=document.getElementById("adminNotifications");
  if(!box)return;
  box.replaceChildren();
  const notifications=Array.isArray(rows)?rows:[];
  const unread=notifications.filter(item=>!item.read_at).length;
  const heading=opsNode("div","ops-muted","آخر التنبيهات: "+notifications.length+" | غير المقروءة: "+unread);
  box.appendChild(heading);
  if(!notifications.length){
    box.appendChild(opsNode("div","notification-empty","لا توجد تنبيهات إدارية حالياً."));
    return;
  }
  notifications.forEach(item=>{
    const card=opsNode("article","notification-item"+(item.read_at?"":" unread"));
    card.append(opsNode("strong","",item.title||"تنبيه إداري"),
      opsNode("p","",item.body||""),
      opsNode("div","ops-muted",opsDate(item.created_at)));
    if(!item.read_at){
      const button=opsNode("button","secondary","تحديد كمقروء");
      button.type="button";
      button.onclick=async()=>{
        button.disabled=true;
        try{
          await callAdminApi("POST",{action:"notification_read",notification_id:item.id});
          item.read_at=new Date().toISOString();
          renderOpsNotifications(latestBaranOperations?.notifications||[]);
        }catch(error){
          button.disabled=false;
          const message=document.getElementById("adminMessage");
          if(message)message.textContent="تعذر تحديث التنبيه: "+error.message;
        }
      };
      card.appendChild(button);
    }else{
      card.appendChild(opsNode("span","ops-muted","مقروء"));
    }
    box.appendChild(card);
  });
}

function renderOperationsDashboard(data){
  latestBaranOperations=data||{};
  const stats=data.stats||{};
  const statBox=document.getElementById("opsStats");
  if(statBox){
    statBox.replaceChildren();
    const cards=[
      ["المستخدمون",stats.users||0],
      ["إجمالي الطلبات",stats.orders||0],
      ["المنتجات",stats.products||0],
      ["الموردون",stats.suppliers||0]
    ];
    cards.forEach(([label,value])=>{
      const card=opsNode("div","ops-card");
      card.append(opsNode("div","ops-muted",label),opsNode("div","ops-value",Number(value).toLocaleString("en-US")));
      statBox.appendChild(card);
    });
    Object.entries(stats.order_statuses||{}).forEach(([status,count])=>{
      const labels={pending:"قيد المراجعة",processing:"قيد التنفيذ",awaiting_supplier:"بانتظار المورد",completed:"مكتمل",rejected:"مرفوض",cancelled:"ملغي"};
      const card=opsNode("div","ops-card");
      card.append(opsNode("div","ops-muted",labels[status]||status),opsNode("div","ops-value",String(count)));
      statBox.appendChild(card);
    });
  }
  renderOpsCustomers(data.customers||[]);
  renderOpsOrders(data.orders||[]);
  renderOpsSuppliers(data.suppliers||[],data.supplier_products||[],data.products||[]);
  renderOpsLoyalty(data.customers||[],data.loyalty_customers||[]);
  renderOpsAuditLog(data.audit_log||[]);
  renderOpsNotifications(data.notifications||[]);
}
function renderOpsCustomers(customers){
  const box=document.getElementById("opsCustomers");if(!box)return;box.replaceChildren();
  if(!customers.length){box.textContent="لا توجد حسابات مسجلة.";return;}
  customers.forEach((customer,index)=>{
    const card=opsNode("div","ops-item");
    card.append(opsNode("strong","",((index+1)+". "+opsText(customer.full_name||customer.email))));
    card.append(opsNode("div","ops-muted","البريد: "+opsText(customer.email)));
    card.append(opsNode("div","ops-muted","الهاتف: "+opsText(customer.phone)+" | التسجيل: "+opsDate(customer.created_at)));
    box.appendChild(card);
  });
}
function renderOpsOrders(orders){
  const box=document.getElementById("opsOrders");if(!box)return;box.replaceChildren();
  if(!orders.length){box.textContent="لا توجد طلبات مسجلة حالياً.";return;}
  const labels={pending:"قيد المراجعة",processing:"قيد التنفيذ",awaiting_supplier:"بانتظار المورد",completed:"مكتمل",rejected:"مرفوض",cancelled:"ملغي"};
  orders.forEach(order=>{
    const card=opsNode("div","ops-item");
    card.append(opsNode("strong","","طلب رقم "+order.id.slice(0,8)));
    card.append(opsNode("div","","الزبون: "+opsText(order.customer_name||order.customer_email)));
    card.append(opsNode("div","","البريد: "+opsText(order.customer_email)+" | الهاتف: "+opsText(order.customer_phone)));
    card.append(opsNode("div","","المنتج: "+opsText(order.product_code)+" | اللاعب/المعرّف: "+opsText(order.player_id)));
    card.append(opsNode("div","","الكمية: "+order.quantity+" | التاريخ: "+opsDate(order.created_at)));
    card.append(opsNode("div","","السعر: "+(order.total_price_usd!==null?opsMoney(order.total_price_usd,"USD"):"—")+" | "+(order.total_price_syp!==null?opsMoney(order.total_price_syp,"SYP"):"—")));
    const fulfillment=order.fulfillment;
    if(fulfillment){
      card.append(opsNode("div","ops-muted","المورد: "+opsText((latestBaranOperations.suppliers||[]).find(s=>s.id===fulfillment.supplier_id)?.name)+" | حالة المورد: "+opsText(fulfillment.supplier_status)));
      if(fulfillment.internal_notes)card.append(opsNode("div","ops-muted","ملاحظة داخلية: "+fulfillment.internal_notes));
    }
    const row=opsNode("div","ops-actions");
    const select=document.createElement("select");
    select.id="opsOrderStatus_"+order.id;
    Object.entries(labels).forEach(([value,label])=>opsOption(select,value,label));
    select.value=order.status;
    const note=document.createElement("input");
    note.id="opsOrderMessage_"+order.id;
    note.maxLength=500;note.placeholder="رسالة تظهر للزبون (اختياري)";
    const save=opsNode("button","","تحديث الحالة");
    save.type="button";save.onclick=()=>opsUpdateOrder(order.id);
    row.append(select,save);
    card.append(row,note);
    const supplierPanel=opsNode("div","ops-form");
    supplierPanel.append(opsNode("strong","","متابعة تنفيذ المورد (داخلية)"));
    const supplierSelect=document.createElement("select");
    supplierSelect.id="opsFulfillmentSupplier_"+order.id;
    opsOption(supplierSelect,"","لم يتم تعيين مورد");
    (latestBaranOperations.suppliers||[]).forEach(s=>opsOption(supplierSelect,s.id,s.name));
    supplierSelect.value=fulfillment?.supplier_id||"";
    const supplierReference=document.createElement("input");
    supplierReference.id="opsFulfillmentRef_"+order.id;
    supplierReference.maxLength=160;supplierReference.placeholder="رقم الطلب لدى المورد";
    supplierReference.value=fulfillment?.supplier_reference||"";
    const supplierStatus=document.createElement("select");
    supplierStatus.id="opsFulfillmentStatus_"+order.id;
    [["not_sent","لم يُرسل"],["sent","تم الإرسال"],["accepted","قبله المورد"],["processing","قيد التنفيذ"],["completed","اكتمل"],["failed","تعذر التنفيذ"]]
      .forEach(([v,l])=>opsOption(supplierStatus,v,l));
    supplierStatus.value=fulfillment?.supplier_status||"not_sent";
    const internalNotes=document.createElement("textarea");
    internalNotes.id="opsFulfillmentNotes_"+order.id;
    internalNotes.maxLength=2000;internalNotes.rows=2;
    internalNotes.placeholder="ملاحظات داخلية لا تظهر للزبون";
    internalNotes.value=fulfillment?.internal_notes||"";
    const fulfillmentSave=opsNode("button","","حفظ متابعة المورد");
    fulfillmentSave.type="button";fulfillmentSave.onclick=()=>opsSaveFulfillment(order.id);
    supplierPanel.append(supplierSelect,supplierReference,supplierStatus,internalNotes,fulfillmentSave);
    card.appendChild(supplierPanel);
    box.appendChild(card);
  });
}
function renderOpsSuppliers(suppliers,links,products){
  const box=document.getElementById("opsSuppliers");if(box){
    box.replaceChildren();
    if(!suppliers.length)box.textContent="لم تتم إضافة موردين بعد.";
    suppliers.forEach(s=>{
      const card=opsNode("div","ops-item");
      card.append(opsNode("strong","",s.name),opsNode("div","ops-muted","التواصل: "+opsText(s.contact_name)+" | "+opsText(s.contact_phone)),
        opsNode("div","ops-muted",opsText(s.contact_email)),opsNode("div","ops-muted",s.is_active?"مورد فعّال":"مورد متوقف"));
      if(s.notes)card.append(opsNode("div","ops-muted",s.notes));
      box.appendChild(card);
    });
  }
  const supplierSelect=document.getElementById("opsSupplierSelect");
  const productSelect=document.getElementById("opsProductSelect");
  if(supplierSelect){supplierSelect.replaceChildren();opsOption(supplierSelect,"","اختر المورد");suppliers.filter(s=>s.is_active).forEach(s=>opsOption(supplierSelect,s.id,s.name));}
  if(productSelect){productSelect.replaceChildren();opsOption(productSelect,"","اختر المنتج");products.forEach(p=>opsOption(productSelect,p.id,p.name+" ("+p.product_code+")"));}
  const linksBox=document.getElementById("opsSupplierProducts");
  if(linksBox){
    linksBox.replaceChildren();
    if(!links.length)linksBox.textContent="لا توجد أسعار موردين مسجلة.";
    links.forEach(link=>{
      const supplier=suppliers.find(s=>s.id===link.supplier_id);
      const product=products.find(p=>p.id===link.product_id);
      const card=opsNode("div","ops-item");
      card.append(opsNode("strong","",opsText(product?.name)+" — "+opsText(supplier?.name)));
      card.append(opsNode("div","", "تكلفة الوحدة: "+opsMoney(link.unit_cost,link.currency)));
      card.append(opsNode("div","ops-muted","رمز المورد: "+opsText(link.supplier_sku)+" | مدة التوريد: "+(link.lead_time_hours===null?"—":link.lead_time_hours+" ساعة")));
      if(link.is_preferred)card.append(opsNode("span","ops-pill","المورد المفضل"));
      if(link.notes)card.append(opsNode("div","ops-muted",link.notes));
      linksBox.appendChild(card);
    });
  }
}
function renderOpsLoyalty(customers,loyaltyRows){
  const select=document.getElementById("opsLoyaltyCustomer");
  const box=document.getElementById("opsLoyaltyCustomers");
  const balances=new Map(loyaltyRows.map(row=>[row.user_id,row]));
  if(select){
    const old=select.value;select.replaceChildren();opsOption(select,"","اختر الزبون");
    customers.forEach(c=>opsOption(select,c.id,(c.full_name||c.email||c.id)+" — "+opsText(c.email)));
    if(old)select.value=old;
  }
  if(box){
    box.replaceChildren();
    if(!customers.length){box.textContent="لا توجد حسابات لعرضها.";return;}
    customers.forEach(c=>{
      const points=balances.get(c.id);
      const card=opsNode("div","ops-item");
      card.append(opsNode("strong","",c.full_name||c.email||c.id));
      card.append(opsNode("div","","النقاط الحالية: "+Number(points?.points_balance||0).toLocaleString("en-US")));
      card.append(opsNode("div","ops-muted","إجمالي النقاط المكتسبة: "+Number(points?.lifetime_earned||0).toLocaleString("en-US")));
      box.appendChild(card);
    });
  }
}
async function opsSaveSupplier(){
  const message=document.getElementById("opsSupplierMessage");
  const name=document.getElementById("opsSupplierName").value.trim();
  if(name.length<2){message.textContent="اكتب اسم المورد بشكل صحيح.";return;}
  try{
    await callAdminApi("POST",{action:"supplier_save",supplier_name:name,
      contact_name:document.getElementById("opsSupplierContact").value,
      contact_phone:document.getElementById("opsSupplierPhone").value,
      contact_email:document.getElementById("opsSupplierEmail").value,
      notes:document.getElementById("opsSupplierNotes").value});
    ["opsSupplierName","opsSupplierContact","opsSupplierPhone","opsSupplierEmail","opsSupplierNotes"].forEach(id=>document.getElementById(id).value="");
    message.textContent="تم حفظ المورد.";
    await loadAdminPanel();
  }catch(error){message.textContent="تعذر حفظ المورد: "+error.message;}
}
async function opsSaveSupplierProduct(){
  const message=document.getElementById("opsSupplierProductMessage");
  const supplier=document.getElementById("opsSupplierSelect").value;
  const product=document.getElementById("opsProductSelect").value;
  const cost=Number(document.getElementById("opsUnitCost").value);
  if(!supplier||!product||!Number.isFinite(cost)||cost<0){message.textContent="اختر المورد والمنتج وأدخل تكلفة صحيحة.";return;}
  try{
    await callAdminApi("POST",{action:"supplier_product_save",supplier_id:supplier,product_id:product,
      supplier_sku:document.getElementById("opsSupplierSku").value,unit_cost:cost,
      currency:document.getElementById("opsCostCurrency").value,
      lead_time_hours:document.getElementById("opsLeadTime").value===""?null:Number(document.getElementById("opsLeadTime").value),
      is_preferred:document.getElementById("opsPreferredSupplier").checked,
      notes:document.getElementById("opsSupplierProductNotes").value});
    message.textContent="تم حفظ تكلفة المورد وربطها بالمنتج.";
    await loadAdminPanel();
  }catch(error){message.textContent="تعذر حفظ السعر: "+error.message;}
}
async function opsUpdateOrder(orderId){
  const status=document.getElementById("opsOrderStatus_"+orderId).value;
  const message=document.getElementById("opsOrderMessage_"+orderId).value.trim();
  if(!confirm("تأكيد تحديث حالة الطلب؟"))return;
  try{
    await callAdminApi("POST",{action:"order_status_update",order_id:orderId,new_status:status,customer_message:message});
    document.getElementById("adminMessage").textContent="تم تحديث حالة الطلب وتسجيل الحدث.";
    await loadAdminPanel();
  }catch(error){document.getElementById("adminMessage").textContent="تعذر تحديث الطلب: "+error.message;}
}
async function opsAdjustLoyalty(){
  const customer=document.getElementById("opsLoyaltyCustomer").value;
  const delta=Number(document.getElementById("opsPointsDelta").value);
  const reason=document.getElementById("opsPointsReason").value.trim();
  const message=document.getElementById("opsLoyaltyMessage");
  if(!customer||!Number.isInteger(delta)||delta===0||reason.length<2){message.textContent="اختر زبوناً وأدخل نقاطاً صحيحة وسبب التعديل.";return;}
  if(!confirm("تأكيد "+(delta>0?"إضافة ":"خصم ")+Math.abs(delta)+" نقطة؟"))return;
  try{
    const result=await callAdminApi("POST",{action:"loyalty_adjust",target_user_id:customer,points_delta:delta,description:reason});
    message.textContent="تم تحديث النقاط. الرصيد الجديد: "+result.loyalty.points_balance;
    document.getElementById("opsPointsDelta").value="";
    document.getElementById("opsPointsReason").value="";
    await loadAdminPanel();
  }catch(error){message.textContent="تعذر تعديل النقاط: "+error.message;}
}


async function loadMyOrders(){
  const box=document.getElementById("customerOrdersList");if(!box||!currentUser)return;
  box.textContent="جاري تحميل طلباتك...";
  const labels={pending:"قيد المراجعة",processing:"قيد التنفيذ",awaiting_supplier:"بانتظار المورد",completed:"مكتمل",rejected:"مرفوض",cancelled:"ملغي"};
  try{
    const [{data:orders,error},{data:events,error:eventError}]=await Promise.all([
      sb.from("orders").select("id,product_code,player_id,quantity,status,created_at,total_price_usd,total_price_syp")
        .eq("user_id",currentUser.id).order("created_at",{ascending:false}).limit(50),
      sb.from("order_status_events").select("id,order_id,new_status,customer_message,created_at")
        .order("created_at",{ascending:false}).limit(200)
    ]);
    if(error)throw error;if(eventError)throw eventError;
    box.replaceChildren();
    if(!orders?.length){box.textContent="ما عندك طلبات مسجلة حالياً.";return;}
    orders.forEach(order=>{
      const card=opsNode("div","ops-item");
      card.append(opsNode("strong","","طلب "+order.id.slice(0,8)));
      card.append(opsNode("div","","المنتج: "+opsText(order.product_code)+" | الكمية: "+order.quantity));
      card.append(opsNode("div","","معرّف اللاعب: "+opsText(order.player_id)));
      card.append(opsNode("div","","الحالة الحالية: "+(labels[order.status]||order.status)));
      card.append(opsNode("div","ops-muted","تاريخ الطلب: "+opsDate(order.created_at)));
      if(order.total_price_usd!==null)card.append(opsNode("div","ops-muted","الإجمالي: "+opsMoney(order.total_price_usd,"USD")+" | "+opsMoney(order.total_price_syp,"SYP")));
      const history=(events||[]).filter(e=>e.order_id===order.id);
      if(history.length){
        card.append(opsNode("strong","","تحديثات الطلب"));
        history.forEach(e=>{
          const line=opsNode("div","ops-muted",(labels[e.new_status]||e.new_status)+" — "+opsDate(e.created_at));
          if(e.customer_message)line.textContent+=" | "+e.customer_message;
          card.appendChild(line);
        });
      }else card.append(opsNode("div","ops-muted","لم تُسجل تحديثات إضافية لهذا الطلب بعد."));
      box.appendChild(card);
    });
  }catch(error){box.textContent="تعذر تحميل الطلبات: "+error.message;}
}
async function loadMyRewards(){
  const balanceBox=document.getElementById("customerLoyaltyBalance");
  const historyBox=document.getElementById("customerLoyaltyHistory");
  if(!balanceBox||!historyBox||!currentUser)return;
  balanceBox.textContent="جاري تحميل رصيد النقاط...";
  try{
    const [{data:account,error},{data:history,error:historyError}]=await Promise.all([
      sb.from("customer_loyalty").select("points_balance,lifetime_earned,updated_at").eq("user_id",currentUser.id).maybeSingle(),
      sb.from("loyalty_transactions").select("points,transaction_type,description,created_at")
        .eq("user_id",currentUser.id).order("created_at",{ascending:false}).limit(50)
    ]);
    if(error)throw error;if(historyError)throw historyError;
    balanceBox.replaceChildren();
    balanceBox.append(opsNode("div","ops-muted","رصيد نقاطك الحالي"),
      opsNode("div","ops-value",Number(account?.points_balance||0).toLocaleString("en-US")+" نقطة"),
      opsNode("div","ops-muted","إجمالي النقاط المكتسبة: "+Number(account?.lifetime_earned||0).toLocaleString("en-US")));
    historyBox.replaceChildren();
    if(!history?.length){historyBox.textContent="لا توجد حركات نقاط مسجلة حتى الآن.";return;}
    history.forEach(item=>{
      const card=opsNode("div","ops-item");
      const sign=item.transaction_type==="redeem"?"−":"+";
      card.append(opsNode("strong","",sign+Number(item.points).toLocaleString("en-US")+" نقطة"));
      card.append(opsNode("div","",item.description));
      card.append(opsNode("div","ops-muted",opsDate(item.created_at)));
      historyBox.appendChild(card);
    });
  }catch(error){
    balanceBox.textContent="تعذر تحميل النقاط: "+error.message;
    historyBox.replaceChildren();
  }
}

async function opsSaveFulfillment(orderId){
  const supplier=document.getElementById("opsFulfillmentSupplier_"+orderId).value||null;
  const reference=document.getElementById("opsFulfillmentRef_"+orderId).value.trim();
  const status=document.getElementById("opsFulfillmentStatus_"+orderId).value;
  const notes=document.getElementById("opsFulfillmentNotes_"+orderId).value.trim();
  try{
    await callAdminApi("POST",{action:"order_fulfillment_update",order_id:orderId,
      supplier_id:supplier,supplier_reference:reference,supplier_status:status,internal_notes:notes});
    document.getElementById("adminMessage").textContent="تم حفظ متابعة المورد (معلومات داخلية).";
    await loadAdminPanel();
  }catch(error){document.getElementById("adminMessage").textContent="تعذر حفظ متابعة المورد: "+error.message;}
}

function renderOpsAuditLog(rows){
  const box=document.getElementById("opsAuditLog");if(!box)return;box.replaceChildren();
  if(!rows.length){box.textContent="لا توجد عمليات إدارية مسجلة بعد.";return;}
  rows.forEach(item=>{
    const card=opsNode("div","ops-item");
    card.append(opsNode("strong","",item.action));
    card.append(opsNode("div","ops-muted","النوع: "+opsText(item.entity_type)+" | المعرّف: "+opsText(item.entity_id)));
    card.append(opsNode("div","ops-muted","المدير: "+opsText(item.admin_id)+" | "+opsDate(item.created_at)));
    if(item.details)card.append(opsNode("div","ops-muted",JSON.stringify(item.details)));
    box.appendChild(card);
  });
}
