/* 0.9.23 mobile integration hook.
 * No secret is built in. Call MichbasotMobileP2P.connect() only after
 * the office issues a UNIQUE device key to the authenticated application.
 * This hook never displays networking UI to drivers/managers/hotels.
 * Office must separately install a compatible always-on WebRTC peer.
 * NOT a replacement for existing authorized business API calls.
 */
(function (scope) {
  'use strict';
  const p2p = scope.MichbasotDeviceLink;
  if (!p2p || scope.MichbasotMobileP2P) return;
  let current = null;
  let lastState = 'offline';
  let inviteMode = false;
  const pending=new Map();
  let sequence=0;
  let fetchInstalled=false;
  // Only these explicitly authorized JSON routes have a P2P backend implementation.
  function allowed(path,method){
    if(method==='GET' && (path==='/api/me'||path==='/api/customers'||path==='/api/push/vapid-public-key'||/^\/api\/p2p\/message-feed\?after=(?:-1|[0-9]{1,16})$/.test(path)))return true;
    if(method==='GET' && /^\/api\/messages\/[A-Za-z0-9_-]{1,80}\?translate=[A-Za-z0-9_-]{1,80}&lang=(?:he|en|ru|ar|es|hi|si|ta)$/.test(path))return true;
    if(method==='GET' && /^\/api\/p2p\/media\/[a-fA-F0-9]{32}\?offset=\d{1,10}$/.test(path))return true;
    if(method==='GET' && /^\/api\/(?:messages|gallery)\/[A-Za-z0-9_-]{1,80}(?:\?page=\d{1,5})?$/.test(path))return true;
    return method==='POST' && (path==='/api/messages'||path==='/api/p2p/media'||path==='/api/push/subscribe'||path==='/api/push/unsubscribe');
  }
  function failPending(){
    for(const [id,entry] of pending){clearTimeout(entry.timer);
      entry.reject(new Error('P2P disconnected: request not confirmed'));
      pending.delete(id);
    }
  }
  function receive(message){
    if(!message || message.kind!=='rpc_part' || !/^[A-Za-z0-9_-]{8,80}$/.test(message.request_id||''))return;
    const p=pending.get(message.request_id);
    if(!p || !Number.isInteger(message.total) || message.total<1 || message.total>60 ||
       !Number.isInteger(message.index) || message.index<0 || message.index>=message.total ||
       typeof message.fragment!=='string'||message.fragment.length>15000)return;
    if(p.total!==null && p.total!==message.total){pending.delete(message.request_id);
      clearTimeout(p.timer);p.reject(new Error('Invalid P2P response'));return;}
    p.total=message.total;p.parts[message.index]=message.fragment;
    if(p.parts.filter(x=>typeof x==='string').length===p.total){
      clearTimeout(p.timer);pending.delete(message.request_id);
      try{const result=JSON.parse(p.parts.join(''));
        if(!Number.isInteger(result.status)||result.status<200||result.status>599)throw Error('Invalid status');
        p.resolve(result);
      }catch(e){p.reject(e);}
    }
  }
  function rpc(method,path,body){
    if(!current?.isReady())return Promise.reject(new Error('P2P offline'));
    const id='m'+Date.now().toString(36)+'_'+(++sequence).toString(36);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(new Error('P2P response timeout'))},20000);
      pending.set(id,{resolve,reject,timer,parts:[],total:null});
      const packet=inviteMode ? {kind:'invite_request',request_id:id,action:method,code:body?.code||null,handoff:body?.handoff||null,phone:body?.phone||null} :
        {kind:'rpc_request',request_id:id,method,path,body};
      try{if(!current.send(packet)){
        clearTimeout(timer);pending.delete(id);reject(new Error('P2P offline'));
      }}catch(e){clearTimeout(timer);pending.delete(id);reject(e);}
    });
  }
  const mediaChunkSize=24576;
  function b64(bytes){
    let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return btoa(s);
  }
  function unb64(str){
    const s=atob(str),arr=new Uint8Array(s.length);
    for(let i=0;i<s.length;i++)arr[i]=s.charCodeAt(i);
    return arr;
  }
  async function uploadP2PMedia(file,customerId,label){
    if(!(file instanceof Blob) || !current?.isReady())throw Error('P2P not connected');
    if(!/^[A-Za-z0-9_-]{1,80}$/.test(customerId))throw Error('Invalid hotel');
    if(!['clean','dirty','other'].includes(label))throw Error('Invalid media label');
    if(file.size===0 || file.size>12*1024*1024)throw Error('Media size rejected');
    const uploadId=Array.from(crypto.getRandomValues(new Uint8Array(16)),
      x=>x.toString(16).padStart(2,'0')).join('');
    const hex=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),
      x=>x.toString(16).padStart(2,'0')).join('');
    const begin=await rpc('POST','/api/p2p/media',{
      action:'begin',upload_id:uploadId,customer_id:customerId,
      label,mime:file.type,size:file.size,sha256:hex});
    if(begin.status!==200)throw Error(begin.body?.detail||'Upload refused');
    let offset=begin.body.offset||0;
    while(offset<file.size){
      const bytes=new Uint8Array(await file.slice(offset,offset+mediaChunkSize).arrayBuffer());
      const result=await rpc('POST','/api/p2p/media',{
        action:'chunk',upload_id:uploadId,offset,data:b64(bytes)});
      if(result.status!==200)throw Error(result.body?.detail||'Chunk upload failed');
      if(!Number.isInteger(result.body?.offset)||result.body.offset<=offset||result.body.offset>file.size)
        throw Error('Invalid upload acknowledgment');
      offset=result.body.offset;scope.__mbMediaProgress?.(offset,file.size);
    }
    const done=await rpc('POST','/api/p2p/media',{action:'finish',upload_id:uploadId});
    if(done.status!==200)throw Error(done.body?.detail||'Media validation failed');
    return done.body;
  }
  async function downloadP2PMedia(id){
    if(!/^[a-fA-F0-9]{32}$/.test(id) || !current?.isReady())throw Error('P2P not connected');
    let offset=0,size=null,mime=null,parts=[];
    do {
      const result=await rpc('GET',`/api/p2p/media/${id}?offset=${offset}`,null);
      if(result.status!==200)throw Error(result.body?.detail||'Media unavailable');
      const body=result.body||{};
      if(body.offset!==offset || !Number.isInteger(body.next_offset) ||
         !Number.isInteger(body.size) || body.size<0 || body.size>12*1024*1024 ||
         body.next_offset<offset || body.next_offset>body.size ||
         (size!==null && size!==body.size))throw Error('Invalid media response');
      const part=unb64(body.data||'');
      if(part.length!==body.next_offset-offset || (!part.length && body.next_offset!==body.size))
        throw Error('Incomplete media response');
      parts.push(part);size=body.size;mime=body.mime;offset=body.next_offset;
    }while(offset<size);
    return new Blob(parts,{type:mime||'application/octet-stream'});
  }
  const mediaUrls=new Map(), mediaPending=new Map();
  async function resolveMediaElement(el){
    if(el.dataset.mbP2pMedia==='loading' || el.dataset.mbP2pMedia==='ready')return;
    const attr=el.tagName==='A'?'href':'src';
    const original=el.getAttribute(attr)||'';
    const m=original.match(/^\/api\/media\/([a-fA-F0-9]{32})$/);
    if(!m)return;
    el.dataset.mbP2pMedia='loading';
    try{
      const owner=scope.__mbR42Scope?.()||'';const key=owner+':'+m[1];let url=mediaUrls.get(key);
      if(!url){let pending=mediaPending.get(key);if(!pending){pending=(async()=>{let blob=await scope.__mbR42MediaGet?.(m[1]);if(!blob){if(!current?.isReady())throw Error('offline');blob=await downloadP2PMedia(m[1]);if(owner===(scope.__mbR42Scope?.()||''))await scope.__mbR42MediaPut?.(m[1],blob);}if(owner!==(scope.__mbR42Scope?.()||''))throw Error('scope changed');const value=URL.createObjectURL(blob);mediaUrls.set(key,value);return value;})().finally(()=>mediaPending.delete(key));mediaPending.set(key,pending);}url=await pending;}if(owner!==(scope.__mbR42Scope?.()||''))return;
      el.setAttribute(attr,url);el.dataset.mbP2pMedia='ready';
    }catch{el.dataset.mbP2pMedia='';}
  }
  function enableMediaDOM(){
    if(!scope.document || !scope.MutationObserver)return;
    if(scope.__mbP2pObserver){
      if(current?.isReady())scope.document.querySelectorAll?.('img[src^="/api/media/"],audio[src^="/api/media/"],a[href^="/api/media/"]').forEach(n=>void resolveMediaElement(n));
      return;
    }
    const scan=node=>{
      if(node.nodeType!==1)return;
      if(node.matches?.('img[src^="/api/media/"],audio[src^="/api/media/"],a[href^="/api/media/"]'))
        void resolveMediaElement(node);
      node.querySelectorAll?.('img[src^="/api/media/"],audio[src^="/api/media/"],a[href^="/api/media/"]')
        .forEach(n=>void resolveMediaElement(n));
    };
    const observer=new MutationObserver(items=>{
      for(const item of items){if(item.type==='attributes')scan(item.target);else for(const n of item.addedNodes)scan(n);}
    });
    if(scope.document?.documentElement){observer.observe(scope.document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});scan(scope.document.documentElement);}
    scope.__mbP2pObserver=observer;
  }
  scope.__mbR42EnableMedia=enableMediaDOM;
  function installFetchBridge(){
    if(fetchInstalled)return;fetchInstalled=true;
    const original=scope.fetch.bind(scope);
    scope.fetch=async function(resource,options={}){
      const method=String(options.method || (resource && resource.method) || 'GET').toUpperCase();
      let url;
      try{url=new URL(typeof resource==='string'?resource:resource.url,scope.location.href)}
      catch{return original(resource,options)}
      const path=url.pathname+url.search;
      if(url.origin!==scope.location.origin)return original(resource,options);
      if(!current?.isReady()){if(allowed(path,method)||(method==='POST'&&url.pathname==='/api/media')||url.pathname.startsWith('/api/'))throw Error('P2P offline');return original(resource,options);}
      if(method==='POST' && url.pathname==='/api/media' && options.body instanceof FormData){
        const hotel=url.searchParams.get('customer_id'),label=url.searchParams.get('label')||'other';
        const file=options.body.get('file');
        if(!(file instanceof Blob))throw Error('Missing attachment');
        const item=await uploadP2PMedia(file,hotel,label);
        return new Response(JSON.stringify(item),{status:200,headers:{'Content-Type':'application/json'}});
      }
      if(!allowed(path,method)){if(url.pathname.startsWith('/api/'))throw Error('Unsupported P2P API route');return original(resource,options);}
      let body=null;
      if(method==='POST'){
        if(typeof options.body!=='string')return original(resource,options);
        try{body=JSON.parse(options.body)}catch{return original(resource,options)}
      }
      // For writes we never silently retry on HTTPS: an uncertain write could duplicate a message.
      // For reads use existing HTTPS only if P2P fails and site is still available.
      try{
        const result=await rpc(method,path,body);
        return new Response(JSON.stringify(result.body),{
          status:result.status,headers:{'Content-Type':'application/json'}});
      }catch(e){throw e;}
    };
  }
  async function roomKey(kind,secret){
    const b=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('michbasot-r19-'+kind+':'+secret)));
    return Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');
  }
  // R25: native bridge returns the result of durable encrypted save and readback.
  async function persistRegistration(d){
    if(!scope.MichbasotIOSStore?.save)throw Error('אחסון מאובטח אינו זמין במכשיר זה');
    await scope.MichbasotIOSStore.save(d);
  }
  let updateRunning=false, lastUpdateCheck=0;
  async function checkUpdate(force=false){
    const bridge=scope.MichbasotUpdate;
    if(!bridge || inviteMode || !current?.isReady() || updateRunning || scope.document?.hidden || !scope.__mbCanUpdate?.())return;
    if(Date.now()-lastUpdateCheck<(force?5000:30000))return;
    updateRunning=true;lastUpdateCheck=Date.now();let started=false;
    try{
      const r=await rpc('GET','/api/p2p/update?version='+Number(bridge.version()),null), m=r.body||{};
      if(r.status!==200 || !m.available || !Number.isInteger(m.version_code) || m.version_code<=Number(bridge.version()))return;
      if(!/^[a-f0-9]{64}$/.test(m.sha256||'')||!Number.isInteger(m.size)||m.size<1||m.size>100*1024*1024)throw Error('Invalid update');
      if(scope.document?.hidden || !scope.__mbCanUpdate?.())return;
      if(!bridge.begin(m.version_code,m.sha256,m.size))return;
      started=true;
      for(let offset=0;offset<m.size;){
        if(!current?.isReady())throw Error('Update connection lost');
        const response=await rpc('GET','/api/p2p/update/'+m.sha256+'?offset='+offset,null), b=response.body||{};
        if(response.status!==200 || b.offset!==offset || b.size!==m.size || !Number.isInteger(b.next_offset)||b.next_offset<=offset||b.next_offset>m.size||typeof b.data!=='string'||!bridge.chunk(offset,b.data))throw Error('Invalid update chunk');
        offset=b.next_offset;
      }
      if(!bridge.finish())throw Error('Update verification failed');
      started=false;
    }catch(e){if(started)bridge.abort();try{bridge.report?.(String(e?.message||e));}catch{}}
    finally{updateRunning=false;}
  }
  const api = Object.freeze({
    checkUpdate,
    async connect(uniqueHexKey, initialCustomers) {
      if (!/^[a-fA-F0-9]{64}$/.test(uniqueHexKey || ''))
        throw new Error('Per-device enrollment required');
      if (current) current.stop();
      inviteMode=false;
      scope.document?.getElementById('invitePanel')?.classList.add('hidden');
      scope.document?.getElementById('chatPanel')?.classList.remove('hidden');
      lastState = 'offline';failPending();
      installFetchBridge();
      enableMediaDOM();
      const [chatKey,cacheKey]=await Promise.all([roomKey('chat',uniqueHexKey),roomKey('cache-r30',uniqueHexKey)]);
      scope.__mbCacheScope?.(cacheKey,initialCustomers);
      const link = p2p.createDeviceLink({role:'device',secretHex:chatKey,
        onStatus:status=>{ lastState=link.isReady()?'online':status; if(lastState==='offline')failPending(); else if(lastState==='online'){enableMediaDOM();scope.__mbConnectionChanged?.();void checkUpdate();} },
        onData:receive // Server rechecks device and hotel permissions.
      });
      current=link;
      await link.start();
      return true;
    },
    async enrollFromInvitation(inviteHash,proof,phone,role){
      if(!/^[a-f0-9]{64}$/.test(inviteHash||'')||! /^[A-Za-z0-9_-]{40,90}$/.test(proof||'')||
         !(/^(?:05[0-9]{8}|\+[1-9][0-9]{7,14})$/.test(phone||''))||!['driver','manager','client'].includes(role))throw Error('פרטי ההזמנה חסרים');
      scope.__mbR55Trace?.('enroll-start',0,'');
      const key=await roomKey('enroll',inviteHash);
      scope.__mbR55Trace?.('room-derived',0,'');
      if(current)current.stop();failPending();inviteMode=true;lastState='offline';
      let timer,link;
      try{
        await new Promise((resolve,reject)=>{
          timer=setTimeout(()=>reject(Error('לא נוצר חיבור למשרד. ודא שתוכנת המשרד פועלת ונסה שוב.')),90000);
          link=p2p.createDeviceLink({role:'device',secretHex:key,onDiagnostic:(stage,tracker,detail)=>scope.__mbR55Trace?.(stage,tracker,detail),
            onStatus:status=>{lastState=link.isReady()?'online':status;
              if(typeof scope.__mbInviteLinkStatus==='function')scope.__mbInviteLinkStatus(lastState);
              if(lastState==='online')resolve();else if(lastState==='offline')failPending();},onData:receive});
          current=link;Promise.resolve(link.start()).catch(reject);
        });
        clearTimeout(timer);
        scope.__mbR55Trace?.('redeem-send',0,'');
        const r=await rpc('redeem_handoff','',{handoff:proof,phone});
        scope.__mbR55Trace?.('redeem-status',0,String(r.status));
        if(r.status!==200)throw Error('מספר הטלפון או אישור ההזמנה אינם תואמים. בדוק את המספר או פתח מחדש את הקישור המקורי.');
        const d=r.body||{};
        if(!/^[a-f0-9]{64}$/.test(d.secret_hex||'')||! /^[A-Za-z0-9_-]{50,120}$/.test(d.device_grant||'')||d.role!==role)
          throw Error('תשובת המשרד אינה תקינה');
        await persistRegistration(d);scope.__mbR55Trace?.('registration-saved',0,'');
        // The grant is now safely stored. Switch from invite room to device chat room.
        // A chat connection error must not falsely report failed registration.
        try{await api.connect(d.secret_hex,d.customers);}catch(e){
          if(typeof scope.__mbChatConnectionPending==='function')scope.__mbChatConnectionPending();
        }
        return true;
      }catch(e){if(current===link){link?.stop();current=null;lastState='offline';failPending();}throw e;}
      finally{clearTimeout(timer);}
    },
    getStatus(){return lastState;},
    getMode(){return inviteMode?'invitation':'chat';},
    disconnect(){if(current)current.stop();current=null;lastState='offline';failPending();}
  });
  Object.defineProperty(scope,'MichbasotMobileP2P',{value:api,writable:false,configurable:false});
})(typeof globalThis==='undefined'?this:globalThis);
