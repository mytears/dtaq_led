/* DTaQ kiosk -> LED adapter. Load AFTER index.js, business.js and kiosk.js. */
(function () {
  'use strict';
  if (window.DTAQ_LED_BRIDGE) return;
  function send(type, id = '') {
    id = String(id ?? '').trim();
    const wireType = { rolling: 'ROLLING', welcome: 'WELCOME', employee: 'EMP', weapon: 'WEP', project: 'WEP' }[type];
    if (!wireType || /[|\x00-\x1f]/.test(id)) throw Error('지원하지 않는 LED 명령입니다.');
    const message = `MSG|${wireType}` + (['EMP', 'WEP'].includes(wireType) ? `|${id}` : '');
    if (window.chrome?.webview) window.chrome.webview.postMessage(message);
    else console.info('[DTaQ LED] C# WebView2 호스트에서 전송해주세요.', message);
    return message;
  }
  function wrap(name, hook) {
    const original = window[name];
    if (typeof original !== 'function') return;
    window[name] = function (...args) { const result = original.apply(this, args); hook.apply(this, args); return result; };
  }
  wrap('showPage', function (pageId) {
    if (pageId === 'page-search') send('employee');
    else if (pageId === 'page-business') send('weapon');
    else if (pageId === 'page-landing' || pageId === 'page-standby') {
      const welcome = document.getElementById('welcome-screen');
      send(pageId === 'page-standby' && welcome && !welcome.hidden ? 'welcome' : 'rolling');
    }
  });
  wrap('showLedScreen', function (id) { if (id) send('employee', id); });
  wrap('applyKioskWelcome', function (content) {
    if (window.g_currentScreen === 'page-standby') send(content?.show === true ? 'welcome' : 'rolling');
  });
  // Business UI is created on DOM ready. A delegated listener works for both existing and new buttons.
  document.addEventListener('click', event => {
    if (!event.target.closest('#weapon-enlarge')) return;
    const id = window.businessState?.selected;
    if (id) send('weapon', id);
  });
  window.DTAQ_LED_BRIDGE = Object.freeze({ send });
})();
