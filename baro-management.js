"use strict";
(function () {
  const $ = id => document.getElementById(id);
  const api = (method, body, view) => window.baroApi(method || "GET", body || null, view || "admin");
  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const money = (v, currency) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return currency === "SYP" ? n.toLocaleString("en-US") + " ل.س" : "$" + n.toFixed(2);
  };
  let access = {}, adminData = {}, financeData = {}, supplierData = {}, settingsData = {}, historyData = [], auditData = [], staffData = [];
  let activeTab = "overview", loading = false;

  const style = document.createElement("style");
  style.textContent = ".baro-customer-products{margin:16px 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}.baro-customer-products>h3{grid-column:1/-1;color:#d7c4e8;margin:8px 0}.baro-customer-product-card{padding:15px;border:1px solid #59466b;border-radius:15px;background:linear-gradient(145deg,#21182b,#110d16);display:flex;flex-direction:column;gap:8px;min-width:0}.baro-customer-product-card>strong{font-size:16px;color:#f2eafa}.baro-card-prices{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:4px 0}.baro-price-usd,.baro-price-syp{padding:9px 7px;border-radius:10px;background:#30243a;color:#e8d8f4;text-align:center;font-size:16px}.baro-price-syp{background:#211c29;color:#d7c4e8}.baro-preview-label{font-size:12px;color:#bba9ca}.baro-customer-product-card button{width:100%;margin-top:5px}#baroManagementWorkspace{margin:16px 0;padding:16px;border:1px solid #59466b;border-radius:18px;background:linear-gradient(155deg,#1b1522,#100d14)}#baroManagementWorkspace h3{color:#d7c4e8;margin:5px 0 12px}.baro-mgmt-tabs{display:flex;gap:7px;overflow-x:auto;padding:4px 0 12px}.baro-mgmt-tabs button{flex:0 0 auto;padding:9px 12px;background:#2a2033;color:#eee;border:1px solid #59466b}.baro-mgmt-tabs button.active{background:#8b6ba8;color:#100b16}.baro-mgmt-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:9px;margin:12px 0}.baro-mgmt-stat{padding:12px;border:1px solid #493b55;border-radius:12px;background:#201a28;min-width:0}.baro-mgmt-stat span{display:block;font-size:12px;color:#bba9ca}.baro-mgmt-stat strong{display:block;font-size:20px;color:#e6d8f0;overflow-wrap:anywhere;margin-top:5px}.baro-mgmt-panel{padding:12px;border:1px solid #493b55;border-radius:13px;background:#17121e;margin:10px 0}.baro-mgmt-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:9px}.baro-mgmt-form label{display:block;font-size:12px;color:#c7b5d5}.baro-mgmt-form input,.baro-mgmt-form select,.baro-mgmt-form textarea{margin:5px 0 0;min-width:0}.baro-mgmt-form button{align-self:end}.baro-mgmt-table-wrap{overflow-x:auto;margin-top:12px}.baro-mgmt-table{width:100%;border-collapse:collapse;min-width:560px;font-size:12px}.baro-mgmt-table th,.baro-mgmt-table td{padding:9px;border-bottom:1px solid #40334b;text-align:right;vertical-align:top}.baro-mgmt-table th{color:#d7c4e8;background:#211a2b}.baro-mgmt-muted{font-size:12px;color:#b9a9c9;line-height:1.7}.baro-mgmt-actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.baro-mgmt-actions button{width:auto}.baro-mgmt-message{min-height:22px;color:#d7c4e8;font-size:13px}.baro-mgmt-empty{padding:14px;border:1px dashed #59466b;border-radius:11px;color:#b9a9c9;text-align:center}.baro-mgmt-badge{display:inline-block;padding:4px 8px;border-radius:20px;background:#30243a;color:#e4d5f0;font-size:11px}@media(max-width:520px){#baroManagementWorkspace{padding:11px}.baro-mgmt-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.baro-mgmt-stat strong{font-size:17px}}";
  document.head.append(style);

  function root() {
    const panel = document.querySelector('[data-admin-panel="baro"]');
    if (!panel) return null;
    let node = $("baroManagementWorkspace");
    if (!node) {
      node = document.createElement("section");
      node.id = "baroManagementWorkspace";
      const toggleCard = $("baroManualToggle") && $("baroManualToggle").closest(".deposit-card");
      if (toggleCard && toggleCard.parentNode) toggleCard.after(node);
      else panel.prepend(node);
      node.innerHTML = '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"><div><h2 style="margin:0">BARO CONTROL</h2><p class="baro-mgmt-muted">لوحة مستقلة للشحن اليدوي · لا تتحكم بالشحن الآلي</p></div><span class="baro-mgmt-badge">إدارة BARO</span></div><div class="baro-mgmt-tabs" role="tablist"><button type="button" data-tab="overview">الرئيسية</button><button type="button" data-tab="finance">المالية</button><button type="button" data-tab="suppliers">الموردون</button><button type="button" data-tab="settings">الإعدادات</button><button type="button" data-tab="history">السجلات والتقارير</button><button type="button" data-tab="staff">الصلاحيات</button></div><div id="baroMgmtMessage" class="baro-mgmt-message" role="status" aria-live="polite"></div><div id="baroMgmtContent"></div>';
      node.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));
    }
    return node;
  }
  function msg(text) { const el = $("baroMgmtMessage"); if (el) el.textContent = text || ""; }
  function can(permission) { return access.is_admin || (access.permissions || []).includes(permission); }
  function field(label,id,type,placeholder,value) {
    return '<label>' + label + '<input id="' + id + '" type="' + (type || "text") + '" placeholder="' + esc(placeholder || "") + '" value="' + esc(value == null ? "" : value) + '"></label>';
  }
  function selectField(label,id,options) {
    return '<label>' + label + '<select id="' + id + '">' + options.map(o => '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>').join("") + '</select></label>';
  }
  function table(headers, rows) {
    if (!rows.length) return '<div class="baro-mgmt-empty">لا توجد سجلات حالياً.</div>';
    return '<div class="baro-mgmt-table-wrap"><table class="baro-mgmt-table"><thead><tr>' + headers.map(h => '<th>' + esc(h) + '</th>').join("") + '</tr></thead><tbody>' + rows.join("") + '</tbody></table></div>';
  }
  function row(values) { return '<tr>' + values.map(v => '<td>' + esc(v == null || v === "" ? "—" : v) + '</td>').join("") + '</tr>'; }
  function stat(label,value) { return '<div class="baro-mgmt-stat"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong></div>'; }
  async function getView(view) { return api("GET",null,view); }
  async function post(body) { return api("POST",body); }

  async function loadAccess() {
    access = await getView("access");
    const node = root();
    if (node && !access.is_admin) {
      const map = {overview:"view",finance:"finance",suppliers:"suppliers",settings:"settings",history:"audit",staff:"staff"};
      node.querySelectorAll("[data-tab]").forEach(b => { b.hidden = !can(map[b.dataset.tab]); });
      const productList=$("baroAdminProducts");
      if(productList){productList.hidden=!can("catalog");if(productList.previousElementSibling)productList.previousElementSibling.hidden=!can("catalog");if(productList.previousElementSibling?.previousElementSibling)productList.previousElementSibling.previousElementSibling.hidden=!can("catalog");}
      const orderList=$("baroAdminOrders");
      if(orderList){orderList.hidden=!can("orders");if(orderList.previousElementSibling)orderList.previousElementSibling.hidden=!can("orders");if(orderList.previousElementSibling?.previousElementSibling)orderList.previousElementSibling.previousElementSibling.hidden=!can("orders");}
    }
  }
  async function loadAdmin() {
    try { adminData = await getView("admin"); } catch (e) { adminData = {}; msg(e.message); }
  }
  async function loadOverview() {
    const content=$("baroMgmtContent"); if(!content)return;
    let t={};
    if(can("finance")){financeData=await getView("finance").catch(()=>({totals:{},entries:[]}));t=financeData.totals||{};}
    const orders=adminData.orders||[];
    const products=adminData.products||[];
    const pending=orders.filter(o=>!["completed","cancelled","failed"].includes(o.status)).length;
    const threshold=Number(adminData.settings?.low_margin_percent??15);
    const priced=products.filter(p=>Number(p.sale_price_usd)>0&&Number(p.supplier_cost_usd)>0);
    const expectedProfit=priced.reduce((sum,p)=>sum+Number(p.sale_price_usd)-Number(p.supplier_cost_usd),0);
    const lowMargin=priced.filter(p=>((Number(p.sale_price_usd)-Number(p.supplier_cost_usd))/Number(p.sale_price_usd))*100<threshold);
    const alertNames=lowMargin.slice(0,8).map(p=>esc(p.product_name)+" ("+(((Number(p.sale_price_usd)-Number(p.supplier_cost_usd))/Number(p.sale_price_usd))*100).toFixed(1)+"%)").join(" · ");
    content.innerHTML='<h3>مؤشرات BARO</h3><div class="baro-mgmt-grid">'+
      stat("المبيعات المقبوضة",money(t.sales||0))+
      stat("تكلفة الموردين",money(t.supplier_costs||0))+
      stat("المصاريف",money(t.expenses||0))+
      stat("العمولات",money(t.commissions||0))+
      stat("المستردات",money(t.refunds||0))+
      stat("صافي الربح المسجل",money(t.net_profit||0))+
      stat("الربح المتوقع للمنتجات",money(expectedProfit))+
      stat("تنبيهات هامش الربح",lowMargin.length)+
      stat("الطلبات الظاهرة",orders.length)+stat("طلبات قيد المتابعة",pending)+
      '</div><p class="baro-mgmt-muted">المبيعات تُحسب بعد تأكيد استلام الدفع يدوياً فقط. الربح المتوقع تقدير من أسعار البيع والتكلفة الحالية، أما صافي الربح المسجل فيُحسب من الحركات المالية الفعلية. لا تشمل هذه الأرقام محفظة الشحن الآلي.</p>'+
      (lowMargin.length?'<div class="baro-mgmt-panel"><strong>تنبيه هامش الربح</strong><p class="baro-mgmt-muted">'+alertNames+(lowMargin.length>8?" · وغيرها":"")+'</p></div>':'')+
      '<div class="baro-mgmt-actions"><button type="button" id="baroMgmtRefresh">تحديث بيانات BARO</button><button type="button" id="baroMgmtProducts" class="secondary">إدارة المنتجات</button><button type="button" id="baroMgmtOrders" class="secondary">إدارة الطلبات</button><button type="button" id="baroMgmtExportOrders" class="secondary">تصدير الطلبات CSV</button><button type="button" id="baroMgmtExportProducts" class="secondary">تصدير المنتجات CSV</button></div>';
    $("baroMgmtRefresh").onclick=refreshAll;
    $("baroMgmtProducts").onclick=()=>$("baroAdminProducts")?.scrollIntoView({behavior:"smooth"});
    $("baroMgmtOrders").onclick=()=>$("baroAdminOrders")?.scrollIntoView({behavior:"smooth"});
    $("baroMgmtExportOrders").onclick=()=>exportCsv("baro-orders.csv",[["id","product","player_id","quantity","status","payment_status","displayed_usd","displayed_syp","created_at"],...orders.map(o=>[o.id,o.product_name_snapshot,o.player_id,o.quantity,o.status,o.payment_status,o.displayed_price_usd_snapshot,o.displayed_price_syp_snapshot,o.created_at])]);
    $("baroMgmtExportProducts").onclick=()=>exportCsv("baro-products.csv",[["code","name","sale_usd","sale_syp","supplier_cost_usd","visible","purchase_enabled"],...products.map(p=>[p.product_code,p.product_name,p.sale_price_usd,p.sale_price_syp,p.supplier_cost_usd,p.catalog_visible,p.purchase_enabled])]);
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
    const today=new Date().toISOString().slice(0,10),month=today.slice(0,7);
    const daily=entries.filter(e=>String(e.created_at).slice(0,10)===today),monthly=entries.filter(e=>String(e.created_at).slice(0,7)===month);
    const sum=rows=>rows.reduce((n,e)=>n+(e.status==="posted"?Number(e.amount_usd_equivalent||0):0),0);
    content.innerHTML='<h3>الإدارة المالية المستقلة</h3><div class="baro-mgmt-grid">'+
      stat("المبيعات المحصلة",money(t.sales||0))+stat("تكاليف الموردين",money(t.supplier_costs||0))+
      stat("المصاريف والعمولات",money((t.expenses||0)+(t.commissions||0)))+stat("صافي الربح",money(t.net_profit||0))+
      stat("حركات اليوم",daily.length)+stat("قيمة حركات اليوم",money(sum(daily)))+
      stat("حركات الشهر",monthly.length)+stat("قيمة حركات الشهر",money(sum(monthly)))+
      '</div><p class="baro-mgmt-muted">تسجيل الحركة هنا محاسبي فقط؛ لا ينفذ تحويلاً أو خصماً أو استرداداً فعلياً. لا تُسجل المبيعات كأموال محصلة إلا بعد تأكيد الدفع.</p>'+
      '<div class="baro-mgmt-panel"><h3>إضافة حركة مالية</h3><div class="baro-mgmt-form">'+
      selectField("نوع الحركة","baroFinanceType",[["expense","مصروف"],["commission","عمولة"],["refund","مبلغ مسترد"],["adjustment","تسوية / تعديل"]])+
      field("العنوان","baroFinanceTitle","text","مثال: رسوم تحويل")+
      field("المبلغ","baroFinanceAmount","number","0.00")+
      selectField("العملة","baroFinanceCurrency",[["USD","دولار USD"],["SYP","ليرة سورية SYP"]])+
      field("سعر الصرف (ليرة لكل دولار)","baroFinanceRate","number","مطلوب عند استخدام الليرة")+
      field("رقم الطلب (اختياري)","baroFinanceOrder","text","UUID الطلب")+
      field("مرجع خارجي","baroFinanceRef","text","رقم إيصال أو حوالة")+
      '<label>ملاحظات<textarea id="baroFinanceDesc" rows="2"></textarea></label><button type="button" id="baroFinanceSave">حفظ الحركة</button></div></div>'+
      '<div class="baro-mgmt-actions"><button type="button" id="baroFinanceExport" class="secondary">تصدير كشف BARO المالي CSV</button></div><h3>دفتر الحركات المالية</h3>'+
      table(["التاريخ","النوع","الوصف","المبلغ","المكافئ USD","الحالة","رقم الطلب"],entries.map(e=>row([new Date(e.created_at).toLocaleString("ar"),e.entry_type,e.title,money(e.amount,e.currency),money(e.amount_usd_equivalent),e.status,e.order_id])));
    $("baroFinanceSave").onclick=async()=>{
      const type=$("baroFinanceType").value,title=$("baroFinanceTitle").value.trim(),value=Number($("baroFinanceAmount").value);
      const currency=$("baroFinanceCurrency").value,rate=$("baroFinanceRate").value.trim()===""?null:Number($("baroFinanceRate").value);
      const order=$("baroFinanceOrder").value.trim()||null;
      if(title.length<2||!Number.isFinite(value)||value<=0||(currency==="SYP"&&(!rate||rate<=0))){msg("أدخل عنواناً ومبلغاً صحيحاً وسعر صرف عند استخدام الليرة.");return;}
      const key=globalThis.crypto?.randomUUID?.()||("baro-"+Date.now()+"-"+Math.random().toString(16).slice(2));
      try{await post({action:"finance_entry",entry_type:type,title,amount:value,currency,exchange_rate:rate,order_id:order,external_reference:$("baroFinanceRef").value.trim(),description:$("baroFinanceDesc").value.trim(),idempotency_key:key});msg("تم تسجيل الحركة في دفتر BARO فقط.");await loadFinance();}
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
    }catch(e){msg(e.message);}
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
