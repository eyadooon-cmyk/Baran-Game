/* BARAN GAME — Cloudflare Turnstile for Supabase Auth */
(function(){
  "use strict";
  const SITE_KEY="0x4AAAAAAGNY2P5q5hGyUECS";
  const widgets={};
  const tokens={login:"",signup:"",reset:""};
  let readyResolve;
  const ready=new Promise(resolve=>{readyResolve=resolve;});
  function load(){
    if(window.turnstile){readyResolve(true);return;}
    const script=document.createElement("script");
    script.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async=true;script.defer=true;
    script.onload=()=>readyResolve(!!window.turnstile);
    script.onerror=()=>readyResolve(false);
    document.head.appendChild(script);
  }
  function mount(id,buttonId){
    const button=document.getElementById(buttonId);
    if(!button||document.getElementById(id))return;
    const box=document.createElement("div");
    box.id=id;box.className="baran-turnstile-box";
    box.style.cssText="display:flex;justify-content:center;margin:12px auto;min-height:65px;max-width:100%;";
    button.parentNode.insertBefore(box,button);
  }
  function isShown(id){
    const el=document.getElementById(id);
    return !!el&&!el.closest(".hidden")&&getComputedStyle(el).display!=="none";
  }
  async function renderVisible(){
    const ok=await ready;
    if(!ok||!window.turnstile){console.error("BARAN Turnstile failed to load");return;}
    const visible=[
      ["login","baranTurnstileLogin","authScreen"],
      ["signup","baranTurnstileSignup","signupScreen"],
      ["reset","baranTurnstileReset","authScreen"]
    ];
    visible.forEach(([name,id,screen])=>{
      if(!isShown(screen)||widgets[name]!==undefined)return;
      const buttonId=name==="login"?"loginButton":name==="signup"?"signupSubmitButton":"forgotPasswordButton";
      mount(id,buttonId);
      if(!document.getElementById(id))return;
      widgets[name]=window.turnstile.render("#"+id,{
        sitekey:SITE_KEY,theme:"dark",size:"flexible",
        callback(token){tokens[name]=token;},
        "expired-callback"(){tokens[name]="";},
        "error-callback"(){tokens[name]="";}
      });
    });
  }
  function observeScreens(){
    const observer=new MutationObserver(()=>renderVisible());
    ["authScreen","signupScreen"].forEach(id=>{
      const el=document.getElementById(id);
      if(el)observer.observe(el,{attributes:true,attributeFilter:["class","style"]});
    });
    renderVisible();
  }
  window.baranTurnstileToken=async function(name){
    await ready;
    if(!window.turnstile||widgets[name]===undefined||!tokens[name]){
      throw new Error("يرجى إكمال التحقق الأمني أولاً.");
    }
    const token=tokens[name];
    tokens[name]="";
    try{window.turnstile.reset(widgets[name]);}catch(e){}
    return token;
  };
  load();
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",observeScreens,{once:true});
  else observeScreens();
})();