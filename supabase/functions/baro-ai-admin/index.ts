import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGIN="https://eyadooon-cmyk.github.io";
const headers={"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin","Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
function readKeyObject(name:string):string|undefined{const raw=Deno.env.get(name);if(!raw)return undefined;try{return JSON.parse(raw).default;}catch{return undefined;}}
function norm(v:string):string{return String(v||"").toLowerCase().normalize("NFKC").replace(/[\u064B-\u065F\u0670]/g,"").replace(/[أإآ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه").replace(/[ـ]/g," ").replace(/[^\p{L}\p{N}\s_-]/gu," ").replace(/\s+/g," ").trim();}
function has(q:string,terms:string[]):boolean{return terms.some(t=>q.includes(norm(t)));}
function cash(v:unknown,c:string):string|null{if(v===null||v===undefined||v==="")return null;const n=Number(v);return Number.isFinite(n)&&n>0?new Intl.NumberFormat("en-US",{maximumFractionDigits:2}).format(n)+" "+c:null;}
function state(v:unknown):string{const s=String(v||"").toLowerCase();return ({pending:"قيد الانتظار",processing:"قيد التنفيذ",in_progress:"قيد التنفيذ",completed:"مكتمل",success:"مكتمل",failed:"فشل",cancelled:"ملغي",rejected:"مرفوض",awaiting_supplier:"بانتظار المورد"} as Record<string,string>)[s]||s||"غير محددة";}
function shortId(v:unknown):string{const s=String(v||"");return (s.length>8?s.slice(0,8):s).toUpperCase();}

Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS"){const o=req.headers.get("Origin");if(o&&o!==ORIGIN)return new Response("Forbidden",{status:403});return new Response("ok",{headers});}
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 const origin=req.headers.get("Origin");if(origin&&origin!==ORIGIN)return json({error:"Origin not allowed"},403);
 try{
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY")??readKeyObject("SUPABASE_PUBLISHABLE_KEYS"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anon||!service)return json({error:"Server configuration missing"},500);
  const auth=req.headers.get("Authorization")??"",token=auth.startsWith("Bearer ")?auth.slice(7).trim():"";
  if(!token)return json({error:"سجّل الدخول أولاً."},401);
  const userClient=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:authData,error:authError}=await userClient.auth.getUser(token),user=authData?.user;
  if(authError||!user)return json({error:"انتهت الجلسة. سجّل الدخول مجدداً."},401);
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const [{data:isAdmin,error:adminError},{data:roles,error:rolesError}]=await Promise.all([
   admin.rpc("admin_is_user",{p_user_id:user.id}),
   admin.from("baro_staff_permissions").select("permission_key").eq("user_id",user.id).eq("is_active",true)
  ]);
  if(adminError||rolesError)return json({error:"تعذر التحقق من صلاحيات BARO."},500);
  const perms=(roles??[]).map((x:any)=>String(x.permission_key));
  const canOrders=isAdmin===true||perms.includes("orders");
  if(isAdmin!==true&&!canOrders&&!perms.includes("view"))return json({error:"ما عندك صلاحية استخدام مساعد إدارة BARO."},403);
  let body:any;try{body=await req.json();}catch{return json({error:"الرسالة غير صالحة."},400);}
  if(!Array.isArray(body.messages)||body.messages.length<1||body.messages.length>10)return json({error:"المحادثة طويلة أو غير صالحة."},400);
  const messages=body.messages.filter((m:any)=>m&&(m.role==="user"||m.role==="assistant")&&typeof m.content==="string").slice(-8).map((m:any)=>({role:m.role,content:m.content.trim().slice(0,1000)})).filter((m:any)=>m.content);
  if(!messages.length||messages[messages.length-1].role!=="user")return json({error:"أرسل سؤالك أولاً."},400);
  const question=messages[messages.length-1].content,q=norm(question);
  const orderPromise=canOrders
   ? admin.from("leo_manual_orders").select("id,product_code,product_name_snapshot,quantity,status,created_at,updated_at").order("created_at",{ascending:false}).limit(40)
   : admin.from("leo_manual_orders").select("id",{count:"exact",head:true});
  const [orderResult,productResult,settingsResult]=await Promise.all([
   orderPromise,
   admin.from("leo_manual_products").select("product_code,product_name,category_id,catalog_visible,purchase_enabled,sale_price_usd,sale_price_syp").order("category_id").limit(100),
   admin.from("baro_manual_settings").select("enabled").eq("id","main").maybeSingle()
  ]);
  if(orderResult.error||productResult.error||settingsResult.error){console.error("baro-ai-admin internal context",orderResult.error?.message,productResult.error?.message,settingsResult.error?.message);return json({error:"تعذر تحميل بيانات BARO للإدارة."},500);}
  const orders=canOrders?(orderResult.data??[]):[],products=productResult.data??[],visible=products.filter((p:any)=>p.catalog_visible===true),purchase=visible.filter((p:any)=>p.purchase_enabled===true);
  const pending=orders.filter((o:any)=>!["completed","cancelled","failed"].includes(String(o.status||"").toLowerCase()));
  const now=Date.now(),late=pending.filter((o:any)=>{const d=new Date(o.updated_at||o.created_at||"").getTime();return Number.isFinite(d)&&now-d>86400000;});
  const intake=settingsResult.data?.enabled===true;
  const summary={recent_orders:canOrders?orders.length:(orderResult.count??0),active_orders:canOrders?pending.length:null,over_24h_without_terminal_status:canOrders?late.length:null,visible_products:visible.length,purchase_enabled_products:purchase.length};
  const money=/(ربح|ارباح|تكلف|سعر شراء|مورد|مصروف|محفظ|رصيد|ايداع|حواله|تحويل|شام كاش|استرداد|refund|supplier cost|profit|wallet|deposit|payment)/i.test(q);
  const action=/(نفذ|نفذلي|عدل|غير|حدث|اعتمد|ارفض|الغ|اكمل|اشحن|سلم|خصم|حول|اودع|استرد|احذف|اضف|انشئ|اغلق|افتح الطلب)/i.test(q);
  let reply="";
  if(money)reply="هذا المساعد مخصص للمراقبة التشغيلية لقسم BARO اليدوي فقط. لا يعرض تكاليف الموردين أو الأرباح أو الأرصدة أو تفاصيل التحويلات، ولا ينفذ أي إجراء مالي. استخدم السجل المالي المخصص وراجع أي عملية مالية يدوياً.";
  else if(action)reply="أنا مساعد قراءة وتحليل فقط. لا أغيّر الأسعار أو الطلبات أو الأرصدة، ولا أؤكد الدفعات أو أنفذ الشحن. أستطيع عرض الحالة المسجلة واقتراح خطوة متابعة آمنة.";
  else if(has(q,["متاخر","تاخير","عالق","معلق","تجاوز 24","فوق 24"])){
   if(!canOrders)reply="ليس لديك صلاحية عرض تفاصيل الطلبات. الملخص العام: "+summary.recent_orders+" طلباً ضمن النطاق المقروء، و"+visible.length+" منتجاً ظاهراً. اطلب من المدير صلاحية متابعة الطلبات.";
   else if(!late.length)reply="ما ظهر عندي طلب BARO يدوي مفتوح تجاوز 24 ساعة دون حالة نهائية ضمن أحدث 40 طلباً مقروءاً. قد توجد طلبات أقدم خارج العينة.";
   else reply="طلبات BARO اليدوية المفتوحة التي تجاوز آخر تحديث لها 24 ساعة:\n"+late.slice(0,12).map((o:any)=>"• "+shortId(o.id)+" — "+(o.product_name_snapshot||o.product_code||"منتج غير محدد")+" — الكمية: "+(o.quantity??"غير محددة")+" — الحالة: "+state(o.status)).join("\n")+"\n\nهذه قائمة متابعة فقط؛ تحقق من سجل كل طلب قبل التواصل مع الزبون أو تغيير حالته.";
  }else if(has(q,["منتج","منتجات","كتالوج","اسعار البيع","سعر المنتج","الباقات","المنتجات الظاهره"])){
   reply="الكتالوج الظاهر في BARO اليدوي ("+visible.length+" منتجاً):\n"+(visible.slice(0,20).map((p:any)=>"• "+p.product_name+" — "+([cash(p.sale_price_usd,"USD"),cash(p.sale_price_syp,"SYP")].filter(Boolean).join(" | ")||"السعر غير مسجل")).join("\n")||"لا توجد منتجات ظاهرة حالياً.")+"\n\nهذه أسعار البيع الظاهرة فقط؛ لا أعرض تكلفة المورد أو هامش الربح.";
  }else if(has(q,["طلب","طلبات","اوردر","order","حالة الشحن","متابعة الطلب"])){
   if(!canOrders)reply="ليس لديك صلاحية عرض تفاصيل الطلبات. الملخص العام: "+summary.recent_orders+" طلباً ضمن النطاق المقروء. اطلب من المدير صلاحية الطلبات لمتابعتها.";
   else reply="أحدث طلبات BARO اليدوية ("+orders.length+" ضمن العينة):\n"+(orders.slice(0,12).map((o:any)=>"• "+shortId(o.id)+" — "+(o.product_name_snapshot||o.product_code||"منتج غير محدد")+" — الكمية: "+(o.quantity??"غير محددة")+" — "+state(o.status)).join("\n")||"لا توجد طلبات ضمن النطاق المقروء.")+"\n\nلا أعرض بيانات تعريف اللاعب أو ملاحظات الزبون، ولا أؤكد اكتمال الشحن دون حالة نهائية مسجلة.";
  }else if(has(q,["استقبال","استلام","فتح الطلبات","الطلبات اليدويه","حالة البارو","حاله بارو","التفعيل"])){
   reply="حالة استقبال طلبات BARO اليدوية: "+(intake?"مفعّل":"متوقف")+". عدد المنتجات الظاهرة: "+visible.length+"، والمنتجات المسموح طلبها حالياً: "+purchase.length+".";
  }else{
   reply="ملخص BARO اليدوي الحالي:\n• استقبال الطلبات: "+(intake?"مفعّل":"متوقف")+"\n• الطلبات ضمن أحدث نطاق مقروء: "+summary.recent_orders+"\n"+(canOrders?"• الطلبات المفتوحة ضمن العينة: "+pending.length+"\n• المتأخرة أكثر من 24 ساعة: "+late.length+"\n":"")+"• المنتجات الظاهرة: "+visible.length+"\n• المنتجات المسموح طلبها: "+purchase.length+"\n\nفيني أراجع التأخير، حالات الطلبات، الكتالوج وأسعار البيع الظاهرة. ما بغيّر أي بيانات وما بتعامل مع الشحن الآلي.";
  }
  const {error:usageError}=await admin.from("ai_usage_events").insert({function_name:"baro-ai-admin",feature:"baro_admin",actor_user_id:user.id,route:"internal",usage_status:"succeeded",model:"baran-internal-rules-v1",input_tokens:0,output_tokens:0,total_tokens:0,status_code:200,duration_ms:0,completed_at:new Date().toISOString()});
  if(usageError)console.error("baro-ai-admin internal usage log failed",usageError.message);
  return json({reply,summary,intake_enabled:intake,read_only:true,engine:"internal-rules-v1"});
 }catch(e){console.error("baro-ai-admin internal assistant",e instanceof Error?e.message:"unknown");return json({error:"صار خطأ مؤقت بمساعد BARO للإدارة."},500);}
});