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
 const timeout=(promise,ms,label)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error(label)),ms))]);
 let sessionResult;
 try{
  sessionResult=await timeout(sb.auth.getSession(),12000,"انتهت مهلة التحقق من جلسة الدخول. حدّث الصفحة وحاول مجدداً.");
 }catch(error){throw new Error(error?.message||"تعذر التحقق من جلسة الدخول.");}
 const {data:{session},error}=sessionResult||{};
 if(error||!session)throw new Error("انتهت الجلسة. سجّل الدخول مجدداً.");
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),18000);
 let response;
 try{
  response=await fetch(baroEndpoint()+(method==="GET"?"?view="+encodeURIComponent(view):""),{
   method,headers:{"Authorization":"Bearer "+session.access_token,"apikey":SUPABASE_KEY,"Content-Type":"application/json"},
   body:body?JSON.stringify(body):undefined,signal:controller.signal
  });
 }catch(error){
  if(error?.name==="AbortError")throw new Error("انتهت مهلة الاتصال بخادم BARO بعد 18 ثانية. تحقق من الإنترنت ثم اضغط تحديث القسم.");
  throw new Error("تعذر الاتصال بخادم BARO. تحقق من الإنترنت وحاول مجدداً.");
 }finally{clearTimeout(timer);}
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(data.error||"تعذر الاتصال بقسم BARO (HTTP "+response.status+").");
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
 const box=baroEl("baroCustomerCatalog");if(!box)return;box.replaceChildren();
 const styleId="baro-catalog-navigation-style";if(!document.getElementById(styleId)){const s=document.createElement("style");s.id=styleId;s.textContent="#baroCustomerCatalog .baro-catalog-nav-card{display:flex;width:100%;align-items:center;gap:13px;padding:15px;border:1px solid #9a70b8;border-radius:19px;background:linear-gradient(145deg,#442957,#24172f 58%,#15101e);color:#fff;text-align:right;box-shadow:0 8px 0 #100b16,0 14px 22px #0009,inset 0 1px 0 #ffffff2b;cursor:pointer}#baroCustomerCatalog .baro-catalog-nav-card:active{transform:translateY(4px)}#baroCustomerCatalog .baro-catalog-nav-card .baro-catalog-game-mark{width:60px;height:60px;flex-basis:60px;font-size:30px}#baroCustomerCatalog .baro-catalog-nav-copy{display:flex;flex:1;min-width:0;flex-direction:column;gap:4px}#baroCustomerCatalog .baro-catalog-nav-copy strong{font-size:16px;font-weight:900}#baroCustomerCatalog .baro-catalog-nav-copy small{color:#cbb4dc;font-size:10px}#baroCustomerCatalog .baro-catalog-nav-arrow{font-size:24px;color:#e5c5ff}#baroCustomerCatalog .baro-catalog-back{display:inline-flex;align-items:center;gap:8px;margin:0 0 12px;padding:9px 14px;border:1px solid #8c68a7;border-radius:12px;background:#24182f;color:#f1e2fc;font-weight:800}#baroCustomerCatalog .baro-catalog-view-title{margin:4px 0 12px;color:#f5eaff;font-size:16px;font-weight:900}#baroCustomerCatalog .baro-catalog-category-content{display:grid;grid-template-columns:1fr;gap:12px;padding:12px 0}#baroCustomerCatalog .baro-catalog-game-mark{display:grid;place-items:center;flex:0 0 54px;width:54px;height:54px;border:1px solid #c5a0e2;border-radius:16px;background:linear-gradient(145deg,#9b6ac2,#3c2751 58%,#21162e);box-shadow:0 7px 0 #171020,0 11px 18px #0009,inset 0 2px 5px #ffffff55;font-size:27px}#baroCustomerCatalog .baro-catalog-product-group{display:block;min-width:0;margin:0 0 12px;padding:12px;overflow:visible;border:1px solid #765792;border-radius:17px;background:linear-gradient(150deg,#30213e 0%,#1c1427 55%,#130e1b 100%);box-shadow:0 7px 0 #100b16,0 12px 18px #0008,inset 0 1px 0 #ffffff22}#baroCustomerCatalog .baro-catalog-group-head{display:flex;align-items:center;gap:10px;margin:0 0 12px;padding:0 0 10px;border-bottom:1px solid #76558c66}#baroCustomerCatalog .baro-catalog-group-icon{display:grid;place-items:center;width:42px;height:42px;flex:0 0 42px;border:1px solid #a17bc0;border-radius:12px;background:linear-gradient(145deg,#63427c,#291d38);box-shadow:0 4px 0 #100b16,0 7px 12px #0008;font-size:21px}#baroCustomerCatalog .baro-catalog-group-copy{display:flex;flex:1;min-width:0;flex-direction:column;gap:2px}#baroCustomerCatalog .baro-catalog-group-copy strong{color:#f1e4fa;font-size:14px;font-weight:900}#baroCustomerCatalog .baro-catalog-group-copy small{color:#bba9c9;font-size:10px}#baroCustomerCatalog .baro-catalog-group-count{padding:5px 8px;border-radius:9px;background:#2c2038;color:#d9c1ed;font-size:10px;font-weight:800}#baroCustomerCatalog .baro-catalog-product-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}#baroCustomerCatalog .baro-catalog-product-card{position:relative;display:flex;min-width:0;flex-direction:column;align-items:stretch;gap:8px;padding:10px;border:1px solid #765792;border-radius:16px;background:linear-gradient(150deg,#392849 0%,#21172d 48%,#17111f 100%);color:#f4eafa;text-align:right;box-shadow:0 7px 0 #100b16,0 12px 18px #0008,inset 0 1px 0 #ffffff2b;transform:perspective(850px) rotateX(1deg)}#baroCustomerCatalog .baro-catalog-product-card[aria-disabled='true']{opacity:1;cursor:default;filter:none}#baroCustomerCatalog .baro-catalog-product-card-top{display:flex;align-items:flex-start;justify-content:space-between;gap:6px}#baroCustomerCatalog .baro-catalog-product-art{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:5px;width:100%;min-height:82px;border:1px solid #9875b4;border-radius:12px;background:radial-gradient(ellipse at 50% 20%,#a77bc533,transparent 65%),linear-gradient(145deg,#30203e,#17101f);box-shadow:inset 0 2px 8px #0008,0 3px 0 #100b16}#baroCustomerCatalog .baro-catalog-product-art-icon{font-size:34px;line-height:1.1;filter:drop-shadow(0 5px 4px #0009)}#baroCustomerCatalog .baro-catalog-product-art-label{color:#cdb5e1;font:800 8px Orbitron,Cairo,sans-serif;letter-spacing:1px}#baroCustomerCatalog .baro-catalog-preview-tag{position:absolute;top:15px;right:15px;padding:4px 7px;border:1px solid #76578d;border-radius:999px;background:#100b16dd;color:#e1d1ed;font-size:8px}#baroCustomerCatalog .baro-catalog-product-name{display:block;min-height:40px;color:#fff!important;font-size:12px;line-height:1.65;font-weight:900;white-space:normal;overflow-wrap:anywhere}#baroCustomerCatalog .baro-catalog-product-price{display:block;margin:0!important;padding:8px 6px;border:1px solid #76578d;border-radius:10px;background:linear-gradient(100deg,#2d203a,#1a1323);color:#e8d2fa!important;font-size:11px!important;line-height:1.8;text-align:center;overflow-wrap:anywhere}#baroCustomerCatalog .baro-catalog-product-footer{display:flex;align-items:center;justify-content:space-between;gap:5px;margin-top:auto;padding-top:7px;border-top:1px solid #76558b66;color:#bfaecc;font-size:9px}#baroCustomerCatalog .baro-catalog-product-index{color:#d4b7ec;font:800 10px Orbitron,sans-serif}";document.head.append(s);}
 const categoryMeta={pubg:{label:"PUBG MOBILE",icon:"🎯",description:"شدات UC والاشتراكات والحزم"},freefire:{label:"FREE FIRE",icon:"🔥",description:"باقات جواهر فري فاير"},jawaker:{label:"JAWAKER",icon:"🃏",description:"توكنز ومسرّعات جواكر"}};
 const groupMeta={uc:{label:"شدات PUBG UC",icon:"💎",description:"باقات الشدات"},growth:{label:"اشتراكات وحزم PUBG",icon:"🚀",description:"Prime وPrime Plus وباقي الحزم"},diamonds:{label:"جواهر Free Fire",icon:"💠",description:"باقات الجواهر"},memberships:{label:"عضويات Free Fire",icon:"👑",description:"العضويات"},tokens:{label:"جواكر توكنز",icon:"🪙",description:"السيرفر الأول والسيرفر الثاني"},boosters:{label:"مسرّعات جواكر",icon:"⚡",description:"الأحمر والأزرق والأسود والذهبي"}};
 const categoryOrder=["freefire","pubg","jawaker"],groupOrder={pubg:["uc","growth"],freefire:["diamonds"],jawaker:["tokens","boosters"]};
 const allowedGroups={freefire:new Set(["diamonds"]),pubg:new Set(["uc","growth"]),jawaker:new Set(["tokens","boosters"])};
 const productsForCategory=(category)=>products.filter(p=>p.category_id===category&&allowedGroups[category]?.has(p.group_id));
 const intro=document.createElement("div");intro.className="baro-catalog-intro";const introMark=document.createElement("span");introMark.className="baro-catalog-intro-mark";introMark.textContent="✦";const introCopy=document.createElement("div");const introTitle=document.createElement("strong");introTitle.textContent="كتالوج الشحن اليدوي BARO";const introText=document.createElement("p");introText.textContent=baroManualEnabled?"اختر اللعبة، ثم التصنيف، وبعدها الباقة المطلوبة.":"تصفّح الألعاب والتصنيفات والأسعار المعتمدة. استقبال الطلبات اليدوية مغلق حالياً.";introCopy.append(introTitle,introText);intro.append(introMark,introCopy);box.append(intro);
 if(!products.length){const empty=document.createElement("div");empty.className="baro-catalog-empty";empty.textContent="لا توجد منتجات معتمدة للعرض حالياً.";box.append(empty);return;}
 const total=document.createElement("div");total.className="baro-catalog-total";total.textContent=products.length+" منتج ضمن "+new Set(products.map(p=>p.category_id)).size+" ألعاب";box.append(total);
 const categories=[...new Set(products.map(p=>p.category_id))].sort((a,b)=>{const ai=categoryOrder.indexOf(a),bi=categoryOrder.indexOf(b);return(ai<0?99:ai)-(bi<0?99:bi);});
 const makeBack=(label,action)=>{const b=document.createElement("button");b.type="button";b.className="baro-catalog-back";b.textContent="← "+label;b.addEventListener("click",action);return b;};
 const makeHeading=(label)=>{const h=document.createElement("div");h.className="baro-catalog-view-title";h.textContent=label;return h;};
 const makeNavCard=(icon,label,description,count,action)=>{const b=document.createElement("button");b.type="button";b.className="baro-catalog-nav-card";const mark=document.createElement("span");mark.className="baro-catalog-game-mark";mark.textContent=icon;const copy=document.createElement("span");copy.className="baro-catalog-nav-copy";const strong=document.createElement("strong");strong.textContent=label;const small=document.createElement("small");small.textContent=description+" · "+count;copy.append(strong,small);const arrow=document.createElement("span");arrow.className="baro-catalog-nav-arrow";arrow.textContent="‹";b.append(mark,copy,arrow);b.addEventListener("click",action);return b;};
 const makeProductCard=(p,category,group,info,index)=>{const card=document.createElement("button");card.type="button";card.className="baro-catalog-product-card baro-card-"+category+" baro-card-"+(p.group_id||group||"all");const available=baroManualEnabled&&p.purchase_enabled===true;card.setAttribute("aria-disabled",String(!available));card.tabIndex=available?0:-1;card.setAttribute("aria-label",(available?"طلب ":"معاينة ")+String(p.product_name||"منتج رقمي"));if(available)card.addEventListener("click",()=>baroOpenProductCheckout(p));const top=document.createElement("div");top.className="baro-catalog-product-card-top";const art=document.createElement("div");art.className="baro-catalog-product-art";const artIcon=document.createElement("span");artIcon.className="baro-catalog-product-art-icon";const artLabel=document.createElement("small");artLabel.className="baro-catalog-product-art-label";const nameText=String(p.product_name||"منتج رقمي");let visualIcon=info.icon,visualLabel=info.label;if(category==="pubg"&&group==="uc"){visualIcon="💎";visualLabel="UNKNOWN CASH";}else if(category==="pubg"&&group==="growth"){visualIcon=/prime plus/i.test(nameText)?"👑":/prime/i.test(nameText)?"✦":"🎁";visualLabel=/prime plus/i.test(nameText)?"PRIME PLUS":/prime/i.test(nameText)?"PRIME":"PUBG BUNDLES";}else if(category==="freefire"&&group==="diamonds"){visualIcon="💠";visualLabel="DIAMONDS";}else if(category==="jawaker"&&group==="tokens"){visualIcon="🪙";visualLabel="JAWAKER TOKENS";}else if(category==="jawaker"&&group==="boosters"){visualIcon="⚡";visualLabel="BOOSTERS";}artIcon.textContent=visualIcon;artLabel.textContent=visualLabel;art.append(artIcon,artLabel);const tag=document.createElement("span");tag.className="baro-catalog-preview-tag";tag.textContent=available?"متاح للطلب":"معاينة فقط";top.append(art,tag);const name=document.createElement("strong");name.className="baro-catalog-product-name";name.dir="auto";name.textContent=nameText;const price=document.createElement("strong");price.className="baro-catalog-product-price";const usd=Number(p.sale_price_usd),syp=Number(p.sale_price_syp);price.dir="auto";price.textContent=(Number.isFinite(usd)&&usd>0?"$"+usd.toFixed(2):"السعر بالدولار غير محدد")+" · "+(Number.isFinite(syp)&&syp>0?syp.toLocaleString("en-US")+" SYP":"السعر بالليرة غير محدد");const footer=document.createElement("div");footer.className="baro-catalog-product-footer";const status=document.createElement("span");status.textContent=available?"متاح للطلب":"استقبال الطلبات مغلق حالياً";const number=document.createElement("span");number.className="baro-catalog-product-index";number.textContent=String(index+1).padStart(2,"0");footer.append(status,number);card.append(top,name,price,footer);return card;};
 const clearView=()=>box.querySelectorAll(".baro-catalog-dynamic").forEach(n=>n.remove());
 const renderHome=()=>{clearView();const grid=document.createElement("div");grid.className="baro-catalog-category-content baro-catalog-dynamic";categories.forEach(category=>{const meta=categoryMeta[category]||{label:String(category||"قسم"),icon:"🎮",description:"منتجات رقمية"};const items=productsForCategory(category);grid.append(makeNavCard(meta.icon,meta.label,meta.description,items.length+" منتج",()=>renderCategory(category)));});box.append(grid);};
  const renderCategory=(category)=>{clearView();const meta=categoryMeta[category]||{label:String(category||"قسم")};const items=productsForCategory(category);const view=document.createElement("div");view.className="baro-catalog-dynamic";view.append(makeBack("العودة إلى ألعاب الشحن اليدوي",()=>{if(typeof showSection==="function")showSection("manualGames",null);else renderHome();}),makeHeading(category==="freefire"?"باقات Free Fire":meta.label));const pref=groupOrder[category]||[];const groups=pref.filter(group=>items.some(p=>p.group_id===group));groups.forEach(group=>{const list=items.filter(p=>p.group_id===group);if(!list.length)return;const info=groupMeta[group]||{label:String(group||"الباقات"),icon:"✦",description:""};const section=document.createElement("section");section.className="baro-catalog-product-group";const head=document.createElement("div");head.className="baro-catalog-group-head";const icon=document.createElement("span");icon.className="baro-catalog-group-icon";icon.textContent=info.icon;const copy=document.createElement("div");copy.className="baro-catalog-group-copy";const title=document.createElement("strong");title.textContent=info.label;const desc=document.createElement("small");desc.textContent=info.description;copy.append(title,desc);const count=document.createElement("span");count.className="baro-catalog-group-count";count.textContent=list.length+" باقة";head.append(icon,copy,count);const grid=document.createElement("div");grid.className="baro-catalog-product-grid";list.forEach((p,i)=>grid.append(makeProductCard(p,category,group,info,i)));section.append(head,grid);view.append(section);});if(!groups.length){const empty=document.createElement("div");empty.className="baro-catalog-empty";empty.textContent="لا توجد باقات ضمن هذا القسم حالياً.";view.append(empty);}box.append(view);};
 const renderGroup=(category,group)=>{clearView();const meta=categoryMeta[category]||{label:String(category||"قسم")},info=groupMeta[group]||{label:"الباقات",icon:"✦",description:""},items=products.filter(p=>p.category_id===category&&p.group_id===group);const view=document.createElement("div");view.className="baro-catalog-dynamic";view.append(makeBack("رجوع إلى "+meta.label,()=>renderCategory(category)),makeHeading(info.label));const section=document.createElement("section");section.className="baro-catalog-product-group";const head=document.createElement("div");head.className="baro-catalog-group-head";const icon=document.createElement("span");icon.className="baro-catalog-group-icon";icon.textContent=info.icon;const copy=document.createElement("div");copy.className="baro-catalog-group-copy";const title=document.createElement("strong");title.textContent=info.label;const desc=document.createElement("small");desc.textContent=info.description;copy.append(title,desc);const count=document.createElement("span");count.className="baro-catalog-group-count";count.textContent=items.length+" باقة";head.append(icon,copy,count);const grid=document.createElement("div");grid.className="baro-catalog-product-grid";items.forEach((p,i)=>grid.append(makeProductCard(p,category,group,info,i)));section.append(head,grid);view.append(section);box.append(view);};
 const selectedCategory=window.baroManualSelectedCategory;if(selectedCategory&&categoryMeta[selectedCategory])renderCategory(selectedCategory);else renderHome();const footnote=document.createElement("p");footnote.className="baro-catalog-footnote";footnote.textContent="الأسعار معروضة بالدولار والليرة · يُحجز المبلغ عند إرسال الطلب، ويُثبّت عند نجاح الشحن أو يُعاد عند الفشل أو الإلغاء.";box.append(footnote);
}async function loadBaroCustomer(){
 const catalog=baroEl("baroCustomerCatalog"),orders=baroEl("baroCustomerOrders");
 if(!catalog||!orders){
  const reason="تعذر بدء تحميل BARO: "+(!catalog?"عنصر كتالوج المنتجات غير موجود. ":"")+(!orders?"عنصر طلبات BARO غير موجود.":"");
  if(catalog)catalog.textContent=reason;
  if(orders)orders.textContent=reason;
  console.error("[BARO] customer loader stopped: missing DOM elements",{catalog:!!catalog,orders:!!orders});
  return;
 }
 if(!currentUser){
  const reason="تعذر بدء تحميل BARO: جلسة المستخدم لم تجهز بعد. حدّث الصفحة مرة واحدة.";
  catalog.textContent=reason;orders.textContent=reason;
  console.error("[BARO] customer loader stopped: currentUser is empty");
  return;
 }
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
  if(previewCard)previewCard.textContent=enabled?"الاستقبال اليدوي متاح للمنتجات المفعّلة فقط. يتم حجز قيمة الطلب من المحفظة عند إرساله، ويُثبّت الخصم عند نجاح الشحن أو يُعاد المبلغ عند الفشل أو الإلغاء.":"الاستقبال اليدوي متوقف حالياً. يمكنك تصفح المنتجات والأسعار؛ لن يتم إنشاء طلب أو حجز رصيد.";
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
  const orderNumber=String(result.order_id||"").slice(0,8);
  const discountNote=appliedDiscount>0?" · تم تطبيق خصم القسيمة $"+appliedDiscount.toFixed(2):"";
  const deferredCharge=result.wallet_charge_mode==="wallet_on_completion";
  const successMessage=deferredCharge
    ?"تم تسجيل طلبك دون خصم من المحفظة. لن يُخصم أي مبلغ عند إرسال الطلب؛ سيتم الخصم فقط بعد اكتمال الشحن بنجاح. رقم الطلب: "+orderNumber+discountNote
    :"تم تسجيل طلبك وحجز المبلغ النهائي من المحفظة. رقم الطلب: "+orderNumber+discountNote+". سيتم تثبيت المبلغ عند اكتمال الشحن أو إعادته إذا فشل الطلب/أُلغي.";
  message.textContent=successMessage;
  baroEl("baroPlayerId").value="";if(baroEl("baroPlayerIdRepeat"))baroEl("baroPlayerIdRepeat").value="";baroEl("baroCustomerNote").value="";if(baroEl("baroCouponCode"))baroEl("baroCouponCode").value="";baroEl("baroPlayerIdConfirmed").checked=false;baroUpdateOrderSubmitState();baroScheduleCouponQuote();
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
async function baroAdminReservedOrderUpdate(order,nextStatus){
 const hold=order?.wallet_hold;
 if(!hold||hold.status!=="reserved"){baroAdminMessage("لم يتم تأكيد حجز الرصيد لهذا الطلب؛ أوقفنا التحديث لحماية المحفظة.");return;}
 if(!["in_progress","completed","failed"].includes(nextStatus))return;
 const quoteAmount=order.customer_price_usd!==null&&order.customer_price_usd!==undefined?Number(order.customer_price_usd):Number(order.customer_price_syp);
 const quoteCurrency=order.customer_price_usd!==null&&order.customer_price_usd!==undefined?"USD":"SYP";
 if(!Number.isFinite(quoteAmount)||quoteAmount<=0){baroAdminMessage("سعر الطلب المحفوظ غير صالح؛ لم يتم تغيير الطلب.");return;}
 const supplierCost=Number(order.supplier_cost_usd??order.supplier_cost_usd_snapshot??0);
 if(nextStatus==="completed"&&(!Number.isFinite(supplierCost)||supplierCost<=0)){baroAdminMessage("لا توجد تكلفة مورد صالحة؛ لم يتم إكمال الطلب أو تثبيت الحجز.");return;}
 const prompts={
  in_progress:"تأكيد بدء تنفيذ طلب BARO؟ سيبقى المبلغ محجوزاً حتى نجاح الشحن أو إرجاعه عند الفشل.",
  completed:"تأكيد نجاح الشحن؟ سيتم تثبيت المبلغ المحجوز نهائياً بعد اعتماد اكتمال الطلب.",
  failed:"تأكيد تعذر تنفيذ الشحن؟ سيتم إرجاع المبلغ المحجوز إلى محفظة الزبون."
 };
 if(!confirm(prompts[nextStatus]))return;
 const button=document.querySelector('[data-baro-reserved-action="'+order.id+'"][data-status="'+nextStatus+'"]');
 if(button){button.disabled=true;button.textContent="جارٍ التحديث...";}
 try{
  const result=await baroApi("POST",{action:"order_admin_update",order_id:order.id,status:nextStatus,
   quote_amount:quoteAmount,quote_currency:quoteCurrency,payment_method:order.payment_method,
   payment_status:"verified",customer_message:nextStatus==="in_progress"?"تم استلام طلبك وبدأ تنفيذ الشحن اليدوي.":nextStatus==="completed"?"تم شحن طلبك بنجاح! يرجى التحقق من وصول الرصيد إلى حسابك. شكراً لثقتك بـ BARAN GAME.":"تعذر تنفيذ الشحن، وتمت إعادة المبلغ المحجوز إلى محفظتك.",
   supplier_cost_usd:nextStatus==="completed"?supplierCost:(order.supplier_cost_usd??null),
   supplier_reference:order.supplier_reference||"",
   exception_reason:nextStatus==="completed"?"تم تنفيذ الشحن اليدوي والتحقق من وصوله إلى حساب الزبون.":"",
   internal_notes:order.internal_notes||""});
  baroAdminMessage(nextStatus==="completed"?(result.finance_posted?"اكتمل الشحن وثُبّت حجز المحفظة وسُجلت القيود المالية.":"تم تحديث الطلب؛ راجع سجل BARO للتأكد من القيود المالية."):nextStatus==="failed"?"تعذر الشحن وأُعيد المبلغ إلى محفظة الزبون.":"بدأ تنفيذ الطلب، وما زال المبلغ محجوزاً.");
  await loadBaroAdmin();
 }catch(error){baroAdminMessage(error.message);}
 finally{if(button)button.disabled=false;}
}
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
  }else if(o.wallet_charge_mode!=="wallet_on_completion"){
   const settlement=document.createElement("div");settlement.className="small";settlement.style.cssText="margin-top:10px;padding:9px;border:1px solid #76518f;border-radius:10px;background:#a56bd61c";
   settlement.textContent=o.wallet_hold?.status==="reserved"?"المبلغ محجوز من المحفظة بانتظار التنفيذ.":o.wallet_hold?.status==="captured"?"تم تثبيت خصم المحفظة بعد نجاح الشحن.":o.wallet_hold?.status==="refunded"?"تم إرجاع المبلغ إلى محفظة الزبون.":"تنبيه: لم تصلنا حالة حجز الرصيد؛ لا تُكمل الطلب قبل مراجعة سجل المحفظة.";
   card.append(settlement);
   if(o.wallet_hold?.status==="reserved"&&o.status==="paid"){
    const start=document.createElement("button");start.type="button";start.className="secondary";start.textContent="▶ بدء التنفيذ";
    start.setAttribute("data-baro-reserved-action",o.id);start.setAttribute("data-status","in_progress");start.style.cssText="width:100%;margin-top:10px";
    start.onclick=()=>baroAdminReservedOrderUpdate(o,"in_progress");card.append(start);
   }
   if(o.wallet_hold?.status==="reserved"&&o.status==="in_progress"){
    const complete=document.createElement("button");complete.type="button";complete.className="primary";complete.textContent="✓ تم الشحن — تثبيت الخصم";
    complete.setAttribute("data-baro-reserved-action",o.id);complete.setAttribute("data-status","completed");complete.style.cssText="width:100%;margin-top:10px;font-weight:900";
    complete.onclick=()=>baroAdminReservedOrderUpdate(o,"completed");card.append(complete);
    const fail=document.createElement("button");fail.type="button";fail.className="secondary";fail.textContent="تعذر الشحن — إرجاع الرصيد";
    fail.setAttribute("data-baro-reserved-action",o.id);fail.setAttribute("data-status","failed");fail.style.cssText="width:100%;margin-top:8px";
    fail.onclick=()=>baroAdminReservedOrderUpdate(o,"failed");card.append(fail);
   }
   if(o.wallet_hold?.status==="reserved"&&o.status==="paid"){
    const fail=document.createElement("button");fail.type="button";fail.className="secondary";fail.textContent="تعذر الشحن — إرجاع الرصيد";
    fail.setAttribute("data-baro-reserved-action",o.id);fail.setAttribute("data-status","failed");fail.style.cssText="width:100%;margin-top:8px";
    fail.onclick=()=>baroAdminReservedOrderUpdate(o,"failed");card.append(fail);
   }
  }else if(o.status==="completed"){
   const done=document.createElement("div");done.className="small";done.textContent="✓ اكتمل الشحن وسُجل الطلب.";card.append(done);
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
