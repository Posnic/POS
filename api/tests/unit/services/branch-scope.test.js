'use strict';

/*
 * Branch visibility (S7 / D5).
 *
 * Both relations are honoured: `branch_access[]`, which is where customers are
 * going, and the legacy `branch_id`, which is where most rows still are. A
 * read that dropped the legacy field would make every un-backfilled customer
 * vanish from the branch that owns them.
 *
 * The assertion that earns its keep is the $and one. The customer search
 * already owns a top-level $or for name/email/phone; adding a second $or would
 * REPLACE those terms instead of narrowing them, and a search that loses its
 * terms does not fail loudly - it quietly returns every customer in the shop.
 */

const { ObjectId } = require('mongodb');
const { branchScopeClause, withBranchScope } = require('../../../src/services/branch-scope');

const BRANCH = '64b000000000000000000001';

describe('branch scope clause', () => {
  test('it matches the new relation and the legacy field', () => {
    const c = branchScopeClause(BRANCH);
    const paths = c.$or.map((o) => Object.keys(o)[0]);
    expect(paths).toEqual(['branch_access.branch_id', 'branch_id']);
  });

  test('a string id is cast, so it matches stored ObjectIds', () => {
    const c = branchScopeClause(BRANCH);
    expect(c.$or[1].branch_id).toBeInstanceOf(ObjectId);
    expect(String(c.$or[1].branch_id)).toBe(BRANCH);
  });

  test('an ObjectId is passed through unchanged', () => {
    const oid = new ObjectId(BRANCH);
    expect(branchScopeClause(oid).$or[1].branch_id).toBe(oid);
  });

  test('junk that cannot be cast is used as-is rather than throwing', () => {
    expect(() => branchScopeClause('not-an-id')).not.toThrow();
  });
});

describe('merging the scope into a filter', () => {
  test('an existing top-level $or SURVIVES - this is the whole point', () => {
    const search = {
      license: 'L',
      $or: [{ name: /ali/i }, { phone: /ali/i }],
    };
    const q = withBranchScope(search, BRANCH);

    // the caller's terms are untouched...
    expect(q.$or).toHaveLength(2);
    expect(q.$or[0]).toEqual({ name: /ali/i });
    // ...and the scope rides under $and, so both must match
    expect(q.$and).toHaveLength(1);
    expect(q.$and[0].$or.map((o) => Object.keys(o)[0])).toEqual([
      'branch_access.branch_id',
      'branch_id',
    ]);
  });

  test('an existing $and is kept, not replaced', () => {
    const q = withBranchScope({ $and: [{ a: 1 }] }, BRANCH);
    expect(q.$and).toHaveLength(2);
    expect(q.$and[0]).toEqual({ a: 1 });
  });

  test('no branch means no scoping at all', () => {
    expect(withBranchScope({ a: 1 }, null)).toEqual({ a: 1 });
    expect(withBranchScope({ a: 1 })).toEqual({ a: 1 });
  });

  test('the caller filter is not mutated', () => {
    const original = { license: 'L', $or: [{ name: /a/ }] };
    withBranchScope(original, BRANCH);
    expect(original.$and).toBeUndefined();
    expect(original.$or).toHaveLength(1);
  });

  test('everything else on the filter is carried through', () => {
    const q = withBranchScope({ license: 'L', is_deleted: { $ne: true } }, BRANCH);
    expect(q.license).toBe('L');
    expect(q.is_deleted).toEqual({ $ne: true });
  });
});
