(function(){
"use strict";
const $=id=>document.getElementById(id);
const endpoint="https://yabpmdzsiuyxxkcqakfs.supabase.co/functions/v1/baran-direct-chat";
let adminMode=false, currentConversation=null, currentCustomer=null, customers=[], conversations=[], poll=null, view="list";
const el=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=txt;return n;};
async function api(method="GET",params={},body){
 const {data:{session},error}=await sb.auth.getSession();if(error||!session)throw new Error("انتهت الجلسة، سجّل الدخول مجدداً.");
 const u=new URL(endpoint);Object.entries(params).forEach(([k,v])=>v&&u.searchParams.set(k,v));
 const r=await fetch(u,{method,headers:{Authorization:"Bearer "+session.access_token,apikey:SUPABASE_KEY,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||"تعذر تنفيذ الطلب.");return d;
}
function styles(){if($("baranChatPageStyles"))return;const s=el("style");s.id="baranChatPageStyles";s.textContent=`
#baranChatApp{position:fixed;inset:0;z-index:100500;background:#100c15;color:#f6effb;display:none;direction:rtl;font-family:inherit}
#baranChatApp.open{display:flex;flex-direction:column}
#baranChatApp *{box-sizing:border-box}
.bcp-top{height:64px;flex:0 0 64px;display:flex;align-items:center;gap:12px;padding:0 18px;background:#1b1422;border-bottom:1px solid #493456}
.bcp-brand{font-weight:900;letter-spacing:.5px;color:#e8d1f7}.bcp-subtitle{font-size:11px;color:#bca9c9;margin-right:auto}
.bcp-close,.bcp-back{border:1px solid #60476e;background:#2a1d34;color:#f4e9fa;border-radius:10px;padding:9px 12px;cursor:pointer}
.bcp-layout{display:grid;grid-template-columns:minmax(280px,350px) minmax(0,1fr);flex:1;min-height:0;max-width:1250px;width:100%;margin:0 auto;padding:14px;gap:12px}
.bcp-sidebar,.bcp-main{min-height:0;border:1px solid #493456;border-radius:16px;background:#191320;overflow:hidden}
.bcp-sidebar{display:flex;flex-direction:column}.bcp-side-head{padding:16px;border-bottom:1px solid #3b2b45}
.bcp-side-head h3{margin:0 0 10px;font-size:17px}.bcp-search{width:100%;border:1px solid #574265!important;background:#100c15!important;color:#fff!important;border-radius:11px!important;padding:11px!important}
.bcp-list{overflow:auto;flex:1}.bcp-person{display:flex;width:100%;align-items:center;gap:11px;padding:13px 14px;text-align:right;background:transparent;border:0;border-bottom:1px solid #30243a;color:#f6effb;cursor:pointer}
.bcp-person.active,.bcp-person:hover{background:#30213b}.bcp-avatar{width:43px;height:43px;flex:0 0 43px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(140deg,#8656a5,#39234b);font-weight:900;font-size:17px}
.bcp-person-info{min-width:0;flex:1}.bcp-person-name{font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bcp-person-last{font-size:11px;color:#bdaec8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:4px}.bcp-empty{padding:22px;text-align:center;color:#bbaac6;font-size:13px}
.bcp-main{display:flex;flex-direction:column;position:relative}.bcp-chat-head{display:flex;align-items:center;gap:11px;padding:13px 16px;border-bottom:1px solid #3b2b45;background:#201729;min-height:72px}
.bcp-chat-title{font-weight:900}.bcp-chat-hint{font-size:11px;color:#bbaac6;margin-top:3px}.bcp-back{display:none}
.bcp-thread{flex:1;min-height:0;overflow:auto;padding:18px;display:flex;flex-direction:column;gap:10px;background-color:#120e17;background-image:radial-gradient(#74548813 1px,transparent 1px);background-size:18px 18px}
.bcp-bubble{max-width:min(78%,560px);padding:10px 13px;border-radius:15px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.65;font-size:13px;box-shadow:0 3px 10px #0003}
.bcp-bubble.mine{align-self:flex-start;background:#54366a;border:1px solid #79538e;color:white;border-top-left-radius:4px}
.bcp-bubble.theirs{align-self:flex-end;background:#29212f;border:1px solid #4a3b54;color:#f4eefa;border-top-right-radius:4px}
.bcp-meta{display:block;font-size:10px;opacity:.65;margin-top:5px}
.bcp-compose{display:flex;align-items:flex-end;gap:9px;padding:12px;border-top:1px solid #3b2b45;background:#201729}
.bcp-compose textarea{flex:1;min-width:0;max-height:110px;min-height:45px;resize:vertical;border:1px solid #5c456b!important;background:#100c15!important;color:#fff!important;border-radius:13px!important;padding:11px!important;margin:0!important}
.bcp-send{border:0;border-radius:12px;background:linear-gradient(130deg,#9059b1,#57326e);color:#fff;font-weight:800;padding:0 19px;height:45px;cursor:pointer}.bcp-send:disabled{opacity:.5}
.bcp-welcome{margin:auto;text-align:center;padding:30px;color:#c4b3ce}.bcp-welcome b{display:block;color:#ead8f4;font-size:19px;margin-bottom:8px}
.bcp-status{font-size:11px;color:#c4b3ce;padding:5px 15px;background:#191320}
.bcp-open{width:100%;margin-top:10px;padding:10px 13px;border-radius:11px;border:1px solid #8b62a2;background:linear-gradient(110deg,#694080,#382449);color:#fff;font-weight:800;cursor:pointer}.bcp-support-launch{width:100%;margin:12px 0;padding:13px;border-radius:13px;border:1px solid #8b62a2;background:linear-gradient(110deg,#57376b,#30203d);color:#fff;font-weight:800;cursor:pointer}
@media(max-width:680px){
 .bcp-top{height:56px;flex-basis:56px;padding:0 10px}.bcp-subtitle{display:none}
 .bcp-layout{display:block;padding:8px;min-height:0}
 .bcp-sidebar,.bcp-main{height:100%;border-radius:13px}
 #baranChatApp:not(.mobile-thread) .bcp-main{display:none}
 #baranChatApp.mobile-thread .bcp-sidebar{display:none}
 #baranChatApp.mobile-thread .bcp-main{display:flex}
 .bcp-back{display:inline-block}.bcp-chat-head{min-height:64px;padding:10px}
 .bcp-thread{padding:12px}.bcp-bubble{max-width:88%}.bcp-compose{padding:9px}.bcp-send{padding:0 14px}
}
`;document.head.append(s);}
function ensureApp(){if($("baranChatApp"))return;const app=el("div");app.id="baranChatApp";
 const top=el("header","bcp-top");top.append(el("strong","bcp-brand","BARAN GAME"),el("span","bcp-subtitle","محادثات خاصة وآمنة"),Object.assign(el("button","bcp-close","إغلاق ✕"),{type:"button",onclick:closePage}));
 const layout=el("div","bcp-layout"),side=el("aside","bcp-sidebar"),sh=el("div","bcp-side-head"),heading=el("h3","","💬 المحادثات"),search=el("input","bcp-search");search.id="bcpSearch";search.placeholder="ابحث عن مستخدم...";search.addEventListener("input",renderList);const list=el("div","bcp-list");list.id="bcpList";sh.append(heading,search);side.append(sh,list);
 const main=el("main","bcp-main"),chatHead=el("div","bcp-chat-head"),back=el("button","bcp-back","← المحادثات");back.type="button";back.onclick=()=>setView("list");const avatar=el("div","bcp-avatar","B");avatar.id="bcpAvatar";const titleWrap=el("div"),title=el("div","bcp-chat-title","اختر محادثة");title.id="bcpTitle";const hint=el("div","bcp-chat-hint","رسائلك مع إدارة باران");hint.id="bcpHint";titleWrap.append(title,hint);chatHead.append(back,avatar,titleWrap);
 const thread=el("div","bcp-thread");thread.id="bcpThread";const status=el("div","bcp-status","");status.id="bcpStatus";const form=el("form","bcp-compose"),ta=el("textarea");ta.id="bcpInput";ta.rows=1;ta.maxLength=2000;ta.placeholder="اكتب رسالة...";ta.required=true;const send=el("button","bcp-send","إرسال");send.type="submit";form.append(ta,send);form.addEventListener("submit",sendMessage);main.append(chatHead,thread,status,form);layout.append(side,main);app.append(top,layout);document.body.append(app);}
function setView(v){view=v;const app=$("baranChatApp");app.classList.toggle("mobile-thread",v==="thread");}
function openPage(isAdmin){ensureApp();adminMode=!!isAdmin;const app=$("baranChatApp");app.classList.add("open");app.classList.toggle("admin-view",adminMode);app.dataset.view=adminMode?"admin":"customer";currentConversation=null;currentCustomer=null;setView("list");
 $("bcpSearch").placeholder=adminMode?"ابحث باسم العميل أو رقمه...":"محادثة إدارة باران";
 $("bcpSearch").style.display=adminMode?"block":"none";
 $("bcpTitle").textContent=adminMode?"اختر عميلاً":"إدارة باران";$("bcpHint").textContent=adminMode?"ابدأ محادثة مباشرة مع أي عميل":"محادثتك الخاصة مع فريق الإدارة";$("bcpAvatar").textContent=adminMode?"👥":"B";
 $("bcpThread").replaceChildren();const welcome=el("div","bcp-welcome");welcome.append(el("b","",adminMode?"مركز محادثات العملاء":"مرحباً بك في محادثات باران"),el("span","",adminMode?"اختر عميلاً من القائمة لفتح المحادثة":"ستظهر رسائل الإدارة هنا عند بدء المحادثة"));$("bcpThread").append(welcome);
 $("bcpInput").disabled=!adminMode;$("bcpInput").placeholder=adminMode?"اكتب رسالة...":"لا توجد محادثة مفتوحة بعد";$("bcpStatus").textContent="";
 if(adminMode)loadAdminList();else loadCustomerThread();
}
function renderList(){const list=$("bcpList");if(!list)return;list.replaceChildren();const q=($("bcpSearch")?.value||"").trim().toLowerCase();
 const rows=adminMode?customers.filter(c=>[c.full_name,c.phone,c.member_code,c.email].some(x=>(x||"").toLowerCase().includes(q))):[];
 if(!adminMode){list.append(el("div","bcp-empty","هذه مساحة محادثتك المباشرة مع إدارة باران."));return;}
 if(!rows.length){list.append(el("div","bcp-empty",q?"ما لقينا مستخدم مطابق.":"ما في مستخدمين لعرضهم."));return;}
 rows.forEach(c=>{const conv=c.conversation;const b=el("button","bcp-person"+(currentCustomer?.id===c.id?" active":"" ));b.type="button";const av=el("div","bcp-avatar",(c.full_name||c.member_code||"B").trim().slice(0,1).toUpperCase());const info=el("div","bcp-person-info"),name=el("div","bcp-person-name",c.full_name||c.member_code||c.phone||"مستخدم باران"),last=el("div","bcp-person-last",conv?.last_message||c.phone||c.email||"اضغط لبدء محادثة");info.append(name,last);b.append(av,info);b.onclick=()=>startConversation(c);list.append(b);});
}
async function loadAdminList(){try{const d=await api("GET",{action:"customers"});customers=d.customers||[];const cv=await api("GET");conversations=cv.conversations||[];const map=new Map(conversations.map(x=>[x.customer_id,x]));customers=customers.map(c=>({...c,conversation:c.conversation||map.get(c.id)||null}));renderList();$("bcpStatus").textContent="";}catch(e){$("bcpStatus").textContent=e.message;}}
async function startConversation(c){currentCustomer=c;renderList();$("bcpTitle").textContent=c.full_name||c.member_code||"عميل باران";$("bcpHint").textContent=[c.member_code,c.phone].filter(Boolean).join(" · ")||"محادثة مباشرة";$("bcpAvatar").textContent=(c.full_name||"B").slice(0,1);setView("thread");$("bcpInput").disabled=false;
 try{const d=await api("POST",{}, {action:"start",customer_id:c.id});currentConversation=d.conversation.id;await loadThread();}catch(e){$("bcpStatus").textContent=e.message;}}
async function loadThread(){if(!currentConversation)return;try{const d=await api("GET",{conversation_id:currentConversation});drawMessages(d.messages||[]);$("bcpStatus").textContent="متصل بالمحادثة";}catch(e){$("bcpStatus").textContent=e.message;}}
async function loadCustomerThread(){try{const d=await api("GET");if(!d.conversation){currentConversation=null;$("bcpThread").replaceChildren();const w=el("div","bcp-welcome");w.append(el("b","","لا توجد محادثة بعد"),el("span","","عندما تبدأ الإدارة محادثة معك ستصلك رسالة إشعار وتظهر هنا."));$("bcpThread").append(w);$("bcpInput").disabled=true;$("bcpStatus").textContent="";setView("thread");return;}currentConversation=d.conversation.id;currentCustomer={full_name:"إدارة باران"};$("bcpInput").disabled=false;drawMessages(d.messages||[]);$("bcpStatus").textContent="محادثة خاصة مع إدارة باران";setView("thread");}catch(e){$("bcpStatus").textContent=e.message;}}
function drawMessages(rows){const box=$("bcpThread");if(!box)return;const bottom=box.scrollHeight-box.scrollTop-box.clientHeight<100;box.replaceChildren();rows.forEach(m=>{const mine=adminMode?m.sender_role==="admin":m.sender_role==="customer";const b=el("div","bcp-bubble "+(mine?"mine":"theirs"));b.append(document.createTextNode(m.message));b.append(el("small","bcp-meta",(mine?"أنت":"إدارة باران")+" · "+new Date(m.created_at).toLocaleString("ar")));box.append(b);});if(bottom)box.scrollTop=box.scrollHeight;}
async function sendMessage(e){e.preventDefault();const input=$("bcpInput"),message=input.value.trim();if(!message||!currentConversation)return;const btn=e.submitter;btn.disabled=true;try{await api("POST",{}, {action:"send",conversation_id:currentConversation,message});input.value="";await (adminMode?loadThread():loadCustomerThread());}catch(x){$("bcpStatus").textContent=x.message;}finally{btn.disabled=false;}}
function closePage(){$("baranChatApp")?.classList.remove("open","mobile-thread");}
async function launchAdmin(id){openPage(true);if(id){try{const d=await api("GET",{action:"customers"});customers=d.customers||[];renderList();const detail=await api("GET",{conversation_id:id});const c=customers.find(x=>x.id===detail.conversation?.customer_id);if(c)await startConversation(c);else $("bcpStatus").textContent="تعذر العثور على حساب العميل.";}catch(e){$("bcpStatus").textContent=e.message;}}}
function notification(item,audience){if(item?.entity_type!=="direct_chat"||!item.entity_id)return false;if(audience==="admin"){if(typeof showSection==="function")showSection("admin",null);if(typeof showAdminPanel==="function")showAdminPanel("user-directory");launchAdmin(item.entity_id);}else{if(typeof showSection==="function")showSection("support",null);openPage(false);}if(typeof markCustomerNotificationRead==="function")markCustomerNotificationRead(item.id,null,audience);return true;}
function mount(){styles();ensureApp();
 ["baranUserDirectoryList","opsCustomers"].forEach(listId=>{const list=$(listId);if(!list||list.dataset.chatPageBound)return;list.dataset.chatPageBound="1";const decorate=()=>list.querySelectorAll(".customer-directory-item[data-customer-id]").forEach(card=>{if(card.querySelector(".bcp-open"))return;const id=card.dataset.customerId;if(!id)return;const b=el("button","bcp-open","💬 مراسلة مباشرة");b.type="button";b.onclick=()=>launchAdminForCustomer(id);card.append(b);});new MutationObserver(decorate).observe(list,{childList:true,subtree:true});decorate();});
 const support=$("support");if(support&&!$("bdcLaunchCustomer")){const b=el("button","bcp-support-launch","💬 افتح محادثتك المباشرة مع إدارة باران");b.id="bdcLaunchCustomer";b.type="button";b.onclick=()=>openPage(false);const anchor=support.querySelector(".support-notifications");(anchor||support.firstElementChild)?.insertAdjacentElement("afterend",b);}
}
async function launchAdminForCustomer(id){openPage(true);try{const d=await api("GET",{action:"customers"});customers=d.customers||[];renderList();const c=customers.find(x=>x.id===id);if(c)await startConversation(c);else $("bcpStatus").textContent="تعذر العثور على حساب العميل.";}catch(e){$("bcpStatus").textContent=e.message;}}
const old=window.openBaranNotificationTarget;window.openBaranNotificationTarget=function(item,audience){if(notification(item,audience))return;if(typeof old==="function")return old.apply(this,arguments);if(typeof showSection==="function")showSection(audience==="admin"?"admin":"support",null);};
window.openBaranDirectChatAdmin=launchAdminForCustomer;window.openBaranDirectChatCustomer=()=>openPage(false);
document.addEventListener("DOMContentLoaded",mount);if(document.readyState!=="loading")mount();
if(poll)clearInterval(poll);poll=setInterval(()=>{if(document.visibilityState!=="visible"||!$("baranChatApp")?.classList.contains("open"))return;if(adminMode&&currentConversation)loadThread();else if(adminMode)loadAdminList();else loadCustomerThread();},8000);
})();