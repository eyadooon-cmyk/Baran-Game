"use strict";
function baroEndpoint(){return SUPABASE_URL+"/functions/v1/baran-baro-manual";}
const BARO_STATUS={pending:"طلب جديد بانتظار المراجعة",awaiting_payment:"بانتظار الدفع",paid:"تم تأكيد الدفع",in_progress:"قيد التنفيذ اليدوي",completed:"مكتمل",failed:"تعذر التنفيذ",needs_review:"يحتاج مراجعة",cancelled:"ملغي"};
const BARO_PAYMENT={awaiting_quote:"بانتظار عرض السعر",awaiting_payment:"بانتظار الدفع",verified:"تم تأكيد الدفع",failed:"تعذر تأكيد الدفع"};
let baroCustomerProducts=[],baroAdminProducts=[],baroAdminOrders=[];
let baroManualEnabled=false,baroAdminManualEnabled=false;
const baroEl=id=>document.getElementById(id);
function baroEscape(value){return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function baroMoney(value,currency){if(value===null||value===undefined||value==="")return "بانتظار تحديد السعر";const n=Number(value);return !Number.isFinite(n)?"—":currency==="USD"?"$"+n.toFixed(2):n.toLocaleString("en-US")+" ل.س";}
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
 const introText=document.createElement("p");introText.textContent="تصفّح الأقسام واختر المنتج الذي تبحث عنه. هذه معاينة للكتالوج فقط، والطلبات غير متاحة حالياً.";
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
  section.open=index===0;
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
    const card=document.createElement("article");card.className="baro-catalog-product-card baro-card-"+category+" baro-card-"+group;
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
    const preview=document.createElement("span");preview.className="baro-catalog-preview-tag";preview.textContent="معاينة فقط";
    cardTop.append(art,preview);
    const name=document.createElement("strong");name.className="baro-catalog-product-name";name.textContent=productName;
    const footer=document.createElement("div");footer.className="baro-catalog-product-footer";
    const status=document.createElement("span");status.textContent="الطلب غير متاح حالياً";
    const indexMark=document.createElement("span");indexMark.className="baro-catalog-product-index";indexMark.textContent=String(productIndex+1).padStart(2,"0");
    footer.append(status,indexMark);card.append(cardTop,name,footer);grid.append(card);
   });
   groupSection.append(grid);content.append(groupSection);
  });
  section.append(content);box.append(section);
 });
 const footnote=document.createElement("p");footnote.className="baro-catalog-footnote";
 footnote.textContent="BARO للشحن اليدوي · الأسعار مخفية في مرحلة المعاينة · لا يتم إنشاء طلب أو خصم أي رصيد.";
 box.append(footnote);
}
async function loadBaroCustomer(){
 const catalog=baroEl("baroCustomerCatalog"),orders=baroEl("baroCustomerOrders");
 if(!catalog||!orders||!currentUser)return;
 catalog.textContent="جاري تحميل منتجات BARO...";
 try{
  const [c,o]=await Promise.all([baroApi("GET",null,"catalog"),baroApi("GET",null,"my_orders")]);
  baroCustomerProducts=Array.isArray(c.products)?c.products:[];
  baroManualEnabled=c.manual_enabled===true;
  const submitButton=baroEl("baroSubmitOrder");if(submitButton)submitButton.disabled=true;
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
     op.textContent=(groupLabels[p.group_id]?groupLabels[p.group_id]+" — ":"")+p.product_name+" — معاينة فقط";
     op.disabled=true;groups.get(p.category_id).append(op);
    });
   }
  }
  renderBaroCustomerOrders(o.orders||[]);
 }catch(e){catalog.textContent=e.message;orders.textContent="تعذر تحميل طلبات BARO.";}
}
function renderBaroCustomerOrders(rows){
 const box=baroEl("baroCustomerOrders");if(!box)return;box.replaceChildren();
 if(!rows.length){box.textContent="لا توجد لديك طلبات BARO بعد.";return;}
 rows.forEach(o=>{
  const card=document.createElement("article");card.className="ops-item";
  const h=document.createElement("strong");h.textContent=o.product_name_snapshot||o.product_code;
  const id=document.createElement("div");id.className="small";id.textContent="رقم الطلب: "+o.id.slice(0,8);
  const meta=document.createElement("div");meta.className="small";meta.textContent="المعرّف: "+o.player_id+" | الكمية: "+Number(o.quantity||1).toLocaleString("en-US");
  const status=document.createElement("div");status.textContent=BARO_STATUS[o.status]||o.status;
  const payment=document.createElement("div");payment.className="small";payment.textContent=BARO_PAYMENT[o.payment_status]||o.payment_status;
  const price=document.createElement("div");price.className="small";price.textContent="السعر: "+(o.customer_price_usd!==null?baroMoney(o.customer_price_usd,"USD"):o.customer_price_syp!==null?baroMoney(o.customer_price_syp,"SYP"):"بانتظار تأكيد الإدارة");
  card.append(h,id,meta,status,payment,price);
  if(o.payment_method){const m=document.createElement("div");m.className="small";m.textContent="طريقة الدفع: "+o.payment_method;card.append(m);}
  if(o.customer_message){const m=document.createElement("p");m.textContent=o.customer_message;card.append(m);}
  box.append(card);
 });
}
async function submitBaroOrder(){
 const button=baroEl("baroSubmitOrder"),message=baroEl("baroOrderMessage"),p=baroSelectedProduct();
 if(!currentUser){message.textContent="سجّل الدخول أولاً.";return;}
 if(!baroManualEnabled){message.textContent="استقبال طلبات BARO متوقف حالياً من الإدارة.";return;}
 if(!p||!p.purchase_enabled){message.textContent="هذا المنتج غير متاح للطلب حالياً.";return;}
 const player=baroEl("baroPlayerId").value.trim(),note=baroEl("baroCustomerNote").value.trim();
 const tokens=p.category_id==="jawaker"&&p.group_id==="tokens";
 const quantity=Number(tokens?baroEl("baroQuantity").value:1);
 if(player.length<3||player.length>80){message.textContent="أدخل معرّف اللاعب بشكل صحيح وتأكد منه قبل الإرسال.";return;}
 if(tokens&&(!Number.isInteger(quantity)||quantity<10000||quantity>1000000)){message.textContent="كمية جواكر يجب أن تكون بين 10,000 و1,000,000.";return;}
 if(note.length>500){message.textContent="الملاحظات طويلة جداً.";return;}
 if(!confirm("تأكيد إرسال طلب BARO؟ لن يتم خصم أي مبلغ الآن. ستراجع الإدارة الطلب وترسل السعر وطريقة الدفع."))return;
 const request={product_code:p.product_code,player_id:player,quantity,customer_note:note};
 const fingerprint=await baroRequestFingerprint(request);
 if(!fingerprint){message.textContent="متصفحك لا يدعم حماية إعادة المحاولة. حدّث المتصفح قبل إرسال الطلب.";return;}
 const pending=baroGetPendingSubmission(fingerprint);
 button.disabled=true;message.textContent="جاري إرسال الطلب...";
 try{
  const result=await baroApi("POST",{action:"create_order",...request,idempotency_key:pending.idempotency_key});
  baroClearPendingSubmission();
  const successMessage="وصل طلبك للإدارة بنجاح. رقم الطلب: "+String(result.order_id||"").slice(0,8)+" — لا يوجد خصم من المحفظة.";
  message.textContent=successMessage;
  baroEl("baroPlayerId").value="";baroEl("baroCustomerNote").value="";
  try{await loadBaroCustomer();}catch{message.textContent=successMessage+" تعذر تحديث قائمة الطلبات؛ حدّث الصفحة لرؤية الطلب.";}
 }catch(e){message.textContent=e.message+" إذا لم يتأكد وصول الطلب، أعد إرسال نفس البيانات لتجنب إنشاء طلب مكرر.";}
 finally{button.disabled=!baroManualEnabled;}
}
function baroProductCard(p){
 const card=document.createElement("article");card.className="ops-item";
 const title=document.createElement("strong");title.textContent=p.product_name;
 const code=document.createElement("div");code.className="small";code.textContent=p.product_code;
 const state=document.createElement("div");state.className="small";state.textContent=(p.catalog_visible?"ظاهر للزبائن":"مخفي عن الزبائن")+" | "+(p.purchase_enabled?"استقبال الطلبات مفتوح":"استقبال الطلبات متوقف");
 const referenceCost=document.createElement("div");referenceCost.className="small";referenceCost.textContent="تكلفة مرجعية تاريخية من ليو ("+(p.reference_cost_date||"تاريخ غير محدد")+"): "+baroMoney(p.reference_cost_usd,"USD")+" — ليست سعراً حالياً مؤكداً";
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
 card.append(title,code,state,referenceCost,cost,sale,form);return card;
}
function baroAdminMessage(text){const el=baroEl("baroAdminMessage");if(el)el.textContent=text;}
function renderBaroAdmin(){
 const toggle=baroEl("baroManualToggle"),toggleStatus=baroEl("baroManualToggleStatus");
 if(toggle){toggle.textContent=baroAdminManualEnabled?"إيقاف استقبال طلبات BARO":"فتح استقبال طلبات BARO";toggle.classList.toggle("secondary",baroAdminManualEnabled);toggle.setAttribute("aria-pressed",String(baroAdminManualEnabled));}
 if(toggleStatus)toggleStatus.textContent=baroAdminManualEnabled?"الاستقبال اليدوي مفتوح للمنتجات المفعّلة فقط.":"الاستقبال اليدوي متوقف. يمكن مراجعة الكتالوج والطلبات السابقة.";
 const products=baroEl("baroAdminProducts"),orders=baroEl("baroAdminOrders");
 if(products){products.replaceChildren();if(!baroAdminProducts.length)products.textContent="لا توجد منتجات في كتالوج BARO.";else baroAdminProducts.forEach(p=>products.append(baroProductCard(p)));}
 if(!orders)return;orders.replaceChildren();
 if(!baroAdminOrders.length){orders.textContent="لا توجد طلبات BARO بعد.";return;}
 baroAdminOrders.forEach(o=>{
  const card=document.createElement("article");card.className="ops-item";
  const h=document.createElement("strong");h.textContent=o.product_name_snapshot||o.product_code;
  const info=document.createElement("div");info.className="small";info.textContent="الزبون: "+(o.customer_email||o.user_id)+" | اللاعب: "+o.player_id+" | الكمية: "+Number(o.quantity||1).toLocaleString("en-US");
  const id=document.createElement("div");id.className="small";id.textContent="رقم الطلب: "+o.id;
  const status=document.createElement("select");
  const nextStates={pending:["awaiting_payment","needs_review","failed","cancelled"],awaiting_payment:["paid","needs_review","failed","cancelled"],paid:["in_progress","needs_review","failed"],in_progress:["completed","needs_review","failed"],needs_review:["awaiting_payment","paid","in_progress","failed","cancelled"],failed:["needs_review"],completed:[],cancelled:[]};
  [o.status,...(nextStates[o.status]||[])].forEach(v=>{const op=document.createElement("option");op.value=v;op.textContent=BARO_STATUS[v]||v;status.append(op);});status.value=o.status;
  const payment=document.createElement("select");Object.entries(BARO_PAYMENT).forEach(([v,label])=>{const op=document.createElement("option");op.value=v;op.textContent=label;payment.append(op);});payment.value=o.payment_status||"awaiting_quote";
  const quote=document.createElement("input");quote.type="number";quote.min="0.01";quote.step="0.01";quote.placeholder="السعر الذي سيدفعه الزبون";quote.value=o.customer_price_usd??o.customer_price_syp??"";
  const currency=document.createElement("select");[["USD","دولار"],["SYP","ليرة سورية"]].forEach(([v,l])=>{const op=document.createElement("option");op.value=v;op.textContent=l;currency.append(op);});currency.value=o.customer_price_syp!==null?"SYP":"USD";
  const method=document.createElement("select");["شام كاش","تحويل يدوي","نقداً/اتفاق مباشر"].forEach(v=>{const op=document.createElement("option");op.value=v;op.textContent=v;method.append(op);});method.value=o.payment_method||"شام كاش";
  const msg=document.createElement("textarea");msg.rows=2;msg.maxLength=500;msg.placeholder="رسالة للزبون (السعر أو تعليمات الدفع)";msg.value=o.customer_message||"";
  const cost=document.createElement("input");cost.type="number";cost.min="0";cost.step="0.01";cost.placeholder="تكلفة الشراء الفعلية من ليو بالدولار";cost.value=o.supplier_cost_usd??"";
  const reference=document.createElement("input");reference.placeholder="مرجع تنفيذ ليو";reference.value=o.supplier_reference||"";
  const exception=document.createElement("textarea");exception.rows=2;exception.placeholder="سبب الاستثناء عند عدم وجود مرجع";exception.value=o.exception_reason||"";
  const notes=document.createElement("textarea");notes.rows=2;notes.placeholder="ملاحظات داخلية";notes.value=o.internal_notes||"";
  const grid=document.createElement("div");grid.className="ops-form";grid.append(status,payment,quote,currency,method,msg,cost,reference,exception,notes);
  const save=document.createElement("button");save.type="button";save.textContent="حفظ ومتابعة الطلب";
  save.onclick=async()=>{save.disabled=true;try{
   const amount=quote.value.trim()===""?null:Number(quote.value);
   const quoteCurrency=amount===null?null:currency.value;
   const pay=payment.value;
   await baroApi("POST",{action:"order_admin_update",order_id:o.id,status:status.value,quote_amount:amount,quote_currency:quoteCurrency,payment_method:method.value,payment_status:pay,customer_message:msg.value.trim(),supplier_cost_usd:cost.value.trim()===""?null:Number(cost.value),supplier_reference:reference.value.trim(),exception_reason:exception.value.trim(),internal_notes:notes.value.trim()});
   baroAdminMessage("تم حفظ تحديث الطلب. لا يوجد خصم أو ترحيل مالي تلقائي.");await loadBaroAdmin();
  }catch(e){baroAdminMessage(e.message);}finally{save.disabled=false;}};
  card.append(h,id,info,grid,save);orders.append(card);
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
 try{const data=await baroApi("GET",null,"admin");baroAdminProducts=data.products||[];baroAdminOrders=data.orders||[];baroAdminManualEnabled=data.manual_enabled===true;renderBaroAdmin();baroAdminMessage("تم تحميل بيانات BARO من المتجر.");}
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
