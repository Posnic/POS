'use strict';
const { ObjectId } = require('mongodb');
const crypto = require('crypto');
const BaseModel = require('../models/base.model');
const scope = require('./price-scope');
// Expand only missing branch rows. Explicit branch-specific edits stay explicit.
// A stale source, ambiguous SKU, or conflicting product name cannot fan out.
module.exports = async function expand(c, input, normalize) {
  if (!Array.isArray(input.rows) || input.rows.length > 100000) throw new Error('Too many price rows.');
  const branches = scope.selected(c, input.branches), db = await BaseModel.getDb();
  const rows = input.rows.map(r => ({ ...r })), candidates = new Map(), explicit = new Set();
  for (const row of rows) {
    if (!branches.includes(String(row.branchId))) throw new Error('Price row is outside selected branches.');
    let normalized;
    try { normalized = normalize(row, input.allowZero === true); }
    catch (e) { row.invalidReason = e.message; continue; }
    if (!Object.keys(normalized.changes).length) continue;
    const source = await db.collection('items').findOne({ _id: new ObjectId(normalized.id), branch_id: new ObjectId(row.branchId), license: new ObjectId(c.licenseId), del_status: { $nin: [1, '1', true] }, is_deleted: { $ne: true } });
    if (!source) continue;
    const sku = String(source.itemid || '');
    if (!sku) continue;
    const key = JSON.stringify([sku, source.name]);
    explicit.add(key + ':' + row.branchId);
    if (Object.entries(normalized.changes).some(([f,v]) => Number(source[f] || 0) !== v.old)) { row.invalidReason = 'Source price changed; download fresh prices before updating other branches'; continue; }
    const values = Object.fromEntries(Object.entries(normalized.changes).map(([f,v]) => [f,v.value]));
    const prior = candidates.get(key);
    if (prior && JSON.stringify(prior.values) !== JSON.stringify(values)) prior.conflict = true;
    else if (!prior) candidates.set(key, { sku, name: source.name, values });
  }
  for (const [key, source] of candidates) for (const branch of branches) {
    if (explicit.has(key + ':' + branch)) continue;
    const skuValues = [source.sku];
    if (Number.isSafeInteger(Number(source.sku)) && String(Number(source.sku)) === source.sku) skuValues.push(Number(source.sku));
    const matches = await db.collection('items').find({ license: new ObjectId(c.licenseId), branch_id: new ObjectId(branch), itemid: { $in: skuValues }, del_status: { $nin: [1, '1', true] }, is_deleted: { $ne: true } }).limit(2).toArray();
    const target = matches[0];
    const error = source.conflict ? 'Different prices were entered for this SKU; specify this branch explicitly' : matches.length > 1 ? 'Duplicate SKU; select the exact product' : target && target.name !== source.name ? 'SKU belongs to a different product; resolve the conflict first' : null;
    const blank = target && rows.find(r => String(r.id) === String(target._id) && String(r.branchId) === branch);
    const expanded = { id: target ? String(target._id) : crypto.createHash('sha256').update(key + ':' + branch).digest('hex').slice(0,24), branchId: branch, name: source.name,
      changes: Object.fromEntries(Object.entries(source.values).map(([f,value]) => [f,{old:blank?.changes?.[f]?.old ?? Number(target?.[f] || 0),value}])),
      ...(error ? { invalidReason: error } : !target ? { skipReason: 'Product missing in this branch. Add it using Apply to branches, then retry prices.' } : {}) };
    if (blank) Object.assign(blank, expanded); else rows.push(expanded);
    if (rows.length > 100000) throw new Error('Expanded price update exceeds 100,000 rows.');
  }
  return rows;
};
