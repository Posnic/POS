'use strict';
const enabled = (branch) => branch?.captain_table_cleaning === true;
const state = (row, branch) =>
  row.service_state === 'cleaning' && !enabled(branch)
    ? 'available'
    : row.service_state || 'available';
async function active(db, scope) {
  const branch =
    scope.branch ||
    (await db.collection('branches').findOne({ _id: scope.branchId, license: scope.license }));
  return enabled(branch);
}
module.exports = { enabled, state, active };
