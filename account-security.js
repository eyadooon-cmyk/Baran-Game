function passwordMeetsPolicy(value){
  const symbols="!@#$%^&*()_+-=[]{};\'\"|<>?,./`~";
  return value.length>=8 &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /[0-9]/.test(value) &&
    Array.from(symbols).some(symbol=>value.includes(symbol));
}

function showPasswordRecovery(){
  document.getElementById("authScreen").classList.add("hidden");
  document.getElementById("appShell").classList.add("hidden");
  document.getElementById("lockScreen").classList.add("hidden");
  document.getElementById("passwordRecoveryScreen").classList.remove("hidden");
  document.getElementById("recoveryMessage").textContent="اختر كلمة مرور جديدة لحسابك.";
}

async function sendPasswordReset(){
  const email=document.getElementById("email").value.trim();
  const message=document.getElementById("message");
  if(!email){message.textContent="اكتب بريدك الإلكتروني أولاً، ثم اضغط نسيت كلمة المرور.";return;}
  const button=document.getElementById("forgotPasswordButton");
  button.disabled=true;
  message.textContent="جاري إرسال رابط استعادة كلمة المرور...";
  try{
    const redirectTo=window.location.origin+window.location.pathname;
    const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo});
    if(error)throw error;
    message.textContent="إذا كان البريد مسجلاً، سيصلك رابط استعادة. افتحه من نفس الجهاز لإدخال كلمة مرور جديدة.";
  }catch(error){
    message.textContent="تعذر إرسال رابط الاستعادة: "+error.message;
  }finally{button.disabled=false;}
}

async function saveRecoveredPassword(){
  const password=document.getElementById("recoveryPassword").value;
  const confirmPassword=document.getElementById("recoveryPasswordConfirm").value;
  const message=document.getElementById("recoveryMessage");
  if(!passwordMeetsPolicy(password)){
    message.textContent="كلمة المرور يجب أن تكون 8 أحرف على الأقل وتضم حرفاً كبيراً وصغيراً ورقماً ورمزاً.";
    return;
  }
  if(password!==confirmPassword){message.textContent="كلمتا المرور غير متطابقتين.";return;}
  message.textContent="جاري تحديث كلمة المرور بأمان...";
  try{
    const {data,error}=await sb.auth.updateUser({password});
    if(error)throw error;
    passwordRecoveryActive=false;
    document.getElementById("recoveryPassword").value="";
    document.getElementById("recoveryPasswordConfirm").value="";
    showApp(data.user);
    alert("تم تحديث كلمة المرور بنجاح. احتفظ بها بمكان آمن.");
  }catch(error){
    message.textContent="تعذر تحديث كلمة المرور: "+error.message;
  }
}

async function changeAccountPassword(){
  if(!currentUser?.email)return;
  const current=document.getElementById("currentAccountPassword").value;
  const next=document.getElementById("newAccountPassword").value;
  const confirmNext=document.getElementById("confirmAccountPassword").value;
  const message=document.getElementById("changePasswordMessage");
  const button=document.getElementById("changePasswordButton");
  if(!current){message.textContent="أدخل كلمة المرور الحالية للتحقق من هويتك.";return;}
  if(!passwordMeetsPolicy(next)){message.textContent="كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل وتضم حرفاً كبيراً وصغيراً ورقماً ورمزاً.";return;}
  if(next!==confirmNext){message.textContent="تأكيد كلمة المرور غير مطابق.";return;}
  if(next===current){message.textContent="اختر كلمة مرور مختلفة عن الحالية.";return;}
  button.disabled=true;
  message.textContent="جاري التحقق من كلمة المرور الحالية...";
  try{
    const {error:verifyError}=await sb.auth.signInWithPassword({email:currentUser.email,password:current});
    if(verifyError)throw new Error("كلمة المرور الحالية غير صحيحة.");
    const {error}=await sb.auth.updateUser({password:next});
    if(error)throw error;
    ["currentAccountPassword","newAccountPassword","confirmAccountPassword"].forEach(id=>document.getElementById(id).value="");
    message.textContent="تم تغيير كلمة المرور بنجاح.";
  }catch(error){
    message.textContent="تعذر تغيير كلمة المرور: "+error.message;
  }finally{button.disabled=false;}
}
