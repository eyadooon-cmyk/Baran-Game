import { createClient } from "npm:@supabase/supabase-js@2";
const ORIGIN = "https://eyadooon-cmyk.github.io";
const headers = {"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin","Content-Type":"application/json","Cache-Control":"no-store"};
function readKeyObject(name:string):string|undefined {
 const raw=Deno.env.get(name);
 if(!raw)return undefined;
 try{return JSON.parse(raw).default;}catch{return undefined;}
}
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
const n=(v:unknown)=>{const x=Number(v??0);return Number.isFinite(x)?x:0;};
const money=(v:number,c:string)=>new Intl.NumberFormat("en-US",{maximumFractionDigits:2}).format(v)+" "+c;
const countBy=(rows:any[],key:(r:any)=>string)=>{const out:Record<string,number>={};for(const r of rows){const k=key(r)||"غير محدد";out[k]=(out[k]||0)+1;}return out;};
const fmt=(o:Record<string,number>)=>Object.entries(o).length?Object.entries(o).map(([k,v])=>k+": "+v).join("، "):"لا توجد سجلات";
const has=(q:string,words:string[])=>words.some(w=>q.includes(w));
function guestSupportDraft(ticket:any):string {
 const raw=String((ticket.subject||"")+" "+(ticket.initial_message||ticket.message||"")).toLowerCase();
 const text=raw.replace(/[أإآ]/g,"ا").replace(/ة/g,"ه").replace(/ى/g,"ي");
 if(/رصيد|محفظه|محفظة|شحن|حواله|حوالة|تحويل|دفع|دفعت|خصم|سحب|استرداد|استرجاع|فاتوره|فاتورة|شام ?كاش|sham ?cash|wallet|balance|payment|paid|refund|chargeback|top.?up|deposit|withdraw|transaction|invoice/.test(text))
  return "تصنيف مالي — يحتاج مراجعة بشرية قبل أي رد نهائي. لا تنفذ أو تعدّل رصيداً أو دفعة أو استرداداً أو طلب شحن. المسودة الآمنة: أهلاً فيك، وصلنا استفسارك المتعلق بالعملية المالية، وحوّلناه لمراجعة فريق الدعم المختص. لا ترسل كلمة المرور أو رمز التحقق أو بيانات البطاقة. سنراجع التفاصيل المتاحة في النظام ونتابع معك عبر التذكرة.";
 if(/احتيال|نصب|سرقه|اختراق|تهديد|ابتزاز|محامي|قانوني|خصوصيه|بياناتي|حذف الحساب|fraud|scam|hacked|stolen|legal|privacy|delete account|رمز التحقق|كود التحقق|otp|pin|api[_ -]?key|access[_ -]?token|credit ?card|card ?number|بطاقه بنكيه/.test(text))
  return "تصنيف أمني أو خصوصية أو بيانات حساسة — يحتاج مراجعة بشرية. لا تطلب كلمة مرور أو رمز تحقق أو بيانات بطاقة، ولا ترسل تعليمات لتغيير صلاحيات أو بيانات الحساب.";
 if((/نسيت|ناسي|ضاعت/.test(text)&&/كلمه المرور|كلمة السر|باسورد|password/.test(text)) || /تسجيل الدخول|ما عم اقدر فوت|ما بقدر سجل|login|password reset/.test(text))
  return "أهلاً فيك ❤️ إذا نسيت كلمة المرور، اضغط «استعادة كلمة المرور» من شاشة الدخول، واكتب البريد المرتبط بحسابك، ثم افحص صندوق الوارد والرسائل غير المرغوب فيها. لا ترسل كلمة مرورك أو رمز التحقق لأي شخص. إذا لم يصلك الرابط، أخبرنا بالرسالة التي تظهر لك.";
 if(/ما بيفتح|ما عم يفتح|الموقع|الصفحه|التطبيق|loading|not loading/.test(text))
  return "أهلاً فيك 🌟 تأكد من اتصال الإنترنت، ثم حدّث الصفحة وأعد فتح Chrome. إذا استمرت المشكلة، جرّب نافذة خاصة وأرسل لنا نوع جهازك ورسالة الخطأ الظاهرة، من دون مشاركة أي كلمة مرور.";
 if(/اشعار|اشعارات|تنبيه|notifications/.test(text))
  return "أهلاً فيك 🌟 تأكد من السماح بإشعارات BARAN GAME من إعدادات Chrome والهاتف، ثم افتح المتجر مجدداً. إذا استمرت المشكلة، أرسل نوع جهازك وإصدار Android.";
 return "أهلاً فيك، وصلتنا رسالتك ورح يراجع فريق BARAN GAME المشكلة ويتابع معك عبر رقم التذكرة. إذا في تفاصيل إضافية غير حساسة، أرسلها هون. لا ترسل كلمة المرور أو رموز التحقق.";
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS"){const o=req.headers.get("Origin");if(o&&o!==ORIGIN)return new Response("Forbidden",{status:403});return new Response("ok",{headers});}
 if(req.method!=="POST")return reply({error:"Method not allowed"},405);
 const origin=req.headers.get("Origin");if(origin&&origin!==ORIGIN)return reply({error:"Origin not allowed"},403);
 try{
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY")??readKeyObject("SUPABASE_PUBLISHABLE_KEYS"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anon||!service)return reply({error:"Server configuration incomplete"},500);
  const auth=req.headers.get("Authorization")||"",token=auth.startsWith("Bearer ")?auth.slice(7):"";
  if(!token)return reply({error:"Authentication required"},401);
  const userClient=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:authData,error:authError}=await userClient.auth.getUser(token);
  if(authError||!authData.user)return reply({error:"Invalid session"},401);
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:isAdmin,error:adminError}=await db.rpc("admin_is_user",{p_user_id:authData.user.id});
  if(adminError||isAdmin!==true)return reply({error:"Administrator access required"},403);
  const body=await req.json().catch(()=>null),question=typeof body?.question==="string"?body.question.trim().slice(0,1200):"";
  if(question.length<2)return reply({error:"اكتب سؤالك حتى أجهز التقرير."},400);
  const specs=await Promise.all([
   db.from("products").select("id,product_code,name,category,price_usd,price_syp,is_active,sort_order,updated_at").order("sort_order").limit(200),
   db.from("orders").select("id,product_code,quantity,status,created_at,total_price_usd,total_price_syp,payment_currency").order("created_at",{ascending:false}).limit(200),
   db.from("leo_manual_orders").select("id,product_code,product_name_snapshot,quantity,status,payment_status,payment_method,created_at,completed_at,customer_price_usd,customer_price_syp,supplier_cost_usd,supplier_cost_usd_snapshot").order("created_at",{ascending:false}).limit(200),
   db.from("order_fulfillment").select("order_id,supplier_id,supplier_status,dispatch_state,refund_status,supplier_total_cost,supplier_cost_currency,supplier_cost_exchange_rate,failure_reason,updated_at").order("updated_at",{ascending:false}).limit(200),
   db.from("suppliers").select("id,name,is_active,updated_at").order("created_at",{ascending:false}).limit(100),
   db.from("supplier_products").select("id,supplier_id,product_id,supplier_sku,unit_cost,currency,is_preferred,lead_time_hours,updated_at").order("updated_at",{ascending:false}).limit(200),
   db.from("customer_feedback").select("id,ticket_code,feedback_type,subject,message,rating,status,admin_reply,created_at,updated_at").order("created_at",{ascending:false}).limit(200),
   db.from("baran_guest_support_tickets").select("id,ticket_code,email,subject,initial_message,status,priority,assistant_reason,assistant_draft,created_at,updated_at").order("created_at",{ascending:false}).limit(100),
   db.from("deposit_requests").select("id,status,currency,created_at").order("created_at",{ascending:false}).limit(200),
   db.from("wallet_transactions").select("id,amount,currency,transaction_type,description,created_at,order_id,deposit_request_id").order("created_at",{ascending:false}).limit(200),
   db.from("admin_audit_log").select("action,entity_type,created_at").order("created_at",{ascending:false}).limit(30),
   db.from("store_announcements").select("kind,title,status,created_at,published_at,notification_count").order("created_at",{ascending:false}).limit(30),
   db.from("baran_admin_memory").select("category,content,created_at").eq("is_active",true).order("created_at",{ascending:false}).limit(30),
   db.from("baran_auto_support_queue").select("ticket_code,state,reason,attempts,created_at,updated_at,processed_at").order("created_at",{ascending:false}).limit(100),
   db.from("customer_loyalty").select("user_id,points_balance,lifetime_earned,updated_at").limit(500),
   db.from("loyalty_coupons").select("status,discount_amount_usd,points_spent,created_at,redeemed_at").order("created_at",{ascending:false}).limit(200),
   db.from("loyalty_transactions").select("points,transaction_type,created_at").order("created_at",{ascending:false}).limit(200),
   db.from("customer_security_events").select("event_type,severity,created_at").order("created_at",{ascending:false}).limit(200),
   db.from("baran_push_delivery_logs").select("status,http_status,error_code,created_at,sent_at").order("created_at",{ascending:false}).limit(200),
   db.from("baran_admin_work_plan").select("task_code,title,area,priority,evidence,impact,next_step,success_criteria,status,requires_approval,updated_at").order("updated_at",{ascending:false}).limit(100),
   db.from("baro_manual_finance_entries").select("entry_type,title,amount,currency,amount_usd_equivalent,status,created_at").order("created_at",{ascending:false}).limit(200),
   db.from("admin_finance_entries").select("entry_type,title,amount,cost_amount,currency,created_at").order("created_at",{ascending:false}).limit(200)
  ]);
  const labels=["products","orders","manual_orders","fulfillment","suppliers","supplier_products","feedback","guest_support","deposits","wallet_transactions","audit","announcements","memory","support_queue","loyalty","loyalty_coupons","loyalty_transactions","security_events","push_logs","work_plan","baro_finance","admin_finance"],data:Record<string,any[]>={},unavailable:string[]=[];
  specs.forEach((r:any,i:number)=>{if(r.error){data[labels[i]]=[];unavailable.push(labels[i]);}else data[labels[i]]=r.data||[];});
  const products=data.products,baseOrders=data.orders,manualOrders=data.manual_orders,fulfillment=data.fulfillment,suppliers=data.suppliers,links=data.supplier_products,feedback=data.feedback,guestSupport=data.guest_support,deposits=data.deposits,walletTransactions=data.wallet_transactions,audit=data.audit,announcements=data.announcements,memories=data.memory;
  const supportQueue=data.support_queue,loyalty=data.loyalty,loyaltyCoupons=data.loyalty_coupons,loyaltyTransactions=data.loyalty_transactions,securityEvents=data.security_events,pushLogs=data.push_logs,workPlan=data.work_plan,baroFinance=data.baro_finance,adminFinance=data.admin_finance;
  const mergedOrderMap=new Map<string,any>();
  for(const o of baseOrders)mergedOrderMap.set(String(o.id),{...o,source:"orders"});
  for(const o of manualOrders)if(!mergedOrderMap.has(String(o.id)))mergedOrderMap.set(String(o.id),{...o,total_price_usd:o.customer_price_usd,total_price_syp:o.customer_price_syp,supplier_total_cost:o.supplier_cost_usd_snapshot??o.supplier_cost_usd,source:"leo_manual_orders"});
  const orders=[...mergedOrderMap.values()].sort((a,b)=>new Date(b.created_at||0).getTime()-new Date(a.created_at||0).getTime());
  const openTickets=[...feedback.filter(x=>x.feedback_type==="support"&&["pending","in_progress"].includes(x.status)),...guestSupport.filter(x=>["pending","in_progress"].includes(x.status)).map(x=>({...x,feedback_type:"support",message:x.initial_message,source:"guest"}))];
  const reviews=feedback.filter(x=>x.feedback_type==="review"),failed=orders.filter(x=>["failed","error"].includes(String(x.status).toLowerCase()));
  const waiting=orders.filter(x=>["pending","processing","in_progress"].includes(String(x.status).toLowerCase()));
  const inactive=products.filter(x=>x.is_active!==true),missingPrices=products.filter(x=>x.price_usd==null&&x.price_syp==null);
  const missingCosts=fulfillment.filter(x=>x.supplier_total_cost==null),unlinked=products.filter(p=>!links.some(l=>l.product_id===p.id));
  const pendingDeposits=deposits.filter(x=>x.status==="pending"),statusCounts=countBy(orders,x=>String(x.status||"غير محدد"));
  const categories=countBy(products,x=>String(x.category||"غير محدد"));
  const supplierName=new Map(suppliers.map(s=>[s.id,s.name])),productName=new Map(products.map(p=>[p.id,p.name]));
  const now=new Date().toISOString(),q=question.toLowerCase(),lines:string[]=[];
  lines.push("🟣 تقرير Baran Game — وضع العمل بالمحرك الداخلي","وقت قراءة البيانات: "+new Date(now).toLocaleString("ar"),"قراءة مباشرة للبيانات الحالية، وليست مراقبة مستمرة.","");
  const wp=has(q,["منتج","المنتجات","كتالوج","أسعار","سعر"]),wo=has(q,["طلب","الطلبات","شحن","تنفيذ"]),ws=has(q,["تذكرة","تذاكر","دعم","زبون","شكاوى","شكوى"]),wsp=has(q,["مورد","الموردين","موردين","api","ربط"]),wf=has(q,["مالي","مالية","مبيعات","أرباح","ربح","تكلفة","تكاليف","إيراد"]),wsec=has(q,["أمان","أمني","تدقيق","سجل العمليات","مخاطر","اختراق","محاولات دخول"]),wr=has(q,["تقييم","تقييمات","آراء"]);
  const wm=has(q,["شو بتتذكر","شو تتذكر","الذاكرة","المعلومات المحفوظة","قرارات المشروع"]),wl=has(q,["نقاط","ولاء","قسائم الولاء","كوبونات الولاء","baran club"]),wn=has(q,["إشعارات","اشعارات","إشعار","اشعار","push"]),wplan=has(q,["خطة العمل","مهام الإدارة","مهام التطوير","خطة التطوير"]);
  const special=wp||wo||ws||wsp||wf||wsec||wr||wm||wl||wn||wplan;
  const general=has(q,["تقرير شامل","ملخص تنفيذي","حالة المتجر","وضع المتجر","كل الأقسام","كل شي عن المتجر","داشبورد","dashboard"]);
  if(!special||general){
   lines.push("📊 الملخص التنفيذي","المنتجات: "+products.length+" (نشطة "+products.filter(x=>x.is_active===true).length+"، غير نشطة "+inactive.length+")",
    "الطلبات الموحّدة دون تكرار: "+orders.length+" (orders: "+baseOrders.length+"، BARO اليدوي: "+manualOrders.length+") — "+fmt(statusCounts),
    "الموردون: "+suppliers.length+" (نشط "+suppliers.filter(x=>x.is_active===true).length+")",
    "روابط المورد/المنتج: "+links.length,"تذاكر الدعم المفتوحة: "+openTickets.length,
    "الإيداعات المعلقة: "+pendingDeposits.length+" (عدد فقط؛ لا مراجعة أو اعتماد)",
    "التقييمات: "+reviews.length+" (بانتظار المراجعة "+reviews.filter(x=>x.status==="pending").length+")",
    "الإعلانات ضمن العينة: "+announcements.length,"","🚦 أولويات تستحق الفحص");
   const risks:string[]=[];
   if(failed.length)risks.push("طلبات فاشلة ضمن أحدث السجلات: "+failed.length);
   if(waiting.length)risks.push("طلبات pending/processing: "+waiting.length+" — يلزم التأكد من تنفيذ المورد");
   if(openTickets.length)risks.push("تذاكر دعم مفتوحة: "+openTickets.length);
   if(pendingDeposits.length)risks.push("إيداعات تنتظر مراجعة بشرية: "+pendingDeposits.length);
   if(!risks.length)risks.push("لم تظهر مؤشرات ضمن القوائم المختصرة؛ هذا لا يثبت خلو المتجر من المشاكل.");
   risks.slice(0,8).forEach((x,i)=>lines.push((i+1)+". "+x));
   lines.push("","🧭 بنود مؤجلة أو جاهزية قبل الإطلاق");
   lines.push("ربط المنتجات بالمورد وAPI والشحن التلقائي: مؤجل بقرار إداري، وليس عطلاً حالياً.");
   if(suppliers.length===0||!suppliers.some(x=>x.is_active===true)) lines.push("لا يوجد مورد نشط حالياً؛ هذا متوافق مع قرار تأجيل المورد ولا يُرفع كإنذار.");
   if(unlinked.length) lines.push("المنتجات المسجلة بلا ربط مورد: "+unlinked.length+" — بند مؤجل حتى اعتماد المورد.");
   if(missingPrices.length) lines.push("حقول السعر فارغة في العملة/العملتين ضمن "+missingPrices.length+" منتج — بند مراجعة تسعير قبل فتح البيع، وليس عطل تشغيل حالياً.");
   if(missingCosts.length) lines.push("سجلات تنفيذ بلا تكلفة مورد: "+missingCosts.length+" — لا يمكن حساب تكلفة/ربح دقيق قبل استكمال بيانات المورد.");
   lines.push("","تصنيفات المنتجات: "+fmt(categories));
  }
  if(wp){
   lines.push("\n🛍️ تدقيق المنتجات","عدد المنتجات: "+products.length+"، النشطة: "+(products.length-inactive.length)+"، غير النشطة: "+inactive.length);
   if(missingPrices.length)lines.push("بيانات التسعير التي تحتاج استكمالاً قبل البيع ("+missingPrices.length+"): "+missingPrices.map(p=>p.product_code+" — "+p.name).slice(0,15).join("؛ "));
   if(unlinked.length)lines.push("الربط بالمورد مؤجل حالياً ("+unlinked.length+" منتج): "+unlinked.map(p=>p.product_code+" — "+p.name).slice(0,15).join("؛ "));
   lines.push(products.slice(0,30).map(p=>p.product_code+" — "+p.name+" | "+p.category+" | "+(p.is_active?"نشط":"غير نشط")+" | USD "+(p.price_usd??"—")+" | SYP "+(p.price_syp??"—")).join("\n")||"لا توجد منتجات.");
  }
  if(wo){
   lines.push("\n📦 متابعة الطلبات — دمج المصدرين دون تكرار","orders: "+baseOrders.length+" | leo_manual_orders (BARO): "+manualOrders.length+" | الإجمالي: "+orders.length,"توزيع الحالات: "+fmt(statusCounts));
   for(const o of orders.slice(0,25)){
    const f=fulfillment.find(x=>x.order_id===o.id),manual=o.source==="leo_manual_orders";
    const amount=o.total_price_usd!=null?money(n(o.total_price_usd),"USD"):o.total_price_syp!=null?money(n(o.total_price_syp),"SYP"):"السعر غير مسجل";
    lines.push((manual?"BARO":"عام")+" | "+String(o.id).slice(0,8)+" | "+(o.product_name_snapshot||o.product_code||"طلب")+" × "+(o.quantity??1)+" | "+o.status+" | الدفع: "+(o.payment_status||"غير محدد")+" | "+amount+(manual?" | تكلفة المورد: "+money(n(o.supplier_total_cost),"USD"):" | تنفيذ المورد: "+(f?.dispatch_state||f?.supplier_status||"لا يوجد سجل تنفيذ")));
   }
   if(!orders.length)lines.push("لا توجد سجلات في المصدرين اللذين تمكنا من قراءتهما.");
  }
  if(ws){
   lines.push("\n🎧 تذاكر الدعم المفتوحة","عدد التذاكر المفتوحة: "+openTickets.length);
   for(const t of openTickets.slice(0,25)){
    lines.push((t.ticket_code||String(t.id).slice(0,8))+" | "+(t.subject||"بدون عنوان")+" | "+t.status+(t.source==="guest"?" | زائر: "+String(t.email||""):"")+" | "+String(t.message||"").replace(/\\s+/g," ").slice(0,260));
    if(t.admin_reply)lines.push("آخر رد إداري مسجل: "+String(t.admin_reply).slice(0,120));
    if(t.source==="guest")lines.push("مسودة رد مقترحة من Baran Assistant (تحتاج مراجعة بشرية قبل الإرسال): "+guestSupportDraft(t));
    if(t.assistant_reason)lines.push("تحليل مساعد سابق: "+String(t.assistant_reason).slice(0,160));
    if(t.assistant_draft)lines.push("مسودة مساعد محفوظة: "+String(t.assistant_draft).slice(0,240));
   }
   if(!openTickets.length)lines.push("لا توجد تذاكر دعم مفتوحة ضمن آخر 200 سجل.");
  }
  if(wsp){
   lines.push("\n🔌 الموردون والربط","الموردون: "+suppliers.length+"، روابط المنتجات: "+links.length);
   for(const s of suppliers)lines.push("مورد: "+s.name+" | "+(s.is_active?"نشط":"غير نشط"));
   for(const l of links.slice(0,50))lines.push((productName.get(l.product_id)||"منتج غير معروف")+" ← "+(supplierName.get(l.supplier_id)||"مورد غير معروف")+" | SKU: "+(l.supplier_sku||"غير محدد")+" | التكلفة: "+(l.unit_cost??"غير محددة")+" "+(l.currency||"")+" | "+(l.is_preferred?"مفضل":"عادي"));
   if(!links.length)lines.push("لا توجد روابط مورد/منتج مسجلة حالياً.");
   lines.push("قرار الإدارة الحالي: المورد وAPI والشحن التلقائي مؤجلة؛ لا تعتبر قلة الروابط مشكلة تشغيلية الآن.");
   lines.push("وجود ربط في قاعدة البيانات لا يعني وجود API فعلي أو شحن تلقائي.");
  }
  if(wf){
   lines.push("\n💰 قراءة مالية أولية — لا حركة مالية");
   const usd=orders.reduce((sum,o)=>sum+n(o.total_price_usd),0),syp=orders.reduce((sum,o)=>sum+n(o.total_price_syp),0);
   const generalSupplierUsd=fulfillment.filter(f=>f.supplier_cost_currency==="USD").reduce((sum,f)=>sum+n(f.supplier_total_cost),0);
   const manualSupplierUsd=manualOrders.reduce((sum,o)=>sum+n(o.supplier_cost_usd_snapshot??o.supplier_cost_usd),0);
   const supplierSyp=fulfillment.filter(f=>f.supplier_cost_currency==="SYP").reduce((sum,f)=>sum+n(f.supplier_total_cost),0);
   lines.push("مبيعات الطلبات من المصدرين: "+money(usd,"USD")+"، "+money(syp,"SYP"));
   lines.push("تكاليف المورد لطلبات orders: "+money(generalSupplierUsd,"USD")+"، "+money(supplierSyp,"SYP"));
   lines.push("تكاليف مورد BARO اليدوي: "+money(manualSupplierUsd,"USD")+" (مسجلة بالدولار فقط)");
   lines.push("قيود مالية BARO المسجلة: "+baroFinance.length+" | قيود الإدارة المالية: "+adminFinance.length);
   lines.push("لا أدمج العملات ولا أصف الفرق بأنه صافي ربح؛ راجع نوع وحالة القيود والمصاريف والمرتجعات قبل اعتماد أي نتيجة.");
   lines.push("لا أصف الفرق بأنه صافي ربح: العينة آخر 200 سجل وقد لا تشمل المصاريف أو المرتجعات أو كل التكاليف.");
   lines.push("الطلبات حسب الحالة: "+fmt(statusCounts));
  }
  const ww=has(q,["محفظة","حركة مالية","حركات المحفظة","سجل المحفظة","خصم","استرداد","إيداع","ايداع","wallet","transaction"]);
  if(ww){lines.push("\\n💳 سجل حركة المحفظة — قراءة فقط","عدد العمليات ضمن آخر 200 سجل: "+walletTransactions.length,"توزيع الأنواع: "+fmt(countBy(walletTransactions,x=>String(x.transaction_type||"غير محدد"))));for(const t of walletTransactions.slice(0,40))lines.push(String(t.created_at)+" | "+t.transaction_type+" | "+money(n(t.amount),String(t.currency||""))+" | "+String(t.description||"").slice(0,120));lines.push("السجل يعرض العمليات المسجلة فقط، وقد لا يشمل المسارات غير المربوطة بعد.");}
  if(wm){
   lines.push("\n🧠 ذاكرة Baran التشغيلية","المعلومات النشطة المحفوظة: "+memories.length);
   const safeMemories=memories.filter(x=>!/(?:api[_ -]?key|service[_ -]?role|access[_ -]?token|refresh[_ -]?token|password|كلمة\s*المرور|رمز\s*التحقق|مفتاح\s*سري)/i.test(String(x.content||"")));
   for(const m of safeMemories.slice(0,25)) lines.push("• ["+(m.category||"عام")+"] "+String(m.content||"").slice(0,500)+" | "+String(m.created_at||""));
   if(!safeMemories.length) lines.push("لا توجد معلومات تشغيلية آمنة ظاهرة.");
   lines.push("هذه ذاكرة تشغيلية وليست بديلاً عن البيانات الحالية؛ عند التعارض نعتمد سجلات المتجر.");
  }
  if(ws){
   const queued=supportQueue.filter(x=>!["done","completed","sent","cancelled"].includes(String(x.state||"").toLowerCase()));
   lines.push("طابور المساندة الآلية: "+supportQueue.length+" سجل، غير محسوم: "+queued.length);
   for(const item of queued.slice(0,12))lines.push((item.ticket_code||"بدون رقم")+" | "+item.state+" | "+(item.reason||"سبب غير مسجل")+" | محاولات: "+(item.attempts??0));
  }
  if(wl){
   const balances=loyalty.reduce((sum,x)=>sum+n(x.points_balance),0),lifetime=loyalty.reduce((sum,x)=>sum+n(x.lifetime_earned),0);
   lines.push("\n🏅 BARAN CLUB — قراءة فقط","حسابات الولاء: "+loyalty.length,"مجموع النقاط الحالية: "+balances,"إجمالي النقاط المكتسبة مدى الحياة: "+lifetime,"قسائم الولاء: "+loyaltyCoupons.length+" | حسب الحالة: "+fmt(countBy(loyaltyCoupons,x=>String(x.status||"غير محدد"))),"حركات النقاط ضمن العينة: "+loyaltyTransactions.length+" | "+fmt(countBy(loyaltyTransactions,x=>String(x.transaction_type||"غير محدد"))));
  }
  if(wn){
   lines.push("\n🔔 الإشعارات والتسليم — قراءة فقط","سجلات تسليم Push: "+pushLogs.length+" | الحالات: "+fmt(countBy(pushLogs,x=>String(x.status||"غير محدد"))));
   const failedPush=pushLogs.filter(x=>["failed","error","expired"].includes(String(x.status||"").toLowerCase()));
   for(const p of failedPush.slice(0,15))lines.push("فشل تسليم: "+p.created_at+" | "+(p.error_code||"بدون رمز خطأ")+" | HTTP "+(p.http_status??"—"));
  }
  if(wplan){
   lines.push("\n🗂️ خطة العمل الإدارية — قراءة فقط","المهام المسجلة: "+workPlan.length+" | الحالات: "+fmt(countBy(workPlan,x=>String(x.status||"غير محدد"))));
   for(const p of workPlan.slice(0,20))lines.push((p.task_code||"مهمة")+" | "+p.title+" | "+p.area+" | "+p.priority+" | "+p.status+" | التالي: "+(p.next_step||"غير محدد")+" | يحتاج موافقة: "+(p.requires_approval?"نعم":"لا"));
  }
  if(wsec){
   lines.push("\n🛡️ الأحداث الأمنية","أحداث أمان العملاء ضمن العينة: "+securityEvents.length+" | الشدة: "+fmt(countBy(securityEvents,x=>String(x.severity||"غير محدد"))));
   for(const e of securityEvents.slice(0,20))lines.push(e.created_at+" | "+e.event_type+" | "+e.severity);
  }
  if(wsec){
   lines.push("\n🛡️ سجل التدقيق","أحدث السجلات المتاحة: "+audit.length);
   for(const a of audit.slice(0,20))lines.push(a.created_at+" | "+a.action+" | "+(a.entity_type||"غير محدد"));
   if(!audit.length)lines.push("لا توجد سجلات تدقيق ظاهرة في العينة أو تعذر تحميلها.");
  }
  if(wr){
   lines.push("\n⭐ التقييمات","إجمالي التقييمات: "+reviews.length+"، pending: "+reviews.filter(x=>x.status==="pending").length+"، approved: "+reviews.filter(x=>x.status==="approved").length+"، rejected: "+reviews.filter(x=>x.status==="rejected").length);
   for(const r of reviews.slice(0,20))lines.push((r.ticket_code||String(r.id).slice(0,8))+" | "+(r.rating??"بدون درجة")+" | "+r.status+" | "+String(r.message||"").replace(/\s+/g," ").slice(0,160));
  }
  if(unavailable.length)lines.push("\n⚠️ أقسام تعذر تحميلها: "+unavailable.join("، "),"الأرقام تخص الأقسام التي نجح تحميلها فقط؛ لم أعتبر القسم المتعذر فارغاً.");
  lines.push("\n🔒 قراءة فقط: لا تعديل منتجات أو طلبات أو موردين، لا ردود دعم، لا اعتماد إيداعات، لا أرصدة أو استردادات، ولا اتصال بمورد.");
  const {error:usageLogError}=await db.from("admin_audit_log").insert({
   admin_id:authData.user.id,action:"baran_ai_usage",entity_type:"assistant_usage",
   details:{route:"offline",units:1}
  });
  if(usageLogError)console.error("baran-admin-offline usage counter insert failed",usageLogError.message);
  return reply({success:true,mode:"offline_readonly",engine:"baran-internal-rules-v2",reply:lines.join("\n"),data_updated_at:now,counts:{products:products.length,orders:orders.length,general_orders:baseOrders.length,baro_manual_orders:manualOrders.length,suppliers:suppliers.length,supplier_links:links.length,open_tickets:openTickets.length,pending_deposits:pendingDeposits.length,reviews:reviews.length,loyalty_accounts:loyalty.length},unavailable});
 }catch(e){console.error("baran-admin-offline error",e instanceof Error?e.message:"unknown");return reply({error:"تعذر تجهيز التقرير الاحتياطي. تحقق من سجل الدالة ثم أعد المحاولة."},500);}
});