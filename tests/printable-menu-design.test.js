'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize } = require('../api/src/helpers/printable-menu-design');
test('a new menu is printable and an empty selection stays empty after save', () => {
  const defaults = normalize();
  assert.equal(defaults.size, 'a4');
  assert.equal(defaults.categories, null);
  assert.deepEqual(normalize({ categories: [] }).categories, []);
  assert.deepEqual(normalize({ categories: ['a', 'a', 'b'] }).categories, ['a', 'b']);
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(defaults))), defaults);
});
test('backgrounds cannot load remote content or active SVG from saved settings', () => {
  for (const background of ['https://example.com/a.png', 'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2Zz4=', 'data:text/html;base64,AA==']) {
    assert.throws(() => normalize({ background }), /background/);
  }
  assert.throws(() => normalize({ background: 'x'.repeat(1400001) }), /too long/);
  assert.equal(normalize({ background: 'data:image/png;base64,AA==' }).background, 'data:image/png;base64,AA==');
});
test('saved settings cannot inject CSS or unbounded layout values', () => {
  const v = normalize({ accent: 'red;background:url(x)', fontSize: 99999, columns: -4,
    size: '__proto__', opacity: 20, pattern: '<script>', font: 'url(x)' });
  assert.equal(v.accent, '#155e63'); assert.equal(v.fontSize, 16);
  assert.equal(v.size, 'a4'); assert.equal(v.opacity, 0.5);
  assert.equal(v.pattern, 'plain'); assert.equal(v.font, 'serif');
  assert.throws(() => normalize({ footer: 'x'.repeat(301) }), /too long/);
  assert.throws(() => normalize({ categories: [ { $ne: null } ] }), /categories/);
});
