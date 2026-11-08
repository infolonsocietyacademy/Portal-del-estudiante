/* OLON Web Push. No authenticated responses or account data are cached. */
const notificationPages={classes:'classes',vip:'vip',notifications:'notifications'};
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
function targetURL(kind){
  const url=new URL(self.registration.scope);
  url.searchParams.set('notify',notificationPages[kind]||'notifications');
  return url.href;
}
self.addEventListener('push',event=>{
  let data={};
  try{data=event.data?.json()||{};}catch{ /* Always display a visible generic notification. */ }
  const kind=notificationPages[data.kind]||'notifications';
  const title=String(data.title||'OLON Society Academy').slice(0,100);
  const options={body:String(data.body||'Tienes un nuevo aviso en el Portal del Trader.').slice(0,250),
    icon:new URL('assets/icon-192.png',self.registration.scope).href,
    badge:new URL('assets/icon-192.png',self.registration.scope).href,
    tag:String(data.tag||'olon-notification').slice(0,180),data:{kind,url:targetURL(kind)}};
  event.waitUntil(self.registration.showNotification(title,options));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const kind=notificationPages[event.notification.data?.kind]||'notifications';
  const url=targetURL(kind);
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const scope=new URL(self.registration.scope);
    const existing=windows.find(client=>{const page=new URL(client.url);return page.origin===scope.origin&&page.pathname.startsWith(scope.pathname);});
    if(existing){await existing.focus();existing.postMessage({type:'OLON_OPEN_NOTIFICATION',kind});}
    else await self.clients.openWindow(url);
  })());
});
