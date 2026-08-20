'use strict';

/*
 * GST 2.0 readiness scan, now reading the notification itself
 * (api/src/json/gst_rates_2025.json, built from CBIC Notification
 * 9/2025-Integrated Tax (Rate)).
 *
 * Two things are worth pinning hardest, and both are about NOT saying more
 * than the document supports:
 *
 *   - 28% is NOT a withdrawn slab. It survives as Schedule VII - pan masala
 *     and tobacco, six entries. An earlier version listed it as retired,
 *     which would have told a tobacco seller their correct rate was
 *     withdrawn. 12% is the one that is genuinely gone.
 *   - a heading the dataset quarantined (goods carved out, or claimed by two
 *     schedules - a car is 18% under four metres and 40% above) must produce
 *     NO suggestion at all. Silence costs the shop nothing; a wrong rate
 *     mis-taxes a real invoice.
 */

const {
  scanItems,
  referenceRateFor,
  RETIRED_SLABS,
  LIVE_SLABS,
  RESTRICTED_SLABS,
} = require('../../../src/services/gst-readiness');

const item = (over = {}) => ({ _id: 'i1', item_name: 'Thing', tax: 18, hsncode: '', ...over });

describe('GST 2.0 readiness scan', () => {
  test('12% is retired; 28% is not', () => {
    expect(RETIRED_SLABS).toContain(12);
    expect(RETIRED_SLABS).not.toContain(28);
    expect(LIVE_SLABS).toContain(28);
    expect(RESTRICTED_SLABS[28]).toMatch(/tobacco/i);
  });

  test('an item on 12% is reported as withdrawn, needing no reference data', () => {
    const r = scanItems([item({ tax: 12, hsncode: '' })]);
    expect(r.retired).toHaveLength(1);
    expect(r.retired[0].reason).toMatch(/withdrawn/i);
  });

  test('an item on 28% is flagged as restricted, not withdrawn', () => {
    const r = scanItems([item({ tax: 28 })]);
    expect(r.retired).toHaveLength(1);
    expect(r.retired[0].restricted).toBe(true);
    expect(r.retired[0].reason).toMatch(/applies only to/i);
    expect(r.retired[0].reason).not.toMatch(/withdrawn/i);
  });

  test('the live slabs are the ones the notification actually schedules', () => {
    for (const rate of [0.25, 1.5, 3, 5, 18, 40]) {
      expect(LIVE_SLABS).toContain(rate);
    }
    const r = scanItems([5, 18, 40, 3].map((rate, i) => item({ _id: 'i' + i, tax: rate })));
    expect(r.retired).toEqual([]);
  });

  test('rates come from the notification schedules', () => {
    // spot values verified against the published schedules
    expect(referenceRateFor('0402').rate).toBe(5); // milk, Schedule I
    expect(referenceRateFor('8517').rate).toBe(18); // phones, Schedule II
    expect(referenceRateFor('7108').rate).toBe(3); // gold, Schedule IV
    expect(referenceRateFor('2402').rate).toBe(28); // cigarettes, Schedule VII
  });

  test('a heading two schedules both claim yields no suggestion', () => {
    // 8703 is 18% under four metres and 40% above - no single answer exists
    expect(referenceRateFor('8703')).toBeNull();
    const r = scanItems([item({ tax: 5, hsncode: '8703' })]);
    expect(r.differs).toEqual([]);
  });

  test('a heading whose goods are carved out yields no suggestion', () => {
    // 7102: rough diamonds 0.25%, other 7102 goods 1.50%
    expect(referenceRateFor('7102')).toBeNull();
    const r = scanItems([item({ tax: 18, hsncode: '7102' })]);
    expect(r.differs).toEqual([]);
  });

  test('a real disagreement IS reported', () => {
    const r = scanItems([item({ tax: 18, hsncode: '0402' })]);
    expect(r.differs).toHaveLength(1);
    expect(r.differs[0].reference_rate).toBe(5);
    expect(r.differs[0].rate).toBe(18);
  });

  test('an item that agrees with the notification is not reported', () => {
    const r = scanItems([item({ tax: 5, hsncode: '0402' })]);
    expect(r.differs).toEqual([]);
  });

  test('an 8-digit code falls back to its heading', () => {
    const hit = referenceRateFor('04021010');
    expect(hit).not.toBeNull();
    expect(hit.rate).toBe(5);
    expect(hit.matchedOn).toBe('0402');
  });

  test('codes shorter than four digits are too broad to rate', () => {
    expect(referenceRateFor('85')).toBeNull();
    expect(referenceRateFor('')).toBeNull();
    expect(referenceRateFor(null)).toBeNull();
  });

  test('junk input is skipped rather than throwing', () => {
    const r = scanItems([null, undefined, 'nope', item({ tax: 'abc', hsncode: '!!!' })]);
    expect(r.retired).toEqual([]);
    expect(r.differs).toEqual([]);
    expect(r.examined).toBe(1);
  });

  test('the notice names the notification and disclaims changing anything', () => {
    const r = scanItems([]);
    expect(r.notice).toMatch(/9\/2025/);
    expect(r.notice).toMatch(/nothing here changes a tax by itself/i);
  });
});

describe('the shipped rate dataset', () => {
  const data = require('../../../src/json/gst_rates_2025.json');

  test('it records where it came from, so a shop can trace any figure', () => {
    expect(data.source.notification).toMatch(/9\/2025/);
    expect(data.source.effective_from).toBe('2025-09-22');
    expect(data.source.retrieved_from).toMatch(/cbic\.gov\.in/);
  });

  test('every rate is one of the notification schedules', () => {
    const slabs = Object.values(data.source.schedules);
    const strays = [...new Set(Object.values(data.rates))].filter((r) => !slabs.includes(r));
    expect(strays).toEqual([]);
  });

  test('no code is both safe and quarantined', () => {
    const both = Object.keys(data.rates).filter((c) => data.qualified[c] !== undefined);
    expect(both).toEqual([]);
  });

  test('12% appears nowhere - that is why it counts as withdrawn', () => {
    expect(Object.values(data.rates)).not.toContain(12);
    expect(Object.values(data.qualified)).not.toContain(12);
  });
});
