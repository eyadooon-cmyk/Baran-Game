let latestBaranOperations=null;

function opsText(value){return value===null||value===undefined||value===""?"—":String(value);}
function opsCustomerDisplayName(customer){
  const name=String(customer?.full_name||customer?.display_name||customer?.name||"").trim();
  if(name)return name;
  const id=String(customer?.id||"").replace(/-/g,"");
  return id?"عضو BARAN #"+id.slice(0,6).toUpperCase():"عضو BARAN";
}
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
  const summary=opsNode("div","notification-admin-summary");
  const total=opsNode("span","", "آخر التنبيهات: "+notifications.length);
  const pending=opsNode("span","", "غير مقروءة: "+unread);
  summary.append(total,pending);box.appendChild(summary);
  if(!notifications.length){
    const empty=opsNode("div","notification-empty-state");
    empty.append(opsNode("span","","✦"),opsNode("strong","","كل شيء هادئ"),opsNode("p","","لا توجد تنبيهات إدارية تحتاج انتباهك حالياً."));
    box.appendChild(empty);return;
  }
  notifications.forEach(item=>{
    if(typeof buildBaranNotificationCard==="function"){
      box.appendChild(buildBaranNotificationCard(item,"admin"));
      return;
    }
    const card=opsNode("article","notification-item notification-clickable"+(item.read_at?"":" unread"));
    card.tabIndex=0;card.setAttribute("role","button");card.onclick=()=>openBaranNotificationTarget(item,"admin");
    card.append(opsNode("strong","",item.title||"تنبيه إداري"),opsNode("p","",item.body||""),opsNode("time","",opsDate(item.created_at)));
    box.appendChild(card);
  });
}

let baranMonitorBusy=false;
async function loadOpsMonitor(){
  const statusBox=document.getElementById("opsMonitorStatus");
  const alertsBox=document.getElementById("opsMonitorAlerts");
  if(!statusBox||!alertsBox||baranMonitorBusy||!currentUser)return;
  baranMonitorBusy=true;
  try{
    const {data:{session},error:sessionError}=await sb.auth.getSession();
    if(sessionError||!session)throw new Error("انتهت جلسة المدير.");
    const response=await fetch(SUPABASE_URL+"/functions/v1/baran-admin-monitor",{
      method:"POST",
      headers:{
        "Authorization":"Bearer "+session.access_token,
        "apikey":SUPABASE_KEY,
        "Content-Type":"application/json"
      },
      body:"{}"
    });
    let result={};try{result=await response.json();}catch(_){}
    if(!response.ok)throw new Error(result.error||"تعذر جلب حالة المراقبة.");
    const monitor=result.monitor||{};
    const job=monitor.job||{};
    const check=monitor.latest_check||{};
    const service=monitor.service_check||{};
    const lastRun=monitor.last_run||null;
    const parts=[];
    parts.push(job.active?"المراقبة مفعّلة":"المراقبة غير مفعّلة");
    parts.push("الفحص المجدول: "+opsText(job.schedule||"—"));
    parts.push("آخر فحص: "+(service.checked_at?opsDate(service.checked_at):(check.checked_at?opsDate(check.checked_at):"لم يسجل بعد")));
    parts.push("آخر تشغيل: "+(lastRun?.started_at?opsDate(lastRun.started_at)+" — "+opsText(lastRun.status):"بانتظار أول تشغيل تلقائي"));
    parts.push("التنبيهات المفتوحة: "+Number(monitor.active_alert_count||0));
    parts.push("الخدمات المتدهورة: "+Number(service.degraded_services||0));
    statusBox.textContent=parts.join(" | ");
    alertsBox.replaceChildren();

    const coverage=opsNode("div","ops-item");
    coverage.append(
      opsNode("strong","","تغطية مراقبة الموردين"),
      opsNode("div","ops-muted",service.coverage_note||"تعتمد المراقبة على سجلات محاولات الشحن الفعلية."),
      opsNode("div","ops-muted","واجهات فحص مباشر مهيأة: "+Number(service.direct_health_checks_configured||0)+" | فحوص مباشرة منفذة: "+Number(service.direct_health_checks_performed||0))
    );
    alertsBox.appendChild(coverage);

    const metrics=Array.isArray(service.service_metrics)?service.service_metrics:[];
    const metricHeading=opsNode("div","ops-muted","مؤشرات الشحن الفعلية — آخر "+Number(service.window_minutes||10)+" دقائق");
    alertsBox.appendChild(metricHeading);
    if(!metrics.length){
      alertsBox.appendChild(opsNode("div","ops-item","لا توجد طلبات أو محاولات أو أحداث فشل مسجلة ضمن نافذة الرصد الحالية؛ لا يمكن الحكم على توفر الخدمة من دون نشاط فعلي."));
    }else{
      metrics.slice(0,20).forEach(metric=>{
        const card=opsNode("article","ops-item");
        const failed=Number(metric.failures_10m||0);
        const attempts=Number(metric.attempts_10m||0);
        card.append(
          opsNode("strong","",(metric.supplier_name||"مورد غير معروف")+" — "+(metric.product_code||"منتج غير محدد")),
          opsNode("div","ops-muted","مصدر الرصد: "+({supplier_api:"محاولات API",order_status:"حالة الطلب",manual_order:"طلب BARO يدوي",supplier_event:"حدث المورد"}[metric.source_system]||metric.source_system||"غير محدد")),
          opsNode("div","ops-muted","المحاولات: "+attempts+" | الفشل: "+failed+" | نسبة الفشل: "+Number(metric.failure_rate_percent||0)+"%"),
          opsNode("div","ops-muted","429: "+Number(metric.rate_limited_10m||0)+" | أخطاء 5xx: "+Number(metric.upstream_5xx_10m||0)+" | أخطاء اتصال: "+Number(metric.connection_errors_10m||0)),
          opsNode("div","ops-muted","متوسط الاستجابة المسجل: "+(metric.avg_latency_ms===null||metric.avg_latency_ms===undefined?"غير متاح":Number(metric.avg_latency_ms)+" ms")+" | آخر رمز خطأ: "+opsText(metric.last_error_code))
        );
        alertsBox.appendChild(card);
      });
    }

    const alerts=Array.isArray(monitor.active_alerts)?monitor.active_alerts:[];
    alertsBox.appendChild(opsNode("div","ops-muted","التنبيهات التي تحتاج متابعة"));
    if(!alerts.length){
      alertsBox.appendChild(opsNode("div","ops-item","لا توجد مشاكل مفتوحة حسب آخر فحص."));
    }else{
      alerts.forEach(alert=>{
        const card=opsNode("article","ops-item");
        const severity=alert.severity==="critical"?"حرج":alert.severity==="warning"?"تحذير":"معلومة";
        const d=alert.details||{};
        const serviceDetail=d.supplier_name
          ? "المورد: "+opsText(d.supplier_name)+" | المنتج: "+opsText(d.product_code)+" | الفشل: "+Number(d.failures||0)+"/"+Number(d.attempts||0)+" ("+Number(d.failure_rate_percent||0)+"%)"
          : "العدد الحالي: "+opsText(d.count);
        card.append(
          opsNode("strong","",severity+" — "+opsText(alert.message)),
          opsNode("div","ops-muted",serviceDetail),
          opsNode("div","ops-muted","429: "+Number(d.rate_limited||0)+" | أخطاء 5xx: "+Number(d.upstream_5xx||0)+" | متوسط الاستجابة: "+(d.avg_latency_ms==null?"—":Number(d.avg_latency_ms)+" ms")),
          opsNode("div","ops-muted","آخر رصد: "+opsDate(alert.last_seen_at)+" | تكرار الرصد: "+Number(alert.occurrences||1))
        );
        alertsBox.appendChild(card);
      });
    }
  }catch(error){
    statusBox.textContent="تعذر تحميل حالة المراقبة: "+(error?.message||"خطأ غير معروف");
    alertsBox.replaceChildren();
  }finally{
    baranMonitorBusy=false;
  }
}
if(typeof window!=="undefined"&&!window.__baranServiceMonitorUiTimer){
  window.__baranServiceMonitorUiTimer=window.setInterval(()=>{
    if(document.visibilityState==="visible"&&currentUser)void loadOpsMonitor();
  },60000);
}


function updateAdminDrawerBadges(stats){
  const ordersBadge=document.getElementById("adminDrawerOrdersCount");
  const supportBadge=document.getElementById("adminDrawerSupportCount");
  const update=(badge,value)=>{
    if(!badge)return;
    const count=Math.max(0,Number(value)||0);
    const number=badge.querySelector("b");
    if(number)number.textContent=count>99?"99+":String(count);
    badge.classList.toggle("hidden",count===0);
  };
  update(ordersBadge,stats?.pending_orders);
  update(supportBadge,stats?.unread_support_tickets);
}
function renderOperationsDashboard(data){
  latestBaranOperations=data||{};
  window.baranCustomerExperienceData=data||{};
  const stats=data.stats||{};
  updateAdminDrawerBadges(stats);
  void loadOpsMonitor();
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
  if(typeof window.renderBaranCustomerExperience==="function")window.renderBaranCustomerExperience(data||{});
  renderOpsOrders(data.orders||[]);
  renderOpsSuppliers(data.suppliers||[],data.supplier_products||[],data.products||[]);
  renderOpsSupplierIntegration(data.supplier_integration||{},data.suppliers||[]);
  renderOpsLoyalty(data.customers||[],data.loyalty_customers||[]);
  renderOpsAuditLog(data.audit_log||[]);
  renderOpsNotifications(data.notifications||[]);
}
function renderOpsCustomers(customers){
  const box=document.getElementById("opsCustomers");if(!box)return;box.replaceChildren();
  if(!customers.length){box.textContent="لا توجد حسابات مسجلة.";return;}
  customers.forEach((customer,index)=>{
    const card=opsNode("div","ops-item customer-directory-item");
    if(customer.id)card.dataset.customerId=customer.id;
    card.append(opsNode("strong","",((index+1)+". "+opsCustomerDisplayName(customer))));
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
    card.dataset.notificationEntityId=order.id;
    card.append(opsNode("strong","","طلب رقم "+order.id.slice(0,8)));
    card.append(opsNode("div","","الزبون: "+opsText(order.customer_name||"زبون الطلب")));
    if(order.customer_phone)card.append(opsNode("div","ops-muted","الهاتف: "+opsText(order.customer_phone)));
    card.append(opsNode("div","","المنتج: "+opsText(order.product_code)+" | اللاعب/المعرّف: "+opsText(order.player_id)));
    card.append(opsNode("div","","الكمية: "+order.quantity+" | التاريخ: "+opsDate(order.created_at)));
    card.append(opsNode("div","","السعر: "+(order.total_price_usd!==null?opsMoney(order.total_price_usd,"USD"):"—")+" | "+(order.total_price_syp!==null?opsMoney(order.total_price_syp,"SYP"):"—")));
    const fulfillment=order.fulfillment;
    if(fulfillment){
      card.append(opsNode("div","ops-muted","المورد: "+opsText((latestBaranOperations.suppliers||[]).find(s=>s.id===fulfillment.supplier_id)?.name)+" | حالة المورد: "+opsText(fulfillment.supplier_status)));
      if(fulfillment.supplier_total_cost!==null&&fulfillment.supplier_total_cost!==undefined){
        const costCurrency=fulfillment.supplier_cost_currency||"USD";
        card.append(opsNode("div","ops-muted","تكلفة المورد الفعلية: "+opsMoney(fulfillment.supplier_total_cost,costCurrency)));
        const costUsd=costCurrency==="USD"?Number(fulfillment.supplier_total_cost):Number(fulfillment.supplier_total_cost)/Number(fulfillment.supplier_cost_exchange_rate||0);
        if(Number.isFinite(costUsd)&&Number(fulfillment.supplier_cost_exchange_rate)>0&&order.total_price_usd!==null){
          card.append(opsNode("div","ops-muted","الربح الإجمالي التقديري: "+opsMoney(Number(order.total_price_usd)-costUsd,"USD")+" (قبل المصاريف الأخرى)"));
        }
      }
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
    const supplierUnitCost=document.createElement("input");
    supplierUnitCost.id="opsFulfillmentCost_"+order.id;
    supplierUnitCost.type="number";supplierUnitCost.min="0";supplierUnitCost.step="0.0001";
    supplierUnitCost.placeholder="تكلفة الوحدة الفعلية لدى المورد (اختياري)";
    supplierUnitCost.value=fulfillment?.supplier_unit_cost??"";
    const supplierCostCurrency=document.createElement("select");
    supplierCostCurrency.id="opsFulfillmentCostCurrency_"+order.id;
    opsOption(supplierCostCurrency,"USD","تكلفة المورد بالدولار");
    opsOption(supplierCostCurrency,"SYP","تكلفة المورد بالليرة");
    supplierCostCurrency.value=fulfillment?.supplier_cost_currency||"USD";
    const fulfillmentSave=opsNode("button","","حفظ متابعة المورد");
    fulfillmentSave.type="button";fulfillmentSave.onclick=()=>opsSaveFulfillment(order.id);
    supplierPanel.append(supplierSelect,supplierReference,supplierStatus,supplierUnitCost,supplierCostCurrency,internalNotes,fulfillmentSave);
    card.appendChild(supplierPanel);
    if(fulfillment?.supplier_status==="failed" && fulfillment?.refund_status!=="completed"){
      const refundButton=opsNode("button","secondary","إعادة رصيد الزبون بعد تأكيد الفشل");
      refundButton.type="button";
      refundButton.onclick=async()=>{
        const reason=prompt("اكتب سبب فشل المورد بعد التأكد من أن العملية لم تنفذ:");
        if(!reason||reason.trim().length<3)return;
        if(!confirm("سيتم إعادة مبلغ الطلب إلى محفظة الزبون مرة واحدة فقط. هل تأكدت من فشل العملية لدى المورد؟"))return;
        refundButton.disabled=true;
        try{
          const result=await callAdminApi("POST",{action:"supplier_order_refund",order_id:order.id,failure_reason:reason.trim()});
          alert(result.refund?.already_refunded?"تم اكتشاف أن المبلغ مسترد سابقاً، ولم تتم إضافة رصيد جديد.":"تمت إعادة المبلغ إلى محفظة الزبون مرة واحدة.");
          await loadAdminPanel();
        }catch(error){alert("تعذر الاسترداد: "+error.message);refundButton.disabled=false;}
      };
      card.appendChild(refundButton);
    }
    if(fulfillment?.refund_status==="completed")card.appendChild(opsNode("div","ops-pill","تمت إعادة المبلغ للزبون"));
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
      const schema=Array.isArray(link.input_schema)?link.input_schema:[];
      card.append(opsNode("div","ops-muted","حقول بيانات الزبون: "+(schema.length?schema.map(f=>opsText(f.label)).join("، "):"لا توجد حقول إضافية")));
      if(link.notes)card.append(opsNode("div","ops-muted",link.notes));
      const editFields=opsNode("button","secondary","تعديل حقول الطلب");
      editFields.type="button";
      editFields.onclick=()=>{
        const set=(id,value)=>{const el=document.getElementById(id);if(el)el.value=value??"";};
        set("opsSupplierSelect",link.supplier_id);set("opsProductSelect",link.product_id);
        set("opsSupplierSku",link.supplier_sku);set("opsUnitCost",link.unit_cost);
        set("opsCostCurrency",link.currency);set("opsLeadTime",link.lead_time_hours);
        set("opsSupplierProductNotes",link.notes);
        const preferred=document.getElementById("opsPreferredSupplier");if(preferred)preferred.checked=link.is_preferred===true;
        const schemaInput=document.getElementById("opsSupplierInputSchema");if(schemaInput)schemaInput.value=JSON.stringify(schema,null,2);
        document.getElementById("opsSupplierSelect")?.scrollIntoView({behavior:"smooth",block:"center"});
      };
      card.append(editFields);
      linksBox.appendChild(card);
    });
  }
}
async function opsRegisterShamCashWebhook(button,output){
  if(!window.confirm("سيتم تسجيل عنوان Webhook الخاص بباران لدى ShamCash API. لن يتم تفعيل إضافة الرصيد تلقائياً. هل تريد المتابعة؟"))return;
  button.disabled=true;
  output.textContent="جارٍ التحقق من جلسة المدير والتسجيل لدى ShamCash…";
  try{
    const {data:{session},error:sessionError}=await sb.auth.getSession();
    if(sessionError||!session?.access_token)throw new Error("انتهت جلسة المدير. سجّل الدخول من جديد.");
    const response=await fetch(SUPABASE_URL+"/functions/v1/baran-shamcash-register",{
      method:"POST",
      headers:{
        "Authorization":"Bearer "+session.access_token,
        "apikey":SUPABASE_KEY,
        "Content-Type":"application/json"
      },
      body:"{}",
      cache:"no-store"
    });
    let result={};try{result=await response.json();}catch(_){}
    if(!response.ok||result.registered!==true)throw new Error(result.error||"رفضت ShamCash تسجيل Webhook.");
    output.replaceChildren();
    if(result.secret_received===true&&typeof result.signing_secret==="string"){
      output.appendChild(opsNode("strong","","تم قبول التسجيل واستلام مفتاح التوقيع."));
      output.appendChild(opsNode("p","ops-muted","انسخ المفتاح مباشرة إلى Supabase Edge Function Secrets بالاسم SHAMCASH_WEBHOOK_SIGNING_SECRET. لا ترسله في المحادثة."));
      const secretInput=document.createElement("input");
      secretInput.type="password";secretInput.readOnly=true;secretInput.autocomplete="off";
      secretInput.value=result.signing_secret;secretInput.style.width="100%";secretInput.style.margin="8px 0";
      const row=opsNode("div","ops-actions");
      const reveal=opsNode("button","secondary","إظهار/إخفاء المفتاح");reveal.type="button";
      reveal.onclick=()=>{secretInput.type=secretInput.type==="password"?"text":"password";};
      const copy=opsNode("button","primary","نسخ المفتاح");copy.type="button";
      copy.onclick=async()=>{
        try{await navigator.clipboard.writeText(secretInput.value);copy.textContent="تم النسخ";copy.disabled=true;}
        catch(_){output.appendChild(opsNode("p","ops-muted","تعذر النسخ التلقائي؛ أظهر المفتاح وانسخه يدوياً من هذه الصفحة فقط."));}
      };
      row.append(reveal,copy);
      output.append(secretInput,row);
    }else{
      output.appendChild(opsNode("strong","","قبلت ShamCash طلب التسجيل، لكن لم يصل مفتاح التوقيع المتوقع."));
      output.appendChild(opsNode("p","ops-muted",result.warning||"لا تعتبر استقبال Webhook جاهزاً بعد. راجع استجابة مزود الخدمة."));
    }
  }catch(error){
    output.textContent="لم يكتمل التسجيل: "+(error?.message||"خطأ غير معروف");
  }finally{
    button.disabled=false;
  }
}
async function callSyriaMarketCatalog(action,extraPayload={}){
  if(typeof sb==="undefined"||!currentUser)throw new Error("سجّل الدخول بحساب الإدارة أولاً.");
  const {data:{session},error:sessionError}=await sb.auth.getSession();
  if(sessionError||!session?.access_token)throw new Error("انتهت جلسة المدير. سجّل الدخول مجدداً.");
  const response=await fetch(SUPABASE_URL+"/functions/v1/baran-syrimarket-v1-catalog",{
    method:"POST",
    headers:{"Authorization":"Bearer "+session.access_token,"apikey":SUPABASE_KEY,"Content-Type":"application/json"},
    body:JSON.stringify({action,...extraPayload}),
    cache:"no-store"
  });
  let result={};try{result=await response.json();}catch(_){}
  if(!response.ok||result.success!==true)throw new Error(result.error||"تعذر تحميل كتالوج سوريا ماركت.");
  return result;
}
function renderSyriaMarketCatalog(result){
  const status=document.getElementById("syriaMarketV1CatalogStatus");
  const box=document.getElementById("syriaMarketV1CatalogList");
  if(!box)return;
  const products=Array.isArray(result.products)?result.products:[];
  const categories=Array.isArray(result.categories)?result.categories:[];
  const pageInfo=Number(result.total_pages??0)>0?" | الصفحة: "+Number(result.current_page??1)+"/"+Number(result.total_pages):"";
  const completion=result.sync_complete===true?" | اكتملت كل الصفحات":(Number(result.total_pages??0)>1?" | انتظر 65 ثانية ثم اضغط مزامنة للمتابعة":"");
  if(status)status.textContent="آخر تحديث: "+opsDate(result.fetched_at)+" | المنتجات المحفوظة: "+Number(result.product_count??products.length)+" | الفئات: "+Number(result.category_count??categories.length)+pageInfo+completion+(result.cached?" | نسخة محفوظة":" | تحديث جديد");
  box.replaceChildren();
  if(categories.length){
    const cats=opsNode("div","ops-item");
    cats.append(opsNode("strong","","الفئات ("+categories.length+")"),opsNode("div","ops-muted",categories.map(c=>String(c?.name??c?.title??c?.id??c)).join(" · ")));
    box.appendChild(cats);
  }
  if(!products.length){box.appendChild(opsNode("div","ops-item","لم يرجع المورد منتجات ضمن الكاتلوج."));return;}
  products.forEach((p,index)=>{
    const card=opsNode("article","ops-item");
    const name=p?.name??p?.title??p?.product_name??("منتج "+(index+1));
    const id=p?.id??p?.product_id??p?.public_product_id??"—";
    const category=p?.category_name??p?.category??p?.category_path??"غير مصنف";
    card.append(opsNode("strong","",String(name)),opsNode("div","ops-muted","معرّف المورد: "+String(id)+" | الفئة: "+String(category)));
    const price=p?.price??p?.cost??p?.amount??p?.pricing??p?.quantity_options??null;
    if(price!==null)card.append(opsNode("div","ops-muted","بيانات السعر/الخيارات: "+(typeof price==="object"?JSON.stringify(price):String(price))));
    const details=document.createElement("details");
    const summary=document.createElement("summary");summary.textContent="تفاصيل المنتج من المورد";
    const pre=document.createElement("pre");pre.textContent=JSON.stringify(p,null,2);pre.style.whiteSpace="pre-wrap";pre.style.wordBreak="break-word";pre.style.fontSize="12px";pre.style.direction="ltr";pre.style.textAlign="left";
    details.append(summary,pre);card.appendChild(details);box.appendChild(card);
  });
}

async function lookupSyriaMarketAuditIds(){
  const status=document.getElementById("syriaMarketAuditLookupStatus");
  const box=document.getElementById("syriaMarketAuditLookupResults");
  const button=document.getElementById("syriaMarketAuditLookupButton");
  if(!status||!box||!button)return;
  button.disabled=true;status.textContent="جارٍ فحص 4 معرّفات مباشرة لدى المورد (قراءة فقط)...";box.replaceChildren();
  try{
    const result=await callSyriaMarketCatalog("audit_lookup_ids",{product_ids:["1161","1772","1781","212"]});
    const rows=Array.isArray(result.found)?result.found:[];
    status.textContent="اكتمل فحص المعرّفات الأربعة · الصفحات المقروءة: "+Number(result.scanned_pages||0)+" · الكتالوج الحي لم يتغير.";
    rows.forEach(item=>{
      const card=opsNode("article","ops-item");
      card.append(
        opsNode("strong","", "معرّف المورد: "+opsText(item.id)),
        opsNode("div","ops-muted","الاسم: "+opsText(item.name)),
        opsNode("div","ops-muted","التصنيف: "+opsText(item.category)),
        opsNode("div","ops-muted","التصنيف ID: "+opsText(item.category_id)),
        opsNode("div","ops-muted","السعر: "+opsText(item.price)+(item.currency?" "+item.currency:"")),
        opsNode("div","ops-muted","الحالة: "+opsText(item.status))
      );
      if(item.found===false)card.appendChild(opsNode("div","ops-muted","لم يظهر هذا المعرّف ضمن الصفحات التي تم فحصها."));
      box.appendChild(card);
    });
  }catch(error){
    status.textContent="تعذر البحث: "+(error?.message||"خطأ غير معروف");
  }finally{button.disabled=false;}
}
async function startSyriaMarketFullAudit(){
  const button=document.getElementById("syriaMarketFullAuditButton");
  const status=document.getElementById("syriaMarketFullAuditStatus");
  if(!button||!status)return;
  button.disabled=true;
  status.textContent="جارٍ طلب بدء تدقيق شامل جديد... لن يتم تعديل الكتالوج الحي.";
  try{
    const result=await callSyriaMarketCatalog("audit_start");
    const runId=result.run_id||"";
    status.textContent=(result.already_running?"يوجد تدقيق شامل قيد التنفيذ بالفعل.":"تم بدء التدقيق الشامل بنجاح.")+
      " الحالة: "+opsText(result.status)+" | الصفحة التالية: "+Number(result.next_page||1)+
      (runId?" | رقم الدورة: "+runId:"")+
      " | سيعالج المجدول صفحة كل دقيقة تقريباً، دون لمس الكاش أو الأسعار أو الطلبات.";
  }catch(error){
    status.textContent="تعذر بدء التدقيق: "+(error?.message||"خطأ غير معروف");
  }finally{
    button.disabled=false;
  }
}
async function loadSyriaMarketCatalog(){
  const status=document.getElementById("syriaMarketV1CatalogStatus");
  if(status)status.textContent="جاري تحميل النسخة المحفوظة...";
  try{const result=await callSyriaMarketCatalog("get");renderSyriaMarketCatalog(result);}
  catch(error){if(status)status.textContent="تعذر تحميل الكاتلوج: "+(error?.message||"خطأ غير معروف");}
}
async function syncSyriaMarketCatalog(){
  const button=document.getElementById("syriaMarketCatalogSyncButton");
  const status=document.getElementById("syriaMarketV1CatalogStatus");
  if(button)button.disabled=true;
  if(status)status.textContent="جاري الاتصال بسوريا ماركت وسحب المنتجات... لن يتم إنشاء أي طلب.";
  try{const result=await callSyriaMarketCatalog("sync");renderSyriaMarketCatalog(result);}
  catch(error){if(status)status.textContent="لم تكتمل المزامنة: "+(error?.message||"خطأ غير معروف");}
  finally{if(button)button.disabled=false;}
}

function renderOpsSupplierIntegration(integration,suppliers){
  const select=document.getElementById("opsApiSupplierSelect");
  const statusBox=document.getElementById("opsApiStatus");
  const eventsBox=document.getElementById("opsApiEvents");
  const attemptsBox=document.getElementById("opsApiAttempts");
  const configs=Array.isArray(integration.configs)?integration.configs:[];
  if(select){
    const old=select.value;select.replaceChildren();opsOption(select,"","اختر المورد");
    suppliers.forEach(s=>opsOption(select,s.id,s.name));
    if(old)select.value=old;
    select.onchange=()=>{
      const c=configs.find(x=>x.supplier_id===select.value);
      const fields={opsApiAdapter:c?.adapter_key||"pending",opsApiBaseUrl:c?.api_base_url||"",
        opsApiHealthPath:c?.health_path||"",opsApiBalancePath:c?.balance_path||"",
        opsApiCreatePath:c?.create_order_path||"",opsApiStatusPath:c?.order_status_path||"",
        opsApiSecretName:c?.auth_secret_name||"",opsApiHeaderName:c?.auth_header_name||"Authorization",
        opsApiPrefix:c?.auth_prefix??"Bearer ",opsApiLowBalance:c?.low_balance_threshold??0,
        opsApiCurrency:c?.balance_currency||"USD",opsApiEnabled:String(c?.integration_enabled===true)};
      Object.entries(fields).forEach(([id,value])=>{
        const el=document.getElementById(id);if(!el)return;
        if(el.type==="checkbox")el.checked=value==="true";else el.value=value;
      });
    };
  }
  if(statusBox){
    statusBox.replaceChildren();
    if(!configs.length)statusBox.textContent="لا توجد إعدادات API محفوظة.";
    configs.forEach(c=>{
      const supplier=suppliers.find(s=>s.id===c.supplier_id);
      const labels={not_configured:"غير مهيأ",pending_credentials:"بانتظار بيانات الاتصال",ready:"جاهز بعد التحقق",degraded:"يعمل مع تحذير",offline:"متوقف",disabled:"معطّل"};
      const card=opsNode("article","ops-item");
      card.append(opsNode("strong","",opsText(supplier?.name)+" — "+(labels[c.connection_status]||c.connection_status)));
      card.append(opsNode("div","ops-muted","الموصل: "+c.adapter_key+" | التكامل: "+(c.integration_enabled?"قيد التجهيز":"غير مفعّل")));
      card.append(opsNode("div","ops-muted","التنفيذ الحقيقي: "+(c.execution_enabled?"مفعّل":"متوقف للحماية")));
      card.append(opsNode("div","ops-muted","آخر فحص رصيد: "+opsDate(c.last_balance_check_at)+" | الرصيد: "+(c.last_balance===null?"غير معروف":opsMoney(c.last_balance,c.balance_currency))));
      if(c.last_error)card.append(opsNode("div","ops-muted","آخر خطأ: "+c.last_error));
      statusBox.appendChild(card);
    });
  }
  if(eventsBox){
    eventsBox.replaceChildren();
    const events=Array.isArray(integration.events)?integration.events:[];
    if(!events.length)eventsBox.textContent="لا توجد أحداث اتصال مسجلة.";
    events.forEach(e=>{
      const card=opsNode("article","ops-item");
      card.append(opsNode("strong","",e.event_type+" — "+e.message),
        opsNode("div","ops-muted","الخطورة: "+e.severity+" | "+opsDate(e.created_at)));
      if(e.details)card.append(opsNode("div","ops-muted",JSON.stringify(e.details)));
      eventsBox.appendChild(card);
    });
  }
  if(attemptsBox){
    attemptsBox.replaceChildren();
    const attempts=Array.isArray(integration.attempts)?integration.attempts:[];
    if(!attempts.length)attemptsBox.textContent="لا توجد محاولات تنفيذ مسجلة.";
    attempts.forEach(a=>{
      const card=opsNode("article","ops-item");
      card.append(opsNode("strong","","طلب "+String(a.order_id||"").slice(0,8)+" — "+a.attempt_status),
        opsNode("div","ops-muted","المحاولة: "+a.attempt_number+" | رقم المورد: "+opsText(a.supplier_reference)),
        opsNode("div","ops-muted",opsDate(a.created_at)));
      if(a.error_message)card.append(opsNode("div","ops-muted",a.error_message));
      attemptsBox.appendChild(card);
    });
  }
}
async function opsSaveSupplierApiConfig(){
  const message=document.getElementById("opsApiMessage");
  const supplierId=document.getElementById("opsApiSupplierSelect")?.value;
  if(!supplierId){message.textContent="اختر المورد أولاً.";return;}
  const value=id=>document.getElementById(id)?.value??"";
  const payload={action:"supplier_api_config_save",supplier_id:supplierId,
    adapter_key:value("opsApiAdapter"),api_base_url:value("opsApiBaseUrl").trim()||null,
    health_path:value("opsApiHealthPath").trim()||null,balance_path:value("opsApiBalancePath").trim()||null,
    create_order_path:value("opsApiCreatePath").trim()||null,order_status_path:value("opsApiStatusPath").trim()||null,
    auth_secret_name:value("opsApiSecretName").trim()||null,auth_header_name:value("opsApiHeaderName").trim()||"Authorization",
    auth_prefix:value("opsApiPrefix"),low_balance_threshold:Number(value("opsApiLowBalance")||0),
    balance_currency:value("opsApiCurrency"),integration_enabled:document.getElementById("opsApiEnabled")?.checked===true};
  message.textContent="جاري حفظ الإعدادات التحضيرية...";
  try{
    await callAdminApi("POST",payload);
    message.textContent="تم حفظ الإعدادات. التنفيذ التلقائي ما زال متوقفاً، ولم يتم الاتصال بالمورد.";
    await loadAdminPanel();
    const select=document.getElementById("opsApiSupplierSelect");if(select)select.value=supplierId;
  }catch(error){message.textContent="تعذر حفظ الإعدادات: "+error.message;}
}
async function opsSimulateSupplierApi(){
  const message=document.getElementById("opsApiMessage");
  const supplierId=document.getElementById("opsApiSupplierSelect")?.value;
  if(!supplierId){message.textContent="اختر المورد أولاً.";return;}
  message.textContent="جاري فحص الحقول محلياً دون إرسال أي طلب...";
  try{
    const result=await callAdminApi("POST",{action:"supplier_api_simulate",supplier_id:supplierId});
    const s=result.simulation||{};
    message.textContent=(s.message||"اكتمل الفحص المحلي.")+" "+(s.missing_fields?.length?"الحقول الناقصة: "+s.missing_fields.join("، "):"لا توجد حقول أساسية ناقصة.");
    await loadAdminPanel();
    const select=document.getElementById("opsApiSupplierSelect");if(select)select.value=supplierId;
  }catch(error){message.textContent="تعذر الفحص المحلي: "+error.message;}
}

function renderOpsLoyalty(customers,loyaltyRows){
  const select=document.getElementById("opsLoyaltyCustomer");
  const box=document.getElementById("opsLoyaltyCustomers");
  const statsBox=document.getElementById("opsLoyaltyStats");
  const balances=new Map(loyaltyRows.map(row=>[row.user_id,row]));
  if(statsBox){
    const totalPoints=loyaltyRows.reduce((sum,row)=>sum+Number(row.points_balance||0),0);
    const lifetimePoints=loyaltyRows.reduce((sum,row)=>sum+Number(row.lifetime_earned||0),0);
    const activeMembers=loyaltyRows.filter(row=>Number(row.points_balance||0)>0).length;
    statsBox.replaceChildren();
    [["أعضاء البرنامج",customers.length],["أعضاء لديهم نقاط",activeMembers],["إجمالي النقاط الحالية",totalPoints],["النقاط المكتسبة تاريخياً",lifetimePoints]].forEach(([label,value])=>{
      const card=opsNode("div","ops-card");
      card.append(opsNode("div","ops-muted",label),opsNode("div","ops-value",Number(value).toLocaleString("en-US")));
      statsBox.appendChild(card);
    });
  }
  if(select){
    const old=select.value;select.replaceChildren();opsOption(select,"","اختر الزبون");
    customers.forEach(c=>opsOption(select,c.id,opsCustomerDisplayName(c)));
    if(old)select.value=old;
  }
  if(box){
    box.replaceChildren();
    if(!customers.length){box.textContent="لا توجد حسابات لعرضها.";return;}
    customers.forEach(c=>{
      const points=balances.get(c.id);
      const card=opsNode("div","ops-item");
      card.append(opsNode("strong","",opsCustomerDisplayName(c)));
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
  let inputSchema=[];
  try{
    const raw=document.getElementById("opsSupplierInputSchema")?.value.trim()||"[]";
    inputSchema=JSON.parse(raw);
    if(!Array.isArray(inputSchema))throw new Error("يجب أن تكون الحقول قائمة JSON.");
  }catch(error){message.textContent="صيغة حقول الطلب غير صحيحة: "+error.message;return;}
  if(!supplier||!product||!Number.isFinite(cost)||cost<0){message.textContent="اختر المورد والمنتج وأدخل تكلفة صحيحة.";return;}
  try{
    await callAdminApi("POST",{action:"supplier_product_save",supplier_id:supplier,product_id:product,
      supplier_sku:document.getElementById("opsSupplierSku").value,unit_cost:cost,
      currency:document.getElementById("opsCostCurrency").value,
      lead_time_hours:document.getElementById("opsLeadTime").value===""?null:Number(document.getElementById("opsLeadTime").value),
      is_preferred:document.getElementById("opsPreferredSupplier").checked,
      input_schema:inputSchema,
      notes:document.getElementById("opsSupplierProductNotes").value});
    message.textContent="تم حفظ ربط المورد وحقول البيانات المطلوبة للطلب.";
    await loadAdminPanel();
  }catch(error){message.textContent="تعذر حفظ الربط: "+error.message;}
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


function filterMyOrders(){
  const box=document.getElementById("customerOrdersList");
  if(!box)return;
  const query=(document.getElementById("customerOrderSearch")?.value||"").trim().toLocaleLowerCase();
  const status=document.getElementById("customerOrderStatusFilter")?.value||"all";
  const cards=[...box.querySelectorAll(".customer-order-card")];
  let visible=0;
  cards.forEach(card=>{
    const matchesText=!query||(card.dataset.orderSearch||card.textContent.toLocaleLowerCase()).includes(query);
    const matchesStatus=status==="all"||card.dataset.orderStatus===status;
    card.hidden=!(matchesText&&matchesStatus);
    if(!card.hidden)visible++;
  });
  const count=document.getElementById("customerOrderFilterCount");
  if(count)count.textContent=cards.length
    ? "عرض "+visible+" من أصل "+cards.length+" طلب"
    : "";
}

async function loadMyOrders(){
  const box=document.getElementById("customerOrdersList");
  if(!box||!currentUser)return;
  box.textContent="جاري تحميل طلباتك...";
  const labels={pending:"قيد المراجعة",processing:"قيد التنفيذ",awaiting_supplier:"بانتظار المورد",completed:"مكتمل",rejected:"مرفوض",cancelled:"ملغي"};
  const statusTone={pending:"pending",processing:"active",awaiting_supplier:"active",completed:"done",rejected:"failed",cancelled:"failed"};
  try{
    const {data:orders,error}=await sb.from("orders")
      .select("id,product_code,player_id,quantity,status,created_at,total_price_usd,total_price_syp")
      .eq("user_id",currentUser.id)
      .order("created_at",{ascending:false})
      .limit(50);
    if(error)throw error;
    box.replaceChildren();
    if(!orders?.length){
      const summary=document.getElementById("customerOrderSummary");
      if(summary){
        summary.replaceChildren();
        [["كل الطلبات","0"],["قيد التنفيذ","0"],["مكتملة","0"]].forEach(([label,value])=>{
          const stat=opsNode("div","customer-order-stat");
          stat.append(opsNode("span","",label),opsNode("strong","",value));
          summary.appendChild(stat);
        });
      }
      const count=document.getElementById("customerOrderFilterCount");
      if(count)count.textContent="";
      box.textContent="ما عندك طلبات مسجلة حالياً. لما تنشئ أول طلب، رح تلاقي تفاصيله وتحديثاته هون.";
      return;
    }
    const orderIds=orders.map(order=>order.id);
    const {data:events,error:eventError}=await sb.from("order_status_events")
      .select("id,order_id,old_status,new_status,customer_message,created_at")
      .in("order_id",orderIds)
      .order("created_at",{ascending:true});
    if(eventError)throw eventError;
    const eventsByOrder=new Map();
    (events||[]).forEach(event=>{
      if(!eventsByOrder.has(event.order_id))eventsByOrder.set(event.order_id,[]);
      eventsByOrder.get(event.order_id).push(event);
    });
    const summary=document.getElementById("customerOrderSummary");
    if(summary){
      const active=orders.filter(order=>["pending","processing","awaiting_supplier"].includes(order.status)).length;
      const completed=orders.filter(order=>order.status==="completed").length;
      summary.replaceChildren();
      [["كل الطلبات",orders.length],["قيد التنفيذ",active],["مكتملة",completed]].forEach(([label,value])=>{
        const stat=opsNode("div","customer-order-stat");
        stat.append(opsNode("span","",label),opsNode("strong","",String(value)));
        summary.appendChild(stat);
      });
    }
    orders.forEach(order=>{
      const card=opsNode("article","ops-item customer-order-card");
      card.dataset.orderStatus=order.status||"";
      card.dataset.orderSearch=[order.id,order.id.slice(0,8),order.product_code,order.player_id||""].join(" ").toLocaleLowerCase();
      card.dataset.notificationEntityId=order.id;
      const top=opsNode("div","customer-order-top");
      top.append(
        opsNode("strong","","طلب #"+order.id.slice(0,8)),
        opsNode("span","order-status-pill "+(statusTone[order.status]||"pending"),labels[order.status]||order.status)
      );
      card.appendChild(top);
      card.append(opsNode("div","","المنتج: "+opsText(order.product_code)+" | الكمية: "+order.quantity));
      if(order.player_id)card.append(opsNode("div","","معرّف اللاعب: "+opsText(order.player_id)));
      card.append(opsNode("div","ops-muted","تاريخ الطلب: "+opsDate(order.created_at)));
      if(order.total_price_usd!==null||order.total_price_syp!==null){
        const totals=[];
        if(order.total_price_usd!==null)totals.push(opsMoney(order.total_price_usd,"USD"));
        if(order.total_price_syp!==null)totals.push(opsMoney(order.total_price_syp,"SYP"));
        card.append(opsNode("div","ops-muted","إجمالي الطلب: "+totals.join(" | ")));
      }
      const timeline=opsNode("div","order-timeline");
      timeline.appendChild(opsNode("strong","","سجل متابعة الطلب"));
      const history=eventsByOrder.get(order.id)||[];
      if(!history.length){
        timeline.appendChild(opsNode("div","ops-muted","تم استلام الطلب. سيظهر هنا كل تحديث جديد."));
      }else{
        history.forEach((event,index)=>{
          const item=opsNode("div","order-timeline-item");
          item.appendChild(opsNode("span","order-timeline-dot "+(index===history.length-1?"current":"")));
          const content=opsNode("div","order-timeline-content");
          content.append(
            opsNode("strong","",labels[event.new_status]||event.new_status),
            opsNode("time","ops-muted",opsDate(event.created_at))
          );
          if(event.customer_message)content.appendChild(opsNode("p","",event.customer_message));
          item.appendChild(content);
          timeline.appendChild(item);
        });
      }
      card.appendChild(timeline);
      box.appendChild(card);
    });
    filterMyOrders();
  }catch(error){
    const summary=document.getElementById("customerOrderSummary");
    if(summary)summary.replaceChildren();
    box.textContent="تعذر تحميل الطلبات حالياً. حاول التحديث مرة أخرى.";
    console.error("Baran order tracking:",error);
  }
}
async function loadMyRewards(){
  const balanceBox=document.getElementById("customerLoyaltyBalance");
  const historyBox=document.getElementById("customerLoyaltyHistory");
  const tierBox=document.getElementById("customerLoyaltyTier");
  if(!balanceBox||!historyBox||!currentUser)return;
  balanceBox.textContent="جاري تحميل رصيد النقاط...";
  if(tierBox)tierBox.textContent="جاري تحميل مستوى عضويتك...";
  try{
    const [{data:account,error},{data:history,error:historyError},{data:tiers,error:tiersError}]=await Promise.all([
      sb.from("customer_loyalty").select("points_balance,lifetime_earned,updated_at").eq("user_id",currentUser.id).maybeSingle(),
      sb.from("loyalty_transactions").select("points,transaction_type,description,created_at")
        .eq("user_id",currentUser.id).order("created_at",{ascending:false}).limit(50),
      sb.from("loyalty_tiers").select("tier_code,tier_name,min_lifetime_points,sort_order,badge_emoji,benefits")
        .eq("is_active",true).order("sort_order",{ascending:true})
    ]);
    if(error)throw error;if(historyError)throw historyError;if(tiersError)throw tiersError;
    const lifetime=Number(account?.lifetime_earned||0);
    const ordered=Array.isArray(tiers)?tiers:[];
    const current=[...ordered].reverse().find(t=>lifetime>=Number(t.min_lifetime_points))||ordered[0];
    const next=ordered.find(t=>Number(t.min_lifetime_points)>lifetime);
    if(tierBox){
      tierBox.replaceChildren();
      const head=opsNode("div","ops-muted","مستوى عضويتك في BARAN VIP");
      const name=opsNode("div","ops-value",(current?.badge_emoji||"⭐")+" "+(current?.tier_name||"برونزي"));
      const progress=opsNode("div","ops-muted",next
        ? "تحتاج "+Math.max(0,Number(next.min_lifetime_points)-lifetime).toLocaleString("en-US")+" نقطة مكتسبة للوصول إلى "+next.tier_name
        : "وصلت إلى أعلى مستوى عضوية!");
      tierBox.append(head,name,progress);
      if(current?.benefits?.length){
        const benefits=opsNode("div","ops-list");
        current.benefits.forEach(item=>benefits.appendChild(opsNode("div","ops-muted","✓ "+item)));
        tierBox.appendChild(benefits);
      }
      if(next){
        const track=opsNode("div","ops-muted","التقدم: "+Math.min(100,Math.floor(lifetime/Math.max(1,Number(next.min_lifetime_points))*100))+"%");
        tierBox.appendChild(track);
      }
    }
    balanceBox.replaceChildren();
    balanceBox.append(opsNode("div","ops-muted","رصيد نقاطك الحالي"),
      opsNode("div","ops-value",Number(account?.points_balance||0).toLocaleString("en-US")+" نقطة"),
      opsNode("div","ops-muted","إجمالي النقاط المكتسبة: "+lifetime.toLocaleString("en-US")),
      opsNode("div","ops-muted","كل 1,000 نقطة = قسيمة 1$. اكتساب النقاط يتضاعف حسب مستوى VIP، بسقف ربح يبدأ من 5% في Bronze ويصل إلى 10% في Platinum حسب مستوى VIP."));
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
    if(tierBox)tierBox.textContent="تعذر تحميل مستوى العضوية.";
    historyBox.replaceChildren();
  }
}

async function opsSaveFulfillment(orderId){
  const supplier=document.getElementById("opsFulfillmentSupplier_"+orderId).value||null;
  const reference=document.getElementById("opsFulfillmentRef_"+orderId).value.trim();
  const status=document.getElementById("opsFulfillmentStatus_"+orderId).value;
  const notes=document.getElementById("opsFulfillmentNotes_"+orderId).value.trim();
  const costInput=document.getElementById("opsFulfillmentCost_"+orderId).value;
  const cost=costInput===""?null:Number(costInput);
  const costCurrency=document.getElementById("opsFulfillmentCostCurrency_"+orderId).value;
  if(cost!==null&&(!Number.isFinite(cost)||cost<0)){
    document.getElementById("adminMessage").textContent="أدخل تكلفة مورد صحيحة أو اتركها فارغة.";
    return;
  }
  try{
    await callAdminApi("POST",{action:"order_fulfillment_update",order_id:orderId,
      supplier_id:supplier,supplier_reference:reference,supplier_status:status,internal_notes:notes,
      supplier_unit_cost:cost,supplier_cost_currency:costCurrency});
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


/* BARAN promotions manager — isolated from all assistant and finance workflows */
let baranPromotionsCache={products:[],coupons:[],campaigns:[]};
function promoSelectedProducts(prefix){
  return Array.from(document.querySelectorAll('input[name="'+prefix+'"]:checked')).map(el=>el.value);
}
function promoRenderProducts(rows){
  ["promoCouponProducts","promoCampaignProducts"].forEach((id,index)=>{
    const box=document.getElementById(id);if(!box)return;box.replaceChildren();
    const group=index===0?"promoCouponProduct":"promoCampaignProduct";
    if(!rows.length){box.textContent="لا توجد منتجات فعالة حالياً.";return;}
    rows.forEach(p=>{
      const label=document.createElement("label");label.className="ops-muted";label.style.display="flex";label.style.gap="8px";label.style.alignItems="center";
      const input=document.createElement("input");input.type="checkbox";input.name=group;input.value=p.product_code;
      const span=document.createElement("span");span.textContent=(p.name||p.product_code)+" · "+p.category;
      label.append(input,span);box.appendChild(label);
    });
  });
}
function promoDateValue(id){
  const value=document.getElementById(id)?.value;
  return value?new Date(value).toISOString():null;
}
function promoMessage(id,message,isError=false){
  const el=document.getElementById(id);if(el){el.textContent=message;el.style.color=isError?"#ff9b9b":"#b9e8c9";}
}
function promoCouponTypeChanged(){
  const fixed=document.getElementById("promoCouponType")?.value==="fixed";
  document.getElementById("promoCouponCurrencyWrap")?.classList.toggle("hidden",!fixed);
}
async function baranPromotionsRpc(action,payload={}){
  if(typeof sb==="undefined"||!currentUser)throw new Error("سجّل الدخول بحساب الإدارة أولاً.");
  const {data,error}=await sb.rpc("baran_admin_promotions",{p_action:action,p_payload:payload});
  if(error)throw error;return data||{};
}
async function loadBaranPromotionsManager(){
  const couponsBox=document.getElementById("promoCouponsList");
  if(!couponsBox)return;
  couponsBox.textContent="جاري تحميل بيانات العروض...";
  try{
    const data=await baranPromotionsRpc("list");
    baranPromotionsCache={products:data.products||[],coupons:data.coupons||[],campaigns:data.campaigns||[]};
    promoRenderProducts(baranPromotionsCache.products);
    promoRenderSavedLists();
    promoCouponTypeChanged();
  }catch(error){
    couponsBox.textContent="تعذر تحميل القسم: "+(error.message||"تحقق من صلاحية حساب الإدارة.");
    const campaigns=document.getElementById("promoCampaignsList");if(campaigns)campaigns.textContent="تعذر تحميل البيانات.";
  }
}
function promoRenderSavedLists(){
  const coupons=document.getElementById("promoCouponsList");
  const campaigns=document.getElementById("promoCampaignsList");
  if(coupons){coupons.replaceChildren();if(!baranPromotionsCache.coupons.length)coupons.textContent="لا توجد كوبونات محفوظة.";
    baranPromotionsCache.coupons.forEach(c=>{
      const card=opsNode("article","ops-card");
      card.append(opsNode("strong","",c.code+" — "+c.title),opsNode("p","",c.discount_type==="percent"?(c.discount_value+"% خصم"):(c.discount_value+" "+(c.currency||""))),
        opsNode("div","ops-muted","المنتجات: "+(c.product_codes||[]).join("، ")+" | الاستخدامات: "+c.redeemed_count+" | "+(c.is_active?"مفعّل":"مسودة غير مفعّلة")));
      coupons.appendChild(card);
    });
  }
  if(campaigns){campaigns.replaceChildren();if(!baranPromotionsCache.campaigns.length)campaigns.textContent="لا توجد عروض محفوظة.";
    baranPromotionsCache.campaigns.forEach(c=>{
      const card=opsNode("article","ops-card");
      card.append(opsNode("strong","",c.title),opsNode("p","",c.description||""),
        opsNode("div","ops-muted","المنتجات: "+(c.product_codes||[]).join("، ")+" | الحالة: "+c.status));
      const actions=opsNode("div","ops-actions");
      [["draft","مسودة"],["published","نشر العرض"],["paused","إيقاف"]].forEach(([status,label])=>{
        const button=opsNode("button","secondary",label);button.type="button";button.disabled=c.status===status;
        button.onclick=async()=>{button.disabled=true;try{await baranPromotionsRpc("campaign_status",{id:c.id,status});await loadBaranPromotionsManager();}catch(e){button.disabled=false;alert("تعذر تحديث العرض: "+(e.message||""));}};
        actions.appendChild(button);
      });
      card.appendChild(actions);campaigns.appendChild(card);
    });
  }
}
async function saveBaranCouponDraft(){
  const message="promoCouponMessage";
  try{
    const payload={code:document.getElementById("promoCouponCode").value.trim().toUpperCase(),title:document.getElementById("promoCouponTitle").value.trim(),
      description:document.getElementById("promoCouponDescription").value.trim(),discount_type:document.getElementById("promoCouponType").value,
      discount_value:document.getElementById("promoCouponValue").value,currency:document.getElementById("promoCouponCurrency").value,
      min_order_amount:document.getElementById("promoCouponMin").value,max_redemptions:document.getElementById("promoCouponLimit").value,
      per_user_limit:document.getElementById("promoCouponUserLimit").value,starts_at:promoDateValue("promoCouponStart"),ends_at:promoDateValue("promoCouponEnd"),
      product_codes:promoSelectedProducts("promoCouponProduct")};
    await baranPromotionsRpc("save_coupon",payload);
    promoMessage(message,"تم حفظ الكوبون كمسودة غير مفعّلة. لم يُطبّق أي خصم.");
    ["promoCouponCode","promoCouponTitle","promoCouponDescription","promoCouponValue","promoCouponLimit","promoCouponStart","promoCouponEnd"].forEach(id=>{const el=document.getElementById(id);if(el)el.value="";});
    document.querySelectorAll('input[name="promoCouponProduct"]').forEach(el=>el.checked=false);
    await loadBaranPromotionsManager();
  }catch(error){promoMessage(message,error.message||"تعذر حفظ الكوبون.",true);}
}
async function saveBaranCampaignDraft(){
  const message="promoCampaignMessage";
  try{
    const payload={title:document.getElementById("promoCampaignTitle").value.trim(),badge_text:document.getElementById("promoCampaignBadge").value.trim(),
      description:document.getElementById("promoCampaignDescription").value.trim(),starts_at:promoDateValue("promoCampaignStart"),
      ends_at:promoDateValue("promoCampaignEnd"),priority:document.getElementById("promoCampaignPriority").value,
      product_codes:promoSelectedProducts("promoCampaignProduct")};
    await baranPromotionsRpc("save_campaign",payload);
    promoMessage(message,"تم حفظ العرض كمسودة. لا يوجد خصم مالي مرتبط به.");
    ["promoCampaignTitle","promoCampaignDescription","promoCampaignStart","promoCampaignEnd"].forEach(id=>{const el=document.getElementById(id);if(el)el.value="";});
    document.querySelectorAll('input[name="promoCampaignProduct"]').forEach(el=>el.checked=false);
    await loadBaranPromotionsManager();
  }catch(error){promoMessage(message,error.message||"تعذر حفظ العرض.",true);}
}


let homscardCatalogCache=[];
function renderHomsCardCatalog(){
  const toolsBox=document.getElementById('opsHomsCatalogTools');
  const results=document.getElementById('opsHomsCatalogResults');
  const count=document.getElementById('opsHomsCatalogCount');
  const search=document.getElementById('opsHomsCatalogSearch');
  const category=document.getElementById('opsHomsCatalogCategory');
  const availability=document.getElementById('opsHomsCatalogAvailability');
  if(!toolsBox||!results||!count||!search||!category||!availability)return;
  toolsBox.classList.remove('hidden');
  const term=String(search.value||'').trim().toLocaleLowerCase();
  const selectedCategory=category.value;
  const selectedAvailability=availability.value;
  const filtered=homscardCatalogCache.filter(p=>{
    const haystack=[p.name,p.category,p.code,p.product_code,p.id].map(v=>String(v??'')).join(' ').toLocaleLowerCase();
    if(term&&!haystack.includes(term))return false;
    if(selectedCategory&&String(p.category??'')!==selectedCategory)return false;
    if(selectedAvailability==='available'&&!p.available)return false;
    if(selectedAvailability==='unavailable'&&p.available)return false;
    return true;
  });
  count.textContent='عرض '+filtered.length+' من أصل '+homscardCatalogCache.length+' منتج';
  results.replaceChildren();
  if(!filtered.length){results.appendChild(opsNode('div','homscard-empty','ما لقينا منتجات مطابقة. جرّب كلمة بحث أو تصنيفاً آخر.'));return;}
  const fragment=document.createDocumentFragment();
  filtered.forEach(p=>{
    const row=opsNode('article','homscard-product-row');
    const info=opsNode('div','');
    info.appendChild(opsNode('div','homscard-product-name',opsText(p.name)));
    info.appendChild(opsNode('div','homscard-product-meta','التصنيف: '+opsText(p.category)+(p.code||p.product_code?' | الرمز: '+opsText(p.code||p.product_code):'')));
    info.appendChild(opsNode('div','homscard-product-state'+(p.available?'':' unavailable'),p.available?'متوفر':'غير متوفر'));
    const metadata=opsNode('details','homscard-product-meta');
    metadata.appendChild(opsNode('summary','','تفاصيل نوع المنتج والطلب'));
    const formatCatalogValue=value=>{
      if(value===null||value===undefined||value==='')return 'غير متوفر في بيانات المورد';
      let formatted;
      try{formatted=typeof value==='string'?value:JSON.stringify(value);}catch(_){formatted=String(value);}
      return String(formatted).slice(0,1200);
    };
    metadata.append(
      opsNode('div','homscard-product-meta','معرّف المورد: '+opsText(p.id)),
      opsNode('div','homscard-product-meta','نوع المنتج: '+formatCatalogValue(p.product_type)),
      opsNode('div','homscard-product-meta','خيارات الكمية qty_values: '+formatCatalogValue(p.qty_values)),
      opsNode('div','homscard-product-meta','البيانات المطلوبة params: '+formatCatalogValue(p.params))
    );
    info.appendChild(metadata);
    row.append(info,opsNode('div','homscard-product-price',opsText(p.price)+' USD'));
    fragment.appendChild(row);
  });
  results.appendChild(fragment);
}

function homscardAutoAuditParse(value){
  if(value===null||value===undefined||value==="")return null;
  if(typeof value!=="string")return value;
  try{return JSON.parse(value);}catch(_){return value;}
}
function homscardAutoAuditText(value){
  return String(value??"").normalize("NFKC").toLocaleLowerCase().replace(/[ـًٌٍَُِّْ]/g," ").replace(/\s+/g," ").trim();
}
function homscardAutoAuditNumber(value){
  if(typeof value==="number")return Number.isFinite(value)&&value>0?value:null;
  if(typeof value!=="string")return null;
  const s=value.trim().replace(/,/g,".");
  if(!/^\d+(?:\.\d+)?$/.test(s))return null;
  const n=Number(s);
  return Number.isFinite(n)&&n>0?n:null;
}
function homscardAutoAuditQuantities(value){
  const root=homscardAutoAuditParse(value),found=[];
  const seen=new Set();
  const add=(v)=>{const n=homscardAutoAuditNumber(v);if(n!==null&&!seen.has(n)){seen.add(n);found.push(n);}};
  const visit=(node,depth=0)=>{
    if(depth>7||node===null||node===undefined)return;
    if(typeof node==="number"||typeof node==="string"){add(node);return;}
    if(Array.isArray(node)){node.forEach(v=>visit(v,depth+1));return;}
    if(typeof node==="object"){
      const keys=["value","quantity","qty","amount","count","units","min","max"];
      let used=false;
      for(const key of keys)if(Object.prototype.hasOwnProperty.call(node,key)){add(node[key]);used=true;}
      if(!used){
        for(const [key,val] of Object.entries(node)){
          if(/^\d+(?:\.\d+)?$/.test(key)&&(val===true||val===1||val==="1"))add(key);
          else if(typeof val==="object"||Array.isArray(val))visit(val,depth+1);
          else if(typeof val==="string"&&/^\d+(?:\.\d+)?$/.test(val))add(val);
        }
      }
    }
  };
  visit(root);
  return found.sort((a,b)=>a-b);
}
function homscardAutoAuditKeys(value){
  const root=homscardAutoAuditParse(value),found=[],seen=new Set();
  const add=(v)=>{
    if(typeof v!=="string")return;
    const s=v.trim();
    if(!s||s.length>120||/^\d+$/.test(s))return;
    const k=s.toLocaleLowerCase();
    if(!seen.has(k)){seen.add(k);found.push(s);}
  };
  const visit=(node,depth=0)=>{
    if(depth>7||node===null||node===undefined)return;
    if(typeof node==="string"){
      const s=node.trim();
      if((s.startsWith("{")&&s.endsWith("}"))||(s.startsWith("[")&&s.endsWith("]"))){
        try{visit(JSON.parse(s),depth+1);return;}catch(_){}
      }
      add(s);return;
    }
    if(Array.isArray(node)){node.forEach(v=>visit(v,depth+1));return;}
    if(typeof node==="object"){
      for(const [key,val] of Object.entries(node)){
        if(!/^\d+$/.test(key))add(key);
        if(typeof val==="string")add(val);
        else if(val&&typeof val==="object")visit(val,depth+1);
      }
    }
  };
  visit(root);
  return found;
}
function homscardAutoAuditOne(p){
  const name=String(p.name||""),category=String(p.category||"");
  const type=homscardAutoAuditText(p.product_type||"");
  const text=homscardAutoAuditText(name+" "+category);
  const params=Array.isArray(p.params)?p.params:(p.params==null?[]:[p.params]);
  const keys=homscardAutoAuditKeys(params),paramText=homscardAutoAuditText(keys.join(" "));
  const options=homscardAutoAuditQuantities(p.qty_values);
  const subscriptionWords=/(اشتراك|شهري|شهر|سنوي|سنة|أسبوع|يوم|subscription|monthly|month|annual|yearly|weekly|duration|days?)/i;
  const accountWords=/(player.?id|user.?id|uid|account|server|zone|email|login|معرف|آيدي|سيرفر|حساب|بريد|رقم اللاعب)/i;
  const typeSubscription=/^(subscription|membership|time|duration)$/i.test(type);
  const typeVariable=/^(quantity|variable|top.?up|recharge|amount|custom)$/i.test(type);
  const hasDuration=subscriptionWords.test(text)||typeSubscription;
  const hasVariableEvidence=options.length>0||typeVariable;
  const hasPackEvidence=/(شدات|جواهر|توكن|كوين|عملات|uc|diamond|gem|token|coin|credits|points)/i.test(text)&&/\d/.test(text);
  let kind="غير محسوم",confidence="منخفض",reason="المعلومات المتاحة لا تكفي لتحديد طريقة البيع دون تخمين.";
  if(hasDuration){
    kind="اشتراك بمدة محتملة";
    confidence=typeSubscription?"متوسط":"منخفض";
    reason=typeSubscription?"نوع المورد يشير إلى اشتراك؛ يلزم تأكيد المدة والتفعيل.":"الاسم يتضمن إشارة زمنية؛ قد تكون وصفاً فقط وليست مدة اشتراك مؤكدة.";
  }else if(hasVariableEvidence){
    kind="كمية متغيرة محتملة";
    confidence=options.length?"متوسط":"منخفض";
    reason=options.length?"توجد قيم كمية منظمة؛ هذا لا يثبت أن سعر المورد سعر وحدة.":"نوع المورد يوحي بكمية متغيرة لكن خيارات الكمية غير متاحة.";
  }else if(hasPackEvidence){
    kind="باقة ثابتة محتملة";
    confidence="منخفض";
    reason="الاسم يوحي بباقة ذات قيمة محددة؛ لم يتوفر دليل بنيوي يؤكد ثباتها.";
  }
  const price=homscardAutoAuditNumber(p.price);
  const account=accountWords.test(paramText);
  const missing=[];
  if(!p.product_type||type==="package")missing.push("نوع المنتج قد يكون افتراضياً من الموصل");
  if(!p.qty_values)missing.push("لا توجد خيارات كمية مؤكدة");
  if(!params.length)missing.push("لا توجد حقول إدخال ظاهرة");
  if(price===null)missing.push("السعر غير رقمي أو غير صالح");
  return {p,kind,confidence,reason,options,keys,account,price,missing,hasDuration,hasVariableEvidence,hasPackEvidence};
}
function homscardAutoAuditSelfTests(){
  const cases=[
    [{name:"PUBG 60 UC",product_type:"package",price:"1.2"}, "باقة ثابتة محتملة"],
    [{name:"Free Fire",product_type:"package",price:1}, "غير محسوم"],
    [{name:"شحن حسب الكمية",product_type:"quantity",qty_values:[100,500],price:0.2}, "كمية متغيرة محتملة"],
    [{name:"شحن",qty_values:100,price:0.2}, "كمية متغيرة محتملة"],
    [{name:"اشتراك شهري",product_type:"package"}, "اشتراك بمدة محتملة"],
    [{name:"VPN Premium 30 days",product_type:"package"}, "اشتراك بمدة محتملة"],
    [{name:"Game credits",product_type:"package"}, "غير محسوم"],
    [{name:"خدمة",product_type:"package",qty_values:"غير محدد"}, "غير محسوم"],
    [{name:"منتج",product_type:"package",qty_values:[{"quantity":"1000"}]}, "كمية متغيرة محتملة"]
  ];
  const failures=cases.filter(([input,expected])=>homscardAutoAuditOne(input).kind!==expected);
  return {total:cases.length,passed:cases.length-failures.length,failures:failures.map(([input,expected])=>({name:input.name,expected,actual:homscardAutoAuditOne(input).kind}))};
}
function homscardRunAutomaticAudit(){
  const output=document.getElementById("opsHomsAutoAuditResults"),status=document.getElementById("opsHomsAutoAuditStatus");
  if(!output||!status)return;
  if(!Array.isArray(homscardCatalogCache)||!homscardCatalogCache.length){status.textContent="حمّل كتالوج حمص كارد أولاً.";return;}
  const rows=homscardCatalogCache.map(homscardAutoAuditOne);
  const labels=["كمية متغيرة محتملة","باقة ثابتة محتملة","اشتراك بمدة محتملة","غير محسوم"];
  const counts=Object.fromEntries(labels.map(label=>[label,rows.filter(r=>r.kind===label).length]));
  const tests=homscardAutoAuditSelfTests();
  status.textContent="اكتمل فحص "+rows.length+" منتجاً: "+(rows.length-counts["غير محسوم"])+" تصنيفاً مبدئياً، و"+counts["غير محسوم"]+" تحتاج مراجعة. الاختبارات الداخلية: "+tests.passed+"/"+tests.total;
  output.replaceChildren();
  const summary=opsNode("div","ops-stats-grid");
  labels.forEach(label=>{const card=opsNode("div","ops-card");card.append(opsNode("strong","",String(counts[label])),opsNode("div","ops-muted",label));summary.appendChild(card);});
  output.appendChild(summary);
  output.appendChild(opsNode("p","ops-muted","التصنيفات استدلالية وليست اعتماداً تجارياً. لا نعتبر package دليلاً لأن الموصل قد يضعها كقيمة افتراضية. لا نحسب تكلفة كمية ولا نفترض أن السعر سعر وحدة."));
  const testBox=opsNode("div","ops-muted",tests.failures.length?"فشل اختبار داخلي: "+JSON.stringify(tests.failures):"اجتازت قواعد التصنيف الاختبارات الداخلية.");
  output.appendChild(testBox);
  const list=opsNode("div","ops-list");
  rows.sort((a,b)=>labels.indexOf(b.kind)-labels.indexOf(a.kind));
  rows.forEach(r=>{
    const d=opsNode("details","ops-item");d.appendChild(opsNode("summary","",opsText(r.p.name)+" — "+r.kind+" · ثقة "+r.confidence));
    d.append(opsNode("div","ops-muted","معرّف المورد: "+opsText(r.p.id)+" | التصنيف: "+opsText(r.p.category)),
      opsNode("div","ops-muted","السبب: "+r.reason),
      opsNode("div","ops-muted","نوع المورد: "+opsText(r.p.product_type||"غير محدد")),
      opsNode("div","ops-muted","سعر المورد كما ورد: "+opsText(r.p.price??"غير متاح")+" USD — لم تُحسب تكلفة كمية"),
      opsNode("div","ops-muted","خيارات كمية رقمية مستخرجة: "+(r.options.length?r.options.join("، "):"غير ظاهرة")),
      opsNode("div","ops-muted","حقول الطلب: "+(r.keys.length?r.keys.slice(0,20).join("، "):"غير ظاهرة")),
      opsNode("div","ops-muted","بيانات حساب/لاعب محتملة: "+(r.account?"نعم، راجع الحقول يدوياً":"غير ظاهرة")),
      opsNode("div","ops-muted","نواقص/تحذيرات: "+(r.missing.length?r.missing.join("؛ "):"لا توجد نواقص شكلية ظاهرة")));
    list.appendChild(d);
  });
  output.appendChild(list);
}
function homscardEnsureAutoAuditUi(){
  const toolsBox=document.getElementById("opsHomsCatalogTools");
  if(!toolsBox||document.getElementById("opsHomsAutoAuditButton"))return;
  const button=opsNode("button","secondary","🧠 فحص وتصنيف كل المنتجات تلقائياً");
  button.type="button";button.id="opsHomsAutoAuditButton";button.onclick=homscardRunAutomaticAudit;
  const status=opsNode("div","ops-muted","حمّل الكتالوج ثم ابدأ الفحص التلقائي.");status.id="opsHomsAutoAuditStatus";
  const output=opsNode("div","ops-list");output.id="opsHomsAutoAuditResults";
  const search=document.getElementById("opsHomsCatalogSearch");
  if(search&&search.parentNode===toolsBox){toolsBox.insertBefore(button,search);toolsBox.insertBefore(status,search);toolsBox.insertBefore(output,search);}
  else toolsBox.prepend(output,status,button);
}

function initHomsCardCatalogFilters(products){
  homscardEnsureAutoAuditUi();
  const category=document.getElementById('opsHomsCatalogCategory');
  const search=document.getElementById('opsHomsCatalogSearch');
  const availability=document.getElementById('opsHomsCatalogAvailability');
  if(category){
    category.replaceChildren(new Option('كل التصنيفات',''));
    [...new Set(products.map(p=>String(p.category??'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ar')).forEach(value=>category.appendChild(new Option(value,value)));
  }
  if(search&&!search.dataset.bound){search.addEventListener('input',renderHomsCardCatalog);search.dataset.bound='1';}
  if(category&&!category.dataset.bound){category.addEventListener('change',renderHomsCardCatalog);category.dataset.bound='1';}
  if(availability&&!availability.dataset.bound){availability.addEventListener('change',renderHomsCardCatalog);availability.dataset.bound='1';}
  renderHomsCardCatalog();
}
async function opsTestHomsCard(action){
  const message=document.getElementById('opsApiMessage');
  const output=document.getElementById('opsHomsCardResult');
  if(message)message.textContent=action==='profile'?'جاري فحص اتصال حمص كارد وقراءة الحساب...':'جاري جلب كتالوج حمص كارد للمعاينة فقط...';
  if(output)output.replaceChildren();
  try{
    const {data,error}=await sb.functions.invoke('baran-homscard-connector',{body:{action}});
    if(error)throw new Error(error.message||'تعذر الاتصال بالدالة.');
    if(!data?.success)throw new Error(data?.error||'لم ينجح فحص المورد.');
    if(action==='profile'){
      const p=data.data||{};
      if(output)output.append(opsNode('strong','','اتصال حمص كارد ناجح'),opsNode('div','ops-muted','الرصيد: '+opsText(p.balance)+' '+opsText(p.currency)),opsNode('div','ops-muted','خصم الحساب: '+opsText(p.discount)+'%'),opsNode('div','ops-muted','الحساب: '+opsText(p.name)));
      if(message)message.textContent='تم فحص الملف الشخصي بنجاح. لم يتم إنشاء أي طلب.';
    }else{
      homscardCatalogCache=Array.isArray(data.data)?data.data:[];
      if(output)output.appendChild(opsNode('strong','','تم استرجاع '+homscardCatalogCache.length+' منتج من حمص كارد.'));
      initHomsCardCatalogFilters(homscardCatalogCache);
      if(message)message.textContent='تم جلب الكتالوج بنجاح. استخدم البحث والتصنيفات لمراجعة المنتجات؛ لم يتم استيراد أو تعديل أي منتج.';
    }
  }catch(error){if(message)message.textContent='تعذر فحص حمص كارد: '+(error?.message||'خطأ غير معروف');}
}
