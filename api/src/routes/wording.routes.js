'use strict';
const router = require('express').Router();
const { protect } = require('../middleware/auth');
const BaseModel = require('../models/base.model');
const { ObjectId } = require('mongodb');
const {
  WordingProfiles,
  supportedLocales,
  resolveBundle,
} = require('../services/wording-profiles');
const model = new BaseModel('settings');
router.use(protect);
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
function context(req) {
  return {
    license:
      req.tenantContext?.licenseId ||
      req.user?.license ||
      req.user?.license_id ||
      BaseModel.license,
    branch:
      req.tenantContext?.branchId ||
      req.session?.selectedBranchId ||
      req.session?.branch_id ||
      BaseModel.currentBranch ||
      req.user?.branch_id,
  };
}
const authority = () =>
  !(process.env.POSNIC_DESKTOP === '1' && process.env.POSNIC_SYNC_PAIRED === '1');
const admin = (req) =>
  !req.isApiKey &&
  String(req.user?.usertype || req.user?.role || '').toLowerCase() === 'super_admin';
const handler = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    const response = res.status(e.status || 500);
    response.json({
      type: 'error',
      message: e.status ? e.message : 'Could not load or save wording profiles',
    });
  }
};
function requireAdmin(req, write = false) {
  if (!admin(req))
    throw Object.assign(new Error('Only super admins can manage wording profiles'), {
      status: 403,
    });
  if (write && !authority())
    throw Object.assign(
      new Error(
        'Manage wording profiles on your cloud server. This till uses the synchronized profile.'
      ),
      { status: 409 }
    );
}
async function service(req) {
  return new WordingProfiles(await model.getCollection('settings'), context(req).license);
}
async function branches(req) {
  const license = context(req).license;
  if (!ObjectId.isValid(String(license)))
    throw Object.assign(new Error('Tenant context required'), { status: 403 });
  const filter = { license: new ObjectId(String(license)) };
  const access = req.user?.branch_access;
  if (Array.isArray(access) && access.length)
    filter._id = {
      $in: access
        .map((b) => b.branch_id || b)
        .filter((b) => ObjectId.isValid(String(b)))
        .map((b) => new ObjectId(String(b))),
    };
  const list = await (
    await model.getCollection('branches')
  )
    .find(filter, { projection: { branch_name: 1, name: 1 } })
    .toArray();
  return list.map((b) => ({ id: String(b._id), name: b.branch_name || b.name || String(b._id) }));
}
router.get(
  '/bundle',
  handler(async (req, res) => {
    const svc = await service(req),
      ctx = context(req),
      locale = String(req.query.locale || 'en');
    if (!ctx.branch || !supportedLocales().includes(locale))
      return res
        .status(400)
        .json({ type: 'error', message: 'Branch and supported language required' });
    if (!(await branches(req)).some((b) => b.id === String(ctx.branch)))
      return res.status(403).json({ type: 'error', message: 'Branch access required' });
    res.json({
      type: 'success',
      data: resolveBundle(await svc.read(), String(ctx.branch), locale, svc.labels),
    });
  })
);
router.get(
  '/',
  handler(async (req, res) => {
    requireAdmin(req);
    const svc = await service(req);
    const state = await svc.read();
    res.json({
      type: 'success',
      data: {
        state,
        writable: authority(),
        locales: supportedLocales(),
        branches: await branches(req),
        labels: Array.from(svc.labels.values()).map(({ id, english, module }) => ({
          id,
          english,
          module,
        })),
      },
    });
  })
);
router.put(
  '/draft',
  handler(async (req, res) => {
    requireAdmin(req, true);
    const svc = await service(req);
    res.json({ type: 'success', data: await svc.save(req.body, req.user?._id || req.user?.id) });
  })
);
router.post(
  '/publish',
  handler(async (req, res) => {
    requireAdmin(req, true);
    const svc = await service(req);
    res.json({
      type: 'success',
      data: await svc.publish(
        req.body,
        req.user?._id || req.user?.id,
        (await branches(req)).map((b) => b.id)
      ),
    });
  })
);
module.exports = router;
