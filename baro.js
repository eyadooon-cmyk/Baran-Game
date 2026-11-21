"use strict";
function baroEndpoint(){return SUPABASE_URL+"/functions/v1/baran-baro-manual";}
const BARO_STATUS={pending:"طلب جديد — بانتظار مراجعة BARO",awaiting_payment:"بانتظار الدفع",paid:"تم تأكيد الدفع",in_progress:"قيد التنفيذ اليدوي",completed:"مكتمل — تم الشحن والخصم",failed:"تعذر التنفيذ",needs_review:"يحتاج مراجعة",cancelled:"ملغي"};
const BARO_PAYMENT={awaiting_quote:"بانتظار عرض السعر",awaiting_payment:"بانتظار الدفع",verified:"تم تأكيد الدفع",failed:"تعذر تأكيد الدفع"};
let baroCustomerProducts=[],baroAdminProducts=[],baroAdminOrders=[],baroCustomerWallet={balance_usd:0,balance_syp:0};
let baroManualEnabled=false,baroAdminManualEnabled=false,baroAdminSettings={low_margin_percent:10};
const baroEl=id=>document.getElementById(id);
function baroEscape(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function baroMoney(value,currency){if(value===null||value===undefined||value==="")return "بانتظار تحديد السعر";const n=Number(value);return !Number.isFinite(n)?"—":currency==="USD"?"$"+n.toFixed(2):n.toLocaleString("en-US")+" SYP";}
async function baroApi(method="GET",body=null,view="admin"){
 const {data:{session},error}=await sb.auth.getSession();
 if(error||!session)throw new Error("انتهت الجلسة. سجّل الدخول مجدداً.");
 const response=await fetch(baroEndpoint()+(method==="GET"?"?view="+encodeURIComponent(view):""),{
  method,headers:{"Authorization":"Bearer "+session.access_token,"apikey":SUPABASE_KEY,"Content-Type":"application/json"},
  body:body?JSON.stringify(body):undefined
 });
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(data.error||"تعذر الاتصال بقسم BARO.");
 return data;
}
let baroPendingSubmission=null;
const baroUuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function baroIdempotencyKey(){
 if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();
 if(globalThis.crypto?.getRandomValues){const b=new Uint8Array(16);globalThis.crypto.getRandomValues(b);b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=[...b].map(x=>x.toString(16).padStart(2,"0")).join("");return h.slice(0,8)+"-"+h.slice(8,12)+"-"+h.slice(12,16)+"-"+h.slice(16,20)+"-"+h.slice(20);}
 throw new Error("تعذر إنشاء رقم آمن لمحاولة الطلب. حدّث المتصفح وحاول مجدداً.");
}
async function baroRequestFingerprint(request){
 if(!globalThis.crypto?.subtle)return null;
 const bytes=new TextEncoder().encode(JSON.stringify(request));
 const digest=await globalThis.crypto.subtle.digest("SHA-256",bytes);
 return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
function baroGetPendingSubmission(fingerprint){
 if(baroPendingSubmission?.fingerprint===fingerprint)return baroPendingSubmission;
 try{
  const saved=JSON.parse(globalThis.sessionStorage?.getItem("baro_pending_order_retry")||"null");
  if(saved?.fingerprint===fingerprint&&baroUuidPattern.test(saved.idempotency_key)){
   baroPendingSubmission=saved;return saved;
  }
 }catch{}
 baroPendingSubmission={fingerprint,idempotency_key:baroIdempotencyKey()};
 try{globalThis.sessionStorage?.setItem("baro_pending_order_retry",JSON.stringify(baroPendingSubmission));}catch{}
 return baroPendingSubmission;
}
function baroClearPendingSubmission(){
 baroPendingSubmission=null;
 try{globalThis.sessionStorage?.removeItem("baro_pending_order_retry");}catch{}
}
function baroSelectedProduct(){return baroCustomerProducts.find(p=>p.product_code===baroEl("baroProductSelect")?.value)||null;}
function baroUpdateQuantityField(){
 const p=baroSelectedProduct(),wrap=baroEl("baroQuantityWrap"),input=baroEl("baroQuantity");
 const isTokens=p?.category_id==="jawaker"&&p?.group_id==="tokens";
 if(wrap)wrap.classList.toggle("hidden",!isTokens);
 if(input){input.min=isTokens?"10000":"1";input.max=isTokens?"1000000":"1";input.step=isTokens?"1000":"1";input.value=isTokens?"10000":"1";}
}
let baroCheckoutModal=null,baroCheckoutPlaceholder=null,baroCheckoutSummary=null;
function baroPrepareCheckout(){
 const checkout=baroEl("baroSubmitOrder")?.closest(".game-checkout");
 if(!checkout||baroCheckoutModal)return;
 baroCheckoutPlaceholder=document.createComment("BARO checkout placeholder");
 checkout.parentNode.insertBefore(baroCheckoutPlaceholder,checkout);
 const style=document.createElement("style");
 style.id="baro-product-checkout-modal-style";
 style.textContent=".baro-catalog-product-card{appearance:none;-webkit-appearance:none;width:100%;font:inherit;color:inherit;text-align:inherit;cursor:pointer}.baro-catalog-product-card:focus-visible{outline:2px solid #c18bed;outline-offset:3px}.baro-catalog-product-card:active{transform:scale(.985)}.baro-checkout-modal{position:fixed;inset:0;z-index:10050;display:none;align-items:center;justify-content:center;padding:14px;background:rgba(5,3,9,.82);backdrop-filter:blur(8px)}.baro-checkout-modal.is-open{display:flex}.baro-checkout-dialog{position:relative;width:min(520px,100%);max-height:90vh;overflow:auto;padding:17px;border:1px solid #76518f;border-radius:20px;background:linear-gradient(150deg,#241a30,#100c16);box-shadow:0 24px 80px #000b}.baro-checkout-modal-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.baro-checkout-modal-head strong{color:#f3e8fb;font-size:17px}.baro-checkout-close{width:38px;height:38px;flex:0 0 38px;border:1px solid #76518f;border-radius:11px;background:#30203f;color:#fff;font-size:21px}.baro-checkout-product{margin:0 0 13px;padding:11px 13px;border:1px solid #76518f;border-radius:12px;background:#a56bd61c;color:#e8d5f6;font-weight:800}.baro-checkout-dialog .game-checkout{margin:0;padding:0;border:0;background:transparent}.baro-checkout-dialog #baroProductSelect{display:none}.baro-checkout-dialog .game-checkout h3{display:none}.baro-checkout-dialog #baroOrderMessage{margin-top:10px;line-height:1.8}.baro-checkout-dialog .baro-id-confirm{display:flex;align-items:flex-start;gap:9px;line-height:1.8}.baro-checkout-dialog .baro-id-confirm input{width:auto;flex:0 0 auto;margin-top:5px}.baro-checkout-dialog textarea{width:100%;box-sizing:border-box}@media(max-width:520px){.baro-checkout-modal{align-items:flex-end;padding:8px}.baro-checkout-dialog{max-height:88vh;border-radius:20px 20px 14px 14px;padding:15px}}";
 document.head.append(style);
 const modal=document.createElement("div");modal.className="baro-checkout-modal";modal.setAttribute("aria-hidden","true");
 const dialog=document.createElement("div");dialog.className="baro-checkout-dialog";dialog.setAttribute("role","dialog");dialog.setAttribute("aria-modal","true");dialog.setAttribute("aria-labelledby","baroCheckoutTitle");
 const head=document.createElement("div");head.className="baro-checkout-modal-head";
 const title=document.createElement("strong");title.id="baroCheckoutTitle";title.textContent="إتمام طلب الشحن اليدوي";
 const close=document.createElement("button");close.type="button";close.className="baro-checkout-close";close.textContent="×";close.setAttribute("aria-label","إغلاق");
 head.append(title,close);
 baroCheckoutSummary=document.createElement("div");baroCheckoutSummary.className="baro-checkout-product";
 dialog.append(head,baroCheckoutSummary,checkout);modal.append(dialog);document.body.append(modal);
 const closeModal=()=>{modal.classList.remove("is-open");modal.setAttribute("aria-hidden","true");if(baroCheckoutPlaceholder?.parentNode)baroCheckoutPlaceholder.parentNode.insertBefore(checkout,baroCheckoutPlaceholder.nextSibling);};
 close.addEventListener("click",closeModal);
 modal.addEventListener("click",event=>{if(event.target===modal)closeModal();});
 document.addEventListener("keydown",event=>{if(event.key==="Escape"&&modal.classList.contains("is-open"))closeModal();});
 baroCheckoutModal={modal,closeModal};
}
function baroOpenProductCheckout(product){
 if(!product)return;
 const select=baroEl("baroProductSelect");
 if(select)select.value=product.product_code;
 const player=baroEl("baroPlayerId"),confirmed=baroEl("baroPlayerIdConfirmed"),note=baroEl("baroCustomerNote");
 if(player)player.value="";
 const playerRepeat=baroEl("baroPlayerIdRepeat");if(playerRepeat)playerRepeat.value="";
 if(confirmed)confirmed.checked=false;
 if(note)note.value="";
 if(baroCheckoutSummary)baroCheckoutSummary.textContent=String(product.product_name||"منتج BARO")+" · "+(product.category_id==="pubg"?"PUBG MOBILE":product.category_id==="freefire"?"FREE FIRE":product.category_id==="jawaker"?"JAWAKER":"BARO");
 const message=baroEl("baroOrderMessage");
 if(message)message.textContent=baroManualEnabled&&product.purchase_enabled===true?"أدخل ID وتأكد من صحته قبل إرسال الطلب.":"المعاينة متاحة، لكن استقبال الطلبات مغلق حالياً ولن يتم إرسال أي طلب.";
 baroUpdateQuantityField();baroUpdateOrderSubmitState();
 if(baroCheckoutModal){baroCheckoutModal.modal.querySelector(".baro-checkout-dialog")?.append(baroEl("baroSubmitOrder")?.closest(".game-checkout"));baroCheckoutModal.modal.classList.add("is-open");baroCheckoutModal.modal.setAttribute("aria-hidden","false");baroEl("baroPlayerId")?.focus();}
}
function renderBaroCustomerCatalog(products){
 const box=baroEl("baroCustomerCatalog");if(!box)return;
 box.replaceChildren();
 const categoryMeta={
  pubg:{label:"PUBG MOBILE",icon:"🎯",eyebrow:"BATTLEGROUNDS",description:"شدات UC والاشتراكات وباقات PUBG"},
  freefire:{label:"FREE FIRE",icon:"🔥",eyebrow:"BOOYAH!",description:"جواهر فري فاير والعضويات"},
  jawaker:{label:"JAWAKER",icon:"🃏",eyebrow:"CARD GAMES",description:"توكنز جواكر ومسرّعات اللعب"}
 };
 const groupMeta={
  uc:{label:"شدات UC",icon:"💎",description:"باقات الشدات"},
  growth:{label:"حزم واشتراكات PUBG",icon:"🚀",description:"Prime والاشتراكات والباقات"},
  diamonds:{label:"جواهر Free Fire",icon:"💠",description:"باقات الجواهر"},
  memberships:{label:"عضويات Free Fire",icon:"👑",description:"العضويات الأسبوعية وغيرها"},
  tokens:{label:"جواكر توكنز",icon:"🪙",description:"السيرفر الأول والسيرفر الثاني"},
  boosters:{label:"مسرّعات جواكر",icon:"⚡",description:"الأحمر والأزرق والأسود والذهبي"}
 };
 const categoryOrder=["pubg","freefire","jawaker"];
 const groupOrder={pubg:["uc","growth"],freefire:["diamonds","memberships"],jawaker:["tokens","boosters"]};
 const intro=document.createElement("div");intro.className="baro-catalog-intro";
 const introMark=document.createElement("span");introMark.className="baro-catalog-intro-mark";introMark.textContent="✦";
 const introCopy=document.createElement("div");
 const introTitle=document.createElement("strong");introTitle.textContent="اكتشف منتجات BARO";
 const introText=document.createElement("p");introText.textContent=baroManualEnabled?"اختر باقة Free Fire متاحة، ثم أدخل ID اللاعب وأكّده قبل إرسال الطلب. لا يُخصم أي مبلغ إلا بعد اكتمال الشحن بنجاح.":"تصفّح منتجات BARO وشاهد أسعار البيع المعتمدة بالدولار والليرة. استقبال الطلبات اليدوية مغلق حالياً."
 introCopy.append(introTitle,introText);intro.append(introMark,introCopy);box.append(intro);
 if(!products.length){
  const empty=document.createElement("div");empty.className="baro-catalog-empty";
  empty.textContent="لا توجد منتجات معتمدة للعرض حالياً. سنعرض المنتجات هنا فور تجهيزها.";
  box.append(empty);return;
 }
 const total=document.createElement("div");total.className="baro-catalog-total";
 total.textContent=products.length+" منتج ضمن "+new Set(products.map(p=>p.category_id)).size+" أقسام";
 box.append(total);
 const categories=[...new Set(products.map(p=>p.category_id))].sort((a,b)=>{
  const ai=categoryOrder.indexOf(a),bi=categoryOrder.indexOf(b);
  return (ai<0?99:ai)-(bi<0?99:bi);
 });
 categories.forEach((category,index)=>{
  const meta=categoryMeta[category]||{label:String(category||"قسم").toUpperCase(),icon:"🎮",eyebrow:"BARO CATALOG",description:"منتجات رقمية"};
  const section=document.createElement("details");section.className="baro-catalog-category";
  section.open=category==="freefire";
  const summary=document.createElement("summary");summary.className="baro-catalog-category-head";
  const mark=document.createElement("span");mark.className="baro-catalog-game-mark";mark.textContent=meta.icon;
  const copy=document.createElement("span");copy.className="baro-catalog-category-copy";
  const eyebrow=document.createElement("small");eyebrow.textContent=meta.eyebrow;
  const heading=document.createElement("strong");heading.textContent=meta.label;
  const description=document.createElement("span");description.textContent=meta.description;
  copy.append(eyebrow,heading,description);
  const count=document.createElement("span");count.className="baro-catalog-count";
  const categoryProducts=products.filter(p=>p.category_id===category);
  count.textContent=categoryProducts.length+" منتج";
  const chevron=document.createElement("span");chevron.className="baro-catalog-chevron";chevron.setAttribute("aria-hidden","true");chevron.textContent="⌄";
  summary.append(mark,copy,count,chevron);section.append(summary);
  const content=document.createElement("div");content.className="baro-catalog-category-content";
  const presentGroups=[...new Set(categoryProducts.map(p=>p.group_id))];
  const preferred=groupOrder[category]||[];
  const groups=presentGroups.sort((a,b)=>{
   const ai=preferred.indexOf(a),bi=preferred.indexOf(b);
   return (ai<0?99:ai)-(bi<0?99:bi);
  });
  groups.forEach(group=>{
   const groupInfo=groupMeta[group]||{label:String(group||"منتجات أخرى"),icon:"✦",description:""};
   const groupSection=document.createElement("section");groupSection.className="baro-catalog-product-group";
   const groupHead=document.createElement("div");groupHead.className="baro-catalog-group-head";
   const groupIcon=document.createElement("span");groupIcon.className="baro-catalog-group-icon";groupIcon.textContent=groupInfo.icon;
   const groupCopy=document.createElement("div");groupCopy.className="baro-catalog-group-copy";
   const groupTitle=document.createElement("strong");groupTitle.textContent=groupInfo.label;
   const groupDescription=document.createElement("small");groupDescription.textContent=groupInfo.description;
   groupCopy.append(groupTitle,groupDescription);
   const groupCount=document.createElement("span");groupCount.className="baro-catalog-group-count";
   const items=categoryProducts.filter(p=>p.group_id===group);
   groupCount.textContent=items.length+" باقة";
   groupHead.append(groupIcon,groupCopy,groupCount);groupSection.append(groupHead);
   const grid=document.createElement("div");grid.className="baro-catalog-product-grid";
   items.forEach((p,productIndex)=>{
    const card=document.createElement("button");card.type="button";card.className="baro-catalog-product-card baro-card-"+category+" baro-card-"+group;
    const productAvailable=baroManualEnabled&&p.purchase_enabled===true;
    card.disabled=!productAvailable;
    card.setAttribute("aria-label",(productAvailable?"طلب ":"معاينة ")+String(p.product_name||"منتج رقمي"));
    if(productAvailable)card.addEventListener("click",()=>baroOpenProductCheckout(p));
    const cardTop=document.createElement("div");cardTop.className="baro-catalog-product-card-top";
    const art=document.createElement("div");art.className="baro-catalog-product-art";
    const artIcon=document.createElement("span");artIcon.className="baro-catalog-product-art-icon";
    const artLabel=document.createElement("small");artLabel.className="baro-catalog-product-art-label";
    const productName=String(p.product_name||"منتج رقمي");
    let visualIcon=groupInfo.icon,visualLabel=groupInfo.label;
    if(category==="pubg"&&group==="uc"){visualIcon="💎";visualLabel="UNKNOWN CASH";}
    else if(category==="pubg"&&group==="growth"){
     visualIcon=/prime plus/i.test(productName)?"👑":/prime/i.test(productName)?"✦":"🎁";
     visualLabel=/prime plus/i.test(productName)?"PRIME PLUS":/prime/i.test(productName)?"PRIME":"PUBG BUNDLES";
    }else if(category==="freefire"&&group==="diamonds"){visualIcon="💠";visualLabel="DIAMONDS";}
    else if(category==="freefire"&&group==="memberships"){visualIcon="👑";visualLabel="MEMBERSHIP";}
    else if(category==="jawaker"&&group==="tokens"){visualIcon="🪙";visualLabel="JAWAKER TOKENS";}
    else if(category==="jawaker"&&group==="boosters"){visualIcon="⚡";visualLabel="BOOSTERS";}
    artIcon.textContent=visualIcon;artLabel.textContent=visualLabel;
    art.append(artIcon,artLabel);
    const preview=document.createElement("span");preview.className="baro-catalog-preview-tag";preview.textContent=baroManualEnabled&&p.purchase_enabled===true?"متاح للطلب":"معاينة فقط";
    cardTop.append(art,preview);
    const name=document.createElement("strong");name.className="baro-catalog-product-name";name.textContent=productName;
    const price=document.createElement("strong");price.className="baro-catalog-product-price";
    const usd=Number(p.sale_price_usd),syp=Number(p.sale_price_syp);
    price.textContent=(Number.isFinite(usd)&&usd>0?"$"+usd.toFixed(2):"USD: غير محدد")+" · "+(Number.isFinite(syp)&&syp>0?syp.toLocaleString("en-US")+" SYP":"SYP: غير محدد");
    price.style.cssText="display:block;margin:10px 0 4px;color:#e4c5ff;font-size:1.05rem;font-weight:900;";
    const footer=document.createElement("div");footer.className="baro-catalog-product-footer";
    const status=document.createElement("span");status.textContent=baroManualEnabled&&p.purchase_enabled===true?"متاح للطلب":"استقبال الطلبات مغلق حالياً";
    const indexMark=document.createElement("span");indexMark.className="baro-catalog-product-index";indexMark.textContent=String(productIndex+1).padStart(2,"0");
    footer.append(status,indexMark);card.append(cardTop,name,price,footer);grid.append(card);
   });
   groupSection.append(grid);content.append(groupSection);
  });
  section.append(content);box.append(section);
 });
 const footnote=document.createElement("p");footnote.className="baro-catalog-footnote";
 footnote.textContent="الأسعار معروضة بالدولار والليرة · لا يُخصم أي مبلغ عند إرسال الطلب؛ يتم الخصم فقط بعد تأكيد اكتمال الشحن بنجاح."
 box.append(footnote);
}
async function loadBaroCustomer(){
 const catalog=baroEl("baroCustomerCatalog"),orders=baroEl("baroCustomerOrders");
 if(!catalog||!orders||!currentUser)return;
 catalog.textContent="جاري تحميل منتجات BARO...";
 orders.textContent="جاري تحميل طلباتك...";
 const statusLabel=baroEl("baranBaroStatus");
 const homeCopy=baroEl("baranBaroHomeCopy");
 const heroStatus=baroEl("baroCustomerIntro");
 const previewCard=baroEl("baroCustomerAvailability");
 const setAvailability=(enabled)=>{
  const label=enabled?"استقبال الطلبات اليدوية متاح":"استقبال الطلبات اليدوية مغلق";
  if(statusLabel)statusLabel.textContent=label;
  if(homeCopy)homeCopy.textContent=enabled?"قسم مستقل للشحن اليدوي — باقات Free Fire المتاحة جاهزة للطلب.":"قسم مستقل عن الشحن الآلي — تصفّح المنتجات والأسعار.";
  if(heroStatus)heroStatus.textContent=enabled?"اختر باقة Free Fire المتاحة، ثم أدخل ID اللاعب وأكّده قبل إرسال الطلب.":"كتالوج BARO وأسعار البيع المعتمدة. يمكنك التصفح وإدخال ID، لكن إرسال الطلبات متوقف حالياً.";
  if(previewCard)previewCard.textContent=enabled?"الاستقبال اليدوي متاح للمنتجات المفعّلة فقط. لا يُخصم أي مبلغ عند إرسال الطلب؛ يتم الخصم فقط بعد تأكيد اكتمال الشحن بنجاح.":"الاستقبال اليدوي متوقف حالياً. يمكنك تصفح المنتجات والأسعار؛ لن يتم إنشاء طلب أو خصم رصيد.";
 };
 try{
  const c=await baroApi("GET",null,"catalog");
  baroCustomerProducts=Array.isArray(c.products)?c.products:[];
  baroManualEnabled=c.manual_enabled===true;
  setAvailability(baroManualEnabled);
  const submitButton=baroEl("baroSubmitOrder");
  const checkout=submitButton?.closest(".game-checkout");
  const canOrder=baroManualEnabled&&baroCustomerProducts.some(p=>p.purchase_enabled===true);
  if(checkout)checkout.classList.remove("hidden");
  baroPrepareCheckout();
  if(submitButton){submitButton.hidden=!canOrder;submitButton.disabled=!canOrder;}
  renderBaroCustomerCatalog(baroCustomerProducts);
  const select=baroEl("baroProductSelect");
  if(select){
   select.replaceChildren();
   if(!baroCustomerProducts.length){
    const option=document.createElement("option");option.value="";option.textContent="لا توجد منتجات يدوية مفعّلة حالياً";select.append(option);select.disabled=true;
   }else{
    select.disabled=false;
    const categoryLabels={pubg:"PUBG MOBILE",freefire:"FREE FIRE",jawaker:"JAWAKER"};
    const groupLabels={uc:"شدات UC",growth:"حزم واشتراكات PUBG",diamonds:"جواهر Free Fire",memberships:"عضويات Free Fire",tokens:"جواكر توكنز",boosters:"مسرّعات جواكر"};
    const groups=new Map();
    baroCustomerProducts.forEach(p=>{
     if(!groups.has(p.category_id)){const group=document.createElement("optgroup");group.label=categoryLabels[p.category_id]||p.category_id;groups.set(p.category_id,group);select.append(group);}
     const op=document.createElement("option");op.value=p.product_code;
     op.textContent=(groupLabels[p.group_id]?groupLabels[p.group_id]+" — ":"")+p.product_name+(baroManualEnabled&&p.purchase_enabled===true?" — متاح للطلب":" — معاينة فقط");
     groups.get(p.category_id).append(op);
    });
   }
  }
  if(select){const first=baroCustomerProducts.find(p=>p.purchase_enabled===true)||baroCustomerProducts[0];if(first)select.value=first.product_code;}
  const playerInput=baroEl("baroPlayerId"),confirmation=baroEl("baroPlayerIdConfirmed");
  const currencySelect=baroEl("baroWalletCurrency");
  if(currencySelect)currencySelect.onchange=()=>{baroUpdateOrderSubmitState();baroScheduleCouponQuote();};
  if(select)select.onchange=()=>{baroUpdateQuantityField();baroUpdateOrderSubmitState();baroScheduleCouponQuote();};
  const couponInput=baroEl("baroCouponCode");
  if(couponInput)couponInput.oninput=baroScheduleCouponQuote;
  if(playerInput)playerInput.oninput=baroUpdateOrderSubmitState;
  const playerRepeat=baroEl("baroPlayerIdRepeat");if(playerRepeat)playerRepeat.oninput=baroUpdateOrderSubmitState;
  if(confirmation)confirmation.onchange=baroUpdateOrderSubmitState;
  baroUpdateQuantityField();baroUpdateOrderSubmitState();baroScheduleCouponQuote();
  const orderMessage=baroEl("baroOrderMessage");
  if(orderMessage)orderMessage.textContent=canOrder?"أدخل Player ID وتأكد من صحته قبل إرسال الطلب. لن يتم الخصم إلا بعد اكتمال الشحن.":"يمكنك معاينة الباقات؛ إرسال الطلب متاح فقط عند فتح الاستقبال وتفعيل المنتج.";
 }catch(e){
  catalog.textContent=e?.message||"تعذر تحميل كتالوج BARO.";
  setAvailability(false);
 }
 const orderResult=await baroApi("GET",null,"my_orders").then(value=>({ok:true,value})).catch(error=>({ok:false,error}));
 if(orderResult.ok)renderBaroCustomerOrders(orderResult.value.orders||[]);
 else orders.textContent=orderResult.error?.message||"تعذر تحميل طلبات BARO. يمكنك تحديثها لاحقاً.";
 const walletResult=await baroApi("GET",null,"my_wallet").then(value=>({ok:true,value})).catch(error=>({ok:false,error}));
 if(walletResult.ok){
  baroCustomerWallet=walletResult.value.wallet||{balance_usd:0,balance_syp:0};
  const walletLabel=baroEl("baroWalletBalance");
  if(walletLabel)walletLabel.textContent="رصيدك: $"+Number(baroCustomerWallet.balance_usd||0).toFixed(2)+" · "+Number(baroCustomerWallet.balance_syp||0).toLocaleString("en-US")+" SYP";
 }
}
function baroUpdateOrderSubmitState(){
 const button=baroEl("baroSubmitOrder"),player=baroEl("baroPlayerId"),repeat=baroEl("baroPlayerIdRepeat"),confirmed=baroEl("baroPlayerIdConfirmed");
 if(!button)return;
 const p=baroSelectedProduct();
 const playerValue=player?.value.trim()||"",repeatValue=repeat?.value.trim()||"";
 button.disabled=!(baroManualEnabled&&p?.purchase_enabled===true&&playerValue.length>=3&&playerValue===repeatValue&&confirmed?.checked===true);
}
function renderBaroCustomerOrders(rows){
 const box=baroEl("baroCustomerOrders");if(!box)return;box.replaceChildren();
 if(!rows.length){box.textContent="لا توجد لديك طلبات BARO بعد.";return;}
 rows.forEach(o=>{
  const card=document.createElement("article");card.className="ops-item";
   card.dataset.notificationEntityId=String(o.id);
  const h=document.createElement("strong");h.textContent=o.product_name_snapshot||o.product_code;
  const id=document.createElement("div");id.className="small";id.textContent="رقم الطلب: "+o.id.slice(0,8);
  const meta=document.createElement("div");meta.className="small";meta.textContent="المعرّف: "+o.player_id+" | الكمية: "+Number(o.quantity||1).toLocaleString("en-US");
  const status=document.createElement("div");status.textContent=BARO_STATUS[o.status]||o.status;
  const payment=document.createElement("div");payment.className="small";payment.textContent=o.wallet_charge_mode==="wallet_on_completion"?"الدفع: من المحفظة بعد اكتمال الشحن":(BARO_PAYMENT[o.payment_status]||o.payment_status);
  const price=document.createElement("div");price.className="small";price.textContent="السعر النهائي بعد الخصم: "+(o.customer_price_usd!==null?baroMoney(o.customer_price_usd,"USD"):o.customer_price_syp!==null?baroMoney(o.customer_price_syp,"SYP"):"—");
  card.append(h,id,meta,status,payment,price);
  if(Number(o.coupon_discount_usd||0)>0){const discount=document.createElement("div");discount.className="small";discount.textContent="قسيمة BARAN: خصم $"+Number(o.coupon_discount_usd).toFixed(2);card.append(discount);}
  if(Array.isArray(o.events)&&o.events.length){const timeline=document.createElement("div");timeline.className="baro-order-timeline";timeline.style.cssText="margin-top:12px;padding:10px;border:1px solid #574263;border-radius:12px;background:#17121f";const heading=document.createElement("strong");heading.textContent="سجل مراحل الطلب";timeline.append(heading);o.events.forEach(ev=>{const row=document.createElement("div");row.className="baro-order-timeline-event";row.style.cssText="display:flex;justify-content:space-between;gap:8px;padding:7px 0;border-top:1px solid #ffffff16;font-size:11px";const label=document.createElement("span");const d=ev.details||{};if(ev.event_type==="customer_order_created")label.textContent="تم إنشاء الطلب";else if(ev.event_type==="customer_order_wallet_charge_deferred")label.textContent="تم تسجيل الطلب دون خصم؛ الخصم بعد اكتمال الشحن";else if(ev.event_type==="customer_order_wallet_reserved")label.textContent="تم حجز المبلغ من المحفظة";else if(ev.event_type==="admin_order_review")label.textContent="تحديث الحالة: "+(BARO_STATUS[d.to]||d.to||"تمت مراجعة الطلب");else if(ev.event_type==="customer_wallet_debit_captured")label.textContent="تم تثبيت الخصم بعد نجاح الشحن";else label.textContent="تحديث على الطلب";const time=document.createElement("small");time.textContent=new Date(ev.created_at).toLocaleString("ar-SY");time.style.cssText="color:#bba8ca;white-space:nowrap;font-size:10px";row.append(label,time);timeline.append(row);});card.append(timeline);}
  if(o.wallet_charge_mode==="wallet_on_completion"){const charge=document.createElement("div");charge.className="small";charge.textContent=o.wallet_charged_at?"تم الخصم من المحفظة بعد اكتمال الشحن":"لم يتم الخصم بعد — سيتم الخصم فقط عند اكتمال الشحن بنجاح";card.append(charge);}else if(o.wallet_hold){const hold=document.createElement("div");hold.className="small";hold.textContent=o.wallet_hold.status==="reserved"?"المبلغ محجوز من المحفظة بانتظار تنفيذ الشحن":o.wallet_hold.status==="captured"?"تم تثبيت خصم المحفظة بعد نجاح الشحن":"تم رد المبلغ إلى محفظتك";card.append(hold);}
  if(o.payment_method){const m=document.createElement("div");m.className="small";m.textContent="طريقة الدفع: "+o.payment_method;card.append(m);}
  if(o.customer_message){const m=document.createElement("p");m.textContent=o.customer_message;card.append(m);}
  box.append(card);
 });
}
let baroCouponQuoteTimer=null;
let baroCouponQuoteSequence=0;
function baroScheduleCouponQuote(){
 if(baroCouponQuoteTimer)clearTimeout(baroCouponQuoteTimer);
 baroCouponQuoteTimer=setTimeout(()=>{void baroRefreshCouponQuote();},450);
}
async function baroRefreshCouponQuote(){
 const box=baroEl("baroCouponQuote");
 const code=(baroEl("baroCouponCode")?.value||"").trim().toUpperCase();
 const p=baroSelectedProduct();
 const currency=baroEl("baroWalletCurrency")?.value==="USD"?"USD":"SYP";
 const sequence=++baroCouponQuoteSequence;
 if(!box)return null;
 if(!code){box.textContent="أدخل رمز القسيمة لعرض الخصم المتوقع قبل تأكيد الطلب.";return null;}
 if(!/^BARAN-[A-F0-9]{12}$/.test(code)){box.textContent="تحقق من كتابة رمز القسيمة بشكل صحيح.";return null;}
 if(!p){box.textContent="اختر الباقة أولاً للتحقق من القسيمة.";return null;}
 box.textContent="جارٍ التحقق من القسيمة وهامش ربح الباقة...";
 try{
  const {data,error}=await sb.rpc("get_my_baro_coupon_quote",{
   p_product_code:p.product_code,p_wallet_currency:currency,p_coupon_code:code
  });
  if(sequence!==baroCouponQuoteSequence)return null;
  if(error)throw error;
  if(!data||!Number.isFinite(Number(data.discount_usd)))throw new Error("لم يصل عرض خصم صالح من الخادم.");
  const discount=Number(data.discount_usd);
  const finalPrice=Number(data.final_price);
  box.textContent="الخصم المتوقع: $"+discount.toFixed(2)+" — السعر بعد الخصم: "+
   (currency==="USD"?"$"+finalPrice.toFixed(2):Number(finalPrice).toLocaleString("en-US")+" SYP")+
   (Number(data.max_discount_usd)>discount?" · الخصم أقل من سقف القسيمة بسبب هامش ربح الباقة.":" · تم التحقق من القسيمة.");
  return data;
 }catch(error){
  if(sequence===baroCouponQuoteSequence)box.textContent=error?.message||"تعذر التحقق من القسيمة حالياً.";
  return null;
 }
}
async function submitBaroOrder(){
 const button=baroEl("baroSubmitOrder"),message=baroEl("baroOrderMessage"),p=baroSelectedProduct();
 if(!currentUser){message.textContent="سجّل الدخول أولاً.";return;}
 if(!baroManualEnabled){message.textContent="استقبال طلبات BARO متوقف حالياً من الإدارة.";return;}
 if(!p||p.purchase_enabled!==true){message.textContent="هذا المنتج غير متاح للطلب حالياً.";return;}
 const player=baroEl("baroPlayerId").value.trim(),playerRepeat=baroEl("baroPlayerIdRepeat")?.value.trim()||"",note=baroEl("baroCustomerNote").value.trim();
 const playerIdConfirmed=baroEl("baroPlayerIdConfirmed")?.checked===true;
 if(!playerIdConfirmed){message.textContent="يجب تأكيد صحة رقم ID قبل إرسال الطلب.";return;}
 if(player!==playerRepeat){message.textContent="رقم ID غير متطابق. أعد كتابته للتأكد من عدم وجود خطأ.";return;}
 const tokens=p.category_id==="jawaker"&&p.group_id==="tokens";
 const quantity=Number(tokens?baroEl("baroQuantity").value:1);
 if(player.length<3||player.length>80){message.textContent="أدخل معرّف اللاعب بشكل صحيح وتأكد منه قبل الإرسال.";return;}
 if(tokens&&(!Number.isInteger(quantity)||quantity<10000||quantity>1000000)){message.textContent="كمية جواكر يجب أن تكون بين 10,000 و1,000,000.";return;}
 if(note.length>500){message.textContent="الملاحظات طويلة جداً.";return;}
 const walletCurrency=baroEl("baroWalletCurrency")?.value==="USD"?"USD":"SYP";
 const amount=Number(walletCurrency==="USD"?p.sale_price_usd:p.sale_price_syp);
 if(!Number.isFinite(amount)||amount<=0){message.textContent="سعر هذه الباقة غير متاح بعملة المحفظة المختارة.";return;}
 const couponCode=(baroEl("baroCouponCode")?.value||"").trim().toUpperCase();
 if(couponCode&&!/^BARAN-[A-F0-9]{12}$/.test(couponCode)){message.textContent="رمز القسيمة غير صحيح. تحقق من الرمز أو اترك الحقل فارغاً.";return;}
 let couponQuote=null;
 if(couponCode){
  couponQuote=await baroRefreshCouponQuote();
  if(!couponQuote){message.textContent="لم نتمكن من تأكيد قيمة خصم القسيمة. راجع رمز القسيمة أو اختر باقة أخرى.";return;}
 }
 const quoteSummary=couponQuote?"\nالخصم المتوقع بعد فحص هامش الربح: $"+Number(couponQuote.discount_usd).toFixed(2):"";
 if(!confirm("مراجعة نهائية قبل الطلب:\nالباقة: "+p.product_name+"\nPlayer ID: "+player+"\nالسعر قبل القسيمة: "+(walletCurrency==="USD"?"$"+amount.toFixed(2):amount.toLocaleString("en-US")+" SYP")+(couponCode?"\nالقسيمة: "+couponCode+quoteSummary:"")+"\n\nهل تؤكد أن هذه البيانات صحيحة؟ يعيد الخادم التحقق من السعر والربح قبل الحجز، وتُعاد القسيمة تلقائياً إذا فشل الطلب أو أُلغي."))return;
 const request={product_code:p.product_code,player_id:player,player_id_confirmed:true,quantity,customer_note:note,wallet_currency:walletCurrency,coupon_code:couponCode};
 const fingerprint=await baroRequestFingerprint(request);
 if(!fingerprint){message.textContent="متصفحك لا يدعم حماية إعادة المحاولة. حدّث المتصفح قبل إرسال الطلب.";return;}
 const pending=baroGetPendingSubmission(fingerprint);
 button.disabled=true;message.textContent="جاري إرسال الطلب...";
 try{
  const result=await baroApi("POST",{action:"create_order",...request,idempotency_key:pending.idempotency_key});
  baroClearPendingSubmission();
  const appliedDiscount=Number(result.coupon_discount_usd||0);
  const successMessage="تم تسجيل طلبك وحجز المبلغ النهائي من المحفظة. رقم الطلب: "+String(result.order_id||"").slice(0,8)+(appliedDiscount>0?" · تم تطبيق خصم القسيمة $"+appliedDiscount.toFixed(2):"")+". سيتم تثبيت المبلغ عند اكتمال الشحن أو إعادته إذا فشل الطلب/أُلغي.";
  message.textContent=successMessage;
  baroEl("baroPlayerId").value="";if(baroEl("baroPlayerIdRepeat"))baroEl("baroPlayerIdRepeat").value="";baroEl("baroCustomerNote").value="";if(baroEl("baroCouponCode"))baroEl("baroCouponCode").value="";baroEl("baroPlayerIdConfirmed").checked=false;baroUpdateOrderSubmitState();
  try{await loadBaroCustomer();}catch{message.textContent=successMessage+" تعذر تحديث قائمة الطلبات؛ حدّث الصفحة لرؤية الطلب.";}
 }catch(e){message.textContent=e.message+" إذا لم يتأكد وصول الطلب، أعد إرسال نفس البيانات لتجنب إنشاء طلب مكرر.";}
 finally{baroUpdateOrderSubmitState();}
}
function baroProductCard(p){
 const card=document.createElement("article");card.className="ops-item";
 const title=document.createElement("strong");title.textContent=p.product_name;
 const code=document.createElement("div");code.className="small";code.textContent=p.product_code;
 const state=document.createElement("div");state.className="small";state.textContent=(p.catalog_visible?"ظاهر للزبائن":"مخفي عن الزبائن")+" | "+(p.purchase_enabled?"استقبال الطلبات مفتوح":"استقبال الطلبات متوقف");
 const referenceCost=document.createElement("div");referenceCost.className="small";referenceCost.textContent="تكلفة مرجعية تاريخية من ليو ("+(p.reference_cost_date||"تاريخ غير محدد")+"): "+baroMoney(p.reference_cost_usd,"USD")+" — ليست سعراً حالياً مؤكداً";
 const saleValue=Number(p.sale_price_usd),costValue=Number(p.supplier_cost_usd),marginPercent=saleValue>0&&p.supplier_cost_usd!==null&&p.supplier_cost_usd!==undefined&&costValue>=0?((saleValue-costValue)/saleValue)*100:null,marginLimit=Number(p.margin_alert_percent??baroAdminSettings.low_margin_percent??10);
 const margin=document.createElement("div");margin.className="small";margin.textContent=marginPercent===null?"هامش الربح: غير محسوب — أدخل تكلفة وسعر بيع بالدولار.":"هامش الربح التقديري: "+marginPercent.toFixed(2)+"%"+(marginPercent<marginLimit?" ⚠️ أقل من حد التنبيه ("+marginLimit+"%). راجع السعر أو تكلفة المورد.":" — ضمن الحد المحدد.");margin.style.color=marginPercent!==null&&marginPercent<marginLimit?"#ffb56b":"#a9ebc5";
 const cost=document.createElement("div");cost.className="small";cost.textContent="تكلفة المورد المؤكدة حالياً: "+baroMoney(p.supplier_cost_usd,"USD");
 const sale=document.createElement("div");sale.className="small";sale.textContent="سعر البيع USD: "+baroMoney(p.sale_price_usd,"USD")+" | SYP: "+baroMoney(p.sale_price_syp,"SYP");
 const form=document.createElement("div");form.className="ops-form";
 const usd=document.createElement("input");usd.type="number";usd.min="0";usd.step="0.01";usd.placeholder="تكلفة ليو USD";usd.value=p.supplier_cost_usd??"";
 const saleUsd=document.createElement("input");saleUsd.type="number";saleUsd.min="0";saleUsd.step="0.01";saleUsd.placeholder="سعر البيع USD";saleUsd.value=p.sale_price_usd??"";
 const saleSyp=document.createElement("input");saleSyp.type="number";saleSyp.min="0";saleSyp.step="1";saleSyp.placeholder="سعر البيع SYP";saleSyp.value=p.sale_price_syp??"";
 const notes=document.createElement("textarea");notes.rows=2;notes.maxLength=1000;notes.placeholder="ملاحظات داخلية";notes.value=p.admin_notes||"";
 const visibility=document.createElement("label");const visible=document.createElement("input");visible.type="checkbox";visible.checked=!!p.catalog_visible;visibility.append(visible,document.createTextNode(" إظهار في قسم BARO"));
 const enable=document.createElement("label");const enabled=document.createElement("input");enabled.type="checkbox";enabled.checked=!!p.purchase_enabled;enable.append(enabled,document.createTextNode(" السماح باستقبال الطلبات"));
 const save=document.createElement("button");save.type="button";save.textContent="حفظ المنتج والإتاحة";
 save.onclick=async()=>{save.disabled=true;try{
  const n=v=>v.value.trim()===""?null:Number(v.value);
  if(enabled.checked&&!visible.checked)throw new Error("يجب إظهار المنتج قبل فتح استقبال الطلبات.");
  if(enabled.checked&&(n(saleUsd)??0)<=0&&(n(saleSyp)??0)<=0)throw new Error("حدد سعر بيع موجب بالدولار أو الليرة قبل إتاحة المنتج للطلب.");
  await baroApi("POST",{action:"product_save",product_code:p.product_code,supplier_cost_usd:n(usd),sale_price_usd:n(saleUsd),sale_price_syp:n(saleSyp),admin_notes:notes.value,catalog_visible:visible.checked,purchase_enabled:enabled.checked});
  await loadBaroAdmin();baroAdminMessage("تم حفظ بيانات المنتج وإتاحته معاً وتسجيل التدقيق.");
 }catch(e){baroAdminMessage(e.message);}finally{save.disabled=false;}};
 form.append(usd,saleUsd,saleSyp,notes,visibility,enable,save);
 card.append(title,code,state,referenceCost,cost,sale,margin,form);return card;
}
function baroAdminMessage(text){const el=baroEl("baroAdminMessage");if(el)el.textContent=text;}
async function baroAdminQuickOrderStatus(order,nextStatus){
 if(nextStatus!=="completed")return;
 const completedMessage="تم شحن طلبك بنجاح! يرجى التحقق من وصول الرصيد إلى حسابك. شكراً لثقتك بـ BARAN GAME.";
 const deferredWallet=order.wallet_charge_mode==="wallet_on_completion";
 if(!deferredWallet){baroAdminMessage("هذا الطلب من مسار قديم؛ استخدم إجراءاته المالية المعتادة.");return;}
 const quoteAmount=order.customer_price_usd!==null&&order.customer_price_usd!==undefined?Number(order.customer_price_usd):Number(order.customer_price_syp);
 const quoteCurrency=order.customer_price_usd!==null&&order.customer_price_usd!==undefined?"USD":"SYP";
 if(!Number.isFinite(quoteAmount)||quoteAmount<=0){baroAdminMessage("سعر الطلب المحفوظ غير صالح؛ لم يتم تغيير الطلب.");return;}
 const supplierCost=Number(order.supplier_cost_usd??order.supplier_cost_usd_snapshot??0);
 if(!Number.isFinite(supplierCost)||supplierCost<=0){baroAdminMessage("لا توجد تكلفة مورد محفوظة لهذا الطلب؛ لم يتم إكماله أو خصم المحفظة. راجع تكلفة المنتج في كتالوج BARO أولاً.");return;}
 const button=document.querySelector('[data-baro-complete-order="'+order.id+'"]');
 if(button){button.disabled=true;button.textContent="جارٍ تسجيل الاكتمال...";}
 try{
  const updateResult=await baroApi("POST",{action:"order_admin_update",order_id:order.id,status:"completed",
   quote_amount:quoteAmount,quote_currency:quoteCurrency,payment_method:order.payment_method,
   payment_status:"verified",customer_message:completedMessage,
   supplier_cost_usd:supplierCost,supplier_reference:order.supplier_reference||"",
   exception_reason:"تم تنفيذ الشحن اليدوي والتحقق من وصوله إلى حساب الزبون.",
   internal_notes:order.internal_notes||""});
  baroAdminMessage(updateResult.finance_posted?"اكتمل الشحن وسُجّل الطلب والخصم وتكلفة المورد تلقائياً.": "تم تحديث الطلب، لكن النظام لم يؤكد اكتمال التسجيل المالي؛ راجع سجل BARO قبل أي إجراء آخر.");
  await loadBaroAdmin();
 }catch(error){baroAdminMessage(error.message);}
 finally{if(button)button.disabled=false;}
}
function baroCopyPlayerId(playerId,button){
 const value=String(playerId||"").trim();
 if(!value)return;
 const done=()=>{if(button){const old=button.textContent;button.textContent="✓ تم النسخ";setTimeout(()=>button.textContent=old,1400);}};
 if(navigator.clipboard?.writeText){navigator.clipboard.writeText(value).then(done).catch(()=>baroAdminMessage("تعذر النسخ تلقائياً؛ اضغط مطولاً على رقم ID لنسخه."));}
 else{baroAdminMessage("اضغط مطولاً على رقم ID لنسخه.");}
}
function renderBaroAdmin(){
 const toggle=baroEl("baroManualToggle"),toggleStatus=baroEl("baroManualToggleStatus");
 if(toggle){toggle.textContent=baroAdminManualEnabled?"إيقاف استقبال طلبات BARO":"فتح استقبال طلبات BARO";toggle.classList.toggle("secondary",baroAdminManualEnabled);toggle.setAttribute("aria-pressed",String(baroAdminManualEnabled));}
 if(toggleStatus)toggleStatus.textContent=baroAdminManualEnabled?"الاستقبال اليدوي مفتوح للمنتجات المفعّلة فقط.":"الاستقبال اليدوي متوقف. يمكن مراجعة الكتالوج والطلبات السابقة.";
 const products=baroEl("baroAdminProducts"),orders=baroEl("baroAdminOrders");
 if(products){products.replaceChildren();if(!baroAdminProducts.length)products.textContent="لا توجد منتجات في كتالوج BARO.";else baroAdminProducts.forEach(p=>products.append(baroProductCard(p)));}
 if(!orders)return;orders.replaceChildren();
 if(!baroAdminOrders.length){orders.textContent="لا توجد طلبات BARO بعد.";return;}
 baroAdminOrders.forEach(o=>{
  const card=document.createElement("article");card.className="ops-item baro-order-card";card.dataset.notificationEntityId=String(o.id);
  const h=document.createElement("strong");h.textContent=o.product_name_snapshot||o.product_code;
  h.style.cssText="display:block;font-size:1.08rem;margin-bottom:8px";
  const status=document.createElement("div");status.className="small";status.textContent="الحالة: "+(BARO_STATUS[o.status]||o.status);
  const customer=document.createElement("div");customer.className="small";customer.textContent="الزبون: "+(o.customer_email||o.user_id)+" · الكمية: "+Number(o.quantity||1).toLocaleString("en-US");
  const playerLabel=document.createElement("div");playerLabel.className="small";playerLabel.textContent="PLAYER ID المطلوب الشحن إليه";
  const playerRow=document.createElement("div");playerRow.style.cssText="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:8px 0 12px;padding:12px;border:1px solid #9b70bd;border-radius:12px;background:#a56bd61c";
  const player=document.createElement("strong");player.textContent=String(o.player_id||"—");player.dir="ltr";player.style.cssText="font-size:1.25rem;letter-spacing:.5px;overflow-wrap:anywhere;user-select:text";
  const copy=document.createElement("button");copy.type="button";copy.className="secondary";copy.textContent="نسخ ID";copy.onclick=()=>baroCopyPlayerId(o.player_id,copy);
  playerRow.append(player,copy);
  const idRow=document.createElement("div");idRow.className="small";idRow.textContent="رقم الطلب: "+o.id;
  const copyOrder=document.createElement("button");copyOrder.type="button";copyOrder.className="secondary";copyOrder.textContent="نسخ رقم الطلب";copyOrder.onclick=()=>baroCopyPlayerId(o.id,copyOrder);
  const price=document.createElement("div");price.className="small";price.textContent="سعر الزبون: "+(o.customer_price_usd!==null&&o.customer_price_usd!==undefined?baroMoney(o.customer_price_usd,"USD"):baroMoney(o.customer_price_syp,"SYP"));
  const cost=document.createElement("div");cost.className="small";cost.textContent="تكلفة المورد المحفوظة: "+baroMoney(o.supplier_cost_usd??o.supplier_cost_usd_snapshot,"USD");
  card.append(h,status,customer,playerLabel,playerRow,idRow,copyOrder,price,cost);
  if(o.wallet_charge_mode==="wallet_on_completion"&&["pending","in_progress"].includes(o.status)){
   const complete=document.createElement("button");complete.type="button";complete.className="primary";complete.textContent="✓ تم الشحن — مكتمل";
   complete.setAttribute("data-baro-complete-order",o.id);complete.style.cssText="width:100%;margin-top:12px;font-weight:900";
   complete.onclick=()=>baroAdminQuickOrderStatus(o,"completed");card.append(complete);
  }else if(o.status==="completed"){
   const done=document.createElement("div");done.className="small";done.textContent="✓ اكتمل الشحن وسُجل الطلب.";card.append(done);
  }
  if(o.wallet_charge_mode!=="wallet_on_completion"){
   const legacy=document.createElement("details");const summary=document.createElement("summary");summary.textContent="إجراءات الطلب القديم";legacy.append(summary);
   const info=document.createElement("div");info.className="small";info.textContent="هذا الطلب يتبع نظام BARO السابق؛ لا تستخدم زر الإكمال المباشر عليه.";legacy.append(info);card.append(legacy);
  }
  orders.append(card);
 });
}
async function toggleBaroManualEnabled(){
 const button=baroEl("baroManualToggle");
 if(!button)return;
 const next=!baroAdminManualEnabled;
 if(!confirm(next?"فتح استقبال طلبات BARO اليدوية للمنتجات التي فعّلتها فقط؟":"إيقاف استقبال طلبات BARO اليدوية؟"))return;
 button.disabled=true;
 try{
  const result=await baroApi("POST",{action:"manual_toggle",enabled:next});
  baroAdminManualEnabled=result.manual_enabled===true;
  baroAdminMessage(baroAdminManualEnabled?"تم فتح استقبال BARO. الشحن والدفع ما زالا يدويين.":"تم إيقاف استقبال BARO. الطلبات السابقة وسجلاتها محفوظة.");
  await loadBaroAdmin();
 }catch(e){baroAdminMessage(e.message);}
 finally{button.disabled=false;}
}
async function loadBaroAdmin(){
 const products=baroEl("baroAdminProducts"),orders=baroEl("baroAdminOrders");
 if(!products||!orders)return;
 products.textContent="جاري تحميل كتالوج BARO...";orders.textContent="جاري تحميل الطلبات...";
 try{const data=await baroApi("GET",null,"admin");baroAdminProducts=data.products||[];baroAdminOrders=data.orders||[];baroAdminSettings=data.settings||{low_margin_percent:10};baroAdminManualEnabled=data.manual_enabled===true;renderBaroAdmin();baroAdminMessage("تم تحميل بيانات BARO من المتجر.");}
 catch(e){products.textContent=e.message;orders.textContent="تعذر تحميل الطلبات.";}
}


/* The main catalogue renderer above owns #baroCustomerCatalog.
   Do not replace its rendered sections with legacy preview text. */
const baroBaseRenderCustomerOrders=renderBaroCustomerOrders;
renderBaroCustomerOrders=function(rows){
 baroBaseRenderCustomerOrders(rows);
 const box=baroEl("baroCustomerOrders");
 if(!box||!Array.isArray(rows))return;
 [...box.children].forEach((card,index)=>{
  const order=rows[index];if(!order)return;
  const snapshot=document.createElement("div");
  snapshot.className="small";
  snapshot.textContent="السعر وقت الطلب: "+baroMoney(order.displayed_price_usd_snapshot,"USD")+" | "+baroMoney(order.displayed_price_syp_snapshot,"SYP");
  card.append(snapshot);
 });
};
