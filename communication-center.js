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