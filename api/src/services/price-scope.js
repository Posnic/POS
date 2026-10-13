'use strict';
const { ObjectId } = require('mongodb');
const BaseModel = require('../models/base.model');
const id = (v) => {
  if (!/^[a-f0-9]{24}$/i.test(String(v))) throw new Error('Invalid branch identifier');
  return new ObjectId(String(v));
};
// Membership, not an owner/manager role, grants cross-branch access.
async function context(user, currentBranch, licenseId) {
  const db = await BaseModel.getDb();
  const allowed = [...new Set((user.branch_access || []).map((b) => String(b.branch_id)))];
  if (!allowed.includes(String(currentBranch))) throw new Error('Branch access denied');
  const branches = await db
    .collection('branches')
    .find({
      license: id(licenseId),
      _id: { $in: allowed.map(id) },
      del_status: { $nin: [1, '1', true] },
    })
    .sort({ branch_name: 1, _id: 1 })
    .toArray();
  return {
    branchId: String(currentBranch),
    licenseId: String(licenseId),
    userId: String(user._id),
    userName: user.name || user.email || user.username || '',
    apiToken: user.api_token === true,
    branches: branches.map((b) => ({
      id: String(b._id),
      name: b.branch_name || '',
      // Stable fallback; ambiguous codes are rejected instead of guessed.
      code: b.price_code || 'B' + String(b._id).slice(-6).toUpperCase(),
      timezone: b.time_zone || 'Asia/Calcutta',
    })),
  };
}
function selected(c, input) {
  const allowed = c.branches || [{ id: String(c.branchId) }];
  const requested =
    input === 'all'
      ? allowed.map((b) => b.id)
      : input == null || input === ''
        ? [String(c.branchId)]
        : Array.isArray(input)
          ? input
          : String(input).split(',');
  if (!requested.length || requested.length > 100) throw new Error('Choose 1 to 100 branches');
  return [
    ...new Set(
      requested.map((value) => {
        const matches = allowed.filter((b) => b.id === String(value) || b.code === value);
        if (matches.length !== 1) throw new Error('Unknown, ambiguous or unauthorized branch');
        return String(matches[0].id);
      })
    ),
  ].sort();
}
function assertJob(c, job) {
  const ids = (job.branchIds || [String(job.branch_id)]).map(String);
  selected(c, ids);
}
async function setCode(c, branchId, code) {
  selected(c, [branchId]);
  code = String(code || '')
    .trim()
    .toUpperCase();
  if (!/^[A-Z][A-Z0-9_-]{1,11}$/.test(code))
    throw new Error('Use a branch code of 2 to 12 letters or digits');
  const db = await BaseModel.getDb();
  const others = await db
    .collection('branches')
    .find(
      { license: id(c.licenseId), _id: { $ne: id(branchId) } },
      { projection: { price_code: 1 } }
    )
    .toArray();
  if (others.some((b) => (b.price_code || 'B' + String(b._id).slice(-6).toUpperCase()) === code))
    throw new Error('Branch code is already in use');
  await db.collection('branches').createIndex(
    { license: 1, price_code: 1 },
    {
      unique: true,
      partialFilterExpression: { price_code: { $type: 'string' } },
    }
  );
  await db
    .collection('branches')
    .updateOne(
      { _id: id(branchId), license: id(c.licenseId) },
      { $set: { price_code: code, updated_date: new Date() } }
    );
  return { code };
}
async function categoryFilter(c, input, branches) {
  const filter = require('../utils/price-category-filter')(input);
  if (!filter || (branches.length === 1 && branches[0] === String(c.branchId))) return filter;
  const db = await BaseModel.getDb();
  const source = await db
    .collection('categories')
    .find({ _id: filter, license: id(c.licenseId), branch_id: { $in: selected(c, 'all').map(id) } })
    .toArray();
  const names = source.map((r) => r.name || r.category_name).filter(Boolean);
  const rows = await db
    .collection('categories')
    .find({
      license: id(c.licenseId),
      branch_id: { $in: branches.map(id) },
      $or: [{ name: { $in: names } }, { category_name: { $in: names } }],
    })
    .toArray();
  return { $in: rows.map((r) => r._id) };
}
module.exports = { context, selected, assertJob, setCode, id, categoryFilter };
