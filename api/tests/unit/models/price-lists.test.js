'use strict';

/**
 * Price list validation (variant roadmap V4, normalizePriceList).
 *
 * What must hold: a list is keyed to a customer category; it needs a
 * percentage or at least one item price to exist; percent stays below 100
 * (negative = markup, allowed); overrides dedupe by item and refuse
 * negative or non-numeric prices silently rather than storing garbage.
 */

const SettingModel = require('../../../src/models/setting.model');
const norm = SettingModel.normalizePriceList;

describe('normalizePriceList', () => {
  test('a percentage list passes; overrides win when both exist', () => {
    const r = norm({
      customer_category_id: 'C1',
      customer_category_name: 'Wholesale',
      percent_off: '10',
      item_overrides: [{ item_id: 'I1', item_name: 'Rice', price: '95.5' }],
    });
    expect(r.error).toBeUndefined();
    expect(r.value.percent_off).toBe(10);
    expect(r.value.item_overrides).toEqual([{ item_id: 'I1', item_name: 'Rice', price: 95.5 }]);
  });

  test('no category, empty list, absurd percent - each refuses', () => {
    expect(norm({ percent_off: 10 }).error).toBeTruthy();
    expect(norm({ customer_category_id: 'C1' }).error).toBeTruthy();
    expect(norm({ customer_category_id: 'C1', percent_off: 100 }).error).toBeTruthy();
  });

  test('negative percent is a markup and is allowed', () => {
    expect(norm({ customer_category_id: 'C1', percent_off: -15 }).value.percent_off).toBe(-15);
  });

  test('override hygiene: dupes collapse, garbage prices drop', () => {
    const r = norm({
      customer_category_id: 'C1',
      percent_off: 5,
      item_overrides: [
        { item_id: 'I1', price: 10 },
        { item_id: 'I1', price: 20 },
        { item_id: 'I2', price: -5 },
        { item_id: 'I3', price: 'abc' },
      ],
    });
    expect(r.value.item_overrides).toEqual([{ item_id: 'I1', item_name: '', price: 10 }]);
  });
});
