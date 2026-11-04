const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
function kiosk(native = true) {
  const { document, Event } = parseHTML('<html><body><div id="welcome-screen" hidden></div><button id="weapon-enlarge"><span>LED</span></button></body></html>');
  const messages = [], calls = [], logs = [];
  const window = { showPage: id => calls.push(id), showLedScreen: id => calls.push(id), applyKioskWelcome() {}, businessState: { selected: 'weapon-02' }, g_currentScreen: 'page-standby' };
  if (native) window.chrome = { webview: { postMessage: message => messages.push(message) } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../integration/dtaq-bridge.js'), 'utf8'), {
    window, document, console: { info: (...args) => logs.push(args) }, fetch: () => { throw Error('Unexpected HTTP request'); }
  });
  return { document, Event, window, messages, calls, logs };
}
test('kiosk UI hooks send only raw MSG strings to the C# host and preserve existing UI actions', () => {
  const app = kiosk(), { window } = app;
  window.showPage('page-search'); window.showLedScreen('261010'); window.showPage('page-business');
  app.document.querySelector('#weapon-enlarge span').dispatchEvent(new app.Event('click', { bubbles: true }));
  window.showPage('page-landing'); window.applyKioskWelcome({ show: true });
  assert.deepEqual(app.messages, ['MSG|EMP|', 'MSG|EMP|261010', 'MSG|WEP|', 'MSG|WEP|weapon-02', 'MSG|ROLLING', 'MSG|WELCOME']);
  assert.deepEqual(app.calls, ['page-search', '261010', 'page-business', 'page-landing']);
  assert.equal(window.DTAQ_LED_BRIDGE.send('project', 'PRJ-2026-001'), 'MSG|WEP|PRJ-2026-001');
  assert.throws(() => window.DTAQ_LED_BRIDGE.send('employee', '1|2'));
});
test('plain browser kiosk preview returns the wire string without attempting network delivery', () => {
  const app = kiosk(false);
  assert.equal(app.window.DTAQ_LED_BRIDGE.send('employee', '261010'), 'MSG|EMP|261010');
  assert.deepEqual(app.messages, []); assert.equal(app.logs.length, 1);
});
