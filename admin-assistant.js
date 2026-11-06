(function(){
  "use strict";
  function addAdminMessage(text,who){
    const box=document.getElementById("baranAdminAssistantMessages");
    if(!box)return;
    const node=document.createElement("div");
    node.className="ai-chat-message "+(who==="user"?"user":"bot");
    node.textContent=text;
    box.appendChild(node);
    box.scrollTop=box.scrollHeight;
  }
  function money(value,currency){
    const n=Number(value||0);
    return n.toLocaleString("en-US",{maximumFractionDigits:currency==="SYP"?0:2})+(currency==="USD"?" $":" ل.س");
  }
  function adminData(){
    try{return typeof latestBaranOperations!=="undefined"&&latestBaranOperations?latestBaranOperations:null;}
    catch(_){return null;}
  }
  function answerQuestion(question){
    const data=adminData();
    if(!data)return "لسا ما وصلتني بيانات لوحة الإدارة. اضغط تحديث لوحة الإدارة وانتظر تحميل الإحصائيات، وبعدها اسألني من جديد.";
    const q=question.toLowerCase();
    const finance=data.finance||{};
    const totals=finance.totals||[];
    const orders=data.orders||[];
    const products=data.products||[];
    const suppliers=data.suppliers||[];
    const requests=data.requests||[];
    const statuses=data.stats?.order_statuses||{};
    const pendingDeposits=requests.filter(x=>x.status==="pending").length;
    const openOrders=orders.filter(x=>["pending","processing","awaiting_supplier"].includes(x.status));
    const usd=totals.find(x=>x.currency==="USD")||{};
    const syp=totals.find(x=>x.currency==="SYP")||{};
    if(/ملخص|وضع المتجر|كيف الوضع|نظرة عامة/.test(q)){
      return "ملخص البيانات المحمّلة حالياً:\n• المستخدمون: "+Number(data.stats?.users||0)+"\n• الطلبات: "+Number(data.stats?.orders||0)+"\n• المنتجات: "+products.length+" ("+products.filter(x=>x.is_active).length+" فعّال)\n• الموردون: "+suppliers.length+"\n• طلبات الإيداع المعلقة ضمن آخر الطلبات المعروضة: "+pendingDeposits+"\n• الطلبات المفتوحة ضمن آخر 100 طلب: "+openOrders.length+".";
    }
    if(/اليوم|ربح اليوم|مبيعات اليوم/.test(q)){
      return "ملخص اليوم حسب السجل المالي:\nالدولار: المبيعات "+money(usd.today_sales,"USD")+"، تكلفة الموردين "+money(usd.today_cost,"USD")+"، المصاريف "+money(usd.today_expenses,"USD")+"، صافي الربح "+money(usd.today_profit,"USD")+"؛\nالليرة: المبيعات "+money(syp.today_sales,"SYP")+"، تكلفة الموردين "+money(syp.today_cost,"SYP")+"، المصاريف "+money(syp.today_expenses,"SYP")+"، صافي الربح "+money(syp.today_profit,"SYP")+".";
    }
    if(/الشهر|ربح الشهر|مبيعات الشهر/.test(q)){
      return "ملخص الشهر حسب السجل المالي:\nالدولار: المبيعات "+money(usd.month_sales,"USD")+"، تكلفة الموردين "+money(usd.month_cost,"USD")+"، المصاريف "+money(usd.month_expenses,"USD")+"، صافي الربح "+money(usd.month_profit,"USD")+"؛\nالليرة: المبيعات "+money(syp.month_sales,"SYP")+"، تكلفة الموردين "+money(syp.month_cost,"SYP")+"، المصاريف "+money(syp.month_expenses,"SYP")+"، صافي الربح "+money(syp.month_profit,"SYP")+".";
    }
    if(/ربح|أرباح|مبيعات|مالية|رأس المال|مصروف/.test(q)){
      return "الإجمالي المسجل حتى الآن:\nالدولار: رأس المال "+money(usd.capital,"USD")+"، المبيعات "+money(usd.sales,"USD")+"، تكلفة الموردين "+money(usd.cost,"USD")+"، المصاريف "+money(usd.expenses,"USD")+"، صافي الربح "+money(usd.profit,"USD")+"؛\nالليرة: رأس المال "+money(syp.capital,"SYP")+"، المبيعات "+money(syp.sales,"SYP")+"، تكلفة الموردين "+money(syp.cost,"SYP")+"، المصاريف "+money(syp.expenses,"SYP")+"، صافي الربح "+money(syp.profit,"SYP")+".";
    }
    if(/طلب|طلبات|معلق|قيد التنفيذ|متأخر/.test(q)){
      const labels={pending:"قيد المراجعة",processing:"قيد التنفيذ",awaiting_supplier:"بانتظار المورد",completed:"مكتمل",rejected:"مرفوض",cancelled:"ملغي"};
      const lines=Object.entries(statuses).map(([k,v])=>(labels[k]||k)+": "+v);
      return "حالات الطلبات حسب إحصاء لوحة الإدارة:\n"+(lines.join("\n")||"لا توجد حالات مسجلة.")+"\n\nالطلبات المفتوحة الظاهرة ضمن آخر 100 طلب: "+openOrders.length+".";
    }
    if(/منتج|منتجات|الأفضل|افضل|أفضل/.test(q)){
      const report=finance.product_report||[];
      if(!report.length)return "لا يوجد تقرير مبيعات منتجات للفترة المحددة في لوحة الإدارة حالياً. افتح تقرير أرباح المنتجات واختر الشهر المطلوب ثم حدّث اللوحة.";
      const sorted=[...report].sort((a,b)=>Number(b.gross_profit||0)-Number(a.gross_profit||0)).slice(0,5);
      return "أعلى المنتجات ربحاً إجمالياً في التقرير المحدد (كل عملة منفصلة):\n"+["USD","SYP"].map(cur=>{const rows=sorted.filter(x=>x.currency===cur);return rows.length?cur+":\n"+rows.map((x,i)=>(i+1)+". "+x.product_name+" — ربح إجمالي "+money(x.gross_profit,cur)).join("\n"):"";}).filter(Boolean).join("\n")+".";
    }
    if(/مورد|موردين/.test(q)){
      return "الموردون المسجلون: "+suppliers.length+".\n"+(suppliers.length?suppliers.map((s,i)=>(i+1)+". "+s.name+" — "+(s.is_active?"فعّال":"متوقف")).join("\n"):"لا يوجد موردون مسجلون حالياً.");
    }
    if(/إيداع|إيداعات|شام/.test(q)){
      return "طلبات الإيداع الظاهرة ضمن آخر 100 طلب: إجمالي "+requests.length+"، معلقة "+pendingDeposits+"، مقبولة "+requests.filter(x=>x.status==="approved").length+"، مرفوضة "+requests.filter(x=>x.status==="rejected").length+". راجع إشعار شام كاش يدوياً قبل أي موافقة.";
    }
    return "فيني أساعدك حالياً بتحليل: ملخص المتجر، أرباح اليوم، أرباح الشهر، إجمالي الحسابات المالية، حالات الطلبات، أرباح المنتجات، الموردين، وطلبات الإيداع. اسألني بسؤال واضح مثل: «قديش صافي ربح اليوم بالدولار؟».";
  }
  window.askBaranAdminAssistant=function(event){
    if(event)event.preventDefault();
    const input=document.getElementById("baranAdminAssistantInput");
    const button=document.getElementById("baranAdminAssistantSend");
    const question=(input?.value||"").trim();
    if(!question)return;
    addAdminMessage(question,"user");
    input.value="";
    button.disabled=true;
    try{addAdminMessage(answerQuestion(question),"bot");}
    catch(error){addAdminMessage("صار خطأ أثناء تحليل البيانات. حدّث لوحة الإدارة وجرب مرة ثانية.","bot");}
    finally{button.disabled=false;input.focus();}
  };
})();