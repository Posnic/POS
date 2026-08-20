'use strict';

const { ObjectId } = require('mongodb');

/*
 * Which records a branch can see (S7 / D5).
 *
 * `branch_access[]` is the account-level relation items already use;
 * `branch_id` is the older single-branch field. Both are honoured, because a
 * row the backfill has not reached yet still carries only the legacy field,
 * and a read that ignored it would make existing customers vanish from the
 * branch that owns them.
 *
 * This changes nothing on its own. Access lists only the owning branch until
 * someone deliberately grants another, so the two clauses currently select the
 * same rows - which is exactly the property that makes this safe to ship
 * before any data moves.
 */

const asId = (v) => {
  if (v instanceof ObjectId) return v;
  try {
    return new ObjectId(String(v));
  } catch (e) {
    return v;
  }
};

/* The clause on its own, for callers building their own $and. */
const branchScopeClause = (branchId) => {
  const b = asId(branchId);
  return { $or: [{ 'branch_access.branch_id': b }, { branch_id: b }] };
};

/*
 * Merge the scope into an existing filter.
 *
 * It goes under $and, never as a second top-level $or. A caller may already
 * own the top-level $or - the customer search does, for name/email/phone - and
 * assigning another would REPLACE those terms rather than add to them, turning
 * a search into a full-table read. Any $and the caller already has is kept.
 */
const withBranchScope = (query = {}, branchId) => {
  if (!branchId) return query;
  const existing = Array.isArray(query.$and) ? query.$and : [];
  const rest = { ...query };
  delete rest.$and;
  return { ...rest, $and: [...existing, branchScopeClause(branchId)] };
};

module.exports = { branchScopeClause, withBranchScope };
