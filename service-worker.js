self.addEventListener("push",event=>{
  let data={title:"Baran Game",body:"لديك إشعار جديد",url:"./"};
  try{if(event.data)data={...data,...event.data.json()};}catch(_){}
  event.waitUntil(self.registration.showNotification(data.title||"Baran Game",{
    body:data.body||"لديك إشعار جديد",
    data:{url:data.url||"./"},
    tag:data.tag||"baran-"+Date.now(),
    renotify:false,
    dir:"rtl",
    lang:"ar"
  }));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||"./",self.location.origin).href;
  event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{
    for(const client of list){
      if(client.url.startsWith(self.location.origin)){
        return client.navigate(target).then(()=>client.focus());
      }
    }
    return clients.openWindow(target);
  }));
});
self.addEventListener("install",event=>{self.skipWaiting();});
self.addEventListener("activate",event=>{event.waitUntil(self.clients.claim());});
