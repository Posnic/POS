'use strict';
const crypto = require('node:crypto');
const { context, allowed, fail } = require('../utils/branch-access');
const upi = require('../utils/branch-upi');
const countryCode = require('../utils/branch-country');
const { recordAudit } = require('../utils/audit-trail');
const revision = (branch) =>
  crypto
    .createHash('sha256')
    .update(
      JSON.stringify([
        String(branch._id),
        branch.branch_upi_id ?? null,
        branch.branch_upi_name ?? null,
        branch.country ?? null,
        branch.sortname ?? null,
        branch.country_id ?? null,
      ])
    )
    .digest('hex');
async function scope(req) {
  if (!req.user || !allowed(req.user, 'settings')) fail('Permission is required.', 403);
  return context(req);
}
function view(branch) {
  const upiAvailable = countryCode(branch) === 'IN';
  return {
    upiAvailable,
    id: String(branch._id),
    name: branch.branch_name || '',
    branch_upi_id: upiAvailable ? branch.branch_upi_id || '' : '',
    branch_upi_name: upiAvailable ? branch.branch_upi_name || '' : '',
    revision: revision(branch),
  };
}
async function get(req) {
  return view((await scope(req)).branch);
}
async function update(req) {
  const c = await scope(req),
    body = req.body || {};
  if (countryCode(c.branch) !== 'IN')
    fail('UPI receiving accounts are available only for Indian branches.');
  if (body.revision !== revision(c.branch)) fail('Settings changed. Refresh and try again.', 409);
  let fields;
  try {
    fields = upi.update({
      branch_upi_id: body.branch_upi_id,
      branch_upi_name: body.branch_upi_name,
    });
  } catch (error) {
    fail(error.message);
  }
  if (!Object.keys(fields).length) fail('Enter the UPI ID and receiving name.');
  const filter = { _id: c.branchId, license: c.license };
  for (const key of ['branch_upi_id', 'branch_upi_name', 'country', 'sortname', 'country_id'])
    filter[key] = c.branch[key] === undefined ? { $exists: false } : c.branch[key];
  const result = await req.db
    .collection('branches')
    .updateOne(filter, { $set: { ...fields, updated_date: new Date() } });
  if (!result.matchedCount) fail('Settings changed. Refresh and try again.', 409);
  await recordAudit(req.db, {
    event: 'captain.branch.upi.changed',
    actor: { id: req.user._id, name: req.user.name },
    target: { id: c.branchId, type: 'branch' },
    license: c.license,
    branchId: c.branchId,
    ip: req.ip,
    userAgent: req.get?.('user-agent'),
  });
  return view({ ...c.branch, ...fields });
}
module.exports = { get, update };
