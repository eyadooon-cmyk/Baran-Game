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
function render(tickets){
 const root=$("baranGuestAdminTickets");root.innerHTML="";
 if(!tickets.length){root.append(el("p","small","لا توجد تذاكر زوار حالياً."));return;}
 tickets.forEach(t=>{
  const card=el("article","baran-guest-admin-card");
  const head=el("div","baran-guest-admin-head");
  head.append(el("strong","",t.ticket_code),el("span","",t.status==="pending"?"بانتظار الرد":t.status==="answered"?"تم الرد":t.status==="closed"?"مغلقة":"قيد المتابعة"));
  card.append(head,el("p","small","البريد: "+t.email),el("h4","",t.subject),el("p","",t.initial_message),el("small","small",new Date(t.created_at).toLocaleString("ar-SY")));
  if(t.assistant_reason)card.append(el("p","small","تحليل Baran: "+t.assistant_reason));
  if(t.assistant_draft)card.append(el("p","small","مسودة مقترحة: "+t.assistant_draft));
  const reply=el("textarea","");reply.rows=3;reply.maxLength=5000;reply.placeholder="اكتب رد الإدارة للزبون...";
  const actions=el("div","baran-guest-admin-actions");
  const send=el("button","","إرسال الرد");send.type="button";
  send.onclick=async()=>{send.disabled=true;try{await request({action:"admin_reply",ticket_id:t.id,message:reply.value});reply.value="";await load();}catch(e){alert(e.message);}finally{send.disabled=false;}};
  const close=el("button","guest-admin-secondary","إغلاق التذكرة");close.type="button";
  close.onclick=async()=>{close.disabled=true;try{await request({action:"admin_update",ticket_id:t.id,status:"closed"});await load();}catch(e){alert(e.message);}finally{close.disabled=false;}};
  actions.append(send,close);card.append(reply,actions);root.append(card);
 });
}
async function load(){
 if(busy)return;busy=true;
 const status=$("baranGuestAdminStatus");if(status)status.textContent="جاري تحميل تذاكر الزوار...";
 try{const data=await request({action:"admin_list"});render(data.tickets||[]);if(status)status.textContent="آخر تحديث: "+new Date().toLocaleTimeString("ar-SY")+" — "+(data.tickets||[]).length+" تذكرة";}
 catch(e){if(status)status.textContent=e.message;}
 finally{busy=false;}
}
function init(){
 const admin=$("admin");if(!admin||installed)return;
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
 panel.append(title,status,refresh,list);admin.appendChild(panel);
 const observer=new MutationObserver(()=>{if(!admin.classList.contains("hidden"))load();});
 observer.observe(admin,{attributes:true,attributeFilter:["class","style"]});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
window.loadBaranGuestSupportAdmin=load;
})();