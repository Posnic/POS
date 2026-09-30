'use strict';
const router = require('express').Router();
const { ObjectId } = require('mongodb');
const { protect } = require('../middleware/auth');
const BaseModel = require('../models/base.model');
const permissions = new (require('../controllers/base.controller'))();
const outlets = require('../services/billing-outlets');
router.use(protect);
const run = (permission, handler) => async (req, res, next) => {
  try {
    if (!permissions.checkPermission(permission[0], permission[1], req.user))
      return res.status(403).json({ status: false, message: 'Access denied.' });
    const c = req.tenantContext;
    if (!c?.validated)
      return res.status(400).json({ status: false, message: 'Select a branch first.' });
    const db = await BaseModel.getDb();
    const scope = outlets.scope(c.branchId, c.licenseId);
    const data = await handler(req, db, scope);
    res.json({ status: true, data });
  } catch (error) {
    next(error);
  }
};
router.get(
  '/',
  run(['sales', 'read'], async (req, db, scope) => {
    const all = await db
      .collection('billing_outlets')
      .find(scope)
      .sort({ name: 1 })
      .limit(100)
      .toArray();
    const manage = permissions.checkPermission('branch', 'write', req.user);
    return {
      manage,
      branch: { id: String(req.tenantContext.branchId), name: req.tenantContext.branchName },
      outlets: all
        .filter((o) => o.active !== false && outlets.allowed(o, req.user._id))
        .map((o) => ({ ...o, members: undefined })),
      configuration: manage ? all : undefined,
    };
  })
);
router.get(
  '/staff',
  run(['branch', 'write'], async (req, db, scope) =>
    db
      .collection('users')
      .find(
        { license: scope.license, 'branch_access.branch_id': scope.branch_id },
        { projection: { _id: 1, username: 1, name: 1 } }
      )
      .limit(500)
      .toArray()
  )
);
router.get(
  '/items',
  run(['branch', 'write'], async (req, db, scope) => {
    const query = String(req.query.query || '')
      .trim()
      .slice(0, 80);
    if (!query) return [];
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return db
      .collection('items')
      .find(
        { ...scope, name: { $regex: escaped, $options: 'i' } },
        { projection: { _id: 1, name: 1 } }
      )
      .limit(30)
      .maxTimeMS(2000)
      .toArray();
  })
);
router.post(
  '/',
  run(['branch', 'write'], async (req, db, scope) => {
    const value = outlets.validate(req.body);
    if (
      value.members.length &&
      (await db.collection('users').countDocuments({
        license: scope.license,
        'branch_access.branch_id': scope.branch_id,
        _id: { $in: value.members.map((id) => new ObjectId(id)) },
      })) !== value.members.length
    )
      throw Object.assign(new Error('Choose staff who have access to this branch.'), {
        statusCode: 400,
      });
    if (
      value.prices.length &&
      (await db.collection('items').countDocuments({
        ...scope,
        _id: { $in: value.prices.map((p) => new ObjectId(p.item_id)) },
      })) !== value.prices.length
    )
      throw Object.assign(new Error('Choose items belonging to this branch.'), { statusCode: 400 });
    const collection = db.collection('billing_outlets');
    if (req.body.id && !/^[a-f\d]{24}$/i.test(String(req.body.id)))
      throw Object.assign(new Error('Invalid outlet.'), { statusCode: 400 });
    const id = req.body.id ? new ObjectId(req.body.id) : new ObjectId();
    if (!req.body.id && (await collection.countDocuments(scope)) >= 100)
      throw Object.assign(new Error('Outlet limit reached.'), { statusCode: 400 });
    if (req.body.id && !(await collection.findOne({ ...scope, _id: id })))
      throw Object.assign(new Error('Outlet not found.'), { statusCode: 404 });
    await collection.updateOne(
      { ...scope, _id: id },
      {
        $set: { ...value, updated_at: new Date(), updated_by: req.user._id },
        $setOnInsert: { ...scope, created_at: new Date() },
      },
      { upsert: !req.body.id }
    );
    return { id: String(id) };
  })
);
router.get(
  '/summary',
  run(['report', 'read'], async (req, db, scope) => {
    const branch = await db
      .collection('branches')
      .findOne({ _id: scope.branch_id, license: scope.license });
    return require('../services/outlet-summary').read(
      db,
      scope,
      branch,
      String(req.query.day || '')
    );
  })
);
module.exports = router;
