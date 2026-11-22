"use strict";
(function(){
  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const money = (value,currency) => Number(value||0).toLocaleString("en-US",{minimumFractionDigits:currency==="USD"?2:0,maximumFractionDigits:currency==="USD"?2:0})+(currency==="USD"?" $":" ل.س");
  const labels = {
    opening_balance:"رصيد افتتاحي",capital_in:"إيداع رأس مال",capital_out:"سحب رأس مال",
    cash_in:"وارد نقدي",cash_out:"صادر نقدي",transfer_in:"تحويل وارد",transfer_out:"تحويل صادر",correction_in:"تسوية تصحيحية واردة",correction_out:"تسوية تصحيحية صادرة"
  };
  const incoming = new Set(["opening_balance","capital_in","cash_in","transfer_in"]);
  function date(value){
    try{return new Intl.DateTimeFormat("ar-SY",{timeZone:"Asia/Damascus",dateStyle:"medium",timeStyle:"short"}).format(new Date(value));}
    catch{return String(value||"");}
  }
  window.renderTreasury = function(data){
    const summary=document.getElementById("treasurySummary");
    const list=document.getElementById("treasuryEntries");
    if(!summary||!list)return;
    const balances=Array.isArray(data?.balances)?data.balances:[];
    summary.innerHTML=["USD","SYP"].map(currency=>{
      const item=balances.find(x=>x.currency===currency)||{};
      return '<article class="finance-stat-card"><span>رصيد الخزينة · '+currency+'</span><strong dir="ltr">'+money(item.balance,currency)+'</strong><small>وارد '+money(item.inflows,currency)+' · صادر '+money(item.outflows,currency)+'</small><small>اليوم: +'+money(item.today_inflows,currency)+' / −'+money(item.today_outflows,currency)+'</small></article>';
    }).join("");
    const entries=Array.isArray(data?.entries)?data.entries:[];
    if(!entries.length){list.innerHTML='<p class="small">لا توجد حركات خزينة بعد. ابدأ بتسجيل الرصيد الافتتاحي بعد مطابقة النقد الموجود فعلياً.</p>';return;}
    list.innerHTML=entries.map(entry=>{
      const isIn=incoming.has(entry.entry_type);
      return '<article class="treasury-entry"><div class="treasury-entry-top"><strong>'+esc(labels[entry.entry_type]||entry.entry_type)+'</strong><b class="'+(isIn?"treasury-in":"treasury-out")+'" dir="ltr">'+(isIn?"+":"−")+money(entry.amount,entry.currency)+'</b></div><div>'+esc(entry.title)+'</div><small>'+esc(date(entry.created_at))+(entry.reference?' · مرجع: '+esc(entry.reference):"")+'</small>'+(entry.notes?'<p class="small">'+esc(entry.notes)+'</p>':"")+'</article>';
    }).join("");
  };
  window.submitTreasuryEntry = async function(){
    const $=id=>document.getElementById(id);
    const type=$("treasuryType")?.value, currency=$("treasuryCurrency")?.value;
    const title=$("treasuryTitle")?.value.trim(), amount=Number($("treasuryAmount")?.value);
    const reference=$("treasuryReference")?.value.trim()||"", notes=$("treasuryNotes")?.value.trim()||"";
    const status=$("treasuryMessage"), button=$("treasurySubmit");
    if(!title||title.length<2){status.textContent="اكتب وصفاً واضحاً للحركة.";return;}
    if(!Number.isFinite(amount)||amount<=0){status.textContent="أدخل مبلغاً صحيحاً أكبر من صفر.";return;}
    if(type==="opening_balance"&&!confirm("تأكد أن هذا هو النقد الموجود فعلياً بالخزينة الآن. لا يتم ترحيل أي أرصدة قديمة تلقائياً. متابعة؟"))return;
    button.disabled=true;status.textContent="جاري حفظ الحركة...";
    try{
      await callAdminApi("POST",{action:"treasury_add",treasury_entry_type:type,title,amount,currency,reference,notes});
      $("treasuryTitle").value="";$("treasuryAmount").value="";$("treasuryReference").value="";$("treasuryNotes").value="";
      status.textContent="تم تسجيل الحركة. جاري تحديث الخزينة...";
      await loadAdminPanel();
      status.textContent="تم حفظ الحركة وتحديث رصيد الخزينة.";
    }catch(error){status.textContent="تعذر الحفظ: "+(error?.message||"خطأ غير معروف");}
    finally{button.disabled=false;}
  };
})();