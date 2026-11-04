const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
test('all employees have 12 history rows, preserving existing history without visible test labels', () => {
  const employees = read('data/employees.json'), originals = read('tests/fixtures/employee-histories.original.json');
  assert.equal(employees.length, 120);
  for (const employee of employees) {
    const original = originals.find(item => item.id === employee.id);
    assert.ok(original, employee.id); assert.equal(employee.history.length, 12, employee.id);
    assert.deepEqual(employee.history.slice(0, original.history.length), original.history);
    for (const entry of employee.history.slice(original.history.length)) {
      assert.equal(entry.isTestData, true); assert.doesNotMatch(entry.dept, /테스트/); assert.match(entry.date, /^\d{4}\.\d{2} ~ \d{4}\.\d{2}$/);
    }
    const starts = employee.history.map(entry => entry.date.slice(0, 7));
    assert.deepEqual(starts, [...starts].sort().reverse(), employee.id);
  }
});
test('dtaq and dtaq_led use the same expanded employee history', () => {
  assert.deepEqual(read('data/employees.json'), read('../dtaq/data/employees.json'));
});
