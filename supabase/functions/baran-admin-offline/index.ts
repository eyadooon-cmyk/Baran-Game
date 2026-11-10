import { createClient } from "npm:@supabase/supabase-js@2";
const ORIGIN = "https://eyadooon-cmyk.github.io";
const headers = {"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin","Content-Type":"application/json","Cache-Control":"no-store"};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
const n=(v:unknown)=>{const x=Number(v??0);return Number.isFinite(x)?x:0;};
const money=(v:number,c:string)=>new Intl.NumberFormat("en-US",{maximumFractionDigits:2}).format(v)+" "+c;
const countBy=(rows:any[],key:(r:any)=>string)=>{const out:Record<string,number>={};for(const r of rows){const k=key(r)||"غير محدد";out[k]=(out[k]||0)+1;}return out;};
const fmt=(o:Record<string,number>)=>Object.entries(o).length?Object.entries(o).map(([k,v])=>k+": "+v).join("، "):"لا توجد سجلات";
const has=(q:string,words:string[])=>words.some(w=>q.includes(w));
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS"){const o=req.headers.get("Origin");if(o&&o!==ORIGIN)return new Response("Forbidden",{status:403});return new Response("ok",{headers});}
 if(req.method!=="POST")return reply({error:"Method not allowed"},405);
 const origin=req.headers.get("Origin");if(origin&&origin!==ORIGIN)return reply({error:"Origin not allowed"},403);
 try{
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
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
   db.from("order_fulfillment").select("order_id,supplier_id,supplier_status,dispatch_state,refund_status,supplier_total_cost,supplier_cost_currency,supplier_cost_exchange_rate,failure_reason,updated_at").order("updated_at",{ascending:false}).limit(200),
   db.from("suppliers").select("id,name,is_active,updated_at").order("created_at",{ascending:false}).limit(100),
   db.from("supplier_products").select("id,supplier_id,product_id,supplier_sku,unit_cost,currency,is_preferred,lead_time_hours,updated_at").order("updated_at",{ascending:false}).limit(200),
   db.from("customer_feedback").select("id,ticket_code,feedback_type,subject,message,rating,status,admin_reply,created_at,updated_at").order("created_at",{ascending:false}).limit(200),
   db.from("deposit_requests").select("id,status,currency,created_at").order("created_at",{ascending:false}).limit(200),
   db.from("admin_audit_log").select("action,entity_type,created_at").order("created_at",{ascending:false}).limit(30),
   db.from("store_announcements").select("kind,title,status,created_at,published_at,notification_count").order("created_at",{ascending:false}).limit(30)
  ]);
  const labels=["products","orders","fulfillment","suppliers","supplier_products","feedback","deposits","audit","announcements"],data:Record<string,any[]>={},unavailable:string[]=[];
  specs.forEach((r:any,i:number)=>{if(r.error){data[labels[i]]=[];unavailable.push(labels[i]);}else data[labels[i]]=r.data||[];});
  const products=data.products,orders=data.orders,fulfillment=data.fulfillment,suppliers=data.suppliers,links=data.supplier_products,feedback=data.feedback,deposits=data.deposits,audit=data.audit,announcements=data.announcements;
  const openTickets=feedback.filter(x=>x.feedback_type==="support"&&["pending","in_progress"].includes(x.status));
  const reviews=feedback.filter(x=>x.feedback_type==="review"),failed=orders.filter(x=>["failed","error"].includes(String(x.status).toLowerCase()));
  const waiting=orders.filter(x=>["pending","processing"].includes(String(x.status).toLowerCase()));
  const inactive=products.filter(x=>x.is_active!==true),missingPrices=products.filter(x=>x.price_usd==null&&x.price_syp==null);
  const missingCosts=fulfillment.filter(x=>x.supplier_total_cost==null),unlinked=products.filter(p=>!links.some(l=>l.product_id===p.id));
  const pendingDeposits=deposits.filter(x=>x.status==="pending"),statusCounts=countBy(orders,x=>String(x.status||"غير محدد"));
  const categories=countBy(products,x=>String(x.category||"غير محدد"));
  const supplierName=new Map(suppliers.map(s=>[s.id,s.name])),productName=new Map(products.map(p=>[p.id,p.name]));
  const now=new Date().toISOString(),q=question.toLowerCase(),lines:string[]=[];
  lines.push("🟣 تقرير Baran Game — وضع العمل دون OpenAI","وقت قراءة البيانات: "+new Date(now).toLocaleString("ar"),"قراءة مباشرة للبيانات الحالية، وليست مراقبة مستمرة.","");
  const wp=has(q,["منتج","المنتجات","كتالوج","أسعار","سعر"]),wo=has(q,["طلب","الطلبات","شحن","تنفيذ"]),ws=has(q,["تذكرة","تذاكر","دعم","زبون","شكاوى","شكوى"]),wsp=has(q,["مورد","الموردين","موردين","api","ربط"]),wf=has(q,["مالي","مالية","مبيعات","أرباح","ربح","تكلفة","تكاليف","إيراد"]),wsec=has(q,["أمان","أمني","تدقيق","سجل العمليات","مخاطر"]),wr=has(q,["تقييم","تقييمات","آراء"]);
  const general=has(q,["حالة","تقرير","ملخص","المتجر","كل","شامل","الوضع","داشبورد","dashboard"]),special=wp||wo||ws||wsp||wf||wsec||wr;
  if(general||!special){
   lines.push("📊 الملخص التنفيذي","المنتجات: "+products.length+" (نشطة "+products.filter(x=>x.is_active===true).length+"، غير نشطة "+inactive.length+")",
    "الطلبات ضمن آخر 200 سجل: "+orders.length+" — "+fmt(statusCounts),
    "الموردون: "+suppliers.length+" (نشط "+suppliers.filter(x=>x.is_active===true).length+")",
    "روابط المورد/المنتج: "+links.length,"تذاكر الدعم المفتوحة: "+openTickets.length,
    "الإيداعات المعلقة: "+pendingDeposits.length+" (عدد فقط؛ لا مراجعة أو اعتماد)",
    "التقييمات: "+reviews.length+" (بانتظار المراجعة "+reviews.filter(x=>x.status==="pending").length+")",
    "الإعلانات ضمن العينة: "+announcements.length,"","🚦 أولويات تستحق الفحص");
   const risks:string[]=[];
   if(failed.length)risks.push("طلبات فاشلة ضمن أحدث السجلات: "+failed.length);
   if(waiting.length)risks.push("طلبات pending/processing: "+waiting.length+" — يلزم التأكد من تنفيذ المورد");
   if(openTickets.length)risks.push("تذاكر دعم مفتوحة: "+openTickets.length);
   if(unlinked.length)risks.push("منتجات بلا ربط مورد: "+unlinked.length);
   if(missingCosts.length)risks.push("سجلات تنفيذ بلا تكلفة مورد: "+missingCosts.length);
   if(missingPrices.length)risks.push("منتجات بلا سعر في العملتين: "+missingPrices.length);
   if(pendingDeposits.length)risks.push("إيداعات تنتظر مراجعة بشرية: "+pendingDeposits.length);
   if(!risks.length)risks.push("لم تظهر مؤشرات ضمن القوائم المختصرة؛ هذا لا يثبت خلو المتجر من المشاكل.");
   risks.slice(0,8).forEach((x,i)=>lines.push((i+1)+". "+x));
   lines.push("","تصنيفات المنتجات: "+fmt(categories));
  }
  if(wp){
   lines.push("\n🛍️ تدقيق المنتجات","عدد المنتجات: "+products.length+"، النشطة: "+(products.length-inactive.length)+"، غير النشطة: "+inactive.length);
   if(missingPrices.length)lines.push("بلا سعر USD وSYP: "+missingPrices.map(p=>p.product_code+" — "+p.name).slice(0,15).join("؛ "));
   if(unlinked.length)lines.push("بلا ربط مورد: "+unlinked.map(p=>p.product_code+" — "+p.name).slice(0,15).join("؛ "));
   lines.push(products.slice(0,30).map(p=>p.product_code+" — "+p.name+" | "+p.category+" | "+(p.is_active?"نشط":"غير نشط")+" | USD "+(p.price_usd??"—")+" | SYP "+(p.price_syp??"—")).join("\n")||"لا توجد منتجات.");
  }
  if(wo){
   lines.push("\n📦 متابعة الطلبات","الحالات: "+fmt(statusCounts));
   const attention=orders.filter(x=>["pending","processing","failed","error"].includes(String(x.status).toLowerCase())).slice(0,25);
   for(const o of attention){const f=fulfillment.find(x=>x.order_id===o.id);lines.push(String(o.id).slice(0,8)+" | "+o.product_code+" × "+o.quantity+" | "+o.status+" | تنفيذ المورد: "+(f?.dispatch_state||f?.supplier_status||"لا يوجد سجل تنفيذ"));}
   if(!attention.length)lines.push("لا توجد طلبات معلقة أو فاشلة ضمن آخر 200 سجل.");
  }
  if(ws){
   lines.push("\n🎧 تذاكر الدعم المفتوحة","عدد التذاكر المفتوحة: "+openTickets.length);
   for(const t of openTickets.slice(0,25)){lines.push((t.ticket_code||String(t.id).slice(0,8))+" | "+(t.subject||"بدون عنوان")+" | "+t.status+" | "+String(t.message||"").replace(/\s+/g," ").slice(0,180));if(t.admin_reply)lines.push("آخر رد إداري مسجل: "+String(t.admin_reply).slice(0,120));}
   if(!openTickets.length)lines.push("لا توجد تذاكر دعم مفتوحة ضمن آخر 200 سجل.");
  }
  if(wsp){
   lines.push("\n🔌 الموردون والربط","الموردون: "+suppliers.length+"، روابط المنتجات: "+links.length);
   for(const s of suppliers)lines.push("مورد: "+s.name+" | "+(s.is_active?"نشط":"غير نشط"));
   for(const l of links.slice(0,50))lines.push((productName.get(l.product_id)||"منتج غير معروف")+" ← "+(supplierName.get(l.supplier_id)||"مورد غير معروف")+" | SKU: "+(l.supplier_sku||"غير محدد")+" | التكلفة: "+(l.unit_cost??"غير محددة")+" "+(l.currency||"")+" | "+(l.is_preferred?"مفضل":"عادي"));
   if(!links.length)lines.push("لا توجد روابط مورد/منتج مسجلة حالياً.");
   lines.push("وجود ربط في قاعدة البيانات لا يعني وجود API فعلي أو شحن تلقائي.");
  }
  if(wf){
   lines.push("\n💰 قراءة مالية أولية — لا حركة مالية");
   const usd=orders.reduce((s,o)=>s+n(o.total_price_usd),0),syp=orders.reduce((s,o)=>s+n(o.total_price_syp),0);
   const cu=fulfillment.filter(f=>f.supplier_cost_currency==="USD").reduce((s,f)=>s+n(f.supplier_total_cost),0);
   const cs=fulfillment.filter(f=>f.supplier_cost_currency==="SYP").reduce((s,f)=>s+n(f.supplier_total_cost),0);
   lines.push("إجمالي قيم الطلبات في العينة: "+money(usd,"USD")+"، "+money(syp,"SYP"));
   lines.push("تكاليف المورد المسجلة: "+money(cu,"USD")+"، "+money(cs,"SYP"));
   lines.push("لا أصف الفرق بأنه صافي ربح: العينة آخر 200 سجل وقد لا تشمل المصاريف أو المرتجعات أو كل التكاليف.");
   lines.push("الطلبات حسب الحالة: "+fmt(statusCounts));
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
  return reply({success:true,mode:"offline_readonly",reply:lines.join("\n"),data_updated_at:now,counts:{products:products.length,orders:orders.length,suppliers:suppliers.length,supplier_links:links.length,open_tickets:openTickets.length,pending_deposits:pendingDeposits.length,reviews:reviews.length},unavailable});
 }catch(e){console.error("baran-admin-offline error",e instanceof Error?e.message:"unknown");return reply({error:"تعذر تجهيز التقرير الاحتياطي. تحقق من سجل الدالة ثم أعد المحاولة."},500);}
});