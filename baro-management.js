"use strict";
(function () {
  const $ = id => document.getElementById(id);
  const api = (method, body, view) => window.baroApi(method || "GET", body || null, view || "admin");
  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const money = (v, currency) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "—";
    return currency === "SYP" ? n.toLocaleString("en-US") + " ل.س" : n.toLocaleString("en-US",{maximumFractionDigits:2}) + "$";
  };
  let access = {}, adminData = {}, financeData = {}, supplierData = {}, settingsData = {}, historyData = [], auditData = [], staffData = [];
  let activeTab = "overview", loading = false, financeWorkspaceActive = false;
  let financeSubmitInFlight = false;

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
      node.innerHTML = '<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"><div><h2 style="margin:0">BARO CONTROL</h2><p class="baro-mgmt-muted">لوحة مستقلة للشحن اليدوي · لا تتحكم بالشحن الآلي</p></div><span class="baro-mgmt-badge">إدارة BARO</span></div><div class="baro-mgmt-tabs" role="tablist"><button type="button" data-tab="overview">الرئيسية</button><button type="button" data-tab="suppliers">الموردون</button><button type="button" data-tab="history">السجلات والتقارير</button><button type="button" data-tab="staff">الصلاحيات</button><button type="button" data-tab="assistant">🤖 مساعد BARO AI</button></div><div id="baroMgmtMessage" class="baro-mgmt-message" role="status" aria-live="polite"></div><div id="baroMgmtContent"></div>';
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
  function statDual(label,usd,syp) { return '<div class="baro-mgmt-stat"><span>'+esc(label)+'</span><strong>'+esc(usd)+'</strong><small style="display:block;color:#b9a9c9;margin-top:4px">'+esc(syp)+'</small></div>'; }
  async function getView(view) { return api("GET",null,view); }
  async function post(body) { return api("POST",body); }

  async function loadAccess() {
    access = await getView("access");
    const node = root();
    if (node && !access.is_admin) {
      const map = {overview:"view",suppliers:"suppliers",history:"audit",staff:"staff",assistant:"orders"};
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
    const fmtUsd=v=>Number(v||0).toLocaleString("en-US",{maximumFractionDigits:2})+"$";
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
    content.innerHTML='<h3>مالية BARO المستقلة</h3>'+
      '<div class="baro-mgmt-panel"><h3>1) الدفتر المالي الفعلي</h3><p class="baro-mgmt-muted">الأرقام من الحركات المسجلة فعلياً بحالة «مرحّلة» فقط. كل قيمة بالدولار وبجانبها ما يعادلها بالليرة.</p><div class="baro-mgmt-grid">'+
      statDual("المبيعات المقبوضة",fmtUsd(t.sales||0),fmtSyp((t.sales||0)*rate))+statDual("مبيعات لم يكتمل تنفيذها",fmtUsd(t.unmatched_sales||0),fmtSyp((t.unmatched_sales||0)*rate))+statDual("المبيعات المحققة",fmtUsd(t.realized_sales||0),fmtSyp((t.realized_sales||0)*rate))+statDual("تكاليف الموردين",fmtUsd(t.supplier_costs||0),fmtSyp((t.supplier_costs||0)*rate))+
      statDual("المصاريف",fmtUsd(t.expenses||0),fmtSyp((t.expenses||0)*rate))+statDual("العمولات",fmtUsd(t.commissions||0),fmtSyp((t.commissions||0)*rate))+
      statDual("المبالغ المستردة",fmtUsd(t.refunds||0),fmtSyp((t.refunds||0)*rate))+statDual("التسويات",fmtUsd(t.adjustments||0),fmtSyp((t.adjustments||0)*rate))+
      statDual("صافي الربح المحقق",fmtUsd(t.net_profit||0),fmtSyp((t.net_profit||0)*rate))+stat("الحركات المرحلة",posted.length)+stat("بانتظار الترحيل",pending)+
      stat("حركات اليوم",daily.length)+stat("حركات الشهر",monthly.length)+
      '</div><div class="baro-mgmt-panel"><strong>معادلة صافي الربح</strong><p class="baro-mgmt-muted">المبيعات المقبوضة − تكاليف الموردين − المصاريف − العمولات − المبالغ المستردة + التسويات. الحركات المعلقة لا تدخل في الربح المحقق.</p></div>'+
      (entries.length===0?'<div class="baro-mgmt-empty">لا توجد حركات مالية مسجلة حالياً؛ الربح المحقق = صفر لأن لا توجد عمليات مالية مسجلة، وليس لأن المتجر خسر.</div>':'')+
      '<p class="baro-mgmt-muted">هذا الدفتر مستقل عن محافظ الزبائن والشحن الآلي والحسابات العامة.</p></div>'+
      '<div class="baro-mgmt-panel"><h3>2) ربح كل باقة — تقديري قبل البيع</h3><p class="baro-mgmt-muted">سعر الصرف: 1 USD = '+fmtSyp(rate)+'. مثال 110 جوهرة: تكلفة المورد 0.94$ × 156 = 147 SYP تقريباً. سعر البيع 160 SYP؛ الربح المتوقع 13 SYP للوحدة قبل أي عمولة أو مصروف إضافي.</p>'+
      (productRows.length?table(["الباقة","تكلفة المورد USD","التكلفة SYP","سعر البيع USD","سعر البيع SYP","ربح الوحدة SYP","ربح الوحدة USD","هامش الربح"],productRows):'<div class="baro-mgmt-empty">لا توجد باقات لديها تكلفة مورد وسعر بيع معتمدان حالياً.</div>')+
      '<div class="baro-mgmt-panel"><strong>شرح الحساب</strong><p class="baro-mgmt-muted">تكلفة المورد بالدولار × سعر الصرف = التكلفة بالليرة. سعر البيع − التكلفة = ربح الوحدة المتوقع. هامش الربح = ربح الوحدة ÷ سعر البيع × 100. مثال 110: تكلفة 147 SYP، بيع 160 SYP، ربح 13 SYP، وهامش يقارب 8.1%.</p><p class="baro-mgmt-muted">الجدول يعرض ربح الوحدة وليس مجموع أرباح المتجر. لا يتحول الربح المتوقع إلى ربح محقق إلا بعد تنفيذ الطلب وتسجيل المقبوض والتكلفة الفعلية.</p></div></div>'+
      '<div class="baro-mgmt-panel"><h3>مبيعات خارجية منفّذة يدوياً</h3><p class="baro-mgmt-muted">سجّل البيع بعد قبض المبلغ وتنفيذ الشحن خارج المتجر. ينشئ النظام قيد مبيعات وقيد تكلفة مورد مرتبطين بمرجع واحد، ويحسب الربح بالدولار. لا ينشئ طلب زبون ولا يغيّر أي محفظة.</p><div class="baro-mgmt-form">'+
      selectField("المورد","baroExternalSupplier",[["","— اختر المورد —"],...(financeData.suppliers||[]).map(s=>[s.id,s.name])])+
      field("المنتج / الباقة","baroExternalProduct","text","مثال: Free Fire 1188 جوهرة")+
      field("اسم الزبون (اختياري)","baroExternalCustomer","text","اسم الزبون")+
      field("معرّف اللاعب (اختياري)","baroExternalPlayer","text","Player ID")+
      field("المبلغ المقبوض من الزبون","baroExternalSaleAmount","number","0.00")+
      selectField("عملة المقبوض","baroExternalSaleCurrency",[["USD","دولار USD"],["SYP","ليرة سورية SYP"]])+
      field("سعر الصرف للمقبوض (SYP لكل USD)","baroExternalSaleRate","number","مطلوب إذا كانت العملة SYP",currentSettings.usd_syp_rate||adminData.settings?.usd_syp_rate||"")+
      field("تكلفة الشراء من المورد","baroExternalCostAmount","number","0.00")+
      selectField("عملة تكلفة المورد","baroExternalCostCurrency",[["USD","دولار USD"],["SYP","ليرة سورية SYP"]])+
      field("سعر الصرف للتكلفة (SYP لكل USD)","baroExternalCostRate","number","مطلوب إذا كانت العملة SYP",currentSettings.usd_syp_rate||adminData.settings?.usd_syp_rate||"")+
      selectField("طريقة قبض المبلغ","baroExternalPaymentMethod",[["sham_cash","شام كاش"],["cash","نقداً"],["other","طريقة أخرى"]])+
      field("مرجع حوالة الزبون (اختياري)","baroExternalCustomerRef","text","رقم الحوالة")+
      field("مرجع شراء المورد (اختياري)","baroExternalSupplierRef","text","رقم الفاتورة أو المرجع")+
      '<label>ملاحظات داخلية<textarea id="baroExternalNotes" rows="2"></textarea></label>'+
      '<label><input type="checkbox" id="baroExternalConfirmed"> أؤكد أن المبلغ قُبض وأن شحن الباقة نُفّذ فعلياً.</label>'+
      '<button type="button" id="baroExternalSave">تسجيل البيع الخارجي والقيود المالية</button></div></div>'+
      '<div class="baro-mgmt-panel"><h3>سجل المبيعات الخارجية</h3><p class="baro-mgmt-muted">إذا لم يظهر المورد بالقائمة، أضفه أولاً من قسم موردي BARO. تصدير هذا السجل يشمل بيانات البيع والتكلفة والمراجع الأصلية.</p><button type="button" id="baroExternalExport" class="secondary">تصدير سجل المبيعات الخارجية CSV</button>'+
      ((financeData.external_sales||[]).length?table(["التاريخ","المنتج","الزبون / اللاعب","المورد","المقبوض","التكلفة","الربح USD","طريقة القبض"],financeData.external_sales.map(s=>row([
        new Date(s.created_at).toLocaleString("ar"),s.product_name,[s.customer_name,s.player_id].filter(Boolean).join(" / ")||"—",
        s.supplier_name_snapshot,s.sale_currency==="SYP"?fmtSyp(s.sale_amount):fmtUsd(s.sale_amount),
        s.supplier_cost_currency==="SYP"?fmtSyp(s.supplier_cost_amount):fmtUsd(s.supplier_cost_amount),
        fmtUsd(s.profit_usd_equivalent),s.payment_method==="sham_cash"?"شام كاش":s.payment_method==="cash"?"نقداً":"أخرى"
      ]))):'<div class="baro-mgmt-empty">لا توجد مبيعات خارجية مسجلة بعد.</div>')+'</div>'+
      '<div class="baro-mgmt-panel"><h3>إضافة حركة مالية</h3><div class="baro-mgmt-form">'+
      selectField("نوع الحركة","baroFinanceType",[["expense","مصروف"],["commission","عمولة"],["refund","مبلغ مسترد"],["adjustment","تسوية / تعديل"]])+
      field("العنوان","baroFinanceTitle","text","مثال: رسوم تحويل")+
      field("المبلغ","baroFinanceAmount","number","0.00")+
      selectField("العملة","baroFinanceCurrency",[["USD","دولار USD"],["SYP","ليرة سورية SYP"]])+
      field("سعر الصرف (SYP لكل دولار)","baroFinanceRate","number","مطلوب عند استخدام الليرة")+
      field("رقم الطلب (اختياري)","baroFinanceOrder","text","UUID الطلب")+
      field("مرجع خارجي","baroFinanceRef","text","رقم إيصال أو حوالة")+
      '<label>ملاحظات<textarea id="baroFinanceDesc" rows="2"></textarea></label><button type="button" id="baroFinanceSave">حفظ الحركة</button></div></div>'+
      '<div class="baro-mgmt-actions"><button type="button" id="baroFinanceExport" class="secondary">تصدير كشف BARO المالي CSV</button></div><div class="baro-mgmt-panel"><h3>دفتر الحركات المالية الفعلية</h3><p class="baro-mgmt-muted">كل سطر يمثل حركة مستقلة. راجع العملة الأصلية والمكافئ بالدولار وحالة الترحيل قبل اعتماد أي تسوية.</p>'+
      (entries.length?table(["التاريخ","نوع الحركة","البيان","المبلغ والعملة الأصلية","المكافئ USD","حالة الترحيل","مرجع الطلب / البيع الخارجي"],entries.map(e=>row([new Date(e.created_at).toLocaleString("ar"),typeLabels[e.entry_type]||e.entry_type,e.title,e.currency==="SYP"?fmtSyp(e.amount):fmtUsd(e.amount),fmtUsd(e.amount_usd_equivalent),e.status==="posted"?"مرحّلة":e.status==="pending"?"بانتظار الترحيل":e.status,e.external_sale_id||e.order_id]))):'<div class="baro-mgmt-empty">لا توجد حركات مالية فعلية مسجلة بعد. ستظهر المبيعات والتكاليف هنا بعد الطلبات المنفذة والمقبوضة.</div>')+'</div>'+
      (can("settings")?'<div class="baro-mgmt-panel"><h3>إعدادات مالية BARO</h3><p class="baro-mgmt-muted">سعر الصرف وحد التنبيه وهما خاصان بعمليات BARO فقط، ولا يغيران إعدادات الشحن الآلي أو المحافظ.</p><div class="baro-mgmt-form">'+field("سعر الدولار مقابل SYP","baroSettingRate","number","مثال: 156",currentSettings.usd_syp_rate)+field("حد التنبيه لهامش الربح %","baroSettingMargin","number","15",currentSettings.low_margin_percent==null?15:currentSettings.low_margin_percent)+selectField("العملة الافتراضية","baroSettingCurrency",[["USD","الدولار USD"],["SYP","الليرة السورية SYP"]])+'<button type="button" id="baroSettingsSave">حفظ الإعدادات المالية</button></div></div>':"");
    if($("baroSettingsSave")){$("baroSettingCurrency").value=currentSettings.default_currency||"USD";$("baroSettingsSave").onclick=async()=>{const rateInput=$("baroSettingRate").value.trim(),rate=rateInput===""?null:Number(rateInput),margin=Number($("baroSettingMargin").value),currency=$("baroSettingCurrency").value;if((rate!==null&&(!Number.isFinite(rate)||rate<=0))||!Number.isFinite(margin)||margin<0||margin>100){msg("تحقق من سعر الصرف وهامش الربح.");return;}try{await post({action:"settings_save",usd_syp_rate:rate,low_margin_percent:margin,default_currency:currency});msg("تم حفظ إعدادات BARO المالية.");await loadFinance();}catch(e){msg(e.message);}};}
    $("baroExternalExport").onclick=()=>exportCsv("baro-external-sales.csv",[
      ["date","product","customer","player_id","supplier","sale_amount","sale_currency","sale_usd","supplier_cost","supplier_cost_currency","supplier_cost_usd","profit_usd","payment_method","customer_reference","supplier_reference","notes"],
      ...(financeData.external_sales||[]).map(s=>[s.created_at,s.product_name,s.customer_name,s.player_id,s.supplier_name_snapshot,s.sale_amount,s.sale_currency,s.sale_usd_equivalent,s.supplier_cost_amount,s.supplier_cost_currency,s.supplier_cost_usd_equivalent,s.profit_usd_equivalent,s.payment_method,s.customer_reference,s.supplier_reference,s.notes])
    ]);
    $("baroExternalSave").onclick=async()=>{
      if(financeSubmitInFlight)return;
      const button=$("baroExternalSave");
      const product=$("baroExternalProduct").value.trim(),supplier=$("baroExternalSupplier").value;
      const saleAmount=Number($("baroExternalSaleAmount").value),costAmount=Number($("baroExternalCostAmount").value);
      const saleCurrency=$("baroExternalSaleCurrency").value,costCurrency=$("baroExternalCostCurrency").value;
      const saleRateInput=$("baroExternalSaleRate").value.trim(),costRateInput=$("baroExternalCostRate").value.trim();
      const saleRate=saleRateInput===""?null:Number(saleRateInput),costRate=costRateInput===""?null:Number(costRateInput);
      if(product.length<2||!supplier||!Number.isFinite(saleAmount)||saleAmount<=0||!Number.isFinite(costAmount)||costAmount<=0
        ||(saleCurrency==="SYP"&&(!saleRate||saleRate<=0))||(costCurrency==="SYP"&&(!costRate||costRate<=0))){
        msg("أكمل اسم المنتج والمورد والمبلغين، وأدخل سعر الصرف لكل مبلغ بالليرة.");return;
      }
      if(!$("baroExternalConfirmed").checked){msg("أكد أولاً أن القبض تم وأن الشحن نُفّذ فعلياً.");return;}
      const payload={action:"external_sale_create",product_name:product,customer_name:$("baroExternalCustomer").value.trim(),
        player_id:$("baroExternalPlayer").value.trim(),supplier_id:supplier,sale_amount:saleAmount,sale_currency:saleCurrency,
        sale_exchange_rate:saleRate,supplier_cost_amount:costAmount,supplier_cost_currency:costCurrency,
        supplier_cost_exchange_rate:costRate,payment_method:$("baroExternalPaymentMethod").value,
        customer_reference:$("baroExternalCustomerRef").value.trim(),supplier_reference:$("baroExternalSupplierRef").value.trim(),
        notes:$("baroExternalNotes").value.trim(),execution_confirmed:true};
      const fingerprint=JSON.stringify(payload),storageKey="baro.external-sale.pending.v1";
      let key="";
      try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||"null");key=saved&&saved.fingerprint===fingerprint&&typeof saved.key==="string"?saved.key:"";}catch(_){}
      if(!key)key=globalThis.crypto?.randomUUID?.()||("baro-ext-"+Date.now()+"-"+Math.random().toString(16).slice(2));
      try{sessionStorage.setItem(storageKey,JSON.stringify({fingerprint,key}));}catch(_){}
      payload.idempotency_key=key;financeSubmitInFlight=true;
      if(button){button.disabled=true;button.textContent="جارٍ تسجيل البيع...";}
      msg("جارٍ تسجيل البيع الخارجي وقيدي المقبوض والتكلفة...");
      let committed=false;
      try{
        await post(payload);
        committed=true;
        msg("تم تسجيل البيع الخارجي وقيدي المبيعات والتكلفة مرة واحدة. جارٍ تحديث السجل...");
        await loadFinance();
        try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||"null");if(saved?.key===key)sessionStorage.removeItem(storageKey);}catch(_){}
      }catch(e){
        if(committed)msg("تم تسجيل البيع فعلياً، لكن تعذر تحديث السجل. حدّث صفحة BARO ولا تعاود إرسال العملية.");
        else msg((e&&e.message)||"تعذر تأكيد التسجيل. أعد المحاولة دون تغيير البيانات لتجنب التكرار.");
      }finally{
        financeSubmitInFlight=false;
        const current=$("baroExternalSave");
        if(current&&current===button&&committed){current.disabled=true;current.textContent="تم التسجيل — حدّث الصفحة";}
        else if(current){current.disabled=false;current.textContent="تسجيل البيع الخارجي والقيود المالية";}
      }
    };
    $("baroFinanceSave").onclick=async()=>{
      if(financeSubmitInFlight)return;
      const button=$("baroFinanceSave");
      const type=$("baroFinanceType").value,title=$("baroFinanceTitle").value.trim(),value=Number($("baroFinanceAmount").value);
      const currency=$("baroFinanceCurrency").value,rateInput=$("baroFinanceRate").value.trim(),exchangeRate=rateInput===""?null:Number(rateInput);
      const order=$("baroFinanceOrder").value.trim()||null;
      if(title.length<2||!Number.isFinite(value)||value<=0||(currency==="SYP"&&(!exchangeRate||exchangeRate<=0))){msg("أدخل عنواناً ومبلغاً صحيحاً وسعر صرف SYP لكل دولار عند استخدام الليرة.");return;}
      const payload={action:"finance_entry",entry_type:type,title,amount:value,currency,exchange_rate:exchangeRate,order_id:order,external_reference:$("baroFinanceRef").value.trim(),description:$("baroFinanceDesc").value.trim()};
      const fingerprint=JSON.stringify(payload);
      const storageKey="baro.finance.pending_submission.v1";
      let key="";
      try{
        const saved=JSON.parse(sessionStorage.getItem(storageKey)||"null");
        key=saved&&saved.fingerprint===fingerprint&&typeof saved.key==="string"?saved.key:"";
      }catch(_){}
      if(!key)key=globalThis.crypto?.randomUUID?.()||("baro-"+Date.now()+"-"+Math.random().toString(16).slice(2));
      try{sessionStorage.setItem(storageKey,JSON.stringify({fingerprint,key}));}catch(_){}
      payload.idempotency_key=key;
      financeSubmitInFlight=true;
      if(button){button.disabled=true;button.textContent="جارٍ الحفظ...";}
      msg("جارٍ تسجيل الحركة والتحقق من نتيجة الحفظ...");
      try{
        await post(payload);
        try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||"null");if(saved?.key===key)sessionStorage.removeItem(storageKey);}catch(_){}
        msg("تم تسجيل الحركة مرة واحدة في دفتر BARO.");
        financeSubmitInFlight=false;
        await loadFinance();
      }catch(e){
        msg((e&&e.message)||"تعذر تأكيد الحفظ. أعد المحاولة دون تغيير بيانات الحركة لتجنب التكرار.");
      }finally{
        financeSubmitInFlight=false;
        const currentButton=$("baroFinanceSave");
        if(currentButton){currentButton.disabled=false;currentButton.textContent="حفظ الحركة";}
      }
    };
    $("baroFinanceExport").onclick=()=>exportCsv("baro-finance.csv",[["date","type","title","amount","currency","usd_equivalent","status","order_id","external_sale_id"],...entries.map(e=>[e.created_at,e.entry_type,e.title,e.amount,e.currency,e.amount_usd_equivalent,e.status,e.order_id,e.external_sale_id])]);
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
