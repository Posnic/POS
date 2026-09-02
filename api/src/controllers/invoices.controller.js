'use strict';

/*
 * Invoices (INVOICING_MODULE_DESIGN). ACL: the sale permission, like quotes -
 * an invoice is a sales document. Reads need sale.read, anything that changes
 * an invoice needs sale.write.
 *
 * Money is never touched here. Issuing books the SALE (services/invoice-
 * booking); recording a payment pays that sale down (services/invoice-sync);
 * the invoice repeats what the sale then says.
 */

const InvoiceRepository = require('../repositories/invoice.repository');
const QuoteRepository = require('../repositories/quote.repository');
const invoiceSync = require('../services/invoice-sync');
const invoiceBooking = require('../services/invoice-booking');

const repository = new InvoiceRepository();
const quotes = new QuoteRepository();

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
const ok = (res, data, message, meta) =>
  res.json({ type: 'success', message, data, ...(meta ? { meta } : {}) });

module.exports = {
  async create(req, res) {
    try {
      if (!can(req, 'write')) return fail(res, 'Unauthorized access', 403);
      const r = await repository.upsertInvoice(req.body || {}, '', contextOf(req));
      return r.status ? ok(res, r.data, r.message) : fail(res, r.message);
    } catch (error) {
      console.error('Error in invoices create:', error);
      return fail(res, error.message, 500);
    }
  },

  async update(req, res) {
    try {
      if (!can(req, 'write')) return fail(res, 'Unauthorized access', 403);
      const r = await repository.upsertInvoice(req.body || {}, req.params.id, contextOf(req));
      return r.status ? ok(res, r.data, r.message) : fail(res, r.message);
    } catch (error) {
      console.error('Error in invoices update:', error);
      return fail(res, error.message, 500);
    }
  },

  /*
   * Quote -> invoice. The invoice is created from the quote's own numbers as
   * a draft (a proforma), then the quote is stamped `invoiced` so it cannot
   * be converted twice. If the stamp is refused - the quote was invoiced
   * meanwhile - the invoice just created is removed again rather than left
   * as a second bill for one promise.
   */
  async fromQuote(req, res) {
    try {
      if (!can(req, 'write')) return fail(res, 'Unauthorized access', 403);
      const ctx = contextOf(req);
      const q = await quotes.getQuote(req.params.quoteId, ctx);
      if (!q.status) return fail(res, q.message, 404);
      const quote = q.data;
      if (quote.status === 'invoiced' && quote.invoice_id) {
        return ok(
          res,
          { id: String(quote.invoice_id), invoice_id: quote.invoice_number || '', existing: true },
          'This quote already has an invoice'
        );
      }
      if (!['open', 'draft', 'sent', 'accepted'].includes(quote.status)) {
        return fail(res, 'Only an open or accepted quote can become an invoice');
      }
      const created = await repository.createFromQuote(quote, ctx);
      if (!created.status) return fail(res, created.message);
      const stamped = await quotes.transition(
        String(quote._id),
        'invoice',
        { invoice_id: created.data.id, invoice_number: created.data.invoice_id },
        ctx
      );
      if (!stamped.status) {
        await repository.deleteInvoice(created.data.id, ctx);
        return fail(res, stamped.message);
      }
      return ok(
        res,
        created.data,
        'Invoice ' + created.data.invoice_id + ' created from the quote'
      );
    } catch (error) {
      console.error('Error in invoices fromQuote:', error);
      return fail(res, error.message, 500);
    }
  },

  async share(req, res) {
    try {
      if (!can(req, 'write')) return fail(res, 'Unauthorized access', 403);
      const { s3Config, uploadObject } = require('../utils/s3');
      if (!s3Config().bucket) {
        return fail(
          res,
          'Invoice links are not configured on this server - PDF, Email and WhatsApp text still work',
          503
        );
      }
      const b64 = String((req.body && req.body.pdf_base64) || '');
      if (!b64) return fail(res, 'A rendered PDF is required', 400);
      if (b64.length > 14 * 1024 * 1024) return fail(res, 'PDF too large', 400);
      const ctx = contextOf(req);
      const found = await repository.getInvoice(req.params.id, ctx);
      if (!found.status) return fail(res, found.message, 404);
      const doc = found.data;
      const rev = ((doc.share && doc.share.rev) || 0) + 1;
      const crypto = require('crypto');
      /* b/<code>: bills, beside the sales' i/<code> and the quotes' q/<code>.
         12 url-safe chars = 72 random bits; the key is the secret. */
      const key = `${process.env.SHARE_LINK_PREFIX || ''}b/${crypto.randomBytes(9).toString('base64url')}`;
      const up = await uploadObject({
        key,
        body: Buffer.from(b64, 'base64'),
        contentType: 'application/pdf',
        contentDisposition: `inline; filename="invoice-${String(doc.invoice_id || 'invoice').replace(/[^\w.-]/g, '_')}.pdf"`,
      });
      const rec = await repository.recordShare(req.params.id, { key, url: up.Location, rev }, ctx);
      if (!rec.status) return fail(res, rec.message);
      return ok(res, { url: up.Location, rev }, 'Invoice link ready');
    } catch (error) {
      console.error('Error in invoices share:', error);
      return fail(res, error.message, 500);
    }
  },

  async list(req, res) {
    try {
      if (!can(req, 'read')) return fail(res, 'Unauthorized access', 403);
      const r = await repository.listInvoices(
        {
          status: req.query.status,
          limit: req.query.limit,
          page: req.query.page,
          search: req.query.search,
          field: req.query.field,
          exact: req.query.exact,
          from: req.query.from,
          to: req.query.to,
          sort: req.query.sort,
        },
        contextOf(req)
      );
      return r.status ? ok(res, r.data, r.message, r.meta) : fail(res, r.message);
    } catch (error) {
      console.error('Error in invoices list:', error);
      return fail(res, error.message, 500);
    }
  },

  async summary(req, res) {
    try {
      if (!can(req, 'read')) return fail(res, 'Unauthorized access', 403);
      const r = await repository.summary(contextOf(req));
      return r.status ? ok(res, r.data, r.message) : fail(res, r.message);
    } catch (error) {
      console.error('Error in invoices summary:', error);
      return fail(res, error.message, 500);
    }
  },

  async getById(req, res) {
    try {
      if (!can(req, 'read')) return fail(res, 'Unauthorized access', 403);
      const r = await repository.getInvoice(req.params.id, contextOf(req));
      return r.status ? ok(res, r.data, r.message) : fail(res, r.message, 404);
    } catch (error) {
      console.error('Error in invoices getById:', error);
      return fail(res, error.message, 500);
    }
  },

  /* Issue: the draft becomes the sale. The server books it; nobody is sent
     to a till screen. Replay-safe. */
  async issue(req, res) {
    try {
      if (!can(req, 'write')) return fail(res, 'Unauthorized access', 403);
      const r = await invoiceBooking.issueInvoice(req.params.id, contextOf(req));
      return r.status ? ok(res, r.data, r.message) : fail(res, r.message);
    } catch (error) {
      console.error('Error in invoices issue:', error);
      return fail(res, error.message, 500);
    }
  },

  /*
   * cancel changes the document alone (drafts only). sync re-reads the sale:
   * the invoice is rewritten FROM the sale, never from what a client claims.
   */
  async transition(req, res) {
    try {
      if (!can(req, 'write')) return fail(res, 'Unauthorized access', 403);
      const ctx = contextOf(req);
      const action = String(req.body?.action || '');
      if (action === 'sync') {
        const found = await repository.getInvoice(req.params.id, ctx);
        if (!found.status) return fail(res, found.message, 404);
        if (!found.data.sale_id) return fail(res, 'This invoice has not been issued yet');
        const r = await invoiceSync.syncSale(found.data.sale_id, { invoiceId: req.params.id });
        return r.synced ? ok(res, r.data, r.message) : fail(res, r.message);
      }
      const r = await repository.transition(req.params.id, action, req.body || {}, ctx);
      return r.status ? ok(res, r.data, r.message) : fail(res, r.message);
    } catch (error) {
      console.error('Error in invoices transition:', error);
      return fail(res, error.message, 500);
    }
  },

  /*
   * Record a payment, in full or in part. A draft is issued first - the
   * customer paying IS the moment the bill is real - so nobody has to press
   * two buttons to record one thing.
   */
  async payment(req, res) {
    try {
      if (!can(req, 'write')) return fail(res, 'Unauthorized access', 403);
      const ctx = contextOf(req);
      let found = await repository.getInvoice(req.params.id, ctx);
      if (!found.status) return fail(res, found.message, 404);
      let inv = found.data;
      if (inv.status === 'cancelled') return fail(res, 'This invoice was cancelled');
      if (inv.status === 'paid') return fail(res, 'This invoice is already paid');
      if (!inv.sale_id) {
        const issued = await invoiceBooking.issueInvoice(req.params.id, ctx);
        if (!issued.status) return fail(res, issued.message);
        found = await repository.getInvoice(req.params.id, ctx);
        if (!found.status) return fail(res, found.message, 404);
        inv = found.data;
      }
      const r = await invoiceSync.recordPayment(inv, req.body || {}, ctx);
      return r.status ? ok(res, r.data, r.message) : fail(res, r.message);
    } catch (error) {
      console.error('Error in invoices payment:', error);
      return fail(res, error.message, 500);
    }
  },

  async remove(req, res) {
    try {
      if (!can(req, 'write')) return fail(res, 'Unauthorized access', 403);
      const r = await repository.deleteInvoice(req.params.id, contextOf(req));
      return r.status ? ok(res, r.data, r.message) : fail(res, r.message);
    } catch (error) {
      console.error('Error in invoices remove:', error);
      return fail(res, error.message, 500);
    }
  },
};
