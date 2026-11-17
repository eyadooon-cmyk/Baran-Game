self.addEventListener("push",event=>{
  let payload={title:"Baran Game",body:"لديك إشعار جديد",url:"./"};
  try{if(event.data)payload={...payload,...event.data.json()};}catch(_){}
  const notificationData={...payload};
  event.waitUntil(self.registration.showNotification(payload.title||"Baran Game",{
    body:payload.body||"لديك إشعار جديد",
    icon:"./baran-icon.svg",
    badge:"./baran-icon.svg",
    data:notificationData,
    tag:payload.tag||"baran-"+Date.now(),
    renotify:false,
    vibrate:[110,55,110],
    actions:[{action:"open",title:"فتح باران"}],
    dir:"rtl",
    lang:"ar"
  }));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const payload=event.notification.data||{};
  const scopeUrl=new URL(self.registration.scope);
  let target;
  try{
    target=new URL(payload.url||"./",self.registration.scope);
    if(target.origin!==scopeUrl.origin||!target.pathname.startsWith(scopeUrl.pathname))target=new URL("./",self.registration.scope);
  }catch(_){target=new URL("./",self.registration.scope);}
  const notificationId=payload.notification_id||payload.notificationId||payload.baran_notification;
  if(notificationId)target.searchParams.set("baran_notification",String(notificationId));
  else if(payload.entity_type&&payload.entity_id){
    target.searchParams.set("baran_entity_type",String(payload.entity_type));
    target.searchParams.set("baran_entity_id",String(payload.entity_id));
    if(payload.kind)target.searchParams.set("baran_kind",String(payload.kind));
    if(payload.audience)target.searchParams.set("baran_audience",String(payload.audience));
  }
  const targetUrl=target.href;
  event.waitUntil((async()=>{
    const windows=await clients.matchAll({type:"window",includeUncontrolled:true});
    for(const client of windows){
      if(!client.url.startsWith(self.registration.scope))continue;
      try{
        const navigated=await client.navigate(targetUrl);
        if(navigated){await navigated.focus();return;}
      }catch(_){}
    }
    await clients.openWindow(targetUrl);
  })());
});
self.addEventListener("install",event=>{self.skipWaiting();});
self.addEventListener("activate",event=>{event.waitUntil(self.clients.claim());});
