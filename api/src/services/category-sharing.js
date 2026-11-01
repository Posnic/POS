'use strict';
const { ObjectId } = require('mongodb');
const crypto = require('crypto');
const BaseModel = require('../models/base.model');
const scope = require('./price-scope');
const { allowed } = require('../utils/mobile-pos-access');
const oid = (v) => new ObjectId(String(v));
async function context(req, write = false) {
  if (!allowed(req.user, 'category', write ? 'write' : 'read'))
    throw new Error('Category access is required.');
  return scope.context(req.user, req.tenantContext.branchId, req.tenantContext.licenseId);
}
async function prepare(req) {
  const c = await context(req, true);
  const targets = scope.selected(c, req.body.apply_branches).filter((id) => id !== c.branchId);
  if (targets.length && process.env.POSNIC_DESKTOP === '1')
    throw new Error('Apply categories to other branches from the cloud account.');
  return { c, targets };
}
async function distribute(plan, source, previousName) {
  const { c, targets } = plan,
    db = await BaseModel.getDb(),
    outcomes = [];
  const root = String(source.catalogue_source_id || source._id);
  for (const branchId of targets) {
    try {
      const wall = { license: oid(c.licenseId), branch_id: oid(branchId) };
      const matches = await db
        .collection('categories')
        .find({
          ...wall,
          is_deleted: { $ne: true },
          del_status: { $nin: [1, '1', true] },
          $or: [{ catalogue_source_id: root }, { name: previousName || source.name }],
        })
        .toArray();
      if (matches.length > 1)
        throw new Error('Ambiguous category match; resolve duplicates in this branch.');
      const target = matches[0];
      const collision = await db.collection('categories').findOne({
        ...wall,
        name: source.name,
        ...(target ? { _id: { $ne: target._id } } : {}),
        is_deleted: { $ne: true },
      });
      if (collision) throw new Error('Another category already has this name.');
      const _id =
        target?._id ||
        oid(
          crypto
            .createHash('sha256')
            .update([c.licenseId, root, branchId].join(':'))
            .digest('hex')
            .slice(0, 24)
        );
      const values = {
        ...wall,
        catalogue_source_id: root,
        updated_date: new Date(),
        updated_by: source.updated_by || source.created_by,
        updated_by_id: oid(c.userId),
      };
      for (const field of [
        'name',
        'description',
        'sort_order',
        'image',
        'tile_color',
        'tile_shape',
        'discount_amount',
        'discount_percentage',
        'is_active',
      ])
        if (source[field] !== undefined) values[field] = source[field];
      if (target) {
        const result = await db
          .collection('categories')
          .updateOne({ _id, ...wall, updated_date: target.updated_date ?? null }, { $set: values });
        if (!result.matchedCount)
          throw new Error('Category changed during review. Retry after refreshing.');
      } else
        await db.collection('categories').insertOne({
          _id,
          ...values,
          branch_name: c.branches.find((b) => b.id === branchId).name,
          created_date: new Date(),
          created_by_id: oid(c.userId),
        });
      await db
        .collection('items')
        .updateMany(
          { ...wall, category_id: _id },
          { $set: { category_name: source.name, updated_date: new Date() } }
        );
      outcomes.push({ branchId, status: target ? 'updated' : 'created' });
    } catch (e) {
      outcomes.push({ branchId, status: 'conflict', message: e.message });
    }
  }
  return outcomes;
}
module.exports = { context, prepare, distribute };
