const test = require('node:test');
const assert = require('node:assert/strict');
const { select } = require('../api/src/helpers/receipt-quote');
const verses = require('../api/src/data/thirukkural/verses.json');

test('bundled Tamil corpus has every numbered two-line couplet once', () => {
  assert.equal(verses.length, 1330);
  verses.forEach((v, i) => {
    assert.equal(v.number, i + 1);
    assert.equal(v.lines.length, 2);
    v.lines.forEach(line => assert.match(line, /[\u0B80-\u0BFF]/));
  });
});
test('quote selection defaults off, follows bill sequence and wraps', () => {
  assert.equal(select(undefined, 'S1'), null);
  const p = { source: 'thirukkural', order: 'sequential' };
  assert.equal(select(p, 'SB1D44-27-000001').number, 1);
  assert.equal(select(p, 'SB1D44-27-001330').number, 1330);
  assert.equal(select(p, 'SB1D44-27-001331').number, 1);
  assert.equal(select(p, 'pending'), null);
});
test('saved selection survives settings changes, disablement and retries', () => {
  const p = { source: 'custom', order: 'random', quotes: ['First', 'Second'] };
  const saved = select(p, 'S123');
  assert.deepEqual(select(p, 'S123'), saved);
  assert.deepEqual(select({ source: 'none' }, 'S123', saved), saved);
  assert.equal(select(p, 'S123', null), null); // old bills stay unchanged
  assert.equal(select({ ...p, order: 'sequential' }, 'S2').text, 'Second');
});
