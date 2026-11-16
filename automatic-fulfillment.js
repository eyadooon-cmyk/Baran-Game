"use strict";
let baranAutomaticEnabled=false;
function baranAutomaticControlUrl(){return SUPABASE_URL+"/functions/v1/baran-automatic-fulfillment-control";}
async function callBaranAutomaticControl(method="GET",body=null){
 const {data:{session},error}=await sb.auth.getSession();
 if(error||!session)throw new Error("انتهت الجلسة. سجّل الدخول مجدداً.");
 const response=await fetch(baranAutomaticControlUrl(),{
  method,headers:{"Authorization":"Bearer "+session.access_token,"apikey":SUPABASE_KEY,"Content-Type":"application/json"},
  body:body?JSON.stringify(body):undefined
 });
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(data.error||"تعذر قراءة إعداد الشحن الآلي.");
 return data;
}
function renderBaranAutomaticControl(data){
 const button=document.getElementById("baranAutomaticToggle");
 const status=document.getElementById("baranAutomaticStatus");
 if(button){button.textContent=baranAutomaticEnabled?"إيقاف مفتاح الشحن الآلي":"فتح مفتاح الشحن الآلي";button.classList.toggle("secondary",baranAutomaticEnabled);button.setAttribute("aria-pressed",String(baranAutomaticEnabled));}
 if(status){
  status.textContent=(baranAutomaticEnabled
   ?"المفتاح الإداري مفتوح."
   :"المفتاح الإداري مغلق.")
   +" "+(data?.note||"الشحن الفعلي لا يزال مغلقاً حتى اكتمال موصل المورد واختباره.");
 }
}
async function loadBaranAutomaticControl(){
 const button=document.getElementById("baranAutomaticToggle");
 const status=document.getElementById("baranAutomaticStatus");
 if(!button||!status||!currentUser)return;
 button.disabled=true;status.textContent="جاري قراءة حالة الشحن الآلي...";
 try{const data=await callBaranAutomaticControl("GET");baranAutomaticEnabled=data.automatic_enabled===true;renderBaranAutomaticControl(data);}
 catch(e){status.textContent=e.message;}
 finally{button.disabled=false;}
}
async function toggleBaranAutomaticEnabled(){
 const button=document.getElementById("baranAutomaticToggle");
 if(!button)return;
 const next=!baranAutomaticEnabled;
 if(!confirm(next
  ?"فتح المفتاح الإداري لمسار المورد الآلي؟ لن يبدأ الشحن الفعلي بهذا الإجراء."
  :"إيقاف المفتاح الإداري لمسار المورد الآلي؟"))return;
 button.disabled=true;
 try{
  const data=await callBaranAutomaticControl("POST",{action:"set_enabled",enabled:next});
  baranAutomaticEnabled=data.automatic_enabled===true;renderBaranAutomaticControl(data);
 }catch(e){const status=document.getElementById("baranAutomaticStatus");if(status)status.textContent=e.message;}
 finally{button.disabled=false;}
}