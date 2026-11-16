/* R56: browser equivalent of existing office _mb20_personalize_apk. No network calls. */
(function(scope){'use strict';
 function personalize(raw,role,inviteHash,proof){
  if(!(raw instanceof Uint8Array)||raw.length<1024||raw.length>40*1024*1024||!['driver','manager','client'].includes(role)||!/^[a-f0-9]{64}$/.test(inviteHash)||!/^[A-Za-z0-9_-]{40,90}$/.test(proof))throw Error('Invalid input');
  const v=new DataView(raw.buffer,raw.byteOffset,raw.byteLength), magic=new TextEncoder().encode('APK Sig Block 42');
  const u64=(o)=>{const lo=v.getUint32(o,true),hi=v.getUint32(o+4,true);if(hi!==0)throw Error('Oversized signing block');return lo;};
  let end=-1;for(let i=raw.length-22;i>=Math.max(0,raw.length-65557);i--){if(v.getUint32(i,true)===0x06054b50&&i+22+v.getUint16(i+20,true)===raw.length){end=i;break;}}
  if(end<0||v.getUint16(end+4,true)!==0||v.getUint16(end+6,true)!==0)throw Error('Invalid ZIP end');
  const cd=v.getUint32(end+16,true), cdSize=v.getUint32(end+12,true);
  if(cd<32||cd+cdSize!==end||!magic.every((b,i)=>raw[cd-16+i]===b))throw Error('Invalid signing block');
  const size=u64(cd-24),start=cd-size-8;
  if(start<0||size<24||u64(start)!==size)throw Error('Invalid block size');
  let pos=start+8, signed=false;while(pos<cd-24){if(pos+12>cd-24)throw Error('Invalid pair');const n=u64(pos),key=v.getUint32(pos+8,true);if(n<4||pos+8+n>cd-24||key===0x4d423230)throw Error('Invalid or personalized APK');if([0x7109871a,0xf05368c0,0x1b93ad61].includes(key))signed=true;pos+=8+n;}
  if(pos!==cd-24||!signed)throw Error('Missing signature');
  const out=new Uint8Array(raw.length+4096),w=new DataView(out.buffer),put64=(o,n)=>{w.setUint32(o,n,true);w.setUint32(o+4,0,true);};
  out.set(raw.subarray(0,cd-24),0);put64(start,size+4096);put64(cd-24,4088);w.setUint32(cd-16,0x4d423230,true);
  out.set(new TextEncoder().encode('MBR20|'+role+'|'+inviteHash+'|'+proof),cd-12);
  out.set(raw.subarray(cd-24),cd-24+4096);put64(cd-24+4096,size+4096);w.setUint32(end+4096+16,cd+4096,true);
  return out;
 }
 scope.MBPersonalApkR56=Object.freeze({personalize});
})(typeof window==='undefined'?globalThis:window);
