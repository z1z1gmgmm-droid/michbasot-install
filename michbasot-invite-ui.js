/* Michbasot invite display only. No network, auth, storage or install changes. */
(function () {
  'use strict';
  const welcome = 'על מנת להתחיל להשתמש במערכת מתן שירותי כביסה ללקוחות המכבסה, תחילה עליך להוריד את האפליקציה לטלפון.';
  const norm = s => (s || '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim();
  const intro = s => s.startsWith('להתקנת האפליקציה לחץ') || s.startsWith('לאחר ההורדה וההתקנה חזור') || s.startsWith('ההזמנה תזוהה אוטומטית');
  const foot = s => s.startsWith('אין צורך בקוד SMS שני') || s.startsWith('קישור ההזמנה האישי מאפשר הרשאה חד-פעמית') || s.startsWith('אל תעביר את הקישור לאחרים');
  const progressCopy = s => /^מוריד את האפליקציה מהמשרד\s*[.…]*$/.test(s) || /^מעבירים את קובץ ההתקנה מהמשרד\s*[.…]*$/.test(s);
  const interactive = 'button,a,input,select,textarea,[role="button"],progress,[role="progressbar"],meter,svg,canvas';
  const protectedElement = el => el.matches(interactive) || !!el.querySelector(interactive) || !!el.closest('button,a,[role="button"],script,style,template,noscript');
  const hidden = 'data-mb-invite-copy-hidden';
  let scheduled = false;
  function update() {
    scheduled = false;
    if (!document.body) return;
    const nodes = Array.from(document.body.querySelectorAll('p,div,span,small,label,li,section,article,h2,h3'));
    // Work with smallest eligible blocks; never delete a parent containing controls.
    let introShown = nodes.some(el => norm(el.textContent) === welcome && !el.hasAttribute(hidden));
    for (const el of nodes) {
      if (!el.isConnected || protectedElement(el) || Array.from(el.children).some(c => !c.matches('span,b,strong,em,i,br,small,wbr'))) continue;
      const s = norm(el.textContent);
      if (!s || s.length > 700) continue;
      const wasHidden = el.hasAttribute(hidden);
      const childMatch = Array.from(el.children).some(c => {
        const t = norm(c.textContent);
        return t && (intro(t) || foot(t) || progressCopy(t) || t === welcome);
      });
      if (childMatch && !intro(s)) continue;
      if (intro(s)) {
        if (!introShown) {
          // Only a copy block, not a button or a progress bar.
          el.textContent = welcome;
          introShown = true;
          el.removeAttribute(hidden);
        } else if (!wasHidden) el.setAttribute(hidden, '1');
      } else if (foot(s) || progressCopy(s)) {
        if (!wasHidden) el.setAttribute(hidden, '1');
      } else if (wasHidden) {
        // Keep actual errors / new status visible when the original code updates text.
        el.removeAttribute(hidden);
      }
    }
  }
  function schedule() {
    if (!scheduled) { scheduled = true; requestAnimationFrame(update); }
  }
  function start() {
    if (!document.body) return;
    const style = document.createElement('style');
    style.textContent = '[' + hidden + '="1"]{display:none!important}';
    document.head.appendChild(style);
    update();
    new MutationObserver(schedule).observe(document.body, {subtree:true,childList:true,characterData:true});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once:true}); else start();
})();
