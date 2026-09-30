'use strict';
const { ObjectId } = require('mongodb');
const { CHANNEL } = require('../utils/sales-channels');

// A tableside order belongs to its original signed-in captain, even after
// another staff member takes payment or receives a service handover.
module.exports = function captainSalesOwner(userId) {
  const text = String(userId);
  const identities = ObjectId.isValid(text) ? [text, new ObjectId(text)] : [text];
  return {
    $or: [
      { channel: CHANNEL.TABLESIDE, 'client.staff_id': { $in: identities } },
      {
        $and: [
          { $or: [{ channel: { $ne: CHANNEL.TABLESIDE } }, { 'client.staff_id': { $in: [null, ''] } }] },
          { $or: [{ user_id: { $in: identities } }, { created_by_id: { $in: identities } }] },
        ],
      },
    ],
  };
};
