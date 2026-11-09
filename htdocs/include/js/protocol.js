(function (root) {
  'use strict';
  function normalize(input) {
    if (typeof input !== 'string') return null;
    const parts = input.trim().split('|');
    if (parts[0] !== 'MSG' || parts.some(part => /[\x00-\x1f]/.test(part))) return null;
    if (parts.length === 2 && ['ROLLING', 'WELCOME'].includes(parts[1])) return { type: parts[1].toLowerCase(), id: '' };
    if ((parts.length === 2 || parts.length === 3) && ['EMP', 'WEP'].includes(parts[1])) {
      const id = (parts[2] || '').trim();
      return { type: parts[1] === 'EMP' ? 'employee' : /^PRJ-/i.test(id) ? 'project' : 'weapon', id };
    }
    return null;
  }
  const api = Object.freeze({ normalize });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LedProtocol = api;
})(typeof window !== 'undefined' ? window : globalThis);
