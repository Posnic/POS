'use strict';

/**
 * Unit tests for src/utils/api-tokens.js (integration platform step 2).
 *
 * A token is a standing credential, so the properties under test are the
 * security ones: hashed at rest and never listed, whitelisted scopes with
 * till actions impossible, empty grants refused, revocation immediate,
 * resolution fail-closed, and the principal shaped exactly like a lean
 * user so the one authentication join point stays the only one.
 */

const tokens = require('../../../src/utils/api-tokens');

function fakeDb() {
  const rows = [];
  const matches = (row, q) =>
    Object.entries(q).every(([k, v]) => String(row[k]) === String(v));
  return {
    rows,
    collection: () => ({
      insertOne: async (doc) => {
        doc._id = 'id_' + rows.length;
        rows.push(doc);
        return { insertedId: doc._id };
      },
      findOne: async (q) => rows.find((r) => matches(r, q)) || null,
      find: () => ({
        sort: function () { return this; },
        toArray: async () => rows.slice(),
      }),
      updateOne: async (q, u) => {
        const { ObjectId } = require('mongodb');
        const row = rows.find((r) =>
          Object.entries(q).every(([k, v]) =>
            String(r[k]) === String(v instanceof ObjectId ? v : v)));
        if (row && u.$set) Object.assign(row, u.$set);
        return { matchedCount: row ? 1 : 0 };
      },
    }),
  };
}

const CREATOR = { _id: 'admin1', license: 'lic1', branch_access: [{ branch_id: 'b1' }] };

describe('sanitizeScopes', () => {
  test('whitelists modules and perms; pos can never be granted', () => {
    const out = tokens.sanitizeScopes({
      sales: { read: true, write: true, delete: 'yes' },
      pos: { void_sale: true },
      nonsense: { read: true },
      item: { read: true },
    });
    expect(out.sales).toEqual({ read: true, write: true, delete: false });
    expect(out.item).toEqual({ read: true, write: false, delete: false });
    expect(out.pos).toBeUndefined();
    expect(out.nonsense).toBeUndefined();
  });

  test('a grantless scope set is refused', () => {
    expect(tokens.sanitizeScopes({ sales: { read: false } })).toBe(null);
    expect(tokens.sanitizeScopes({})).toBe(null);
    expect(tokens.sanitizeScopes(null)).toBe(null);
  });
});

describe('createToken / listTokens', () => {
  test('plaintext returned once, only the hash stored, list never exposes it', async () => {
    const db = fakeDb();
    const r = await tokens.createToken(db, {
      name: 'Accounting sync', scopes: { sales: { read: true } }, creator: CREATOR,
    });
    expect(r.ok).toBe(true);
    expect(r.token.startsWith('posnic_')).toBe(true);
    expect(db.rows[0].token_hash).toBe(tokens.hashToken(r.token));
    expect(db.rows[0].token).toBeUndefined();
    expect(db.rows[0].license).toBe('lic1');
    expect(db.rows[0].usertype).toBe('api');
  });

  test('no shop context refuses the mint', async () => {
    const db = fakeDb();
    const r = await tokens.createToken(db, {
      name: 'x', scopes: { sales: { read: true } }, creator: { _id: 'a' },
    });
    expect(r.ok).toBe(false);
  });
});

describe('resolveScopedToken', () => {
  test('a valid token resolves to a lean-user-shaped principal with ONLY its scopes', async () => {
    const db = fakeDb();
    const minted = await tokens.createToken(db, {
      name: 'Sync', scopes: { sales: { read: true }, item: { read: true, write: true } }, creator: CREATOR,
    });
    const principal = await tokens.resolveScopedToken(db, minted.token);
    expect(principal).not.toBe(null);
    expect(principal.usertype).toBe('api');
    expect(principal.api_token).toBe(true);
    expect(principal.license).toBe('lic1');
    expect(principal.branch_access).toEqual([{ branch_id: 'b1' }]);
    expect(principal.access.item.write).toBe(true);
    expect(principal.access.sales.write).toBe(false);
    expect(principal.access.pos).toBeUndefined();
  });

  test('wrong token, wrong prefix, and revoked all fail closed', async () => {
    const db = fakeDb();
    const minted = await tokens.createToken(db, {
      name: 'Sync', scopes: { sales: { read: true } }, creator: CREATOR,
    });
    expect(await tokens.resolveScopedToken(db, 'posnic_' + 'f'.repeat(48))).toBe(null);
    expect(await tokens.resolveScopedToken(db, 'not-a-token')).toBe(null);

    db.rows[0].active = false;
    expect(await tokens.resolveScopedToken(db, minted.token)).toBe(null);
  });

  test('resolution stamps last_used_at, throttled', async () => {
    const db = fakeDb();
    const minted = await tokens.createToken(db, {
      name: 'Sync', scopes: { sales: { read: true } }, creator: CREATOR,
    });
    await tokens.resolveScopedToken(db, minted.token);
    await new Promise((r) => setTimeout(r, 10));
    expect(db.rows[0].last_used_at).not.toBe(null);
  });
});
