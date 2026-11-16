/* R01 iPhone shell only. Never cache API, messages, invite responses or private data. */
const CACHE='mb-ios-shell-r02';
const FILES=['./','./index.html','./manifest.webmanifest','./ios-store.js','./p2p-device-link.js','./p2p-mobile-ios.js','./ios-bootstrap.js','./icons/icon-192.png','./icons/icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('mb-ios-shell-')&&k!==CACHE).map(k=>caches.delete(k)))),self.clients.claim()])));
self.addEventListener('fetch',e=>{
 const req=e.request;if(req.method!=='GET')return;
 const u=new URL(req.url),scope=new URL(self.registration.scope);
 if(u.origin!==scope.origin||!u.pathname.startsWith(scope.pathname)||u.pathname.includes('/api/'))return;
 if(req.mode==='navigate'){
   e.respondWith(fetch(req).catch(()=>caches.match('./index.html')));return;
 }
 const known=FILES.some(f=>new URL(f,scope).pathname===u.pathname);
 if(known)e.respondWith(caches.match(req).then(x=>x||fetch(req)));
});
// Push can be enabled after the office-side subscription/sender has been integrated.
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(xs=>xs.length?xs[0].focus():self.clients.openWindow('./')));});
