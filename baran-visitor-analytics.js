(function(){
"use strict";
const endpoint="https://yabpmdzsiuyxxkcqakfs.supabase.co/functions/v1/baran-visitor-analytics";
const OPT_OUT_KEY="baranVisitorAnalyticsOptOut";
function sessionId(){
 try{
  let id=sessionStorage.getItem("baranVisitorSession");
  if(!id){id=crypto.randomUUID();sessionStorage.setItem("baranVisitorSession",id);}
  return id;
 }catch(_){return null;}
}
function isOptedOut(){
 try{
  const mode=new URLSearchParams(location.search).get("baran_analytics");
  if(mode==="off")sessionStorage.setItem(OPT_OUT_KEY,"1");
  if(mode==="on")sessionStorage.removeItem(OPT_OUT_KEY);
  return sessionStorage.getItem(OPT_OUT_KEY)==="1";
 }catch(_){return false;}
}
async function track(){
 const sb=window.baranSupabaseClient,id=sessionId();
 if(!sb||!id||!navigator.onLine||isOptedOut())return;
 try{
  const headers={"Content-Type":"application/json","apikey":sb.supabaseKey};
  const {data}=await sb.auth.getSession();
  if(data?.session?.access_token)headers.Authorization="Bearer "+data.session.access_token;
  await fetch(endpoint,{method:"POST",headers,body:JSON.stringify({action:"track",session_id:id,page_path:location.pathname}),keepalive:true,cache:"no-store"});
 }catch(_){}
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",track,{once:true});else track();
})();