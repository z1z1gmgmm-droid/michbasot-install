/*
 * Michbasot Service: per-device, best-effort WebRTC rendezvous / keepalive.
 * NOT a complete app transport. Does not publish APKs or deliver messages/photos.
 * No hard-coded shared secret. Provision a unique 32-byte key after user verification.
 * Public WSS trackers only exchange SDP/ICE; keys and business data are not signaled.
 * Public trackers can fail and STUN-only ICE will fail behind certain NATs.
 * The application backend MUST authorize every business operation by device/user/hotel.
 */
(function (scope) {
  'use strict';
  const enc = new TextEncoder();
  const defaultTrackers = ['wss://tracker.openwebtorrent.com', 'wss://tracker.webtorrent.dev'];
  const defaultIce = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  const bytes = h => Uint8Array.from(h.match(/../g) || [], x => parseInt(x, 16));
  const binary = a => Array.from(a, c => String.fromCharCode(c)).join('');
  const rand = (crypto, n) => crypto.getRandomValues(new Uint8Array(n));
  const value = s => typeof s === 'string' && s.length > 0 && s.length < 70000;

  async function deriveRoom(secretHex, crypto = scope.crypto) {
    if (!/^[a-fA-F0-9]{64}$/.test(secretHex || '')) throw new Error('Unique 32-byte per-device key required');
    const data = enc.encode('michbasot-service-device-room-v1:' + secretHex.toLowerCase());
    return binary(new Uint8Array(await crypto.subtle.digest('SHA-1', data)));
  }
  async function hmac(secretHex, message, crypto = scope.crypto) {
    if (!/^[a-fA-F0-9]{64}$/.test(secretHex || '')) throw new Error('Invalid device key');
    const key = await crypto.subtle.importKey('raw', bytes(secretHex), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
    return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message))));
  }
  const macInput = (type, id, sender, target, sdp) =>
    `mb-service-p2p-signaling-v1\n${type}\n${hex(enc.encode(id))}\n${hex(enc.encode(sender))}\n${hex(enc.encode(target || ''))}\n${sdp}`;
  const proofInput = (role, ownNonce, otherNonce) =>
    `mb-service-p2p-auth-v1\n${role}\n${ownNonce}\n${otherNonce}`;
  async function makeAuthProof(secretHex, role, ownNonce, otherNonce, crypto = scope.crypto) {
    return hmac(secretHex, proofInput(role, ownNonce, otherNonce), crypto);
  }
  function validPeerPacket(type, p) {
    return p && p.type === type && value(p.sdp) && p.sdp.length < 30000 &&
      p.sdp.startsWith('v=0') && /^[a-f0-9]{64}$/i.test(p.mac || '');
  }

  function createDeviceLink({role, secretHex, trackers=defaultTrackers, iceServers=defaultIce,
       onStatus=()=>{}, onData=()=>{}, crypto=scope.crypto, WebSocketCtor=scope.WebSocket,
       RtcCtor=scope.RTCPeerConnection, reconnectMs=17000}={}) {
    if (!['office','device'].includes(role)) throw new Error('Invalid role');
    if (!/^[a-fA-F0-9]{64}$/.test(secretHex || '')) throw new Error('Unique 32-byte key required');
    if (!crypto?.subtle || !crypto?.getRandomValues || !WebSocketCtor || !RtcCtor)
      throw new Error('Secure WebRTC and WebCrypto browser environment required');
    let room, ownPeer, stopped=true, active=null, trackSockets=new Map(), attempts=new Map();
    let schedule=null, timer=null, lastPong=0, lastPing=0;
    const state = (v) => { if (!stopped) onStatus(v); };
    const isReady = () => !!active && active.authorized && active.channel?.readyState === 'open' &&
      active.pc.connectionState !== 'failed';
    const sendIfOpen = (s,m) => { if (s && s.readyState === 1) s.send(JSON.stringify(m)); };
    const safeClose = (p) => {if (!p) return;try{p.channel?.close();}catch{}try{p.pc.close();}catch{}};
    function closePeers(){for(const p of attempts.values())safeClose(p);attempts.clear();active=null;}
    function sendToTrackers(m) {for(const s of trackSockets.values())sendIfOpen(s,m);}
    function announce(s, offers=[]) {
      sendIfOpen(s,{action:'announce',info_hash:room,peer_id:ownPeer,uploaded:0,downloaded:0,
        left:1,event:'started',numwant:Math.min(offers.length,5),offers});
    }
    async function authenticatedPacket(type,id,sender,target,sdp) {
      return {type,sdp,mac:await hmac(secretHex,macInput(type,id,sender,target,sdp),crypto)};
    }
    async function verified(type,id,sender,target,packet){
      if(!validPeerPacket(type,packet))return false;
      const expect = await hmac(secretHex,macInput(type,id,sender,target,packet.sdp),crypto);
      return expect === packet.mac.toLowerCase();
    }
    function createCandidate(id, socket){
      const pc = new RtcCtor({iceServers});
      const p={id,pc,socket,channel:null,ours:null,theirs:null,proved:false,proofSent:false,authorized:false,created:Date.now()};
      attempts.set(id,p);
      pc.ondatachannel=e=>attachChannel(p,e.channel);
      pc.onconnectionstatechange=()=>{if(['failed','closed','disconnected'].includes(pc.connectionState)){
        const was = active === p; attempts.delete(p.id);safeClose(p);
        if(was){active=null;state('offline');}
      }};
      return p;
    }
    async function waitIce(pc){
      if(pc.iceGatheringState==='complete')return;
      await new Promise(resolve=>{
        let done=false;const complete=()=>{if(done)return;done=true;clearTimeout(timeout);
          pc.removeEventListener('icegatheringstatechange', changed);resolve();};
        const changed=()=>{if(pc.iceGatheringState==='complete')complete();};
        pc.addEventListener('icegatheringstatechange',changed);
        const timeout=setTimeout(complete,18000);
      });
    }
    async function startOffer(s){
      if(stopped || role!=='office' || isReady() || attempts.size>3 || s.readyState!==1)return;
      const offerId=binary(rand(crypto,20));const p=createCandidate(offerId,s);
      try {
        attachChannel(p,p.pc.createDataChannel('michbasot-service-v1',{ordered:true}));
        await p.pc.setLocalDescription(await p.pc.createOffer());await waitIce(p.pc);
        if(stopped || !attempts.has(p.id))return;
        const packet=await authenticatedPacket('offer',offerId,ownPeer,'',p.pc.localDescription.sdp);
        announce(s,[{offer_id:offerId,offer:packet}]);state('connecting');
      }catch{ attempts.delete(p.id);safeClose(p); }
    }
    async function receivedOffer(s,m){
      if(stopped || role!=='device' || isReady() || attempts.size>3 ||
         !value(m.offer_id) || m.offer_id.length!==20 || !value(m.peer_id) || m.peer_id.length!==20 || m.peer_id===ownPeer)return;
      // Fail CLOSED. Never process or respond to unauthenticated SDP.
      if(!await verified('offer',m.offer_id,m.peer_id,'',m.offer))return;
      const p=createCandidate('answer:'+hex(enc.encode(m.offer_id)),s);
      try{
        await p.pc.setRemoteDescription({type:'offer',sdp:m.offer.sdp});
        await p.pc.setLocalDescription(await p.pc.createAnswer());await waitIce(p.pc);
        if(stopped || !attempts.has(p.id))return;
        const packet=await authenticatedPacket('answer',m.offer_id,ownPeer,m.peer_id,p.pc.localDescription.sdp);
        sendIfOpen(s,{action:'announce',info_hash:room,peer_id:ownPeer,to_peer_id:m.peer_id,
          offer_id:m.offer_id,answer:packet});state('connecting');
      }catch{ attempts.delete(p.id);safeClose(p); }
    }
    async function receivedAnswer(m){
      if(stopped || role!=='office' || !value(m.offer_id) || m.offer_id.length!==20 ||
         !value(m.peer_id) || m.peer_id.length!==20)return;
      const p=attempts.get(m.offer_id);
      if(!p || p.pc.signalingState!=='have-local-offer')return;
      if(!await verified('answer',m.offer_id,m.peer_id,ownPeer,m.answer))return;
      try{await p.pc.setRemoteDescription({type:'answer',sdp:m.answer.sdp});}
      catch{ attempts.delete(p.id);safeClose(p); }
    }
    async function incoming(p, data){
      if(stopped || !attempts.has(p.id) || typeof data !== 'string' || data.length>70000)return;
      let m;try{m=JSON.parse(data);}catch{return;}
      const ch=p.channel;
      if(m?.kind==='hello' && !p.authorized){
        if(m.role === role || !['office','device'].includes(m.role) || !/^[a-f0-9]{64}$/.test(m.nonce || '')){ch.close();return;}
        if(p.theirs && p.theirs!==m.nonce){ch.close();return;}
        p.theirs=m.nonce;
        if(!p.proofSent && p.ours){p.proofSent=true;
          ch.send(JSON.stringify({kind:'proof', proof:await makeAuthProof(secretHex,role,p.ours,p.theirs,crypto)}));}
      } else if(m?.kind==='proof' && !p.authorized){
        if(!p.theirs || !/^[a-f0-9]{64}$/.test(m.proof || '')){ch.close();return;}
        const otherRole=role==='office'?'device':'office';
        const expected=await makeAuthProof(secretHex,otherRole,p.theirs,p.ours,crypto);
        if(expected!==m.proof.toLowerCase()){ch.close();return;}
        p.proved=true;
        if(p.proofSent){
          // Only one authenticated device per unique per-device key.
          if(active && active!==p)safeClose(active);
          active=p;p.authorized=true;lastPong=Date.now();
          for(const [k,other] of attempts){if(other!==p){safeClose(other);attempts.delete(k);}}
          state('online');
        }
      } else if(p.authorized){
        if(m.kind==='ping'){ch.send(JSON.stringify({kind:'pong',t:m.t}));}
        else if(m.kind==='pong' && typeof m.t==='number'){lastPong=Date.now();}
        else if(m.kind==='payload' && typeof m.value==='object' && m.value!==null &&
          JSON.stringify(m.value).length < 60000) onData(m.value);
      }
    }
    function attachChannel(p,ch){
      p.channel=ch;
      ch.onopen=()=>{
        p.ours=hex(rand(crypto,32));
        ch.send(JSON.stringify({kind:'hello',role,nonce:p.ours}));
      };
      ch.onmessage=e=>incoming(p,e.data).catch(()=>{try{ch.close();}catch{}});
      ch.onclose=()=>{const was=active===p;attempts.delete(p.id);safeClose(p);
        if(was){active=null;state('offline');}};
    }
    function attachTracker(url){
      if(stopped)return;
      let s;try{s=new WebSocketCtor(url);}catch{reconnectTracker(url);return;}
      trackSockets.set(url,s);
      s.onopen=()=>{if(stopped)return;announce(s);if(role==='office')startOffer(s);};
      s.onmessage=event=>{
        if(stopped||typeof event.data!=='string'||event.data.length>90000)return;
        let m;try{m=JSON.parse(event.data);}catch{return;}
        if(m?.action!=='announce'||m.info_hash!==room)return;
        if(m.offer)receivedOffer(s,m).catch(()=>{});
        if(m.answer)receivedAnswer(m).catch(()=>{});
      };
      s.onclose=()=>{if(trackSockets.get(url)!==s)return;trackSockets.delete(url);reconnectTracker(url);};
      s.onerror=()=>{};
    }
    function reconnectTracker(url){if(!stopped)setTimeout(()=>attachTracker(url),4000+Math.floor(Math.random()*4000));}
    async function start(){
      if(!stopped)return;
      stopped=false;
      room=await deriveRoom(secretHex,crypto);ownPeer=binary(rand(crypto,20));
      state('offline');
      trackers.forEach(attachTracker);
      schedule=setInterval(()=>{
        if(stopped)return;
        for(const [k,p] of attempts){if(Date.now()-p.created>70000 && !p.authorized){safeClose(p);attempts.delete(k);}}
        if(!isReady() && role==='office')for(const s of trackSockets.values())startOffer(s);
      }, Math.max(reconnectMs,14000));
      timer=setInterval(()=>{
        if(!isReady())return;
        const now=Date.now();
        if(now-lastPong>40000){safeClose(active);active=null;state('offline');return;}
        if(now-lastPing>12000){lastPing=now;active.channel.send(JSON.stringify({kind:'ping',t:now}));}
      },5000);
    }
    function stop(){stopped=true;clearInterval(schedule);clearInterval(timer);
      for(const s of trackSockets.values())try{s.close();}catch{}
      trackSockets.clear();closePeers();}
    function send(data){if(!isReady())return false;const raw=JSON.stringify(data);
      if(raw.length>60000)throw new Error('Payload exceeds 60 KB; photos need chunked authorized transport');
      active.channel.send(JSON.stringify({kind:'payload',value:data}));return true;}
    return Object.freeze({start,stop,send,isReady});
  }
  const exported={createDeviceLink,deriveRoom,hmac,makeAuthProof,macInput,validPeerPacket};
  if(typeof module !== 'undefined' && module.exports)module.exports=exported;
  else scope.MichbasotDeviceLink=Object.freeze(exported);
})(typeof globalThis === 'undefined' ? this : globalThis);
