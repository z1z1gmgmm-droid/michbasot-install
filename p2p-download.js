/* R56 hybrid: new R53 fragment invitations try original P2P first, then local
 * personalization of a pinned same-origin HTTPS base APK. Old t links unchanged. */
(()=>{'use strict';
const params=new URLSearchParams(location.hash.replace(/^#/,'')), roles={d:'driver',m:'manager',c:'client'},keys=Object.keys(roles).filter(k=>params.has(k));
if(!keys.length)return; // legacy branch follows below
const $=id=>document.getElementById(id), main=document.querySelector('main');main.setAttribute('data-mb-hybrid','1');
const pins={driver:'aa262d6d01ecd723bfd1546228b703cf72cfbad39039ea8df2aeca1295012ddc',manager:'95319000656f3391835bd1ea2e69a1c68267154c70777323b16500340582887f',client:'9fdf07d9c80b1fb4aabba25a985d040b3f2507e307acabb208af1b42df0bf0c4'};
const role=roles[keys[0]], token=params.get(keys[0]), filename='Michbasot_'+role[0].toUpperCase()+role.slice(1)+'.apk';
const hex=b=>Array.from(b,x=>x.toString(16).padStart(2,'0')).join(''), sha=async b=>hex(new Uint8Array(await crypto.subtle.digest('SHA-256',b))), hashText=s=>sha(new TextEncoder().encode(s));
let link=null, timer=null, phase='idle', run=0, meta=null, chunks=[],next=0,length=0, url=null, abort=null;
function status(s){$('status').textContent=s;}
function stop(){clearTimeout(timer);timer=null;const old=link;link=null;if(old)try{old.stop();}catch{} if(abort){abort.abort();abort=null;}}
function fail(s){phase='failed';stop();$('progressBox').classList.add('hidden');$('download').classList.add('hidden');$('retry').classList.remove('hidden');status(s);}
function ready(bytes){phase='ready';stop();if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.android.package-archive'}));const a=$('download');a.href=url;a.download=filename;a.classList.remove('hidden');$('progressBox').classList.add('hidden');$('retry').classList.add('hidden');status('');chunks=[];meta=null;}
function schedule(ms,id){clearTimeout(timer);timer=setTimeout(()=>{if(id===run&&phase==='p2p')void fallback(id);},ms);}
async function fallback(id){if(id!==run||phase!=='p2p')return;phase='https';stop();chunks=[];meta=null;status('מכין את האפליקציה להורדה...');$('progressBox').classList.add('hidden');
 try{abort=new AbortController();timer=setTimeout(()=>abort?.abort(),45000);
  const res=await fetch('./r56-'+filename,{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:abort.signal,redirect:'error'});
  if(!res.ok)throw Error('HTTPS download unavailable');const raw=new Uint8Array(await res.arrayBuffer());
  if(raw.length>40*1024*1024||await sha(raw)!==pins[role])throw Error('Base APK hash mismatch');
  const inviteHash=await hashText(token),proof=await hashText('mb-https-install-v1:'+token);
  const bytes=window.MBPersonalApkR56.personalize(raw,role,inviteHash,proof);
  if(id===run&&phase==='https')ready(bytes);
 }catch(e){if(id===run&&phase==='https')fail('לא ניתן להשלים את ההורדה. נסה שוב.');}
}
function send(m){return link?.isReady()&&link.send(m);}
async function onData(m,id){if(id!==run||phase!=='p2p'||!m||typeof m!=='object')return;
 if(m.kind==='apk_error'){fail('המשרד לא אישר את ההורדה. יש לפנות למשרד.');return;}
 if(m.kind==='apk_meta'){
  if(meta||m.role!==role||!Number.isInteger(m.size)||m.size<1024||m.size>40*1024*1024||!/^[a-f0-9]{64}$/.test(m.sha256||'')||m.chunks!==Math.ceil(m.size/24576)||!/^[A-Za-z0-9_-]{40,90}$/.test(m.handoff||'')){fail('פרטי ההתקנה אינם תקינים.');return;}
  meta=m;chunks=[];next=0;length=0;$('progressBox').classList.remove('hidden');$('progress').value=0;$('percent').textContent='0%';status('מכין את האפליקציה להורדה...');schedule(20000,id);if(!send({kind:'apk_ready'}))void fallback(id);return;
 }
 if(m.kind==='apk_chunk'&&meta){if(m.index<next){send({kind:'apk_ack',index:m.index});return;}
  if(m.index!==next||typeof m.data!=='string'||m.data.length>34000){fail('התקבלה העברה פגומה.');return;}
  const bytes=Uint8Array.from(atob(m.data),c=>c.charCodeAt(0));if(bytes.length!==Math.min(24576,meta.size-length)){fail('התקבלה העברה פגומה.');return;}
  chunks.push(bytes);length+=bytes.length;next++;$('progress').value=Math.round(100*length/meta.size);$('percent').textContent=$('progress').value+'%';send({kind:'apk_ack',index:m.index});schedule(20000,id);
  if(next===meta.chunks){const expected=meta.sha256, blob=new Blob(chunks),raw=new Uint8Array(await blob.arrayBuffer());if(id!==run||phase!=='p2p')return;if(await sha(raw)!==expected){if(id===run&&phase==='p2p')fail('קובץ ההתקנה לא עבר אימות.');return;}if(id===run&&phase==='p2p')ready(raw);}
 }
}
async function start(){const id=++run;phase='p2p';stop();meta=null;chunks=[];$('retry').classList.add('hidden');$('download').classList.add('hidden');$('openApp').classList.add('hidden');$('progressBox').classList.add('hidden');
 if(keys.length!==1||params.getAll(keys[0]).length!==1||params.has('t')||new URLSearchParams(location.search).has('t')||!/^[A-Za-z0-9_-]{43}$/.test(token)||location.origin!=='https://z1z1gmgmm-droid.github.io'||!location.pathname.startsWith('/michbasot-install/')){fail('קישור ההזמנה אינו תקין. יש לפנות למשרד.');return;}
 if(!window.isSecureContext||!window.crypto?.subtle||!window.MBPersonalApkR56){fail('לא ניתן להכין התקנה מאובטחת בדפדפן זה.');return;}
 status('מכין את האפליקציה להורדה...');schedule(8000,id);
 try{if(!window.MichbasotDeviceLink){void fallback(id);return;}const room=await hashText(token);if(id!==run||phase!=='p2p')return;
 let requested=false;link=window.MichbasotDeviceLink.createDeviceLink({role:'device',secretHex:room,onStatus:s=>{if(id!==run||phase!=='p2p')return;if(s==='online'&&!requested){requested=true;schedule(10000,id);if(!send({kind:'apk_download'}))void fallback(id);}else if(s==='ice-failed'||(s==='offline'&&requested))void fallback(id);},onData:m=>{void onData(m,id).catch(()=>{if(id===run&&phase==='p2p')fail('לא ניתן לאמת את ההתקנה.');});}});
 await link.start();
 }catch{if(id===run&&phase==='p2p')void fallback(id);}
}
$('retry').onclick=()=>void start();window.addEventListener('pagehide',()=>{++run;phase='closed';stop();if(url)URL.revokeObjectURL(url);});void start();
})();

/* R17: once the invited person downloads APK, an office-issued one-use
 * handoff is opened from the same SMS page into the installed Android app. */
(()=>{'use strict';
if(['d','m','c'].some(k=>new URLSearchParams(location.hash.replace(/^#/, '')).has(k)))return;
const $=id=>document.getElementById(id);
const tok=(new URLSearchParams(location.search).get('t')||new URLSearchParams(location.hash.replace(/^#/, '')).get('t')||'');
const names={driver:'Michbasot_Driver.apk',manager:'Michbasot_Manager.apk',client:'Michbasot_Client.apk'};
let link=null,meta=null,chunks=[],next=0,length=0,busy=false,timer=null;
function status(s){$('status').textContent=s;}
function hex(arr){return Array.from(arr,b=>b.toString(16).padStart(2,'0')).join('');}
function fail(s){busy=false;status(s);$('retry').classList.remove('hidden');clearTimeout(timer);}
function send(payload){return link?.isReady() && link.send(payload);}
async function onData(m){
 if(!m||typeof m!=='object')return;
 if(m.kind==='apk_error'){fail(typeof m.message==='string'?m.message:'המשרד לא אישר את ההורדה.');return;}
 if(m.kind==='apk_meta'){
  if(!/^[A-Za-z0-9_-]{40,90}$/.test(m.handoff||'')){fail('לא התקבל אישור כניסה חד-פעמי מהמשרד.');return;}
  if(!(m.role in names)||!Number.isInteger(m.size)||m.size<1024||m.size>40*1024*1024||
   !/^[a-f0-9]{64}$/.test(m.sha256||'')||m.chunks!==Math.ceil(m.size/24576)){
   fail('פרטי קובץ ההתקנה אינם תקינים.');return;
  }
  meta=m;chunks=[];next=0;length=0;$('progressBox').classList.remove('hidden');
  status('מוריד את האפליקציה מהמשרד...');if(!send({kind:'apk_ready'}))fail('החיבור למשרד נותק.');
  return;
 }
 if(m.kind==='apk_chunk'&&meta){
  if(m.index<next){send({kind:'apk_ack',index:m.index});return;}
  if(m.index!==next||typeof m.data!=='string'||m.data.length>34000){fail('התקבל מקטע התקנה שגוי.');return;}
  let raw;try{raw=atob(m.data);}catch{fail('התקבלה העברה פגומה.');return;}
  const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  if(bytes.length!==Math.min(24576,meta.size-length)){fail('התקבל מקטע באורך שגוי.');return;}
  chunks.push(bytes);length+=bytes.length;next++;
  $('progress').value=Math.round(100*length/meta.size);$('percent').textContent=$('progress').value+'%';
  send({kind:'apk_ack',index:m.index});
  if(next===meta.chunks){
   if(length!==meta.size){fail('הקובץ לא התקבל במלואו.');return;}
   status('בודק את קובץ ההתקנה...');
   const blob=new Blob(chunks,{type:'application/vnd.android.package-archive'});
   const sha=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())));
   if(sha!==meta.sha256){fail('הקובץ נפגם במהלך ההעברה.');return;}
   const a=$('download');a.href=URL.createObjectURL(blob);a.download=names[meta.role];
   a.classList.remove('hidden');$('progressBox').classList.add('hidden');$('retry').classList.add('hidden');
   const open=$('openApp');
   open.href='michbasot://'+meta.role+'?t='+encodeURIComponent(tok)+
     '&handoff='+encodeURIComponent(meta.handoff);
   open.classList.remove('hidden');
   status('ההורדה מוכנה. התקן את ה-APK, חזור לדף הזה ולחץ ״כניסה לאפליקציה״. ללא SMS אימות נוסף.');
   busy=false;meta=null;chunks=[];clearTimeout(timer);
  }
 }
}
async function connect(){
 $('retry').classList.add('hidden');$('download').classList.add('hidden');$('openApp').classList.add('hidden');
 $('progressBox').classList.add('hidden');meta=null;chunks=[];
 if(!/^[A-Za-z0-9_-]{32,200}$/.test(tok)){fail('קישור ההזמנה חסר או לא תקין.');return;}
 if(!window.isSecureContext||!crypto?.subtle||!window.MichbasotDeviceLink){
  fail('דפדפן זה אינו תומך בהורדת P2P מאובטחת.');return;
 }
 status('יוצר חיבור למחשב המכבסה...');busy=true;
 try{
  if(link)link.stop();const room=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(tok))));
  link=window.MichbasotDeviceLink.createDeviceLink({role:'device',secretHex:room,
   onStatus:s=>{if(s==='online'&&busy&&!meta){status('נוצר חיבור למשרד. מבקש קובץ התקנה...');send({kind:'apk_download'});}
      else if(s==='offline'&&busy)status('מחכה לחיבור מחודש למשרד...');},
   onData:m=>{void onData(m).catch(()=>fail('לא ניתן להשלים את קובץ ההתקנה.'));}});
  await link.start();
  timer=setTimeout(()=>{if(busy)fail('לא נוצר חיבור P2P למחשב המשרד. בדוק שהתוכנה במשרד פועלת ונסה שוב.');},120000);
 }catch(e){fail('לא ניתן ליצור חיבור למשרד: '+String(e.message||e));}
}
$('retry').onclick=()=>{void connect()};
window.addEventListener('pagehide',()=>{clearTimeout(timer);link?.stop();});
void connect();
})();
