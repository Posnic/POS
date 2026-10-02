'use strict';
const { context, allowed, fail } = require('../utils/branch-access');
async function releasedState(db, scope) {
  const branch = await db
    .collection('branches')
    .findOne({ _id: scope.branchId, license: scope.license });
  return branch?.table_cleaning_after_close === false ? 'available' : 'cleaning';
}
async function settings(req) {
  if (!allowed(req.user, 'settings')) fail('Settings permission is required.', 403);
  const c = await context(req);
  if (req.method === 'POST') {
    if (typeof req.body?.automatic !== 'boolean') fail('Choose the table cleaning behavior.');
    const result = await req.db
      .collection('branches')
      .updateOne(
        { _id: c.branchId, license: c.license },
        { $set: { table_cleaning_after_close: req.body.automatic, updated_date: new Date() } }
      );
    if (!result.matchedCount) fail('Settings changed. Refresh and try again.', 409);
    return { automatic: req.body.automatic };
  }
  return { automatic: c.branch.table_cleaning_after_close !== false };
}
module.exports = { releasedState, settings };
