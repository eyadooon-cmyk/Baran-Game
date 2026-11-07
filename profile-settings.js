async function loadProfileDetails(){
  if(!currentUser)return;
  const nameInput=document.getElementById("profileFullName");
  const phoneInput=document.getElementById("profilePhone");
  const message=document.getElementById("profileMessage");
  if(!nameInput||!phoneInput)return;
  message.textContent="جاري تحميل بيانات الحساب...";
  try{
    const {data,error}=await sb.from("profiles")
      .select("full_name,phone")
      .eq("id",currentUser.id)
      .maybeSingle();
    if(error)throw error;
    nameInput.value=data?.full_name||currentUser.user_metadata?.full_name||"";
    phoneInput.value=data?.phone||"";
    if(typeof updateBaranAccountIdentity==="function"){
      updateBaranAccountIdentity({...currentUser,user_metadata:{...(currentUser.user_metadata||{}),full_name:nameInput.value||currentUser.user_metadata?.full_name}});
    }
    message.textContent="يمكنك تعديل الاسم ورقم الهاتف وحفظهما.";
    document.getElementById("newAccountEmail").value=currentUser.email||"";
  }catch(error){
    message.textContent="تعذر تحميل البيانات: "+error.message;
  }
}

async function saveProfileDetails(){
  if(!currentUser)return;
  const fullName=document.getElementById("profileFullName").value.trim();
  const phone=document.getElementById("profilePhone").value.trim();
  const message=document.getElementById("profileMessage");
  const button=document.getElementById("saveProfileButton");
  if(fullName.length<2||fullName.length>80){
    message.textContent="الاسم يجب أن يكون بين حرفين و80 حرفاً.";
    return;
  }
  if(phone.length>0&&(phone.length<6||phone.length>30)){
    message.textContent="تحقق من رقم الهاتف، يجب أن يكون بين 6 و30 خانة.";
    return;
  }
  button.disabled=true;message.textContent="جاري حفظ بياناتك...";
  try{
    const {data:existing,error:readError}=await sb.from("profiles")
      .select("id").eq("id",currentUser.id).maybeSingle();
    if(readError)throw readError;
    if(!existing)throw new Error("لم يتم العثور على ملف الحساب. سجّل الخروج ثم الدخول وحاول مجدداً.");
    const {error}=await sb.from("profiles")
      .update({full_name:fullName,phone:phone||null})
      .eq("id",currentUser.id);
    if(error)throw error;
    const {error:metadataError}=await sb.auth.updateUser({data:{full_name:fullName}});
    if(metadataError)console.warn("Profile metadata sync skipped",metadataError.message);
    document.getElementById("accountInfo").textContent=currentUser.email||"";
    if(typeof updateBaranAccountIdentity==="function")updateBaranAccountIdentity({...currentUser,user_metadata:{...(currentUser.user_metadata||{}),full_name:fullName}});
    message.textContent="تم حفظ بيانات الحساب بنجاح.";
  }catch(error){
    message.textContent="تعذر حفظ البيانات: "+error.message;
  }finally{button.disabled=false;}
}

async function changeAccountEmail(){
  if(!currentUser?.email)return;
  const nextEmail=document.getElementById("newAccountEmail").value.trim();
  const password=document.getElementById("emailChangePassword").value;
  const message=document.getElementById("emailChangeMessage");
  const button=document.getElementById("changeEmailButton");
  if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(nextEmail)){
    message.textContent="أدخل بريداً إلكترونياً صحيحاً.";
    return;
  }
  if(nextEmail.toLowerCase()===currentUser.email.toLowerCase()){
    message.textContent="هذا هو البريد الحالي للحساب.";
    return;
  }
  if(!password){message.textContent="أدخل كلمة المرور الحالية لتأكيد هويتك.";return;}
  button.disabled=true;message.textContent="جاري التحقق وإرسال رابط التأكيد...";
  try{
    const {error:verifyError}=await sb.auth.signInWithPassword({email:currentUser.email,password});
    if(verifyError)throw new Error("كلمة المرور الحالية غير صحيحة.");
    const {error}=await sb.auth.updateUser({email:nextEmail});
    if(error)throw error;
    document.getElementById("emailChangePassword").value="";
    message.textContent="أرسلنا رابط تأكيد إلى البريد الجديد. سيبقى البريد الحالي فعالاً حتى تؤكد التغيير.";
  }catch(error){
    message.textContent="تعذر تغيير البريد: "+error.message;
  }finally{button.disabled=false;}
}
