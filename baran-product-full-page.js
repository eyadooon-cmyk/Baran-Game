/* BARAN GAME — full-screen product details page */
(function(){
 if(window.__baranFullProductPageInstalled)return;
 window.__baranFullProductPageInstalled=true;
 const style=document.createElement("style");style.id="baran-product-full-page-style";
 style.textContent="#baranProductFullPage{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;overflow:auto;background:radial-gradient(ellipse at 90% 0%,rgba(126,77,164,.2),transparent 36rem),linear-gradient(180deg,#171020,#0b0810 70%);color:#f7effb;padding:calc(10px + env(safe-area-inset-top)) 14px calc(22px + env(safe-area-inset-bottom));box-sizing:border-box;font-family:inherit}#baranProductFullPage *{box-sizing:border-box}#baranProductFullPage .bpf-head{position:sticky;top:0;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0 14px;border-bottom:1px solid #624779;background:rgba(20,14,28,.96);z-index:2}#baranProductFullPage .bpf-head strong{font-size:17px}#baranProductFullPage .bpf-close{width:42px;height:42px;border:1px solid #76558e;border-radius:12px;background:#30213e;color:#fff;font-size:25px}#baranProductFullPage .bpf-main{width:100%;max-width:760px;margin:18px auto 0}#baranProductFullPage .bpf-title{display:flex;align-items:center;gap:14px;margin:0 0 18px}#baranProductFullPage .bpf-thumb{width:78px;height:78px;flex:0 0 78px;border:1px solid #8e69a9;border-radius:17px;background:linear-gradient(145deg,#54396b,#21152d);display:grid;place-items:center;overflow:hidden;font-size:25px;font-weight:900;color:#f2dfff}#baranProductFullPage .bpf-thumb img{width:100%;height:100%;object-fit:contain;padding:7px}#baranProductFullPage h2{font-size:21px;line-height:1.5;margin:0;text-align:right}#baranProductFullPage .bpf-card{padding:17px;border:1px solid #4d3960;border-radius:18px;background:linear-gradient(145deg,#241a30,#15101d);box-shadow:0 14px 36px #0005}#baranProductFullPage .bpf-card p{color:#d2c3dd;line-height:1.9;margin:0 0 12px;overflow-wrap:anywhere}#baranProductFullPage .bpf-price{padding:14px;margin:12px 0;border-radius:13px;background:#382449;border:1px solid #805b9b;color:#f6e8ff;font-size:17px;font-weight:900}#baranProductFullPage .bpf-meta{padding:11px 0;border-top:1px solid #ffffff16;color:#cdbbd9;font-size:13px;line-height:1.9;white-space:pre-line}#baranProductFullPage .bpf-action{width:100%;min-height:53px;margin-top:18px;border:0;border-radius:14px;background:linear-gradient(110deg,#c18be7,#8b55b4);color:#190f22;font-size:15px;font-weight:900}#baranProductFullPage .bpf-action:disabled{opacity:.45}@media(min-width:700px){#baranProductFullPage{padding-left:28px;padding-right:28px}#baranProductFullPage .bpf-main{margin-top:30px}#baranProductFullPage .bpf-thumb{width:94px;height:94px;flex-basis:94px}#baranProductFullPage h2{font-size:27px}}";
 document.head.append(style);
 function openPage(toggle){
  const card=toggle.closest(".baran-game-package-card,.baran-service-product,.baran-service-product-polished,article");
  const panel=toggle.nextElementSibling;
  if(!card||!panel||!panel.classList.contains("baran-product-detail-panel"))return;
  const name=panel.querySelector("strong")?.textContent?.replace(/^تفاصيل\s*/,"")||card.querySelector(".game-package-option strong,.baran-service-product-head strong")?.textContent||"تفاصيل المنتج";
  const image=card.querySelector(".baran-service-brand-visual img");
  const fallback=card.querySelector(".baran-package-art,.baran-service-product-icon,.baran-service-brand-visual")?.textContent?.trim()||"BG";
  const lines=[...panel.children].slice(1).map(el=>el.textContent.trim()).filter(Boolean);
  const priceLine=lines.find(x=>x.startsWith("السعر:"))||card.querySelector(".game-package-price,.baran-service-product-price")?.textContent||"السعر غير متوفر";
  const desc=lines.find(x=>!/^القسم:|^رمز المنتج:|^السعر:|^حالة الشراء:/.test(x))||card.querySelector(".baran-service-product-head")?.nextElementSibling?.textContent||"تفاصيل المنتج المعتمدة";
  const meta=lines.filter(x=>x!==desc&&!x.startsWith("السعر:"));
  const action=card.querySelector(".baran-service-select-button,.baran-package-button");
  const overlay=document.createElement("section");overlay.id="baranProductFullPage";overlay.setAttribute("role","dialog");overlay.setAttribute("aria-modal","true");overlay.setAttribute("aria-label","تفاصيل "+name);
  const head=document.createElement("header");head.className="bpf-head";
  const brand=document.createElement("strong");brand.textContent="BARAN GAME";
  const close=document.createElement("button");close.type="button";close.className="bpf-close";close.textContent="×";close.setAttribute("aria-label","إغلاق");
  const main=document.createElement("main");main.className="bpf-main";
  const title=document.createElement("div");title.className="bpf-title";
  const thumb=document.createElement("div");thumb.className="bpf-thumb";
  if(image?.src){const img=document.createElement("img");img.src=image.src;img.alt=name;thumb.append(img)}else thumb.textContent=fallback.slice(0,4);
  const h=document.createElement("h2");h.textContent=name;title.append(thumb,h);
  const content=document.createElement("div");content.className="bpf-card";
  const description=document.createElement("p");description.textContent=desc;content.append(description);
  const price=document.createElement("div");price.className="bpf-price";price.textContent=priceLine;content.append(price);
  if(meta.length){const details=document.createElement("div");details.className="bpf-meta";details.textContent=meta.join("\n");content.append(details)}
  const cta=document.createElement("button");cta.type="button";cta.className="bpf-action";cta.textContent=action?(action.classList.contains("baran-package-button")?"اختيار الباقة":"اختيار للمراجعة"):"إغلاق التفاصيل";
  if(action&&action.disabled)cta.disabled=true;
  cta.addEventListener("click",()=>{if(action&&!action.disabled){overlay.remove();action.click()}else overlay.remove()});
  content.append(cta);main.append(title,content);head.append(brand,close);overlay.append(head,main);
  function dismiss(){overlay.remove();toggle.focus?.()}
  close.addEventListener("click",dismiss);
  overlay.addEventListener("click",e=>{if(e.target===overlay)dismiss()});
  document.body.append(overlay);close.focus();
 }
 document.addEventListener("click",function(e){
  const toggle=e.target.closest?.(".baran-product-detail-toggle");if(!toggle)return;
  e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();openPage(toggle);
 },true);
})();