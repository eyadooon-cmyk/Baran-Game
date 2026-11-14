// BARAN PUBG MOBILE PLAYER CHECKER
// Calls the authenticated Supabase Edge Function. Provider credentials stay server-side.
(function(){
  function install(){
    const playerInput=document.getElementById("pubgPlayerId");
    if(!playerInput||document.getElementById("pubgCheckButton"))return;

    const style=document.createElement("style");
    style.id="baran-pubg-check-styles";
    style.textContent=[
      ".pubg-check-status{margin:9px 0;padding:11px 12px;border:1px solid #59416d;border-radius:11px;background:#17111f;color:#d9c8e8;font-size:12px;line-height:1.8;overflow-wrap:anywhere}",
      ".pubg-check-status:empty{display:none}",
      ".pubg-check-status.is-success{border-color:#397b5a;background:#14271f;color:#b9efcf}",
      ".pubg-check-status.is-error{border-color:#8b4c62;background:#2a1720;color:#ffd0d8}",
      ".pubg-id-confirm{display:flex;align-items:center;gap:8px;padding:10px 12px;margin:8px 0;border:1px solid #76518f;border-radius:10px;background:#21172b;color:#eadcf5;font-size:12px;line-height:1.7}",
      ".pubg-id-confirm[hidden]{display:none!important}",
      ".pubg-id-confirm input{width:18px;height:18px;flex:0 0 18px;margin:0;accent-color:#a56bd6}",
      ".pubg-check-warning{margin:9px 0;padding:11px 12px;border:1px solid #795a37;border-radius:11px;background:#2a2018;color:#f0d7b5;font-size:11px;line-height:1.9}"
    ].join("");
    document.head.append(style);

    const button=document.createElement("button");
    button.id="pubgCheckButton";
    button.type="button";
    button.className="full secondary";
    button.textContent="تحقق من اسم اللاعب";
    button.addEventListener("click",window.baranCheckPubgPlayer);

    const status=document.createElement("div");
    status.id="pubgCheckStatus";
    status.className="pubg-check-status";
    status.setAttribute("role","status");
    status.setAttribute("aria-live","polite");

    const warning=document.createElement("div");
    warning.className="pubg-check-warning";
    warning.textContent="تنبيه: قد يظهر اسم اللاعب بشكل غير دقيق أو خاطئ. لا تعتمد على الاسم وحده؛ تأكد بنفسك من رقم الـID داخل اللعبة وأنه يعود لحسابك قبل متابعة أي شحن.";

    const confirmLabel=document.createElement("label");
    confirmLabel.id="pubgIdConfirmLabel";
    confirmLabel.className="pubg-id-confirm";
    confirmLabel.hidden=true;
    const confirm=document.createElement("input");
    confirm.id="pubgIdConfirm";
    confirm.type="checkbox";
    const confirmText=document.createElement("span");
    confirmText.textContent="أؤكد أن رقم الـID صحيح ويخص حسابي.";
    confirmLabel.append(confirm,confirmText);

    playerInput.insertAdjacentElement("afterend",button);
    button.insertAdjacentElement("afterend",status);
    status.insertAdjacentElement("afterend",warning);
    warning.insertAdjacentElement("afterend",confirmLabel);

    playerInput.addEventListener("input",()=>{
      window.baranPubgCheckSequence=(window.baranPubgCheckSequence||0)+1;
      window.baranPubgVerifiedPlayer=null;
      confirm.checked=false;
      confirmLabel.hidden=true;
      status.textContent="";
      status.classList.remove("is-success","is-error");
      button.disabled=false;
      button.textContent="تحقق من اسم اللاعب";
    });
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install,{once:true});
  else install();
})();

window.baranPubgVerifiedPlayer=null;
window.baranPubgCheckSequence=0;

window.baranCheckPubgPlayer=async function(){
  const input=document.getElementById("pubgPlayerId");
  const button=document.getElementById("pubgCheckButton");
  const status=document.getElementById("pubgCheckStatus");
  const confirmLabel=document.getElementById("pubgIdConfirmLabel");
  const confirm=document.getElementById("pubgIdConfirm");
  if(!input||!button||!status)return;

  const id=input.value.trim();
  window.baranPubgCheckSequence++;
  const sequence=window.baranPubgCheckSequence;
  window.baranPubgVerifiedPlayer=null;
  if(confirm){confirm.checked=false;confirmLabel.hidden=true;}
  status.classList.remove("is-success","is-error");

  if(!/^\d{5,20}$/.test(id)){
    status.textContent="أدخل Player ID صحيحاً مكوّناً من 5 إلى 20 رقماً.";
    status.classList.add("is-error");
    return;
  }

  const client=window.baranSupabaseClient;
  if(!client?.auth||!client?.functions){
    status.textContent="خدمة المتجر غير جاهزة حالياً. أعد تحميل الصفحة وحاول مجدداً.";
    status.classList.add("is-error");
    return;
  }

  button.disabled=true;
  button.textContent="جارٍ التحقق...";
  status.textContent="جارٍ التحقق من حساب PUBG MOBILE، انتظر قليلاً...";
  try{
    const {data:{session},error:sessionError}=await client.auth.getSession();
    if(sessionError||!session?.access_token)throw new Error("AUTH_REQUIRED");
    const {data,error}=await client.functions.invoke("baran-pubg-check",{body:{id}});
    if(sequence!==window.baranPubgCheckSequence||input.value.trim()!==id)return;
    if(error)throw error;

    if(!data||data.ok!==true||!data.player?.username){
      const code=data?.error||"";
      status.textContent=code==="PLAYER_NOT_FOUND"
        ?"لم يتم العثور على حساب PUBG بهذا الـID. راجع الرقم وأعد المحاولة."
        :code==="PROVIDER_RATE_LIMIT"
          ?"وصلنا إلى حد التحقق المؤقت. حاول لاحقاً دون تكرار المحاولات."
          :"تعذر التحقق حالياً. لم يتم تأكيد الحساب، لذلك لن نعتبر الـID صالحاً.";
      status.classList.add("is-error");
      return;
    }

    const returnedId=String(data.player.id||"").trim();
    if(returnedId&&returnedId!==id){
      status.textContent="رقم الحساب الذي أعاده مزود التحقق لا يطابق الرقم المدخل. أوقفنا التحقق احتياطياً.";
      status.classList.add("is-error");
      return;
    }

    window.baranPubgVerifiedPlayer={
      id:id,
      username:String(data.player.username),
      region:data.player.region||null,
      level:data.player.level??null
    };
    status.textContent="تم العثور على الحساب — الاسم المعروض: "+window.baranPubgVerifiedPlayer.username+
      (window.baranPubgVerifiedPlayer.region?" · المنطقة: "+window.baranPubgVerifiedPlayer.region:"");
    status.classList.add("is-success");
    confirmLabel.hidden=false;
  }catch(error){
    if(sequence!==window.baranPubgCheckSequence)return;
    console.warn("PUBG player check failed",error);
    status.textContent=error?.message==="AUTH_REQUIRED"
      ?"جلسة الدخول غير متاحة أو انتهت. سجّل الدخول من جديد ثم أعد المحاولة."
      :"تعذر الاتصال بخدمة التحقق. لم يتم اعتماد الـID؛ حاول لاحقاً.";
    status.classList.add("is-error");
  }finally{
    if(sequence===window.baranPubgCheckSequence){
      button.disabled=false;
      button.textContent="إعادة التحقق من اسم اللاعب";
    }
  }
};
