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
const testQuotePolicy = { source: 'custom', order: 'fixed', selectedNumber: 2, quotes: ['First', 'Second'] };
test('fixed quote numbers select custom entries or Kurals and preserve saved receipts', () => {
  assert.equal(select(testQuotePolicy, 'S1').text, 'Second');
  assert.equal(select(testQuotePolicy, 'S99').text, 'Second');
  const saved = select(testQuotePolicy, 'S1');
  assert.deepEqual(select({ ...testQuotePolicy, selectedNumber: 1 }, 'S1', saved), saved);
  for (const selectedNumber of [0, -1, 3, 1.5, '2']) assert.equal(select({ ...testQuotePolicy, selectedNumber }, 'S1'), null);
  for (const selectedNumber of [1, 51, 1330]) {
    const q = select({ source: 'thirukkural', order: 'fixed', selectedNumber, showQr: true }, 'S99');
    assert.equal(q.number, selectedNumber);
    assert.equal(q.text, verses[selectedNumber - 1].lines.join('\n'));
    assert.equal(q.url, 'https://www.posnic.com/tools/thirukural/' + selectedNumber);
  }
});
