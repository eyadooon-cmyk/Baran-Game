(function(){
  "use strict";
  const GATEWAY="baran-order-gateway";
  const ROOT_ID="baranInstantAppsRoot";
  let products=[],activeProduct=null,quantity=100,quote=null,quoteTimer=null,loading=false,catalogPromise=null;
  const $=(id)=>document.getElementById(id);
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const money=(v)=>Number(v||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:6});
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
    const copy=el("div");copy.append(el("span","baran-ia-kicker","HOMSCARD · VARIABLE QUANTITY"),el("h3","","منتجات الشحن حسب الكمية"),el("p","","اختر المنتج، أدخل معرّف الحساب إذا طُلب، وحدد الكمية قبل مراجعة السعر."));
    head.append(copy,el("span","baran-ia-count",visibleProducts.length+" منتج"));
    host.append(head);
    if(!visibleProducts.length){host.append(el("div","baran-ia-empty","لا توجد حالياً منتجات متغيرة الكمية اجتازت فحص التوفر والسعر لدى HomsCard ضمن هذا القسم."));return;}
    const grid=el("div","baran-ia-grid");
    visibleProducts.forEach(p=>{
      const card=el("article","baran-ia-card");
      const art=el("div","baran-ia-art");
      const image=safeImage(p.image);
      if(image){const img=el("img");img.src=image;img.alt=p.name;img.loading="lazy";img.onerror=()=>{img.remove();art.append(el("span","baran-ia-placeholder","✦"));};art.append(img);}
      else art.append(el("span","baran-ia-placeholder","✦"));
      art.append(el("span","baran-ia-live","متاح لدى المورد"));
      const body=el("div","baran-ia-card-body");
      body.append(el("h4","",p.name),el("p","baran-ia-range","الكمية: "+Number(p.min_quantity).toLocaleString("en-US")+" – "+Number(p.max_quantity).toLocaleString("en-US")));
      const price=el("div","baran-ia-unit");price.append(el("small","","سعر الوحدة يبدأ من"),el("strong","",money(p.sale_unit_usd)+" $"));
      const button=el("button","baran-ia-buy","تحديد الكمية");
      button.type="button";button.addEventListener("click",()=>openCheckout(p));
      body.append(price,button);card.append(art,body);grid.append(card);
    });
    host.append(grid);
  }
  async function loadCatalog(host,category){
    if(!host)return;
    if(products.length){renderCatalog(host,category);return;}
    if(!catalogPromise){
      host.replaceChildren(el("div","baran-ia-loading","جاري تحميل منتجات HomsCard المتاحة..."));
      catalogPromise=invoke({action:"homscard_variable_catalog"}).then(data=>{
        products=Array.isArray(data.products)?data.products:[];
        return products;
      }).finally(()=>{loading=false;});
    }
    loading=true;
    try{await catalogPromise;renderCatalog(host,category);}
    catch(error){host.replaceChildren(el("div","baran-ia-empty",error.message));catalogPromise=null;}
  }
  function ensureModal(){
    let modal=$(ROOT_ID);if(modal)return modal;
    modal=el("div","baran-ia-overlay");modal.id=ROOT_ID;modal.hidden=true;
    const panel=el("section","baran-ia-modal");panel.setAttribute("role","dialog");panel.setAttribute("aria-modal","true");panel.setAttribute("aria-labelledby","baranIaTitle");
    const top=el("div","baran-ia-modal-top");top.append(el("span","baran-ia-kicker","BARAN GAME · CHECKOUT"));
    const close=el("button","baran-ia-close","×");close.type="button";close.setAttribute("aria-label","إغلاق");close.addEventListener("click",closeCheckout);top.append(close);
    const title=el("h3","","إتمام الشراء");title.id="baranIaTitle";
    const summary=el("div","baran-ia-product-summary");summary.id="baranIaProduct";
    const form=el("div","baran-ia-form");
    const idLabel=el("label","","بيانات الحساب");idLabel.htmlFor="baranIaPlayer";
    const player=document.createElement("input");player.id="baranIaPlayer";player.type="text";player.autocomplete="off";player.inputMode="text";player.placeholder="أدخل معرّف الحساب";player.maxLength=100;player.dir="ltr";
    const qtyLabel=el("label","","الكمية المطلوبة");qtyLabel.htmlFor="baranIaQuantity";
    const qtyRow=el("div","baran-ia-quantity-row");
    const minus=el("button","baran-ia-step","−");minus.type="button";minus.addEventListener("click",()=>changeQuantity(-1));
    const input=document.createElement("input");input.id="baranIaQuantity";input.type="number";input.inputMode="numeric";input.min="1";input.step="1";input.addEventListener("change",()=>{const v=Number(input.value);if(Number.isSafeInteger(v)&&activeProduct)quantity=Math.min(activeProduct.max_quantity,Math.max(activeProduct.min_quantity,v));updateQuantityUI();scheduleQuote();});
    const plus=el("button","baran-ia-step","＋");plus.type="button";plus.addEventListener("click",()=>changeQuantity(1));qtyRow.append(minus,input,plus);
    const presets=el("div","baran-ia-presets");presets.id="baranIaPresets";
    const quoteBox=el("div","baran-ia-quote");quoteBox.id="baranIaQuote";quoteBox.append(el("span","","الإجمالي التقديري"),el("strong","","أدخل المعرّف والكمية لحساب السعر."));
    const note=el("p","baran-ia-note","السعر النهائي يُحسب من تسعير باران وبيانات المورد. هذه معاينة سعر فقط؛ تنفيذ الشحن والخصم غير مفعّلين بهذه الخطوة.");
    const status=el("p","baran-ia-status");status.id="baranIaStatus";status.setAttribute("role","status");
    const actions=el("div","baran-ia-actions");
    const review=el("button","baran-ia-review","مراجعة السعر");review.type="button";review.addEventListener("click",()=>fetchQuote(true));
    const cancel=el("button","baran-ia-cancel","إلغاء");cancel.type="button";cancel.addEventListener("click",closeCheckout);
    actions.append(cancel,review);
    form.append(idLabel,player,qtyLabel,qtyRow,presets,quoteBox,note,status,actions);
    panel.append(top,title,summary,form);modal.append(panel);
    modal.addEventListener("click",e=>{if(e.target===modal)closeCheckout();});
    document.body.append(modal);
    return modal;
  }
  function openCheckout(product){
    activeProduct=product;quantity=product.min_quantity;quote=null;
    const modal=ensureModal();$("baranIaProduct").replaceChildren(el("strong","",product.name),el("span","","HomsCard · معاينة طلب"),el("small","",money(product.sale_unit_usd)+" $ للوحدة"));
    const targetInput=$("baranIaPlayer"),targetLabel=document.querySelector('label[for="baranIaPlayer"]');
    targetInput.value="";targetInput.required=!!product.requires_target;targetInput.hidden=!product.requires_target;
    targetInput.placeholder=product.target_label||"بيانات الحساب";targetLabel.hidden=!product.requires_target;targetLabel.textContent=product.target_label||"بيانات الحساب";
    $("baranIaStatus").textContent="";
    $("baranIaQuote").replaceChildren(el("span","","الإجمالي التقديري"),el("strong","","أدخل المعرّف والكمية لحساب السعر."));
    const presets=$("baranIaPresets");presets.replaceChildren();
    const vals=[product.min_quantity,Math.min(product.max_quantity,Math.max(product.min_quantity,1000)),Math.min(product.max_quantity,Math.max(product.min_quantity,10000)),product.max_quantity].filter((v,i,a)=>a.indexOf(v)===i);
    vals.forEach(v=>{const b=el("button","baran-ia-preset",Number(v).toLocaleString("en-US"));b.type="button";b.addEventListener("click",()=>{quantity=v;updateQuantityUI();scheduleQuote();});presets.append(b);});
    updateQuantityUI();modal.hidden=false;document.body.classList.add("baran-ia-modal-open");
    $("baranIaPlayer").focus();
  }
  function closeCheckout(){const m=$(ROOT_ID);if(m)m.hidden=true;document.body.classList.remove("baran-ia-modal-open");activeProduct=null;quote=null;}
  function changeQuantity(direction){if(!activeProduct)return;const step=activeProduct.min_quantity>=1000?100:1;quantity=Math.min(activeProduct.max_quantity,Math.max(activeProduct.min_quantity,quantity+direction*step));updateQuantityUI();scheduleQuote();}
  function updateQuantityUI(){const input=$("baranIaQuantity");if(input&&activeProduct){input.min=String(activeProduct.min_quantity);input.max=String(activeProduct.max_quantity);input.value=String(quantity);}}
  function scheduleQuote(){if(quoteTimer)clearTimeout(quoteTimer);quoteTimer=setTimeout(()=>{if($("baranIaPlayer")?.value.trim().length>=2)fetchQuote(false);},500);}
  async function fetchQuote(showErrors){
    if(!activeProduct)return;
    const playerId=$("baranIaPlayer").value.trim();
    if(activeProduct.requires_target&&playerId.length<2){if(showErrors)showMessage($("baranIaStatus"),"أدخل "+(activeProduct.target_label||"بيانات الحساب")+" أولاً.",true);return;}
    const button=document.querySelector(".baran-ia-review");button.disabled=true;showMessage($("baranIaStatus"),"جاري حساب السعر...",false);
    try{
      const data=await invoke({action:"homscard_variable_quote",product_id:activeProduct.product_id,quantity,player_id:playerId,payment_currency:"USD"});
      quote=data.quote;
      $("baranIaQuote").replaceChildren(el("span","","الإجمالي التقديري"),el("strong","",money(quote.sale_usd)+" $"),el("small","",Number(quote.quantity).toLocaleString("en-US")+" وحدة"));
      showMessage($("baranIaStatus"),"تم تحديث السعر. راجع الكمية ومعرّف الحساب قبل المتابعة.",false);
    }catch(error){quote=null;showMessage($("baranIaStatus"),error.message,true);}
    finally{button.disabled=false;}
  }
  function observeSection(){
    const sections=[["automaticGames","ألعاب"],["appsStore","تطبيقات"],["telecomStore","اتصالات"],["digitalWalletsStore","محافظ"]];
    sections.forEach(([id,category])=>{
      const section=$(id);if(!section)return;
      let host=section.querySelector(".baran-variable-products");
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