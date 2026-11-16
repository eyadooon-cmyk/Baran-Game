import { createClient } from "npm:@supabase/supabase-js@2";
const corsHeaders={"Access-Control-Allow-Origin":"https://eyadooon-cmyk.github.io","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:corsHeaders});
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function amount(value:unknown,max:number):number|null|undefined{if(value===null||value===undefined||value==="")return null;if(typeof value!=="number"||!Number.isFinite(value)||value<0||value>max)return undefined;return value;}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
 if(!["GET","POST"].includes(req.method))return json({error:"Method not allowed"},405);
 try{
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anon||!service)return json({error:"إعدادات BARO غير مكتملة."},500);
  const auth=req.headers.get("Authorization")??"",token=auth.startsWith("Bearer ")?auth.slice(7):"";
  if(!token)return json({error:"يلزم تسجيل الدخول."},401);
  const userClient=createClient(url,anon,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:authData,error:authError}=await userClient.auth.getUser(token),user=authData?.user;
  if(authError||!user)return json({error:"جلسة غير صالحة."},401);
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const view=new URL(req.url).searchParams.get("view")??"admin";

  if(req.method==="GET"&&view==="catalog"){
   const [{data,error},{data:settings,error:settingsError}]=await Promise.all([
    admin.from("leo_manual_products").select("product_code,category_id,group_id,product_name,input_label,sale_price_usd,sale_price_syp,purchase_enabled").eq("catalog_visible",true).order("category_id").order("group_id").order("product_name"),
    admin.from("baro_manual_settings").select("enabled").eq("id","main").maybeSingle()
   ]);
   if(error||settingsError)return json({error:"تعذر تحميل كتالوج BARO."},500);
   return json({products:data??[],manual_enabled:settings?.enabled===true});
  }
  if(req.method==="GET"&&view==="my_orders"){
   const {data,error}=await admin.from("leo_manual_orders").select("id,product_code,player_id,product_name_snapshot,quantity,customer_price_usd,customer_price_syp,status,payment_status,payment_method,customer_message,created_at,updated_at,completed_at").eq("user_id",user.id).order("created_at",{ascending:false}).limit(50);
   if(error)return json({error:"تعذر تحميل طلبات BARO."},500);
   return json({orders:data??[]});
  }

  let body:Record<string,unknown>={};
  if(req.method==="POST"){try{body=await req.json();}catch{return json({error:"بيانات غير صالحة."},400);}}
  if(req.method==="POST"&&body.action==="create_order"){
   const code=typeof body.product_code==="string"?body.product_code.trim():"";
   const player=typeof body.player_id==="string"?body.player_id.trim():"";
   const qty=typeof body.quantity==="number"?body.quantity:Number(body.quantity??1);
   const note=typeof body.customer_note==="string"?body.customer_note.trim():"";
   if(!/^LEO_[A-Z0-9_]{3,56}$/.test(code)||player.length<3||player.length>80||!Number.isInteger(qty)||qty<1||qty>1000000||note.length>500)return json({error:"تحقق من المنتج ومعرّف اللاعب والكمية."},400);
   const {data,error}=await admin.rpc("baro_manual_create_customer_order",{p_user_id:user.id,p_product_code:code,p_player_id:player,p_quantity:qty,p_customer_note:note});
   if(error)return json({error:error.message||"تعذر تسجيل طلب BARO."},400);
   return json(data??{success:true});
  }

  const {data:isAdmin,error:adminError}=await admin.rpc("admin_is_user",{p_user_id:user.id});
  if(adminError||isAdmin!==true)return json({error:"هذه العملية مخصصة لمدير المتجر."},403);

  if(req.method==="GET"){
   const [{data:products,error:pe},{data:orders,error:oe}]=await Promise.all([
    admin.from("leo_manual_products").select("*").order("category_id").order("group_id").order("product_name"),
    admin.from("leo_manual_orders").select("id,user_id,product_code,player_id,product_name_snapshot,quantity,customer_note,customer_price_usd,customer_price_syp,payment_status,payment_method,customer_message,supplier_cost_usd,supplier_reference,status,internal_notes,exception_reason,created_at,updated_at,completed_at").order("created_at",{ascending:false}).limit(150)
   ]);
   if(pe||oe)return json({error:"تعذر تحميل بيانات BARO اليدوية."},500);
   const enriched=await Promise.all((orders??[]).map(async o=>{const {data}=await admin.auth.admin.getUserById(o.user_id);return {...o,customer_email:data?.user?.email??null};}));
   const {data:manualSettings,error:manualSettingsError}=await admin.from("baro_manual_settings").select("enabled,updated_at").eq("id","main").single();
   if(manualSettingsError)return json({error:"تعذر تحميل حالة استقبال BARO."},500);
   return json({products:products??[],orders:enriched,manual_enabled:manualSettings.enabled===true,purchase_enabled:manualSettings.enabled===true});
  }
  if(body.action==="manual_toggle"){
   if(typeof body.enabled!=="boolean")return json({error:"حالة BARO غير صحيحة."},400);
   const {data:setting,error}=await admin.rpc("baro_manual_set_enabled_atomic",{p_admin_id:user.id,p_enabled:body.enabled});
   if(error||!setting?.success)return json({error:"تعذر تحديث حالة استقبال BARO وتسجيل التدقيق."},400);
   return json(setting);
  }
  if(body.action==="product_configure"){
   const code=typeof body.product_code==="string"?body.product_code.trim():"";
   if(!/^LEO_[A-Z0-9_]{3,56}$/.test(code)||typeof body.catalog_visible!=="boolean"||typeof body.purchase_enabled!=="boolean")return json({error:"إعدادات المنتج غير صحيحة."},400);
   const {data,error}=await admin.rpc("baro_manual_product_configure_atomic",{p_admin_id:user.id,p_product_code:code,p_catalog_visible:body.catalog_visible,p_purchase_enabled:body.purchase_enabled});
   if(error)return json({error:"تعذر تحديث إتاحة المنتج."},400);return json(data);
  }
  if(body.action==="product_update"){
   const code=typeof body.product_code==="string"?body.product_code.trim():"",cost=amount(body.supplier_cost_usd,1000000),usd=amount(body.sale_price_usd,1000000),syp=amount(body.sale_price_syp,100000000000),notes=typeof body.admin_notes==="string"?body.admin_notes.trim():"";
   if(!/^LEO_[A-Z0-9_]{3,56}$/.test(code)||cost===undefined||usd===undefined||syp===undefined||notes.length>1000)return json({error:"تحقق من رمز المنتج والأسعار والملاحظات."},400);
   const {data,error}=await admin.rpc("baro_manual_product_update_atomic",{p_admin_id:user.id,p_product_code:code,p_supplier_cost_usd:cost,p_sale_price_usd:usd,p_sale_price_syp:syp,p_admin_notes:notes});
   if(error||!data?.product)return json({error:"لم يتم حفظ المنتج أو سجل التدقيق."},400);return json(data);
  }
  if(body.action==="order_admin_update"){
   const id=typeof body.order_id==="string"?body.order_id:"",status=typeof body.status==="string"?body.status:"";
   const quote=amount(body.quote_amount,1000000000000),currency=body.quote_currency===null||body.quote_currency===""?null:body.quote_currency;
   const method=typeof body.payment_method==="string"?body.payment_method.trim():"",payment=typeof body.payment_status==="string"?body.payment_status:"";
   const customerMessage=typeof body.customer_message==="string"?body.customer_message.trim():"",cost=amount(body.supplier_cost_usd,1000000);
   const reference=typeof body.supplier_reference==="string"?body.supplier_reference.trim():"",exception=typeof body.exception_reason==="string"?body.exception_reason.trim():"",notes=typeof body.internal_notes==="string"?body.internal_notes.trim():"";
   if(!uuidPattern.test(id)||!["pending","awaiting_payment","paid","in_progress","completed","failed","needs_review","cancelled"].includes(status)||quote===undefined||(currency!==null&&!["USD","SYP"].includes(String(currency)))||method.length>60||!["awaiting_quote","awaiting_payment","verified","failed"].includes(payment)||customerMessage.length>500||cost===undefined||reference.length>160||exception.length>500||notes.length>2000)return json({error:"بيانات تحديث الطلب غير صحيحة."},400);
   const {data,error}=await admin.rpc("baro_manual_order_admin_update_atomic",{p_admin_id:user.id,p_order_id:id,p_status:status,p_quote_amount:quote,p_quote_currency:currency,p_payment_method:method,p_payment_status:payment,p_customer_message:customerMessage,p_supplier_cost_usd:cost,p_supplier_reference:reference,p_exception_reason:exception,p_internal_notes:notes});
   if(error||!data?.order)return json({error:error?.message||"تعذر تحديث طلب BARO."},400);return json(data);
  }
  if(body.action==="order_update"){
   const id=typeof body.order_id==="string"?body.order_id:"",status=typeof body.status==="string"?body.status:"",cost=amount(body.supplier_cost_usd,1000000);
   const reference=typeof body.supplier_reference==="string"?body.supplier_reference.trim():"",exception=typeof body.exception_reason==="string"?body.exception_reason.trim():"",notes=typeof body.internal_notes==="string"?body.internal_notes.trim():"";
   if(!uuidPattern.test(id)||!["pending","in_progress","awaiting_admin_confirmation","completed","failed","needs_review","cancelled"].includes(status)||cost===undefined||reference.length>160||exception.length>500||notes.length>2000)return json({error:"بيانات الطلب غير صحيحة."},400);
   if(status==="completed"&&(!(cost!==null&&cost>0)||!(reference.length>=2||exception.length>=5)))return json({error:"يتطلب إكمال الطلب تكلفة فعلية ومرجعاً أو استثناء موثقاً."},400);
   const {data,error}=await admin.rpc("baro_manual_order_update_atomic",{p_admin_id:user.id,p_order_id:id,p_status:status,p_supplier_cost_usd:cost,p_supplier_reference:reference||null,p_exception_reason:exception||null,p_internal_notes:notes});
   if(error||!data?.order)return json({error:"لم يتم تحديث الطلب."},400);return json(data);
  }
  return json({error:"الإجراء غير معروف."},400);
 }catch(error){console.error("baro-manual error",error);return json({error:"حدث خطأ داخلي أثناء معالجة BARO."},500);}
});
