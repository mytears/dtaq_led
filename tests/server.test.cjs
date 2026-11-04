const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createLedServer } = require('../server.cjs');
let server, base;
before(async () => { server = createLedServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
test('preview serves HTML, fonts, employee JSON, and the sibling kiosk', async () => {
  for (const path of ['/', '/include/css/led.css', '/include/css/fonts/SCDream6.otf', '/data/employees.json', '/dtaq/', '/dtaq/include/js/led-bridge.js']) {
    const response = await fetch(base + path); assert.equal(response.status, 200, path); await response.arrayBuffer();
  }
});
test('media discovery includes promotional files and excludes welcome backgrounds', async () => {
  const items = await (await fetch(base + '/api/media')).json();
  assert.ok(items.some(item => item.src.endsWith('MAIN000070.mp4') && item.type === 'video'));
  assert.ok(items.some(item => item.type === 'image'));
  assert.ok(items.every(item => !item.src.includes('bg_welcome')));
});
test('preview supports video byte ranges and rejects invalid ranges', async () => {
  const path = base + '/commonfiles/MAIN000070.mp4';
  const response = await fetch(path, { headers: { Range: 'bytes=0-1023' } });
  assert.equal(response.status, 206); assert.equal((await response.arrayBuffer()).byteLength, 1024);
  assert.match(response.headers.get('content-range'), /^bytes 0-1023\/\d+$/);
  const suffix = await fetch(path, { headers: { Range: 'bytes=-16' } }); assert.equal((await suffix.arrayBuffer()).byteLength, 16);
  for (const range of ['bytes=999999999-', 'bytes=20-10', 'bytes=-', 'invalid']) assert.equal((await fetch(path, { headers: { Range: range } })).status, 416);
});
test('preview only serves assets and provides no HTTP message receiver', async () => {
  for (const path of ['/msg', '/api/command', '/api/events', '/api/health']) {
    assert.equal((await fetch(base + path)).status, 404, path);
    assert.equal((await fetch(base + path, { method: 'POST', body: 'MSG|ROLLING' })).status, 405, path);
  }
});
test('preview does not expose server source or Git metadata', async () => {
  for (const path of ['/server.cjs', '/.git/config', '/images/%2e%2e%5cserver.cjs', '/README.md']) assert.ok([403, 404].includes((await fetch(base + path)).status), path);
});
