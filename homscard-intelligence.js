(function () {
"use strict";
const PANEL="homscardProviderPanel", ROOT="homscardIntelligenceCenter", SIZE=30;
let rows=[], filtered=[], page=0, busy=false, runId=null, catalogCount=0;
const $=id=>document.getElementById(id);
const node=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=String(txt);return n;};
const data=r=>r.product_data||r;
const arr=v=>Array.isArray(v)?v.filter(x=>x!=null&&String(x).trim()).map(String):[];
const text=r=>String(r.page_data?.text||"");
const norm=s=>String(s||"").toLocaleLowerCase().replace(/\s+/g," ").trim();
const money=v=>v==null?"غير متوفر":Number(v).toLocaleString("en-US",{maximumFractionDigits:8})+" USD";
const USER_CONFIRMED_FIXED_PACKAGE_IDS=new Set(["283","282","458"]);
function isUserConfirmedFixedPackage(r){return USER_CONFIRMED_FIXED_PACKAGE_IDS.has(String(data(r).id??r.product_id))&&String(data(r).product_type||"").toLowerCase()==="package";}
function auditKind(r){return isUserConfirmedFixedPackage(r)?"باقة ثابتة (تأكيد المستخدم)":(r.audit_data?.kind||kind(r));}
function kind(r){const d=data(r),t=String(d.product_type||"").toLowerCase(),q=d.qty_values;if(isUserConfirmedFixedPackage(r))return"باقة ثابتة";if(t==="quantity"&&q?.min!==undefined&&q?.max!==undefined)return"كمية متغيرة";if(t==="quantity")return"كمية متغيرة ناقصة الحدود";if(t==="package")return"باقة";return"غير محسوم";}
function fulfillment(r){const t=text(r),a=[];if(/تنفيذ يدوي/.test(t))a.push("تنفيذ يدوي");if(/كود جاهز/.test(t))a.push("كود جاهز");if(/تسليم فوري/.test(t))a.push("تسليم فوري");return a.length?a:["طريقة التسليم غير محددة بوضوح"];}
function pageDetails(r){const t=text(r),start=t.indexOf("📄 تفاصيل المنتج");if(start<0)return t;let part=t.slice(start+"📄 تفاصيل المنتج".length);const end=part.indexOf("من نحن");if(end>=0)part=part.slice(0,end);return part.replace(/\s+/g," ").trim();}
function pageUnitPrice(r){const m=pageDetails(r).match(/للوحدة\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*\$/i);return m?Number(m[1].replace(/,/g,"")):null;}
function confidence(r){return r.audit_data?.confidence||"غير محددة";}
function pageHealth(r){const t=text(r);if(!t.trim())return"نص الصفحة فارغ";if(/عذراً، حدث خطأ في الاتصال|عذرا، حدث خطأ في الاتصال/.test(t))return"صفحة أعادت رسالة خطأ";if(!t.includes("📄 تفاصيل المنتج"))return"قسم تفاصيل المنتج غير موجود";return"تفاصيل المنتج موجودة";}
function apiFields(r){const d=data(r),p=arr(d.params),q=d.qty_values,out=[];if(p.length)p.forEach(x=>out.push(x));else out.push("لا توجد حقول إدخال مسجلة في API");if(q&&(q.min!==undefined||q.max!==undefined))out.push("حدود الكمية المسجلة: "+(q.min??"غير محدد")+" إلى "+(q.max??"غير محدد"));else if(String(d.product_type)==="package")out.push("نوع المورد package؛ لا توجد حدود كمية مسجلة");return out;}
function snippets(r){return pageDetails(r);}


function pageUnderstanding(r){
 const t=pageDetails(r),n=String(data(r).name||r.product_name||""),out=[];
 if(/email\s*password/i.test(t)||/بيانات تسجيل الدخول/.test(t))out.push("بيانات email/password مذكورة كمخرجات تُسلّم للمشتري، وليست حقول إدخال للعميل.");
 if(/كود تحقق|رمز تحقق|رمز التحقق|كود التأكيد/i.test(t))out.push("قد يحتاج المشتري إلى متابعة دعم للحصول على رمز تحقق بعد التسليم.");
 if(/الدولة حسب اختيارك|اختر الدولة|الدولة المحددة/.test(t))out.push("يوجد اختيار دولة/منطقة مذكور في الوصف؛ لم يظهر كحقل API مستقل.");
 if(/بعد شراء هذه الخدمة|بعد الشراء ستحصل|بعد إتمام الشراء/.test(t)&&/حساب|بيانات|تسجيل الدخول/.test(t))out.push("الوصف يشرح بيانات أو حساباً يُسلّم بعد الشراء.");
 if(/أدخل\s+(?:Player ID|User ID|UID|ID)/i.test(t))out.push("الصفحة تطلب معرف لاعب/مستخدم كمدخل من العميل.");
 if(/كود جاهز/.test(t))out.push("الصفحة تصف المنتج بأنه كود جاهز يُسلّم للمشتري.");
 if(/تنفيذ يدوي/.test(t))out.push("الصفحة تصف التنفيذ بأنه يدوي؛ لا نفترض أنه شحن آلي.");
 if(/تسليم تلقائي فوري|الطلب يُنفَّذ تلقائياً/.test(t))out.push("الصفحة تدّعي التسليم التلقائي الفوري؛ هذا وصف المورد وليس اختبار تنفيذ فعلي.");
 const duration=n.match(/(?:\b\d+\s*(?:days?|months?|years?)\b|\d+\s*(?:أيام|يوم|شهر|اشهر|أشهر|سنة|سنوات))/i);
 if(duration)out.push("الاسم يتضمن مدة محتملة ("+duration[0]+")؛ لم نثبتها كمدة اشتراك من API.");
 return out;
}

function assessment(r){
 const d=data(r),t=pageDetails(r),p=arr(d.params),pp=pageUnitPrice(r),api=Number(d.price),issues=[];
 const pageOk=pageHealth(r)==="تفاصيل المنتج موجودة";
 const pageHasCode=/كود جاهز/.test(t),pageHasManual=/تنفيذ يدوي/.test(t),pageHasInstant=/تسليم فوري/.test(t);
 const pageMentionsId=/أدخل\s+(?:Player ID|User ID|UID|ID)/i.test(t);
 const unmatched=p.filter(x=>!norm(t).includes(norm(x)));
 let gap=null;
 if(pp!==null&&Number.isFinite(api)&&api>0)gap=Math.abs(pp-api)/api*100;
 if(!pageOk)issues.push("صفحة التفاصيل غير قابلة للاعتماد حالياً");
 if(d.available===false)issues.push("المنتج غير متاح حسب API");
 if(String(d.product_type).toLowerCase()==="quantity"&&(!d.qty_values||d.qty_values.min==null||d.qty_values.max==null))issues.push("نوع quantity لكن حدود الكمية ناقصة");
 if(!p.length)issues.push("API لا يسجل حقول إدخال؛ يلزم تأكيد طريقة التسليم");
 if(unmatched.length)issues.push("حقول API غير مثبتة في نص الصفحة: "+unmatched.join("، "));
 if(pageMentionsId&&!p.some(x=>/player|user|uid|(^|\s)id($|\s)/i.test(x)))issues.push("صفحة المورد تطلب معرف لاعب لكن API لا يعرض حقلاً مطابقاً");
 
 const critical=!pageOk||d.available===false,review=issues.length>0;
 const delivery=pageHasCode?"كود جاهز حسب الصفحة":pageHasManual?"تنفيذ يدوي حسب الصفحة":pageHasInstant?"تسليم فوري حسب الصفحة":"غير موضح";
 return {level:critical?"critical":review?"review":"ok",issues,delivery,pp,api,gap,unmatched};
}

function pageSignals(r){
 const t=pageDetails(r),out=[];
 const patterns=[
  [/أدخل\s+([A-Za-z0-9_ -]{2,40})/gi,"حقل إدخال مذكور بالنص"],
  [/تأكّد من صحة\s+([^—.،]{2,60})/gi,"تعليمات تحقق مذكورة بالنص"],
  [/الكمية\s*\(من\s*([0-9,]+)\s*إلى\s*([0-9,]+)\)/gi,"مدى كمية مذكور بالنص"]
 ];
 for(const [re,label] of patterns){let m;while((m=re.exec(t))!==null){const val=m.slice(1).filter(Boolean).join(" إلى ");if(val&&!out.some(x=>x===label+": "+val))out.push(label+": "+val);}}
 return out;
}
function missing(r){const d=data(r),m=[];if(!d.name)m.push("اسم المنتج");if(d.price==null)m.push("سعر API");if(!d.category)m.push("التصنيف");if(!d.product_type)m.push("نوع المورد");if(!Array.isArray(d.params))m.push("حقل params غير موجود");else if(!d.params.length)m.push("لا توجد حقول إدخال مسجلة في API");if(!String(d.image||"").trim())m.push("الصورة غير متوفرة");if(r.page_status!=="success")m.push("فشل جلب صفحة التفاصيل");else if(pageHealth(r)!=="تفاصيل المنتج موجودة")m.push(pageHealth(r));if(confidence(r)==="منخفض")m.push("ثقة التدقيق منخفضة — مراجعة بشرية");return m;}
function card(r){const d=data(r),c=node("details","hci-card"),s=node("summary","hci-summary"),url=String(d.image||"");if(/^https?:\/\//i.test(url)){const im=node("img","hci-img");im.src=url;im.alt="";im.loading="lazy";im.referrerPolicy="no-referrer";s.appendChild(im);}else s.appendChild(node("span","hci-img","؟"));const title=node("div","hci-title");title.append(node("b","",d.name||r.product_name||"منتج بلا اسم"),node("small","","ID "+(d.id??r.product_id)+" · "+(d.category||"بلا تصنيف")),node("em","",kind(r)+" · ثقة: "+confidence(r)));s.append(title,node("strong","hci-price",money(d.price)));c.appendChild(s);
const body=node("div","hci-body"),grid=node("div","hci-grid"),q=d.qty_values,pp=pageUnitPrice(r),fields=[["نوع المورد من API",d.product_type],["التوفر حسب API",d.available===true?"متوفر":d.available===false?"غير متوفر":"غير محدد"],["سعر API المسجل",money(d.price)],["السعر المعروض بصفحة المورد",pp===null?"غير مستخرج":money(pp)],["حقول الإدخال المسجلة حرفياً",arr(d.params).join("، ")||"لا توجد حقول مسجلة"],["الحد الأدنى",q?.min??"غير مسجل"],["الحد الأعلى",q?.max??"غير مسجل"],["حالة صفحة المنتج",pageHealth(r)+" (HTTP: "+r.page_status+")"],["طريقة التسليم المذكورة بالصفحة",fulfillment(r).join(" + ")],["ثقة التدقيق",confidence(r)],["خطأ جلب الصفحة",r.page_error||"لا يوجد"]];fields.forEach(([k,v])=>{const x=node("div","hci-cell");x.append(node("small","",k),node("b","",v==null||v===""?"غير متوفر":v));grid.appendChild(x);});body.appendChild(grid);
const assess=assessment(r),intel=node("section","hci-section");intel.appendChild(node("b","","خلاصة فهم المنتج ومطابقة البيانات"));intel.appendChild(node("p","hci-muted","الحالة: "+(assess.level==="critical"?"مشكلة أساسية":assess.level==="review"?"يحتاج مراجعة":"لا توجد إشارة خطر واضحة")+" · التسليم المذكور: "+assess.delivery));if(assess.gap!==null)intel.appendChild(node("p","hci-muted","فرق سعر العرض عن API: "+assess.gap.toFixed(2)+"% — غالباً يعكس اختلاف سعر صفحة المورد عن سعر API؛ نعرضه للمقارنة ولا نعدّه خطأ أو نعتمد أحد السعرين تلقائياً."));if(assess.issues.length){const il=node("ul","");assess.issues.forEach(v=>il.appendChild(node("li","",v)));intel.appendChild(il);}else intel.appendChild(node("p","hci-muted","لم تظهر تعارضات آلية ضمن الحقول المقروءة؛ هذا ليس اعتماداً للشحن."));body.appendChild(intel);
const h=node("section","hci-section");h.appendChild(node("b","","متطلبات الشحن المسجلة في API (بدون تخمين)"));const ul=node("ul","");apiFields(r).forEach(v=>ul.appendChild(node("li","",v)));h.appendChild(ul);body.appendChild(h);
const understand=pageUnderstanding(r),uBox=node("section","hci-section");uBox.appendChild(node("b","","ما فهمه النظام من وصف المورد (قراءة نصية)"));if(understand.length){const uu=node("ul","");understand.forEach(v=>uu.appendChild(node("li","",v)));uBox.appendChild(uu);}else uBox.appendChild(node("p","hci-muted","لم تظهر تعليمات تسليم خاصة واضحة في النص المتاح."));body.appendChild(uBox);
const sec=node("section","hci-section");sec.appendChild(node("b","","إشارات إدخال/كمية وردت في صفحة المورد (غير معتمدة)"));const sig=pageSignals(r);if(sig.length){const su=node("ul","");sig.forEach(v=>su.appendChild(node("li","",v)));sec.appendChild(su);}else sec.appendChild(node("p","hci-muted","لم يُعثر على إشارات إدخال أو مدى كمية واضحة في نص التفاصيل."));sec.appendChild(node("p","hci-note","هذه إشارات نصية فقط. المرجع المعتمد لحقول الشحن هو params وqty_values في API؛ لا تُحوّل هذه الإشارات إلى حقول إلزامية قبل مطابقتها مع توثيق المورد وتجربة آمنة."));sec.appendChild(node("details","hci-raw")).append(node("summary","","عرض نص صفحة المورد الكامل"),node("pre","",snippets(r)||"لا يوجد نص"));body.appendChild(sec);
const a=r.audit_data||{},audit=node("section","hci-section");audit.appendChild(node("b","","نتيجة التدقيق وملاحظاته"));audit.appendChild(node("p","hci-muted","التصنيف التحليلي المعروض: "+auditKind(r)));if(isUserConfirmedFixedPackage(r))audit.appendChild(node("p","hci-note","تم تثبيت هذا المنتج كباقة ثابتة بناءً على تأكيد المستخدم؛ هذا تصنيف بشري ولا يثبت نجاح تنفيذ الشحن."));if(a.reason)audit.appendChild(node("p","hci-muted","سبب التصنيف: "+a.reason));const m=missing(r);audit.appendChild(node("p","hci-muted",m.length?"نواقص/تحذيرات: "+m.join("، "):"لا توجد نواقص تقنية ظاهرة؛ هذا لا يعني اعتماد المنتج للبيع أو الشحن."));if(a.missing?.length)audit.appendChild(node("p","hci-muted","ملاحظات التدقيق: "+a.missing.join("، ")));body.appendChild(audit);
const raw=node("details","hci-raw");raw.appendChild(node("summary","","عرض البيانات الخام كاملة"));raw.appendChild(node("pre","",JSON.stringify({product_data:d,page_data:r.page_data||{},audit_data:a},null,2)));body.appendChild(raw);c.appendChild(body);return c;}
function filter(){const q=norm($("hciSearch")?.value),cat=$("hciCategory")?.value||"",typ=$("hciType")?.value||"",av=$("hciAvailability")?.value||"",delivery=$("hciDelivery")?.value||"",pageState=$("hciPageState")?.value||"",risk=$("hciRisk")?.value||"";filtered=rows.filter(r=>{const d=data(r),hay=norm([d.name,d.id,d.category,d.product_type,...arr(d.params),text(r)].join(" ")),a=assessment(r);if(q&&!hay.includes(q))return false;if(cat&&d.category!==cat)return false;if(typ&&kind(r)!==typ)return false;if(av==="yes"&&d.available!==true)return false;if(av==="no"&&d.available!==false)return false;if(av==="unknown"&&d.available!=null)return false;if(delivery&&!fulfillment(r).includes(delivery))return false;if(pageState==="ok"&&pageHealth(r)!=="تفاصيل المنتج موجودة")return false;if(pageState==="bad"&&pageHealth(r)==="تفاصيل المنتج موجودة")return false;if(risk&&a.level!==risk)return false;return true;});page=0;render();}
function render(){const box=$("hciResults");if(!box)return;box.replaceChildren();$("hciCount").textContent="النتائج: "+filtered.length+" من "+rows.length;filtered.slice(page*SIZE,(page+1)*SIZE).forEach(r=>box.appendChild(card(r)));if(!filtered.length)box.appendChild(node("div","hci-empty","لا توجد نتائج مطابقة."));const nav=node("div","hci-nav"),prev=node("button","secondary","السابق"),next=node("button","secondary","التالي");prev.type=next.type="button";prev.disabled=page===0;next.disabled=(page+1)*SIZE>=filtered.length;prev.onclick=()=>{page--;render();};next.onclick=()=>{page++;render();};nav.append(prev,node("span","","صفحة "+(page+1)+" / "+Math.max(1,Math.ceil(filtered.length/SIZE))),next);box.appendChild(nav);}
function stats(){
 const box=$("hciStats");box.replaceChildren();
 const q=rows.filter(r=>String(data(r).product_type).toLowerCase()==="quantity").length;
 const packages=rows.filter(r=>String(data(r).product_type).toLowerCase()==="package").length;
 const unresolved=rows.filter(r=>!isUserConfirmedFixedPackage(r)&&(/غير محسوم|غير محدد|unresolved/i.test(norm(r.audit_data?.kind||""))||!["quantity","package"].includes(String(data(r).product_type||"").toLowerCase()))).length;
 const ok=rows.filter(r=>pageHealth(r)==="تفاصيل المنتج موجودة").length,pageErr=rows.length-ok;
 const params=rows.filter(r=>!arr(data(r).params).length).length,noimg=rows.filter(r=>!String(data(r).image||"").trim()).length;
 const manual=rows.filter(r=>fulfillment(r).includes("تنفيذ يدوي")).length,codes=rows.filter(r=>fulfillment(r).includes("كود جاهز")).length;
 const playerPages=rows.filter(r=>/أدخل\s+Player ID/i.test(pageDetails(r)));
 const playerMatched=playerPages.filter(r=>arr(data(r).params).some(x=>/player/i.test(x))).length;
 const accountData=rows.filter(r=>pageUnderstanding(r).some(x=>x.includes("email/password"))).length;
 const otp=rows.filter(r=>/كود تحقق|رمز تحقق|رمز التحقق|كود التأكيد/.test(pageDetails(r))).length;
 const rowsWithMissing=rows.filter(r=>missing(r).length>0).length;
 const savedMissing=rows.filter(r=>Array.isArray(r.audit_data?.missing)&&r.audit_data.missing.length>0).length;
 const needsReview=rows.filter(r=>assessment(r).level==="review"||assessment(r).level==="critical"||missing(r).length>0).length;
 const stats=[[rows.length,"إجمالي المنتجات"],[q,"كمية متغيرة"],[packages,"باقات"],[unresolved,"نوع غير محسوم فعلياً"],[ok,"تفاصيل صفحة موجودة"],[pageErr,"صفحات تحتاج مراجعة"],[params,"بلا حقول API"],[needsReview,"منتجات تحتاج مراجعة"],[rowsWithMissing,"منتجات لديها نواقص"],[savedMissing,"نواقص محفوظة في سجل التدقيق"],[rows.filter(r=>assessment(r).gap!==null&&assessment(r).gap>0.5).length,"فارق سعر صفحة/API"],[playerMatched+" / "+playerPages.length,"مطابقة Player ID"],[accountData,"صفحات تسليم بيانات حساب"],[otp,"صفحات تذكر رمز تحقق"],[noimg,"بلا صور"],[manual,"تذكر تنفيذ يدوي"],[codes,"تذكر كود جاهز"]];
 stats.forEach(([n,l])=>{const x=node("div","hci-stat");x.append(node("b","",n),node("small","",l));box.appendChild(x);});
}
function csvCell(v){
 let s=String(v==null?"":v);
 if(/^[=+\-@\t\r]/.test(s))s="'"+s;
 return '"'+s.replace(/"/g,'""')+'"';
}
function exportReport(){
 if(!rows.length){$("hciStatus").textContent="اقرأ التدقيق أولاً قبل تصدير التقرير.";return;}
 const head=["Product ID","Product name","Category","API type","Available","API price USD","Page unit price USD","Page/API gap %","API input fields","Qty min","Qty max","Page health","Page delivery wording","Page interpretation","Review level","Review notes"];
 const lines=[head.map(csvCell).join(",")];
 rows.forEach(r=>{
  const d=data(r),a=assessment(r);
  lines.push([d.id??r.product_id,d.name||r.product_name,d.category,d.product_type,d.available===true?"yes":d.available===false?"no":"unknown",d.price,a.pp,a.gap===null?"":a.gap.toFixed(3),arr(d.params).join(" | "),d.qty_values?.min,d.qty_values?.max,pageHealth(r),a.delivery,pageUnderstanding(r).join(" | "),a.level,a.issues.join(" | ")].map(csvCell).join(","));
 });
 const blob=new Blob(["\uFEFF"+lines.join("\r\n")],{type:"text/csv;charset=utf-8"});
 const url=URL.createObjectURL(blob),a=document.createElement("a");
 a.href=url;a.download="BARAN-HomsCard-Intelligence-Report.csv";
 document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
 $("hciStatus").textContent="تم تجهيز تقرير CSV من "+rows.length+" منتجاً. التقرير للقراءة والمراجعة فقط.";
}

function categories(){const s=$("hciCategory");s.replaceChildren();const o=node("option","","كل التصنيفات");o.value="";s.appendChild(o);[...new Set(rows.map(r=>data(r).category).filter(Boolean))].sort().forEach(v=>{const x=node("option","",v);x.value=v;s.appendChild(x);});}
async function load(){if(busy)return;busy=true;$("hciReload").disabled=true;$("hciStatus").textContent="جارٍ قراءة التدقيق المحفوظ من قاعدة البيانات…";try{const client=typeof sb!=="undefined"?sb:window.sb;if(!client?.functions)throw Error("جلسة المدير غير متاحة.");const {data,error}=await client.functions.invoke("baran-homscard-connector",{body:{action:"get_latest_audit"}});if(error||!data?.success)throw Error(data?.error||error?.message||"تعذرت القراءة.");if(!Array.isArray(data.data)||!data.data.length)throw Error("لا يوجد تدقيق محفوظ؛ حمّل الكتالوج وافحصه أولاً.");runId=data.run?.run_id||null;catalogCount=Number(data.run?.catalog_count||data.count||data.data.length);const agreedIds=new Set(["18","3","280","8","910","37","43","1","893","25","49","45","283","282","458"]);
const savedRows=data.data.map(r=>({product_id:String(r.product_id),product_name:r.product_name,product_data:r.product_data||{},page_data:r.page_data||{},page_status:r.page_status||"not_checked",page_error:r.page_error||"",audit_data:r.audit_data||{}}));
const matched=savedRows.filter(r=>agreedIds.has(r.product_id));
const missing=[...agreedIds].filter(id=>!matched.some(r=>r.product_id===id));
if(missing.length)throw Error("التدقيق المحفوظ لا يحتوي كل المنتجات الـ15 المتفق عليها. المعرّفات الناقصة: "+missing.join(", ")+". لم نعرض بقية الكتالوج.");
rows=matched;
stats();categories();filter();$("hciStatus").textContent="تمت قراءة المنتجات الـ15 المتفق عليها فقط من سجل التدقيق المحفوظ. إجمالي السجل الأصلي: "+catalogCount+" منتجاً؛ المعروض والمصدّر والمعاد فحصه هنا يقتصر على 15. معاينة فقط؛ لا شراء ولا شحن ولا خصم رصيد.";}catch(e){$("hciStatus").textContent="تعذر تحميل البيانات: "+(e?.message||"خطأ غير معروف");}finally{busy=false;$("hciReload").disabled=false;}}
async function recheckPages(){if(busy)return;if(!runId){$("hciStatus").textContent="لا يوجد رقم سجل تدقيق محفوظ لإعادة الفحص.";return;}const targets=rows.filter(r=>pageHealth(r)!=="تفاصيل المنتج موجودة");if(!targets.length){$("hciStatus").textContent="كل صفحات المنتجات تحتوي حالياً على قسم التفاصيل المتوقع.";return;}busy=true;$("hciRecheck").disabled=true;$("hciReload").disabled=true;let refreshed=0,failed=0;try{const client=typeof sb!=="undefined"?sb:window.sb;for(let offset=0;offset<targets.length;offset+=25){const batch=targets.slice(offset,offset+25),ids=batch.map(r=>String(r.product_id));$("hciStatus").textContent="إعادة فحص صفحات المورد: "+Math.min(offset+batch.length,targets.length)+" / "+targets.length+"…";const {data,error}=await client.functions.invoke("baran-homscard-connector",{body:{action:"product_pages",products_id:ids}});if(error||!data?.success||!Array.isArray(data.data))throw Error(data?.error||error?.message||"فشل طلب إعادة فحص الصفحات.");const byId=new Map(data.data.map(x=>[String(x.id),x]));const updated=batch.map(old=>{const fresh=byId.get(String(old.product_id));if(!fresh||fresh.success!==true){failed++;return {...old,page_status:"failed",page_error:fresh?.error||"لم ترجع صفحة المنتج نتيجة صالحة"};}refreshed++;return {...old,page_data:{title:fresh.title||"",description:fresh.description||"",text:fresh.text||""},page_status:"success",page_error:""};});const payload=updated.map(r=>({product_id:r.product_id,product_name:r.product_name,product_data:r.product_data,page_data:r.page_data,page_status:r.page_status,page_error:r.page_error,audit_data:r.audit_data}));const {data:saved,error:saveError}=await client.functions.invoke("baran-homscard-connector",{body:{action:"save_audit_batch",run_id:runId,catalog_count:catalogCount,rows:payload}});if(saveError||!saved?.success)throw Error(saved?.error||saveError?.message||"تعذر حفظ نتيجة إعادة الفحص.");const updatedMap=new Map(updated.map(r=>[String(r.product_id),r]));rows=rows.map(r=>updatedMap.get(String(r.product_id))||r);stats();filter();} $("hciStatus").textContent="انتهت إعادة الفحص: تم تحديث "+refreshed+" صفحة، وفشل جلب "+failed+". لم يتم تنفيذ أي شراء أو شحن.";}catch(e){$("hciStatus").textContent="توقفت إعادة الفحص بعد حفظ الدفعات المكتملة: "+(e?.message||"خطأ غير معروف");}finally{busy=false;$("hciRecheck").disabled=false;$("hciReload").disabled=false;}}
function styles(){if($("hciStyles"))return;const st=node("style");st.id="hciStyles";st.textContent=
"#"+ROOT+"{margin:16px 0;padding:14px;border:1px solid #9a72b8;border-radius:17px;background:linear-gradient(145deg,#21172d,#100b16);color:#f4eafa}"+
"#"+ROOT+" .hci-heading{font-size:19px;font-weight:950}#"+ROOT+" .hci-muted,#"+ROOT+" .hci-intro{color:#c3b2d2;font-size:12px;line-height:1.8}"+
"#"+ROOT+" .hci-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:12px 0}#"+ROOT+" input,#"+ROOT+" select{width:100%;min-width:0;padding:11px;border:1px solid #614a75;border-radius:10px;background:#0d0912;color:white;font:inherit}"+
"#"+ROOT+" .hci-status{margin:10px 0;padding:10px;border:1px solid #514064;border-radius:10px;background:#171020;color:#dfc9ef;font-size:12px}#"+ROOT+" .hci-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:12px 0}#"+ROOT+" .hci-stat{padding:9px 4px;border:1px solid #4c3a5c;border-radius:11px;background:#191321;text-align:center}#"+ROOT+" .hci-stat b{display:block;font-size:20px;color:#e2c4f7}#"+ROOT+" .hci-stat small{font-size:10px;color:#c0aecf}"+
"#"+ROOT+" .hci-count{margin:10px 0;color:#cbb7dc;font-size:12px}#"+ROOT+" .hci-results{display:grid;gap:9px}#"+ROOT+" .hci-card{border:1px solid #554167;border-radius:13px;background:#181220;overflow:hidden}#"+ROOT+" .hci-summary{display:grid;grid-template-columns:50px minmax(0,1fr) auto;gap:8px;align-items:center;padding:9px;cursor:pointer;list-style:none}#"+ROOT+" .hci-img{width:50px;height:50px;object-fit:cover;border-radius:9px;background:#2b2035;display:grid;place-items:center}#"+ROOT+" .hci-title{min-width:0;display:grid;gap:3px}#"+ROOT+" .hci-title b{font-size:13px;overflow-wrap:anywhere}#"+ROOT+" .hci-title small{font-size:10px;color:#bca9cb}#"+ROOT+" .hci-title em{font-size:10px;color:#d9b8f1;font-style:normal}#"+ROOT+" .hci-price{font-size:11px;white-space:nowrap;direction:ltr;color:#e0c2f4}"+
"#"+ROOT+" .hci-body{padding:10px;border-top:1px solid #40334c}#"+ROOT+" .hci-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}#"+ROOT+" .hci-cell{padding:8px;border:1px solid #40334c;border-radius:9px;background:#110d17;min-width:0}#"+ROOT+" .hci-cell small{display:block;color:#bba9ca;font-size:10px;margin-bottom:4px}#"+ROOT+" .hci-cell b{display:block;font-size:11px;overflow-wrap:anywhere;line-height:1.6}"+
"#"+ROOT+" .hci-section{margin-top:11px;padding:10px;border:1px solid #463650;border-radius:10px;background:#130e19;font-size:11px;line-height:1.8}#"+ROOT+" .hci-section>b{color:#e4cdf3}#"+ROOT+" .hci-note{font-size:10px;color:#e7c99b;line-height:1.7}#"+ROOT+" ul{padding-inline-start:20px;margin:5px 0;color:#e3d6ec}#"+ROOT+" .hci-raw{margin-top:10px}#"+ROOT+" .hci-raw summary{cursor:pointer;color:#d7b8ed;font-weight:800}#"+ROOT+" pre{max-height:360px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;direction:ltr;text-align:left;background:#09070d;padding:10px;border-radius:9px;font-size:10px}"+
"#"+ROOT+" .hci-nav{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 0}#"+ROOT+" .hci-nav span{font-size:11px;color:#cbb8da}#"+ROOT+" .hci-empty{padding:18px;text-align:center;border:1px dashed #5b466e;border-radius:10px}"+
"@media(max-width:420px){#"+ROOT+"{padding:10px}#"+ROOT+" .hci-controls{grid-template-columns:1fr}#"+ROOT+" .hci-stats{grid-template-columns:repeat(2,minmax(0,1fr))}#"+ROOT+" .hci-summary{grid-template-columns:43px minmax(0,1fr) auto;gap:6px}#"+ROOT+" .hci-img{width:43px;height:43px}#"+ROOT+" .hci-price{font-size:10px}}";
document.head.appendChild(st);}
function mount(){const panel=$(PANEL);if(!panel||$(ROOT))return;const root=node("section","");root.id=ROOT;root.append(node("div","hci-heading","🧠 مركز ذكاء كتالوج HomsCard"),node("p","hci-intro","قراءة تفصيلية من التدقيق المحفوظ. نفصل حقول API الفعلية عن النص التسويقي لصفحة المورد، ونوضح طريقة التسليم كما يذكرها المورد ودرجة الثقة والنواقص. مستقل عن BARO ولا ينفّذ أي طلب."));const controls=node("div","hci-controls"),search=node("input");search.id="hciSearch";search.type="search";search.placeholder="ابحث بالاسم أو ID أو Player ID أو تعليمات الشحن";const cat=node("select");cat.id="hciCategory";const typ=node("select");typ.id="hciType";[["","كل الأنواع"],["كمية متغيرة","كمية متغيرة"],["كمية متغيرة ناقصة الحدود","quantity بحدود ناقصة"],["باقة ثابتة","باقات ثابتة مؤكدة"],["باقة","نوع package"],["غير محسوم","نوع غير محسوم"]].forEach(([v,l])=>{const o=node("option","",l);o.value=v;typ.appendChild(o);});const av=node("select");av.id="hciAvailability";[["","كل حالات التوفر"],["yes","متوفر"],["no","غير متوفر"],["unknown","غير محدد"]].forEach(([v,l])=>{const o=node("option","",l);o.value=v;av.appendChild(o);});const delivery=node("select");delivery.id="hciDelivery";[["","كل طرق التسليم"],["تنفيذ يدوي","صفحة المورد تذكر تنفيذ يدوي"],["كود جاهز","صفحة المورد تذكر كود جاهز"],["تسليم فوري","صفحة المورد تذكر تسليم فوري"]].forEach(([v,l])=>{const o=node("option","",l);o.value=v;delivery.appendChild(o);});const pageState=node("select");pageState.id="hciPageState";[["","كل حالات قراءة الصفحة"],["ok","تفاصيل المنتج موجودة"],["bad","رسالة خطأ أو تفاصيل ناقصة"]].forEach(([v,l])=>{const o=node("option","",l);o.value=v;pageState.appendChild(o);});const risk=node("select");risk.id="hciRisk";[["","كل مستويات المراجعة"],["critical","مشاكل أساسية"],["review","تحتاج مراجعة"],["ok","لا توجد إشارات خطر"]].forEach(([v,l])=>{const o=node("option","",l);o.value=v;risk.appendChild(o);});controls.append(search,cat,typ,av,delivery,pageState,risk);const btn=node("button","secondary","↻ قراءة آخر تدقيق");btn.type="button";btn.id="hciReload";btn.onclick=load;const exp=node("button","secondary","⇩ تصدير تقرير CSV");exp.type="button";exp.id="hciExport";exp.onclick=exportReport;const status=node("div","hci-status","اضغط قراءة آخر تدقيق لعرض المنتجات.");status.id="hciStatus";const statsBox=node("div","hci-stats");statsBox.id="hciStats";const count=node("div","hci-count");count.id="hciCount";const results=node("div","hci-results");results.id="hciResults";const recheck=node("button","secondary","↻ إعادة فحص صفحات التفاصيل الناقصة");recheck.type="button";recheck.id="hciRecheck";recheck.onclick=recheckPages;root.append(controls,btn,exp,recheck,status,statsBox,count,results);search.oninput=filter;cat.onchange=filter;typ.onchange=filter;av.onchange=filter;delivery.onchange=filter;pageState.onchange=filter;risk.onchange=filter;panel.appendChild(root);styles();}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount,{once:true});else mount();
window.BaranHomsCardIntelligence={reload:load};
})();