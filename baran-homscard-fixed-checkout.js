/* BARAN GAME — unified fixed-package preview/quote flow. Purchase remains disabled. */
(function(){
 "use strict";
 if(window.__baranFixedCheckoutV1)return;window.__baranFixedCheckoutV1=true;
 const $=s=>document.querySelector(s),el=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=txt;return n};
 let catalog=null,loading=null,selected=null;
 const money=(n,d=2)=>Number(n).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
 async function invoke(body){
  const client=window.baranSupabaseClient||window.sb;
  if(!client?.functions)throw Error("جلسة المتجر غير جاهزة. حدّث الصفحة وسجّل الدخول.");
  const {data,error}=await client.functions.invoke("baran-order-gateway",{body});
  if(error||!data?.success)throw Error(data?.error||error?.message||"تعذر الاتصال ببوابة المنتجات الثابتة.");
  return data;
 }
 async function load(){
  if(catalog)return catalog;if(loading)return loading;
  loading=invoke({action:"homscard_fixed_catalog"}).then(d=>catalog=Array.isArray(d.products)?d.products:[]).finally(()=>loading=null);
  return loading;
 }
 function close(){document.getElementById("baranFixedCheckout")?.remove();document.body.classList.remove("baran-fixed-modal-open");}
 function open(product){
  selected=product;close();
  const overlay=el("section","baran-fixed-overlay");overlay.id="baranFixedCheckout";overlay.dir="rtl";overlay.setAttribute("role","dialog");overlay.setAttribute("aria-modal","true");
  const panel=el("div","baran-fixed-panel");
  const top=el("div","baran-fixed-top");top.append(el("strong","","BARAN GAME · المنتجات الثابتة"));
  const x=el("button","baran-fixed-close","×");x.type="button";x.addEventListener("click",close);top.append(x);
  const title=el("h2","",product.name||product.product_code);
  const desc=el("p","",product.description||"منتج ثابت من مورد HomsCard.");
  const price=el("div","baran-fixed-price",money(product.sale_usd)+" $  ·  "+money(product.sale_syp)+" ل.س جديدة");
  const form=el("div","baran-fixed-form");
  const label=el("label","","Player ID");const player=document.createElement("input");player.type="text";player.maxLength=100;player.autocomplete="off";player.placeholder="أدخل Player ID";player.dir="ltr";
  const currencyLabel=el("label","","عملة الدفع");const currency=document.createElement("select");
  [["SYP","ليرة سورية جديدة"],["USD","دولار أمريكي"]].forEach(([v,t])=>{const o=document.createElement("option");o.value=v;o.textContent=t;currency.append(o)});
  const quoteButton=el("button","baran-fixed-quote","مراجعة السعر");quoteButton.type="button";
  const purchase=el("button","baran-fixed-purchase","تأكيد الطلب والشحن");purchase.type="button";purchase.disabled=true;
  const result=el("p","baran-fixed-result","أدخل Player ID ثم راجع السعر. هذه معاينة فقط ولا تخصم رصيداً.");
  purchase.addEventListener("click",async()=>{
   if(purchase.disabled)return;
   purchase.disabled=true;quoteButton.disabled=true;result.textContent="جاري إرسال الطلب...";
   try{
    const d=await invoke({action:"homscard_fixed_create_order",product_code:product.product_code,player_id:player.value.trim(),payment_currency:currency.value,request_id:crypto.randomUUID()});
    result.textContent=d.message||("تم تسجيل الطلب رقم "+String(d.order_id||"")+" وحالته "+String(d.status||"قيد التنفيذ"));
   }catch(e){result.textContent=e.message||"تعذر إنشاء الطلب."}
   finally{purchase.disabled=true;quoteButton.disabled=false}
  });
  quoteButton.addEventListener("click",async()=>{
   const id=player.value.trim();if(id.length<2){result.textContent="أدخل Player ID صحيحاً.";return}
   quoteButton.disabled=true;result.textContent="جاري التحقق من المنتج والسعر...";
   try{
    const d=await invoke({action:"homscard_fixed_quote",product_code:product.product_code,player_id:id,payment_currency:currency.value});
    if(d.can_create_order!==false||d.can_purchase!==false||d.charged!==false||d.order_created!==false)throw Error("استجابة غير متوقعة؛ أوقفنا المتابعة لحماية الرصيد.");
    const q=d.quote||{};result.textContent="السعر المؤكد: "+money(currency.value==="USD"?q.sale_usd:q.sale_syp)+(currency.value==="USD"?" $":" ل.س جديدة")+" · Player ID: "+(q.player_id_masked||"مخفي")+" · لا يوجد إنشاء طلب أو خصم.";
   }catch(e){result.textContent=e.message||"تعذر مراجعة السعر."}
   finally{quoteButton.disabled=false}
  });
  form.append(label,player,currencyLabel,currency,quoteButton,purchase,result);\n  window.BaranPlayerNameCheck?.attach(player,{product_code:product.product_code,name:product.name});
  const note=el("p","baran-fixed-note","الشحن غير مفعّل حالياً. زر التأكيد معطّل عمداً حتى اكتمال المعاملة الآمنة واختبارات المورد.");
  panel.append(top,title,desc,price,form,note);overlay.append(panel);
  overlay.addEventListener("click",e=>{if(e.target===overlay)close()});
  document.body.append(overlay);document.body.classList.add("baran-fixed-modal-open");player.focus();
 }
 document.addEventListener("click",async event=>{
  const button=event.target.closest(".baran-package-button,.baran-service-select-button");
  if(!button||button.disabled)return;
  const code=button.dataset.productCode||button.closest("[data-package-code]")?.dataset.packageCode||"";
  const productId=button.dataset.serviceProductId||button.closest("[data-product-id]")?.dataset.productId||"";
  if(!code&&!productId)return;
  event.preventDefault();event.stopImmediatePropagation();
  try{
   const products=await load();const product=products.find(p=>(code&&p.product_code===code)||(productId&&String(p.product_id)===String(productId)));
   if(!product)throw Error("هذا المنتج غير موجود ضمن كتالوج HomsCard الثابت المعتمد حالياً.");
   open(product);
  }catch(e){alert(e.message||"تعذر فتح المنتج الثابت.")}
 },true);
 const style=el("style");style.id="baran-fixed-checkout-style";style.textContent=`
 .baran-fixed-overlay{position:fixed;inset:0;z-index:2147483600;background:#09070fdd;display:grid;place-items:center;padding:14px;overflow:auto}
 .baran-fixed-panel{width:min(100%,520px);padding:18px;border:1px solid #795794;border-radius:20px;background:linear-gradient(145deg,#241a30,#100c16);color:#f7effb;box-shadow:0 20px 60px #0009}
 .baran-fixed-top{display:flex;justify-content:space-between;align-items:center;gap:12px;padding-bottom:12px;border-bottom:1px solid #ffffff20}
 .baran-fixed-close{width:42px;height:42px;border:1px solid #76558e;border-radius:12px;background:#30213e;color:#fff;font-size:24px}
 .baran-fixed-panel h2{font-size:20px;margin:18px 0 8px}.baran-fixed-panel p{line-height:1.8;color:#d4c5df}
 .baran-fixed-price{padding:14px;margin:14px 0;border-radius:13px;background:#382449;border:1px solid #805b9b;font-weight:900}
 .baran-fixed-form{display:grid;gap:9px}.baran-fixed-form label{font-size:13px;color:#e5d6ef}
 .baran-fixed-form input,.baran-fixed-form select{width:100%;min-height:46px;padding:10px;border:1px solid #76558e;border-radius:11px;background:#120d18;color:#fff;font:inherit}
 .baran-fixed-form button{min-height:46px;border-radius:11px;font-weight:900}
 .baran-fixed-quote{border:1px solid #a879c9;background:#392548;color:#fff}.baran-fixed-purchase{border:0;background:#594b60;color:#ddd;opacity:.5}
 .baran-fixed-result{padding:10px;border-radius:10px;background:#17121e}.baran-fixed-note{font-size:12px}
 `;
 document.head.append(style);
})();