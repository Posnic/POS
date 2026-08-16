'use strict';

const { resolveAccess } = require('../../../src/utils/access-resolver');

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
