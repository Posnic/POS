'use strict';

const {
  resolveAccess,
  mergeAccess,
  sanitizePosInput,
} = require('../../../src/utils/access-resolver');
const { POS_PERMISSIONS } = require('../../../src/constants/roles.constants');

describe('resolveAccess', () => {
  test('returns {} for a null/undefined user', () => {
    expect(resolveAccess(null)).toEqual({});
    expect(resolveAccess(undefined)).toEqual({});
  });

  test('returns the user.access object as-is', () => {
    const access = { sales: { read: true, write: false } };
    expect(resolveAccess({ access })).toBe(access);
  });

  test('falls back to _doc.access (Mongoose-style docs)', () => {
    const access = { item: { read: true } };
    expect(resolveAccess({ _doc: { access } })).toBe(access);
  });

  test('returns {} when the user has no access at all', () => {
    expect(resolveAccess({ name: 'x' })).toEqual({});
  });
});

describe('mergeAccess (role access + per-user overrides)', () => {
  test('returns the role access when there are no overrides', () => {
    const base = { sales: { read: true, write: true, delete: false } };
    expect(mergeAccess(base, undefined)).toEqual(base);
    expect(mergeAccess(base, {})).toEqual(base);
  });

  test('an override leaf wins over the role leaf', () => {
    const base = { sales: { read: true, write: true, delete: false } };
    const over = { sales: { delete: true } };
    expect(mergeAccess(base, over)).toEqual({ sales: { read: true, write: true, delete: true } });
  });

  test('adds a module present only in the overrides', () => {
    const base = { sales: { read: true } };
    const over = { report: { read: true } };
    expect(mergeAccess(base, over)).toEqual({ sales: { read: true }, report: { read: true } });
  });

  test('does not mutate its inputs', () => {
    const base = { sales: { read: true } };
    const over = { sales: { write: true } };
    const baseCopy = JSON.parse(JSON.stringify(base));
    mergeAccess(base, over);
    expect(base).toEqual(baseCopy);
  });

  test('handles null / non-object leaves gracefully', () => {
    expect(mergeAccess(null, null)).toEqual({});
    expect(mergeAccess({ a: 'x' }, { a: 'y' })).toEqual({ a: {} });
  });
});

describe('sanitizePosInput', () => {
  const ACTIONS = Object.values(POS_PERMISSIONS);

  test('produces a complete matrix with every action key present', () => {
    const out = sanitizePosInput({});
    ACTIONS.forEach((k) => expect(out[k]).toBe(false));
    expect(out.discount_max_percent).toBe(0);
    expect(out.refund_max_amount).toBe(0);
  });

  test('accepts true and the string "true" only', () => {
    const out = sanitizePosInput({
      void_sale: true,
      refund: 'true',
      discount_apply: 1,
      void_line: 'yes',
    });
    expect(out.void_sale).toBe(true);
    expect(out.refund).toBe(true);
    expect(out.discount_apply).toBe(false);
    expect(out.void_line).toBe(false);
  });

  test('drops unknown keys (no prototype pollution / stray fields)', () => {
    const out = sanitizePosInput({ void_sale: true, evil_flag: true, admin: true });
    expect(out.evil_flag).toBeUndefined();
    expect(out.admin).toBeUndefined();
  });

  test('clamps the numeric caps to non-negative numbers', () => {
    expect(sanitizePosInput({ discount_max_percent: 20 }).discount_max_percent).toBe(20);
    expect(sanitizePosInput({ discount_max_percent: '15' }).discount_max_percent).toBe(15);
    expect(sanitizePosInput({ discount_max_percent: -5 }).discount_max_percent).toBe(0);
    expect(sanitizePosInput({ refund_max_amount: 'abc' }).refund_max_amount).toBe(0);
  });

  test('tolerates null / non-object input', () => {
    expect(sanitizePosInput(null).void_sale).toBe(false);
    expect(sanitizePosInput('x').refund).toBe(false);
  });
});
