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
// `meta` rides alongside data (paging totals); omitted when there is none,
// so every existing caller sees exactly the payload it saw before.
const ok = (res, data, message, meta) =>
  res.json({ type: 'success', message, data, ...(meta ? { meta } : {}) });

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

  /*
   * Share: the till renders the professional PDF (the same document the
   * user saw) and posts it here; it lands in S3 under an unguessable
   * random key (same convention as invoice links) and the quote records
   * the newest revision - an edited quote re-shares as a new file, so an
   * old link never silently shows different numbers.
   */
  async share(req, res) {
    try {
      if (!can(req, 'write')) return fail(res, 'Unauthorized access', 403);
      const { s3Config, uploadObject } = require('../utils/s3');
      if (!s3Config().bucket) {
        return fail(
          res,
          'Quote links are not configured on this server - PDF, Email and WhatsApp text still work',
          503
        );
      }
      const b64 = String((req.body && req.body.pdf_base64) || '');
      if (!b64) return fail(res, 'A rendered PDF is required', 400);
      if (b64.length > 14 * 1024 * 1024) return fail(res, 'PDF too large', 400);
      const ctx = contextOf(req);
      const found = await repository.getQuote(req.params.id, ctx);
      if (!found.status) return fail(res, found.message, 404);
      const doc = found.data;
      const rev = ((doc.share && doc.share.rev) || 0) + 1;
      const crypto = require('crypto');
      const licensePart = String(doc.license || ctx.licenseId || 'shop').slice(-8);
      const year = new Date().getFullYear();
      const key = `quotes/${licensePart}/${year}/${crypto.randomBytes(16).toString('hex')}-r${rev}.pdf`;
      const up = await uploadObject({
        key,
        body: Buffer.from(b64, 'base64'),
        contentType: 'application/pdf',
      });
      const rec = await repository.recordShare(req.params.id, { key, url: up.Location, rev }, ctx);
      if (!rec.status) return fail(res, rec.message);
      return ok(res, { url: up.Location, rev }, 'Quote link ready');
    } catch (error) {
      console.error('Error in quotes share:', error);
      return fail(res, error.message, 500);
    }
  },

  async list(req, res) {
    try {
      if (!can(req, 'read')) return fail(res, 'Unauthorized access', 403);
      const r = await repository.listQuotes(
        {
          status: req.query.status,
          limit: req.query.limit,
          page: req.query.page,
          search: req.query.search,
        },
        contextOf(req)
      );
      return r.status ? ok(res, r.data, r.message, r.meta) : fail(res, r.message);
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
