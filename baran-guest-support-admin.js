(function(){
"use strict";
const ENDPOINT="https://yabpmdzsiuyxxkcqakfs.supabase.co/functions/v1/baran-guest-support";
const $=id=>document.getElementById(id);
let installed=false,busy=false;
async function request(payload){
 const sb=window.baranSupabaseClient;if(!sb)throw new Error("تعذر الاتصال بقاعدة البيانات.");
 const {data,error}=await sb.auth.getSession();const session=data?.session;
 if(error||!session)throw new Error("انتهت جلسة الإدارة.");
 const res=await fetch(ENDPOINT,{method:"POST",headers:{"Authorization":"Bearer "+session.access_token,"apikey":sb.supabaseKey,"Content-Type":"application/json"},body:JSON.stringify(payload)});
 const out=await res.json().catch(()=>({}));
 if(!res.ok||!out.success)throw new Error(out.error||"تعذر تنفيذ الطلب.");
 return out;
}
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function buildGuestAnalysis(ticket){
 const raw=String(ticket.initial_message||"").toLowerCase();
 const normalized=raw.replace(/[أإآ]/g,"ا").replace(/ة/g,"ه").replace(/ى/g,"ي");
 if((/(نسيت|ناسي|ضاعت)/.test(normalized)&&/(كلمه المرور|كلمة السر|باسورد|password)/.test(normalized))||/(تسجيل الدخول|ما عم اقدر فوت|ما بقدر سجل|login|password reset)/.test(normalized)){
  return {reason:"المشكلة تبدو مرتبطة بتسجيل الدخول أو استعادة كلمة المرور. يجب توجيه الزائر لمسار الاستعادة وعدم طلب كلمة المرور أو رمز التحقق.",draft:"أهلاً فيك ❤️ إذا نسيت كلمة المرور، اضغط «استعادة كلمة المرور» من شاشة الدخول، واكتب البريد المرتبط بحسابك، ثم افحص صندوق الوارد والرسائل غير المرغوب فيها. لا ترسل كلمة مرورك أو رمز التحقق لأي شخص. إذا لم يصلك الرابط، أخبرنا بالرسالة التي تظهر لك."};
 }
 if(/ما بيفتح|ما عم يفتح|الموقع|الصفحه|التطبيق|loading|not loading/.test(normalized)){
  return {reason:"المشكلة تبدو مشكلة تحميل أو فتح الموقع؛ المقترح يبدأ بفحص الاتصال والمتصفح ويطلب تفاصيل تقنية غير حساسة عند استمرارها.",draft:"أهلاً فيك 🌟 تأكد من اتصال الإنترنت، ثم حدّث الصفحة وأعد فتح Chrome. إذا استمرت المشكلة، جرّب نافذة خاصة وأرسل لنا نوع جهازك ورسالة الخطأ الظاهرة، من دون مشاركة أي كلمة مرور."};
 }
 if(/اشعار|اشعارات|تنبيه|notifications/.test(normalized)){
  return {reason:"المشكلة تتعلق غالباً بإذن الإشعارات أو إعدادات الهاتف والمتصفح؛ نطلب نوع الجهاز فقط إذا استمرت.",draft:"أهلاً فيك 🌟 تأكد من السماح بإشعارات BARAN GAME من إعدادات Chrome والهاتف، ثم افتح المتجر مجدداً. إذا استمرت المشكلة، أرسل نوع جهازك وإصدار Android."};
 }
 return {reason:"لم تظهر فئة مشكلة محددة من نص التذكرة؛ لذلك اختر Baran رداً عاماً آمناً يثبت استلام البلاغ ويطلب تفاصيل إضافية غير حساسة.",draft:"أهلاً فيك، وصلتنا رسالتك ورح يراجع فريق BARAN GAME المشكلة ويتابع معك عبر رقم التذكرة. إذا في تفاصيل إضافية غير حساسة، أرسلها هون. لا ترسل كلمة المرور أو رموز التحقق."};
}
async function openGuestAdminThread(ticket){
 const old=document.getElementById("baranGuestAdminThreadModal");if(old)old.remove();
 const modal=el("div","");modal.id="baranGuestAdminThreadModal";
 modal.style.cssText="position:fixed;inset:0;z-index:100050;background:#08060dcc;display:flex;align-items:center;justify-content:center;padding:12px";
 const box=el("section","");box.style.cssText="width:min(100%,620px);max-height:88vh;overflow:auto;padding:16px;border:1px solid #80619a;border-radius:17px;background:#17121f;color:#f4eafa";
 box.append(el("h3","","المحادثة الكاملة — "+ticket.ticket_code),el("p","small",ticket.email+" · "+ticket.subject));
 const close=el("button","guest-admin-secondary","إغلاق النافذة");close.type="button";close.onclick=()=>modal.remove();box.append(close);
 const messages=el("div","");messages.style.cssText="display:grid;gap:9px;margin:12px 0";box.append(messages);modal.append(box);document.body.append(modal);
 try{
  const data=await request({action:"admin_thread",ticket_id:ticket.id});
  (data.messages||[]).forEach(m=>{
   const bubble=el("article","");bubble.style.cssText="padding:11px;border:1px solid #59436d;border-radius:12px;background:"+(m.sender_role==="guest"?"#100d16":"#2a1d35");
   bubble.append(el("strong","",m.sender_role==="guest"?"العميل":m.sender_role==="assistant"?"Baran Assistant":"فريق الدعم"));
   const body=el("p","",m.message);body.style.cssText="white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8";
   bubble.append(body,el("small","small",new Date(m.created_at).toLocaleString("ar-SY")));messages.append(bubble);
  });
 }catch(error){messages.append(el("p","",error.message));}
}
function render(tickets){
 const root=$("baranGuestAdminTickets");root.innerHTML="";
 const openTickets=tickets.filter(t=>t.status!=="closed");
 if(!openTickets.length){root.append(el("p","small","لا توجد تذاكر مفتوحة حالياً."));return;}
 openTickets.forEach(t=>{
  const card=el("article","baran-guest-admin-card");
  const head=el("div","baran-guest-admin-head");
  head.append(el("strong","",t.ticket_code),el("span","",t.status==="pending"?"بانتظار الرد":t.status==="answered"?"تم الرد":t.status==="closed"?"مغلقة":"قيد المتابعة"));
  card.append(head,el("p","small","البريد: "+t.email),el("h4","",t.subject),el("p","",t.initial_message),el("small","small",new Date(t.created_at).toLocaleString("ar-SY")));
  const analysis=el("div","baran-guest-admin-analysis");analysis.hidden=true;
  const analysisTitle=el("strong","","تحليل Baran الداخلي");
  const analysisText=el("p","small","");
  analysis.append(analysisTitle,analysisText);
  if(t.assistant_reason||t.assistant_draft){
   analysis.hidden=false;
   analysisText.textContent=t.assistant_reason||"اقتراح محفوظ سابقاً.";
  }
  const reply=el("textarea","");reply.rows=4;reply.maxLength=5000;reply.placeholder="اكتب رد الإدارة للزبون أو عدّل المسودة المقترحة...";
  if(t.assistant_draft)reply.value=t.assistant_draft;
  const actions=el("div","baran-guest-admin-actions");
  const send=el("button","","إرسال الرد");send.type="button";
  send.onclick=async()=>{if(!reply.value.trim()){alert("اكتب الرد قبل الإرسال.");return;}send.disabled=true;try{await request({action:"admin_reply",ticket_id:t.id,message:reply.value.trim()});reply.value="";await load();}catch(e){alert(e.message);}finally{send.disabled=false;}};
  const close=el("button","guest-admin-secondary","إغلاق التذكرة");close.type="button";
  close.onclick=async()=>{close.disabled=true;try{await request({action:"admin_update",ticket_id:t.id,status:"closed"});await load("تم إغلاق التذكرة بنجاح.");}catch(e){alert(e.message);}finally{close.disabled=false;}};
  const analyze=el("button","guest-admin-secondary","تحليل واقتراح رد");analyze.type="button";
  analyze.onclick=()=>{
   analyze.disabled=true;
   try{
    const result=buildGuestAnalysis(t);
    analysisText.textContent=result.reason;
    analysis.hidden=false;
    reply.value=result.draft;
    reply.focus();
    analyze.textContent="إعادة التحليل";
   }finally{analyze.disabled=false;}
  };
  const history=el("button","guest-admin-secondary","عرض سجل المحادثة");history.type="button";history.onclick=()=>openGuestAdminThread(t);
  actions.append(history,analyze,send,close);card.append(analysis,reply,actions);root.append(card);
 });
}
async function load(successMessage){
 if(busy)return;busy=true;
 const status=$("baranGuestAdminStatus");if(status)status.textContent="جاري تحميل تذاكر الزوار...";
 try{const data=await request({action:"admin_list"});render(data.tickets||[]);if(status)status.textContent=successMessage||("آخر تحديث: "+new Date().toLocaleTimeString("ar-SY")+" — "+(data.tickets||[]).filter(t=>t.status!=="closed").length+" تذكرة مفتوحة");}
 catch(e){if(status)status.textContent=e.message;}
 finally{busy=false;}
}
function init(){
 const mount=$("baranGuestAdminMount");if(!mount||installed)return;
 installed=true;
 const style=el("style");style.textContent=`
 #baranGuestAdminPanel{margin:16px 0;padding:16px;border:1px solid #80619a;border-radius:16px;background:linear-gradient(150deg,#21182b,#15111c)}
 #baranGuestAdminPanel h3{color:#d9c4e8;margin-top:0}
 .baran-guest-admin-card{padding:13px;margin:10px 0;border:1px solid #554064;border-radius:13px;background:#100d16}
 .baran-guest-admin-head{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;color:#e9d9f4}
 .baran-guest-admin-card h4{margin:8px 0;color:#d9c4e8}
 .baran-guest-admin-card p{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7}
 .baran-guest-admin-actions{display:flex;gap:8px;flex-wrap:wrap}
 .baran-guest-admin-actions button{flex:1;min-width:130px}
 .guest-admin-secondary{background:#30223b;color:#eee}
 `;
 document.head.appendChild(style);
 const panel=el("section","");panel.id="baranGuestAdminPanel";
 const title=el("h3","","دعم الزوار — بدون تسجيل دخول");
 const status=el("p","small","اضغط تحديث لقراءة تذاكر الزوار.");status.id="baranGuestAdminStatus";
 const refresh=el("button","","تحديث التذاكر");refresh.type="button";refresh.onclick=load;
 const list=el("div","");list.id="baranGuestAdminTickets";
 panel.append(title,status,refresh,list);mount.appendChild(panel);
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
window.loadBaranGuestSupportAdmin=load;
})();