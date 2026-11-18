  async function loadOverview() {
    const content=$("baroMgmtContent"); if(!content)return;
    const orders=adminData.orders||[];
    const products=adminData.products||[];
    const pending=orders.filter(o=>!["completed","cancelled","failed"].includes(o.status)).length;
    content.innerHTML='<h3>مؤشرات تشغيل BARO</h3><div class="baro-mgmt-grid">'+
      stat("المنتجات المسجلة",products.length)+
      stat("المنتجات الظاهرة",products.filter(p=>p.catalog_visible===true).length)+
      stat("الطلبات الظاهرة",orders.length)+stat("طلبات قيد المتابعة",pending)+
      '</div><p class="baro-mgmt-muted">هذه الصفحة للتشغيل والكتالوج والطلبات فقط. جميع التكاليف وسعر الصرف والمبيعات والأرباح والحركات المالية موجودة في قسم «مالية BARO المستقلة» بلوحة الإدارة.</p>'+
      '<div class="baro-mgmt-actions"><button type="button" id="baroMgmtRefresh">تحديث بيانات BARO</button><button type="button" id="baroMgmtProducts" class="secondary">إدارة المنتجات</button><button type="button" id="baroMgmtOrders" class="secondary">إدارة الطلبات</button><button type="button" id="baroMgmtExportOrders" class="secondary">تصدير الطلبات CSV</button></div>';
    $("baroMgmtRefresh").onclick=refreshAll;
    $("baroMgmtProducts").onclick=()=>$("baroAdminProducts")?.scrollIntoView({behavior:"smooth"});
    $("baroMgmtOrders").onclick=()=>$("baroAdminOrders")?.scrollIntoView({behavior:"smooth"});
    $("baroMgmtExportOrders").onclick=()=>exportCsv("baro-orders.csv",[["id","product","player_id","quantity","status","payment_status","displayed_usd","displayed_syp","created_at"],...orders.map(o=>[o.id,o.product_name_snapshot,o.player_id,o.quantity,o.status,o.payment_status,o.displayed_price_usd_snapshot,o.displayed_price_syp_snapshot,o.created_at])]);
  }
  function exportCsv(filename, rows) {
    const csv=rows.map(r=>r.map(v=>'"'+String(v==null?"":v).replace(/"/g,'""')+'"').join(",")).join("\r\n");
    const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
  }

  async function loadFinance() {
    const content=$("baroFinanceMgmtContent")||$("baroMgmtContent");if(!content)return;
    if(!can("finance")){content.innerHTML='<div class="baro-mgmt-empty">لا تملك صلاحية هذا القسم.</div>';return;}
    financeData=await getView("finance");
    settingsData=can("settings")?await getView("settings").catch(()=>({settings:{}})):{settings:{}};
    const currentSettings=settingsData.settings||{};
    const entries=financeData.entries||[],t=financeData.totals||{};
    const products=(adminData.products||[]).filter(p=>Number(p.supplier_cost_usd)>0&&Number(p.sale_price_syp)>0);
    const rate=Number(currentSettings.usd_syp_rate||adminData.settings?.usd_syp_rate||156);
    const fmtSyp=v=>Number(v||0).toLocaleString("en-US",{maximumFractionDigits:0})+" SYP";
    const fmtUsd=v=>"$"+Number(v||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
    const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Damascus",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
    const part=k=>parts.find(x=>x.type===k)?.value||"";
    const today=part("year")+"-"+part("month")+"-"+part("day"),month=today.slice(0,7);
    const dateKey=value=>{
      const d=new Date(value);if(!Number.isFinite(d.getTime()))return "";
      const ps=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Damascus",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d);
      const get=k=>ps.find(x=>x.type===k)?.value||"";
      return get("year")+"-"+get("month")+"-"+get("day");
    };
    const posted=entries.filter(e=>e.status==="posted");
    const pending=entries.length-posted.length;
    const daily=entries.filter(e=>dateKey(e.created_at)===today);
    const monthly=entries.filter(e=>dateKey(e.created_at).slice(0,7)===month);
    const productRows=products.map(p=>{
      const costUsd=Number(p.supplier_cost_usd),costSyp=costUsd*rate;
      const saleSyp=Number(p.sale_price_syp),saleUsd=Number(p.sale_price_usd)>0?Number(p.sale_price_usd):saleSyp/rate;
      const profitSyp=saleSyp-costSyp,profitUsd=profitSyp/rate;
      const margin=saleSyp>0?profitSyp/saleSyp*100:0;
      return row([p.product_name,fmtUsd(costUsd),fmtSyp(costSyp),fmtUsd(saleUsd),fmtSyp(saleSyp),fmtSyp(profitSyp),fmtUsd(profitUsd),margin.toFixed(1)+"%"]);
    });
    const typeLabels={sale_received:"مبيعات مقبوضة",supplier_cost:"تكلفة مورد",expense:"مصروف",commission:"عمولة",refund:"مبلغ مسترد",adjustment:"تسوية"};
    content.innerHTML='<h3>الإدارة المالية المستقلة — BARO</h3>'+
      '<div class="baro-mgmt-panel"><h3>ملخص الدفتر المالي الفعلي</h3><p class="baro-mgmt-muted">كل الأرقام التالية من الحركات المسجلة فعلياً في دفتر BARO، وليست تقديرات. العملة المعروضة USD ما لم يُذكر غير ذلك.</p><div class="baro-mgmt-grid">'+
      stat("المبيعات المقبوضة",fmtUsd(t.sales||0))+stat("تكاليف الموردين",fmtUsd(t.supplier_costs||0))+
      stat("المصاريف",fmtUsd(t.expenses||0))+stat("العمولات",fmtUsd(t.commissions||0))+
      stat("المبالغ المستردة",fmtUsd(t.refunds||0))+stat("التسويات",fmtUsd(t.adjustments||0))+
      stat("صافي الربح المحقق",fmtUsd(t.net_profit||0))+stat("الحركات المرحلة",posted.length)+
      stat("حركات اليوم",daily.length)+stat("حركات الشهر",monthly.length)+
      stat("حركات بانتظار الترحيل",pending)+
      '</div><p class="baro-mgmt-muted">هذا الدفتر مستقل تماماً عن محافظ الزبائن والشحن الآلي.</p></div>'+
      '<div class="baro-mgmt-panel"><h3>تفصيل سعر وربحية كل باقة — تقديري قبل البيع</h3>'+
      '<p class="baro-mgmt-muted">سعر الصرف المستخدم: 1 USD = '+fmtSyp(rate)+'. الحساب: تكلفة المورد بالدولار × سعر الصرف = تكلفة الوحدة بالليرة. ثم سعر البيع SYP − تكلفة الوحدة SYP = الربح المتوقع. هامش الربح = الربح المتوقع ÷ سعر البيع × 100. هذه أرقام تسعير تقديرية وليست أرباحاً محققة.</p>'+
      (productRows.length?table(["المنتج","تكلفة المورد USD","تكلفته SYP","سعر البيع USD","سعر البيع SYP","ربح متوقع SYP","ربح متوقع USD","الهامش"],productRows):'<div class="baro-mgmt-empty">لا توجد باقات لديها تكلفة مورد وسعر بيع معتمدان حالياً.</div>')+
      '<p class="baro-mgmt-muted">تنبيه: الربح المتوقع لا يدخل دفتر الأرباح الفعلية تلقائياً؛ يُسجل الربح الفعلي فقط من الحركات المالية المرتبطة بعمليات منفذة ومقبوضة.</p></div>'+

      '</div><div class="baro-mgmt-panel"><h3>إضافة حركة مالية</h3><div class="baro-mgmt-form">'+
      selectField("نوع الحركة","baroFinanceType",[["expense","مصروف"],["commission","عمولة"],["refund","مبلغ مسترد"],["adjustment","تسوية / تعديل"]])+
      field("العنوان","baroFinanceTitle","text","مثال: رسوم تحويل")+
      field("المبلغ","baroFinanceAmount","number","0.00")+
      selectField("العملة","baroFinanceCurrency",[["USD","دولار USD"],["SYP","ليرة سورية جديدة SYP"]])+
      field("سعر الصرف (ليرة جديدة لكل دولار)","baroFinanceRate","number","مطلوب عند استخدام الليرة")+
      field("رقم الطلب (اختياري)","baroFinanceOrder","text","UUID الطلب")+
      field("مرجع خارجي","baroFinanceRef","text","رقم إيصال أو حوالة")+
      '<label>ملاحظات<textarea id="baroFinanceDesc" rows="2"></textarea></label><button type="button" id="baroFinanceSave">حفظ الحركة</button></div></div>'+
      '<div class="baro-mgmt-actions"><button type="button" id="baroFinanceExport" class="secondary">تصدير كشف BARO المالي CSV</button></div><div class="baro-mgmt-panel"><h3>دفتر الحركات المالية الفعلية</h3><p class="baro-mgmt-muted">كل سطر يمثل حركة مستقلة. راجع العملة الأصلية والمكافئ بالدولار وحالة الترحيل قبل اعتماد أي تسوية.</p>'+
      (entries.length?table(["التاريخ","نوع الحركة","البيان","المبلغ والعملة الأصلية","المكافئ USD","حالة الترحيل","رقم الطلب"],entries.map(e=>row([new Date(e.created_at).toLocaleString("ar"),typeLabels[e.entry_type]||e.entry_type,e.title,e.currency==="SYP"?fmtSyp(e.amount):fmtUsd(e.amount),fmtUsd(e.amount_usd_equivalent),e.status==="posted"?"مرحّلة":e.status==="pending"?"بانتظار الترحيل":e.status,e.order_id]))):'<div class="baro-mgmt-empty">لا توجد حركات مالية فعلية مسجلة بعد. ستظهر المبيعات والتكاليف هنا بعد الطلبات المنفذة والمقبوضة.</div>')+'</div>'+
      (can("settings")?'<div class="baro-mgmt-panel"><h3>إعدادات مالية BARO</h3><p class="baro-mgmt-muted">سعر الصرف وحد التنبيه وهما خاصان بعمليات BARO فقط، ولا يغيران إعدادات الشحن الآلي أو المحافظ.</p><div class="baro-mgmt-form">'+field("سعر الدولار مقابل الليرة السورية الجديدة","baroSettingRate","number","مثال: 156",currentSettings.usd_syp_rate)+field("حد التنبيه لهامش الربح %","baroSettingMargin","number","15",currentSettings.low_margin_percent==null?15:currentSettings.low_margin_percent)+selectField("العملة الافتراضية","baroSettingCurrency",[["USD","الدولار USD"],["SYP","الليرة الجديدة SYP"]])+'<button type="button" id="baroSettingsSave">حفظ الإعدادات المالية</button></div></div>':""));
    if($("baroSettingsSave")){$("baroSettingCurrency").value=currentSettings.default_currency||"USD";$("baroSettingsSave").onclick=async()=>{const rateInput=$("baroSettingRate").value.trim(),rate=rateInput===""?null:Number(rateInput),margin=Number($("baroSettingMargin").value),currency=$("baroSettingCurrency").value;if((rate!==null&&(!Number.isFinite(rate)||rate<=0))||!Number.isFinite(margin)||margin<0||margin>100){msg("تحقق من سعر الصرف وهامش الربح.");return;}try{await post({action:"settings_save",usd_syp_rate:rate,low_margin_percent:margin,default_currency:currency});msg("تم حفظ إعدادات BARO المالية.");await loadFinance();}catch(e){msg(e.message);}};}
    $("baroFinanceSave").onclick=async()=>{
      const type=$("baroFinanceType").value,title=$("baroFinanceTitle").value.trim(),value=Number($("baroFinanceAmount").value);
      const currency=$("baroFinanceCurrency").value,rateInput=$("baroFinanceRate").value.trim(),exchangeRate=rateInput===""?null:Number(rateInput);
      const order=$("baroFinanceOrder").value.trim()||null;
      if(title.length<2||!Number.isFinite(value)||value<=0||(currency==="SYP"&&(!exchangeRate||exchangeRate<=0))){msg("أدخل عنواناً ومبلغاً صحيحاً وسعر صرف بالليرة الجديدة لكل دولار عند استخدام الليرة.");return;}
      const key=globalThis.crypto?.randomUUID?.()||("baro-"+Date.now()+"-"+Math.random().toString(16).slice(2));
      try{await post({action:"finance_entry",entry_type:type,title,amount:value,currency,exchange_rate:exchangeRate,order_id:order,external_reference:$("baroFinanceRef").value.trim(),description:$("baroFinanceDesc").value.trim(),idempotency_key:key});msg("تم تسجيل الحركة في دفتر BARO فقط.");await loadFinance();}
      catch(e){msg(e.message);}
    };
    $("baroFinanceExport").onclick=()=>exportCsv("baro-finance.csv",[["date","type","title","amount","currency","usd_equivalent","status","order_id"],...entries.map(e=>[e.created_at,e.entry_type,e.title,e.amount,e.currency,e.amount_usd_equivalent,e.status,e.order_id])]);
  }

  async function loadSuppliers() {
    const content=$("baroMgmtContent");if(!content)return;
    if(!can("suppliers")){content.innerHTML='<div class="baro-mgmt-empty">لا تملك صلاحية هذا القسم.</div>';return;}
    supplierData=await getView("suppliers");
    const suppliers=supplierData.suppliers||[],links=supplierData.products||[],events=supplierData.events||[],products=adminData.products||[];
    content.innerHTML='<h3>إدارة موردي BARO</h3><div class="baro-mgmt-panel"><h3>إضافة مورد أو تحديث بياناته</h3><div class="baro-mgmt-form">'+
      selectField("تعديل مورد موجود (اتركه فارغاً لإضافة جديد)","baroSupplierEditId",[["","إضافة مورد جديد"],...suppliers.map(s=>[s.id,s.name])])+
      field("اسم المورد","baroSupplierName","text","اسم المورد")+field("جهة التواصل","baroSupplierContact","text","اختياري")+
      field("رقم الهاتف","baroSupplierPhone","text","اختياري")+field("البريد الإلكتروني","baroSupplierEmail","email","اختياري")+
      '<label>ملاحظات<textarea id="baroSupplierNotes" rows="2"></textarea></label><button type="button" id="baroSupplierLoad" class="secondary">تحميل بيانات المورد المحدد</button><button type="button" id="baroSupplierSave">حفظ المورد</button></div></div>'+
      '<div class="baro-mgmt-panel"><h3>ربط مورد بمنتج وتكلفته</h3><div class="baro-mgmt-form">'+
      selectField("المورد","baroSupplierLinkId",suppliers.map(s=>[s.id,s.name]))+
      selectField("المنتج","baroSupplierProductCode",products.map(p=>[p.product_code,p.product_name]))+
      field("رمز المنتج لدى المورد","baroSupplierSku","text","SKU")+field("تكلفة المورد","baroSupplierCost","number","0.00")+
      selectField("عملة التكلفة","baroSupplierCurrency",[["USD","USD"],["SYP","SYP"]])+
      field("مدة التنفيذ بالساعات","baroSupplierLead","number","اختياري")+
      '<label><input type="checkbox" id="baroSupplierPreferred"> المورد المفضل</label><button type="button" id="baroSupplierLinkSave">حفظ ربط المورد</button></div></div>'+
      '<div class="baro-mgmt-panel"><h3>تسجيل تقييم أو مشكلة</h3><div class="baro-mgmt-form">'+
      selectField("المورد","baroSupplierEventId",suppliers.map(s=>[s.id,s.name]))+
      selectField("نوع الحدث","baroSupplierEventType",[["rating","تقييم"],["delay","تأخير"],["issue","مشكلة"],["note","ملاحظة"]])+
      field("التقييم من 1 إلى 5","baroSupplierRating","number","5")+
      '<label>التفاصيل<textarea id="baroSupplierEventDetails" rows="2"></textarea></label><button type="button" id="baroSupplierEventSave">حفظ السجل</button></div></div>'+
      '<h3>الموردون</h3>'+table(["المورد","جهة التواصل","الهاتف","الحالة","متوسط التقييم","روابط المنتجات"],suppliers.map(s=>{const rs=events.filter(e=>e.supplier_id===s.id&&e.rating);const avg=rs.length?(rs.reduce((n,e)=>n+Number(e.rating),0)/rs.length).toFixed(1):"—";return row([s.name,s.contact_name,s.contact_phone,s.is_active?"نشط":"موقوف",avg,links.filter(l=>l.supplier_id===s.id).length]);}))+
      '<h3>تكاليف الموردين المرتبطة بالمنتجات</h3>'+table(["المورد","رمز المنتج","SKU","التكلفة","العملة","سعر الصرف","المدة","مفضل"],links.map(l=>row([suppliers.find(s=>s.id===l.supplier_id)?.name,l.product_code,l.supplier_sku,l.unit_cost,l.currency,l.exchange_rate_snapshot,l.lead_time_hours,l.is_preferred?"نعم":"لا"])))+
      '<h3>سجل أداء الموردين</h3>'+table(["التاريخ","المورد","النوع","التقييم","التفاصيل"],events.map(e=>row([new Date(e.created_at).toLocaleString("ar"),suppliers.find(s=>s.id===e.supplier_id)?.name,e.event_type,e.rating,e.details])));
    $("baroSupplierLoad").onclick=()=>{
      const s=suppliers.find(x=>x.id===$("baroSupplierEditId").value);
      if(!s){msg("اختر مورداً موجوداً أولاً.");return;}
      $("baroSupplierName").value=s.name||"";
      $("baroSupplierContact").value=s.contact_name||"";
      $("baroSupplierPhone").value=s.contact_phone||"";
      $("baroSupplierEmail").value=s.contact_email||"";
      $("baroSupplierNotes").value=s.notes||"";
      msg("تم تحميل بيانات المورد للتعديل.");
    };
    $("baroSupplierSave").onclick=async()=>{
      const name=$("baroSupplierName").value.trim();if(name.length<2){msg("أدخل اسم المورد.");return;}
      try{await post({action:"supplier_save",supplier_id:$("baroSupplierEditId").value||null,name,contact_name:$("baroSupplierContact").value,contact_phone:$("baroSupplierPhone").value,contact_email:$("baroSupplierEmail").value,notes:$("baroSupplierNotes").value,is_active:true});msg("تم حفظ المورد.");await loadSuppliers();}catch(e){msg(e.message);}
    };
    $("baroSupplierLinkSave").onclick=async()=>{
      const supplier_id=$("baroSupplierLinkId").value,product_code=$("baroSupplierProductCode").value,cost=Number($("baroSupplierCost").value);
      if(!supplier_id||!product_code||!Number.isFinite(cost)||cost<0){msg("أكمل بيانات ربط المورد.");return;}
      try{await post({action:"supplier_product_save",supplier_id,product_code,supplier_sku:$("baroSupplierSku").value,unit_cost:cost,currency:$("baroSupplierCurrency").value,lead_time_hours:$("baroSupplierLead").value===""?null:Number($("baroSupplierLead").value),is_preferred:$("baroSupplierPreferred").checked,is_active:true});msg("تم حفظ ربط المورد والتكلفة.");await loadSuppliers();}catch(e){msg(e.message);}
    };
    $("baroSupplierEventSave").onclick=async()=>{
      try{await post({action:"supplier_event",supplier_id:$("baroSupplierEventId").value,event_type:$("baroSupplierEventType").value,rating:$("baroSupplierRating").value===""?null:Number($("baroSupplierRating").value),details:$("baroSupplierEventDetails").value});msg("تم تسجيل الحدث.");await loadSuppliers();}catch(e){msg(e.message);}
    };
  }

  async function loadSettings() {
    const content=$("baroMgmtContent");if(!content)return;
    if(!can("settings")){content.innerHTML='<div class="baro-mgmt-empty">لا تملك صلاحية هذا القسم.</div>';return;}
    settingsData=await getView("settings");const s=settingsData.settings||{};
    content.innerHTML='<h3>إعدادات BARO المستقلة</h3><div class="baro-mgmt-panel"><p class="baro-mgmt-muted">هذه الإعدادات تخص الشحن اليدوي ولا تغيّر إعدادات الشحن الآلي. مفتاح استقبال الطلبات منفصل ويبقى مغلقاً حتى الاعتماد.</p><div class="baro-mgmt-form">'+
      field("سعر الدولار مقابل الليرة","baroSettingRate","number","مثال: 13500",s.usd_syp_rate)+
      field("حد التنبيه لهامش الربح %","baroSettingMargin","number","15",s.low_margin_percent==null?15:s.low_margin_percent)+
      selectField("العملة الافتراضية","baroSettingCurrency",[["USD","الدولار"],["SYP","الليرة السورية"]])+
      '<button type="button" id="baroSettingsSave">حفظ إعدادات BARO</button></div><p class="baro-mgmt-muted">آخر تحديث: '+esc(s.updated_at?new Date(s.updated_at).toLocaleString("ar"):"لم يتم التحديث بعد")+'</p></div>';
    $("baroSettingCurrency").value=s.default_currency||"USD";
    $("baroSettingsSave").onclick=async()=>{
      const rate=$("baroSettingRate").value.trim()===""?null:Number($("baroSettingRate").value),margin=Number($("baroSettingMargin").value),currency=$("baroSettingCurrency").value;
      if((rate!==null&&(!Number.isFinite(rate)||rate<=0))||!Number.isFinite(margin)||margin<0||margin>100){msg("تحقق من سعر الصرف وهامش الربح.");return;}
      try{await post({action:"settings_save",usd_syp_rate:rate,low_margin_percent:margin,default_currency:currency});msg("تم حفظ إعدادات BARO المستقلة.");await loadSettings();}catch(e){msg(e.message);}
    };
  }

  async function loadHistory() {
    const content=$("baroMgmtContent");if(!content)return;
    const history=can("catalog")?await getView("history").catch(()=>({history:[]})):{history:[]};
    const audit=can("audit")?await getView("audit").catch(()=>({audit:[]})):{audit:[]};
    const backupResult=(can("audit")||can("settings"))?await getView("backups").catch(()=>({backups:[]})):{backups:[]};
    historyData=history.history||[];auditData=audit.audit||[];
    const backups=backupResult.backups||[];
    content.innerHTML='<h3>سجل تغييرات الأسعار</h3>'+
      table(["التاريخ","المنتج","القيم السابقة","القيم الجديدة","المنفذ"],historyData.map(h=>row([new Date(h.created_at).toLocaleString("ar"),h.product_code,JSON.stringify(h.previous_values),JSON.stringify(h.new_values),h.changed_by])))+
      '<div class="baro-mgmt-actions"><button type="button" id="baroHistoryExport" class="secondary">تصدير سجل الأسعار CSV</button></div><h3>سجل عمليات BARO</h3>'+
      table(["التاريخ","الإجراء","نوع السجل","المعرف","التفاصيل","المنفذ"],auditData.map(a=>row([new Date(a.created_at).toLocaleString("ar"),a.action,a.entity_type,a.entity_id,JSON.stringify(a.details),a.admin_id])))+
      '<div class="baro-mgmt-actions"><button type="button" id="baroAuditExport" class="secondary">تصدير سجل التدقيق CSV</button></div><h3>النسخ الاحتياطية اليومية</h3><div class="baro-mgmt-actions"><button type="button" id="baroBackupNow">إنشاء نسخة احتياطية الآن</button></div>'+
      table(["تاريخ النسخة","معرّف النسخة","المنتجات","الطلبات","الحركات المالية","الموردون"],backups.map(b=>row([new Date(b.created_at).toLocaleString("ar"),b.id,b.row_counts?.products,b.row_counts?.orders,b.row_counts?.finance_entries,b.row_counts?.suppliers])))+
      '<p class="baro-mgmt-muted">يُنشئ النظام نسخة داخل قاعدة BARO يومياً ويحتفظ بآخر 60 يوماً. صدّر CSV دورياً أيضاً كنسخة خارجية مستقلة.</p>';
    $("baroHistoryExport").onclick=()=>exportCsv("baro-price-history.csv",[["date","product_code","previous_values","new_values","changed_by"],...historyData.map(h=>[h.created_at,h.product_code,JSON.stringify(h.previous_values),JSON.stringify(h.new_values),h.changed_by])]);
    $("baroAuditExport").onclick=()=>exportCsv("baro-audit-log.csv",[["date","action","entity_type","entity_id","details","admin_id"],...auditData.map(a=>[a.created_at,a.action,a.entity_type,a.entity_id,JSON.stringify(a.details),a.admin_id])]);
    $("baroBackupNow").onclick=async()=>{try{const result=await post({action:"backup_now"});msg("تم إنشاء نسخة BARO الاحتياطية: "+result.backup_id);await loadHistory();}catch(e){msg(e.message);}};
  }

  async function loadStaff() {
    const content=$("baroMgmtContent");if(!content)return;
    if(!access.is_admin||!can("staff")){content.innerHTML='<div class="baro-mgmt-empty">إدارة صلاحيات الموظفين متاحة لمدير المتجر فقط.</div>';return;}
    staffData=(await getView("staff")).staff||[];
    content.innerHTML='<h3>صلاحيات موظفي BARO</h3><p class="baro-mgmt-muted">أدخل UUID حساب الموظف وحدد صلاحيات BARO فقط، دون منحه صلاحيات مدير المتجر العامة.</p><div class="baro-mgmt-panel"><div class="baro-mgmt-form">'+
      field("معرّف المستخدم UUID","baroStaffUser","text","UUID")+
      selectField("الصلاحية","baroStaffPermission",[["view","عرض BARO"],["catalog","المنتجات والأسعار"],["orders","الطلبات"],["finance","الإدارة المالية"],["suppliers","الموردون"],["settings","إعدادات BARO"],["audit","سجل التدقيق"],["staff","إدارة الصلاحيات"]])+
      selectField("الحالة","baroStaffActive",[["true","مفعّلة"],["false","إيقاف"]])+
      '<button type="button" id="baroStaffSave">حفظ الصلاحية</button></div></div>'+
      table(["المستخدم","الصلاحية","الحالة","تاريخ الإضافة","منحها"],staffData.map(s=>row([s.user_id,s.permission_key,s.is_active?"مفعّلة":"موقوفة",new Date(s.created_at).toLocaleString("ar"),s.granted_by])));
    $("baroStaffSave").onclick=async()=>{
      const user_id=$("baroStaffUser").value.trim(),permission_key=$("baroStaffPermission").value,is_active=$("baroStaffActive").value==="true";
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(user_id)){msg("أدخل UUID صحيحاً للموظف.");return;}
      try{await post({action:"staff_permission_save",user_id,permission_key,is_active});msg("تم تحديث صلاحية BARO.");await loadStaff();}catch(e){msg(e.message);}
    };
  }

  async function showTab(tab) {
    financeWorkspaceActive=false;activeTab=tab;const node=root();if(!node)return;
    node.querySelectorAll("[data-tab]").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));
    msg("");
    try{
      if(tab==="overview"){await loadAdmin();await loadOverview();}
      else if(tab==="suppliers"){await loadAdmin();await loadSuppliers();}
      else if(tab==="history")await loadHistory();
      else if(tab==="staff")await loadStaff();
      else if(tab==="assistant")await loadAdminAssistant();
    }catch(e){msg(e.message);}
  }

  function financeRoot() {
    const mount=$("baroFinanceStandaloneMount");if(!mount)return null;
    let node=$("baroFinanceWorkspace");
    if(!node){node=document.createElement("section");node.id="baroFinanceWorkspace";node.innerHTML='<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"><div><h2 style="margin:0">BARO FINANCE</h2><p class="baro-mgmt-muted">دفتر مالي مستقل للشحن اليدوي فقط</p></div><span class="baro-mgmt-badge">مالي داخلي · BARO</span></div><div id="baroFinanceMgmtMessage" class="baro-mgmt-message" role="status" aria-live="polite"></div><div id="baroFinanceMgmtContent"></div>';mount.appendChild(node);}
    return node;
  }
  async function loadBaroFinanceWorkspace(){
    financeWorkspaceActive=true;
    const node=financeRoot();
    const content=$("baroFinanceMgmtContent");
    if(!node||!content)return;
    content.innerHTML='<div class="baro-mgmt-empty" role="status">جاري تحميل بيانات مالية BARO...</div>';
    try{
      await loadAccess();
      if(!can("finance")){
        content.innerHTML='<div class="baro-mgmt-empty">لا تملك صلاحية الاطلاع على مالية BARO. راجع صلاحيات BARO مع مدير المتجر.</div>';
        return;
      }
      await loadAdmin();
      await loadFinance();
      if(!content.innerHTML.trim()){
        content.innerHTML='<div class="baro-mgmt-empty">تم الاتصال، لكن لم تصل بيانات مالية للعرض. استخدم إعادة المحاولة أو راجع سجل الأخطاء.</div>';
      }
    }catch(e){
      content.innerHTML='<div class="baro-mgmt-panel" style="border-color:#a65b69"><h3>تعذر تحميل مالية BARO</h3><p class="baro-mgmt-muted" id="baroFinanceLoadError" role="alert"></p><button type="button" id="baroFinanceRetry">إعادة المحاولة</button></div>';
      const error=$("baroFinanceLoadError");
      if(error)error.textContent=String(e?.message||"حدث خطأ غير معروف أثناء تحميل البيانات.");
      const retry=$("baroFinanceRetry");
      if(retry)retry.onclick=()=>loadBaroFinanceWorkspace();
    }
  }

  const adminAiMessages = [];
  let adminAiSending = false;
  async function loadAdminAssistant() {
    const content=$("baroMgmtContent"); if(!content)return;
    content.innerHTML='<h3>🤖 BARO AI · مساعد الإدارة</h3><p class="baro-mgmt-muted">مساعد تحليلي لقسم الشحن اليدوي فقط. يراجع الطلبات والاستثناءات والكتالوج ويقترح إجراءات متابعة. لا ينفذ أي إجراء مالي أو تشغيلي.</p><div class="baro-mgmt-panel"><div class="baro-mgmt-actions"><button type="button" id="baroAdminAiSummary">حلّل وضع BARO الآن</button><button type="button" class="secondary" id="baroAdminAiClear">محادثة جديدة</button></div><div id="baroAdminAiMessages" class="baro-ai-messages" role="log" aria-live="polite" style="height:300px"><div class="baro-ai-bubble bot">أهلاً، أنا مساعد BARO للإدارة. فيني أراجع الطلبات المتأخرة، الحالات الاستثنائية، جاهزية الكتالوج، وأعطيك ملخصاً واضحاً.</div></div><form id="baroAdminAiForm" class="baro-ai-form"><input id="baroAdminAiInput" maxlength="1200" autocomplete="off" placeholder="اسأل عن الطلبات أو مشاكل BARO..." aria-label="رسالتك لمساعد BARO للإدارة"><button id="baroAdminAiSend" type="submit">إرسال</button></form><div id="baroAdminAiStatus" class="baro-mgmt-message" role="status"></div></div>';
    const bubble=(text,role)=>{const box=$("baroAdminAiMessages");if(!box)return;const el=document.createElement("div");el.className="baro-ai-bubble "+role;el.textContent=String(text||"");box.append(el);box.scrollTop=box.scrollHeight;};
    const send=async(text)=>{
      if(adminAiSending||!text.trim())return;
      adminAiMessages.push({role:"user",content:text.trim()});bubble(text.trim(),"user");
      adminAiSending=true;$("baroAdminAiSend").disabled=true;$("baroAdminAiStatus").textContent="عم يراجع بيانات BARO...";
      try{
        const {data:{session},error}=await sb.auth.getSession();if(error||!session?.access_token)throw new Error("انتهت الجلسة. سجّل الدخول مجدداً.");
        const response=await fetch(SUPABASE_URL+"/functions/v1/baro-ai-admin",{method:"POST",headers:{"Authorization":"Bearer "+session.access_token,"apikey":SUPABASE_KEY,"Content-Type":"application/json"},body:JSON.stringify({messages:adminAiMessages})});
        const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||"تعذر الاتصال بالمساعد.");
        if(typeof data.reply!=="string"||!data.reply.trim())throw new Error("وصل رد غير مكتمل.");
        adminAiMessages.push({role:"assistant",content:data.reply});bubble(data.reply,"bot");
        $("baroAdminAiStatus").textContent="الملخص مبني على بيانات BARO المتاحة فقط. لا يتم تنفيذ أي تغيير.";
      }catch(e){adminAiMessages.pop();bubble(e.message||"حدث خطأ مؤقت.","error");$("baroAdminAiStatus").textContent="تعذر إكمال الطلب.";}
      finally{adminAiSending=false;if($("baroAdminAiSend"))$("baroAdminAiSend").disabled=false;}
    };
    $("baroAdminAiForm").addEventListener("submit",e=>{e.preventDefault();const input=$("baroAdminAiInput"),v=input.value.trim();input.value="";send(v);});
    $("baroAdminAiSummary").addEventListener("click",()=>send("اعطني تقريراً تنفيذياً عن وضع BARO الآن: استقبال الطلبات، الطلبات النشطة والمتأخرة، الحالات التي تحتاج تدخلاً، جاهزية المنتجات والأسعار، وأهم ثلاث أولويات للإدارة. ميّز الحقائق عن الاستنتاجات."));
    $("baroAdminAiClear").addEventListener("click",()=>{adminAiMessages.length=0;loadAdminAssistant();});
  }

  async function refreshAll(){
    financeWorkspaceActive=false;
    if(loading)return;loading=true;msg("جاري تحديث بيانات BARO...");
    try{await loadAccess();await loadAdmin();await showTab(activeTab);msg("تم تحديث بيانات BARO.");}
    catch(e){msg(e.message);}
    finally{loading=false;}
  }
  const baseLoadAdmin=window.loadBaroAdmin;
  if(typeof baseLoadAdmin==="function"){
    window.loadBaroAdmin=async function(){
      await baseLoadAdmin();
      try{await loadAccess();await loadAdmin();await showTab(activeTab);}catch(e){msg(e.message);}
    };
  }
  window.loadBaroManagement=refreshAll;
  window.loadBaroFinanceWorkspace=loadBaroFinanceWorkspace;
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>root());
  else root();
})();
  async function loadOverview() {
    const content=$("baroMgmtContent"); if(!content)return;
    const orders=adminData.orders||[];
    const products=adminData.products||[];
    const pending=orders.filter(o=>!["completed","cancelled","failed"].includes(o.status)).length;
    content.innerHTML='<h3>مؤشرات تشغيل BARO</h3><div class="baro-mgmt-grid">'+
      stat("المنتجات المسجلة",products.length)+
      stat("المنتجات الظاهرة",products.filter(p=>p.catalog_visible===true).length)+
      stat("الطلبات الظاهرة",orders.length)+stat("طلبات قيد المتابعة",pending)+
      '</div><p class="baro-mgmt-muted">هذه الصفحة للتشغيل والكتالوج والطلبات فقط. جميع التكاليف وسعر الصرف والمبيعات والأرباح والحركات المالية موجودة في قسم «مالية BARO المستقلة» بلوحة الإدارة.</p>'+
      '<div class="baro-mgmt-actions"><button type="button" id="baroMgmtRefresh">تحديث بيانات BARO</button><button type="button" id="baroMgmtProducts" class="secondary">إدارة المنتجات</button><button type="button" id="baroMgmtOrders" class="secondary">إدارة الطلبات</button><button type="button" id="baroMgmtExportOrders" class="secondary">تصدير الطلبات CSV</button></div>';
    $("baroMgmtRefresh").onclick=refreshAll;
    $("baroMgmtProducts").onclick=()=>$("baroAdminProducts")?.scrollIntoView({behavior:"smooth"});
    $("baroMgmtOrders").onclick=()=>$("baroAdminOrders")?.scrollIntoView({behavior:"smooth"});
    $("baroMgmtExportOrders").onclick=()=>exportCsv("baro-orders.csv",[["id","product","player_id","quantity","status","payment_status","displayed_usd","displayed_syp","created_at"],...orders.map(o=>[o.id,o.product_name_snapshot,o.player_id,o.quantity,o.status,o.payment_status,o.displayed_price_usd_snapshot,o.displayed_price_syp_snapshot,o.created_at])]);
  }
  function exportCsv(filename, rows) {
    const csv=rows.map(r=>r.map(v=>'"'+String(v==null?"":v).replace(/"/g,'""')+'"').join(",")).join("\r\n");
    const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
  }

  async function loadFinance() {
    const content=$("baroMgmtContent");if(!content)return;
    if(!can("finance")){content.innerHTML='<div class="baro-mgmt-empty">لا تملك صلاحية هذا القسم.</div>';return;}
    financeData=await getView("finance");
    const entries=financeData.entries||[],t=financeData.totals||{};
    const products=(adminData.products||[]).filter(p=>p.catalog_visible===true&&p.purchase_enabled===false&&Number(p.supplier_cost_usd)>0&&Number(p.sale_price_syp)>0);
    const rate=Number(adminData.settings?.usd_syp_rate||156);
    const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Damascus",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
    const part=k=>parts.find(x=>x.type===k)?.value||"";
    const today=part("year")+"-"+part("month")+"-"+part("day"),month=today.slice(0,7);
    const dateKey=value=>{
      const d=new Date(value);if(!Number.isFinite(d.getTime()))return "";
      const ps=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Damascus",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(d);
      const get=k=>ps.find(x=>x.type===k)?.value||"";
      return get("year")+"-"+get("month")+"-"+get("day");
    };
    const posted=entries.filter(e=>e.status==="posted");
    const pending=entries.length-posted.length;
    const daily=entries.filter(e=>dateKey(e.created_at)===today);
    const monthly=entries.filter(e=>dateKey(e.created_at).slice(0,7)===month);
    const productRows=products.map(p=>{
      const cost=Number(p.supplier_cost_usd)*rate,sale=Number(p.sale_price_syp),profit=sale-cost;
      const margin=sale>0?profit/sale*100:0;
      return row([p.product_name,money(cost,"SYP"),money(sale,"SYP"),money(profit,"SYP"),margin.toFixed(1)+"%"]);
    });
    const typeLabels={sale_received:"مبيعات مقبوضة",supplier_cost:"تكلفة مورد",expense:"مصروف",commission:"عمولة",refund:"مبلغ مسترد",adjustment:"تسوية"};
    content.innerHTML='<h3>الإدارة المالية المستقلة — BARO</h3><div class="baro-mgmt-grid">'+
      stat("المبيعات المقبوضة",money(t.sales||0))+stat("تكاليف الموردين",money(t.supplier_costs||0))+
      stat("المصاريف",money(t.expenses||0))+stat("العمولات",money(t.commissions||0))+
      stat("المبالغ المستردة",money(t.refunds||0))+stat("التسويات",money(t.adjustments||0))+
      stat("صافي الربح المحقق",money(t.net_profit||0))+stat("الحركات المرحلة",posted.length)+
      stat("حركات اليوم",daily.length)+stat("حركات الشهر",monthly.length)+
      stat("حركات بانتظار الترحيل",pending)+
      '</div><p class="baro-mgmt-muted">الأرقام المالية الفعلية أعلاه محسوبة من دفتر BARO فقط وبالمكافئ USD. لا تشمل محافظ الزبائن ولا الشحن الآلي.</p>'+
      '<div class="baro-mgmt-panel"><h3>ربحية باقات الكتالوج — تقديرية وليست أرباحاً محققة</h3>'+
      '<p class="baro-mgmt-muted">تحسب تكلفة المورد بالدولار × سعر الصرف المحفوظ ('+rate.toLocaleString("en-US")+' ليرة لكل دولار)، ثم تقارنها بسعر البيع المعروض. لا تُسجل هذه التقديرات كإيراد أو ربح قبل تنفيذ طلب وقبضه.</p>'+
      (productRows.length?table(["المنتج","تكلفة المورد","سعر البيع","الربح المتوقع للوحدة","هامش الربح"],productRows):'<div class="baro-mgmt-empty">لا توجد باقات ظاهرة لها تكلفة وسعر بيع معتمدان حالياً.</div>')+
      '</div><div class="baro-mgmt-panel"><h3>إضافة حركة مالية</h3><div class="baro-mgmt-form">'+
      selectField("نوع الحركة","baroFinanceType",[["expense","مصروف"],["commission","عمولة"],["refund","مبلغ مسترد"],["adjustment","تسوية / تعديل"]])+
      field("العنوان","baroFinanceTitle","text","مثال: رسوم تحويل")+
      field("المبلغ","baroFinanceAmount","number","0.00")+
      selectField("العملة","baroFinanceCurrency",[["USD","دولار USD"],["SYP","ليرة سورية جديدة SYP"]])+
      field("سعر الصرف (ليرة جديدة لكل دولار)","baroFinanceRate","number","مطلوب عند استخدام الليرة")+
      field("رقم الطلب (اختياري)","baroFinanceOrder","text","UUID الطلب")+
      field("مرجع خارجي","baroFinanceRef","text","رقم إيصال أو حوالة")+
      '<label>ملاحظات<textarea id="baroFinanceDesc" rows="2"></textarea></label><button type="button" id="baroFinanceSave">حفظ الحركة</button></div></div>'+
      '<div class="baro-mgmt-actions"><button type="button" id="baroFinanceExport" class="secondary">تصدير كشف BARO المالي CSV</button></div><h3>دفتر الحركات المالية الفعلية</h3>'+
      (entries.length?table(["التاريخ","النوع","الوصف","المبلغ","المكافئ USD","الحالة","رقم الطلب"],entries.map(e=>row([new Date(e.created_at).toLocaleString("ar"),typeLabels[e.entry_type]||e.entry_type,e.title,money(e.amount,e.currency),money(e.amount_usd_equivalent),e.status,e.order_id]))):'<div class="baro-mgmt-empty">لا توجد حركات مالية فعلية مسجلة بعد. ستظهر المبيعات والتكاليف هنا بعد الطلبات المنفذة والمقبوضة.</div>');
    $("baroFinanceSave").onclick=async()=>{
      const type=$("baroFinanceType").value,title=$("baroFinanceTitle").value.trim(),value=Number($("baroFinanceAmount").value);
      const currency=$("baroFinanceCurrency").value,rateInput=$("baroFinanceRate").value.trim(),exchangeRate=rateInput===""?null:Number(rateInput);
      const order=$("baroFinanceOrder").value.trim()||null;
      if(title.length<2||!Number.isFinite(value)||value<=0||(currency==="SYP"&&(!exchangeRate||exchangeRate<=0))){msg("أدخل عنواناً ومبلغاً صحيحاً وسعر صرف بالليرة الجديدة لكل دولار عند استخدام الليرة.");return;}
      const key=globalThis.crypto?.randomUUID?.()||("baro-"+Date.now()+"-"+Math.random().toString(16).slice(2));
      try{await post({action:"finance_entry",entry_type:type,title,amount:value,currency,exchange_rate:exchangeRate,order_id:order,external_reference:$("baroFinanceRef").value.trim(),description:$("baroFinanceDesc").value.trim(),idempotency_key:key});msg("تم تسجيل الحركة في دفتر BARO فقط.");await loadFinance();}
      catch(e){msg(e.message);}
    };
    $("baroFinanceExport").onclick=()=>exportCsv("baro-finance.csv",[["date","type","title","amount","currency","usd_equivalent","status","order_id"],...entries.map(e=>[e.created_at,e.entry_type,e.title,e.amount,e.currency,e.amount_usd_equivalent,e.status,e.order_id])]);
  }

  async function loadSuppliers() {
    const content=$("baroMgmtContent");if(!content)return;
    if(!can("suppliers")){content.innerHTML='<div class="baro-mgmt-empty">لا تملك صلاحية هذا القسم.</div>';return;}
    supplierData=await getView("suppliers");
    const suppliers=supplierData.suppliers||[],links=supplierData.products||[],events=supplierData.events||[],products=adminData.products||[];
    content.innerHTML='<h3>إدارة موردي BARO</h3><div class="baro-mgmt-panel"><h3>إضافة مورد أو تحديث بياناته</h3><div class="baro-mgmt-form">'+
      selectField("تعديل مورد موجود (اتركه فارغاً لإضافة جديد)","baroSupplierEditId",[["","إضافة مورد جديد"],...suppliers.map(s=>[s.id,s.name])])+
      field("اسم المورد","baroSupplierName","text","اسم المورد")+field("جهة التواصل","baroSupplierContact","text","اختياري")+
      field("رقم الهاتف","baroSupplierPhone","text","اختياري")+field("البريد الإلكتروني","baroSupplierEmail","email","اختياري")+
      '<label>ملاحظات<textarea id="baroSupplierNotes" rows="2"></textarea></label><button type="button" id="baroSupplierLoad" class="secondary">تحميل بيانات المورد المحدد</button><button type="button" id="baroSupplierSave">حفظ المورد</button></div></div>'+
      '<div class="baro-mgmt-panel"><h3>ربط مورد بمنتج وتكلفته</h3><div class="baro-mgmt-form">'+
      selectField("المورد","baroSupplierLinkId",suppliers.map(s=>[s.id,s.name]))+
      selectField("المنتج","baroSupplierProductCode",products.map(p=>[p.product_code,p.product_name]))+
      field("رمز المنتج لدى المورد","baroSupplierSku","text","SKU")+field("تكلفة المورد","baroSupplierCost","number","0.00")+
      selectField("عملة التكلفة","baroSupplierCurrency",[["USD","USD"],["SYP","SYP"]])+
      field("مدة التنفيذ بالساعات","baroSupplierLead","number","اختياري")+
      '<label><input type="checkbox" id="baroSupplierPreferred"> المورد المفضل</label><button type="button" id="baroSupplierLinkSave">حفظ ربط المورد</button></div></div>'+
      '<div class="baro-mgmt-panel"><h3>تسجيل تقييم أو مشكلة</h3><div class="baro-mgmt-form">'+
      selectField("المورد","baroSupplierEventId",suppliers.map(s=>[s.id,s.name]))+
      selectField("نوع الحدث","baroSupplierEventType",[["rating","تقييم"],["delay","تأخير"],["issue","مشكلة"],["note","ملاحظة"]])+
      field("التقييم من 1 إلى 5","baroSupplierRating","number","5")+
      '<label>التفاصيل<textarea id="baroSupplierEventDetails" rows="2"></textarea></label><button type="button" id="baroSupplierEventSave">حفظ السجل</button></div></div>'+
      '<h3>الموردون</h3>'+table(["المورد","جهة التواصل","الهاتف","الحالة","متوسط التقييم","روابط المنتجات"],suppliers.map(s=>{const rs=events.filter(e=>e.supplier_id===s.id&&e.rating);const avg=rs.length?(rs.reduce((n,e)=>n+Number(e.rating),0)/rs.length).toFixed(1):"—";return row([s.name,s.contact_name,s.contact_phone,s.is_active?"نشط":"موقوف",avg,links.filter(l=>l.supplier_id===s.id).length]);}))+
      '<h3>تكاليف الموردين المرتبطة بالمنتجات</h3>'+table(["المورد","رمز المنتج","SKU","التكلفة","العملة","سعر الصرف","المدة","مفضل"],links.map(l=>row([suppliers.find(s=>s.id===l.supplier_id)?.name,l.product_code,l.supplier_sku,l.unit_cost,l.currency,l.exchange_rate_snapshot,l.lead_time_hours,l.is_preferred?"نعم":"لا"])))+
      '<h3>سجل أداء الموردين</h3>'+table(["التاريخ","المورد","النوع","التقييم","التفاصيل"],events.map(e=>row([new Date(e.created_at).toLocaleString("ar"),suppliers.find(s=>s.id===e.supplier_id)?.name,e.event_type,e.rating,e.details])));
    $("baroSupplierLoad").onclick=()=>{
      const s=suppliers.find(x=>x.id===$("baroSupplierEditId").value);
      if(!s){msg("اختر مورداً موجوداً أولاً.");return;}
      $("baroSupplierName").value=s.name||"";
      $("baroSupplierContact").value=s.contact_name||"";
      $("baroSupplierPhone").value=s.contact_phone||"";
      $("baroSupplierEmail").value=s.contact_email||"";
      $("baroSupplierNotes").value=s.notes||"";
      msg("تم تحميل بيانات المورد للتعديل.");
    };
    $("baroSupplierSave").onclick=async()=>{
      const name=$("baroSupplierName").value.trim();if(name.length<2){msg("أدخل اسم المورد.");return;}
      try{await post({action:"supplier_save",supplier_id:$("baroSupplierEditId").value||null,name,contact_name:$("baroSupplierContact").value,contact_phone:$("baroSupplierPhone").value,contact_email:$("baroSupplierEmail").value,notes:$("baroSupplierNotes").value,is_active:true});msg("تم حفظ المورد.");await loadSuppliers();}catch(e){msg(e.message);}
    };
    $("baroSupplierLinkSave").onclick=async()=>{
      const supplier_id=$("baroSupplierLinkId").value,product_code=$("baroSupplierProductCode").value,cost=Number($("baroSupplierCost").value);
      if(!supplier_id||!product_code||!Number.isFinite(cost)||cost<0){msg("أكمل بيانات ربط المورد.");return;}
      try{await post({action:"supplier_product_save",supplier_id,product_code,supplier_sku:$("baroSupplierSku").value,unit_cost:cost,currency:$("baroSupplierCurrency").value,lead_time_hours:$("baroSupplierLead").value===""?null:Number($("baroSupplierLead").value),is_preferred:$("baroSupplierPreferred").checked,is_active:true});msg("تم حفظ ربط المورد والتكلفة.");await loadSuppliers();}catch(e){msg(e.message);}
    };
    $("baroSupplierEventSave").onclick=async()=>{
      try{await post({action:"supplier_event",supplier_id:$("baroSupplierEventId").value,event_type:$("baroSupplierEventType").value,rating:$("baroSupplierRating").value===""?null:Number($("baroSupplierRating").value),details:$("baroSupplierEventDetails").value});msg("تم تسجيل الحدث.");await loadSuppliers();}catch(e){msg(e.message);}
    };
  }

  async function loadSettings() {
    const content=$("baroMgmtContent");if(!content)return;
    if(!can("settings")){content.innerHTML='<div class="baro-mgmt-empty">لا تملك صلاحية هذا القسم.</div>';return;}
    settingsData=await getView("settings");const s=settingsData.settings||{};
    content.innerHTML='<h3>إعدادات BARO المستقلة</h3><div class="baro-mgmt-panel"><p class="baro-mgmt-muted">هذه الإعدادات تخص الشحن اليدوي ولا تغيّر إعدادات الشحن الآلي. مفتاح استقبال الطلبات منفصل ويبقى مغلقاً حتى الاعتماد.</p><div class="baro-mgmt-form">'+
      field("سعر الدولار مقابل الليرة","baroSettingRate","number","مثال: 13500",s.usd_syp_rate)+
      field("حد التنبيه لهامش الربح %","baroSettingMargin","number","15",s.low_margin_percent==null?15:s.low_margin_percent)+
      selectField("العملة الافتراضية","baroSettingCurrency",[["USD","الدولار"],["SYP","الليرة السورية"]])+
      '<button type="button" id="baroSettingsSave">حفظ إعدادات BARO</button></div><p class="baro-mgmt-muted">آخر تحديث: '+esc(s.updated_at?new Date(s.updated_at).toLocaleString("ar"):"لم يتم التحديث بعد")+'</p></div>';
    $("baroSettingCurrency").value=s.default_currency||"USD";
    $("baroSettingsSave").onclick=async()=>{
      const rate=$("baroSettingRate").value.trim()===""?null:Number($("baroSettingRate").value),margin=Number($("baroSettingMargin").value),currency=$("baroSettingCurrency").value;
      if((rate!==null&&(!Number.isFinite(rate)||rate<=0))||!Number.isFinite(margin)||margin<0||margin>100){msg("تحقق من سعر الصرف وهامش الربح.");return;}
      try{await post({action:"settings_save",usd_syp_rate:rate,low_margin_percent:margin,default_currency:currency});msg("تم حفظ إعدادات BARO المستقلة.");await loadSettings();}catch(e){msg(e.message);}
    };
  }

  async function loadHistory() {
    const content=$("baroMgmtContent");if(!content)return;
    const history=can("catalog")?await getView("history").catch(()=>({history:[]})):{history:[]};
    const audit=can("audit")?await getView("audit").catch(()=>({audit:[]})):{audit:[]};
    const backupResult=(can("audit")||can("settings"))?await getView("backups").catch(()=>({backups:[]})):{backups:[]};
    historyData=history.history||[];auditData=audit.audit||[];
    const backups=backupResult.backups||[];
    content.innerHTML='<h3>سجل تغييرات الأسعار</h3>'+
      table(["التاريخ","المنتج","القيم السابقة","القيم الجديدة","المنفذ"],historyData.map(h=>row([new Date(h.created_at).toLocaleString("ar"),h.product_code,JSON.stringify(h.previous_values),JSON.stringify(h.new_values),h.changed_by])))+
      '<div class="baro-mgmt-actions"><button type="button" id="baroHistoryExport" class="secondary">تصدير سجل الأسعار CSV</button></div><h3>سجل عمليات BARO</h3>'+
      table(["التاريخ","الإجراء","نوع السجل","المعرف","التفاصيل","المنفذ"],auditData.map(a=>row([new Date(a.created_at).toLocaleString("ar"),a.action,a.entity_type,a.entity_id,JSON.stringify(a.details),a.admin_id])))+
      '<div class="baro-mgmt-actions"><button type="button" id="baroAuditExport" class="secondary">تصدير سجل التدقيق CSV</button></div><h3>النسخ الاحتياطية اليومية</h3><div class="baro-mgmt-actions"><button type="button" id="baroBackupNow">إنشاء نسخة احتياطية الآن</button></div>'+
      table(["تاريخ النسخة","معرّف النسخة","المنتجات","الطلبات","الحركات المالية","الموردون"],backups.map(b=>row([new Date(b.created_at).toLocaleString("ar"),b.id,b.row_counts?.products,b.row_counts?.orders,b.row_counts?.finance_entries,b.row_counts?.suppliers])))+
      '<p class="baro-mgmt-muted">يُنشئ النظام نسخة داخل قاعدة BARO يومياً ويحتفظ بآخر 60 يوماً. صدّر CSV دورياً أيضاً كنسخة خارجية مستقلة.</p>';
    $("baroHistoryExport").onclick=()=>exportCsv("baro-price-history.csv",[["date","product_code","previous_values","new_values","changed_by"],...historyData.map(h=>[h.created_at,h.product_code,JSON.stringify(h.previous_values),JSON.stringify(h.new_values),h.changed_by])]);
    $("baroAuditExport").onclick=()=>exportCsv("baro-audit-log.csv",[["date","action","entity_type","entity_id","details","admin_id"],...auditData.map(a=>[a.created_at,a.action,a.entity_type,a.entity_id,JSON.stringify(a.details),a.admin_id])]);
    $("baroBackupNow").onclick=async()=>{try{const result=await post({action:"backup_now"});msg("تم إنشاء نسخة BARO الاحتياطية: "+result.backup_id);await loadHistory();}catch(e){msg(e.message);}};
  }

  async function loadStaff() {
    const content=$("baroMgmtContent");if(!content)return;
    if(!access.is_admin||!can("staff")){content.innerHTML='<div class="baro-mgmt-empty">إدارة صلاحيات الموظفين متاحة لمدير المتجر فقط.</div>';return;}
    staffData=(await getView("staff")).staff||[];
    content.innerHTML='<h3>صلاحيات موظفي BARO</h3><p class="baro-mgmt-muted">أدخل UUID حساب الموظف وحدد صلاحيات BARO فقط، دون منحه صلاحيات مدير المتجر العامة.</p><div class="baro-mgmt-panel"><div class="baro-mgmt-form">'+
      field("معرّف المستخدم UUID","baroStaffUser","text","UUID")+
      selectField("الصلاحية","baroStaffPermission",[["view","عرض BARO"],["catalog","المنتجات والأسعار"],["orders","الطلبات"],["finance","الإدارة المالية"],["suppliers","الموردون"],["settings","إعدادات BARO"],["audit","سجل التدقيق"],["staff","إدارة الصلاحيات"]])+
      selectField("الحالة","baroStaffActive",[["true","مفعّلة"],["false","إيقاف"]])+
      '<button type="button" id="baroStaffSave">حفظ الصلاحية</button></div></div>'+
      table(["المستخدم","الصلاحية","الحالة","تاريخ الإضافة","منحها"],staffData.map(s=>row([s.user_id,s.permission_key,s.is_active?"مفعّلة":"موقوفة",new Date(s.created_at).toLocaleString("ar"),s.granted_by])));
    $("baroStaffSave").onclick=async()=>{
      const user_id=$("baroStaffUser").value.trim(),permission_key=$("baroStaffPermission").value,is_active=$("baroStaffActive").value==="true";
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(user_id)){msg("أدخل UUID صحيحاً للموظف.");return;}
      try{await post({action:"staff_permission_save",user_id,permission_key,is_active});msg("تم تحديث صلاحية BARO.");await loadStaff();}catch(e){msg(e.message);}
    };
  }

  async function showTab(tab) {
    activeTab=tab;const node=root();if(!node)return;
    node.querySelectorAll("[data-tab]").forEach(b=>b.classList.toggle("active",b.dataset.tab===tab));
    msg("");
    try{
      if(tab==="overview"){await loadAdmin();await loadOverview();}
      else if(tab==="finance")await loadFinance();
      else if(tab==="suppliers"){await loadAdmin();await loadSuppliers();}
      else if(tab==="settings")await loadSettings();
      else if(tab==="history")await loadHistory();
      else if(tab==="staff")await loadStaff();
      else if(tab==="assistant")await loadAdminAssistant();
    }catch(e){msg(e.message);}
  }

  const adminAiMessages = [];
  let adminAiSending = false;
  async function loadAdminAssistant() {
    const content=$("baroMgmtContent"); if(!content)return;
    content.innerHTML='<h3>🤖 BARO AI · مساعد الإدارة</h3><p class="baro-mgmt-muted">مساعد تحليلي لقسم الشحن اليدوي فقط. يراجع الطلبات والاستثناءات والكتالوج ويقترح إجراءات متابعة. لا ينفذ أي إجراء مالي أو تشغيلي.</p><div class="baro-mgmt-panel"><div class="baro-mgmt-actions"><button type="button" id="baroAdminAiSummary">حلّل وضع BARO الآن</button><button type="button" class="secondary" id="baroAdminAiClear">محادثة جديدة</button></div><div id="baroAdminAiMessages" class="baro-ai-messages" role="log" aria-live="polite" style="height:300px"><div class="baro-ai-bubble bot">أهلاً، أنا مساعد BARO للإدارة. فيني أراجع الطلبات المتأخرة، الحالات الاستثنائية، جاهزية الكتالوج، وأعطيك ملخصاً واضحاً.</div></div><form id="baroAdminAiForm" class="baro-ai-form"><input id="baroAdminAiInput" maxlength="1200" autocomplete="off" placeholder="اسأل عن الطلبات أو مشاكل BARO..." aria-label="رسالتك لمساعد BARO للإدارة"><button id="baroAdminAiSend" type="submit">إرسال</button></form><div id="baroAdminAiStatus" class="baro-mgmt-message" role="status"></div></div>';
    const bubble=(text,role)=>{const box=$("baroAdminAiMessages");if(!box)return;const el=document.createElement("div");el.className="baro-ai-bubble "+role;el.textContent=String(text||"");box.append(el);box.scrollTop=box.scrollHeight;};
    const send=async(text)=>{
      if(adminAiSending||!text.trim())return;
      adminAiMessages.push({role:"user",content:text.trim()});bubble(text.trim(),"user");
      adminAiSending=true;$("baroAdminAiSend").disabled=true;$("baroAdminAiStatus").textContent="عم يراجع بيانات BARO...";
      try{
        const {data:{session},error}=await sb.auth.getSession();if(error||!session?.access_token)throw new Error("انتهت الجلسة. سجّل الدخول مجدداً.");
        const response=await fetch(SUPABASE_URL+"/functions/v1/baro-ai-admin",{method:"POST",headers:{"Authorization":"Bearer "+session.access_token,"apikey":SUPABASE_KEY,"Content-Type":"application/json"},body:JSON.stringify({messages:adminAiMessages})});
        const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.error||"تعذر الاتصال بالمساعد.");
        if(typeof data.reply!=="string"||!data.reply.trim())throw new Error("وصل رد غير مكتمل.");
        adminAiMessages.push({role:"assistant",content:data.reply});bubble(data.reply,"bot");
        $("baroAdminAiStatus").textContent="الملخص مبني على بيانات BARO المتاحة فقط. لا يتم تنفيذ أي تغيير.";
      }catch(e){adminAiMessages.pop();bubble(e.message||"حدث خطأ مؤقت.","error");$("baroAdminAiStatus").textContent="تعذر إكمال الطلب.";}
      finally{adminAiSending=false;if($("baroAdminAiSend"))$("baroAdminAiSend").disabled=false;}
    };
    $("baroAdminAiForm").addEventListener("submit",e=>{e.preventDefault();const input=$("baroAdminAiInput"),v=input.value.trim();input.value="";send(v);});
    $("baroAdminAiSummary").addEventListener("click",()=>send("اعطني تقريراً تنفيذياً عن وضع BARO الآن: استقبال الطلبات، الطلبات النشطة والمتأخرة، الحالات التي تحتاج تدخلاً، جاهزية المنتجات والأسعار، وأهم ثلاث أولويات للإدارة. ميّز الحقائق عن الاستنتاجات."));
    $("baroAdminAiClear").addEventListener("click",()=>{adminAiMessages.length=0;loadAdminAssistant();});
  }

  async function refreshAll(){
    if(loading)return;loading=true;msg("جاري تحديث بيانات BARO...");
    try{await loadAccess();await loadAdmin();await showTab(activeTab);msg("تم تحديث بيانات BARO.");}
    catch(e){msg(e.message);}
    finally{loading=false;}
  }
  const baseLoadAdmin=window.loadBaroAdmin;
  if(typeof baseLoadAdmin==="function"){
    window.loadBaroAdmin=async function(){
      await baseLoadAdmin();
      try{await loadAccess();await loadAdmin();await showTab(activeTab);}catch(e){msg(e.message);}
    };
  }
  window.loadBaroManagement=refreshAll;
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>root());
  else root();
})();
