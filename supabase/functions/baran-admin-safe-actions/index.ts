import { createClient } from "npm:@supabase/supabase-js@2";
const headers = {"Access-Control-Allow-Origin":"https://eyadooon-cmyk.github.io","Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin","Content-Type":"application/json","Cache-Control":"no-store"};
const productFields = new Set(["name","description","category","sort_order","is_active","price_usd","price_syp"]);
const categories = new Set(["game","ai","vpn","gift_card","app"]);
const ticketFields = new Set(["status"]);
const reviewFields = new Set(["status"]);
const reviewStatuses = new Set(["approved","rejected"]);
const ticketStatuses = new Set(["pending","in_progress","completed"]);
const supplierFields = new Set(["name","notes","is_active"]);
const fulfillmentFields = new Set(["internal_notes"]);
const supplierProductFields = new Set(["notes","supplier_sku","unit_cost","currency","is_preferred","lead_time_hours"]);
function validOrderStatus(v:unknown):boolean { return v==="processing" || v==="failed"; }
function validOrderTransition(from:unknown,to:unknown):boolean { return (from==="pending" && to==="processing") || (from==="processing" && to==="failed"); }
const announcementKinds = new Set(["maintenance","service_notice","service_restored"]);
function validAnnouncement(k:string,v:unknown):boolean { if(k==="kind") return typeof v==="string" && announcementKinds.has(v); if(k==="title") return typeof v==="string" && v.trim().length>=2 && v.trim().length<=120; if(k==="body") return typeof v==="string" && v.trim().length>=1 && v.trim().length<=500; return false; }
function validFulfillment(k:string,v:unknown):boolean { return fulfillmentFields.has(k) && k==="internal_notes" && typeof v==="string" && v.length<=2000; }
function validSupplierProduct(k:string,v:unknown):boolean {
 if(!supplierProductFields.has(k)) return false;
 if(k==="notes") return typeof v==="string" && v.length<=2000;
 if(k==="supplier_sku") return v===null || (typeof v==="string" && v.trim().length<=120);
 if(k==="unit_cost") return typeof v==="number" && Number.isFinite(v) && v>=0 && v<=100000000;
 if(k==="currency") return v==="USD" || v==="SYP";
 if(k==="is_preferred") return typeof v==="boolean";
 if(k==="lead_time_hours") return v===null || (Number.isInteger(v) && Number(v)>=0 && Number(v)<=8760);
 return false;
}
function validSupplierProductCreate(c:any):boolean {
 const allowed=["supplier_id","product_id","supplier_sku","unit_cost","currency","is_preferred","lead_time_hours","notes"];
 if(!c || typeof c!=="object" || Array.isArray(c) || Object.keys(c).length!==8 || Object.keys(c).some(k=>!allowed.includes(k))) return false;
 return typeof c.supplier_id==="string" && /^[0-9a-f-]{36}$/i.test(c.supplier_id) &&
  typeof c.product_id==="string" && /^[0-9a-f-]{36}$/i.test(c.product_id) &&
  (c.supplier_sku===null || (typeof c.supplier_sku==="string" && c.supplier_sku.trim().length<=120)) &&
  typeof c.unit_cost==="number" && Number.isFinite(c.unit_cost) && c.unit_cost>=0 && c.unit_cost<=100000000 &&
  (c.currency==="USD" || c.currency==="SYP") && typeof c.is_preferred==="boolean" &&
  (c.lead_time_hours===null || (Number.isInteger(c.lead_time_hours) && c.lead_time_hours>=0 && c.lead_time_hours<=8760)) &&
  typeof c.notes==="string" && c.notes.length<=2000;
}
function validSupplier(k:string,v:unknown):boolean {
 if(!supplierFields.has(k)) return false;
 if(k==="name") return typeof v==="string" && v.trim().length>=2 && v.trim().length<=120;
 if(k==="notes") return typeof v==="string" && v.length<=2000;
 if(k==="is_active") return typeof v==="boolean";
 return false;
}
const reply = (x: unknown, status=200) => new Response(JSON.stringify(x),{status,headers});
function validProductCreate(c:any):boolean {
 const allowed=["product_code","name","description","category","sort_order","is_active","price_usd","price_syp"];
 if(!c||typeof c!=="object"||Array.isArray(c)||Object.keys(c).length!==8||Object.keys(c).some(k=>!allowed.includes(k)))return false;
 const price=(v:any)=>v===null||(typeof v==="number"&&Number.isFinite(v)&&v>=0&&v<=100000000);
 return typeof c.product_code==="string"&&/^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(c.product_code)&&
  typeof c.name==="string"&&c.name.trim().length>=2&&c.name.trim().length<=120&&
  typeof c.description==="string"&&c.description.length<=500&&categories.has(c.category)&&
  Number.isInteger(c.sort_order)&&c.sort_order>=0&&c.sort_order<=100000&&
  c.is_active===false&&price(c.price_usd)&&price(c.price_syp);
}
function validProduct(k:string,v:unknown):boolean {
 if (!productFields.has(k)) return false;
 if(k==="name") return typeof v==="string" && v.trim().length>=2 && v.trim().length<=120;
 if(k==="description") return typeof v==="string" && v.length<=500;
 if(k==="category") return typeof v==="string" && categories.has(v);
 if(k==="sort_order") return Number.isInteger(v) && Number(v)>=0 && Number(v)<=100000;
 if(k==="is_active") return typeof v==="boolean";
 if(k==="price_usd" || k==="price_syp") return v===null || (typeof v==="number" && Number.isFinite(v) && v>=0 && v<=100000000);
 return false;
}
function validTicket(k:string,v:unknown):boolean {
 return ticketFields.has(k) && k==="status" && typeof v==="string" && ticketStatuses.has(v);
}
function validReview(k:string,v:unknown):boolean {
 return reviewFields.has(k) && k==="status" && typeof v==="string" && reviewStatuses.has(v);
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS"){const o=req.headers.get("Origin");if(o&&o!=="https://eyadooon-cmyk.github.io")return new Response("Forbidden",{status:403});return new Response("ok",{headers});}
 if(req.method!=="POST")return reply({error:"Method not allowed"},405);
 const origin=req.headers.get("Origin");if(origin&&origin!=="https://eyadooon-cmyk.github.io")return reply({error:"Origin not allowed"},403);
 try{
  const url=Deno.env.get("SUPABASE_URL"), anon=Deno.env.get("SUPABASE_ANON_KEY"), service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), aiKey=Deno.env.get("OPENAI_API_KEY");
  if(!url||!anon||!service)return reply({error:"Server configuration incomplete"},500);
  const auth=req.headers.get("Authorization")||"",token=auth.startsWith("Bearer ")?auth.slice(7):"";
  if(!token)return reply({error:"Authentication required"},401);
  const authClient=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:authData,error:authErr}=await authClient.auth.getUser(token);
  if(authErr||!authData.user)return reply({error:"Invalid session"},401);
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:isAdmin,error:adminErr}=await db.rpc("admin_is_user",{p_user_id:authData.user.id});
  if(adminErr||isAdmin!==true)return reply({error:"Administrator access required"},403);
  const body=await req.json().catch(()=>null);
  if(!body||!["plan","execute"].includes(body.mode))return reply({error:"Invalid request"},400);

  if(body.mode==="plan"){
   const command=typeof body.command==="string"?body.command.trim().slice(0,700):"";
   if(command.length<5)return reply({error:"اكتب وصفاً واضحاً للمهمة."},400);
   const [{data:productRows,error:productErr},{data:ticketRows,error:ticketErr},{data:reviewRows,error:reviewErr},{data:supplierRows,error:supplierErr},{data:fulfillmentRows,error:fulfillmentErr},{data:supplierProductRows,error:supplierProductErr},{data:orderRows,error:orderErr},{data:announcementRows,error:announcementErr}]=await Promise.all([
    db.from("products").select("id,product_code,name,description,category,sort_order,is_active,price_usd,price_syp,updated_at").order("sort_order").limit(100),
    db.from("customer_feedback").select("id,ticket_code,subject,message,status,updated_at").eq("feedback_type","support").order("created_at",{ascending:false}).limit(100),
    db.from("customer_feedback").select("id,ticket_code,subject,message,rating,status,updated_at").eq("feedback_type","review").order("created_at",{ascending:false}).limit(100),
    db.from("suppliers").select("id,name,notes,is_active,updated_at").order("created_at",{ascending:false}).limit(100),
    db.from("order_fulfillment").select("order_id,internal_notes,supplier_status,dispatch_state,refund_status,updated_at").order("updated_at",{ascending:false}).limit(100),
    db.from("supplier_products").select("id,supplier_id,product_id,supplier_sku,unit_cost,currency,is_preferred,lead_time_hours,notes,updated_at").order("updated_at",{ascending:false}).limit(100),
    db.from("orders").select("id,product_code,quantity,status,created_at").order("created_at",{ascending:false}).limit(100),
    db.from("store_announcements").select("id,kind,title,body,status,created_at,updated_at,published_at,notification_count").order("created_at",{ascending:false}).limit(30)
   ]);
   if(productErr||ticketErr||reviewErr||supplierErr||fulfillmentErr||supplierProductErr||orderErr||announcementErr)return reply({error:"تعذر تحميل بيانات أحد أقسام الإدارة."},502);
   const products=(productRows||[]).map((p:any)=>({id:p.id,product_code:p.product_code,name:p.name,description:p.description,category:p.category,sort_order:p.sort_order,is_active:p.is_active,price_usd:p.price_usd,price_syp:p.price_syp,updated_at:p.updated_at}));
   const tickets=(ticketRows||[]).map((t:any)=>({id:t.id,ticket_key:t.ticket_code||t.id,subject:t.subject||"بدون عنوان",message:String(t.message||"").slice(0,1200),status:t.status,updated_at:t.updated_at}));
   const reviews=(reviewRows||[]).map((v:any)=>({id:v.id,ticket_key:v.ticket_code||v.id,subject:v.subject||"تقييم بدون عنوان",message:String(v.message||"").slice(0,1200),rating:v.rating,status:v.status,updated_at:v.updated_at}));
   const suppliers=(supplierRows||[]).map((v:any)=>({id:v.id,name:v.name,notes:v.notes,is_active:v.is_active,updated_at:v.updated_at}));
   const fulfillment=(fulfillmentRows||[]).map((v:any)=>({order_id:v.order_id,internal_notes:v.internal_notes,supplier_status:v.supplier_status,dispatch_state:v.dispatch_state,refund_status:v.refund_status,updated_at:v.updated_at}));
   const supplierProducts=(supplierProductRows||[]).map((v:any)=>({id:v.id,supplier_id:v.supplier_id,product_id:v.product_id,supplier_sku:v.supplier_sku,unit_cost:v.unit_cost,currency:v.currency,is_preferred:v.is_preferred,lead_time_hours:v.lead_time_hours,notes:v.notes,updated_at:v.updated_at}));
   const orders=(orderRows||[]).map((v:any)=>({id:v.id,product_code:v.product_code,quantity:v.quantity,status:v.status,created_at:v.created_at}));
   const announcements=(announcementRows||[]).map((v:any)=>({id:v.id,kind:v.kind,title:v.title,body:v.body,status:v.status,created_at:v.created_at,updated_at:v.updated_at,published_at:v.published_at,notification_count:v.notification_count}));
   let instructions = 'أنت مخطط مهام إدارية آمنة لمتجر Baran Game. افهم العربية واللهجة. أخرج JSON صالحاً فقط بأحد الأشكال: {"target_type":"product","target_key":"رمز منتج موجود حرفياً","changes":{"field":"value"},"reason":"سبب مختصر"} أو {"target_type":"ticket","target_key":"رمز تذكرة أو UUID موجود حرفياً","changes":{"status":"pending|in_progress|completed"},"reason":"سبب مختصر"} أو {"target_type":"review","target_key":"رمز تقييم أو UUID موجود حرفياً","changes":{"status":"approved|rejected"},"reason":"سبب مختصر"} أو {"target_type":"supplier","target_key":"اسم مورد موجود حرفياً كما يظهر بالقائمة","changes":{"notes":"ملاحظات جديدة"},"reason":"سبب مختصر"} أو {"target_type":"supplier","target_key":"اسم مورد موجود حرفياً كما يظهر بالقائمة","changes":{"name":"اسم جديد"},"reason":"سبب مختصر"} أو {"target_type":"supplier","target_key":"اسم مورد موجود حرفياً كما يظهر بالقائمة","changes":{"is_active":false},"reason":"سبب مختصر"} أو {"target_type":"order_status","target_key":"UUID طلب موجود حرفياً","changes":{"status":"processing|failed"},"reason":"سبب مختصر"} أو {"target_type":"announcement_create","target_key":"عنوان الإعلان","changes":{"kind":"maintenance|service_notice|service_restored","title":"عنوان 2-120 حرفاً","body":"نص 1-500 حرف"},"reason":"سبب مختصر"} أو {"target_type":"announcement_publish","target_key":"UUID مسودة موجودة","changes":{"status":"published"},"reason":"سبب مختصر"} أو {"target_type":"product_create","target_key":"رمز منتج جديد فريد","changes":{"product_code":"CODE_123","name":"اسم المنتج","description":"وصف","category":"game|ai|vpn|gift_card|app","sort_order":100,"is_active":false,"price_usd":null,"price_syp":null},"reason":"سبب مختصر"} أو {"target_type":"supplier_create","target_key":"اسم المورد الجديد","changes":{"name":"اسم المورد","notes":"ملاحظات عامة غير سرية","is_active":true},"reason":"سبب مختصر"}. اختر سجلاً واحداً فقط من القوائم، ولا تخترع سجلاً موجوداً. إنشاء مورد مسموح فقط إذا طلب المدير صراحة إضافة/تسجيل مورد جديد. الموردون: يسمح فقط name وnotes وis_active. لا تطلب أو تكتب contact_name أو contact_phone أو contact_email أو بيانات اتصال شخصية. لا تسمح بمفاتيح API أو عناوين API أو أسرار أو تكاليف أو عملات أو ربط منتجات بالمورد أو رصيد المورد أو إعدادات التكامل. لا تعدل مورداً موجوداً إلا إذا كان موجوداً بالقائمة. للمنتجات الحقول المسموحة: name, description, category, sort_order, is_active, price_usd, price_syp. لا تخترع سعراً؛ لا تغيّر السعر إلا إذا حدده المدير صراحةً، وأي تغيير سعر يحتاج معاينة وموافقة. عند إنشاء منتج جديد، لا تنشئه إلا إذا طلب المدير الإضافة صراحة. أنشئه غير نشط دائماً، واجعل السعرين null ما لم يذكر المدير سعراً صريحاً. أنشئ product_code فريداً من 3 إلى 40 حرفاً باستخدام أحرف إنجليزية كبيرة وأرقام وشرطة أو underscore، ولا تكرر رمزاً موجوداً. لا تنشر المنتج مباشرة. للتذاكر الحقل المسموح الوحيد status، والقيم المسموحة pending أو in_progress أو completed. لا تغيّر حالة التذكرة إلى completed إلا إذا طلب المدير إغلاقها صراحة. تغيير حالة التذكرة قد يرسل إشعاراً للزبون. لا تكتب ردوداً للزبائن ولا تغيّر admin_reply. للطلبيات: يسمح فقط بنقل طلب pending إلى processing أو processing إلى failed. لا تسمح completed أو fulfilled أو delivered أو cancelled أو أي حالة أخرى، ولا تغيّر بيانات الشحن أو الاسترداد أو أي بيانات مالية. تغيير حالة الطلب قد يرسل إشعاراً للزبون. الإعلان الجديد يُنشأ كمسودة فقط ولا يُرسل. لا تختَر announcement_publish إلا إذا طلب المدير صراحة نشر/إرسال مسودة موجودة، والنشر يرسل إشعاراً لكل حساب زبون غير إداري. استخدم مسودة موجودة حرفياً فقط ولا تنشئ إعلاناً منشوراً مباشرة. لا تنفذ شيئاً. ممنوع الأسعار والأرصدة والإيداعات والاستردادات والدفع وسعر الصرف والصلاحيات والمفاتيح. إذا كان الطلب غامضاً أو غير مسموح فأخرج {"error":"سبب الرفض"}. JSON فقط.';
   instructions += " يسمح أيضاً بتعديل ملاحظة داخلية فقط لسجل تنفيذ طلب موجود باستخدام target_type=fulfillment_note وtarget_key يساوي order_id حرفياً وchanges={internal_notes: نص}. ويسمح بتعديل notes فقط لسجل ربط مورد-منتج موجود باستخدام target_type=supplier_product_note وtarget_key يساوي UUID سجل الربط حرفياً وchanges={notes: نص}. لا تغيّر حالة الطلب أو المورد أو حالة التنفيذ أو الاسترداد أو التكاليف أو العملة أو SKU أو أولوية المورد أو مهلة التنفيذ أو أي إعداد API. استخدم سجلاً موجوداً فقط. يسمح بإنشاء ربط مورد-منتج عند طلب المدير ذلك صراحةً باستخدام target_type=supplier_product_create وحقول supplier_id وproduct_id وsupplier_sku (أو null) وunit_cost وcurrency (USD أو SYP) وis_preferred وlead_time_hours (أو null) وnotes. يجب اختيار المورد والمنتج من القوائم الحالية حرفياً، وعدم اختراع UUID أو تكلفة. يسمح بتعديل حقل واحد فقط في ربط موجود عبر target_type=supplier_product: supplier_sku أو unit_cost أو currency أو is_preferred أو lead_time_hours أو notes. تعديل تكلفة الشراء أو المورد المفضل يحتاج معاينة وموافقة صريحة. لا تتصل بالمورد ولا ترسل طلب شحن ولا تغيّر رصيد المورد."; 
   const lowerCommand=command.toLowerCase();
   const wants=(re:RegExp)=>re.test(lowerCommand);
   const pick=(rows:any[],keys:string[],limit=12)=>{
    const hits=rows.filter((row:any)=>keys.some(k=>String(row[k]??"").toLowerCase().split(/\\s+/).some((word:string)=>word.length>2&&lowerCommand.includes(word))));
    return (hits.length?hits:rows).slice(0,limit);
   };
   const context:any={};
   if(wants(/مورد|موردين|supplier|rtc market/)) context.suppliers=pick(suppliers,["name","notes"],15);
   if(wants(/منتج|منتجات|product|pubg|free fire|chatgpt|google play/)) context.products=pick(products,["name","product_code","description"],15);
   if(wants(/تذكر|تذكرة|دعم|ticket|support/)) context.tickets=pick(tickets,["ticket_key","subject","message"],8);
   if(wants(/تقييم|مراجعة|review/)) context.reviews=pick(reviews,["ticket_key","subject","message"],8);
   if(wants(/تنفيذ|ملاحظة طلب|fulfillment/)) context.fulfillment=pick(fulfillment,["order_id","internal_notes"],8);
   if(wants(/ربط|supplier.product|ربط المورد/)) context.supplierProducts=pick(supplierProducts,["id","notes"],8);
   if(wants(/طلب|طلبات|order/)) context.orders=pick(orders,["id","product_code","status"],8);
   if(wants(/إعلان|اعلان|صيانة|خدمة|announcement/)) context.announcements=pick(announcements,["id","title","body","status"],8);
   if(Object.keys(context).length===0){
    context.suppliers=suppliers.slice(0,8);context.products=products.slice(0,8);
    context.tickets=tickets.slice(0,4);context.reviews=reviews.slice(0,4);
    context.orders=orders.slice(0,4);context.announcements=announcements.slice(0,4);
   }
   const input="طلب المدير: "+command+"\\nالبيانات ذات الصلة فقط: "+JSON.stringify(context);
   let proposal:any=null;
   // Offline fallback is intentionally used ONLY when OpenAI is unavailable or returns 429.
   const buildOfflineProposal=()=>{
    const normalizeArabic=(v:string)=>String(v||"").toLowerCase().normalize("NFKC").replace(/[\u064B-\u065F\u0670]/g,"").replace(/[أإآ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه").replace(/[ـ]/g," ").replace(/\s+/g," ").trim();
    const normalized=normalizeArabic(command);
    const wantsChange=/(?:فعّل|فعل|نشط|عطّل|عطل|وقف|اغلق|افتح|عالج|وافق|اعتمد|ارفض|انشئ|اضف|اربط|ربط)/u.test(normalized);
    const uuidMatch=command.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
    const reason="اقتراح آلي دون OpenAI؛ راجع المعاينة وأكد قبل الحفظ";
    const newProduct=command.match(/(?:منتج جديد|اضافة منتج|إضافة منتج|انشاء منتج|إنشاء منتج)\s*[:：]\s*([A-Z0-9_-]{3,40})\s*[|،]\s*([^|،]{2,120})\s*[|،]\s*(game|ai|vpn|gift_card|app)\s*[|،]\s*([^|]{0,500})/i);
    if(newProduct){const code=newProduct[1].toUpperCase(),name=newProduct[2].trim(),category=newProduct[3].toLowerCase(),description=newProduct[4].trim();const sort_order=Math.max(0,...products.map((x:any)=>Number(x.sort_order)||0))+1;return {proposal:{target_type:"product_create",target_key:code,changes:{product_code:code,name,description,category,sort_order,is_active:false,price_usd:null,price_syp:null},reason}};}
    const newSupplier=command.match(/(?:مورد جديد|اضافة مورد|إضافة مورد|انشاء مورد|إنشاء مورد)\s*[:：]\s*([^|،؛\n]{2,120})/u);
    if(newSupplier){const name=newSupplier[1].trim();return {proposal:{target_type:"supplier_create",target_key:name,changes:{name,notes:"",is_active:false},reason}};}
    const newAnnouncement=command.match(/(?:اعلان صيانة|إعلان صيانة|انشاء اعلان|إنشاء إعلان|مسودة اعلان|مسودة إعلان)\s*[:：]\s*([^|،؛\n]{2,120})\s*[|،]\s*([\s\S]{1,500})/u);
    if(newAnnouncement){const title=newAnnouncement[1].trim(),body=newAnnouncement[2].trim();return {proposal:{target_type:"announcement_create",target_key:title,changes:{kind:"maintenance",title,body},reason}};}
    const newLink=command.match(/(?:اربط|ربط)\s+المورد\s+(.+?)\s+بالمنتج\s+(.+?)\s+(?:مع\s+)?SKU\s+([^\s،;]+)\s+(?:وتكلفه|وتكلفة|تكلفه|تكلفة)\s*([0-9]+(?:[.,][0-9]+)?)\s*(USD|SYP)/i);
    if(newLink){const sn=normalizeArabic(newLink[1]),pn=normalizeArabic(newLink[2]);const ss=suppliers.filter((x:any)=>normalizeArabic(x.name)===sn),pp=products.filter((x:any)=>normalizeArabic(x.product_code)===pn||normalizeArabic(x.name)===pn);if(ss.length!==1||pp.length!==1)return {error:"استخدم اسم المورد ورمز المنتج المطابقين تماماً للقائمة.",status:409};return {proposal:{target_type:"supplier_product_create",target_key:ss[0].name+" | "+pp[0].product_code,changes:{supplier_id:ss[0].id,product_id:pp[0].id,supplier_sku:newLink[3],unit_cost:Number(newLink[4].replace(",", ".")),currency:newLink[5].toUpperCase(),is_preferred:false,lead_time_hours:null,notes:""},reason}};}
    if(wantsChange){
      const ps=products.filter((x:any)=>x.product_code&&normalized.includes(normalizeArabic(x.product_code)));
      if(ps.length===1){
        const on=/(?:فعّل|فعل|نشط)/u.test(normalized),off=/(?:عطّل|عطل|وقف)/u.test(normalized);
        if(on!==off)return {proposal:{target_type:"product",target_key:ps[0].product_code,changes:{is_active:on},reason}};
        const price=command.match(/(?:السعر|سعر البيع)\s*(?:إلى|الى|هو|=|:)\s*([0-9]+(?:[.,][0-9]+)?)\s*(دولار|usd|ليرة|ليره|syp)/i);
        if(price){const field=/usd|دولار/i.test(price[2])?"price_usd":"price_syp";return {proposal:{target_type:"product",target_key:ps[0].product_code,changes:{[field]:Number(price[1].replace(",", "."))},reason}};}
      }
      const ss=suppliers.filter((x:any)=>normalized.includes(normalizeArabic(x.name)));
      if(ss.length===1){
        const on=/(?:فعّل|فعل|نشط)\s*(?:المورد)?/u.test(normalized),off=/(?:عطّل|عطل|وقف)\s*(?:المورد)?/u.test(normalized);
        if(on!==off)return {proposal:{target_type:"supplier",target_key:ss[0].name,changes:{is_active:on},reason}};
      }
      if(/تذكره|تذكر|دعم|ticket/u.test(normalized)){
        const ts=tickets.filter((x:any)=>uuidMatch?x.id===uuidMatch[0]:(x.ticket_key&&normalized.includes(normalizeArabic(x.ticket_key))));
        if(ts.length!==1)return {error:"حدد تذكرة واحدة برمزها أو UUID.",status:409};
        const status=/(?:اغلق|اكمل|تم الحل|مكتمل)/u.test(normalized)?"completed":/(?:ابدأ|باشر|قيد المعالجه|عالج)/u.test(normalized)?"in_progress":/(?:اعاده فتح|افتح)/u.test(normalized)?"pending":null;
        if(status)return {proposal:{target_type:"ticket",target_key:ts[0].ticket_key,changes:{status},reason}};
        return {error:"حدد حالة التذكرة: قيد المعالجة أو مكتملة أو إعادة فتح.",status:400};
      }
      if(/طلب|طلبات|order/u.test(normalized)){
        if(!uuidMatch)return {error:"تغيير حالة الطلب يتطلب UUID الطلب كاملاً.",status:400};
        const os=orders.filter((x:any)=>x.id===uuidMatch[0]);if(os.length!==1)return {error:"لم أجد طلباً مطابقاً لهذا UUID.",status:404};
        const status=/(?:فشل|فاشل|failed)/u.test(normalized)?"failed":/(?:معالجه|قيد المعالجه|processing)/u.test(normalized)?"processing":null;
        if(!status||!validOrderTransition(os[0].status,status))return {error:"المسموح فقط pending إلى processing أو processing إلى failed.",status:409};
        return {proposal:{target_type:"order_status",target_key:os[0].id,changes:{status},reason}};
      }
      if(/تقييم|review/u.test(normalized)){
        const rs=reviews.filter((x:any)=>uuidMatch?x.id===uuidMatch[0]:(x.ticket_key&&normalized.includes(normalizeArabic(x.ticket_key))));
        if(rs.length!==1)return {error:"حدد تقييماً واحداً برمزه أو UUID.",status:409};
        const status=/(?:وافق|اعتمد|قبول)/u.test(normalized)?"approved":/(?:ارفض|رفض)/u.test(normalized)?"rejected":null;
        if(status)return {proposal:{target_type:"review",target_key:rs[0].ticket_key,changes:{status},reason}};
        return {error:"حدد اعتماد التقييم أو رفضه.",status:400};
      }
    }
    const hasNoteIntent=/(ملاحظه|ملاحظات|سجل|ضيف|اضف|اكتب|دون|وثق|تابع|متابعه)/u.test(normalized);
    const hasSupplierIntent=/(مورد|المورد|موردين|supplier|rtc market)/u.test(normalized);
    const hasFulfillmentIntent=/(تنفيذ|متابعه الطلب|الطلب|طلب رقم|order|fulfillment)/u.test(normalized);
    const hasLinkIntent=/(ربط|الربط|supplier product|supplier_products)/u.test(normalized);
    if(!hasNoteIntent||!(hasSupplierIntent||hasFulfillmentIntent||hasLinkIntent))return {proposal:null};
    const extractNote=(raw:string,entityName="")=>{
     let n=String(raw||"").trim();
     const explicit=n.match(/(?:إنو|انو|انه|إنه|بأن|بان|مفادها|النص التالي)\s*[:،-]?\s*([\s\S]+)$/u);
     if(explicit)n=explicit[1];
     else{
      n=n.replace(/^(?:يا مساعد)?\s*(?:لو سمحت\s*)?(?:ضيف|اضف|سجل|سجّل|اكتب|دون|دوّن|وثق|وثّق|حط|ضع)\s*(?:لي\s*)?(?:ملاحظه|ملاحظات)?\s*(?:على|عن|لـ|ل|بخصوص)?\s*/u,"");
      if(entityName){const at=n.toLowerCase().indexOf(entityName.toLowerCase());if(at>=0)n=n.slice(at+entityName.length);}
      n=n.replace(/^\s*(?:ملاحظه|ملاحظات)?\s*(?:على|عن|بخصوص)?\s*/u,"");
      n=n.replace(/(?:راجع|افحص|افحصلي|دقق|تأكد من|سجل|سجّل|الملاحظات|ملاحظه الربط|ربط المورد بالمنتج)/gu," ").replace(/\s+/g," ").trim();
     }
     return n.replace(/^\s*[:،؛,.-]+\s*/u,"").trim().slice(0,2000);
    };
    const appendNote=(oldValue:unknown,next:string)=>{
     const old=String(oldValue||"").trim();
     if(!old)return next;
     if(normalizeArabic(old).includes(normalizeArabic(next)))return old;
     return (old+"\n"+next).slice(-2000);
    };
    
    let p:any=null;
    if(hasLinkIntent){
     const namedSuppliers=suppliers.filter((s:any)=>normalizeArabic(command).includes(normalizeArabic(s.name)));
     const namedProducts=products.filter((x:any)=>normalizeArabic(command).includes(normalizeArabic(x.name))||(x.product_code&&normalized.includes(normalizeArabic(x.product_code))));
     let candidates=supplierProducts.filter((sp:any)=>(!namedSuppliers.length||namedSuppliers.some((x:any)=>x.id===sp.supplier_id))&&(!namedProducts.length||namedProducts.some((x:any)=>x.id===sp.product_id)));
     if(uuidMatch)candidates=candidates.filter((x:any)=>x.id===uuidMatch[0]);
     if(!namedSuppliers.length&&!namedProducts.length&&!uuidMatch&&supplierProducts.length===1)candidates=supplierProducts;
     if(candidates.length!==1)return {error:candidates.length===0?"ما قدرت أحدد سجل ربط موجود. اذكر اسم المورد واسم المنتج. لم يتم أي تعديل.":"في أكثر من ربط ممكن. حدّد المورد والمنتج المقصودين. لم يتم أي تعديل.",status:409};
     const rec=candidates[0],supplier=suppliers.find((x:any)=>x.id===rec.supplier_id);
     const note=extractNote(command,supplier?.name||"");
     if(note.length<3)return {error:"اكتب نص الملاحظة التي تريد تسجيلها على ربط المورد والمنتج.",status:400};
     p={target_type:"supplier_product_note",target_key:rec.id,changes:{notes:appendNote(rec.notes,note)},reason:"ملاحظة داخلية عبر المسار الاحتياطي عند حد OpenAI"};
    }else if(hasFulfillmentIntent){
     let candidates=fulfillment;
     if(uuidMatch)candidates=candidates.filter((x:any)=>x.order_id===uuidMatch[0]);
     else if(fulfillment.length!==1)candidates=[];
     if(candidates.length!==1)return {error:"ما قدرت أحدد طلباً واحداً. اذكر رقم الطلب أو UUID. لم يتم أي تعديل.",status:409};
     const rec=candidates[0],note=extractNote(command);
     if(note.length<3)return {error:"اكتب نص الملاحظة التي تريد تسجيلها على تنفيذ الطلب.",status:400};
     p={target_type:"fulfillment_note",target_key:rec.order_id,changes:{internal_notes:appendNote(rec.internal_notes,note)},reason:"ملاحظة داخلية عبر المسار الاحتياطي عند حد OpenAI"};
    }else{
     let candidates=suppliers.filter((x:any)=>normalizeArabic(command).includes(normalizeArabic(x.name)));
     if(candidates.length===0&&suppliers.length===1)candidates=suppliers;
     if(candidates.length!==1)return {error:candidates.length===0?"ما قدرت أحدد المورد. اذكر اسمه كما يظهر في القائمة. لم يتم أي تعديل.":"في أكثر من مورد ممكن. حدّد اسم المورد. لم يتم أي تعديل.",status:409};
     const rec=candidates[0],note=extractNote(command,rec.name);
     if(note.length<3)return {error:"اكتب نص الملاحظة التي تريد إضافتها على المورد.",status:400};
     p={target_type:"supplier",target_key:rec.name,changes:{notes:appendNote(rec.notes,note)},reason:"ملاحظة داخلية عبر المسار الاحتياطي عند حد OpenAI"};
    }
    return {proposal:p};
   };
   const useOfflineFallback=()=>{
    const fallback=buildOfflineProposal();
    if(fallback.error)return reply({error:fallback.error,code:"OFFLINE_NEEDS_CLARIFICATION"},fallback.status||400);
    if(!fallback.proposal)return null;
    proposal=fallback.proposal;
    return null;
   };
   const offlinePlanResponse=useOfflineFallback();
   if(offlinePlanResponse)return offlinePlanResponse;
   if(!proposal&&aiKey){
    const ai=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:"Bearer "+aiKey,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-6-luna",instructions,input,max_output_tokens:320,store:false})});
    if(ai.ok){
     const d=await ai.json(),raw=(d.output||[]).filter((x:any)=>x.type==="message").flatMap((x:any)=>x.content||[]).find((x:any)=>x.type==="output_text")?.text;
     try{proposal=JSON.parse(String(raw||""));}catch{return reply({error:"لم أستطع تكوين اقتراح آمن. وضّح العنصر والتغيير."},422);}
    }else{
     const errorText=(await ai.text()).slice(0,1200);
     console.error("safe planner OpenAI error",ai.status,errorText.slice(0,500));
     if(ai.status===429){
      const fallbackResponse=useOfflineFallback();
      if(fallbackResponse)return fallbackResponse;
      if(!proposal)return reply({error:"وصل OpenAI إلى الحد المؤقت، وهذا الطلب ليس من مهام الملاحظات الداخلية التي يدعمها المسار الاحتياطي. لم يتم أي تعديل.",code:"AI_RATE_LIMIT_NO_FALLBACK",retry_after_seconds:ai.headers.get("retry-after")?Number(ai.headers.get("retry-after")):null},429);
     }else{return reply({error:"تعذر الاتصال بالمساعد الذكي حالياً. لم يتم تعديل أي بيانات."},502);}
    }
   }else{
    if(!proposal)return reply({error:"لم أتعرف على أمر واضح دون OpenAI. اذكر العنصر والتغيير بصيغة محددة؛ لم يتم أي تعديل.",code:"OFFLINE_COMMAND_UNSUPPORTED"},422);
   }
   if(proposal.error)return reply({error:String(proposal.error).slice(0,300)},422);
   if(proposal.target_type==="announcement_create"){const c=proposal.changes||{};const es=Object.entries(c);if(typeof proposal.target_key!=="string"||es.length!==3||es.some(([k,v])=>!validAnnouncement(k,v))||String(c.title).trim()!==proposal.target_key.trim())return reply({error:"بيانات مسودة الإعلان غير صالحة."},422);return reply({proposal:{target_type:"announcement_create",target_id:null,target_key:proposal.target_key,target_name:String(c.title).trim(),before:{},changes:{kind:c.kind,title:String(c.title).trim(),body:String(c.body).trim()},reason:String(proposal.reason||"إنشاء مسودة إعلان").slice(0,300)},requires_confirmation:true,notice:"سيتم إنشاء مسودة فقط. لن يصل أي إشعار للزبائن قبل طلب النشر وموافقتك عليه بشكل منفصل."});}
   if(proposal.target_type==="announcement_publish"){const rec=announcements.find((x:any)=>x.id===proposal.target_key);if(!rec||rec.status!=="draft"||Object.keys(proposal.changes||{}).length!==1||proposal.changes.status!=="published")return reply({error:"لا توجد مسودة مطابقة قابلة للنشر."},422);return reply({proposal:{target_type:"announcement_publish",target_id:rec.id,target_key:rec.id,target_name:rec.title,before:{status:rec.status},changes:{status:"published"},reason:String(proposal.reason||"نشر إعلان").slice(0,300),expected_updated_at:rec.updated_at},requires_confirmation:true,notice:"سيتم إرسال إشعار للزبائن غير الإداريين، وقد تصلهم إشعارات الهاتف حسب اشتراكهم. هذا الإجراء لا يمكن التراجع عن إرسال الإشعارات."});}
   if(proposal.target_type==="product_create"){const c=proposal.changes||{};if(!validProductCreate(c)||typeof proposal.target_key!=="string"||proposal.target_key!==c.product_code)return reply({error:"بيانات المنتج الجديد غير صالحة."},422);if(products.some((x:any)=>x.product_code===c.product_code))return reply({error:"رمز المنتج مستخدم مسبقاً. اختر رمزاً آخر."},409);return reply({proposal:{target_type:"product_create",target_id:null,target_key:c.product_code,target_name:String(c.name).trim(),before:{},changes:{...c,name:String(c.name).trim()},reason:String(proposal.reason||"إنشاء منتج جديد").slice(0,300)},requires_confirmation:true,notice:"سيُنشأ المنتج غير نشط وبلا سعر ما لم تحدد السعر صراحة. لن يظهر للزبائن قبل تفعيله وتحديد أسعاره."});}
   if(!["product","ticket","review","supplier","supplier_create","fulfillment_note","supplier_product_note","supplier_product","supplier_product_create","order_status"].includes(proposal.target_type)||typeof proposal.target_key!=="string"||!proposal.changes||typeof proposal.changes!=="object"||Array.isArray(proposal.changes))return reply({error:"الاقتراح غير مكتمل؛ لم يحدث أي تعديل."},422);
   const isProduct=proposal.target_type==="product",isTicket=proposal.target_type==="ticket",isReview=proposal.target_type==="review",isSupplier=proposal.target_type==="supplier",isSupplierCreate=proposal.target_type==="supplier_create",isFulfillmentNote=proposal.target_type==="fulfillment_note",isSupplierProductNote=proposal.target_type==="supplier_product_note",isSupplierProduct=proposal.target_type==="supplier_product",isSupplierProductCreate=proposal.target_type==="supplier_product_create",isOrder=proposal.target_type==="order_status";
   const record=isProduct?products.find((x:any)=>x.product_code===proposal.target_key):isTicket?tickets.find((x:any)=>x.ticket_key===proposal.target_key):isReview?reviews.find((x:any)=>x.ticket_key===proposal.target_key):isSupplier?suppliers.find((x:any)=>x.name===proposal.target_key):isFulfillmentNote?fulfillment.find((x:any)=>x.order_id===proposal.target_key):(isSupplierProductNote||isSupplierProduct)?supplierProducts.find((x:any)=>x.id===proposal.target_key):isOrder?orders.find((x:any)=>x.id===proposal.target_key):null;
   const entries=Object.entries(proposal.changes),validator=isProduct?validProduct:isTicket?validTicket:isReview?validReview:isSupplier?validSupplier:isFulfillmentNote?validFulfillment:(isSupplierProductNote||isSupplierProduct)?validSupplierProduct:validOrderStatus;
   if(isSupplierProductCreate){
    const supplier=suppliers.find((x:any)=>x.id===proposal.changes.supplier_id),product=products.find((x:any)=>x.id===proposal.changes.product_id);
    if(!validSupplierProductCreate(proposal.changes)||!supplier||!product||proposal.target_key!==supplier.name+" | "+product.product_code)return reply({error:"بيانات ربط المورد بالمنتج غير صالحة أو أن المورد/المنتج غير موجود."},422);
    if(supplierProducts.some((x:any)=>x.supplier_id===proposal.changes.supplier_id&&x.product_id===proposal.changes.product_id))return reply({error:"هذا المنتج مربوط بهذا المورد بالفعل."},409);
   } else if(isSupplierCreate){
    if(entries.length!==3||entries.some(([k,v])=>!validSupplier(k,v))||typeof proposal.changes.name!=="string"||String(proposal.changes.name).trim().toLowerCase()!==proposal.target_key.trim().toLowerCase())return reply({error:"بيانات إنشاء المورد غير مكتملة أو تتضمن حقلاً غير مسموح."},422);
    if(suppliers.some((x:any)=>x.name.trim().toLowerCase()===proposal.target_key.trim().toLowerCase()))return reply({error:"يوجد مورد بهذا الاسم بالفعل. استخدم تعديل المورد الموجود."},409);
   } else if(!record||entries.length!==1||entries.some(([k,v])=>!validator(k,v))||(isOrder&&(!validOrderTransition(record.status,proposal.changes.status)||typeof record.created_at!=="string")))return reply({error:"العنصر غير معروف أو يتضمن الاقتراح حقلاً غير مسموح."},422);
   const before:Record<string,unknown>={},changes:Record<string,unknown>={};
   if(isSupplierProductCreate){Object.assign(changes,proposal.changes);} else if(isSupplierCreate){changes.name=String(proposal.changes.name).trim();changes.notes=proposal.changes.notes;changes.is_active=proposal.changes.is_active;}
   else for(const [k,v] of entries){before[k]=(record as any)[k];changes[k]=k==="name"?String(v).trim():v;}
   if(!isSupplierCreate&&!isSupplierProductCreate&&Object.keys(changes).every(k=>JSON.stringify(before[k])===JSON.stringify(changes[k])))return reply({error:"القيمة المقترحة مطابقة للقيمة الحالية."},422);
   const internalAuto = isFulfillmentNote || isSupplierProductNote || (isSupplier && entries.length===1 && entries[0][0]==="notes");
   return reply({proposal:{target_type:proposal.target_type,target_id:record?.id||record?.order_id||null,target_key:proposal.target_key,target_name:isSupplierProductCreate?proposal.target_key:isProduct?record.name:(isTicket||isReview)?(record.subject||(isReview?"تقييم زبون":"تذكرة دعم")):isSupplier?record.name:isFulfillmentNote?"ملاحظات تنفيذ الطلب":(isSupplierProductNote||isSupplierProduct)?"ربط المورد بالمنتج":isOrder?("طلب "+record.product_code):changes.name,before,changes,reason:String(proposal.reason||"مهمة إدارية").slice(0,300),expected_updated_at:record?.updated_at||null,expected_created_at:isOrder?record.created_at:null},requires_confirmation:!internalAuto,auto_execute:internalAuto,notice:internalAuto?"مهمة داخلية بحتة: سيتم تنفيذها تلقائياً بعد التحقق من السجل، مع تسجيلها في سجل التدقيق، دون أي إشعار للزبون أو تغيير مالي.":isSupplierProductCreate?"سيتم إنشاء ربط المورد بالمنتج بعد مراجعة التكلفة والعملة والأولوية وموافقتك.":isTicket?"تنبيه: تغيير حالة التذكرة قد يرسل إشعاراً للزبون. لن يتم ذلك إلا بعد موافقتك الصريحة.":isReview?"سيتم اعتماد التقييم أو رفضه فقط، دون كتابة رد أو حذف التقييم.":isSupplierCreate?"سيتم إنشاء سجل مورد أساسي فقط دون بيانات اتصال أو تكاليف أو API. لن يتم الحفظ إلا بعد موافقتك.":"لن يتم الحفظ إلا بعد موافقتك الصريحة."});
  }

  if(body.confirm!==true||!body.proposal||typeof body.proposal!=="object")return reply({error:"يلزم تأكيد صريح للاقتراح."},400);
  const announcementProposal=body.proposal;
  if(announcementProposal.target_type==="announcement_create"||announcementProposal.target_type==="announcement_publish"){
   if(announcementProposal.target_type==="announcement_create"){
    const c=announcementProposal.changes||{};const ks=Object.keys(c);
    if(announcementProposal.before===null||Object.keys(announcementProposal.before||{}).length!==0||ks.length!==3||ks.some((k:string)=>!validAnnouncement(k,c[k]))||String(c.title).trim()!==announcementProposal.target_key)return reply({error:"بيانات مسودة الإعلان غير صالحة."},400);
    const {data,error}=await db.rpc("baran_admin_announcement_action",{p_admin_id:authData.user.id,p_action:"create",p_kind:c.kind,p_title:String(c.title).trim(),p_body:String(c.body).trim()});
    if(error||!data?.success)return reply({error:"تعذر إنشاء مسودة الإعلان. لم يتم إرسال إشعار."},409);
    return reply({success:true,message:"تم إنشاء مسودة الإعلان وتسجيلها في سجل التدقيق. لم يُرسل شيء للزبائن.",record:data.record,notification_count:0});
   }
   if(typeof announcementProposal.target_id!=="string"||typeof announcementProposal.expected_updated_at!=="string"||announcementProposal.changes?.status!=="published"||announcementProposal.before?.status!=="draft")return reply({error:"بيانات نشر المسودة غير صالحة."},400);
   const {data,error}=await db.rpc("baran_admin_announcement_action",{p_admin_id:authData.user.id,p_action:"publish",p_announcement_id:announcementProposal.target_id,p_expected_updated_at:announcementProposal.expected_updated_at});
   if(error||!data?.success)return reply({error:"تعذر نشر المسودة أو أنها تغيرت. أعد فحصها؛ لم يتم إرسال إشعار مكرر."},409);
   return reply({success:true,message:"تم نشر الإعلان وإرسال إشعارات الزبائن وتسجيل العملية في سجل التدقيق.",record:data.record,notification_count:data.notification_count,notice:"عدد الإشعارات المنشأة: "+data.notification_count});
  }
  const p=body.proposal,isProduct=p.target_type==="product",isProductCreate=p.target_type==="product_create",isTicket=p.target_type==="ticket",isReview=p.target_type==="review",isSupplier=p.target_type==="supplier",isSupplierCreate=p.target_type==="supplier_create",isFulfillmentNote=p.target_type==="fulfillment_note",isSupplierProductNote=p.target_type==="supplier_product_note",isSupplierProduct=p.target_type==="supplier_product",isSupplierProductCreate=p.target_type==="supplier_product_create",isOrder=p.target_type==="order_status";
  if((!isProduct&&!isProductCreate&&!isTicket&&!isReview&&!isSupplier&&!isSupplierCreate&&!isFulfillmentNote&&!isSupplierProductNote&&!isSupplierProduct&&!isSupplierProductCreate&&!isOrder)||typeof p.target_key!=="string"||!p.before||!p.changes||typeof p.before!=="object"||typeof p.changes!=="object"||Array.isArray(p.before)||Array.isArray(p.changes))return reply({error:"بيانات المعاينة غير صالحة."},400);
  if(!isProductCreate&&!isSupplierCreate&&!isSupplierProductCreate&&(typeof p.target_id!=="string"||(isOrder?typeof p.expected_created_at!=="string":typeof p.expected_updated_at!=="string")))return reply({error:"بيانات العنصر غير صالحة."},400);
  const keys=Object.keys(p.changes),validator=isProduct?validProduct:isTicket?validTicket:isReview?validReview:isSupplier?validSupplier:isFulfillmentNote?validFulfillment:validSupplierProduct;
  if(isProductCreate){
   if(!validProductCreate(p.changes)||keys.length!==8||Object.keys(p.before).length!==0||p.target_key!==p.changes.product_code)return reply({error:"بيانات إنشاء المنتج غير صالحة."},400);
  }else if(isSupplierProductCreate){
   if(!validSupplierProductCreate(p.changes)||keys.length!==8||Object.keys(p.before).length!==0||!p.target_key.includes(" | "))return reply({error:"بيانات ربط المورد بالمنتج غير صالحة."},400);
  }else if(isSupplierCreate){
   if(keys.length!==3||keys.some(k=>!validSupplier(k,p.changes[k]))||Object.keys(p.before).length!==0||String(p.changes.name).trim().toLowerCase()!==p.target_key.trim().toLowerCase())return reply({error:"بيانات إنشاء المورد غير صالحة."},400);
  }else if(keys.length!==1||keys.some(k=>!validator(k,p.changes[k])||!(k in p.before))||(isOrder&&!validOrderTransition(p.before.status,p.changes.status)))return reply({error:"يتضمن التعديل حقلاً غير مسموح."},400);
  const table=(isProduct||isProductCreate)?"products":(isTicket||isReview)?"customer_feedback":isSupplier?"suppliers":isFulfillmentNote?"order_fulfillment":isOrder?"orders":"supplier_products";
  const select=isProduct?"id,product_code,name,description,category,sort_order,is_active,price_usd,price_syp,updated_at":(isTicket||isReview)?"id,ticket_code,subject,status,updated_at,feedback_type":isSupplier?"id,name,notes,is_active,updated_at":isFulfillmentNote?"order_id,internal_notes,updated_at":isOrder?"id,product_code,quantity,status,created_at":"id,supplier_id,product_id,supplier_sku,unit_cost,currency,is_preferred,lead_time_hours,notes,updated_at";
  let current:any=null;
  if(!isProductCreate&&!isSupplierCreate&&!isSupplierProductCreate){
   let query=db.from(table).select(select);
   query=isFulfillmentNote?query.eq("order_id",p.target_id):query.eq("id",p.target_id);
   if(isOrder)query=query.eq("id",p.target_id).eq("status",p.before.status).eq("created_at",p.expected_created_at);else if(isProduct)query=query.eq("product_code",p.target_key);else if(isTicket)query=query.eq("feedback_type","support");else if(isReview)query=query.eq("feedback_type","review");else if(isSupplier)query=query.eq("name",p.target_key);else if(isFulfillmentNote)query=query.eq("order_id",p.target_key);else if(isSupplierProductNote||isSupplierProduct)query=query.eq("id",p.target_id);
   const found=await query.maybeSingle();current=found.data;
   if(found.error||!current)return reply({error:"العنصر لم يعد موجوداً. أعد إنشاء المعاينة."},409);
   if(current.updated_at!==p.expected_updated_at||keys.some(k=>JSON.stringify((current as any)[k])!==JSON.stringify(p.before[k])))return reply({error:"تغيّرت البيانات بعد المعاينة. لم أنفذ شيئاً؛ أعد المعاينة."},409);
  }else if(isProductCreate){
   const {data:duplicate,error:duplicateErr}=await db.from("products").select("id").eq("product_code",p.target_key).limit(1);
   if(duplicateErr)return reply({error:"تعذر التحقق من رمز المنتج."},502);
   if(duplicate?.length)return reply({error:"رمز المنتج أُضيف بعد المعاينة. أعد إعداد المعاينة."},409);
  }else if(isSupplierCreate){
   const {data:duplicate,error:duplicateErr}=await db.from("suppliers").select("id").ilike("name",p.target_key).limit(1);
   if(duplicateErr)return reply({error:"تعذر التحقق من عدم تكرار المورد."},502);
   if(duplicate?.length)return reply({error:"تمت إضافة مورد بهذا الاسم بعد المعاينة. أعد فحص القائمة."},409);
  }else{
   const c=p.changes;
   const [{data:supplier,error:supplierErr},{data:product,error:productErr},{data:duplicate,error:duplicateErr}]=await Promise.all([
    db.from("suppliers").select("id,name").eq("id",c.supplier_id).maybeSingle(),
    db.from("products").select("id,product_code").eq("id",c.product_id).maybeSingle(),
    db.from("supplier_products").select("id").eq("supplier_id",c.supplier_id).eq("product_id",c.product_id).limit(1)
   ]);
   if(supplierErr||productErr||duplicateErr)return reply({error:"تعذر التحقق من المورد والمنتج قبل الربط."},502);
   if(!supplier||!product||p.target_key!==supplier.name+" | "+product.product_code)return reply({error:"تغير المورد أو المنتج بعد المعاينة. أعد إنشاء المعاينة."},409);
   if(duplicate?.length)return reply({error:"تم إنشاء هذا الربط بعد المعاينة. أعد فحص القائمة."},409);
  }
  const entityType=(isProduct||isProductCreate)?"product":isTicket?"support_ticket":isReview?"customer_review":isSupplier?"supplier":isFulfillmentNote?"order_fulfillment_note":(isSupplierProductCreate||isSupplierProduct)?"supplier_product_link":isOrder?"order_status":"supplier_product_note";
  const {data:audit,error:auditErr}=await db.from("admin_audit_log").insert({admin_id:authData.user.id,action:"safe_admin_action_requested",entity_type:entityType,entity_id:(isProductCreate||isSupplierCreate||isSupplierProductCreate)?null:p.target_id,details:{status:"in_progress",target_key:p.target_key,before:p.before,proposed:p.changes,reason:String(p.reason||"").slice(0,300)}}).select("id").single();
  if(auditErr||!audit)return reply({error:"تعذر إنشاء سجل التدقيق؛ لم يتم التعديل."},502);
  let updated:any=null,updateErr:any=null;
  if(isProductCreate){
   const result=await db.from("products").insert({product_code:p.changes.product_code,name:p.changes.name,description:p.changes.description,category:p.changes.category,sort_order:p.changes.sort_order,is_active:false,price_usd:p.changes.price_usd,price_syp:p.changes.price_syp}).select(select).single();
   updated=result.data;updateErr=result.error;
  }else if(isSupplierProductCreate){
   const c=p.changes;
   const result=await db.from("supplier_products").insert({supplier_id:c.supplier_id,product_id:c.product_id,supplier_sku:c.supplier_sku,unit_cost:c.unit_cost,currency:c.currency,is_preferred:c.is_preferred,lead_time_hours:c.lead_time_hours,notes:c.notes}).select(select).single();
   updated=result.data;updateErr=result.error;
  }else if(isSupplierCreate){
   const result=await db.from("suppliers").insert({name:p.changes.name,notes:p.changes.notes,is_active:p.changes.is_active}).select(select).single();
   updated=result.data;updateErr=result.error;
  }else{
   let updateQuery=db.from(table).update(isOrder?{...p.changes}:{...p.changes,updated_at:new Date().toISOString()});
   updateQuery=isFulfillmentNote?updateQuery.eq("order_id",p.target_id):updateQuery.eq("id",p.target_id);if(isOrder)updateQuery=updateQuery.eq("status",p.before.status).eq("created_at",p.expected_created_at);
   const result=await (isOrder?updateQuery:updateQuery.eq("updated_at",p.expected_updated_at)).select(select).maybeSingle();
   updated=result.data;updateErr=result.error;
  }
  if(updateErr||!updated){await db.from("admin_audit_log").update({action:"safe_admin_action_failed",details:{status:"failed",target_key:p.target_key,before:p.before,proposed:p.changes}}).eq("id",audit.id);return reply({error:"لم يتم التعديل؛ راجع سجل العمليات."},409);}
  const {error:finishErr}=await db.from("admin_audit_log").update({entity_id:updated.id,action:"safe_admin_action_completed",details:{status:"completed",target_key:p.target_key,before:p.before,after:Object.fromEntries(keys.map(k=>[k,(updated as any)[k]])),reason:String(p.reason||"").slice(0,300)}}).eq("id",audit.id);
  if(finishErr){console.error("audit finalization failed",finishErr.message,audit.id);return reply({success:true,warning:"تم التعديل لكن تعذر تحديث حالة سجل التدقيق. راجع سجل العمليات.",record:updated});}
  return reply({success:true,message:"تم تنفيذ المهمة وتسجيلها في سجل التدقيق.",record:updated,notice:isProductCreate?"تم إنشاء المنتج كمسودة غير نشطة. لم يظهر للزبائن ولم يُنشر.":isOrder?"تم تحديث حالة الطلب فقط، وقد أُرسل إشعار للزبون تلقائياً.":isTicket?"قد يكون وصل إشعار للزبون بتحديث حالة تذكرته.":isReview?"تم تحديث حالة التقييم فقط دون إرسال رد للزبون.":isSupplierCreate?"تم إنشاء سجل المورد الأساسي فقط؛ لم تتم إضافة بيانات اتصال أو تكاليف أو API.":isSupplierProductCreate?"تم ربط المورد بالمنتج وتسجيل التكلفة والعملة بعد موافقتك.":undefined});
 }catch(e){console.error("baran-admin-safe-actions error",e instanceof Error?e.message:"unknown");return reply({error:"حدث خطأ داخلي أثناء معالجة المهمة الآمنة."},500);}
});