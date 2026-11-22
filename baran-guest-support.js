(function(){
"use strict";
const ENDPOINT="https://yabpmdzsiuyxxkcqakfs.supabase.co/functions/v1/baran-guest-support";
const SITE_KEY="0x4AAAAAAGNY2P5q5hGyUECS";
const $=id=>document.getElementById(id);
const esc=(s)=>String(s??"");
let widget=null, captchaToken="", activeTicket=null, trackingSecret=null;

function addStyle(){
 if($("baranGuestSupportStyle"))return;
 const s=document.createElement("style");s.id="baranGuestSupportStyle";
 s.textContent=`
 #baranGuestSupportEntry{margin-top:8px;background:transparent;border:1px solid #8b6ba8;color:#e9d9f4}
 #baranGuestSupportPanel{max-width:480px;margin:14px auto;padding:18px;background:#17131b;border:1px solid #665078;border-radius:17px}
 #baranGuestSupportPanel h3{margin:0 0 8px;color:#d9c4e8}
 #baranGuestSupportPanel .guest-note{font-size:12px;color:#b9a9c9;line-height:1.8}
 #baranGuestSupportPanel button{width:100%;margin-top:8px}
 #baranGuestSupportPanel .guest-secondary{background:#30223b;color:#eee}
 #baranGuestSupportPanel .guest-row{display:flex;gap:8px}
 #baranGuestSupportPanel .guest-row button{flex:1}
 #baranGuestSupportCaptcha{display:flex;justify-content:center;min-height:65px;margin:12px auto}
 #baranGuestSupportResult{padding:10px;margin-top:10px;border-radius:10px;background:#21182b;color:#eee;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8}
 #baranGuestSupportMessages{max-height:300px;overflow:auto;margin:12px 0}
 .baran-guest-message{padding:10px;margin:8px 0;border:1px solid #493b55;border-radius:11px;background:#100d15;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8}
 .baran-guest-message.admin{border-color:#80619a;background:#241a2e}
 `;
 document.head.appendChild(s);
}
function say(text,isError=false){
 const el=$("baranGuestSupportResult");if(!el)return;
 el.textContent=text;el.style.color=isError?"#ffc2cc":"#eee";
}
function waitTurnstile(){
 return new Promise((resolve,reject)=>{
  if(window.turnstile)return resolve();
  let n=0;const timer=setInterval(()=>{n++;if(window.turnstile){clearInterval(timer);resolve();}else if(n>80){clearInterval(timer);reject(new Error("تعذر تحميل التحقق الأمني. حدّث الصفحة وحاول مجدداً."));}},150);
 });
}
async function mountCaptcha(){
 await waitTurnstile();
 if(widget!==null){try{window.turnstile.remove(widget);}catch(e){}widget=null;}
 captchaToken="";
 $("baranGuestSupportCaptcha").innerHTML="";
 widget=window.turnstile.render("#baranGuestSupportCaptcha",{
  sitekey:SITE_KEY,theme:"dark",size:"flexible",
  callback:t=>{captchaToken=t;},
  "expired-callback":()=>{captchaToken="";},
  "error-callback":()=>{captchaToken="";}
 });
}
async function callApi(payload){
 const key=window.baranSupabaseClient?.supabaseKey;
 if(!key)throw new Error("تعذر الاتصال بخدمة المتجر. حدّث الصفحة.");
 const res=await fetch(ENDPOINT,{method:"POST",headers:{"Content-Type":"application/json","apikey":key},body:JSON.stringify(payload)});
 const data=await res.json().catch(()=>({}));
 if(!res.ok||!data.success)throw new Error(data.error||"تعذر تنفيذ الطلب.");
 return data;
}
function panelMarkup(){
 return `
 <div id="baranGuestSupportPanel" class="hidden" dir="rtl">
  <h3>مشكلة بالدخول أو إنشاء حساب؟</h3>
  <p class="guest-note">تواصل مع فريق BARAN GAME حتى لو ما عندك حساب. احتفظ برقم التذكرة والرمز السري لمتابعة الرد.</p>
  <div id="baranGuestSupportStart">
   <input id="baranGuestEmail" type="email" autocomplete="email" placeholder="بريدك الإلكتروني (إجباري)">
   <input id="baranGuestSubject" type="text" maxlength="120" placeholder="عنوان المشكلة (اختياري)" value="مشكلة بالدخول أو إنشاء حساب">
   <textarea id="baranGuestMessage" rows="4" maxlength="5000" placeholder="اشرح المشكلة بالتفصيل..."></textarea>
   <div id="baranGuestSupportCaptcha"></div>
   <button id="baranGuestCreateBtn" type="button">إرسال طلب الدعم</button>
   <button id="baranGuestLookupMode" class="guest-secondary" type="button">لدي رقم تذكرة — متابعة الرد</button>
  </div>
  <div id="baranGuestSupportLookup" class="hidden">
   <input id="baranGuestTicketCode" placeholder="رقم التذكرة BG-G-..." autocomplete="off">
   <input id="baranGuestTicketSecret" type="password" placeholder="الرمز السري للتذكرة" autocomplete="off">
   <button id="baranGuestLookupBtn" type="button">عرض المحادثة</button>
   <button id="baranGuestBackCreate" class="guest-secondary" type="button">فتح تذكرة جديدة</button>
  </div>
  <div id="baranGuestSupportThread" class="hidden">
   <div id="baranGuestTicketMeta" class="guest-note"></div>
   <div id="baranGuestSupportMessages"></div>
   <textarea id="baranGuestReplyText" rows="3" maxlength="5000" placeholder="اكتب رسالة إضافية..."></textarea>
   <div id="baranGuestReplyCaptcha"></div>
   <button id="baranGuestReplyBtn" type="button">إرسال الرسالة</button>
   <button id="baranGuestRefreshBtn" class="guest-secondary" type="button">تحديث الردود</button>
  </div>
  <div id="baranGuestSupportResult" role="status" aria-live="polite"></div>
  <button id="baranGuestSupportClose" class="guest-secondary" type="button">العودة لتسجيل الدخول</button>
 </div>`;
}
function renderMessages(messages){
 const root=$("baranGuestSupportMessages");root.innerHTML="";
 (messages||[]).forEach(m=>{
  const el=document.createElement("div");el.className="baran-guest-message"+(m.sender_role==="admin"||m.sender_role==="assistant"?" admin":"");
  const label=document.createElement("strong");
  label.textContent=m.sender_role==="guest"?"أنت":m.sender_role==="admin"?"فريق الدعم":"Baran Assistant";
  const body=document.createElement("div");body.textContent=esc(m.message);
  const time=document.createElement("small");time.className="guest-note";time.textContent=new Date(m.created_at).toLocaleString("ar-SY");
  el.append(label,body,time);root.appendChild(el);
 });
}
async function lookup(showError=true){
 try{
  const data=await callApi({action:"lookup",ticket_code:$("baranGuestTicketCode").value.trim(),tracking_secret:$("baranGuestTicketSecret").value.trim()});
  activeTicket=data.ticket;trackingSecret=$("baranGuestTicketSecret").value.trim();
  $("baranGuestSupportStart").classList.add("hidden");$("baranGuestSupportLookup").classList.add("hidden");$("baranGuestSupportThread").classList.remove("hidden");
  $("baranGuestTicketMeta").textContent="التذكرة "+data.ticket.ticket_code+" — الحالة: "+data.ticket.status;
  renderMessages(data.messages);say("تم تحميل محادثة التذكرة.");
  await mountReplyCaptcha();
 }catch(e){if(showError)say(e.message,true);}
}
async function mountReplyCaptcha(){
 const el=$("baranGuestReplyCaptcha");if(!el)return;
 await waitTurnstile();el.innerHTML="";
 widget=window.turnstile.render("#baranGuestReplyCaptcha",{sitekey:SITE_KEY,theme:"dark",size:"flexible",callback:t=>{captchaToken=t;},"expired-callback":()=>{captchaToken="";},"error-callback":()=>{captchaToken="";}});
}
async function init(){
 const screen=$("authScreen"),card=screen?.querySelector(".auth-card");
 if(!screen||!card||$("baranGuestSupportEntry"))return;
 addStyle();
 const entry=document.createElement("button");entry.id="baranGuestSupportEntry";entry.type="button";entry.className="full";entry.textContent="مشكلة بالدخول أو إنشاء حساب؟ تواصل مع الدعم";
 const forgot=$("forgotPasswordButton");if(forgot)forgot.insertAdjacentElement("afterend",entry);else card.appendChild(entry);
 card.insertAdjacentHTML("afterend",panelMarkup());
 entry.addEventListener("click",async()=>{
  card.classList.add("hidden");$("baranGuestSupportPanel").classList.remove("hidden");
  $("baranGuestSupportResult").textContent="";
  $("baranGuestSupportStart").classList.remove("hidden");$("baranGuestSupportLookup").classList.add("hidden");$("baranGuestSupportThread").classList.add("hidden");
  try{await mountCaptcha();}catch(e){say(e.message,true);}
 });
 $("baranGuestSupportClose").onclick=()=>{$("baranGuestSupportPanel").classList.add("hidden");card.classList.remove("hidden");};
 $("baranGuestLookupMode").onclick=()=>{$("baranGuestSupportStart").classList.add("hidden");$("baranGuestSupportLookup").classList.remove("hidden");$("baranGuestSupportThread").classList.add("hidden");say("");};
 $("baranGuestBackCreate").onclick=async()=>{$("baranGuestSupportLookup").classList.add("hidden");$("baranGuestSupportStart").classList.remove("hidden");say("");try{await mountCaptcha();}catch(e){say(e.message,true);}};
 $("baranGuestCreateBtn").onclick=async()=>{
  const btn=$("baranGuestCreateBtn");btn.disabled=true;
  try{
   if(!captchaToken)throw new Error("أكمل التحقق الأمني أولاً.");
   const data=await callApi({action:"create",email:$("baranGuestEmail").value,subject:$("baranGuestSubject").value,message:$("baranGuestMessage").value,turnstile_token:captchaToken});
   $("baranGuestSupportStart").classList.add("hidden");
   say("تم فتح تذكرتك بنجاح.\nرقم التذكرة: "+data.ticket_code+"\nالرمز السري: "+data.tracking_secret+"\n\nاحتفظ بهما معاً؛ لن نعرض الرمز السري مرة ثانية.");
   $("baranGuestTicketCode").value=data.ticket_code;$("baranGuestTicketSecret").value=data.tracking_secret;
   $("baranGuestSupportLookup").classList.remove("hidden");
   try{window.turnstile.reset(widget);}catch(e){}captchaToken="";
  }catch(e){say(e.message,true);try{window.turnstile.reset(widget);}catch(x){}captchaToken="";}
  finally{btn.disabled=false;}
 };
 $("baranGuestLookupBtn").onclick=()=>lookup(true);
 $("baranGuestRefreshBtn").onclick=()=>lookup(true);
 $("baranGuestReplyBtn").onclick=async()=>{
  const btn=$("baranGuestReplyBtn");btn.disabled=true;
  try{
   if(!captchaToken)throw new Error("أكمل التحقق الأمني أولاً.");
   const data=await callApi({action:"guest_reply",ticket_code:activeTicket?.ticket_code,tracking_secret:trackingSecret,message:$("baranGuestReplyText").value,turnstile_token:captchaToken});
   $("baranGuestReplyText").value="";renderMessages(data.messages);say("تم إرسال رسالتك.");
   try{window.turnstile.reset(widget);}catch(e){}captchaToken="";
  }catch(e){say(e.message,true);try{window.turnstile.reset(widget);}catch(x){}captchaToken="";}
  finally{btn.disabled=false;}
 };
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();