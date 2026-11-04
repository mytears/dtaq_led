const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { parseHTML } = require('linkedom');
const protocol = require('../include/js/protocol.js');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const code = fs.readFileSync(path.join(root, 'include/js/led.js'), 'utf8');
async function display({ webview = false, origin = 'http://localhost:8090', beforeReady } = {}) {
  const { document, Event } = parseHTML(html);
  const windowEvents = {}, timers = new Map(), videos = [], frames = new Map(), eventSources = [], nativeEvents = {};
  let timerId = 0, frameId = 0, now = 0, handler;
  const create = document.createElement.bind(document);
  document.createElement = name => {
    const el = create(name);
    if (name === 'video') { el.play = () => Promise.resolve(); el.pause = () => { el.wasPaused = true; }; el.load = () => {}; videos.push(el); }
    return el;
  };
  const window = { LedProtocol: protocol, addEventListener: (name, callback) => { windowEvents[name] = callback; } };
  window.EventSource = class { constructor(url) { this.url = url; eventSources.push(this); } close() { this.closed = true; } };
  if (webview) window.chrome = { webview: { addEventListener: (name, callback) => { nativeEvents[name] = callback; } } };
  const context = {
    window, document, location: { search: '', origin }, innerWidth: 1600, innerHeight: 600,
    URLSearchParams, performance: { now: () => now }, console: { error() {} },
    setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id),
    requestAnimationFrame: callback => { const id = ++frameId; frames.set(id, callback); return id; }, cancelAnimationFrame: id => frames.delete(id),
    fetch: async resource => {
      if (handler) { const response = await handler(resource); if (response) return response; }
      const filename = path.join(root, resource);
      if (!fs.existsSync(filename)) return { ok: false, status: 404 };
      return { ok: true, json: async () => JSON.parse(fs.readFileSync(filename, 'utf8')) };
    }
  };
  vm.runInNewContext(code, context, { filename: 'led.js' }); beforeReady?.(window); await window.DTAQ_LED.ready;
  function advance(ms) {
    const end = now + ms;
    while (now < end) {
      now = Math.min(end, now + 20);
      const pending = [...frames.values()]; frames.clear();
      pending.forEach(callback => callback(now));
    }
  }
  return { document, window, windowEvents, timers, videos, frames, eventSources, nativeEvents, advance, Event, api: window.DTAQ_LED, setFetch: fn => { handler = fn; } };
}
test('WebView2 string events delegate to SetRevMsg', async () => {
  const app = await display({ webview: true, origin: 'https://dtaq-led.local' });
  assert.equal(app.eventSources.length, 0);
  for (const [message, screen] of [
    ['MSG|WELCOME', 'welcome'], ['MSG|EMP|261010', 'employee'], ['MSG|EMP|', 'employee-search'],
    ['MSG|WEP|weapon-02', 'weapon'], ['MSG|WEP|', 'weapon-search'], ['MSG|ROLLING', 'rolling']
  ]) {
    app.nativeEvents.message({ data: message });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.api.getState().screen, screen, message);
  }
});
test('standalone browser preview opens no message connection', async () => {
  const app = await display({ origin: 'http://localhost:9000' });
  assert.equal(app.eventSources.length, 0);
  await app.window.SetRevMsg('MSG|EMP|261010'); assert.equal(app.api.getState().screen, 'employee');
  app.windowEvents.pagehide(); assert.equal(app.frames.size, 0);
});
test('SetRevMsg accepts an early host message before initial JSON loading finishes', async () => {
  let pending;
  const app = await display({ beforeReady: window => { pending = window.SetRevMsg('MSG|EMP|261010'); } });
  assert.equal(await pending, true); assert.equal(app.api.getState().screen, 'employee');
});

test('startup rolls promotional video; search and welcome cancel playback and timers', async () => {
  const app = await display(); assert.equal(app.api.getState().screen, 'rolling');
  const video = app.videos.at(-1); assert.equal(video.muted, true);
  await app.window.SetRevMsg('MSG|EMP|'); assert.equal(app.api.getState().screen, 'employee-search');
  assert.equal(video.wasPaused, true); assert.equal(app.timers.size, 0);
  await app.window.SetRevMsg('MSG|WELCOME'); assert.equal(app.document.getElementById('welcome-title').textContent, '방위사업청 대표단');
  assert.equal(app.api.getState().screen, 'welcome'); assert.equal(app.timers.size, 0);
});
test('MSG wire strings switch all requested screens and render records by ID', async () => {
  const app = await display();
  for (const [message, screen] of [
    ['MSG|WELCOME', 'welcome'], ['MSG|EMP|', 'employee-search'], ['MSG|EMP|261010', 'employee'],
    ['MSG|WEP|', 'weapon-search'], ['MSG|WEP|weapon-02', 'weapon'], ['MSG|ROLLING', 'rolling']
  ]) {
    assert.equal(await app.window.SetRevMsg(message), true, message); assert.equal(app.api.getState().screen, screen, message);
    if (screen === 'employee') assert.equal(app.document.getElementById('employee-id').textContent, '261010');
    if (screen === 'weapon') assert.equal(app.document.getElementById('weapon-name').textContent, 'K9A1 자주포');
  }
});
test('employee, weapon, and project IDs render the original JSON records', async () => {
  const app = await display();
  await app.window.SetRevMsg('MSG|EMP|261010');
  assert.equal(app.api.getState().screen, 'employee'); assert.equal(app.document.getElementById('employee-dept').textContent, '총무복지팀');
  assert.equal(app.document.querySelectorAll('.history-row').length, 12);
  await app.window.SetRevMsg('MSG|WEP|weapon-02');
  assert.equal(app.document.getElementById('weapon-name').textContent, 'K9A1 자주포'); assert.equal(app.document.getElementById('weapon-performance').children.length, 5);
  assert.equal(app.document.querySelectorAll('.screen:not([hidden])').length, 1);
  await app.window.SetRevMsg('MSG|WEP|PRJ-2026-001'); assert.equal(app.document.getElementById('weapon-label-1').textContent, '진행상태');
  await app.window.SetRevMsg('MSG|WEP|'); assert.equal(app.api.getState().screen, 'weapon-search');
});
test('unknown IDs show a search screen and an explicit error instead of stale personal data', async () => {
  const app = await display(); await app.window.SetRevMsg('MSG|EMP|261010');
  assert.equal(await app.window.SetRevMsg('MSG|EMP|missing'), false);
  assert.equal(app.api.getState().screen, 'employee-search'); assert.equal(app.document.getElementById('notice').hidden, false);
  assert.match(app.document.getElementById('notice').textContent, /찾을 수 없습니다/);
});
test('latest signal wins when a slower JSON request completes after the next screen command', async () => {
  const app = await display(); let release, started;
  const waiting = new Promise(resolve => { started = resolve; });
  app.setFetch(async resource => resource === 'data/employees.json' ? (started(), await new Promise(resolve => { release = resolve; })) : null);
  const old = app.window.SetRevMsg('MSG|EMP|261010'); await waiting;
  await app.window.SetRevMsg('MSG|WEP|');
  release({ ok: true, json: async () => [{ id: '261010', name: '이전 직원' }] });
  assert.equal(await old, false); assert.equal(app.api.getState().screen, 'weapon-search');
});
test('SetRevMsg rejects non-string or malformed signals without changing the current screen', async () => {
  const app = await display(); await app.window.SetRevMsg('MSG|WEP|');
  for (const message of [null, {}, 123, 'MSG|ERLCOME', 'MSG|EMP|1|2', 'MSG|UNKNOWN']) {
    assert.equal(await app.window.SetRevMsg(message), false);
    assert.equal(app.api.getState().screen, 'weapon-search');
  }
});

test('video end advances to image, then the image timer resumes video', async () => {
  const app = await display();
  assert.equal(app.document.documentElement.style.getPropertyValue('--media-fit'), 'fill');
  app.videos.at(-1).onended();
  const image = app.document.getElementById('media-player').firstElementChild;
  assert.equal(image.tagName, 'IMG');
  assert.equal(app.document.documentElement.style.getPropertyValue('--media-fit'), 'fill'); image.onload();
  const timer = [...app.timers.values()].find(timer => timer.ms === 10000); assert.ok(timer); timer.fn();
  assert.equal(app.document.getElementById('media-player').firstElementChild.tagName, 'VIDEO');
});
test('failed media are skipped and all-failed playlists stop safely', async () => {
  const app = await display(); app.videos.at(-1).onerror();
  app.document.getElementById('media-player').firstElementChild.onerror();
  assert.equal(app.document.getElementById('media-player').children.length, 0);
  assert.equal(app.document.getElementById('media-empty').hidden, false); assert.equal(app.timers.size, 0);
});
test('debug forms support IDs and empty-ID search', async () => {
  const app = await display(); const input = app.document.getElementById('debug-employee'); input.value = '261010';
  app.document.getElementById('employee-form').dispatchEvent(new app.Event('submit', { cancelable: true }));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(app.api.getState().screen, 'employee');
  input.value = ''; app.document.getElementById('employee-form').dispatchEvent(new app.Event('submit', { cancelable: true }));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(app.api.getState().screen, 'employee-search');
});
test('all debug controls call the global SetRevMsg function with the same wire strings as C#', async () => {
  const app = await display(), calls = [], apply = app.window.SetRevMsg;
  app.window.SetRevMsg = message => { calls.push(message); return apply(message); };
  for (const [inputId, formId, value, screen] of [
    ['debug-employee', 'employee-form', ' 261010 ', 'employee'],
    ['debug-employee', 'employee-form', '', 'employee-search'],
    ['debug-weapon', 'weapon-form', 'weapon-02', 'weapon'],
    ['debug-weapon', 'weapon-form', '', 'weapon-search'],
    ['debug-weapon', 'weapon-form', 'PRJ-2026-001', 'weapon']
  ]) {
    app.document.getElementById(inputId).value = value;
    app.document.getElementById(formId).dispatchEvent(new app.Event('submit', { cancelable: true }));
    await new Promise(resolve => setImmediate(resolve)); assert.equal(app.api.getState().screen, screen);
  }
  for (const [button, screen] of [['debug-rolling', 'rolling'], ['debug-welcome', 'welcome']]) {
    app.document.getElementById(button).dispatchEvent(new app.Event('click'));
    await new Promise(resolve => setImmediate(resolve)); assert.equal(app.api.getState().screen, screen);
  }
  assert.deepEqual(calls, ['MSG|EMP|261010', 'MSG|EMP|', 'MSG|WEP|weapon-02', 'MSG|WEP|', 'MSG|WEP|PRJ-2026-001', 'MSG|ROLLING', 'MSG|WELCOME']);
  assert.equal(app.document.getElementById('debug-connection').textContent, 'MSG|WELCOME');
});

test('welcome stops video immediately even while refreshed welcome JSON is pending', async () => {
  const app = await display(); let release, started;
  const waiting = new Promise(resolve => { started = resolve; });
  const video = app.videos.at(-1);
  app.setFetch(async resource => resource === 'data/kiosk_contents.json' ? (started(), await new Promise(resolve => { release = resolve; })) : null);
  const pending = app.window.SetRevMsg('MSG|WELCOME'); await waiting;
  assert.equal(video.wasPaused, true); assert.equal(app.api.getState().screen, 'welcome');
  release({ ok: false, status: 500 }); assert.equal(await pending, false); assert.equal(app.api.getState().screen, 'welcome');
});
test('failed JSON lookup clears the previous employee display', async () => {
  const app = await display(); await app.window.SetRevMsg('MSG|EMP|261010');
  app.setFetch(async resource => resource === 'data/employees.json' ? { ok: false, status: 500 } : null);
  assert.equal(await app.window.SetRevMsg('MSG|EMP|201245'), false);
  assert.equal(app.api.getState().screen, 'employee-search');
});
test('long history waits, scrolls upwards slowly, holds the last row, then repeats from the top', async () => {
  const app = await display(); await app.window.SetRevMsg('MSG|EMP|261010');
  const viewport = app.document.getElementById('career-viewport');
  Object.defineProperties(viewport, { scrollHeight: { value: 816 }, clientHeight: { value: 365 } });
  assert.equal(app.document.querySelectorAll('.history-row').length, 12);
  app.advance(1980); assert.equal(viewport.scrollTop, 0);
  app.advance(1020); assert.ok(Math.abs(viewport.scrollTop - 18.36) < .01, `expected about 18px per second, got ${viewport.scrollTop}`);
  const before = viewport.scrollTop; app.advance(1000); assert.ok(Math.abs(viewport.scrollTop - before - 18) < .01);
  for (let frame = 0; frame < 2000 && viewport.scrollTop < 451; frame++) app.advance(20);
  assert.equal(viewport.scrollTop, 451);
  app.advance(3980); assert.equal(viewport.scrollTop, 451);
  app.advance(20); assert.equal(viewport.scrollTop, 0);
  app.advance(1980); assert.equal(viewport.scrollTop, 0);
  app.advance(20); assert.ok(viewport.scrollTop > 0);
});
test('history that fits the panel does not scroll', async () => {
  const app = await display(); await app.window.SetRevMsg('MSG|EMP|261010');
  const viewport = app.document.getElementById('career-viewport');
  Object.defineProperties(viewport, { scrollHeight: { value: 340 }, clientHeight: { value: 365 } });
  app.advance(60000); assert.equal(viewport.scrollTop, 0);
});
test('switching employees resets scrolling; leaving employee view cancels the animation', async () => {
  const app = await display(); await app.window.SetRevMsg('MSG|EMP|261010');
  const viewport = app.document.getElementById('career-viewport');
  Object.defineProperties(viewport, { scrollHeight: { value: 816 }, clientHeight: { value: 365 } });
  app.advance(10000); assert.ok(viewport.scrollTop > 0);
  await app.window.SetRevMsg('MSG|EMP|201245'); assert.equal(viewport.scrollTop, 0); assert.equal(app.frames.size, 1);
  app.advance(1980); assert.equal(viewport.scrollTop, 0);
  await app.window.SetRevMsg('MSG|WEP|'); assert.equal(app.frames.size, 0);
  app.advance(10000); assert.equal(viewport.scrollTop, 0);
});
