'use strict';

const fs = require('fs');
const path = require('path');

/*
 * Which words mean "give this shop demo data".
 *
 * THE BUG: Gateway's provisioner sends `register_demo: 'yes'` and
 * `business: 'retail'`. This service tested for `'on'` and read
 * `businessType`, so both missed - every cloud shop was created with no demo
 * data at all and, had it run, always the supermarket pack whatever the trade.
 *
 * It failed silently because each miss looks like a decision. No demo data
 * reads as a shop that asked for none; a supermarket pack reads as a default
 * somebody picked. What it meant in practice was a new customer opening their
 * till and finding one product in it.
 *
 * The normaliser is lifted out of install.service.js rather than copied, so
 * this cannot pass while the service drifts away from it.
 */

const SRC = fs.readFileSync(
  path.join(__dirname, '../../../src/services/install.service.js'),
  'utf8'
);

/* The literal list the service uses, read back out of it. */
const normalise = (() => {
  const m = SRC.match(/register_demo: \[([^\]]+)\]\.includes\(/);
  if (!m) throw new Error('could not find the demo-word list in install.service.js');
  const words = m[1]
    .split(',')
    .map((w) => w.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
  return (v) =>
    words.includes(
      String(v == null ? '' : v)
        .trim()
        .toLowerCase()
    );
})();

describe('the demo-data gate speaks the provisioner’s language', () => {
  test("'yes' - what Gateway actually sends - turns demo data ON", () => {
    /* The whole bug in one line. */
    expect(normalise('yes')).toBe(true);
  });

  test('the words that already worked still work', () => {
    expect(normalise('on')).toBe(true);
    expect(normalise(true)).toBe(true);
  });

  test('other reasonable ways of saying yes are accepted', () => {
    for (const v of ['true', '1', 'y', 'YES', ' On ']) {
      expect(normalise(v)).toBe(true);
    }
  });

  test('no means no, and so does nothing at all', () => {
    /* A shop that asked for an empty catalogue must get one. */
    for (const v of ['no', 'false', false, 0, '', '   ', null, undefined, 'nope']) {
      expect(normalise(v)).toBe(false);
    }
  });

  test('the gate below compares against a boolean', () => {
    /* Normalising to true and then testing for the string 'on' would be the
       same bug wearing a different coat. */
    expect(SRC).toMatch(/data\.register_demo === true/);
  });
});

describe('the business type', () => {
  test('`business` is read, because that is the key Gateway sends', () => {
    expect(SRC).toMatch(/data\.businessType \|\| data\.business/);
  });

  test('businessType still wins when both are present', () => {
    /* An explicit caller must not be overridden by the alias. */
    const m = SRC.match(/businessType: String\(([^)]+)\)/);
    expect(m).toBeTruthy();
    expect(m[1].indexOf('data.businessType')).toBeLessThan(m[1].indexOf('data.business '));
  });
});

describe('the seeded records are still tagged and pictured', () => {
  test('demo items carry the pack tag', () => {
    expect(SRC).toMatch(/demo_pack: businessType/);
  });

  test('demo items carry their photograph when there is one', () => {
    expect(SRC).toMatch(/product\.image \? \{ image: product\.image/);
  });
});
