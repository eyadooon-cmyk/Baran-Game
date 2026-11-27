(function(){
  "use strict";
  const GATEWAY="baran-order-gateway";
  const ROOT_ID="baranInstantAppsRoot";
  const observedSections=new WeakSet();
  let products=[],activeProduct=null,quantity=100,quote=null,quoteTimer=null,quoteSequence=0,catalogPromise=null,paymentCurrency="USD",activeRequestId=null,lastOrderId=null,pollTimer=null,pollCount=0,orderSubmitted=false;
  const CATALOG_CACHE_KEY="baran_homscard_variable_catalog_v2";
  try{const cached=JSON.parse(sessionStorage.getItem(CATALOG_CACHE_KEY)||"null");if(cached&&Date.now()-cached.savedAt<10*60*1000&&Array.isArray(cached.products))products=cached.products;}catch{}
  const $=(id)=>document.getElementById(id);
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const money=(v)=>{const n=Number(v);if(!Number.isFinite(n))return "—";if(n>0&&n<1e-12)return "<0.000000000001";return n.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:12});};
  const productUnitPrice=(p)=>Number(p?.sale_unit_usd)>0?money(p.sale_unit_usd)+" $ · "+Number(p.sale_unit_syp||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})+" ل.س جديدة":"يُحسب حسب الكمية";
  const safeImage=(value)=>{try{const u=new URL(String(value||""));return u.protocol==="https:"?u.href:"";}catch{return "";}};
  async function invoke(body){
    if(!window.baranSupabaseClient?.functions)throw new Error("جلسة المتجر غير جاهزة. حدّث الصفحة وسجّل الدخول.");
    const {data,error}=await window.baranSupabaseClient.functions.invoke(GATEWAY,{body});
    if(error)throw new Error(data?.error||error.message||"تعذر الاتصال بخدمة الشحن.");
    if(!data?.success)throw new Error(data?.error||"تعذر تحميل بيانات المورد.");
    return data;
  }
  function showMessage(node,message,isError){node.textContent=message;node.classList.toggle("is-error",!!isError);node.classList.toggle("is-ok",!isError);}
  function renderCatalog(host,category){
    if(!host)return;
    host.replaceChildren();
    const visibleProducts=products.filter(p=>{const c=String(p.category||"").replace(/^ال/,"");return c.includes(category)||category.includes(c);});
    const head=el("div","baran-ia-heading");
    const copy=el("div");copy.append(el("span","baran-ia-kicker","BARAN GAME · شحن التطبيقات"),el("h3","","منتجات الشحن حسب الكمية"),el("p","","اختر المنتج، أدخل معرّف الحساب إذا طُلب، وحدد الكمية قبل مراجعة السعر."));
    head.append(copy,el("span","baran-ia-count",visibleProducts.length+" منتج"));
    host.append(head);
    if(!visibleProducts.length){host.append(el("div","baran-ia-empty","لا توجد منتجات متاحة حالياً ضمن هذا القسم. يرجى المحاولة لاحقاً."));return;}
    const grid=el("div","baran-ia-grid");
    visibleProducts.forEach(p=>{
      const card=el("article","baran-ia-card");
      const art=el("div","baran-ia-art");
      const image=safeImage(p.image);
      if(image){const img=el("img");img.src=image;img.alt=p.name;img.loading="lazy";img.onerror=()=>{img.remove();art.append(el("span","baran-ia-placeholder","✦"));};art.append(img);}
      else art.append(el("span","baran-ia-placeholder","✦"));

      const body=el("div","baran-ia-card-body");
      body.append(el("h4","",p.name),el("p","baran-ia-range","الكمية: "+Number(p.min_quantity).toLocaleString("en-US")+" – "+Number(p.max_quantity).toLocaleString("en-US")));
      const price=el("div","baran-ia-unit");price.append(el("small","","سعر الوحدة"),el("strong","",productUnitPrice(p)));
      const button=el("button","baran-ia-buy","عرض التفاصيل");
      button.type="button";button.addEventListener("click",()=>openProductDetails(p));
      body.append(price,button);card.append(art,body);grid.append(card);
    });
    host.append(grid);
  }
  async function refreshCatalog(){
    if(catalogPromise)return catalogPromise;
    catalogPromise=invoke({action:"homscard_variable_catalog"}).then(data=>{
      products=Array.isArray(data.products)?data.products:[];
      try{sessionStorage.setItem(CATALOG_CACHE_KEY,JSON.stringify({savedAt:Date.now(),products}));}catch{}
      document.querySelectorAll(".baran-variable-products").forEach(host=>{
        const section=host.closest("section");
        const category=section?.id==="automaticGames"?"ألعاب":section?.id==="appsStore"?"تطبيقات":section?.id==="telecomStore"?"اتصالات":"محافظ";
        if(host.isConnected)renderCatalog(host,category);
      });
      return products;
    }).finally(()=>{catalogPromise=null;});
    return catalogPromise;
  }
  async function loadCatalog(host,category){
    if(!host)return;
    if(products.length)renderCatalog(host,category);
    else host.replaceChildren(...Array.from({length:6},()=>{const skeleton=el("div","baran-ia-skeleton");skeleton.setAttribute("aria-hidden","true");return skeleton;}));
    try{await refreshCatalog();if(host.isConnected)renderCatalog(host,category);}
    catch(error){if(!products.length)host.replaceChildren(el("div","baran-ia-empty","تعذر تحديث المنتجات الآن. يرجى إعادة المحاولة بعد قليل."));}
  }
  function ensureModal(){
    let modal=$(ROOT_ID);if(modal)return modal;
    modal=el("div","baran-ia-overlay");modal.id=ROOT_ID;modal.hidden=true;
    const panel=el("section","baran-ia-modal");panel.setAttribute("role","dialog");panel.setAttribute("aria-modal","true");panel.setAttribute("aria-labelledby","baranIaTitle");
    const top=el("div","baran-ia-modal-top");top.append(el("span","baran-ia-kicker","BARAN GAME · CHECKOUT"));
    const close=el("button","baran-ia-close","×");close.type="button";close.setAttribute("aria-label","إغلاق");close.addEventListener("click",closeCheckout);top.append(close);
    const title=el("h3","","إتمام الشراء");title.id="baranIaTitle";
    const summary=el("div","baran-ia-product-summary");summary.id="baranIaProduct";
    const details=el("div","baran-ia-details");details.id="baranIaDetails";
    const detailImage=el("div","baran-ia-detail-image");detailImage.id="baranIaDetailImage";
    const detailName=el("h4","","");detailName.id="baranIaDetailName";
    const detailDescription=el("p","baran-ia-detail-description","");detailDescription.id="baranIaDetailDescription";
    const detailPrice=el("div","baran-ia-detail-price","");detailPrice.id="baranIaDetailPrice";
    const detailLimits=el("p","baran-ia-detail-limits","");detailLimits.id="baranIaDetailLimits";
    const detailTarget=el("p","baran-ia-detail-target","");detailTarget.id="baranIaDetailTarget";
    const detailsBuy=el("button","baran-ia-details-buy","شراء الآن");detailsBuy.type="button";detailsBuy.addEventListener("click",()=>openCheckout(activeProduct));
    details.append(detailImage,detailName,detailDescription,detailPrice,detailLimits,detailTarget,detailsBuy);
    const form=el("div","baran-ia-form");form.id="baranIaForm";form.hidden=true;
    const idLabel=el("label","","بيانات الحساب");idLabel.htmlFor="baranIaPlayer";
    const player=document.createElement("input");player.id="baranIaPlayer";player.type="text";player.autocomplete="off";player.inputMode="text";player.placeholder="أدخل معرّف الحساب";player.maxLength=100;player.dir="ltr";
    const qtyLabel=el("label","","الكمية المطلوبة");qtyLabel.htmlFor="baranIaQuantity";
    const qtyRow=el("div","baran-ia-quantity-row");
    const minus=el("button","baran-ia-step","−");minus.type="button";minus.addEventListener("click",()=>changeQuantity(-1));
    const input=document.createElement("input");input.id="baranIaQuantity";input.type="number";input.inputMode="numeric";input.min="1";input.step="1";input.addEventListener("change",()=>{const v=Number(input.value);if(Number.isSafeInteger(v)&&activeProduct)quantity=Math.min(activeProduct.max_quantity,Math.max(activeProduct.min_quantity,v));quote=null;$("baranIaPurchase").disabled=true;updateQuantityUI();scheduleQuote();});
    const plus=el("button","baran-ia-step","＋");plus.type="button";plus.addEventListener("click",()=>changeQuantity(1));qtyRow.append(minus,input,plus);
    const presets=el("div","baran-ia-presets");presets.id="baranIaPresets";
    const quoteBox=el("div","baran-ia-quote");quoteBox.id="baranIaQuote";quoteBox.append(el("span","","الإجمالي التقديري"),el("strong","","أدخل المعرّف والكمية لحساب السعر."));
    const currencyLabel=el("label","","عملة الدفع");currencyLabel.htmlFor="baranIaCurrency";
    const currency=document.createElement("select");currency.id="baranIaCurrency";
    [["USD","دولار أمريكي"],["SYP","ليرة سورية جديدة"]].forEach(([v,t])=>{const o=document.createElement("option");o.value=v;o.textContent=t;currency.append(o);});
    currency.addEventListener("change",()=>{paymentCurrency=currency.value;quote=null;$("baranIaPurchase").disabled=true;scheduleQuote();});
    player.addEventListener("input",()=>{quote=null;$("baranIaPurchase").disabled=true;scheduleQuote();});
    const note=el("p","baran-ia-note","المعاينة لا تخصم رصيداً. عند تفعيل الربط واعتماد المورد فقط، يُرسل الطلب وتُتابع حالته تلقائياً.");

    const status=el("p","baran-ia-status");status.id="baranIaStatus";status.setAttribute("role","status");
    const actions=el("div","baran-ia-actions");
    const back=el("button","baran-ia-back","رجوع لتفاصيل المنتج");back.type="button";back.addEventListener("click",()=>{form.hidden=true;details.hidden=false;summary.hidden=true;title.textContent="تفاصيل المنتج";});
    const review=el("button","baran-ia-review","مراجعة السعر");review.type="button";review.addEventListener("click",()=>fetchQuote(true));
    const purchase=el("button","baran-ia-purchase","تأكيد الطلب والشحن");purchase.type="button";purchase.disabled=true;purchase.id="baranIaPurchase";purchase.addEventListener("click",createOrder);
    const cancel=el("button","baran-ia-cancel","إلغاء");cancel.type="button";cancel.addEventListener("click",closeCheckout);
    const check=el("button","baran-ia-check","تحديث حالة الطلب");check.type="button";check.id="baranIaCheck";check.hidden=true;check.addEventListener("click",()=>checkOrder(false));
    actions.append(back,cancel,review,purchase,check);
    form.append(idLabel,player,qtyLabel,qtyRow,presets,currencyLabel,currency,quoteBox,note,status,actions);
    panel.append(top,title,details,summary,form);modal.append(panel);
    modal.addEventListener("click",e=>{if(e.target===modal)closeCheckout();});
    document.body.append(modal);
    return modal;
  }
  function openProductDetails(product){
    activeProduct=product;quantity=Number(product.min_quantity)||1;quote=null;activeRequestId=null;lastOrderId=null;orderSubmitted=false;paymentCurrency="USD";
    const modal=ensureModal();$("baranIaTitle").textContent="تفاصيل المنتج";
    $("baranIaDetails").hidden=false;$("baranIaProduct").hidden=true;$("baranIaForm").hidden=true;
    $("baranIaDetailImage").replaceChildren();
    const image=safeImage(product.image);
    if(image){const img=el("img");img.src=image;img.alt=product.name||"صورة المنتج";img.loading="lazy";img.onerror=()=>{img.remove();$("baranIaDetailImage").append(el("span","baran-ia-placeholder","✦"));};$("baranIaDetailImage").append(img);}
    else $("baranIaDetailImage").append(el("span","baran-ia-placeholder","✦"));
    $("baranIaDetailName").textContent=product.name||"المنتج";
    $("baranIaDetailDescription").textContent=product.description||("اشحن "+(product.name||"هذا المنتج")+" بالكمية التي تحتاجها. سيظهر السعر النهائي بعد حساب الكمية وقبل تأكيد الطلب.");
    $("baranIaDetailPrice").replaceChildren(el("small","","سعر الوحدة الحالي"),el("strong","",productUnitPrice(product)));
    $("baranIaDetailLimits").textContent="حدود الكمية: "+Number(product.min_quantity).toLocaleString("en-US")+" – "+Number(product.max_quantity).toLocaleString("en-US");
    $("baranIaDetailTarget").textContent=product.requires_target?"البيانات المطلوبة عند الشراء: "+(product.target_label||"معرّف الحساب"):"لا يتطلب هذا المنتج معرّف حساب إضافياً.";
    modal.hidden=false;document.body.classList.add("baran-ia-modal-open");
  }
  function openCheckout(product){
    if(product)activeProduct=product;if(!activeProduct)return;product=activeProduct;
    quantity=Number(product.min_quantity)||1;quote=null;activeRequestId=null;lastOrderId=null;orderSubmitted=false;paymentCurrency="USD";
    const modal=ensureModal();$("baranIaTitle").textContent="إتمام الشراء";
    $("baranIaDetails").hidden=true;$("baranIaProduct").hidden=false;$("baranIaForm").hidden=false;
    $("baranIaProduct").replaceChildren(el("strong","",product.name),el("span","","مراجعة طلبك"),el("small","",productUnitPrice(product)+" للوحدة"));
    const targetInput=$("baranIaPlayer"),targetLabel=document.querySelector('label[for="baranIaPlayer"]');
    targetInput.value="";targetInput.required=!!product.requires_target;targetInput.hidden=!product.requires_target;
    targetInput.placeholder=product.target_label||"أدخل بيانات الحساب";targetLabel.hidden=!product.requires_target;targetLabel.textContent=product.target_label||"بيانات الحساب";\n     window.BaranPlayerNameCheck?.attach(targetInput,{product_code:product.product_code,name:product.name});
    $("baranIaStatus").textContent="";$("baranIaCurrency").value=paymentCurrency;$("baranIaPurchase").disabled=true;$("baranIaPurchase").textContent="تأكيد الطلب والشحن";$("baranIaCheck").hidden=true;
    $("baranIaQuote").replaceChildren(el("span","","الإجمالي التقديري"),el("strong","","أدخل الكمية لحساب السعر."));
    const presets=$("baranIaPresets");presets.replaceChildren(el("small","baran-ia-presets-label","كميات سريعة — اختيارات للكمية وليست باقات ثابتة"));
    const min=Number(product.min_quantity),max=Number(product.max_quantity);
    const step=min>=10000?10000:min>=1000?1000:min>=200?100:min;
    const snap=value=>Math.min(max,Math.max(min,min+Math.floor((value-min)/step)*step));
    const vals=[min,snap(min*10),snap(min*100),max].filter((v,i,a)=>Number.isSafeInteger(v)&&v>=min&&v<=max&&a.indexOf(v)===i);
    vals.forEach(v=>{const b=el("button","baran-ia-preset",Number(v).toLocaleString("en-US"));b.type="button";b.addEventListener("click",()=>{quantity=v;quote=null;$("baranIaPurchase").disabled=true;updateQuantityUI();scheduleQuote();});presets.append(b);});
    updateQuantityUI();modal.hidden=false;document.body.classList.add("baran-ia-modal-open");
    if(product.requires_target)$("baranIaPlayer").focus();else $("baranIaQuantity").focus();
  }
  function closeCheckout(){if(pollTimer)clearTimeout(pollTimer);pollTimer=null;const m=$(ROOT_ID);if(m)m.hidden=true;document.body.classList.remove("baran-ia-modal-open");activeProduct=null;quote=null;activeRequestId=null;lastOrderId=null;orderSubmitted=false;}
  function changeQuantity(direction){if(!activeProduct)return;const min=Number(activeProduct.min_quantity)||1;const step=min>=10000?10000:min>=1000?1000:min>=200?100:min;quantity=Math.min(activeProduct.max_quantity,Math.max(activeProduct.min_quantity,quantity+direction*step));quote=null;$("baranIaPurchase").disabled=true;updateQuantityUI();scheduleQuote();}
  function updateQuantityUI(){const input=$("baranIaQuantity");if(input&&activeProduct){input.min=String(activeProduct.min_quantity);input.max=String(activeProduct.max_quantity);input.value=String(quantity);}}
  function scheduleQuote(){quoteSequence++;if(quoteTimer)clearTimeout(quoteTimer);quoteTimer=setTimeout(()=>{if(activeProduct)fetchQuote(false);},350);}
  async function fetchQuote(showErrors){
    if(!activeProduct)return;
    const playerId=$("baranIaPlayer").value.trim();
    const requestedProduct=activeProduct,requestedQuantity=quantity,requestedCurrency=paymentCurrency;
    const sequence=++quoteSequence;
    const button=document.querySelector(".baran-ia-review");button.disabled=true;showMessage($("baranIaStatus"),"جاري تحديث السعر حسب الكمية...",false);
    try{
      const data=await invoke({action:"homscard_variable_quote",product_id:requestedProduct.product_id,quantity:requestedQuantity,player_id:playerId,payment_currency:requestedCurrency});
      if(sequence!==quoteSequence||activeProduct!==requestedProduct||quantity!==requestedQuantity||paymentCurrency!==requestedCurrency)return;
      if(String(data?.quote?.product_id??"")!==String(requestedProduct.product_id??"") ||
         String(data?.quote?.product_name??"").trim()!==String(requestedProduct.name??"").trim()) {
        throw new Error("تعذر مطابقة المنتج مع تسعيرة المورد. حدّث الصفحة وحاول مجدداً؛ لم يتم إنشاء طلب أو خصم رصيد.");
      }
      quote=data.quote;
      const amount=requestedCurrency==="USD"?money(quote.sale_usd)+" $":Number(quote.sale_syp||0).toLocaleString("en-US")+" ل.س جديدة";
      const quotedUnit=Number(quote.sale_usd||0)/Number(quote.quantity||requestedQuantity);
      const unitAmount=requestedCurrency==="USD"?money(quotedUnit)+" $ / وحدة":(Number(quote.sale_syp||0)/Number(quote.quantity||requestedQuantity)).toLocaleString("en-US",{maximumFractionDigits:6})+" ل.س جديدة / وحدة";
      const productMeta=$("baranIaProduct")?.querySelector("small");
      if(productMeta)productMeta.textContent=requestedCurrency==="USD"?money(quotedUnit)+" $ للوحدة":(Number(quote.sale_syp||0)/Number(quote.quantity||requestedQuantity)).toLocaleString("en-US",{maximumFractionDigits:6})+" ل.س جديدة للوحدة";
      $("baranIaQuote").replaceChildren(el("span","","الإجمالي التقديري"),el("strong","",amount),el("small","",unitAmount+" · "+Number(quote.quantity).toLocaleString("en-US")+" وحدة"));
      const needsTarget=requestedProduct.requires_target&&playerId.length<2;
      $("baranIaPurchase").disabled=needsTarget;
      showMessage($("baranIaStatus"),needsTarget?"تم تحديث السعر. أدخل معرّف الحساب لتفعيل متابعة الطلب.":"تم تحديث السعر تلقائياً حسب الكمية.",false);
    }catch(error){
      if(sequence!==quoteSequence)return;
      quote=null;$("baranIaPurchase").disabled=true;showMessage($("baranIaStatus"),error.message,true);
    }finally{if(sequence===quoteSequence)button.disabled=false;}
  }
  async function createOrder(){
    if(!activeProduct||!quote)return;
    const playerId=$("baranIaPlayer").value.trim();
    if(activeProduct.requires_target&&playerId.length<2){showMessage($("baranIaStatus"),"أدخل بيانات الحساب المطلوبة أولاً.",true);return;}
    if(!activeRequestId)activeRequestId=crypto.randomUUID();
    const button=$("baranIaPurchase");button.disabled=true;
    showMessage($("baranIaStatus"),"جاري التحقق من جاهزية المورد وإنشاء الطلب...",false);
    try{
      const data=await invoke({action:"homscard_variable_create_order",product_id:activeProduct.product_id,
        quantity,player_id:playerId,payment_currency:paymentCurrency,request_id:activeRequestId});
      lastOrderId=data.order_id;activeRequestId=null;orderSubmitted=true;pollCount=0;$("baranIaCheck").hidden=false;
      showMessage($("baranIaStatus"),data.message||("تم تسجيل الطلب. الحالة: "+(data.status||"قيد المعالجة")+". رقم الطلب: "+data.order_id),false);
      $("baranIaPurchase").textContent="تم تسجيل الطلب";
      if(data.status!=="completed"&&data.status!=="rejected")scheduleStatusPoll();
    }catch(error){
      showMessage($("baranIaStatus"),error.message,true);
      // Keep the same request UUID on uncertain network failures to prevent duplicate orders.
    }finally{button.disabled=!quote||orderSubmitted;}
  }
  function scheduleStatusPoll(){
    if(pollTimer)clearTimeout(pollTimer);
    if(!lastOrderId||pollCount>=20)return;
    pollTimer=setTimeout(()=>{pollCount++;checkOrder(true);},15000);
  }
  async function checkOrder(silent){
    if(!lastOrderId)return;
    const button=$("baranIaCheck");button.disabled=true;
    try{
      const data=await invoke({action:"homscard_variable_check_order",order_id:lastOrderId});
      if(!silent||data.status==="completed"||data.status==="rejected")
        showMessage($("baranIaStatus"),data.message||("حالة الطلب: "+data.status),data.status==="rejected");
      if(data.status==="completed"){$("baranIaPurchase").textContent="تم الشحن بنجاح";if(pollTimer)clearTimeout(pollTimer);pollTimer=null;}
      else if(data.status==="rejected"){$("baranIaPurchase").textContent="تم الاسترداد";if(pollTimer)clearTimeout(pollTimer);pollTimer=null;}
      else scheduleStatusPoll();
    }catch(error){if(!silent)showMessage($("baranIaStatus"),error.message,true);if(silent)scheduleStatusPoll();}
    finally{button.disabled=false;}
  }
  function observeSection(){
    const sections=[["automaticGames","ألعاب"],["appsStore","تطبيقات"],["telecomStore","اتصالات"],["digitalWalletsStore","محافظ"]];
    sections.forEach(([id,category])=>{
      const section=$(id);if(!section||observedSections.has(section))return;
      observedSections.add(section);
      let host=section.querySelector(".baran-variable-products");
      if(!host&&id==="appsStore")host=$("appsProductCatalog");
      if(host)host.classList.add("baran-variable-products");
      if(!host){
        host=el("div","deposit-card baran-service-catalog baran-variable-products");
        host.setAttribute("aria-live","polite");
        const anchor=section.querySelector(".hero")||section.firstElementChild;
        if(anchor?.parentNode)anchor.parentNode.insertBefore(host,anchor.nextSibling);else section.append(host);
      }
      const load=()=>{if(!section.classList.contains("hidden"))loadCatalog(host,category);};
      const observer=new MutationObserver(load);
      observer.observe(section,{attributes:true,attributeFilter:["class"]});
      load();
    });
  }
  window.loadBaranInstantApps=()=>observeSection();
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",observeSection,{once:true});else observeSection();
})();