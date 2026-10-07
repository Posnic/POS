'use strict';
const { context, allowed, fail } = require('../utils/branch-access');
const choices = ['always_available', 'track_quantities'];
async function read(req) {
  if (!req.user || !allowed(req.user, 'item', 'read')) fail('Item permission is required.', 403);
  const c = await context(req);
  return {
    preference: choices.includes(c.branch.item_stock_default) ? c.branch.item_stock_default : null,
  };
}
async function save(req) {
  if (!req.user || !['owner', 'super_admin', 'admin'].includes(req.user.usertype))
    fail('An administrator must choose the shop stock preference.', 403);
  const preference = req.body?.preference;
  if (!choices.includes(preference)) fail('Choose how new items handle stock.');
  const c = await context(req);
  await req.db
    .collection('branches')
    .updateOne(
      { _id: c.branchId, license: c.license },
      { $set: { item_stock_default: preference, updated_date: new Date() } }
    );
  return { preference };
}
module.exports = { read, save };
