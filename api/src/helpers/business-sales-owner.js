'use strict';
const { recordedUserName } = require('../utils/recorded-user-name');
const { CHANNEL } = require('../utils/sales-channels');

const identity = (value) => {
  if (value && typeof value.toHexString === 'function') return value.toHexString();
  return typeof value === 'string' ? value.trim().slice(0, 254) : '';
};

/** Match Captain ownership: original order taker survives payment and handover. */
module.exports = function businessSalesOwner(sale) {
  const captainId = identity(sale.client?.staff_id);
  const captainName = recordedUserName(sale.client?.staff_name);
  let id, name;
  if (sale.channel === CHANNEL.TABLESIDE && (captainId || captainName)) {
    id = captainId;
    name = captainName;
  } else {
    const candidates = [
      [identity(sale.user_id), recordedUserName(sale.user_name)],
      [identity(sale.created_by_id), recordedUserName(sale.created_by)],
      [identity(sale.origin?.actor_id), recordedUserName(sale.origin?.actor_name)],
    ];
    id = candidates.find(([candidateId]) => candidateId)?.[0] || '';
    name =
      candidates.find(
        ([candidateId, candidateName]) =>
          candidateName && (!candidateId || !id || candidateId === id)
      )?.[1] || '';
  }
  // An identity without a name must not inherit a later cashier's display name.
  return {
    id: id || (name ? `name:${name}` : 'unassigned'),
    name: name ? name.slice(0, 254) : id ? 'Staff name unavailable' : 'Unassigned',
  };
};
