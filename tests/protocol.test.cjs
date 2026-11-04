const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalize } = require('../include/js/protocol.js');
test('MSG strings map to the supported screens and IDs', () => {
  for (const [message, type, id] of [
    ['MSG|ROLLING', 'rolling', ''], ['MSG|WELCOME', 'welcome', ''],
    ['MSG|EMP|261010', 'employee', '261010'], ['MSG|WEP|weapon-02', 'weapon', 'weapon-02'],
    ['MSG|EMP|', 'employee', ''], ['MSG|WEP|', 'weapon', ''],
    ['MSG|EMP', 'employee', ''], ['MSG|WEP', 'weapon', ''],
    ['MSG|WEP|PRJ-2026-001', 'project', 'PRJ-2026-001'], [' MSG|EMP| 261010 \r\n', 'employee', '261010']
  ]) assert.deepEqual(normalize(message), { type, id }, message);
});
test('only valid MSG strings are accepted', () => {
  for (const input of [null, {}, [], 261010, { type: 'employee', id: '261010' }, '{"type":"welcome"}',
    'SHOW_LED^261010', 'MSG|ERLCOME', 'MSG|', 'MSG|ROLLING|261010', 'MSG|WELCOME|',
    'MSG|EMP|1|2', 'MSG|WEP|weapon\n02', 'MSG|UNKNOWN', 'MSG|EMP|a\0b']) assert.equal(normalize(input), null);
});
