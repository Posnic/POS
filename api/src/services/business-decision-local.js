'use strict';
const pending = new WeakMap();
function ensureLocalDecisionIndexes(db) {
  if (!pending.has(db)) {
    const local = db.collection('business_decision_local');
    pending.set(
      db,
      Promise.all([
        local.createIndex(
          { kind: 1, action: 1, deviceId: 1, 'body.branchId': 1, 'body.requesterId': 1, _id: 1 },
          { name: 'business_decision_recovery_lookup' }
        ),
        local.createIndex(
          {
            kind: 1,
            action: 1,
            deviceId: 1,
            'body.branchId': 1,
            'body.requesterId': 1,
            'body.request.operationId': 1,
            createdAt: -1,
          },
          { name: 'business_decision_create_lookup' }
        ),
        local.createIndex(
          { kind: 1, action: 1, 'body.requestId': 1, 'body.branchId': 1, 'body.requesterId': 1 },
          { name: 'business_decision_claim_lookup' }
        ),
      ]).catch((error) => {
        pending.delete(db);
        throw error;
      })
    );
  }
  return pending.get(db);
}
module.exports = { ensureLocalDecisionIndexes };
