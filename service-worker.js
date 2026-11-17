self.addEventListener("push",event=>{
  let data={title:"Baran Game",body:"لديك إشعار جديد",url:"./"};
  try{if(event.data)data={...data,...event.data.json()};}catch(_){}
  event.waitUntil(self.registration.showNotification(data.title||"Baran Game",{
    body:data.body||"لديك إشعار جديد",
    icon:"./baran-icon.svg",
    badge:"./baran-icon.svg",
    data:{url:data.url||"./"},
    tag:data.tag||"baran-"+Date.now(),
    renotify:false,
    vibrate:[110,55,110],
    actions:[{action:"open",title:"فتح باران"}],
    dir:"rtl",
    lang:"ar"
  }));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  // Resolve relative notification URLs from this app's GitHub Pages scope.
  const target=new URL(event.notification.data?.url||"./",self.registration.scope).href;
  event.waitUntil((async()=>{
    const list=await clients.matchAll({type:"window",includeUncontrolled:true});
    for(const client of list){
      if(!client.url.startsWith(self.registration.scope))continue;
      try{
        const navigated=await client.navigate(target);
        if(navigated){
          await navigated.focus();
          return;
        }
      }catch(_){
        // Fall back to opening a fresh app window below.
      }
    }
    await clients.openWindow(target);
  })());
});
self.addEventListener("install",event=>{self.skipWaiting();});
self.addEventListener("activate",event=>{event.waitUntil(self.clients.claim());});
