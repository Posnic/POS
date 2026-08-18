'use strict';

/**
 * Modifier group validation (variant roadmap V2, normalizeModifierGroup).
 *
 * What must hold: a group is a name plus at least one option; min/max are
 * sane (0 = no upper limit, max never below min, min never above the
 * option count); duplicate option names refuse; price deltas coerce to
 * finite numbers with 0 as the fallback - a modifier may be free, and a
 * garbage delta must never become NaN inside a line total.
 */

const SettingModel = require('../../../src/models/setting.model');
const norm = SettingModel.normalizeModifierGroup;

const opts = (...names) => names.map((name) => ({ name, price_delta: 10 }));

describe('normalizeModifierGroup', () => {
  test('a well-formed group passes through with numbers coerced', () => {
    const r = norm({
      name: ' Toppings ',
      min: '0',
      max: '3',
      options: [
        { name: 'Cheese', price_delta: '30' },
        { name: 'Olives', price_delta: 0 },
      ],
    });
    expect(r.error).toBeUndefined();
    expect(r.value).toEqual({
      name: 'Toppings',
      min: 0,
      max: 3,
      options: [
        { name: 'Cheese', price_delta: 30 },
        { name: 'Olives', price_delta: 0 },
      ],
    });
  });

  test('no name, no options, dup options - each refuses with a reason', () => {
    expect(norm({ options: opts('A') }).error).toBeTruthy();
    expect(norm({ name: 'Spice', options: [] }).error).toBeTruthy();
    expect(norm({ name: 'Spice', options: opts('Hot', 'hot') }).error).toBeTruthy();
  });

  test('min/max rules: max 0 is unlimited, max below min refuses, min above option count refuses', () => {
    expect(norm({ name: 'S', min: 2, max: 0, options: opts('A', 'B', 'C') }).error).toBeUndefined();
    expect(norm({ name: 'S', min: 2, max: 1, options: opts('A', 'B') }).error).toBeTruthy();
    expect(norm({ name: 'S', min: 3, max: 3, options: opts('A', 'B') }).error).toBeTruthy();
  });

  test('garbage deltas become 0, never NaN', () => {
    const r = norm({ name: 'S', options: [{ name: 'A', price_delta: 'abc' }] });
    expect(r.value.options[0].price_delta).toBe(0);
  });

  test('negative deltas are allowed - "no cheese -10" is a real menu', () => {
    const r = norm({ name: 'S', options: [{ name: 'No cheese', price_delta: -10 }] });
    expect(r.value.options[0].price_delta).toBe(-10);
  });
});
