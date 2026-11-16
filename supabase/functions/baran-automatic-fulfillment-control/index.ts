import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders={
  "Access-Control-Allow-Origin":"https://eyadooon-cmyk.github.io",
  "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
  "Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"no-store"
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:corsHeaders});
Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
  if(!["GET","POST"].includes(req.method))return json({error:"Method not allowed"},405);
  try{
    const url=Deno.env.get("SUPABASE_URL");
    const anon=Deno.env.get("SUPABASE_ANON_KEY");
    const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!url||!anon||!service)return json({error:"إعدادات التحكم بالشحن الآلي غير مكتملة."},503);
    const auth=req.headers.get("Authorization")??"";
    const token=auth.startsWith("Bearer ")?auth.slice(7):"";
    if(!token)return json({error:"يلزم تسجيل الدخول."},401);
    const userClient=createClient(url,anon,{global:{headers:{Authorization:"Bearer "+token}},auth:{persistSession:false,autoRefreshToken:false}});
    const {data:authData,error:authError}=await userClient.auth.getUser(token);
    const user=authData?.user;
    if(authError||!user)return json({error:"جلسة غير صالحة."},401);
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:isAdmin,error:adminError}=await admin.rpc("admin_is_user",{p_user_id:user.id});
    if(adminError||isAdmin!==true)return json({error:"هذا التحكم مخصص لمدير المتجر."},403);
    if(req.method==="GET"){
      const {data,error}=await admin.from("baran_automatic_fulfillment_settings").select("enabled,updated_at").eq("id","main").single();
      if(error||!data)return json({error:"تعذر قراءة حالة الشحن الآلي."},500);
      return json({automatic_enabled:data.enabled===true,updated_at:data.updated_at,
        actual_dispatch_ready:false,
        note:"فتح هذا المفتاح لا يفعّل الشحن الفعلي؛ بوابة الشراء والتنفيذ الآلي ما زالت مغلقة حتى اكتمال موصل المورد واختباره."});
    }
    let body:any={};try{body=await req.json();}catch{return json({error:"بيانات غير صالحة."},400);}
    if(body.action!=="set_enabled"||typeof body.enabled!=="boolean")return json({error:"الإجراء أو حالة الشحن الآلي غير صحيحة."},400);
    const {data,error}=await admin.rpc("baran_auto_fulfillment_set_enabled_atomic",{p_admin_id:user.id,p_enabled:body.enabled});
    if(error||!data?.success)return json({error:"تعذر تحديث مفتاح الشحن الآلي وتسجيل التدقيق."},400);
    return json({...data,actual_dispatch_ready:false,
      note:"تم تغيير المفتاح الإداري فقط. لا يوجد إرسال تلقائي فعلي قبل إكمال واختبار موصل المورد."});
  }catch(error){
    console.error("automatic fulfillment control error",error instanceof Error?error.message:String(error));
    return json({error:"حدث خطأ أثناء تحديث حالة الشحن الآلي."},500);
  }
});