/* MICHBASOT_PHONE_FIRST_APK_V1
 * The office receives an installation request only after the invited phone is entered.
 * The P2P data channel is used for the initial request because no publicly reachable
 * office HTTPS API exists in this configuration. APK bytes are gated on office SMS OTP.
 */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const tok=new URLSearchParams(location.search).get('t')||'';
const knownNames={driver:'Michbasot_Driver.apk',manager:'Michbasot_Manager.apk',client:'Michbasot_Client.apk'};
let link=null, phase='phone',phone='',meta=null,parts=[],next=0,total=0,grant=false;
let closed=false,webOtpAbort=null,receivedOtp='',downloadObjectUrl=null,requestPending=false,linkTimer=null;
const status=s=>{$('status').textContent=s};
const show=(id,yes)=>$(id).classList.toggle('hidden',!yes);
function hex(bytes){return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
function send(msg){try{return !!(link?.isReady()&&link.send(msg));}catch{return false;}}
function normalPhone(value){let s=value.replace(/[\s().-]/g,'');if(!/^\+?\d{7,15}$/.test(s))return '';
 let d=s.replace(/^\+/,'');if(d.startsWith('00972'))d='0'+d.slice(5);else if(d.startsWith('972'))d='0'+d.slice(3);return d;}
function fail(msg){clearTimeout(linkTimer);status(msg);show('progressBox',false);if(phase==='linking'){$('sendCode').disabled=false;show('phoneBox',true);phase='phone';requestPending=false;link?.stop();link=null;stopWebOtp();}}
function stopWebOtp(){webOtpAbort?.abort();webOtpAbort=null;}
function acceptOtp(code){if(!/^\d{6}$/.test(code||''))return;receivedOtp=code;$('code').value=code;
 if(phase==='otp')void verifyCode();}
function listenSms(){if(!('OTPCredential' in window)||!navigator.credentials?.get)return;
 try{webOtpAbort=new AbortController();void navigator.credentials.get({otp:{transport:['sms']},signal:webOtpAbort.signal})
 .then(v=>{if(!closed&&v?.code)acceptOtp(v.code);}).catch(()=>{});}catch{}
}
async function connectForVerification(){
 if(!/^[A-Za-z0-9_-]{32,200}$/.test(tok)){fail('קישור ההזמנה אינו תקין. פנה למשרד לקבלת הזמנה חדשה.');return;}
 if(!window.isSecureContext||!window.crypto?.subtle||!window.MichbasotDeviceLink){fail('לא ניתן לבצע אימות בדפדפן הזה. פתח את הקישור ב-Chrome דרך HTTPS.');return;}
 const hash=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(tok))));
 link=window.MichbasotDeviceLink.createDeviceLink({role:'device',secretHex:hash,
  onStatus:s=>{if(closed)return;
    if(s==='online'){
      if(phase==='linking'&&!requestPending){requestPending=true;status('מבקש מהמשרד לשלוח קוד SMS...');
        if(!send({kind:'apk_request',phone})){requestPending=false;status('החיבור נפתח אך בקשת הקוד לא נשלחה. מנסה שוב...');}}
      else if(phase==='otp')status('קוד נשלח. ממתינים לזיהוי SMS או להקלדת הקוד.');
    }else if(['offline','connecting','tracker-ready','offer-received','answer-received'].includes(s) && phase==='linking'){
      status('יוצר קשר עם המשרד כדי לשלוח קוד אימות...');
    }else if(s==='ice-failed'&&phase==='linking'){status('לא ניתן כרגע להגיע למשרד. בדוק שחיבור האינטרנט פעיל.');}
  },onData:m=>{void handle(m).catch(()=>fail('אירעה שגיאה בהעברה. נסה שוב.'));}});
 await link.start();
 if(phase==='linking'&&link?.isReady()&&!requestPending){requestPending=true;status('מבקש מהמשרד לשלוח קוד SMS...');if(!send({kind:'apk_request',phone})){requestPending=false;status('בקשת הקוד לא נשלחה.');}}
}
async function request(){
 if(phase!=='phone')return;
 phone=normalPhone($('phone').value.trim());if(!phone){status('יש להזין מספר טלפון תקין.');return;}
 if(!/^[A-Za-z0-9_-]{32,200}$/.test(tok)){status('קישור הזמנה שגוי. פנה למשרד.');return;}
 phase='linking';requestPending=false;$('sendCode').disabled=true;
 status('מתחבר למשרד באמצעות P2P כדי לבקש קוד אימות...');listenSms();
 clearTimeout(linkTimer);linkTimer=setTimeout(()=>{if(phase==='linking')fail('לא התקבל אישור מהמשרד על שליחת SMS. בדוק שתוכנת המשרד מחוברת ונסה שוב.');},45000);
 try{await connectForVerification();}catch{stopWebOtp();fail('לא ניתן להגיע למשרד כרגע. נסה שוב.');}
}
async function verifyCode(){
 if(phase!=='otp')return;
 const code=$('code').value.trim();if(!/^\d{6}$/.test(code)){status('הקלד קוד בן שש ספרות.');return;}
 if(!link?.isReady()){status('אין כרגע חיבור למשרד. נסה לאחר שהחיבור יתחדש.');return;}
 phase='verifying';$('verify').disabled=true;status('מאמת את קוד ה-SMS...');
 if(!send({kind:'apk_verify',phone,code})){phase='otp';$('verify').disabled=false;status('לא ניתן לשלוח את הקוד. נסה שוב.');}
}
function resetOtp(){phase='otp';$('verify').disabled=false;show('otpBox',true);}
async function handle(m){
 if(!m||typeof m!=='object'||closed)return;
 if(m.kind==='apk_otp_sent'){
  if(phase==='linking'||phase==='otp'){clearTimeout(linkTimer);phase='otp';show('phoneBox',false);show('otpBox',true);
    status('קוד אימות נשלח ב-SMS. אם אינו מזוהה אוטומטית, אפשר להקליד אותו.');
    if(receivedOtp)acceptOtp(receivedOtp);
  }
 }else if(m.kind==='apk_error'){
  if(phase==='verifying'){resetOtp();status('הקוד שגוי, פג תוקף או לא ניתן לאמתו. בדוק ונסה שוב.');}
  else if(phase==='linking'){stopWebOtp();fail('לא ניתן לשלוח קוד כעת. בדוק את מספר הטלפון או בקש הזמנה חדשה.');}
  else status('לא ניתן להשלים את ההעברה. פנה למשרד.');
 }else if(m.kind==='apk_meta'){
  if(phase!=='verifying' && phase!=='receiving')return;
  if(!Object.prototype.hasOwnProperty.call(knownNames,m.role)||!Number.isInteger(m.size)||m.size<100||m.size>40*1024*1024||
   !/^[a-f0-9]{64}$/.test(m.sha256||'')||m.chunks!==Math.ceil(m.size/24576)){
    fail('קובץ ההתקנה שקיבלנו אינו תקין.');return;}
  phase='receiving';stopWebOtp();meta=m;parts=[];next=0;total=0;grant=true;
  show('otpBox',false);show('progressBox',true);status('האימות הצליח. מוריד את האפליקציה מהמשרד...');
  send({kind:'apk_ready'});
 }else if(m.kind==='apk_chunk' && phase==='receiving'&&grant&&meta){
  if(m.index<next){send({kind:'apk_ack',index:m.index});return;}
  if(m.index!==next||typeof m.data!=='string'||m.data.length>34000){grant=false;fail('התקבלה שגיאה בסדר ההעברה.');return;}
  let raw;try{raw=atob(m.data);}catch{grant=false;fail('שגיאה בקבלת הקובץ.');return;}
  const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  if(bytes.length!==Math.min(24576,meta.size-total)){grant=false;fail('קובץ ההעברה אינו תקין.');return;}
  parts.push(bytes);total+=bytes.length;next++;
  $('progress').value=Math.round(total/meta.size*100);$('percent').textContent=$('progress').value+'%';
  send({kind:'apk_ack',index:m.index});
  if(next===meta.chunks){
   grant=false;if(total!==meta.size){fail('קובץ ההתקנה אינו שלם.');return;}
   status('בודק את שלמות הקובץ...');
   const blob=new Blob(parts,{type:'application/vnd.android.package-archive'});
   const actual=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())));
   if(actual!==meta.sha256){fail('שלמות קובץ ההתקנה לא אומתה. אין להתקין.');return;}
   parts=[];phase='done';downloadObjectUrl=URL.createObjectURL(blob);
   const a=$('download');a.href=downloadObjectUrl;a.download=knownNames[meta.role];show('download',true);
   const open=$('openApp');open.href='michbasot://'+meta.role+'?t='+encodeURIComponent(tok);show('openApp',true);
   status('האפליקציה התקבלה. לחץ ״הורד והתקן״, ואשר התקנה ב-Android.');
  }
 }
}
$('sendCode').addEventListener('click',()=>{void request();});
$('phone').addEventListener('keydown',e=>{if(e.key==='Enter'){$('sendCode').click();}});
$('verify').addEventListener('click',()=>{void verifyCode();});
$('code').addEventListener('input',()=>{if(phase==='otp'&&/^\d{6}$/.test($('code').value.trim()))void verifyCode();});
window.addEventListener('pagehide',()=>{closed=true;clearTimeout(linkTimer);stopWebOtp();link?.stop();if(downloadObjectUrl)URL.revokeObjectURL(downloadObjectUrl);});
if(!/^[A-Za-z0-9_-]{32,200}$/.test(tok)){status('קישור הזמנה חסר. יש לפתוח את הקישור שהגיע ב-SMS ולא את כתובת האתר הראשית.');$('sendCode').disabled=true;}
})();
