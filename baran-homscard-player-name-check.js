/* BARAN GAME — optional PUBG / Free Fire player-name lookup for HomsCard checkout.
 * Reuses the existing authenticated Volsever-backed Edge Functions.
 * Display-only: it never gates quotes, checkout, or purchase.
 */
(function(){
 "use strict";
 if(window.BaranPlayerNameCheck)return;
 const endpoints={pubg:"baran-pubg-check",freefire:"baran-freefire-check"};
 const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 function gameFor(product){
  const raw=[product?.product_code,product?.name,product?.product_name].filter(Boolean).join(" ").toUpperCase();
  if(/FREE\s*FIRE|FREEFIRE|فري\s*فاير/.test(raw))return "freefire";
  if(/PUBG|PLAYERUNKNOWN|ببجي/.test(raw))return "pubg";
  return "";
 }
 function installStyle(){
  if(document.getElementById("baran-player-name-check-style"))return;
  const style=node("style");style.id="baran-player-name-check-style";
  style.textContent=".baran-player-check{display:grid;gap:7px;margin:7px 0 11px}.baran-player-check[hidden]{display:none!important}.baran-player-check button{min-height:40px;padding:8px 12px;border:1px solid #8862a4;border-radius:10px;background:linear-gradient(135deg,#3b294b,#24192f);color:#f3e8fb;font:inherit;font-size:12px;font-weight:800;cursor:pointer}.baran-player-check button:disabled{opacity:.65;cursor:wait}.baran-player-check-status{font-size:12px;line-height:1.8;color:#d9c8e8;overflow-wrap:anywhere}.baran-player-check-status:empty{display:none}.baran-player-check-status.is-success{padding:9px 11px;border:1px solid #397b5a;border-radius:10px;background:#14271f;color:#b9efcf}.baran-player-check-status.is-error{padding:9px 11px;border:1px solid #8b4c62;border-radius:10px;background:#2a1720;color:#ffd0d8}.baran-player-check-note{font-size:10px;line-height:1.7;color:#b9a9c9}";
  document.head.append(style);
 }
 function attach(input,product){
  if(!input)return;
  const game=gameFor(product);
  let wrap=input.nextElementSibling;
  if(!wrap?.classList?.contains("baran-player-check")){
   installStyle();
   wrap=node("div","baran-player-check");
   const button=node("button","","تحقق من اسم اللاعب");button.type="button";
   const status=node("div","baran-player-check-status");status.setAttribute("role","status");status.setAttribute("aria-live","polite");
   const note=node("small","baran-player-check-note","التحقق اختياري للمساعدة في التأكد من الحساب، ولا يمنع متابعة الطلب إذا تخطيته أو تعذّر.");
   wrap.append(button,status,note);input.insertAdjacentElement("afterend",wrap);
   button.addEventListener("click",()=>check(input,wrap));
   input.addEventListener("input",()=>{wrap.dataset.checkedId="";status.textContent="";status.classList.remove("is-success","is-error");button.textContent="تحقق من اسم اللاعب";});
  }
  wrap.dataset.game=game;wrap.hidden=!game;wrap.dataset.checkedId="";
 }
 async function check(input,wrap){
  const game=wrap.dataset.game,button=wrap.querySelector("button"),status=wrap.querySelector(".baran-player-check-status"),id=input.value.trim();
  status.classList.remove("is-success","is-error");
  if(!endpoints[game])return;
  if(!/^\d{5,20}$/.test(id)){status.textContent="أدخل Player ID صحيحاً من 5 إلى 20 رقماً.";status.classList.add("is-error");return;}
  const client=window.baranSupabaseClient||window.sb;
  if(!client?.auth||!client?.functions){status.textContent="خدمة التحقق غير جاهزة حالياً. يمكنك متابعة الطلب دون الفحص.";status.classList.add("is-error");return;}
  button.disabled=true;button.textContent="جارٍ التحقق...";status.textContent="جارٍ جلب اسم اللاعب...";
  try{
   const {data:{session},error:sessionError}=await client.auth.getSession();
   if(sessionError||!session?.access_token)throw new Error("AUTH_REQUIRED");
   const {data,error}=await client.functions.invoke(endpoints[game],{body:{id}});
   if(input.value.trim()!==id)return;
   if(error)throw error;
   if(!data?.ok||!data?.player?.username){
    const code=data?.error||"";
    status.textContent=code==="PLAYER_NOT_FOUND"?"لم يتم العثور على حساب بهذا الرقم. راجع الـID.":"تعذر التحقق حالياً. يمكنك متابعة الطلب دون الفحص.";
    status.classList.add("is-error");return;
   }
   const returnedId=String(data.player.id||"").trim();
   if(returnedId&&returnedId!==id){status.textContent="الرقم المعاد لا يطابق الرقم المدخل. لم نعتمد نتيجة الفحص.";status.classList.add("is-error");return;}
   const parts=["اسم اللاعب: "+String(data.player.username)];
   if(data.player.region)parts.push("المنطقة: "+String(data.player.region));
   if(data.player.level!==null&&data.player.level!==undefined)parts.push("المستوى: "+String(data.player.level));
   status.textContent="✓ "+parts.join(" · ");status.classList.add("is-success");wrap.dataset.checkedId=id;
  }catch(error){
   status.textContent=error?.message==="AUTH_REQUIRED"?"يلزم تسجيل الدخول لاستخدام التحقق. ويمكنك متابعة الطلب بدونه.":"تعذر الاتصال بخدمة التحقق حالياً. يمكنك متابعة الطلب دون الفحص.";
   status.classList.add("is-error");
  }finally{button.disabled=false;button.textContent="إعادة التحقق من اسم اللاعب";}
 }
 window.BaranPlayerNameCheck={attach,gameFor};
})();