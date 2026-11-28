function productCategoryLabel(category){
  return ({game:"الألعاب",ai:"الذكاء الاصطناعي",vpn:"VPN",gift_card:"البطاقات الرقمية",app:"التطبيقات المدفوعة"}[category]||category);
}

let currentExchangeRate=144;

function applyExchangeRate(rate){
  const parsed=Number(rate);
  if(!Number.isFinite(parsed)||parsed<=0)return;
  currentExchangeRate=parsed;
  const input=document.getElementById("exchangeRateInput");
  if(input)input.value=String(currentExchangeRate);
  const display=document.getElementById("currentExchangeRate");
  if(display)display.textContent="1 $ = "+currentExchangeRate.toLocaleString("en-US",{maximumFractionDigits:2})+" ل.س جديدة";
  updateProductPricePreview();
}

function productPriceText(product){
  const usd=Number(product.price_usd||0);
  if(usd<=0)return "السعر غير محدد";
  return usd.toFixed(2)+" $  •  "+Math.round(usd*currentExchangeRate).toLocaleString("en-US")+" ل.س جديدة";
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
  document.getElementById("productPriceUsd").value=product.price_usd==null?"":Number(product.price_usd);
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
  const priceRaw=document.getElementById("productPriceUsd").value.trim();
  const priceUsd=priceRaw===""?null:Number(priceRaw);
  const sortOrder=Number(document.getElementById("productSortOrder").value);
  if(!/^[A-Z0-9][A-Z0-9_-]{1,59}$/.test(productCode)){message.textContent="اكتب رمزاً إنجليزياً من حرفين على الأقل، مثل FREEFIRE_100.";return;}
  if(name.length<2){message.textContent="اكتب اسم المنتج.";return;}
  if(priceUsd!==null&&(!Number.isFinite(priceUsd)||priceUsd<=0)){message.textContent="إذا ما عندك سعر اترك الحقل فارغاً، وإذا توفر أدخل سعراً أكبر من صفر.";return;}
  if(!Number.isInteger(sortOrder)||sortOrder<0){message.textContent="ترتيب العرض يجب أن يكون رقماً صحيحاً موجباً أو صفراً.";return;}
  const payload={
    action:"product_save",
    product_id:document.getElementById("productId").value||undefined,
    product_code:productCode,
    category:document.getElementById("productCategory").value,
    name,description,price_usd:priceUsd,
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
  const gameBox=document.getElementById("gameProductCatalog");
  const serviceBox=document.getElementById("serviceProductCatalog");
  if(!gameBox||!serviceBox)return;
  try{
    const [{data:settings,error:settingsError},{data,error}]=await Promise.all([
      sb.from("store_settings").select("market_exchange_rate,fx_buffer_percent").eq("id","main").single(),
      sb.from("products")
        .select("id,product_code,category,name,description,price_usd,sort_order,created_at")
        .eq("catalog_visible",true)
        .order("sort_order",{ascending:true})
        .order("created_at",{ascending:false})
    ]);
    if(settingsError)throw settingsError;
    if(error)throw error;
    const marketRate=Number(settings.market_exchange_rate);
    const fxBuffer=Number(settings.fx_buffer_percent);
    if(!Number.isFinite(marketRate)||marketRate<=0||!Number.isFinite(fxBuffer)||fxBuffer<0)throw new Error("إعدادات سعر الصرف غير صالحة.");
    applyExchangeRate((marketRate*(1+fxBuffer/100))/100);
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
        const note=document.createElement("div");note.className="small";note.textContent=product.price_usd==null||Number(product.price_usd)<=0?"قيد التجهيز — السعر غير محدد، والطلب غير متاح حالياً." :"سعر للعرض فقط — البيع والطلب والشحن مغلق.";
        card.append(title,description,prices,note);group.box.appendChild(card);
      });
    });
  }catch(error){
    [gameBox,serviceBox].forEach(box=>{box.classList.remove("hidden");box.textContent="تعذر تحميل المنتجات حالياً.";});
  }
}


function renderExtraGamePriceCards(products){
  const groups=[
    {key:"yalla-ludo",title:"يلا لودو",icon:"🎲",match:p=>/^HOMSCARD_GAME_(104|105|106|107|108|109|110|112)$/.test(p.product_code)},
    {key:"ludo-club",title:"لودو كلوب",icon:"🎲",match:p=>/^HOMSCARD_GAME_(1269|1270|1271|1272|1273|1274|1275)$/.test(p.product_code)},
    {key:"billiards",title:"8 Ball Pool",icon:"🎱",match:p=>/^BILLIARDS_/.test(p.product_code)},
    {key:"whiteout",title:"Whiteout Survival",icon:"❄️",match:p=>/^HOMSCARD_GAME_(534|535|536|537|538|539)$/.test(p.product_code)},
    {key:"mobile-legends",title:"Mobile Legends",icon:"⚔️",match:p=>/^HOMSCARD_GAME_(197|198|199|200)$/.test(p.product_code)}
  ];
  groups.forEach(group=>{
    const card=document.querySelector('[data-baran-extra-game="'+group.key+'"]');
    if(!card)return;
    const old=card.querySelector(".baran-extra-game-price-list");
    if(old)old.remove();
    const items=products.filter(group.match).sort((a,b)=>(Number(a.sort_order)||0)-(Number(b.sort_order)||0)||a.name.localeCompare(b.name,"ar"));
    const coming=card.querySelector(".baran-game-coming");
    if(coming){
      coming.textContent=items.length?"الباقات والأسعار — قريباً، غير جاهز للطلب":"لا توجد باقات مسعّرة مؤكدة";
      coming.className="small baran-game-price-status";
    }
    const panel=document.createElement("div");
    panel.className="baran-extra-game-price-list game-catalog";
    const heading=document.createElement("strong");
    heading.textContent="باقات "+group.title+" · "+items.length;
    panel.appendChild(heading);
    if(!items.length){
      const empty=document.createElement("p");
      empty.className="small";
      empty.textContent="لا توجد باقات مسعّرة مؤكدة حالياً من حمص كارد.";
      panel.appendChild(empty);
    }else{
      const grid=document.createElement("div");
      grid.className="game-package-grid";
      grid.dataset.extraGamePackageGrid=group.key;
      items.forEach(product=>{
        const packageCard=document.createElement("div");
        packageCard.className="baran-game-package-card";
        packageCard.dataset.packageCode=product.product_code;
        const option=document.createElement("button");
        option.type="button";
        option.className="game-package-option baran-package-button";
        option.disabled=true;
        option.setAttribute("aria-disabled","true");
        option.setAttribute("aria-label",(product.name||group.title)+" — قريباً، غير جاهز للطلب");
        const art=document.createElement("span");
        art.className="baran-package-art";
        art.setAttribute("aria-hidden","true");
        art.textContent=group.icon;
        const quantity=document.createElement("span");
        quantity.className="baran-package-quantity";
        quantity.textContent="باقة شحن";
        const name=document.createElement("strong");
        name.textContent=String(product.name||product.product_code).replace(/^(Yalla Ludo|Ludo Club|Whiteout Survival|Mobile Legends|8 Ball Pool)\s*[—-]?\s*/i,"");
        const description=document.createElement("small");
        description.textContent=product.description||"باقة رقمية من كتالوج حمص كارد";
        const price=document.createElement("span");
        price.className="game-package-price";
        const usd=Number(product.price_usd||0),syp=Number(product.price_syp||0);
        price.textContent=(usd>0?usd.toFixed(2)+" $":"—")+(syp>0?" · "+syp.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})+" ل.س جديدة":"");
        const pending=document.createElement("small");
        pending.className="game-package-pending";
        pending.textContent="قريباً — غير جاهز للطلب أو الشحن";
        option.append(art,quantity,name,description,price,pending);
        packageCard.appendChild(option);
        grid.appendChild(packageCard);
      });
      panel.appendChild(grid);
    }
    const note=document.createElement("p");
    note.className="small";
    note.textContent="الأسعار للمعاينة فقط. لا يوجد اختيار باقة أو إنشاء طلب أو خصم رصيد أو شحن.";
    panel.appendChild(note);
    card.querySelector(".item-content")?.appendChild(panel);
  });
}
async function loadExtraGamePriceCards(){
  if(typeof sb==="undefined"||!sb?.from)return;
  try{
    const {data,error}=await sb.from("products")
      .select("product_code,name,description,price_usd,price_syp,sort_order")
      .eq("category","game")
      .eq("catalog_visible",true)
      .gt("price_usd",0);
    if(error)throw error;
    renderExtraGamePriceCards(data||[]);
  }catch(error){
    console.warn("Extra game price cards could not load:",error);
  }
}

if(document.readyState==="complete")loadExtraGamePriceCards();
else window.addEventListener("load",loadExtraGamePriceCards,{once:true});


async function saveExchangeRate(){
  const input=document.getElementById("exchangeRateInput");
  const message=document.getElementById("exchangeRateMessage");
  const button=document.getElementById("saveExchangeRateButton");
  const rate=Number(input?.value);
  if(!Number.isFinite(rate)||rate<=0||rate>1000000){
    if(message)message.textContent="أدخل سعر صرف صحيحاً أكبر من صفر.";
    return;
  }
  const storedRate=rate*100;
  if(!confirm("تأكيد اعتماد سعر الصرف الجديد: 1 دولار = "+rate.toLocaleString("en-US",{maximumFractionDigits:2})+" ل.س جديدة؟ ستتحدث أسعار الليرة لكل المنتجات."))return;
  if(button)button.disabled=true;
  if(message)message.textContent="جاري تحديث سعر الصرف والأسعار...";
  try{
    const {data:policy,error:policyError}=await sb.from("store_settings")
      .select("fx_buffer_percent,product_markup_percent").eq("id","main").single();
    if(policyError||!policy)throw new Error("تعذر قراءة سياسة التسعير الحالية.");
    const fxBuffer=Number(policy.fx_buffer_percent),markup=Number(policy.product_markup_percent);
    if(!Number.isFinite(fxBuffer)||fxBuffer<0||!Number.isFinite(markup)||markup<0)throw new Error("سياسة التسعير الحالية غير صالحة.");
    const marketRate=storedRate/(1+fxBuffer/100);
    const result=await callAdminApi("POST",{action:"pricing_policy_update",market_exchange_rate:marketRate,fx_buffer_percent:fxBuffer,product_markup_percent:markup});
    if(!result?.pricing_policy)throw new Error("لم يؤكد الخادم حفظ سياسة التسعير.");
    applyExchangeRate(rate);
    if(typeof loadAdminPanel==="function")await loadAdminPanel();
    if(typeof loadCatalog==="function")await loadCatalog();
    if(message)message.textContent="تم تحديث سعر الصرف التجاري بالليرة الجديدة وتحديث معاينة الأسعار.";
  }catch(error){
    if(message)message.textContent="تعذر تحديث سعر الصرف: "+error.message;
  }finally{if(button)button.disabled=false;}
}

function updateProductPricePreview(){
  const preview=document.getElementById("productPricePreview");
  if(!preview)return;
  const usd=Number(document.getElementById("productPriceUsd")?.value||0);
  preview.textContent=usd>0?"السعر بالليرة الجديدة: "+Math.round(usd*currentExchangeRate).toLocaleString("en-US")+" ل.س جديدة":"اترك السعر فارغاً إذا لم يُحدد بعد؛ سيظهر للزبائن: السعر غير محدد.";
}

// Load the Free Fire ID checker without exposing provider credentials.
import("./freefire-check.js").catch(error=>console.error("Baran Free Fire checker could not load",error));

// Load the PUBG Mobile ID checker without exposing provider credentials.
import("./pubg-check.js").catch(error=>console.error("Baran PUBG checker could not load",error));
