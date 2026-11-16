/* iOS R01: durable same-origin device registration. Non-extractable AES-GCM key
   and ciphertext are both kept in IndexedDB; no keys are sent to static hosting.
   Data remains accessible to JavaScript running in this origin, unlike iOS Keychain. */
(()=>{'use strict';
 const DB='michbasot-ios-r01',KEY='device-aes',REC='device-registration';
 const open=()=>new Promise((resolve,reject)=>{
   const r=indexedDB.open(DB,1);
   r.onupgradeneeded=()=>{r.result.createObjectStore('records');};
   r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error||Error('Storage unavailable'));
 });
 const op=async(mode,act)=>{const db=await open();try{return await new Promise((resolve,reject)=>{
   const tx=db.transaction('records',mode),s=tx.objectStore('records');let q,result;
   try{q=act(s)}catch(e){reject(e);return;}
   q.onsuccess=()=>{result=q.result;};q.onerror=()=>reject(q.error||Error('Storage error'));
   tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error||Error('Storage failed'));
   tx.onabort=()=>reject(tx.error||Error('Storage aborted'));
 });}finally{db.close();}};
 const get=k=>op('readonly',s=>s.get(k));
 const put=(k,v)=>op('readwrite',s=>s.put(v,k));
 async function key(create){let k=await get(KEY);if(!k&&create){
   k=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
   await put(KEY,k);
 }return k;}
 const str=x=>typeof x==='string'?x:'';
 function valid(d){return d&&/^[a-f0-9]{64}$/.test(str(d.secret_hex)) &&
   /^[A-Za-z0-9_-]{50,120}$/.test(str(d.device_grant)) &&
   ['driver','manager','client'].includes(d.role);}
 async function save(d){if(!valid(d))throw Error('Invalid office enrollment');
   const k=await key(true),iv=crypto.getRandomValues(new Uint8Array(12));
   const data=new TextEncoder().encode(JSON.stringify({secret_hex:d.secret_hex,device_grant:d.device_grant,role:d.role}));
   const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},k,data);
   await put(REC,{v:1,iv,bytes:new Uint8Array(ciphertext)});
   const verify=await read();if(!verify||verify.secret_hex!==d.secret_hex||verify.role!==d.role)
     throw Error('Device save verification failed');
 }
 async function read(){const k=await key(false),r=await get(REC);if(!k||!r||r.v!==1)return null;
   try{const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:r.iv},k,r.bytes);
     const d=JSON.parse(new TextDecoder().decode(bytes));return valid(d)?d:null;
   }catch{return null;}}
 Object.defineProperty(window,'MichbasotIOSStore',{value:Object.freeze({read,save}),configurable:false,writable:false});
})();
