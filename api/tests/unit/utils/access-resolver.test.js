'use strict';

const { resolveAccess, mergeAccess } = require('../../../src/utils/access-resolver');

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
