'use strict';

// Collection defaults on; a saved opt-out and the module switch remain authoritative.
module.exports = function captainPaymentEnabled(branch) {
  if (!branch || [false, 0, '0', 'false'].includes(branch.module_captain_enable)) return false;
  const enabled = branch.captain_payments?.enabled;
  return enabled === undefined || enabled === true;
};
