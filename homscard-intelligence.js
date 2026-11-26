(function () {
"use strict";
const PANEL="homscardProviderPanel", ROOT="homscardIntelligenceCenter", SIZE=30;
const auditEngine=window.BaranHomsCardAuditEngine;
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
function confidence(r){return isUserConfirmedFixedPackage(r)?"تأكيد المستخدم لنوع الباقة":(r.audit_data?.confidence||"غير محددة");}
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
 if(!isUserConfirmedFixedPackage(r)&&pp!==null&&Number.isFinite(api)&&api>0){const comparison=auditEngine?.priceComparison(api,pp);gap=comparison?.comparable?comparison.absolutePct:Math.abs(pp-api)/api*100;}
 if(isUserConfirmedFixedPackage(r)&&pp!==null&&/للوحدة/.test(t))issues.push("صفحة المورد تعرض السعر للوحدة بينما API يصنف المنتج package؛ لا نقارن السعرين قبل تأكيد المورد أن سعر الصفحة هو سعر الباقة.");
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
function savedMissingItems(r){return arr(r.audit_data?.missing);}
function legacyPackageWarnings(r){if(!isUserConfirmedFixedPackage(r))return [];const old=["نوع المنتج قد يكون افتراضياً من الموصل","لا توجد خيارات كمية مؤكدة"];return savedMissingItems(r).filter(x=>old.includes(x));}
function productImage(r){const d=data(r);return auditEngine?.imageUrl(r)||(/^https:\/\//i.test(String(d.image||""))?d.image:"");}
function missing(r){const d=data(r),m=[];if(!d.name)m.push("اسم المنتج");if(d.price==null)m.push("سعر API");if(!d.category)m.push("التصنيف");if(!d.product_type)m.push("نوع المورد");if(!Array.isArray(d.params))m.push("حقل params غير موجود");else if(!d.params.length)m.push("لا توجد حقول إدخال مسجلة في API");if(!productImage(r))m.push("الصورة غير متوفرة في API وصفحة المورد");if(r.page_status!=="success")m.push("فشل جلب صفحة التفاصيل");else if(pageHealth(r)!=="تفاصيل المنتج موجودة")m.push(pageHealth(r));if(confidence(r)==="منخفض")m.push("ثقة التدقيق منخفضة — مراجعة بشرية");return m;}
function card(r){const d=data(r),c=node("details","hci-card"),s=node("summary","hci-summary"),url=productImage(r);if(/^https?:\/\//i.test(url)){const im=node("img","hci-img");im.src=url;im.alt="";im.loading="lazy";im.referrerPolicy="no-referrer";s.appendChild(im);}else s.appendChild(node("span","hci-img","؟"));const title=node("div","hci-title");title.append(node("b","",d.name||r.product_name||"منتج بلا اسم"),node("small","","ID "+(d.id??r.product_id)+" · "+(d.category||"بلا تصنيف")),node("em","",kind(r)+" · ثقة: "+confidence(r)));s.append(title,node("strong","hci-price",money(d.price)));c.appendChild(s);
const body=node("div","hci-body"),grid=node("div","hci-grid"),q=d.qty_values,pp=pageUnitPrice(r),fields=[["نوع المورد من API",d.product_type],["التوفر حسب API",d.available===true?"متوفر":d.available===false?"غير متوفر":"غير محدد"],["سعر API المسجل",money(d.price)],["السعر المعروض بصفحة المورد",pp===null?"غير مستخرج":money(pp)],["حقول الإدخال المسجلة حرفياً",arr(d.params).join("، ")||"لا توجد حقول مسجلة"],["الحد الأدنى",q?.min??"غير مسجل"],["الحد الأعلى",q?.max??"غير مسجل"],["حالة صفحة المنتج",pageHealth(r)+" (HTTP: "+r.page_status+")"],["طريقة التسليم المذكورة بالصفحة",fulfillment(r).join(" + ")],["مصدر تصنيف النوع",confidence(r)],["خطأ جلب الصفحة",r.page_error||"لا يوجد"]];fields.forEach(([k,v])=>{const x=node("div","hci-cell");x.append(node("small","",k),node("b","",v==null||v===""?"غير متوفر":v));grid.appendChild(x);});body.appendChild(grid);
const assess=assessment(r),intel=node("section","hci-section");intel.appendChild(node("b","","خلاصة فهم المنتج ومطابقة البيانات"));intel.appendChild(node("p","hci-muted","الحالة: "+(assess.level==="critical"?"مشكلة أساسية":assess.level==="review"?"يحتاج مراجعة":"لا توجد إشارة خطر واضحة")+" · التسليم المذكور: "+assess.delivery));if(assess.gap!==null){const signed=(assess.pp-assess.api)/assess.api*100;intel.appendChild(node("p","hci-muted","فرق سعر الصفحة عن API: "+(signed>0?"+":"")+signed.toFixed(2)+"% (قيمة مطلقة "+assess.gap.toFixed(2)+"%) — فرق وصفي للمقارنة فقط؛ لا نعتبره خطأ ولا نعتمد سعراً تلقائياً."));}if(assess.issues.length){const il=node("ul","");assess.issues.forEach(v=>il.appendChild(node("li","",v)));intel.appendChild(il);}else intel.appendChild(node("p","hci-muted","لم تظهر تعارضات آلية ضمن الحقول المقروءة؛ هذا ليس اعتماداً للشحن."));const next=node("p","hci-note");next.textContent="الإجراء التالي: "+(r.page_status!=="success"?"يحتاج إعادة محاولة قراءة صفحة المورد أو تأكيداً من دعم HomsCard إذا استمر الخطأ.":assess.issues.length?"راجع حقول API مقابل وصف المورد، ولا تعتمد أي حقل أو سعر مختلف دون توثيق المورد.":"لا يلزم إجراء آلي ظاهر حالياً؛ أبقِ المنتج في وضع المعاينة حتى اختبار المورد.");intel.appendChild(next);body.appendChild(intel);
const h=node("section","hci-section");h.appendChild(node("b","","متطلبات الشحن المسجلة في API (بدون تخمين)"));const ul=node("ul","");apiFields(r).forEach(v=>ul.appendChild(node("li","",v)));h.appendChild(ul);body.appendChild(h);
const understand=pageUnderstanding(r),uBox=node("section","hci-section");uBox.appendChild(node("b","","ما فهمه النظام من وصف المورد (قراءة نصية)"));if(understand.length){const uu=node("ul","");understand.forEach(v=>uu.appendChild(node("li","",v)));uBox.appendChild(uu);}else uBox.appendChild(node("p","hci-muted","لم تظهر تعليمات تسليم خاصة واضحة في النص المتاح."));body.appendChild(uBox);
const sec=node("section","hci-section");sec.appendChild(node("b","","إشارات إدخال/كمية وردت في صفحة المورد (غير معتمدة)"));const sig=pageSignals(r);if(sig.length){const su=node("ul","");sig.forEach(v=>su.appendChild(node("li","",v)));sec.appendChild(su);}else sec.appendChild(node("p","hci-muted","لم يُعثر على إشارات إدخال أو مدى كمية واضحة في نص التفاصيل."));sec.appendChild(node("p","hci-note","هذه إشارات نصية فقط. المرجع المعتمد لحقول الشحن هو params وqty_values في API؛ لا تُحوّل هذه الإشارات إلى حقول إلزامية قبل مطابقتها مع توثيق المورد وتجربة آمنة."));sec.appendChild(node("details","hci-raw")).append(node("summary","","عرض نص صفحة المورد الكامل"),node("pre","",snippets(r)||"لا يوجد نص"));body.appendChild(sec);
const a=r.audit_data||{},audit=node("section","hci-section");audit.appendChild(node("b","","نتيجة التدقيق وملاحظاته"));audit.appendChild(node("p","hci-muted","التصنيف التحليلي المعروض: "+auditKind(r)));if(isUserConfirmedFixedPackage(r))audit.appendChild(node("p","hci-note","تم تثبيت هذا المنتج كباقة ثابتة بناءً على تأكيد المستخدم؛ هذا تصنيف بشري ولا يثبت نجاح تنفيذ الشحن."));if(a.reason&&!isUserConfirmedFixedPackage(r))audit.appendChild(node("p","hci-muted","سبب التصنيف: "+a.reason));const m=missing(r);audit.appendChild(node("p","hci-muted",m.length?"نواقص/تحذيرات: "+m.join("، "):"لا توجد نواقص تقنية ظاهرة؛ هذا لا يعني اعتماد المنتج للبيع أو الشحن."));const savedNotes=savedMissingItems(r),legacy=legacyPackageWarnings(r);if(savedNotes.length)audit.appendChild(node("p","hci-muted","كل الملاحظات المحفوظة الخام: "+savedNotes.join("، ")));if(legacy.length)audit.appendChild(node("p","hci-note","تحذيرات تاريخية أُنشئت قبل تثبيت نوع الباقة، ولا تُعامل كنقص حالي: "+legacy.join("، ")));body.appendChild(audit);
const raw=node("details","hci-raw");raw.appendChild(node("summary","","عرض البيانات الخام كاملة"));raw.appendChild(node("pre","",JSON.stringify({product_data:d,page_data:r.page_data||{},audit_data:a},null,2)));body.appendChild(raw);c.appendChild(body);return c;}
function filter(){
 const q=norm($("hciSearch")?.value),cat=$("hciCategory")?.value||"",typ=$("hciType")?.value||"",av=$("hciAvailability")?.value||"",risk=$("hciRisk")?.value||"";
 filtered=rows.filter(r=>{
  const d=data(r),hay=norm([d.name,d.id,d.category,d.product_type,...arr(d.params),text(r)].join(" ")),a=assessment(r);
  if(q&&!hay.includes(q))return false;if(cat&&d.category!==cat)return false;if(typ&&kind(r)!==typ)return false;
  if(av==="yes"&&d.available!==true)return false;if(av==="no"&&d.available!==false)return false;if(av==="unknown"&&d.available!=null)return false;
  if(risk&&a.level!==risk)return false;
  if(activeView==="review"&&!(a.level!=="ok"||missing(r).length>0))return false;
  if(activeView==="prices"&&a.gap===null)return false;
  return true;
 });
 page=0;render();
}
function render(){
 const box=$("hciResults"),reviewBox=$("hciReviewResults"),priceBox=$("hciPriceResults");
 const current=filtered.slice(page*SIZE,(page+1)*SIZE);
 const fill=(target,items)=>{if(!target)return;target.replaceChildren();items.forEach(r=>target.appendChild(card(r)));if(!items.length)target.appendChild(node("div","hci-empty","لا توجد نتائج في هذا القسم حالياً."));};
 const reviewRows=rows.filter(r=>assessment(r).level!=="ok"||missing(r).length>0);
 const priceRows=rows.filter(r=>assessment(r).gap!==null);
 fill(box,activeView==="products"?current:[]);
 fill(reviewBox,activeView==="review"?current:[]);
 fill(priceBox,activeView==="prices"?current:[]);
 if($("hciCount"))$("hciCount").textContent="النتائج: "+filtered.length+" من "+rows.length;
 if($("hciReviewCount"))$("hciReviewCount").textContent="منتجات تتطلب مراجعة: "+reviewRows.length;
 if($("hciPriceCount"))$("hciPriceCount").textContent="منتجات لها سعر صفحة قابل للمقارنة: "+priceRows.length;
 const nav=node("div","hci-nav"),prev=node("button","","السابق"),next=node("button","","التالي");
 prev.type=next.type="button";prev.disabled=page===0;next.disabled=(page+1)*SIZE>=filtered.length;
 prev.onclick=()=>{page--;render();};next.onclick=()=>{page++;render();};
 nav.append(prev,node("span","","صفحة "+(page+1)+" / "+Math.max(1,Math.ceil(filtered.length/SIZE))),next);
 if(box&&activeView==="products")box.appendChild(nav);
}
function stats(){
 const box=$("hciStats");box.replaceChildren();
 const auditSummary=auditEngine?.summarize(rows)||{};
 const q=rows.filter(r=>String(data(r).product_type).toLowerCase()==="quantity").length;
 const packages=rows.filter(r=>String(data(r).product_type).toLowerCase()==="package").length;
 const unresolved=rows.filter(r=>!isUserConfirmedFixedPackage(r)&&(/غير محسوم|غير محدد|unresolved/i.test(norm(r.audit_data?.kind||""))||!["quantity","package"].includes(String(data(r).product_type||"").toLowerCase()))).length;
 const ok=rows.filter(r=>pageHealth(r)==="تفاصيل المنتج موجودة").length,pageErr=rows.length-ok;
 const params=rows.filter(r=>!arr(data(r).params).length).length,noimg=rows.filter(r=>!productImage(r)).length,pageImages=rows.filter(r=>arr(r.page_data?.images).length>0).length;
 const manual=rows.filter(r=>fulfillment(r).includes("تنفيذ يدوي")).length,codes=rows.filter(r=>fulfillment(r).includes("كود جاهز")).length;
 const playerPages=rows.filter(r=>/أدخل\s+Player ID/i.test(pageDetails(r)));
 const playerMatched=playerPages.filter(r=>arr(data(r).params).some(x=>/player/i.test(x))).length;
 const accountData=rows.filter(r=>pageUnderstanding(r).some(x=>x.includes("email/password"))).length;
 const otp=rows.filter(r=>/كود تحقق|رمز تحقق|رمز التحقق|كود التأكيد/.test(pageDetails(r))).length;
 const rowsWithMissing=rows.filter(r=>missing(r).length>0).length;
 const savedMissing=rows.filter(r=>savedMissingItems(r).length>0).length;
 const legacyWarnings=rows.reduce((n,r)=>n+legacyPackageWarnings(r).length,0);
 const needsReview=rows.filter(r=>assessment(r).level==="review"||assessment(r).level==="critical"||missing(r).length>0).length;
 const stats=[[rows.length,"إجمالي المنتجات"],[q,"كمية متغيرة"],[packages,"باقات"],[unresolved,"نوع غير محسوم فعلياً"],[ok,"تفاصيل صفحة موجودة"],[pageErr,"صفحات تحتاج مراجعة"],[params,"بلا حقول API"],[needsReview,"منتجات تحتاج مراجعة"],[rowsWithMissing,"منتجات لديها نواقص"],[savedMissing,"منتجات لديها ملاحظات محفوظة خام"],[legacyWarnings,"تحذيرات قديمة مستبعدة بعد تأكيد الباقة"],[pageImages,"صفحات فيها صور مستخرجة"],[auditSummary.anyImages??(rows.length-noimg),"منتجات لديها صورة قابلة للعرض"],[rows.filter(r=>assessment(r).gap!==null&&assessment(r).gap>0.5).length,"فروق سعر تتجاوز 0.5%"],[playerMatched+" / "+playerPages.length,"مطابقة Player ID"],[accountData,"صفحات تسليم بيانات حساب"],[otp,"صفحات تذكر رمز تحقق"],[noimg,"بلا صور"],[manual,"تذكر تنفيذ يدوي"],[codes,"تذكر كود جاهز"]];
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

async function smartRun(){
 if(busy)return;
 const ids=["18","3","280","8","910","37","43","1","893","25","49","45","283","282","458"];
 const client=typeof sb!=="undefined"?sb:window.sb;
 if(!client?.functions){$("hciStatus").textContent="جلسة الإدارة غير متاحة؛ لم يتم تنفيذ أي تغيير.";return;}
 busy=true;
 ["hciSmartRun","hciReload","hciExport"].forEach(id=>{const b=$(id);if(b)b.disabled=true;});
 $("hciStatus").textContent="1/4 — جلب بيانات API للمنتجات الـ15 المحددة فقط…";
 try{
  const api=await client.functions.invoke("baran-homscard-connector",{body:{action:"products",products_id:ids}});
  if(api.error||!api.data?.success||!Array.isArray(api.data.data))throw Error(api.data?.error||api.error?.message||"تعذر جلب كتالوج API.");
  const byApi=new Map(api.data.data.map(p=>[String(p.id),p]));
  const absent=ids.filter(id=>!byApi.has(id));
  if(absent.length)throw Error("توقف آمن: لم يرجع API المنتجات ذات المعرفات "+absent.join("، ")+". لم نحفظ نتيجة ناقصة.");
  if(byApi.size!==15)throw Error("عدد المنتجات المسترجعة لا يساوي 15؛ أوقفنا الحفظ.");
  $("hciStatus").textContent="2/4 — استرجاع آخر صفحات ناجحة لتجنب إعادة فحصها…";
  const saved=await client.functions.invoke("baran-homscard-connector",{body:{action:"get_latest_audit"}});
  if(saved.error||!saved.data?.success)throw Error(saved.data?.error||saved.error?.message||"تعذرت قراءة سجل التدقيق السابق.");
  const previous=Array.isArray(saved.data.data)?saved.data.data:[];
  const oldById=new Map(previous.map(r=>[String(r.product_id),r]));
  const working=ids.map(id=>{
   const apiProduct=byApi.get(id),old=oldById.get(id);
   const oldPage=old?.page_data||{};
   const pageOk=old?.page_status==="success"&&String(oldPage.text||"").trim().length>0;
   return {product_id:id,product_name:apiProduct.name||old?.product_name||"",product_data:apiProduct,
    page_data:pageOk?oldPage:{},page_status:pageOk?"success":"not_checked",page_error:pageOk?"":(old?.page_error||""),
    audit_data:old?.audit_data||{}};
  });
  const targets=working.filter(r=>r.page_status!=="success");
  $("hciStatus").textContent="3/4 — إعادة محاولة الصفحات غير الناجحة فقط: "+targets.length+" من 15…";
  if(targets.length){
   const pages=await client.functions.invoke("baran-homscard-connector",{body:{action:"product_pages",products_id:targets.map(r=>r.product_id)}});
   if(pages.error||!pages.data?.success||!Array.isArray(pages.data.data))throw Error(pages.data?.error||pages.error?.message||"تعذر إعادة جلب صفحات المنتجات.");
   const pageById=new Map(pages.data.data.map(p=>[String(p.id),p]));
   for(const r of targets){
    const fresh=pageById.get(r.product_id);
    if(fresh?.success===true&&fresh.extraction_status==="extracted"){
     r.page_data={title:fresh.title||"",description:fresh.description||"",text:fresh.text||"",images:Array.isArray(fresh.images)?fresh.images:[],availability:fresh.availability||"unknown",extraction_status:fresh.extraction_status};
     r.page_status="success";r.page_error="";
    }else{
     r.page_status="failed";r.page_error=fresh?.error||fresh?.extraction_note||"تعذر استخراج صفحة المورد؛ احتفظنا بنتيجة الصفحة الناجحة السابقة إن وجدت.";
    }
   }
  }
  $("hciStatus").textContent="4/4 — حفظ سجل جديد مستقل وعرض التشخيص…";
  const newRunId=crypto.randomUUID();
  const payload=working.map(r=>({product_id:r.product_id,product_name:r.product_name,product_data:r.product_data,page_data:r.page_data,page_status:r.page_status,page_error:r.page_error,audit_data:r.audit_data}));
  const persisted=await client.functions.invoke("baran-homscard-connector",{body:{action:"save_audit_batch",run_id:newRunId,catalog_count:15,rows:payload}});
  if(persisted.error||!persisted.data?.success)throw Error(persisted.data?.error||persisted.error?.message||"تعذر حفظ سجل الفحص الجديد.");
  runId=newRunId;catalogCount=15;rows=working;stats();categories();filter();
  const ok=rows.filter(r=>r.page_status==="success").length,failed=15-ok;
  const issueCount=rows.filter(r=>assessment(r).level!=="ok"||missing(r).length>0).length;
  $("hciStatus").textContent="اكتمل المركز الذكي: جُلبت بيانات API للـ15، وحُفظ سجل جديد. صفحات مؤكدة: "+ok+"/15؛ صفحات تحتاج معالجة من المورد: "+failed+"؛ منتجات تحتاج مراجعة: "+issueCount+". تم الحفاظ على الصفحات الناجحة ولم نغيّر أسعار البيع أو الأرصدة أو الطلبات، ولم ننشئ شراءً أو شحناً.";
 }catch(e){$("hciStatus").textContent="توقف الفحص بأمان: "+(e?.message||"خطأ غير معروف")+". لم يتم تنفيذ شراء أو شحن أو تعديل مالي.";}
 finally{busy=false;["hciSmartRun","hciReload","hciExport"].forEach(id=>{const b=$(id);if(b)b.disabled=false;});}
}

async function recheckPages(){if(busy)return;if(!runId){$("hciStatus").textContent="لا يوجد رقم سجل تدقيق محفوظ لإعادة الفحص.";return;}const targets=rows.filter(r=>pageHealth(r)!=="تفاصيل المنتج موجودة");if(!targets.length){$("hciStatus").textContent="كل صفحات المنتجات تحتوي حالياً على قسم التفاصيل المتوقع.";return;}busy=true;$("hciRecheck").disabled=true;$("hciReload").disabled=true;let refreshed=0,failed=0;try{const client=typeof sb!=="undefined"?sb:window.sb;for(let offset=0;offset<targets.length;offset+=25){const batch=targets.slice(offset,offset+25),ids=batch.map(r=>String(r.product_id));$("hciStatus").textContent="إعادة فحص صفحات المورد: "+Math.min(offset+batch.length,targets.length)+" / "+targets.length+"…";const {data,error}=await client.functions.invoke("baran-homscard-connector",{body:{action:"product_pages",products_id:ids}});if(error||!data?.success||!Array.isArray(data.data))throw Error(data?.error||error?.message||"فشل طلب إعادة فحص الصفحات.");const byId=new Map(data.data.map(x=>[String(x.id),x]));const updated=batch.map(old=>{const fresh=byId.get(String(old.product_id));if(!fresh||fresh.success!==true){failed++;return {...old,page_status:"failed",page_error:fresh?.error||"لم ترجع صفحة المنتج نتيجة صالحة"};}refreshed++;return {...old,page_data:{title:fresh.title||"",description:fresh.description||"",text:fresh.text||""},page_status:"success",page_error:""};});const payload=updated.map(r=>({product_id:r.product_id,product_name:r.product_name,product_data:r.product_data,page_data:r.page_data,page_status:r.page_status,page_error:r.page_error,audit_data:r.audit_data}));const {data:saved,error:saveError}=await client.functions.invoke("baran-homscard-connector",{body:{action:"save_audit_batch",run_id:runId,catalog_count:catalogCount,rows:payload}});if(saveError||!saved?.success)throw Error(saved?.error||saveError?.message||"تعذر حفظ نتيجة إعادة الفحص.");const updatedMap=new Map(updated.map(r=>[String(r.product_id),r]));rows=rows.map(r=>updatedMap.get(String(r.product_id))||r);stats();filter();} $("hciStatus").textContent="انتهت إعادة الفحص: تم تحديث "+refreshed+" صفحة، وفشل جلب "+failed+". لم يتم تنفيذ أي شراء أو شحن.";}catch(e){$("hciStatus").textContent="توقفت إعادة الفحص بعد حفظ الدفعات المكتملة: "+(e?.message||"خطأ غير معروف");}finally{busy=false;$("hciRecheck").disabled=false;$("hciReload").disabled=false;}}
function styles(){
 if($("hciWorkspaceStyles"))return;
 const st=node("style");st.id="hciWorkspaceStyles";
 st.textContent=String.raw\`
 #\${ROOT}{margin:18px 0;padding:0;border:1px solid #76558f;border-radius:22px;overflow:hidden;background:radial-gradient(ellipse at 10% 0%,#9c6ac52a,transparent 38%),linear-gradient(155deg,#21172c,#0d0912 76%);color:#f5eafa;box-shadow:0 18px 42px #0007}
 #\${ROOT} *{box-sizing:border-box}
 #\${ROOT} .hci-hero{position:relative;padding:20px;background:linear-gradient(115deg,#382447dd,#17101f 70%);border-bottom:1px solid #614875}
 #\${ROOT} .hci-eyebrow{display:inline-flex;align-items:center;gap:7px;padding:6px 10px;border:1px solid #9a75b5;border-radius:999px;background:#120d19;color:#e6cff7;font-size:10px;font-weight:900}
 #\${ROOT} .hci-heading{margin:12px 0 5px;font-size:clamp(20px,4vw,27px);font-weight:1000;line-height:1.4}
 #\${ROOT} .hci-intro{max-width:780px;margin:0;color:#cbb9d9;font-size:12px;line-height:1.9}
 #\${ROOT} .hci-hero-meta{display:flex;flex-wrap:wrap;gap:7px;margin-top:13px}
 #\${ROOT} .hci-chip{padding:6px 9px;border:1px solid #584267;border-radius:9px;background:#110c17;color:#ddc8ee;font-size:10px}
 #\${ROOT} .hci-body-wrap{padding:13px}
 #\${ROOT} .hci-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin:0 0 13px}
 #\${ROOT} .hci-actions button{min-height:49px;padding:10px;border:1px solid #74558c;border-radius:12px;background:linear-gradient(145deg,#30203d,#1b1424);color:#f5eafa;font-size:12px;font-weight:850;white-space:normal;line-height:1.6}
 #\${ROOT} .hci-actions .hci-primary{grid-column:1/-1;background:linear-gradient(110deg,#c59be4,#9569b7);color:#180e21;border-color:#e3c9f5;font-weight:1000}
 #\${ROOT} button:disabled{opacity:.55}
 #\${ROOT} .hci-status{margin:0 0 13px;padding:11px;border:1px solid #514064;border-radius:11px;background:#120d18;color:#e2cdef;font-size:11px;line-height:1.8}
 #\${ROOT} .hci-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:0 0 14px}
 #\${ROOT} .hci-stat{min-width:0;padding:11px 6px;border:1px solid #4f3b60;border-radius:13px;background:linear-gradient(145deg,#21182b,#130e19);text-align:center}
 #\${ROOT} .hci-stat b{display:block;color:#e6cafa;font-size:clamp(18px,4vw,24px);overflow-wrap:anywhere}
 #\${ROOT} .hci-stat small{display:block;margin-top:4px;color:#c1afcf;font-size:10px;line-height:1.5}
 #\${ROOT} .hci-tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px;margin:0 0 12px;padding:5px;border:1px solid #4e3a5e;border-radius:13px;background:#0d0912}
 #\${ROOT} .hci-tab{min-width:0;min-height:43px;padding:7px 4px;border:1px solid transparent;border-radius:9px;background:transparent;color:#cbb9d9;font-size:11px;font-weight:850}
 #\${ROOT} .hci-tab[aria-selected="true"]{border-color:#9c75ba;background:linear-gradient(145deg,#49305d,#2a1c37);color:#fff;box-shadow:0 4px 12px #0005}
 #\${ROOT} .hci-view-title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:12px 0;color:#f0e2fa;font-size:14px;font-weight:950}
 #\${ROOT} .hci-view-title small{color:#c3b0d1;font-size:10px;font-weight:500}
 #\${ROOT} .hci-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:10px 0}
 #\${ROOT} input,#\${ROOT} select{width:100%;min-width:0;padding:11px;border:1px solid #614a75;border-radius:10px;background:#0d0912;color:white;font:inherit;font-size:12px}
 #\${ROOT} .hci-count{margin:10px 0;color:#cbb7dc;font-size:11px}
 #\${ROOT} .hci-results{display:grid;gap:9px}
 #\${ROOT} .hci-card{border:1px solid #554167;border-radius:13px;background:#181220;overflow:hidden}
 #\${ROOT} .hci-summary{display:grid;grid-template-columns:50px minmax(0,1fr) auto;gap:8px;align-items:center;padding:9px;cursor:pointer;list-style:none}
 #\${ROOT} .hci-img{width:50px;height:50px;object-fit:cover;border-radius:9px;background:#2b2035;display:grid;place-items:center}
 #\${ROOT} .hci-title{min-width:0;display:grid;gap:3px}
 #\${ROOT} .hci-title b{font-size:13px;overflow-wrap:anywhere}
 #\${ROOT} .hci-title small{font-size:10px;color:#bca9cb}
 #\${ROOT} .hci-title em{font-size:10px;color:#d9b8f1;font-style:normal}
 #\${ROOT} .hci-price{font-size:11px;white-space:nowrap;direction:ltr;color:#e0c2f4}
 #\${ROOT} .hci-body{padding:10px;border-top:1px solid #40334c}
 #\${ROOT} .hci-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
 #\${ROOT} .hci-cell{padding:8px;border:1px solid #40334c;border-radius:9px;background:#110d17;min-width:0}
 #\${ROOT} .hci-cell small{display:block;color:#bba9ca;font-size:10px;margin-bottom:4px}
 #\${ROOT} .hci-cell b{display:block;font-size:11px;overflow-wrap:anywhere;line-height:1.6}
 #\${ROOT} .hci-section{margin-top:11px;padding:10px;border:1px solid #463650;border-radius:10px;background:#130e19;font-size:11px;line-height:1.8}
 #\${ROOT} .hci-section>b{color:#e4cdf3}
 #\${ROOT} .hci-note{font-size:10px;color:#e7c99b;line-height:1.7}
 #\${ROOT} ul{padding-inline-start:20px;margin:5px 0;color:#e3d6ec}
 #\${ROOT} .hci-raw{margin-top:10px}
 #\${ROOT} .hci-raw summary{cursor:pointer;color:#d7b8ed;font-weight:800}
 #\${ROOT} pre{max-height:360px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;direction:ltr;text-align:left;background:#09070d;padding:10px;border-radius:9px;font-size:10px}
 #\${ROOT} .hci-nav{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 0}
 #\${ROOT} .hci-nav span{font-size:11px;color:#cbb8da}
 #\${ROOT} .hci-nav button{min-height:38px;padding:7px 12px;border:1px solid #59446c;border-radius:9px;background:#21172d;color:#f2e7fa}
 #\${ROOT} .hci-empty{padding:18px;text-align:center;border:1px dashed #5b466e;border-radius:10px;color:#c7b5d5}
 #\${ROOT} .hci-overview-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin:12px 0}
 #\${ROOT} .hci-overview-card{padding:13px;border:1px solid #4f3b60;border-radius:13px;background:linear-gradient(145deg,#21182b,#130e19)}
 #\${ROOT} .hci-overview-card b{display:block;color:#f0e3fa;font-size:12px}
 #\${ROOT} .hci-overview-card span{display:block;margin-top:5px;color:#bfaecc;font-size:10px;line-height:1.7}
 #\${ROOT} .hci-readiness-link{width:100%;min-height:47px;margin:4px 0 12px;padding:10px;border:1px solid #a77dc5;border-radius:12px;background:linear-gradient(110deg,#3b2850,#21172e);color:#f6eafa;font-weight:900}
 #\${ROOT} .hci-view[hidden]{display:none!important}
 @media(max-width:520px){#\${ROOT}{border-radius:16px}#\${ROOT} .hci-hero{padding:16px 13px}#\${ROOT} .hci-body-wrap{padding:10px}#\${ROOT} .hci-actions{grid-template-columns:1fr}#\${ROOT} .hci-actions .hci-primary{grid-column:auto}#\${ROOT} .hci-stats{grid-template-columns:repeat(2,minmax(0,1fr))}#\${ROOT} .hci-tabs{gap:4px;padding:4px}#\${ROOT} .hci-tab{font-size:10px;padding:6px 2px}#\${ROOT} .hci-controls{grid-template-columns:1fr}#\${ROOT} .hci-overview-grid{grid-template-columns:1fr}#\${ROOT} .hci-summary{grid-template-columns:43px minmax(0,1fr) auto;gap:6px}#\${ROOT} .hci-img{width:43px;height:43px}#\${ROOT} .hci-price{font-size:10px}}
 \`;
 document.head.appendChild(st);
}
let activeView="overview";
function setView(view){
 activeView=view;
 const root=$(ROOT);if(!root)return;
 root.querySelectorAll(".hci-tab").forEach(tab=>tab.setAttribute("aria-selected",String(tab.dataset.view===view)));
 root.querySelectorAll(".hci-view").forEach(panel=>panel.hidden=panel.dataset.panel!==view);
 if(view==="review"){if($("hciRisk"))$("hciRisk").value="";filter();}
 else if(view==="prices"){if($("hciRisk"))$("hciRisk").value="";filter();}
 else if(view==="products"){if($("hciRisk"))$("hciRisk").value="";filter();}
}
function readinessReport(){
 const report=document.getElementById("baranCatalogReadinessReport");
 if(report){report.scrollIntoView({behavior:"smooth",block:"start"});const button=document.getElementById("baranCatalogReportButton");if(button)button.focus({preventScroll:true});}
 if(typeof window.baranLoadCatalogReadinessReport==="function")window.baranLoadCatalogReadinessReport();
 else {const status=document.getElementById("baranCatalogReportStatus");if(status)status.textContent="زر تقرير الجاهزية غير متاح في هذه النسخة. حدّث الصفحة أو راجع تحميل لوحة الإدارة.";}
}
function mount(){
 const panel=$(PANEL);if(!panel||$(ROOT))return;
 const root=node("section","");root.id=ROOT;
 const hero=node("header","hci-hero");
 hero.append(node("span","hci-eyebrow","✦ BARAN GAME · HOMSCARD INTELLIGENCE"));
 hero.append(node("div","hci-heading","مركز إدارة HomsCard الذكي"));
 hero.append(node("p","hci-intro","لوحة عمل مستقلة لمراجعة كتالوج المورد: حالة المنتجات، بيانات API، صفحات التفاصيل، فروقات الأسعار، النواقص، والتقارير. كل أدوات هذه اللوحة للقراءة والتدقيق فقط؛ لا شراء ولا شحن ولا تعديل أسعار بيع أو أرصدة أو طلبات."));
 const meta=node("div","hci-hero-meta");
 ["15 منتجاً ضمن نطاق تدقيق HomsCard","قراءة فقط","الشحن والشراء غير مفعّلين"].forEach(x=>meta.append(node("span","hci-chip",x)));
 hero.append(meta);
 const wrap=node("div","hci-body-wrap");
 const actions=node("div","hci-actions");
 const smart=node("button","hci-primary","🚀 تشغيل الفحص الشامل وتحديث التقرير");
 smart.type="button";smart.id="hciSmartRun";smart.onclick=smartRun;
 const reload=node("button","","📂 قراءة آخر تدقيق محفوظ");reload.type="button";reload.id="hciReload";reload.onclick=load;
 const exp=node("button","","⬇️ تصدير تقرير HomsCard CSV");exp.type="button";exp.id="hciExport";exp.onclick=exportReport;
 const readiness=node("button","","📋 فحص جاهزية المنتجات الـ17");readiness.type="button";readiness.onclick=readinessReport;
 actions.append(smart,reload,exp,readiness);
 const status=node("div","hci-status","ابدأ بقراءة آخر تدقيق محفوظ أو شغّل الفحص الشامل. لا يبدأ أي فحص تلقائياً.");
 status.id="hciStatus";status.setAttribute("role","status");status.setAttribute("aria-live","polite");
 const statsBox=node("div","hci-stats");statsBox.id="hciStats";
 const tabs=node("nav","hci-tabs");tabs.setAttribute("aria-label","أقسام مركز HomsCard");
 [["overview","نظرة عامة"],["products","المنتجات"],["review","تحتاج مراجعة"],["prices","فروقات الأسعار"]].forEach(([view,label])=>{const b=node("button","hci-tab",label);b.type="button";b.dataset.view=view;b.setAttribute("aria-selected",String(view==="overview"));b.onclick=()=>setView(view);tabs.append(b);});
 const overview=node("section","hci-view");overview.dataset.panel="overview";
 overview.append(node("div","hci-view-title","ملخص العمل"));
 const overviewGrid=node("div","hci-overview-grid");
 [["فحص بيانات المورد","مقارنة نوع المنتج والسعر والتوفر وحقول الإدخال المسجلة في API."],["مراجعة صفحات التفاصيل","مطابقة وصف المورد مع الحقول، وإظهار الصفحات الناجحة أو المتعثرة."],["مراجعة فروقات الأسعار","إظهار اتجاه الفرق بين سعر API وسعر الصفحة دون اعتماد أو تعديل أي سعر."],["قائمة الإجراءات المطلوبة","تحديد المنتجات التي تحتاج مراجعة بشرية وسبب المراجعة دون تنفيذ عمليات حساسة."]].forEach(([title,desc])=>{const c=node("article","hci-overview-card");c.append(node("b","",title),node("span","",desc));overviewGrid.append(c);});
 overview.append(overviewGrid);
 const goProducts=node("button","hci-readiness-link","عرض جميع المنتجات الـ15 ←");goProducts.type="button";goProducts.onclick=()=>setView("products");overview.append(goProducts);
 const goReadiness=node("button","hci-readiness-link","فتح تقرير جاهزية الكتالوج الـ17 ←");goReadiness.type="button";goReadiness.onclick=readinessReport;overview.append(goReadiness);
 const productsView=node("section","hci-view");productsView.dataset.panel="products";productsView.hidden=true;
 const reviewView=node("section","hci-view");reviewView.dataset.panel="review";reviewView.hidden=true;
 const pricesView=node("section","hci-view");pricesView.dataset.panel="prices";pricesView.hidden=true;
 const makeTitle=(target,title,desc)=>{const h=node("div","hci-view-title");h.append(node("span","",title),node("small","",desc));target.append(h);};
 makeTitle(productsView,"كتالوج HomsCard","كل المنتجات المشمولة بالتدقيق");
 makeTitle(reviewView,"قائمة المراجعة","المشكلات والنواقص التي تتطلب تدقيقاً");
 makeTitle(pricesView,"مقارنة الأسعار","الفروق المحسوبة بين صفحة المورد وAPI");
 const controls=node("div","hci-controls");
 const search=node("input");search.id="hciSearch";search.type="search";search.placeholder="ابحث باسم المنتج أو ID أو حقل API";
 const cat=node("select");cat.id="hciCategory";
 const typ=node("select");typ.id="hciType";[["","كل الأنواع"],["كمية متغيرة","كمية متغيرة"],["كمية متغيرة ناقصة الحدود","quantity بحدود ناقصة"],["باقة ثابتة","باقات ثابتة مؤكدة"],["باقة","نوع package"],["غير محسوم","نوع غير محسوم"]].forEach(([v,l])=>{const o=node("option","",l);o.value=v;typ.append(o);});
 const av=node("select");av.id="hciAvailability";[["","كل حالات التوفر"],["yes","متوفر"],["no","غير متوفر"],["unknown","غير محدد"]].forEach(([v,l])=>{const o=node("option","",l);o.value=v;av.append(o);});
 const risk=node("select");risk.id="hciRisk";[["","كل مستويات المراجعة"],["critical","مشاكل أساسية"],["review","تحتاج مراجعة"],["ok","لا توجد إشارات خطر"]].forEach(([v,l])=>{const o=node("option","",l);o.value=v;risk.append(o);});
 controls.append(search,cat,typ,av,risk);
 productsView.append(controls);
 const count=node("div","hci-count");count.id="hciCount";
 const results=node("div","hci-results");results.id="hciResults";
 productsView.append(count,results);
 const reviewCount=node("div","hci-count");reviewCount.id="hciReviewCount";
 const reviewResults=node("div","hci-results");reviewResults.id="hciReviewResults";reviewView.append(reviewCount,reviewResults);
 const priceCount=node("div","hci-count");priceCount.id="hciPriceCount";
 const priceResults=node("div","hci-results");priceResults.id="hciPriceResults";pricesView.append(priceCount,priceResults);
 search.oninput=filter;cat.onchange=filter;typ.onchange=filter;av.onchange=filter;risk.onchange=filter;
 wrap.append(actions,status,statsBox,tabs,overview,productsView,reviewView,pricesView);
 root.append(hero,wrap);
 panel.parentElement.insertBefore(root,panel);
 styles();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount,{once:true});else mount();
window.BaranHomsCardIntelligence={reload:load};
})();