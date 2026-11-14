// BARAN FREE FIRE PLAYER CHECKER
// Calls the authenticated Supabase Edge Function. Provider credentials stay server-side.
(function(){
  function install(){
    const playerInput=document.getElementById("freeFirePlayerId");
    if(!playerInput||document.getElementById("freeFireCheckButton"))return;

    const style=document.createElement("style");
    style.id="baran-freefire-check-styles";
    style.textContent=[
      ".freefire-check-status{margin:9px 0;padding:11px 12px;border:1px solid #59416d;border-radius:11px;background:#17111f;color:#d9c8e8;font-size:12px;line-height:1.8;overflow-wrap:anywhere}",
      ".freefire-check-status:empty{display:none}",
      ".freefire-check-status.is-success{border-color:#397b5a;background:#14271f;color:#b9efcf}",
      ".freefire-check-status.is-error{border-color:#8b4c62;background:#2a1720;color:#ffd0d8}",
      ".freefire-id-confirm{display:flex;align-items:center;gap:8px;padding:10px 12px;margin:8px 0;border:1px solid #76518f;border-radius:10px;background:#21172b;color:#eadcf5;font-size:12px;line-height:1.7}",
      ".freefire-id-confirm[hidden]{display:none!important}",
      ".freefire-id-confirm input{width:18px;height:18px;flex:0 0 18px;margin:0;accent-color:#a56bd6}",
      ".freefire-check-warning{margin:9px 0;padding:11px 12px;border:1px solid #795a37;border-radius:11px;background:#2a2018;color:#f0d7b5;font-size:11px;line-height:1.9}"
    ].join("");
    document.head.append(style);

    const button=document.createElement("button");
    button.id="freeFireCheckButton";
    button.type="button";
    button.className="full secondary";
    button.textContent="تحقق من اسم لاعب";
    button.addEventListener("click",window.baranCheckFreeFirePlayer);

    const status=document.createElement("div");
    status.id="freeFireCheckStatus";
    status.className="freefire-check-status";
    status.setAttribute("role","status");
    status.setAttribute("aria-live","polite");

    const warning=document.createElement("div");
    warning.className="freefire-check-warning";
    warning.textContent="تنبيه: قد يظهر اسم اللاعب بشكل غير دقيق أو خاطئ. لا تعتمد على الاسم وحده؛ تأكد بنفسك من رقم الـID داخل اللعبة وأنه يعود لحسابك قبل متابعة أي شحن.";

    const confirmLabel=document.createElement("label");
    confirmLabel.id="freeFireIdConfirmLabel";
    confirmLabel.className="freefire-id-confirm";
    confirmLabel.hidden=true;
    const confirm=document.createElement("input");
    confirm.id="freeFireIdConfirm";
    confirm.type="checkbox";
    const confirmText=document.createElement("span");
    confirmText.textContent="أؤكد أن رقم الـID صحيح ويخص حسابي.";
    confirmLabel.append(confirm,confirmText);

    playerInput.insertAdjacentElement("afterend",button);
    button.insertAdjacentElement("afterend",status);
    status.insertAdjacentElement("afterend",warning);
    warning.insertAdjacentElement("afterend",confirmLabel);

    playerInput.addEventListener("input",()=>{
      window.baranFreeFireCheckSequence=(window.baranFreeFireCheckSequence||0)+1;
      window.baranFreeFireVerifiedPlayer=null;
      confirm.checked=false;
      confirmLabel.hidden=true;
      status.textContent="";
      status.classList.remove("is-success","is-error");
      button.disabled=false;
      button.textContent="تحقق من اسم لاعب";
    });
  }

  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install,{once:true});
  else install();
})();

window.baranFreeFireVerifiedPlayer=null;
window.baranFreeFireCheckSequence=0;

window.baranCheckFreeFirePlayer=async function(){
  const input=document.getElementById("freeFirePlayerId");
  const button=document.getElementById("freeFireCheckButton");
  const status=document.getElementById("freeFireCheckStatus");
  const confirmLabel=document.getElementById("freeFireIdConfirmLabel");
  const confirm=document.getElementById("freeFireIdConfirm");
  if(!input||!button||!status)return;

  const id=input.value.trim();
  window.baranFreeFireCheckSequence++;
  const sequence=window.baranFreeFireCheckSequence;
  window.baranFreeFireVerifiedPlayer=null;
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
  status.textContent="جارٍ التحقق من حساب Free Fire، انتظر قليلاً...";
  try{
    const {data:{session},error:sessionError}=await client.auth.getSession();
    if(sessionError||!session?.access_token)throw new Error("AUTH_REQUIRED");
    // supabase.functions.invoke automatically sends the signed-in user's session JWT.
    const {data,error}=await client.functions.invoke("baran-freefire-check",{body:{id}});
    if(sequence!==window.baranFreeFireCheckSequence||input.value.trim()!==id)return;
    if(error)throw error;

    if(!data||data.ok!==true||!data.player?.username){
      const code=data?.error||"";
      status.textContent=code==="PLAYER_NOT_FOUND"
        ?"لم يتم العثور على حساب بهذا الـID. راجع الرقم والمنطقة ثم أعد المحاولة."
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

    window.baranFreeFireVerifiedPlayer={
      id:id,
      username:String(data.player.username),
      region:data.player.region||null,
      level:data.player.level??null
    };
    status.textContent="تم العثور على الحساب — الاسم المعروض: "+window.baranFreeFireVerifiedPlayer.username+
      (window.baranFreeFireVerifiedPlayer.region?" · المنطقة: "+window.baranFreeFireVerifiedPlayer.region:"");
    status.classList.add("is-success");
    confirmLabel.hidden=false;
  }catch(error){
    if(sequence!==window.baranFreeFireCheckSequence)return;
    console.warn("Free Fire player check failed",error);
    status.textContent=error?.message==="AUTH_REQUIRED"
      ?"جلسة الدخول غير متاحة أو انتهت. سجّل الدخول من جديد ثم أعد المحاولة."
      :"تعذر الاتصال بخدمة التحقق. لم يتم اعتماد الـID؛ حاول لاحقاً.";
    status.classList.add("is-error");
  }finally{
    if(sequence===window.baranFreeFireCheckSequence){
      button.disabled=false;
      button.textContent="إعادة التحقق من اسم اللاعب";
    }
  }
};
