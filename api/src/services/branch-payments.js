'use strict';
const { fail } = require('../utils/branch-access');
function validate(s) {
  if (!Array.isArray(s.upiAccounts) || s.upiAccounts.length > 20) fail('Invalid UPI accounts.');
  const seen = new Set();
  const upiAccounts = s.upiAccounts.map((a) => {
    if (
      !a ||
      typeof a !== 'object' ||
      typeof a.id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(a.id) ||
      seen.has(a.id) ||
      typeof a.name !== 'string' ||
      !a.name.trim() ||
      a.name.length > 80 ||
      !/^[A-Za-z0-9._-]{2,128}@[A-Za-z0-9.-]{2,64}$/.test(a.vpa)
    )
      fail('Give each UPI account a name and valid UPI ID.');
    seen.add(a.id);
    return { id: a.id, name: a.name.trim(), vpa: a.vpa, active: true, verification: 'manual' };
  });
  if (upiAccounts.length && !seen.has(s.defaultUpiAccountId)) fail('Choose a default UPI account.');

  return { upiAccounts, defaultUpiAccountId: upiAccounts.length ? s.defaultUpiAccountId : '' };
}
function read(branch) {
  const p = branch.payment_settings || branch.mobile_pos || {};
  return { upiAccounts: p.upiAccounts || [], defaultUpiAccountId: p.defaultUpiAccountId || '' };
}
module.exports = { read, validate };
