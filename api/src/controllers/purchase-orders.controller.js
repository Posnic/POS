'use strict';

/*
 * Purchase orders (PO_LIFECYCLE_DESIGN.md). ACL: the receiving permission -
 * POs belong to purchasing, and a shop that can record receipts can plan
 * them. Reads need receiving.read, anything that changes a PO needs
 * receiving.write. Stock is never touched here - see the repository header.
 */

const PurchaseOrderRepository = require('../repositories/purchase-order.repository');

const repository = new PurchaseOrderRepository();

function contextOf(req) {
  const user = req.user || {};
  return {
    branchId:
      req.tenantContext?.branchId ||
      user.branch_id ||
      (Array.isArray(user.branch_access) && user.branch_access[0]?.branch_id) ||
      null,
    branchName: req.tenantContext?.branchName || user.branch_name || '',
    licenseId: req.tenantContext?.licenseId || user.license || null,
    userId: user._id || null,
    userName: user.username || user.email || '',
  };
}

function can(req, perm) {
  return req.user?.access?.receiving?.[perm] !== false;
}

const fail = (res, message, code = 400) =>
  res.status(code).json({ type: 'error', message, data: null });
const ok = (res, data, message) => res.json({ type: 'success', message, data });

module.exports = {
  async create(req, res) {
    try {
      if (!can(req, 'write')) return fail(res, 'Unauthorized access', 403);
      const r = await repository.upsertOrder(req.body || {}, '', contextOf(req));
      return r.status ? ok(res, r.data, r.message) : fail(res, r.message);
    } catch (error) {
      console.error('Error in purchase-orders create:', error);
      return fail(res, error.message, 500);
    }
  },

  async update(req, res) {
    try {
      if (!can(req, 'write')) return fail(res, 'Unauthorized access', 403);
      const r = await repository.upsertOrder(req.body || {}, req.params.id, contextOf(req));
      return r.status ? ok(res, r.data, r.message) : fail(res, r.message);
    } catch (error) {
      console.error('Error in purchase-orders update:', error);
      return fail(res, error.message, 500);
    }
  },

  async list(req, res) {
    try {
      if (!can(req, 'read')) return fail(res, 'Unauthorized access', 403);
      const r = await repository.listOrders(
        {
          page: req.query.page,
          limit: req.query.limit,
          status: req.query.status,
          supplierId: req.query.supplier_id,
        },
        contextOf(req)
      );
      return r.status ? ok(res, r.data, r.message) : fail(res, r.message);
    } catch (error) {
      console.error('Error in purchase-orders list:', error);
      return fail(res, error.message, 500);
    }
  },

  async getById(req, res) {
    try {
      if (!can(req, 'read')) return fail(res, 'Unauthorized access', 403);
      const r = await repository.getOrder(req.params.id, contextOf(req));
      return r.status ? ok(res, r.data, r.message) : fail(res, r.message, 404);
    } catch (error) {
      console.error('Error in purchase-orders getById:', error);
      return fail(res, error.message, 500);
    }
  },

  async transition(req, res) {
    try {
      if (!can(req, 'write')) return fail(res, 'Unauthorized access', 403);
      const r = await repository.transition(req.params.id, req.body?.action, contextOf(req));
      return r.status ? ok(res, r.data, r.message) : fail(res, r.message);
    } catch (error) {
      console.error('Error in purchase-orders transition:', error);
      return fail(res, error.message, 500);
    }
  },

  async remove(req, res) {
    try {
      if (!can(req, 'write')) return fail(res, 'Unauthorized access', 403);
      const r = await repository.deleteOrder(req.params.id, contextOf(req));
      return r.status ? ok(res, r.data, r.message) : fail(res, r.message);
    } catch (error) {
      console.error('Error in purchase-orders remove:', error);
      return fail(res, error.message, 500);
    }
  },
};
