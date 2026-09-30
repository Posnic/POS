'use strict';
const { ObjectId } = require('mongodb');

/** Optional attribution for legacy refunds. A supplied session must be open
 * and owned by this actor/device in the invoice branch. Payload scope is never
 * copied directly into persisted financial facts. This does not grant refunds. */
async function verifiedReturnRegister(db, { sessionId, license, branchId, actorId, deviceId, at }) {
  if (sessionId === undefined || sessionId === null || sessionId === '') return null;
  const valid = (value) => /^[a-f\d]{24}$/.test(String(value || ''));
  if (
    typeof sessionId !== 'string' ||
    ![sessionId, license, branchId, actorId].every(valid) ||
    typeof deviceId !== 'string' ||
    !deviceId ||
    deviceId.length > 128 ||
    !(at instanceof Date) ||
    !Number.isFinite(at.getTime())
  )
    throw Object.assign(new Error('Resume your register before recording this refund'), {
      status: 409,
    });
  const row = await db.collection('cashregister').findOne(
    {
      _id: new ObjectId(sessionId),
      license: new ObjectId(String(license)),
      branch_id: new ObjectId(String(branchId)),
      current_user_id: new ObjectId(String(actorId)),
      lock_device_id: deviceId,
      register_status: 'Opened',
      register_opendate: { $lte: at },
    },
    { projection: { _id: 1 }, maxTimeMS: 250 }
  );
  if (!row)
    throw Object.assign(new Error('Resume your register before recording this refund'), {
      status: 409,
    });
  return String(row._id);
}
module.exports = { verifiedReturnRegister };
