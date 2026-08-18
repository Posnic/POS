'use strict';

/**
 * /api/v1 contract (INTEGRATIONS_ROADMAP I4).
 *
 * The whole point of v1 is that its shapes hold while legacy refactors -
 * so the shapes are what these tests pin: the envelope, the cursor
 * round-trip, ACL refusal, tenant scoping, the rate window, and the
 * entity->collection->acl map itself.
 */

const v1 = require('../../../src/v1');

describe('entity map', () => {
  test('exposes exactly the seven read collections, each with an acl module', () => {
    expect(Object.keys(v1.ENTITIES).sort()).toEqual([
      'categories',
      'customers',
      'expenses',
      'items',
      'receivings',
      'sales',
      'suppliers',
    ]);
    for (const def of Object.values(v1.ENTITIES)) {
      expect(typeof def.collection).toBe('string');
      expect(typeof def.acl).toBe('string');
    }
  });
  test('never exposes users, settings, branches or plan surfaces', () => {
    for (const k of ['users', 'settings', 'branches', 'plan', 'registers']) {
      expect(v1.ENTITIES[k]).toBeUndefined();
    }
  });
});

describe('acl', () => {
  test('read requires the exact module read grant', () => {
    expect(v1.canRead({ access: { sales: { read: true } } }, 'sales')).toBe(true);
    expect(v1.canRead({ access: { sales: { write: true } } }, 'sales')).toBe(false);
    expect(v1.canRead({ access: {} }, 'sales')).toBe(false);
    expect(v1.canRead(null, 'sales')).toBe(false);
  });
});

describe('cursor', () => {
  test('round-trips date and id', () => {
    const doc = { _id: 'abc123', updated_date: new Date('2026-08-18T10:00:00.000Z') };
    const c = v1.decodeCursor(v1.encodeCursor(doc));
    expect(c.ts.toISOString()).toBe('2026-08-18T10:00:00.000Z');
    expect(c.id).toBe('abc123');
  });
  test('garbage cursors decode to null, never throw', () => {
    expect(v1.decodeCursor('not-a-cursor')).toBe(null);
    expect(v1.decodeCursor('')).toBe(null);
    expect(v1.decodeCursor(null)).toBe(null);
    expect(v1.decodeCursor(Buffer.from('no-pipe-here').toString('base64url'))).toBe(null);
  });
});

describe('list query', () => {
  test('scopes by license, branch access and cursor together', () => {
    const user = { license: 'L1', branch_access: [{ branch_id: 'B1' }] };
    const cursor = { ts: new Date('2026-08-18T10:00:00Z'), id: 'x' };
    const q = v1.buildListQuery(user, cursor);
    expect(q.$and).toHaveLength(3);
    expect(q.$and[0]).toEqual({ license: 'L1' });
    expect(q.$and[1].$or[2].branch_id.$in).toContain('B1');
    expect(q.$and[2].$or[0].updated_date.$gt).toEqual(cursor.ts);
  });
  test('unrestricted user gets license scope only', () => {
    const q = v1.buildListQuery({ license: 'L1', branch_access: [] }, null);
    expect(q).toEqual({ $and: [{ license: 'L1' }] });
  });
});

describe('envelope', () => {
  const doc = (id) => ({ _id: id, updated_date: new Date('2026-08-18T10:00:00Z') });
  test('under the limit: no next cursor', () => {
    const e = v1.envelope([doc('a'), doc('b')], 50);
    expect(e.data).toHaveLength(2);
    expect(e.meta).toEqual({ count: 2, next_cursor: null });
  });
  test('over the limit: page trimmed, cursor points at the last returned row', () => {
    const e = v1.envelope([doc('a'), doc('b'), doc('c')], 2);
    expect(e.data).toHaveLength(2);
    expect(v1.decodeCursor(e.meta.next_cursor).id).toBe('b');
  });
});

describe('writes (I4.5) - deliberate, per entity', () => {
  test('customers is the only writable entity in this cut', () => {
    expect(Object.keys(v1.WRITABLE)).toEqual(['customers']);
  });
  test('the whitelist never carries money or referential state', () => {
    for (const banned of [
      'balance',
      'loyalty',
      'tags',
      'category_id',
      'referrer_id',
      'license',
      'branch_id',
      '_id',
    ]) {
      expect(v1.WRITABLE.customers.fields).not.toContain(banned);
    }
  });
  test('pickWritable keeps whitelisted fields only, coerced to strings', () => {
    const out = v1.pickWritable('customers', {
      name: 'Asha',
      phone: 98400,
      balance: 9999,
      license: 'EVIL',
      _id: 'x',
      extra: 'no',
    });
    expect(out).toEqual({ name: 'Asha', phone: '98400' });
  });
  test('a customer needs a name or a phone', () => {
    expect(v1.WRITABLE.customers.required({})).toBeTruthy();
    expect(v1.WRITABLE.customers.required({ name: '  ' })).toBeTruthy();
    expect(v1.WRITABLE.customers.required({ name: 'Asha' })).toBe(null);
    expect(v1.WRITABLE.customers.required({ phone: '9' })).toBe(null);
  });
  test('write requires the write grant, not just read', () => {
    expect(v1.canWrite({ access: { customer: { read: true } } }, 'customer')).toBe(false);
    expect(v1.canWrite({ access: { customer: { write: true } } }, 'customer')).toBe(true);
  });
  test('writes land in the principal`s branch', () => {
    expect(v1.writeBranchId({ branch_id: 'B1' })).toBe('B1');
    expect(v1.writeBranchId({ branch_access: [{ branch_id: 'B2' }] })).toBe('B2');
    expect(v1.writeBranchId({})).toBe(null);
  });
});

describe('openapi spec', () => {
  test('documents exactly the entities the router serves', () => {
    const spec = v1.openapiSpec();
    expect(spec.openapi).toBe('3.0.3');
    const listed = spec.paths['/{entity}'].get.parameters[0].schema.enum;
    expect(listed.sort()).toEqual(Object.keys(v1.ENTITIES).sort());
    expect(spec.security).toEqual([{ token: [] }]);
  });
});

describe('rate window', () => {
  beforeEach(() => v1.resetRateLimits());
  test('allows the window, refuses past it, resets on the next window', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < v1.MAX_PER_WINDOW; i++) {
      expect(v1.rateLimited('tok1', t0)).toBe(false);
    }
    expect(v1.rateLimited('tok1', t0)).toBe(true);
    expect(v1.rateLimited('tok1', t0 + 61_000)).toBe(false);
    // other principals are unaffected
    expect(v1.rateLimited('tok2', t0)).toBe(false);
  });
});
