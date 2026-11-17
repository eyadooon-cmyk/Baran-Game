/* BARAN GAME — Premium Communication Center UI enhancements.
   Archived notification IDs are local to this device; delivery remains server-owned. */
(()=>{
"use strict";
const $=id=>document.getElementById(id), ARCHIVE_KEY="baran.communication.archived.v1";
const FILTERS=[["all","الكل"],["unread","غير مقروء"],["support","الدعم"],["wallet","المحفظة"],["order","الطلبات"],["offer","العروض"],["security","الأمان"]];
const archived=()=>{try{return new Set(JSON.parse(localStorage.getItem(ARCHIVE_KEY)||"[]"));}catch(_){return new Set();}};
const saveArchived=set=>{try{localStorage.setItem(ARCHIVE_KEY,JSON.stringify([...set].slice(-500)));}catch(_){}};
const classify=card=>{const c=String(card.className||"");if(c.includes("notification-tone-support"))return"support";if(c.includes("notification-tone-wallet"))return"wallet";if(c.includes("notification-tone-order"))return"order";if(c.includes("notification-tone-offer"))return"offer";if(c.includes("notification-tone-security"))return"security";return"general";};
function createToolbar(containerId,kind){
 const container=$(containerId);if(!container||container.dataset.communicationToolbar==="1")return;
 container.dataset.communicationToolbar="1";
 const toolbar=document.createElement("section");toolbar.className="baran-comm-toolbar";toolbar.setAttribute("aria-label","أدوات تصفية الإشعارات");
 const search=document.createElement("input");search.type="search";search.className="baran-comm-search";search.placeholder="ابحث بعنوان الإشعار أو محتواه...";search.setAttribute("aria-label","البحث في الإشعارات");
 const filters=document.createElement("div");filters.className="baran-comm-filters";let active="all";
 FILTERS.forEach(([value,label])=>{const b=document.createElement("button");b.type="button";b.textContent=label;b.className=value==="all"?"active":"";b.onclick=()=>{active=value;filters.querySelectorAll("button").forEach(x=>x.classList.toggle("active",x===b));apply();};filters.appendChild(b);});
 const actions=document.createElement("div");actions.className="baran-comm-actions";
 const archiveButton=document.createElement("button");archiveButton.type="button";archiveButton.textContent="إظهار المؤرشف";let showArchived=false;archiveButton.onclick=()=>{showArchived=!showArchived;archiveButton.textContent=showArchived?"إخفاء المؤرشف":"إظهار المؤرشف";apply();};
 const readAll=document.createElement("button");readAll.type="button";readAll.textContent="قراءة الكل";readAll.onclick=async()=>{if(typeof currentUser==="undefined"||!currentUser){return;}readAll.disabled=true;try{const audience=kind==="admin"?"admin":"customer";const ids=[];for(let offset=0;offset<50000;offset+=500){const {data,error}=await sb.from("baran_notifications").select("id").eq("recipient_id",currentUser.id).eq("audience",audience).is("read_at",null).order("created_at",{ascending:true}).range(offset,offset+499);if(error)throw error;ids.push(...(data||[]).map(x=>x.id));if(!data||data.length<500)break;}if(audience==="admin"){for(const id of ids){const result=await callAdminApi("POST",{action:"notification_read",notification_id:id});if(!result?.success)throw new Error("تعذر تحديث أحد التنبيهات.");}}else if(ids.length){const {error:markError}=await sb.rpc("mark_baran_notifications_read",{p_ids:ids});if(markError)throw markError;}if(audience==="admin"&&typeof loadAdminPanel==="function")await loadAdminPanel();else if(typeof loadCustomerNotifications==="function")await loadCustomerNotifications();}catch(error){alert("تعذر تحديد الكل كمقروء: "+(error.message||"حاول لاحقاً."));}finally{readAll.disabled=false;}};const clearSearch=document.createElement("button");clearSearch.type="button";clearSearch.textContent="مسح البحث";clearSearch.onclick=()=>{search.value="";apply();};actions.append(readAll,archiveButton,clearSearch);
 toolbar.append(search,filters,actions);container.parentNode.insertBefore(toolbar,container);
 function apply(){const q=search.value.trim().toLocaleLowerCase("ar"),hidden=archived();container.querySelectorAll(".notification-item").forEach(card=>{const id=card.dataset.notificationId||"",isArchived=id&&hidden.has(id),unread=card.classList.contains("unread"),category=classify(card),matchText=!q||card.textContent.toLocaleLowerCase("ar").includes(q),matchFilter=active==="all"||(active==="unread"?unread:category===active);card.hidden=(!showArchived&&!!isArchived)||(showArchived&&!isArchived)||!matchText||!matchFilter;});}
 search.addEventListener("input",apply);const observer=new MutationObserver(apply);observer.observe(container,{childList:true,subtree:true,attributes:true,attributeFilter:["class","data-notification-id"]});toolbar._apply=apply;apply();
}
function addArchiveActions(){document.querySelectorAll("#customerNotificationsList .notification-item,#adminNotifications .notification-item").forEach(card=>{if(card.querySelector(".baran-archive-action"))return;const footer=card.querySelector(".notification-item-footer"),id=card.dataset.notificationId;if(!footer||!id)return;const b=document.createElement("button");b.type="button";b.className="baran-archive-action";b.textContent=archived().has(id)?"إلغاء الأرشفة":"أرشفة";b.onclick=e=>{e.stopPropagation();const set=archived();if(set.has(id))set.delete(id);else set.add(id);saveArchived(set);b.textContent=set.has(id)?"إلغاء الأرشفة":"أرشفة";const bar=card.closest(".notification-list,.notification-box")?.previousElementSibling;bar?._apply?.();};footer.appendChild(b);});}
function addNotificationPreferences(targetId,kind){
 const target=$(targetId);if(!target||$("baranPreferences-"+kind))return;
 const details=document.createElement("details");details.id="baranPreferences-"+kind;details.className="baran-notification-preferences";
 const summary=document.createElement("summary");summary.textContent="⚙️ إعدادات الإشعارات وساعات الهدوء";
 const body=document.createElement("div");body.className="baran-preferences-body";
 const description=document.createElement("p");description.textContent="تتحكم هذه الخيارات بإشعارات الهاتف الفورية فقط؛ ستبقى التنبيهات محفوظة داخل صندوق الإشعارات.";
 body.appendChild(description);
 const options=[["support_enabled","رسائل الدعم"],["wallet_enabled","المحفظة والإيداعات"],["orders_enabled","الطلبات والشحن"],["offers_enabled","العروض والإعلانات"],["security_enabled","الأمان والحساب"]];
 const controls={};
 options.forEach(([key,label])=>{const row=document.createElement("label");row.className="baran-preference-row";const input=document.createElement("input");input.type="checkbox";input.checked=true;input.dataset.preference=key;controls[key]=input;const text=document.createElement("span");text.textContent=label;row.append(input,text);body.appendChild(row);});
 const quietRow=document.createElement("label");quietRow.className="baran-preference-row";const quiet=document.createElement("input");quiet.type="checkbox";quiet.checked=false;const quietText=document.createElement("span");quietText.textContent="تفعيل ساعات الهدوء";quietRow.append(quiet,quietText);body.appendChild(quietRow);
 const times=document.createElement("div");times.className="baran-quiet-hours";const start=document.createElement("label");start.textContent="من";const startInput=document.createElement("input");startInput.type="time";startInput.value="22:00";start.appendChild(startInput);const end=document.createElement("label");end.textContent="إلى";const endInput=document.createElement("input");endInput.type="time";endInput.value="08:00";end.appendChild(endInput);times.append(start,end);body.appendChild(times);
 const save=document.createElement("button");save.type="button";save.className="baran-preferences-save";save.textContent="حفظ الإعدادات";
 const status=document.createElement("small");status.className="baran-preferences-status";status.setAttribute("role","status");
 body.append(save,status);details.append(summary,body);target.parentNode.insertBefore(details,target);
 let loaded=false;
 async function load(){
  if(typeof currentUser==="undefined"||!currentUser?.id||typeof sb==="undefined"){status.textContent="سجّل الدخول لعرض إعداداتك.";return;}
  status.textContent="جاري تحميل الإعدادات...";
  try{const {data,error}=await sb.from("baran_notification_preferences").select("*").eq("user_id",currentUser.id).maybeSingle();if(error)throw error;
   if(data){options.forEach(([key])=>controls[key].checked=data[key]!==false);quiet.checked=!!data.quiet_hours_enabled;startInput.value=String(data.quiet_hours_start||"22:00").slice(0,5);endInput.value=String(data.quiet_hours_end||"08:00").slice(0,5);}
   loaded=true;status.textContent="";
  }catch(error){status.textContent="تعذر تحميل الإعدادات: "+(error.message||"حاول لاحقاً.");}
 }
 details.addEventListener("toggle",()=>{if(details.open&&!loaded)load();});
 save.onclick=async()=>{
  if(typeof currentUser==="undefined"||!currentUser?.id){status.textContent="سجّل الدخول أولاً.";return;}
  save.disabled=true;status.textContent="جاري الحفظ...";
  const payload={user_id:currentUser.id,...Object.fromEntries(options.map(([key])=>[key,controls[key].checked])),quiet_hours_enabled:quiet.checked,quiet_hours_start:startInput.value||"22:00",quiet_hours_end:endInput.value||"08:00",timezone:Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC",updated_at:new Date().toISOString()};
  try{const {error}=await sb.from("baran_notification_preferences").upsert(payload,{onConflict:"user_id"});if(error)throw error;loaded=true;status.textContent="تم حفظ تفضيلات الإشعارات بنجاح.";}
  catch(error){status.textContent="تعذر حفظ الإعدادات: "+(error.message||"حاول لاحقاً.");}
  finally{save.disabled=false;}
 };
}
function addQuickReplies(){const presets=[["طلب رقم الطلب","أهلاً بك 🌟 حتى نساعدك بسرعة، أرسل رقم الطلب أو رقم التذكرة من فضلك."],["قيد المراجعة","وصلتنا رسالتك، والطلب قيد المراجعة حالياً. سنحدّثك فور توفر نتيجة."],["إثبات التحويل","يرجى إرفاق صورة واضحة لإثبات التحويل مع رقم العملية، ولا ترسل أي كلمة مرور أو رمز تحقق."],["تم الحل","يسعدنا إبلاغك أن المشكلة تمت معالجتها. إذا احتجت أي مساعدة إضافية نحن بالخدمة."]];[["customerSupportConversationInput","customerSupportConversation"],["adminSupportConversationInput","adminSupportConversation"]].forEach(([inputId,boxId])=>{const input=$(inputId),box=$(boxId);if(!input||!box||box.querySelector(".baran-quick-replies"))return;const row=document.createElement("div");row.className="baran-quick-replies";row.setAttribute("aria-label","ردود سريعة");presets.forEach(([label,value])=>{const b=document.createElement("button");b.type="button";b.textContent=label;b.onclick=()=>{input.value=value;input.focus();};row.appendChild(b);});const compose=box.querySelector(".support-conversation-compose");if(compose)compose.parentNode.insertBefore(row,compose);});}
function enhance(){createToolbar("customerNotificationsList","customer");createToolbar("adminNotifications","admin");addNotificationPreferences("customerNotificationsList","customer");addNotificationPreferences("adminNotifications","admin");addArchiveActions();addQuickReplies();}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",enhance);else enhance();
new MutationObserver(enhance).observe(document.documentElement,{childList:true,subtree:true});
window.BaranCommunicationCenter={refresh:enhance,archivedCount:()=>archived().size};
})();

/* BARAN COMMUNICATION CENTER — unified admin workspace.
   Reuses existing live components; does not duplicate data flows or financial actions. */
(()=>{
"use strict";
const byId=id=>document.getElementById(id);
const ROOT_ID="baranCommunicationCenter";
const styleText=`
#baranCommunicationCenter{margin:14px 0;padding:16px;border:1px solid #70518b;border-radius:18px;background:linear-gradient(155deg,#1b1423,#100c16 72%);box-shadow:0 12px 32px #0005}
#baranCommunicationCenter .bcc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}
#baranCommunicationCenter .bcc-kicker{font-size:10px;letter-spacing:1.8px;color:#c7a9df;font-weight:900}
#baranCommunicationCenter .bcc-head h2{margin:5px 0;color:#f1e6fa;font-size:22px}
#baranCommunicationCenter .bcc-head p{margin:4px 0;color:#bbaacb;font-size:12px;line-height:1.7}
#baranCommunicationCenter .bcc-shield{flex:0 0 auto;padding:7px 10px;border:1px solid #557d67;border-radius:10px;background:#14271d;color:#bce9ca;font-size:11px;font-weight:800}
#baranCommunicationCenter .bcc-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:12px 0 16px;padding:5px;background:#0c0911;border:1px solid #443451;border-radius:14px}
#baranCommunicationCenter .bcc-tab{min-width:0;min-height:48px;padding:8px 5px;border:1px solid #4b3a59;border-radius:10px;background:#1a1421;color:#d8c6e7;font-size:12px;font-weight:800;line-height:1.4}
#baranCommunicationCenter .bcc-tab[aria-selected=true]{background:linear-gradient(135deg,#75469a,#43265d);border-color:#c49be2;color:#fff;box-shadow:0 4px 14px #0005}
#baranCommunicationCenter .bcc-pane[hidden]{display:none!important}
#baranCommunicationCenter .bcc-pane>section,#baranCommunicationCenter .bcc-pane>.support-view{margin:12px 0}
#baranCommunicationCenter .bcc-pane .announcement-panel{margin-top:14px}
#baranCommunicationCenter .bcc-report{padding:13px;margin:12px 0;border:1px solid #59436d;border-radius:13px;background:#17111f}
#baranCommunicationCenter .bcc-report h3{margin:0 0 5px;color:#e8d9f4;font-size:15px}
#baranCommunicationCenter .bcc-report p{margin:4px 0 10px;color:#bbaacb;font-size:12px;line-height:1.6}
#baranCommunicationCenter .bcc-report button{width:100%;min-height:43px}
@media(max-width:380px){#baranCommunicationCenter{padding:11px}#baranCommunicationCenter .bcc-head{display:block}#baranCommunicationCenter .bcc-shield{display:inline-block;margin-top:8px}#baranCommunicationCenter .bcc-tab{font-size:11px}}
`;
function injectStyle(){
 if(document.getElementById("baranCommunicationCenterStyles"))return;
 const style=document.createElement("style");style.id="baranCommunicationCenterStyles";style.textContent=styleText;document.head.appendChild(style);
}
function createPane(id,label,icon){
 const pane=document.createElement("section");pane.className="bcc-pane";pane.id="bcc-pane-"+id;pane.hidden=id!=="notifications";
 pane.setAttribute("aria-label",label);
 const tab=document.createElement("button");tab.type="button";tab.className="bcc-tab";tab.dataset.tab=id;
 tab.textContent=icon+" "+label;tab.setAttribute("role","tab");tab.setAttribute("aria-controls",pane.id);tab.setAttribute("aria-selected",id==="notifications"?"true":"false");
 return {pane,tab};
}
function move(el,parent){if(el&&parent)parent.appendChild(el);}
function mount(){
 const adminPanel=document.querySelector('[data-admin-panel="support"]');
 const workspace=adminPanel?.querySelector(".support-workspace");
 if(!workspace||byId(ROOT_ID))return;
 const notifications=byId("adminNotifications");
 const tickets=byId("supportTicketsView");
 const auto=byId("baranAutoSupportPanel");
 const assistant=byId("baranAdminAssistant");
 const announcement=document.querySelector(".announcement-panel");
 if(!notifications||!tickets||!auto||!assistant||!announcement)return;
 injectStyle();
 const root=document.createElement("section");root.id=ROOT_ID;
 const head=document.createElement("div");head.className="bcc-head";
 const intro=document.createElement("div");
 intro.innerHTML='<span class="bcc-kicker">BARAN GAME · UNIFIED OPERATIONS</span><h2>BARAN COMMUNICATION CENTER</h2><p>مركز موحّد لإدارة التنبيهات والرسائل ومساعد BARAN والإعلانات، مع إبقاء الصلاحيات المالية منفصلة.</p>';
 const shield=document.createElement("span");shield.className="bcc-shield";shield.textContent="🔒 لا صلاحيات مالية للمساعد";
 head.append(intro,shield);
 const tabs=document.createElement("div");tabs.className="bcc-tabs";tabs.setAttribute("role","tablist");tabs.setAttribute("aria-label","أقسام مركز التواصل");
 const notificationsPane=createPane("notifications","الإشعارات","🔔");
 const messagesPane=createPane("messages","الرسائل والتذاكر","💬");
 const assistantPane=createPane("assistant","مساعد BARAN","🤖");
 [notificationsPane,messagesPane,assistantPane].forEach(x=>{tabs.appendChild(x.tab);root.appendChild(x.pane);});
 root.insertBefore(head,root.firstChild);root.insertBefore(tabs,root.children[1]);
 const notificationContent=document.createElement("div");notificationContent.className="bcc-notification-content";
 let sibling=notifications.previousElementSibling;
 const preferences=sibling?.id==="baranPreferences-admin"?sibling:null;
 if(preferences)sibling=preferences.previousElementSibling;
 const toolbar=sibling?.classList.contains("baran-comm-toolbar")?sibling:null;
 move(toolbar,notificationContent);move(preferences,notificationContent);move(notifications,notificationContent);
 move(announcement,notificationContent);
 notificationsPane.pane.appendChild(notificationContent);
 tickets.classList.remove("hidden");tickets.hidden=false;
 messagesPane.pane.appendChild(tickets);
 move(auto,assistantPane.pane);move(assistant,assistantPane.pane);
 const report=document.createElement("section");report.className="bcc-report";report.innerHTML='<h3>📊 تقارير التواصل</h3><p>استخدم بيانات التذاكر والردود والتنبيهات المسجلة لإعداد تقرير إداري، مع توضيح الفترة وأي نقص في البيانات.</p>';
 const reportButton=document.createElement("button");reportButton.type="button";reportButton.className="secondary";reportButton.textContent="إنشاء تقرير التواصل";
 reportButton.addEventListener("click",()=>{
   const prompt="أنشئ تقريراً إدارياً عن التواصل وخدمة العملاء للفترة المتاحة: عدد التذاكر المفتوحة والمغلقة، الأولويات، الردود الآلية، الحالات المحوّلة للإدارة، أكثر أسباب التواصل تكراراً، والتنبيهات والإعلانات. افصل الأرقام المؤكدة عن أي نقص في البيانات، ولا تنفذ أي إجراء أو تغيير.";
   if(typeof window.askBaranAdminPrompt==="function")window.askBaranAdminPrompt(prompt);
   else if(typeof window.askBaranAdminAssistant==="function")window.askBaranAdminAssistant(prompt);
   else {assistantPane.pane.scrollIntoView({behavior:"smooth",block:"start"});const input=byId("baranAdminAssistantInput");if(input){input.value=prompt;input.focus();}}
 });
 report.appendChild(reportButton);assistantPane.pane.insertBefore(report,assistantPane.pane.firstChild);
 const legacyTabs=workspace.querySelector(".support-tabs");if(legacyTabs)legacyTabs.remove();
 const autoView=byId("supportAutoView");if(autoView)autoView.remove();
 workspace.prepend(root);
 function activate(id){
  [notificationsPane,messagesPane,assistantPane].forEach(item=>{
   const active=item===({notifications:notificationsPane,messages:messagesPane,assistant:assistantPane}[id]);
   item.pane.hidden=!active;item.tab.setAttribute("aria-selected",active?"true":"false");
  });
  if(id==="assistant"&&typeof window.loadAdminPanel==="function"){
   // Refresh remains an explicit action inside the assistant queue.
  }
 }
 [notificationsPane,messagesPane,assistantPane].forEach(item=>item.tab.addEventListener("click",()=>activate(item.tab.dataset.tab)));
 root.dataset.ready="1";
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount,{once:true});else mount();
new MutationObserver(()=>{if(!byId(ROOT_ID))mount();}).observe(document.documentElement,{childList:true,subtree:true});
window.BaranCommunicationCenter=Object.assign(window.BaranCommunicationCenter||{},{
 mountAdmin:mount,
 openAdminSection(id){const root=byId(ROOT_ID);if(!root)return false;const tab=root.querySelector('[data-tab="'+id+'"]');if(tab){tab.click();root.scrollIntoView({behavior:"smooth",block:"start"});return true;}return false;}
});
})();
