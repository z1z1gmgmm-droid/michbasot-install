(()=>{'use strict';
const $=id=>document.getElementById(id), tok=new URLSearchParams(location.search).get('t')||'';
const names={driver:'Michbasot_Driver.apk',manager:'Michbasot_Manager.apk',client:'Michbasot_Client.apk'};
let link=null,phone='',requested=false,otp=false,verified=false,closed=false,meta=null,parts=[],next=0,total=0,expiryTimer=null;
function show(id){for(const section of ['phoneBox','otpBox','progressBox'])$(section).classList.toggle('hidden',section!==id)}
function status(message){$('status').textContent=message}
function hex(bytes){return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')}
function send(data){return link?.isReady()&&link.send(data)}
function normalize(value){let n=value.replace(/[\s()-]/g,'').trim();if(n.startsWith('00972'))n='0'+n.slice(5);else if(n.startsWith('+972'))n='0'+n.slice(4);else if(n.startsWith('972'))n='0'+n.slice(3);return n}
function error(message){status(message);$('verify').disabled=false;$('request').disabled=false}
function ready(){if(requested&&!otp&&link?.isReady()){send({kind:'apk_request',phone});status('שולחים קוד אימות לטלפון...')}}
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
 phone=p;requested=true;$('request').disabled=true;status('שולחים קוד אימות לטלפון...');
 try{if(!link)await connect();else ready();}catch{requested=false;link?.stop();link=null;error('לא הצלחנו לשלוח קוד. נסה שוב.');return}
 expiryTimer=setTimeout(()=>{if(!otp&&!closed){requested=false;link?.stop();link=null;error('לא הצלחנו לשלוח קוד. אפשר לנסות שוב.')}},75000);
});
$('verify').addEventListener('click',()=>{
 const code=$('code').value.trim();if(!/^\d{6}$/.test(code)){error('יש להקליד קוד בן 6 ספרות.');return}
 if(!link?.isReady()){error('התקשורת עם המשרד התנתקה. נסה שוב.');return}
 $('verify').disabled=true;status('מאמתים את הקוד...');send({kind:'apk_verify',code});
});
window.addEventListener('pagehide',()=>{closed=true;clearTimeout(expiryTimer);link?.stop()});
if(!/^[A-Za-z0-9_-]{32,200}$/.test(tok)){$('request').disabled=true;error('קישור ההזמנה אינו תקין.');}
})();