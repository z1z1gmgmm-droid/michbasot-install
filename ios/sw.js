/* Michbasot R05: static shell + background Web Push. Never cache business API or content. */
'use strict';
const CACHE='mb-ios-shell-r05';
const FILES=['./','./index.html','./manifest.webmanifest','./ios-store.js',
  './p2p-device-link.js','./p2p-mobile-ios.js','./ios-bootstrap.js',
  './icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install', event=>event.waitUntil(
  caches.open(CACHE).then(cache=>Promise.allSettled(FILES.map(file=>cache.add(file)))).then(()=>self.skipWaiting())
));
self.addEventListener('activate', event=>event.waitUntil(Promise.all([
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('mb-ios-shell-')&&k!==CACHE).map(k=>caches.delete(k)))),
  self.clients.claim()
])));
self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url),scope=new URL(self.registration.scope);
  if(url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname)||url.pathname.includes('/api/'))return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).catch(()=>caches.match('./index.html')));
    return;
  }
  if(FILES.some(file=>new URL(file,scope).pathname===url.pathname)){
    event.respondWith(fetch(request).catch(()=>caches.match(request)));
  }
});
function db(){return new Promise((resolve,reject)=>{
  const req=indexedDB.open('mb-r05-notification-badge',1);
  req.onupgradeneeded=()=>{req.result.createObjectStore('state');};
  req.onsuccess=()=>resolve(req.result);
  req.onerror=()=>reject(req.error);
});}
async function badge(change, replacement){
  const database=await db();
  const n=await new Promise((resolve,reject)=>{
    const tx=database.transaction('state','readwrite'), store=tx.objectStore('state');
    const r=store.get('count');
    r.onsuccess=()=>{
      const old=Number.isFinite(r.result)?r.result:0;
      const next=Math.min(9999,Math.max(0,replacement===undefined?old+change:replacement));
      store.put(next,'count');resolve(next);
    };
    r.onerror=()=>reject(r.error);
  });
  database.close();
  try{
    if(n && typeof self.navigator.setAppBadge==='function')await self.navigator.setAppBadge(n);
    else if(!n && typeof self.navigator.clearAppBadge==='function')await self.navigator.clearAppBadge();
  }catch(_e){}
  return n;
}
self.addEventListener('message',event=>{
  const msg=event.data||{};
  if(msg.type==='MB_R05_BADGE_SYNC'&&Number.isSafeInteger(msg.count)){
    event.waitUntil(badge(0,Math.min(9999,msg.count)).catch(()=>{}));
  }
});
self.addEventListener('push',event=>event.waitUntil((async()=>{
  let packet={};
  try{packet=event.data?event.data.json():{};}catch(_e){}
  if(!packet||packet.type!=='mb-message')return;
  const hotel=typeof packet.hotel_id==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(packet.hotel_id)?packet.hotel_id:'';
  // No message content is included in the OS banner, especially on lock screens.
  try{await badge(1);}catch(_e){}
  await self.registration.showNotification('מכבסות מאוחדות אילת 1994',{
    body:'הודעה חדשה',
    tag:'mb-hotel-'+hotel,
    icon:'./icons/icon-192.png',
    badge:'./icons/icon-192.png',
    data:{hotel},
    renotify:true
  });
})()));
self.addEventListener('notificationclick',event=>event.waitUntil((async()=>{
  event.notification.close();
  const hotel=event.notification.data?.hotel||'';
  const list=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const existing=list.find(client=>client.url.startsWith(self.registration.scope))||list[0];
  if(existing){
    await existing.focus();
    existing.postMessage({type:'MB_R05_OPEN_HOTEL',hotel});
    return;
  }
  const url=new URL('./',self.registration.scope);
  if(hotel)url.searchParams.set('mbhotel',hotel);
  await self.clients.openWindow(url.href);
})()));
