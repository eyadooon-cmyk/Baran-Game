"use strict";
(function(){
 const $=id=>document.getElementById(id);
 const messages=[];
 let sending=false;
 const endpoint=()=>SUPABASE_URL+"/functions/v1/baro-ai";
 function bubble(text,role){
  const box=$("baroAiMessages");if(!box)return;
  const el=document.createElement("div");el.className="baro-ai-bubble "+role;el.textContent=String(text||"");box.append(el);box.scrollTop=box.scrollHeight;
 }
 async function send(event){
  if(event)event.preventDefault();
  if(sending)return;
  const input=$("baroAiInput"),button=$("baroAiSend"),status=$("baroAiStatus");
  const text=(input?.value||"").trim();if(!text)return;
  if(!window.currentUser && !currentUser){bubble("سجّل الدخول أولاً لاستخدام BARO NAVI.","error");return;}
  if(!navigator.onLine){status.textContent="تحقق من اتصال الإنترنت وحاول مجدداً.";return;}
  messages.push({role:"user",content:text});bubble(text,"user");input.value="";
  sending=true;button.disabled=true;status.textContent="BARO NAVI عم يجهّز الرد...";
  try{
   const {data:{session},error}=await sb.auth.getSession();
   if(error||!session?.access_token)throw new Error("انتهت الجلسة. سجّل الدخول مجدداً.");
   const response=await fetch(endpoint(),{method:"POST",headers:{"Authorization":"Bearer "+session.access_token,"apikey":SUPABASE_KEY,"Content-Type":"application/json"},body:JSON.stringify({messages:messages.slice(-10)})});
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(data.error||"تعذر الاتصال بـ BARO NAVI.");
   if(typeof data.reply!=="string"||!data.reply.trim())throw new Error("وصل رد غير مكتمل من المساعد.");
   messages.push({role:"assistant",content:data.reply});if(messages.length>10)messages.splice(0,messages.length-10);bubble(data.reply,"bot");status.textContent=data.order_intake_enabled?"":"استقبال الطلبات اليدوية مغلق حالياً؛ BARO NAVI للاستفسارات فقط." ;
  }catch(error){
   messages.pop();bubble(error?.message||"صار خطأ مؤقت. حاول مجدداً.","error");status.textContent="ما انرسل السؤال بنجاح.";
  }finally{sending=false;button.disabled=false;input?.focus();}
 }
 document.addEventListener("DOMContentLoaded",()=>{
  $("baroAiForm")?.addEventListener("submit",send);
 });
 window.sendBaroAiMessage=send;
})();