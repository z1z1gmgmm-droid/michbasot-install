// MICHBASOT R10 - honest P2P status while tracker ACKs recur; retains R9 OTP logic
(()=>{'use strict';
const $=id=>document.getElementById(id), tok=new URLSearchParams(location.search).get('t')||'';
const names={driver:'Michbasot_Driver.apk',manager:'Michbasot_Manager.apk',client:'Michbasot_Client.apk'};
let link=null,phone='',requested=false,otp=false,verified=false,closed=false,meta=null,parts=[],next=0,total=0,expiryTimer=null,otpReaderAbort=null,pendingAutoCode=null,requestSent=false,phase='initial',verifying=false;
function show(id){for(const section of ['phoneBox','otpBox','progressBox'])$(section).classList.toggle('hidden',section!==id)}
function status(message){$('status').textContent=message}
function hex(bytes){return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')}
function send(data){return link?.isReady()&&link.send(data)}
function normalize(value){let n=value.replace(/[\s()-]/g,'').trim();if(n.startsWith('00972'))n='0'+n.slice(5);else if(n.startsWith('+972'))n='0'+n.slice(4);else if(n.startsWith('972'))n='0'+n.slice(3);return n}
function error(message){clearTimeout(expiryTimer);requested=false;requestSent=false;verifying=false;phase='error';status(message);$('verify').disabled=false;$('request').disabled=false}
function canVerify(){return !!(requestSent&&link?.isReady())}
function flushCode(){if(pendingAutoCode&&canVerify()&&!verifying){const c=pendingAutoCode;pendingAutoCode=null;submitCode(c)}}
// On supported Android Chrome browsers, WebOTP may offer to capture the SMS.
// A browser consent prompt may appear. Manual code entry always remains available.
function beginSmsCapture(){
 if(!('OTPCredential' in window)||!navigator.credentials?.get)return;
 try{
  otpReaderAbort?.abort();otpReaderAbort=new AbortController();
  navigator.credentials.get({otp:{transport:['sms']},signal:otpReaderAbort.signal})
   .then(c=>{const code=String(c?.code||'').trim();if(!/^\d{6}$/.test(code)||closed)return;
      $('code').value=code;
      if(canVerify())submitCode(code);else pendingAutoCode=code;
   }).catch(()=>{});
 }catch{};
}
function submitCode(code){
 code=String(code||'').trim();
 if(!/^\d{6}$/.test(code)){status('יש להקליד קוד בן 6 ספרות.');$('verify').disabled=false;return}
 // The backend, not the browser or an SMS gateway ACK, is the authority for OTP.
 // Code may be received before apk_otp_sent due to a delayed/lost P2P ACK.
 if(!canVerify()){pendingAutoCode=code;status('הקוד נקלט. ממתינים לחידוש הקשר עם המשרד לצורך אימות...');return}
 if(verifying)return;
 verifying=true;$('verify').disabled=true;status('מאמתים את הקוד מול המשרד...');
 if(!send({kind:'apk_verify',phone,code})){
  verifying=false;pendingAutoCode=code;$('verify').disabled=false;
  status('הקוד נקלט. ממתינים לחיבור למשרד כדי לאמת אותו.');
 }
}
function ready(){
 if(!requested||!link?.isReady())return;
 if(!requestSent){
  if(!send({kind:'apk_request',phone})){phase='p2p-online';return}
  requestSent=true;phase='request-sent';clearTimeout(expiryTimer);
  show('otpBox');$('verify').disabled=false;
  status('ממתינים לקוד SMS. אם הקוד כבר הגיע, אפשר להקליד אותו כאן.');
 }
 flushCode();
}
async function connect(){
 if(!/^[A-Za-z0-9_-]{32,200}$/.test(tok)){error('קישור ההזמנה אינו תקין.');return}
 if(!window.isSecureContext||!crypto?.subtle||!window.MichbasotDeviceLink){error('לא ניתן לפתוח את ההזמנה בדפדפן זה.');return}
 const key=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(tok))));
 link=window.MichbasotDeviceLink.createDeviceLink({role:'device',secretHex:key,
  onStatus:s=>{
    if(s==='online'){phase='p2p-online';status('נוצר חיבור ישיר למשרד. מאמתים את המספר...');ready();}
    else if(requested&&!otp&&!requestSent&&!link?.isReady()&&s==='tracker-open'&&!['offer-preparing','offer-sent','answer-received'].includes(phase)){phase='tracker-open';status('נוצר קשר עם שירות התיווך. ממתינים למשרד...');}
    else if(requested&&!otp&&!requestSent&&!link?.isReady()&&s==='tracker-ready'&&!['offer-preparing','offer-sent','answer-received'].includes(phase)){phase='tracker-ready';status('שירות התיווך זמין, אך המשרד טרם השיב.');}
    else if(requested&&!requestSent&&s==='offer-preparing'){phase='offer-preparing';status('מכינים הצעת חיבור ישיר למשרד...');}
    else if(requested&&!requestSent&&s==='offer-timeout'){phase='offer-timeout';status('לא התקבלה תשובת חיבור מהמשרד. מנסים ליצור הצעת חיבור חדשה...');}
    else if(requested&&!otp&&!requestSent&&s==='offer-sent'){phase='offer-sent';status('נשלחה הצעת חיבור P2P למשרד. ממתינים לתשובה...');}
    else if(requested&&!otp&&s==='offer-failed'){phase='offer-failed';status('הצעת החיבור נכשלה. מבצעים ניסיון חוזר...');}
    else if(requested&&!otp&&s==='answer-failed'){phase='answer-failed';status('תשובת החיבור אינה תקינה. מבצעים ניסיון חוזר...');}
    else if(requested&&!otp&&!requestSent&&s==='answer-received'){phase='answer-received';status('המשרד השיב. משלימים חיבור P2P...');}
    else if(requested&&!otp&&s==='tracker-error'){phase='tracker-error';status('שרת התיווך לא זמין. מנסים שוב להתחבר...');}
    else if(requested&&!otp&&s==='ice-failed'){phase='ice-failed';status('חיבור האינטרנט הישיר נכשל. מנסים מחדש...');}
    else if(requested&&!otp&&!requestSent&&!link?.isReady()&&s==='offline'){phase='offline';status('ממתינים לחיבור עם המשרד. טרם נשלח SMS...');}
  },onData:m=>{handle(m).catch(()=>error('ההורדה נכשלה. נסה שוב.'))}});
 await link.start();ready();
}
async function handle(m){
 if(!m||typeof m!=='object')return;
 if(m.kind==='apk_otp_sent'){
  otp=true;phase='otp-accepted';clearTimeout(expiryTimer);show('otpBox');
  if(!verifying)status('בקשת ה-SMS אושרה במשרד. ניתן להזין את קוד האימות.');
  flushCode();
 }else if(m.kind==='apk_error'){
  // Never discard an already received SMS just because its separate ACK failed.
  // Verification still goes through the office and its authoritative OTP endpoint.
  verifying=false;$('verify').disabled=false;
  if(requestSent){show('otpBox');status('המשרד דיווח על תקלה בבקשה או באימות. אם הגיע קוד SMS, ניתן להזין אותו כאן ולנסות לאמת.');}
  else {error('לא ניתן להשלים את הבקשה. בדוק את המספר ונסה שוב.');show('phoneBox')}
 }else if(m.kind==='apk_meta'){
  if(!Object.prototype.hasOwnProperty.call(names,m.role)||!Number.isInteger(m.size)||m.size<100||m.size>40*1024*1024||
    !/^[a-f0-9]{64}$/.test(m.sha256||'')||m.chunks!==Math.ceil(m.size/24576)){error('קובץ ההתקנה אינו תקין.');return}
  verified=true;verifying=false;pendingAutoCode=null;otpReaderAbort?.abort();meta=m;parts=[];next=0;total=0;show('progressBox');status('');send({kind:'apk_ready'});
 }else if(m.kind==='apk_chunk'&&verified&&meta){
  if(m.index<next){send({kind:'apk_ack',index:m.index});return}
  if(m.index!==next||typeof m.data!=='string'||m.data.length>34000){error('ההורדה נקטעה.');verified=false;return}
  let raw;try{raw=atob(m.data)}catch{error('קובץ ההתקנה נפגם.');verified=false;return}
  const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  if(bytes.length!==Math.min(24576,meta.size-total)){error('קובץ ההתקנה נפגם.');verified=false;return}
  parts.push(bytes);total+=bytes.length;next++;
  $('progress').value=Math.round(100*total/meta.size);$('percent').textContent=$('progress').value+'%';
  send({kind:'apk_ack',index:m.index});
  if(next===meta.chunks){
   verified=false;
   if(total!==meta.size){error('ההורדה לא הושלמה.');return}
   status('בודקים את קובץ ההתקנה...');
   const blob=new Blob(parts,{type:'application/vnd.android.package-archive'});
   const sha=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())));
   if(sha!==meta.sha256){error('הקובץ שהתקבל אינו תקין.');return}
   parts=[];const a=$('download');a.href=URL.createObjectURL(blob);a.download=names[meta.role];a.classList.remove('hidden');
   show('none');status('ההורדה מוכנה. לחץ על הכפתור כדי להתקין את האפליקציה.');
  }
 }
}
$('request').addEventListener('click',async()=>{
 if(requested)return;
 const p=normalize($('phone').value);if(!/^\+?[0-9]{7,15}$/.test(p)){error('יש להקליד מספר טלפון תקין.');return}
 phone=p;requested=true;requestSent=false;verifying=false;pendingAutoCode=null;otp=false;phase='connecting';$('request').disabled=true;status('יוצרים קשר עם המשרד. טרם נשלח SMS...');beginSmsCapture();
 try{if(!link)await connect();else ready();}catch{requested=false;link?.stop();link=null;error('לא הצלחנו לשלוח קוד. נסה שוב.');return}
 expiryTimer=setTimeout(()=>{if(!requestSent&&!otp&&!closed){link?.stop();link=null;otpReaderAbort?.abort();error('לא התקבל אישור מהמשרד ('+phase+'). אפשר ללחוץ שוב כדי לנסות להתחבר.')}},150000);
});
$('verify').addEventListener('click',()=>submitCode($('code').value.trim()));
$('code').addEventListener('input',()=>{if(!verifying)$('verify').disabled=false});
window.addEventListener('pagehide',()=>{closed=true;clearTimeout(expiryTimer);otpReaderAbort?.abort();link?.stop()});
if(!/^[A-Za-z0-9_-]{32,200}$/.test(tok)){$('request').disabled=true;error('קישור ההזמנה אינו תקין.');}
})();