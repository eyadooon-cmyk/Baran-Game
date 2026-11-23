(function(){
"use strict";
const endpoint="https://yabpmdzsiuyxxkcqakfs.supabase.co/functions/v1/baran-visitor-analytics";
const $=id=>document.getElementById(id);
function node(tag,cls,txt){const n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=txt;return n;}
function metric(label,value){const box=node("div","finance-card");box.append(node("span","small",label),node("strong","",Number(value||0).toLocaleString("ar")));return box;}
function list(title,rows){const box=node("section","finance-section");box.append(node("h3","",title));if(!rows?.length){box.append(node("p","small","لا توجد بيانات كافية بعد."));return box;}rows.forEach(r=>{const line=node("div","finance-entry");line.style.display="flex";line.style.justifyContent="space-between";line.style.gap="10px";line.append(node("span","",r.label),node("strong","",Number(r.count||0).toLocaleString("ar")));box.append(line);});return box;}
window.loadBaranVisitorAnalytics=async function(){
 const root=$("baranVisitorAnalyticsMount");if(!root)return;
 root.replaceChildren(node("p","small","جاري تحميل إحصائيات الزيارات..."));
 try{
  const sb=window.baranSupabaseClient;
  const {data,error}=await sb.auth.getSession();if(error||!data?.session)throw new Error("انتهت جلسة الإدارة.");
  const response=await fetch(endpoint,{method:"POST",headers:{"Authorization":"Bearer "+data.session.access_token,"apikey":sb.supabaseKey,"Content-Type":"application/json"},body:JSON.stringify({action:"stats"})});
  const out=await response.json().catch(()=>({}));if(!response.ok)throw new Error(out.error||"تعذر تحميل الإحصائيات.");
  root.replaceChildren();
  const note=node("p","small","البيانات تبدأ من تفعيل هذا النظام، ولا تشمل الزيارات السابقة. الزائر الفريد تقديري حسب جلسة المتصفح، وليس شخصاً معروف الهوية.");
  root.append(note);
  const grid=node("div","finance-grid");
  grid.append(metric("مشاهدات اليوم",out.page_views_today),metric("زوار اليوم التقريبيون",out.unique_visitors_today),metric("مشاهدات آخر 7 أيام",out.page_views_7d),metric("زوار آخر 7 أيام",out.unique_visitors_7d),metric("مشاهدات آخر 30 يوماً",out.page_views_30d),metric("زوار آخر 30 يوماً",out.unique_visitors_30d));
  root.append(grid);
  const daily=node("section","finance-section");daily.append(node("h3","","حركة الزيارات — آخر 7 أيام"));
  const bars=node("div","ops-grid");
  (out.daily||[]).forEach(d=>{const b=node("div","ops-card");b.append(node("small","",d.day),node("strong","",Number(d.views||0).toLocaleString("ar")+" زيارة"));bars.append(b);});
  daily.append(bars);root.append(daily);
  root.append(list("الأجهزة",out.devices),list("البلدان (عند توفرها)",out.countries),list("الصفحات الأكثر زيارة",out.pages));
  if(out.capped)root.append(node("p","small","تنبيه: وصلنا إلى حد القراءة الحالي؛ قد تكون الأرقام الفعلية أعلى."));
  root.append(node("p","small","لا يتم حفظ عنوان IP أو البريد أو الاسم. لا يتوفر عدّاد «الموجودين الآن» في هذه النسخة."));
 }catch(error){root.replaceChildren(node("p","small",error.message||"تعذر تحميل البيانات."));}
};
})();