'use strict';

const InventoryCountRepository = require('../repositories/inventory-count.repository');
const repository = new InventoryCountRepository();

function context(req) {
  return {
    branchId: req.tenantContext?.branchId || req.session?.selectedBranchId || req.user?.branch_id,
    licenseId: req.tenantContext?.licenseId || req.user?.license || req.user?.license_id,
    userId: req.user?._id,
    userName: req.user?.username || req.user?.email || '',
  };
}
function allowed(req, permission) {
  return req.user?.access?.item?.[permission] !== false;
}
function send(res, result, successCode = 200) {
  return res.status(result.status ? successCode : 400).json({
    type: result.status ? 'success' : 'error',
    message: result.message,
    data: result.data,
  });
}

module.exports = {
  async create(req, res) {
    if (!allowed(req, 'write'))
      return res.status(403).json({ type: 'error', message: 'Unauthorized access', data: null });
    return send(res, await repository.createDraft(req.body || {}, context(req)), 201);
  },
  async list(req, res) {
    if (!allowed(req, 'read'))
      return res.status(403).json({ type: 'error', message: 'Unauthorized access', data: null });
    return send(res, await repository.list(context(req)));
  },
  async get(req, res) {
    if (!allowed(req, 'read'))
      return res.status(403).json({ type: 'error', message: 'Unauthorized access', data: null });
    return send(res, await repository.get(req.params.id, context(req)));
  },
};
