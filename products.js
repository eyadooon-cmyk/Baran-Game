function productCategoryLabel(category){
  return ({game:"الألعاب",ai:"الذكاء الاصطناعي",vpn:"VPN",gift_card:"البطاقات الرقمية",app:"التطبيقات المدفوعة"}[category]||category);
}

function productPriceText(product){
  const parts=[];
  if(Number(product.price_usd)>0) parts.push(Number(product.price_usd).toFixed(2)+" $");
  if(Number(product.price_syp)>0) parts.push(Number(product.price_syp).toLocaleString("en-US")+" ل.س");
  return parts.length?parts.join("  •  "):"السعر غير محدد";
}

function renderProducts(products){
  const box=document.getElementById("adminProducts");
  if(!box)return;
  box.replaceChildren();
  if(!products.length){box.textContent="لا توجد منتجات بعد. أضف أول منتج من النموذج أعلاه.";return;}
  products.forEach(product=>{
    const card=document.createElement("div");
    card.className="product-admin-card";
    const title=document.createElement("strong");
    title.textContent=product.name;
    const details=document.createElement("div");
    details.textContent="الرمز: "+product.product_code+" | القسم: "+productCategoryLabel(product.category);
    const description=document.createElement("div");
    description.textContent=product.description||"لا يوجد وصف.";
    const prices=document.createElement("div");
    prices.className="product-prices";
    prices.textContent=productPriceText(product);
    const status=document.createElement("div");
    status.className="small";
    status.textContent=product.is_active?"الحالة: مفعّل ويظهر للزبائن":"الحالة: متوقف ومخفي عن الزبائن";
    const actions=document.createElement("div");
    actions.className="product-admin-actions";
    const edit=document.createElement("button");
    edit.type="button";edit.textContent="تعديل";edit.onclick=()=>editProduct(product);
    const toggle=document.createElement("button");
    toggle.type="button";toggle.className="secondary";
    toggle.textContent=product.is_active?"إيقاف المنتج":"تفعيل المنتج";
    toggle.onclick=()=>toggleProduct(product);
    actions.append(edit,toggle);
    card.append(title,details,description,prices,status,actions);
    box.appendChild(card);
  });
}

function resetProductForm(){
  ["productId","productCode","productName","productDescription"].forEach(id=>document.getElementById(id).value="");
  document.getElementById("productCategory").value="game";
  document.getElementById("productPriceUsd").value="0";
  document.getElementById("productPriceSyp").value="0";
  document.getElementById("productSortOrder").value="100";
  document.getElementById("productActive").value="true";
  document.getElementById("productMessage").textContent="";
}

function editProduct(product){
  document.getElementById("productId").value=product.id;
  document.getElementById("productCode").value=product.product_code;
  document.getElementById("productCategory").value=product.category;
  document.getElementById("productName").value=product.name;
  document.getElementById("productDescription").value=product.description||"";
  document.getElementById("productPriceUsd").value=Number(product.price_usd||0);
  document.getElementById("productPriceSyp").value=Number(product.price_syp||0);
  document.getElementById("productSortOrder").value=Number(product.sort_order||0);
  document.getElementById("productActive").value=String(product.is_active);
  document.getElementById("productMessage").textContent="تعدّل الآن: "+product.name;
  document.getElementById("productCode").scrollIntoView({behavior:"smooth",block:"center"});
}

async function saveProduct(){
  const message=document.getElementById("productMessage");
  const button=document.getElementById("saveProductButton");
  const productCode=document.getElementById("productCode").value.trim().toUpperCase();
  const name=document.getElementById("productName").value.trim();
  const description=document.getElementById("productDescription").value.trim();
  const priceUsd=Number(document.getElementById("productPriceUsd").value);
  const priceSyp=Number(document.getElementById("productPriceSyp").value);
  const sortOrder=Number(document.getElementById("productSortOrder").value);
  if(!/^[A-Z0-9][A-Z0-9_-]{1,59}$/.test(productCode)){message.textContent="اكتب رمزاً إنجليزياً من حرفين على الأقل، مثل FREEFIRE_100.";return;}
  if(name.length<2){message.textContent="اكتب اسم المنتج.";return;}
  if(!Number.isFinite(priceUsd)||priceUsd<0||!Number.isFinite(priceSyp)||priceSyp<0||(priceUsd<=0&&priceSyp<=0)){message.textContent="أدخل سعراً صحيحاً بعملة واحدة على الأقل.";return;}
  if(!Number.isInteger(sortOrder)||sortOrder<0){message.textContent="ترتيب العرض يجب أن يكون رقماً صحيحاً موجباً أو صفراً.";return;}
  const payload={
    action:"product_save",
    product_id:document.getElementById("productId").value||undefined,
    product_code:productCode,
    category:document.getElementById("productCategory").value,
    name,description,price_usd:priceUsd,price_syp:priceSyp,
    sort_order:sortOrder,
    is_active:document.getElementById("productActive").value==="true"
  };
  button.disabled=true;message.textContent="جاري حفظ المنتج بأمان...";
  try{
    await callAdminApi("POST",payload);
    resetProductForm();
    await loadAdminPanel();
    message.textContent="تم حفظ المنتج وتحديث القائمة.";
  }catch(error){message.textContent="تعذر حفظ المنتج: "+error.message;}
  finally{button.disabled=false;}
}

async function toggleProduct(product){
  const nextState=!product.is_active;
  if(!confirm(nextState?"هل تريد تفعيل المنتج وإظهاره للزبائن؟":"هل تريد إيقاف المنتج وإخفاءه عن الزبائن؟"))return;
  const message=document.getElementById("productMessage");
  message.textContent="جاري تحديث حالة المنتج...";
  try{
    await callAdminApi("POST",{action:"product_status",product_id:product.id,is_active:nextState});
    await loadAdminPanel();
    message.textContent=nextState?"تم تفعيل المنتج.":"تم إيقاف المنتج وإخفاؤه.";
  }catch(error){message.textContent="تعذر تحديث المنتج: "+error.message;}
}

async function loadCatalog(){
  if(!currentUser)return;
  const gameBox=document.getElementById("gameProductCatalog");
  const serviceBox=document.getElementById("serviceProductCatalog");
  if(!gameBox||!serviceBox)return;
  try{
    const {data,error}=await sb.from("products")
      .select("id,product_code,category,name,description,price_usd,price_syp,sort_order,created_at")
      .eq("is_active",true)
      .order("sort_order",{ascending:true})
      .order("created_at",{ascending:false});
    if(error)throw error;
    const products=data||[];
    [
      {box:gameBox,title:"باقات الألعاب المتاحة",items:products.filter(p=>p.category==="game")},
      {box:serviceBox,title:"المنتجات والخدمات المتاحة",items:products.filter(p=>p.category!=="game")}
    ].forEach(group=>{
      group.box.replaceChildren();
      group.box.classList.toggle("hidden",group.items.length===0);
      if(!group.items.length)return;
      const heading=document.createElement("h3");heading.textContent=group.title;group.box.appendChild(heading);
      group.items.forEach(product=>{
        const card=document.createElement("div");card.className="product-card";
        const title=document.createElement("strong");title.textContent=product.name;
        const description=document.createElement("p");description.textContent=product.description||"";
        const prices=document.createElement("div");prices.className="product-prices";prices.textContent=productPriceText(product);
        const note=document.createElement("div");note.className="small";note.textContent="الطلب والشحن غير مفعّلين بعد.";
        card.append(title,description,prices,note);group.box.appendChild(card);
      });
    });
  }catch(error){
    [gameBox,serviceBox].forEach(box=>{box.classList.remove("hidden");box.textContent="تعذر تحميل المنتجات حالياً.";});
  }
}
