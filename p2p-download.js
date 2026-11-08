(()=>{'use strict';
const $=id=>document.getElementById(id), tok=new URLSearchParams(location.search).get('t')||'';
const names={driver:'Michbasot_Driver.apk',manager:'Michbasot_Manager.apk',client:'Michbasot_Client.apk'};
let link=null,phone='',requested=false,otp=false,verified=false,closed=false,meta=null,parts=[],next=0,total=0,expiryTimer=null,otpReaderAbort=null,pendingAutoCode=null,requestSent=false;
function show(id){for(const section of ['phoneBox','otpBox','progressBox'])$(section).classList.toggle('hidden',section!==id)}
function status(message){$('status').textContent=message}
function hex(bytes){return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')}
function send(data){return link?.isReady()&&link.send(data)}
function normalize(value){let n=value.replace(/[\s()-]/g,'').trim();if(n.startsWith('00972'))n='0'+n.slice(5);else if(n.startsWith('+972'))n='0'+n.slice(4);else if(n.startsWith('972'))n='0'+n.slice(3);return n}
function error(message){status(message);$('verify').disabled=false;$('request').disabled=false}
// On supported Android Chrome browsers, WebOTP may offer to capture the SMS.
// A browser consent prompt may appear. Manual code entry always remains available.
function beginSmsCapture(){
 if(!('OTPCredential' in window)||!navigator.credentials?.get)return;
 try{
  otpReaderAbort?.abort();otpReaderAbort=new AbortController();
  navigator.credentials.get({otp:{transport:['sms']},signal:otpReaderAbort.signal})
   .then(c=>{const code=String(c?.code||'').trim();if(!/^\d{6}$/.test(code)||closed)return;
      $('code').value=code;
      if(otp)submitCode(code);else pendingAutoCode=code;
   }).catch(()=>{});
 }catch{};
}
function submitCode(code){
 if(!/^\d{6}$/.test(code)){error('יש להקליד קוד בן 6 ספרות.');return}
 if(!otp||!link?.isReady()){pendingAutoCode=code;return}
 $('verify').disabled=true;status('מאמתים את הקוד...');
 // The office checks BOTH the code and the invited phone number.
 if(!send({kind:'apk_verify',phone,code}))error('התקשורת עם המשרד התנתקה. נסה שוב.');
}

function ready(){if(requested&&!otp&&!requestSent&&link?.isReady()){requestSent=true;if(!send({kind:'apk_request',phone})){requestSent=false;return;}status('שולחים קוד אימות לטלפון...')}}
async function connect(){
 if(!/^[A-Za-z0-9_-]{32,200}$/.test(tok)){error('קישור ההזמנה אינו תקין.');return}
 if(!window.isSecureContext||!crypto?.subtle||!window.MichbasotDeviceLink){error('לא ניתן לפתוח את ההזמנה בדפדפן זה.');return}
 const key=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(tok))));
 link=window.MichbasotDeviceLink.createDeviceLink({role:'device',secretHex:key,
  onStatus:s=>{if(s==='online')ready()},onData:m=>{handle(m).catch(()=>error('ההורדה נכשלה. נסה שוב.'))}});
 await link.start();ready();
}
async function handle(m){
 if(!m||typeof m!=='object')return;
 if(m.kind==='apk_otp_sent'){
  otp=true;clearTimeout(expiryTimer);show('otpBox');status('');$('code').focus();
  if(pendingAutoCode){const code=pendingAutoCode;pendingAutoCode=null;submitCode(code);}
 }else if(m.kind==='apk_error'){
  error(otp?'הקוד שגוי או פג תוקף. בדוק ונסה שוב.':'לא ניתן לשלוח קוד. בדוק שהמספר תואם להזמנה ונסה שוב.');
  if(!otp){requested=false;clearTimeout(expiryTimer);show('phoneBox')}
 }else if(m.kind==='apk_meta'){
  if(!Object.prototype.hasOwnProperty.call(names,m.role)||!Number.isInteger(m.size)||m.size<100||m.size>40*1024*1024||
    !/^[a-f0-9]{64}$/.test(m.sha256||'')||m.chunks!==Math.ceil(m.size/24576)){error('קובץ ההתקנה אינו תקין.');return}
  verified=true;meta=m;parts=[];next=0;total=0;show('progressBox');status('');send({kind:'apk_ready'});
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
 phone=p;requested=true;requestSent=false;$('request').disabled=true;status('יוצרים קשר עם המשרד...');beginSmsCapture();
 try{if(!link)await connect();else ready();}catch{requested=false;link?.stop();link=null;error('לא הצלחנו לשלוח קוד. נסה שוב.');return}
 expiryTimer=setTimeout(()=>{if(!otp&&!closed){requested=false;link?.stop();link=null;otpReaderAbort?.abort();error('המשרד לא השיב לבקשת האימות. בדקו שחיבור הזמנות P2P במשרד פעיל.')}},75000);
});
$('verify').addEventListener('click',()=>submitCode($('code').value.trim()));
window.addEventListener('pagehide',()=>{closed=true;clearTimeout(expiryTimer);otpReaderAbort?.abort();link?.stop()});
if(!/^[A-Za-z0-9_-]{32,200}$/.test(tok)){$('request').disabled=true;error('קישור ההזמנה אינו תקין.');}
})();