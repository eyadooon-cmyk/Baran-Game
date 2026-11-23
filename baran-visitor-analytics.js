(function(){
"use strict";
const endpoint="https://yabpmdzsiuyxxkcqakfs.supabase.co/functions/v1/baran-visitor-analytics";
function sessionId(){
 try{
  let id=sessionStorage.getItem("baranVisitorSession");
  if(!id){id=crypto.randomUUID();sessionStorage.setItem("baranVisitorSession",id);}
  return id;
 }catch(_){return null;}
}
async function track(){
 const sb=window.baranSupabaseClient,id=sessionId();
 if(!sb||!id||!navigator.onLine)return;
 try{
  await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","apikey":sb.supabaseKey},body:JSON.stringify({action:"track",session_id:id,page_path:location.pathname}),keepalive:true});
 }catch(_){}
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",track,{once:true});else track();
})();