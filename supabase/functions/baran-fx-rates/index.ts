import { createClient } from "npm:@supabase/supabase-js@2";
const URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const OLD_FACTOR = 100;
const MAX_AGE = 24 * 60 * 60 * 1000;
const CRON_MIN_GAP = 15 * 60 * 1000;
const MANUAL_MIN_GAP = 6 * 60 * 60 * 1000;
const ORIGINS = new Set(["https://baran-game.pages.dev","https://eyadooon-cmyk.github.io"]);
const headers = (origin: string | null) => ({
 "Access-Control-Allow-Origin": origin && ORIGINS.has(origin) ? origin : "https://eyadooon-cmyk.github.io",
 "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-cron-secret",
 "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Vary": "Origin",
 "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store"
});
const out = (data: unknown, status=200, origin: string|null=null) =>
 new Response(JSON.stringify(data),{status,headers:headers(origin)});
const num = (v: unknown) => { const n=Number(v); return Number.isFinite(n)&&n>0?n:null; };
const date = (v: unknown) => { if(typeof v!=="string")return null; const d=new Date(v); return Number.isFinite(d.getTime())?d.toISOString():null; };
async function json(url:string) {
 const r=await fetch(url,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(10000)});
 const raw=await r.text(); let data:any;
 try{data=raw?JSON.parse(raw):{};}catch{throw new Error("استجابة مصدر الصرف غير مفهومة.");}
 if(!r.ok)throw new Error("مصدر الصرف HTTP "+r.status);
 return data;
}
function normalized(provider:string,buy:number,sell:number,updated:string) {
 return {provider,city:"damascus",currency:"USD",buy_new:buy,sell_new:sell,
  buy_old:buy*OLD_FACTOR,sell_old:sell*OLD_FACTOR,source_updated_at:updated};
}
async function liraty() {
 const p=await json("https://liraty.com/api/v1/latest?city=damascus");
 if(p.unit!=="new"||Number(p.redenomination_factor)!==100)throw new Error("وحدة Liraty غير مؤكدة.");
 const x=(p.rates||[]).find((v:any)=>String(v.code).toUpperCase()==="USD");
 const b=num(x?.buy),s=num(x?.sell),t=date(p.updated_at);
 if(!b||!s||!t||Date.now()-new Date(t).getTime()>MAX_AGE||Date.now()-new Date(t).getTime() < -5*60*1000)throw new Error("بيانات Liraty ناقصة أو قديمة.");
 return normalized("Liraty",b,s,t);
}
async function lirascope() {
 const p=await json("https://lirascope.syria-cloud.sy/api/v1/rates/latest?currencies=USD&lang=ar");
 const x=(p.marketRates||[]).find((v:any)=>String(v.currency).toUpperCase()==="USD");
 const b=num(x?.buy),s=num(x?.sell),t=date(x?.timestampUtc??p.timestampUtc);
 if(!b||!s||!t||Date.now()-new Date(t).getTime()>MAX_AGE||Date.now()-new Date(t).getTime() < -5*60*1000)throw new Error("بيانات LiraScope ناقصة أو قديمة.");
 return normalized("LiraScope",b,s,t);
}
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("Origin");
 if(req.method==="OPTIONS"){if(origin&&!ORIGINS.has(origin))return new Response("Forbidden",{status:403});return new Response("ok",{headers:headers(origin)});}
 if(origin&&!ORIGINS.has(origin))return out({error:"Origin not allowed"},403,origin);
 if(!["GET","POST"].includes(req.method))return out({error:"Method not allowed"},405,origin);
 if(!URL||!SERVICE||!ANON)return out({error:"Server configuration incomplete"},500,origin);
 try{
  const admin=createClient(URL,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});
  let cron=false;const secret=req.headers.get("x-cron-secret")||"";
  if(secret){const {data,error}=await admin.rpc("baran_verify_fx_cron_secret",{p_secret:secret});if(error||data!==true)return out({error:"Authentication required"},401,origin);cron=true;}
  else{
   const auth=req.headers.get("Authorization")||"",token=auth.startsWith("Bearer ")?auth.slice(7):"";
   if(!token)return out({error:"Authentication required"},401,origin);
   const userClient=createClient(URL,ANON,{auth:{persistSession:false,autoRefreshToken:false}});
   const {data,error}=await userClient.auth.getUser(token);
   if(error||!data.user)return out({error:"Invalid session"},401,origin);
   const {data:ok,error:adminError}=await admin.rpc("admin_is_user",{p_user_id:data.user.id});
   if(adminError||ok!==true)return out({error:"Administrator access required"},403,origin);
  }
  let body:any={};if(req.method==="POST"){try{body=await req.json();}catch{return out({error:"Invalid JSON"},400,origin);}}
  const action=body.action||"get";
  const {data:state,error:stateError}=await admin.from("fx_rate_state").select("*").eq("id","main").single();
  if(stateError||!state)return out({error:"FX monitor is not installed."},503,origin);
  if(action==="get"){
   const {data:snapshots,error}=await admin.from("fx_rate_snapshots").select("provider,city,buy_new,sell_new,buy_old,sell_old,source_updated_at,fetched_at").order("fetched_at",{ascending:false}).limit(10);
   if(error)return out({error:"تعذر تحميل سجل أسعار الصرف."},500,origin);
   return out({success:true,state,snapshots:snapshots||[],old_pound_factor:100},200,origin);
  }
  if(action!=="refresh")return out({error:"Unsupported action."},400,origin);
  if(state.auto_update_enabled!==true)return out({success:true,skipped:true,state},200,origin);
  const manual = !cron && body.source !== "cron";
  const priorAttempt = manual ? state.last_manual_at : state.last_attempt_at;
  const requiredGap = manual ? MANUAL_MIN_GAP : CRON_MIN_GAP;
  if(priorAttempt&&Date.now()-new Date(priorAttempt).getTime()<requiredGap){
   const {data:snapshots}=await admin.from("fx_rate_snapshots").select("*").order("fetched_at",{ascending:false}).limit(10);
   return out({success:true,cached:true,state,snapshots:snapshots||[],message:"آخر فحص خلال 15 دقيقة؛ استخدمنا البيانات المحفوظة."},200,origin);
  }
  const attempt=new Date().toISOString();
  await admin.from("fx_rate_state").update({last_attempt_at:attempt,...(manual?{last_manual_at:attempt}:{}),updated_at:attempt}).eq("id","main");
  const results=await Promise.allSettled([liraty(),lirascope()]);
  const good=results.filter((x):x is PromiseFulfilledResult<any>=>x.status==="fulfilled").map(x=>x.value);
  const errors=results.filter((x):x is PromiseRejectedResult=>x.status==="rejected").map(x=>String(x.reason?.message||x.reason));
  if(good.length!==2){
   const status=good.length===0?"source_unavailable":"stale";
   await admin.from("fx_rate_state").update({status,last_error:errors.join(" | ").slice(0,500),updated_at:new Date().toISOString()}).eq("id","main");
   return out({success:false,status,error:errors.join(" | "),retained_previous_rate:true},502,origin);
  }
  const [a,b]=good;
  const divergence=Math.abs(a.sell_old-b.sell_old)/((a.sell_old+b.sell_old)/2)*100;
  const now=new Date().toISOString();
  const rows=good.map(x=>({...x,fetched_at:now}));
  const {error:saveError}=await admin.from("fx_rate_snapshots").insert(rows);
  if(saveError)return out({success:false,error:"تعذر حفظ سجل المصدرين؛ لم يتغير السعر."},500,origin);
  if(divergence>2){
   await admin.from("fx_rate_state").update({status:"source_disagreement",source_difference_percent:Number(divergence.toFixed(4)),last_error:"اختلاف المصدرين تجاوز 2%؛ يلزم تدقيق.",updated_at:now}).eq("id","main");
   return out({success:false,status:"source_disagreement",divergence_percent:divergence,sources:rows,retained_previous_rate:true},409,origin);
  }
  // SELL is the dealer's asking price: the store's cost to acquire USD for HomsCard.
  const applied=Number(((a.sell_old+b.sell_old)/2).toFixed(2));
  const {error:settingsError}=await admin.from("store_settings").update({market_exchange_rate:applied}).eq("id","main");
  if(settingsError)return out({success:false,error:"تعذر تحديث سياسة التسعير؛ بقي السعر السابق."},500,origin);
  const {error:updateError}=await admin.from("fx_rate_state").update({status:"success",last_success_at:now,applied_rate_old:applied,source_difference_percent:Number(divergence.toFixed(4)),last_error:null,updated_at:now}).eq("id","main");
  if(updateError)return out({success:false,error:"تعذر تحديث حالة المراقب."},500,origin);
  return out({success:true,status:"success",applied_rate_old:applied,rate_basis:"average_of_two_provider_sell_quotes",sources:rows,divergence_percent:Number(divergence.toFixed(4)),products_changed:false,wallets_changed:false,orders_changed:false},200,origin);
 }catch(e){console.error("baran-fx-rates",e instanceof Error?e.message:"unknown");return out({error:"تعذر جلب سعر الصرف؛ بقي السعر السابق دون تغيير."},500,origin);}
});