'use strict';

/*
 * GST 2.0 readiness scan.
 *
 * The thing worth pinning hardest is a NEGATIVE: the bundled HSN reference
 * predates Notification 9/2025 and still lists codes at 12% and 28%. If the
 * scan ever started trusting those rows it would tell shops to move
 * correctly-set items back onto slabs the government withdrew - a
 * compliance feature actively causing the problem it exists to find.
 */

const {
  scanItems,
  referenceRateFor,
  RETIRED_SLABS,
  LIVE_SLABS,
} = require('../../../src/services/gst-readiness');

const item = (over = {}) => ({
  _id: 'i1',
  item_name: 'Thing',
  tax: 18,
  hsncode: '',
  ...over,
});

describe('GST 2.0 readiness scan', () => {
  test('an item sitting on a withdrawn slab is reported without needing any reference', () => {
    const r = scanItems([item({ tax: 28, hsncode: '' }), item({ _id: 'i2', tax: 12 })]);
    expect(r.retired.map((x) => x.rate).sort()).toEqual([12, 28]);
    expect(r.retired[0].reason).toMatch(/withdrawn/i);
    // no HSN code on either item, yet both are still found
    expect(r.retired.every((x) => x.hsncode === '')).toBe(true);
  });

  test('a live slab is never called retired', () => {
    const r = scanItems(LIVE_SLABS.map((rate, i) => item({ _id: 'i' + i, tax: rate })));
    expect(r.retired).toEqual([]);
  });

  test('the scan stays silent where the reference itself names a dead slab', () => {
    // This is the whole point. Find a real code the bundled file rates at
    // 28% - stale by definition - and confirm an 18% item is NOT flagged.
    const stale = ['8703', '8711', '2402', '2403'].find((c) => {
      const ref = referenceRateFor(c);
      return ref && RETIRED_SLABS.includes(ref.rate);
    });
    expect(typeof stale).toBe('string'); // the premise itself must hold

    const r = scanItems([item({ tax: 18, hsncode: stale })]);
    expect(r.differs).toEqual([]);
    expect(r.retired).toEqual([]);
  });

  test('a disagreement with a still-live reference rate is reported', () => {
    const live = ['0101', '1006', '8517'].find((c) => {
      const ref = referenceRateFor(c);
      return ref && LIVE_SLABS.includes(ref.rate);
    });
    expect(typeof live).toBe('string');
    const refRate = referenceRateFor(live).rate;
    const wrong = refRate === 18 ? 5 : 18;

    const r = scanItems([item({ tax: wrong, hsncode: live })]);
    expect(r.differs).toHaveLength(1);
    expect(r.differs[0].reference_rate).toBe(refRate);
    expect(r.differs[0].rate).toBe(wrong);
  });

  test('an item that agrees with the reference is not reported at all', () => {
    const live = ['0101', '1006', '8517'].find((c) => {
      const ref = referenceRateFor(c);
      return ref && LIVE_SLABS.includes(ref.rate);
    });
    const refRate = referenceRateFor(live).rate;
    const r = scanItems([item({ tax: refRate, hsncode: live })]);
    expect(r.differs).toEqual([]);
  });

  test('a retired-slab item is listed once, not in both halves', () => {
    const live = ['0101', '1006', '8517'].find((c) => {
      const ref = referenceRateFor(c);
      return ref && LIVE_SLABS.includes(ref.rate);
    });
    const r = scanItems([item({ tax: 28, hsncode: live })]);
    expect(r.retired).toHaveLength(1);
    expect(r.differs).toEqual([]);
  });

  test('codes shorter than four digits are too broad to suggest a rate from', () => {
    expect(referenceRateFor('85')).toBeNull();
    expect(referenceRateFor('8')).toBeNull();
    expect(referenceRateFor('')).toBeNull();
  });

  test('a shop that types only the 4-digit heading still gets its rate when children agree', () => {
    const json = require('../../../src/json/hsn.json').hsn || [];
    const byHeading = new Map();
    for (const row of json) {
      const code = String((row && row.value) || '').replace(/\D/g, '');
      const raw = String((row && row.taxrate) || '')
        .replace('%', '')
        .trim();
      if (code.length < 4 || !/^\d+(\.\d+)?$/.test(raw)) continue;
      const k = code.slice(0, 4);
      if (!byHeading.has(k)) byHeading.set(k, new Set());
      byHeading.get(k).add(Number(raw));
    }
    const agreed = [...byHeading.entries()].find(([, rates]) => rates.size === 1);
    expect(agreed).toBeDefined();

    const hit = referenceRateFor(agreed[0]);
    expect(hit).not.toBeNull();
    expect(hit.rate).toBe(agreed[1].values().next().value);
    expect(hit.matchedOn).toBe(agreed[0]);
  });

  test('an exact 8-digit code beats the heading it belongs to', () => {
    const json = require('../../../src/json/hsn.json').hsn || [];
    const row = json.find((r) => {
      const code = String((r && r.value) || '').replace(/\D/g, '');
      const raw = String((r && r.taxrate) || '')
        .replace('%', '')
        .trim();
      return code.length === 8 && /^\d+(\.\d+)?$/.test(raw);
    });
    const code = String(row.value).replace(/\D/g, '');
    const hit = referenceRateFor(code);
    expect(hit.matchedOn).toBe(code); // longest match, not the 4-digit parent
  });

  test('junk input is skipped rather than throwing', () => {
    const r = scanItems([null, undefined, 'nope', item({ tax: 'abc', hsncode: '!!!' })]);
    expect(r.retired).toEqual([]);
    expect(r.differs).toEqual([]);
    // only the real item counts - null, undefined and the bare string are
    // not item documents and are skipped before examination
    expect(r.examined).toBe(1);
  });

  test('a heading whose children disagree yields no suggestion at all', () => {
    // Derived parents are only kept when every child agrees; a mixed
    // heading must be absent rather than resolved to one of its rates.
    const { referenceRateFor: ref } = require('../../../src/services/gst-readiness');
    const json = require('../../../src/json/hsn.json').hsn || [];
    const byHeading = new Map();
    for (const row of json) {
      const code = String((row && row.value) || '').replace(/\D/g, '');
      const raw = String((row && row.taxrate) || '')
        .replace('%', '')
        .trim();
      if (code.length < 4 || !/^\d+(\.\d+)?$/.test(raw)) continue;
      const k = code.slice(0, 4);
      if (!byHeading.has(k)) byHeading.set(k, new Set());
      byHeading.get(k).add(Number(raw));
    }
    const mixed = [...byHeading.entries()].find(([, rates]) => rates.size > 1);
    expect(mixed).toBeDefined(); // the premise: such headings exist
    expect(ref(mixed[0])).toBeNull();
  });

  test('the result carries a notice that the reference is dated', () => {
    const r = scanItems([]);
    expect(r.notice).toMatch(/predates GST 2\.0/);
    expect(r.notice).toMatch(/9\/2025/);
    expect(r.notice).toMatch(/Nothing here changes a tax by itself/);
  });
});
