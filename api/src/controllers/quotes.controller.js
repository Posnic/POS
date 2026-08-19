'use strict';

/*
 * Quotes (LS2). ACL: the sale permission - a quote is a sales document.
 * Reads need sale.read, anything that changes a quote needs sale.write.
 * Stock and payments are never touched here - see the repository header.
 */

const QuoteRepository = require('../repositories/quote.repository');

const repository = new QuoteRepository();

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
  return req.user?.access?.sale?.[perm] !== false;
}

const fail = (res, message, code = 400) =>
  res.status(code).json({ type: 'error', message, data: null });
const ok = (res, data, message) => res.json({ type: 'success', message, data });

module.exports = {
  async create(req, res) {
    try {
      if (!can(req, 'write')) return fail(res, 'Unauthorized access', 403);
      const r = await repository.upsertQuote(req.body || {}, '', contextOf(req));
      return r.status ? ok(res, r.data, r.message) : fail(res, r.message);
    } catch (error) {
      console.error('Error in quotes create:', error);
      return fail(res, error.message, 500);
    }
  },

  async update(req, res) {
    try {
      if (!can(req, 'write')) return fail(res, 'Unauthorized access', 403);
      const r = await repository.upsertQuote(req.body || {}, req.params.id, contextOf(req));
      return r.status ? ok(res, r.data, r.message) : fail(res, r.message);
    } catch (error) {
      console.error('Error in quotes update:', error);
      return fail(res, error.message, 500);
    }
  },

  async list(req, res) {
    try {
      if (!can(req, 'read')) return fail(res, 'Unauthorized access', 403);
      const r = await repository.listQuotes(
        { status: req.query.status, limit: req.query.limit },
        contextOf(req)
      );
      return r.status ? ok(res, r.data, r.message) : fail(res, r.message);
    } catch (error) {
      console.error('Error in quotes list:', error);
      return fail(res, error.message, 500);
    }
  },

  async getById(req, res) {
    try {
      if (!can(req, 'read')) return fail(res, 'Unauthorized access', 403);
      const r = await repository.getQuote(req.params.id, contextOf(req));
      return r.status ? ok(res, r.data, r.message) : fail(res, r.message, 404);
    } catch (error) {
      console.error('Error in quotes getById:', error);
      return fail(res, error.message, 500);
    }
  },

  async transition(req, res) {
    try {
      if (!can(req, 'write')) return fail(res, 'Unauthorized access', 403);
      const r = await repository.transition(
        req.params.id,
        req.body?.action,
        req.body || {},
        contextOf(req)
      );
      return r.status ? ok(res, r.data, r.message) : fail(res, r.message);
    } catch (error) {
      console.error('Error in quotes transition:', error);
      return fail(res, error.message, 500);
    }
  },

  async remove(req, res) {
    try {
      if (!can(req, 'write')) return fail(res, 'Unauthorized access', 403);
      const r = await repository.deleteQuote(req.params.id, contextOf(req));
      return r.status ? ok(res, r.data, r.message) : fail(res, r.message);
    } catch (error) {
      console.error('Error in quotes remove:', error);
      return fail(res, error.message, 500);
    }
  },
};
