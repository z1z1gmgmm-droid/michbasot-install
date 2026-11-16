/* iOS R01. No outside APIs; no public personal identifiers in URL requests. */
(async()=>{'use strict';
 const $=id=>document.getElementById(id), overlay=$('iosStartOverlay'), note=$('iosStartNote');
 const ios=/iP(hone|ad|od)/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent)&&navigator.maxTouchPoints>1);
 const standalone=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 const roles={d:'driver',m:'manager',c:'client'};
 const params=new URLSearchParams(location.hash.slice(1));
 const keys=Object.keys(roles).filter(k=>params.has(k));
 const role=keys.length===1?roles[keys[0]]:null;
 const token=role&&params.getAll(keys[0]).length===1?params.get(keys[0]):null;
 const valid=typeof token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(token);
 const show=(text)=>{note.textContent=text;overlay.hidden=false;};
 const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
 if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js',{scope:'./'}).catch(()=>{});
 if(!ios){show('קישור זה מיועד לאייפון. במכשירי Android השתמש בקישור ההזמנה הרגיל.');return;}
 if(!standalone){show(valid?'להתקנה באייפון: הקש על שיתוף ב-Safari, בחר ״הוסף למסך הבית״ ואשר. אחר כך פתח את הסמל שנוסף.':'פתח את הקישור האישי שקיבלת בהודעת ה-SMS.');return;}
 overlay.hidden=true;
 if(!window.MichbasotMobileP2P||!window.MichbasotIOSStore){show('לא ניתן להפעיל את האפליקציה. בדוק את חיבור האינטרנט ופתח מחדש.');return;}
 try{
   const saved=await window.MichbasotIOSStore.read();
   if(saved&&(!role||role===saved.role)){
     window.__mbSetIosRole?.(saved.role);
     // Remove one-use invitation from the running URL after verified local registration.
     if(location.hash)history.replaceState(null,'',location.pathname);
     await window.MichbasotMobileP2P.connect(saved.secret_hex);
     return;
   }
   if(valid){
     const inviteHash=await hash(token),proof=await hash('mb-https-install-v1:'+token);
     window.__mbShowPhoneFirst(role,inviteHash,proof);
     return;
   }
   show('כדי להתחבר בפעם הראשונה, הוסף את האפליקציה למסך הבית מתוך קישור ההזמנה שקיבלת ב-SMS. אם היא כבר מותקנת, פתח את ההזמנה מחדש ובחר ״הוסף למסך הבית״ מהקישור האישי.');
 }catch{
   show('לא ניתן לקרוא את ההתחברות השמורה. פתח מחדש את קישור ההזמנה ב-SMS.');
 }
})();
