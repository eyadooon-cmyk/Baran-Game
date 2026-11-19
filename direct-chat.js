(function(){
"use strict";
const $=id=>document.getElementById(id);
const endpoint="https://yabpmdzsiuyxxkcqakfs.supabase.co/functions/v1/baran-direct-chat";
let adminConversation=null,customerConversation=null;
const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
async function request(method="GET",params={},body){
 const {data:{session},error}=await sb.auth.getSession();if(error||!session)throw new Error("انتهت الجلسة، سجّل الدخول مجدداً.");
 const u=new URL(endpoint);Object.entries(params).forEach(([k,v])=>v&&u.searchParams.set(k,v));
 const r=await fetch(u,{method,headers:{Authorization:"Bearer "+session.access_token,apikey:SUPABASE_KEY,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"تعذر تنفيذ الطلب.");return d;
}
function styles(){if($("bdcStyles"))return;const s=el("style");s.id="bdcStyles";s.textContent=`
.bdc{margin:14px 0;padding:14px;border:1px solid #765792;border-radius:16px;background:linear-gradient(145deg,#21182b,#120e18)}
.bdc strong{color:#ead9f6}.bdc-status{font-size:12px;color:#c5b4d6;min-height:22px;margin:8px 0}
.bdc-messages{display:flex;flex-direction:column;gap:8px;max-height:340px;overflow:auto;padding:10px;border:1px solid #40334b;border-radius:12px;background:#0d0a11}
.bdc-msg{max-width:88%;padding:10px 12px;border-radius:13px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.65;font-size:13px}
.bdc-msg.admin{align-self:flex-start;background:#332440;border:1px solid #694d7d;color:#f4eafa}.bdc-msg.customer{align-self:flex-end;background:#55406a;color:#fff}
.bdc-msg small{display:block;margin-top:5px;font-size:10px;opacity:.7}.bdc-form{display:flex;gap:8px;align-items:flex-end;margin-top:10px}
.bdc-form textarea{flex:1;min-width:0;margin:0;min-height:48px;max-height:120px}.bdc-form button,.bdc-open{min-height:46px;padding:10px 13px}
.bdc-open{width:100%;margin-top:10px;background:linear-gradient(100deg,#694080,#382449)!important;color:#fff!important;border:1px solid #b58bd2!important}
@media(max-width:420px){.bdc-form{align-items:stretch}.bdc-form button{padding:7px}.bdc-messages{max-height:290px}}
`;document.head.append(s);}
function panel(id,title){const p=el("section","bdc");p.id=id;const h=el("strong","",title),st=el("div","bdc-status");st.id=id+"Status";const msgs=el("div","bdc-messages");msgs.id=id+"Messages";const form=el("form","bdc-form"),ta=el("textarea");ta.id=id+"Input";ta.rows=2;ta.maxLength=2000;ta.required=true;ta.placeholder="اكتب رسالتك هنا...";const b=el("button","","إرسال");b.type="submit";form.append(ta,b);p.append(h,st,msgs,form);return p;}
function draw(id,rows){const box=$(id);if(!box)return;box.replaceChildren();(rows||[]).forEach(m=>{const b=el("div","bdc-msg "+m.sender_role,m.message),meta=el("small","",(m.sender_role==="admin"?"إدارة باران":"العميل")+" · "+new Date(m.created_at).toLocaleString("ar"));b.append(meta);box.append(b);});box.scrollTop=box.scrollHeight;}
async function loadAdmin(){if(!adminConversation)return;try{const d=await request("GET",{conversation_id:adminConversation});draw("bdcAdminMessages",d.messages);$("bdcAdminStatus").textContent="محادثة مباشرة مع "+(d.customer?.full_name||"العميل");}catch(e){$("bdcAdminStatus").textContent=e.message;}}
async function startAdmin(id){const p=$("bdcAdmin");p?.classList.remove("hidden");$("bdcAdminStatus").textContent="جاري فتح المحادثة...";try{const d=await request("POST",{}, {action:"start",customer_id:id});adminConversation=d.conversation.id;await loadAdmin();p.scrollIntoView({behavior:"smooth",block:"start"});}catch(e){$("bdcAdminStatus").textContent=e.message;}}
async function sendAdmin(e){e.preventDefault();const t=$("bdcAdminInput").value.trim();if(!t||!adminConversation)return;const b=e.submitter;b.disabled=true;try{await request("POST",{}, {action:"send",conversation_id:adminConversation,message:t});$("bdcAdminInput").value="";await loadAdmin();}catch(x){$("bdcAdminStatus").textContent=x.message;}finally{b.disabled=false;}}
async function loadCustomer(){if(!$("bdcCustomerStatus"))return;try{const d=await request("GET");customerConversation=d.conversation?.id||null;if(!customerConversation){$("bdcCustomerStatus").textContent="ما في محادثة مباشرة حالياً. عندما تبدأ الإدارة محادثة معك ستظهر هنا.";draw("bdcCustomerMessages",[]);return;}$("bdcCustomerStatus").textContent="محادثتك الخاصة مع إدارة باران.";draw("bdcCustomerMessages",d.messages);}catch(e){$("bdcCustomerStatus").textContent=e.message;}}
async function sendCustomer(e){e.preventDefault();const t=$("bdcCustomerInput").value.trim();if(!t)return;if(!customerConversation){$("bdcCustomerStatus").textContent="لا توجد محادثة مفتوحة حالياً.";return;}const b=e.submitter;b.disabled=true;try{await request("POST",{}, {action:"send",conversation_id:customerConversation,message:t});$("bdcCustomerInput").value="";await loadCustomer();}catch(x){$("bdcCustomerStatus").textContent=x.message;}finally{b.disabled=false;}}
function mount(){styles();
 const list=$("baranUserDirectoryList");
 if(list&&!$("bdcAdmin")){const p=panel("bdcAdmin","💬 محادثة مباشرة مع العميل");p.classList.add("hidden");p.querySelector("form").addEventListener("submit",sendAdmin);list.parentElement.insertBefore(p,list);
  const decorate=()=>list.querySelectorAll(".customer-directory-item").forEach(c=>{if(c.querySelector(".bdc-open"))return;const id=c.dataset.customerId;if(!id)return;const b=el("button","bdc-open","💬 بدء محادثة مباشرة مع هذا العميل");b.type="button";b.onclick=()=>startAdmin(id);c.append(b);});new MutationObserver(decorate).observe(list,{childList:true,subtree:true});decorate();}
 const support=$("support");if(support&&!$("bdcCustomer")){const p=panel("bdcCustomer","💬 محادثتك المباشرة مع إدارة باران");const note=el("p","small","محادثة خاصة ومنفصلة عن تذاكر الدعم. لا ترسل كلمات المرور أو رموز التحقق أو بيانات الدفع السرية.");p.insertBefore(note,p.children[1]);p.querySelector("form").addEventListener("submit",sendCustomer);const anchor=support.querySelector(".support-notifications");(anchor||support.firstElementChild)?.insertAdjacentElement("afterend",p);}
 loadCustomer();
}
function notification(item,audience){if(item?.entity_type!=="direct_chat"||!item.entity_id)return false;if(audience==="admin"){if(typeof showSection==="function")showSection("admin",null);if(typeof showAdminPanel==="function")showAdminPanel("users");adminConversation=item.entity_id;$("bdcAdmin")?.classList.remove("hidden");loadAdmin();}else{customerConversation=item.entity_id;if(typeof showSection==="function")showSection("support",null);loadCustomer();}setTimeout(()=>$((audience==="admin"?"bdcAdmin":"bdcCustomer"))?.scrollIntoView({behavior:"smooth",block:"start"}),250);return true;}
const old=window.openBaranNotificationTarget;if(typeof old==="function")window.openBaranNotificationTarget=function(item,audience){if(notification(item,audience))return;return old.apply(this,arguments);};
window.openBaranDirectChatAdmin=startAdmin;
document.addEventListener("DOMContentLoaded",mount);if(document.readyState!=="loading")mount();
setInterval(()=>{if(document.visibilityState!=="visible")return;if(adminConversation&&!$("bdcAdmin")?.classList.contains("hidden"))loadAdmin();if($("support")&&!$("support").classList.contains("hidden"))loadCustomer();},15000);
})();