// MB_PUBLIC_P2P_BOOTSTRAP_V1
(()=>{'use strict';
const $=id=>document.getElementById(id), status=s=>{$('status').textContent=s};
const tok=new URLSearchParams(location.hash.replace(/^#/, '')).get('t')||new URLSearchParams(location.search).get('t')||'';
let link=null,meta=null,parts=[],next=0,total=0,grant=false,closed=false;
function hex(bytes){return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')}
function send(x){return link&&link.isReady()&&link.send(x)}
function error(msg){status(msg);$('progressBox').classList.add('hidden');}
async function start(){
 if(!/^[A-Za-z0-9_-]{32,200}$/.test(tok)){error('קישור ההזמנה חסר או אינו תקין.');return}
 if(!window.isSecureContext || !window.crypto?.subtle || !window.MichbasotDeviceLink){
   error('יש לפתוח את הדף בדפדפן מאובטח (HTTPS).');return
 }
 const hash=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(tok))));
 try{
  link=window.MichbasotDeviceLink.createDeviceLink({role:'device',secretHex:hash,
   onStatus:s=>{if(s==='online'){status('מחובר למשרד. מבקש אימות SMS...');send({kind:'apk_request'})}
       else if(s==='connecting')status('מתחבר למשרד דרך P2P...');
       else if(!closed)status('ממתין לחיבור P2P למחשב המשרד...')},
   onData:m=>handle(m).catch(()=>error('שגיאה בעת קבלת הקובץ. נסה שוב.'))});
  await link.start();status('ממתין לחיבור P2P למחשב המשרד...');
 }catch{error('לא ניתן להפעיל חיבור P2P בדפדפן זה.')}
}
async function handle(m){
 if(!m || typeof m!=='object')return;
 if(m.kind==='apk_otp_sent'){
  status('נשלח קוד אימות לטלפון המוזמן.');$('otpBox').classList.remove('hidden');
 } else if(m.kind==='apk_error'){
  error(String(m.message||'האימות או ההורדה נכשלו.').slice(0,140));$('verify').disabled=false;
 } else if(m.kind==='apk_meta'){
  const names={driver:'Michbasot_Driver.apk',manager:'Michbasot_Manager.apk',client:'Michbasot_Client.apk'};
  if(!Object.hasOwn(names,m.role)||!Number.isInteger(m.size)||m.size<100||m.size>40*1024*1024||
      !/^[a-f0-9]{64}$/.test(m.sha256||'')||m.chunks!==Math.ceil(m.size/24576)){error('נתוני קובץ ההתקנה אינם תקינים.');return}
  meta=m;parts=[];next=0;total=0;grant=true;
  $('otpBox').classList.add('hidden');$('progressBox').classList.remove('hidden');
  status('מאומת! מקבל את האפליקציה מהמשרד...');send({kind:'apk_ready'});
 } else if(m.kind==='apk_chunk' && grant && meta){
  if(m.index<next){send({kind:'apk_ack',index:m.index});return}
  if(m.index!==next || typeof m.data!=='string'||m.data.length>34000){error('סדר ההעברה אינו תקין.');grant=false;return}
  let raw;try{raw=atob(m.data)}catch{error('קובץ פגום בהעברה.');grant=false;return}
  const arr=Uint8Array.from(raw,c=>c.charCodeAt(0));
  if(arr.length!==Math.min(24576,meta.size-total)){error('מקטע שגוי בהעברה.');grant=false;return}
  parts.push(arr);total+=arr.length;next++;
  $('progress').value=Math.round(total/meta.size*100);$('percent').textContent=$('progress').value+'%';
  send({kind:'apk_ack',index:m.index});
  if(next===meta.chunks){
   grant=false;
   if(total!==meta.size){error('גודל הקובץ אינו תקין.');return}
   status('מאמת את שלמות קובץ ההתקנה...');
   const blob=new Blob(parts,{type:'application/vnd.android.package-archive'});
   const actual=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())));
   if(actual!==meta.sha256){error('בדיקת תקינות הקובץ נכשלה. אין להתקין.');return}
   parts=[];
   const url=URL.createObjectURL(blob),a=$('download');a.href=url;a.download=({driver:'Michbasot_Driver.apk',manager:'Michbasot_Manager.apk',client:'Michbasot_Client.apk'})[meta.role];
   a.classList.remove('hidden');status('הקובץ התקבל ונבדק. לחץ להורדה.');
   const open=$('openApp');open.href='michbasot://'+meta.role+'?t='+encodeURIComponent(tok);open.classList.remove('hidden');
  }
 }
}
$('verify').addEventListener('click',()=>{
 const code=$('code').value.trim();if(!/^\d{6}$/.test(code)){error('הקלד קוד בן 6 ספרות.');return}
 if(!link?.isReady()){error('אין חיבור למשרד כרגע.');return}
 $('verify').disabled=true;status('מאמת את קוד ה-SMS במשרד...');send({kind:'apk_verify',code});
});
window.addEventListener('pagehide',()=>{closed=true;link?.stop()});
start().catch(()=>error('לא ניתן להתחיל את ההתקנה.'));
})();
