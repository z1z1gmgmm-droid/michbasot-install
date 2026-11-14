/* R17: once the invited person downloads APK, an office-issued one-use
 * handoff is opened from the same SMS page into the installed Android app. */
(()=>{'use strict';
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
