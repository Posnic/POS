'use strict';

/*
 * Invoices (INVOICING_MODULE_DESIGN): the bill a customer is asked to pay.
 *
 * The governing rule, stated where the code lives:
 *
 *   AN INVOICE NEVER HOLDS MONEY. THE SALE DOES.
 *
 * An invoice is authored, shared and chased like a quote - lines, charges,
 * discounts, an A4 sheet, a due date. What it is NOT is a second ledger. The
 * accounting moment is still the sale: stock, tax, the customer's outstanding
 * balance and every report read the `sales` collection and nothing else.
 *
 * The international model (Zoho, Odoo, QuickBooks, GST practice): a DRAFT is
 * a proforma - editable, no stock, no tax. ISSUING it is the sale: the
 * server books the sale record itself (services/invoice-booking), stock
 * moves, the tax point is set, the numbers freeze. From then on the
 * invoice's unpaid/partial/paid state is a MIRROR of that sale's
 * payment_status, written by services/invoice-sync whenever the sale
 * changes. Recording a payment - in full or in part - settles the SALE and
 * the mirror follows. Nobody is walked through a till screen in between.
 *
 * So this repository writes only its own collection. It READS `branches` for
 * the shop's invoice defaults, exactly as quotes read their own. A test pins
 * that no write ever lands anywhere but `invoices`.
 *
 * Lifecycle:
 *   draft ──┬─ cancelled
 *           └─ (issue: the sale is booked) ─ unpaid ─ partial ─ paid
 * `overdue` is not a state; it is a fact about an ISSUED, still-owed invoice
 * past its due date, computed at read time so it can never go stale. A
 * proforma is not a receivable, so a draft is never overdue.
 */

const BaseModel = require('../models/base.model');
const { ObjectId } = require('mongodb');
const { ensureIndexOnce } = require('../db/ensure-index');
const docMath = require('../services/document-math');

const STATUSES = Object.freeze(['draft', 'unpaid', 'partial', 'paid', 'cancelled']);
/* Still authoring: the numbers may change. Once the sale exists they may not -
   a customer holds a document and the books hold a record, and they must
   agree. */
const EDITABLE = Object.freeze(['draft']);
/* Money is owed on these - issued, not yet paid off; what "overdue" applies to. */
const OWED = Object.freeze(['unpaid', 'partial']);
/* A sale has been recorded against these. */
const BOOKED = Object.freeze(['unpaid', 'partial', 'paid']);

const DEFAULT_PREFIX = 'INV-';
const DEFAULT_DUE_DAYS = 30;

class InvoiceRepository extends BaseModel {
  constructor() {
    super('invoices');
  }

  static get STATUSES() {
    return STATUSES;
  }

  static get OWED() {
    return OWED;
  }

  _wall(context) {
    const branchId = context && context.branchId;
    const licenseId = context && context.licenseId;
    if (!branchId || !ObjectId.isValid(String(branchId))) return null;
    const wall = { branch_id: new ObjectId(String(branchId)) };
    if (licenseId && ObjectId.isValid(String(licenseId))) {
      wall.license = new ObjectId(String(licenseId));
    }
    return wall;
  }

  /*
   * The shop's invoice defaults, from the branch document. The settings
   * group endpoint mirrors branch-level writes onto `branches`, so reading
   * it here sees what the Invoices settings pane saved. A lookup that fails
   * is a nicety missed, never a failed save - hence the empty object.
   */
  async _defaults(wall) {
    try {
      const branches = await this.getCollection('branches');
      const b = await branches.findOne(
        { _id: wall.branch_id },
        {
          projection: {
            invoice_prefix: 1,
            invoice_due_days: 1,
            invoice_terms: 1,
            quote_default_payment_method: 1,
            quote_default_bank_details: 1,
          },
        }
      );
      return b || {};
    } catch (e) {
      return {};
    }
  }

  static _prefixOf(defaults) {
    const raw = String((defaults && defaults.invoice_prefix) || '').trim();
    return (raw || DEFAULT_PREFIX).slice(0, 12);
  }

  static _dueDaysOf(defaults) {
    const n = parseInt(defaults && defaults.invoice_due_days, 10);
    if (!Number.isFinite(n) || n < 0) return DEFAULT_DUE_DAYS;
    return Math.min(n, 365);
  }

  /*
   * Next invoice number for the branch: <prefix>000001, resilient to holes
   * AND to a prefix change - the trailing digits are what count, whatever
   * text sits before them, so renaming INV- to BILL- continues the sequence
   * rather than restarting it at 1 beside the old numbers.
   */
  async _nextInvoiceId(collection, wall, prefix) {
    const rows = await collection
      .find({ branch_id: wall.branch_id }, { projection: { invoice_id: 1 } })
      .toArray();
    let max = 0;
    for (const r of rows) {
      const m = String((r && r.invoice_id) || '').match(/(\d+)\s*$/);
      const n = m ? Number(m[1]) : NaN;
      if (Number.isFinite(n)) max = Math.max(max, n);
    }
    return prefix + String(max + 1).padStart(6, '0');
  }

  /* The list index - same reasoning as quote_list_by_branch: the wall plus
     the sort, so listing is a walk and not a scan, per DATABASE. */
  async _ensureListIndex(collection) {
    await ensureIndexOnce(
      collection,
      { branch_id: 1, license: 1, created_date: -1 },
      { name: 'invoice_list_by_branch' }
    );
    await ensureIndexOnce(
      collection,
      { branch_id: 1, license: 1, due_date: 1 },
      { name: 'invoice_list_by_due' }
    );
    await ensureIndexOnce(
      collection,
      { branch_id: 1, license: 1, total: -1 },
      { name: 'invoice_list_by_total' }
    );
  }

  /* Overdue is a reading of the document, never a stored state. */
  static isOverdue(doc, now = new Date()) {
    if (!doc || !OWED.includes(doc.status)) return false;
    const due = doc.due_date ? new Date(doc.due_date) : null;
    return !!(due && !Number.isNaN(due.getTime()) && due < now);
  }

  static _decorate(doc, now = new Date()) {
    if (!doc) return doc;
    return { ...doc, is_overdue: InvoiceRepository.isOverdue(doc, now) };
  }

  /* Create (id empty) or update - draft/sent only; a booked invoice's numbers
     belong to the sale that was recorded from it. */
  async upsertInvoice(data = {}, id = '', context = {}) {
    try {
      const wall = this._wall(context);
      if (!wall) return { status: false, data: null, message: 'Branch ID not found' };

      const parsed = docMath.normalizeLines(data.lines || data.items, 'invoice');
      if (parsed.error) return { status: false, data: null, message: parsed.error };

      const money = docMath.computeTotals({
        lines: parsed.lines,
        charges: docMath.normalizeCharges(data.charges),
        discount: data.discount,
        clientTotal: data.total,
        clientTaxTotal: data.tax_total,
      });

      const now = new Date();
      const collection = await this.getCollection(this.collectionName);

      const doc = {
        branch_id: wall.branch_id,
        branch_name: String(context.branchName || '').trim(),
        customer_id:
          data.customer_id && ObjectId.isValid(String(data.customer_id))
            ? new ObjectId(String(data.customer_id))
            : null,
        customer_name: String(data.customer_name || '').trim(),
        customer_phone: String(data.customer_phone || '').trim(),
        customer_address: String(data.customer_address || '')
          .trim()
          .slice(0, 300),
        customer_gstin: String(data.customer_gstin || '')
          .trim()
          .slice(0, 20),
        customer_email: String(data.customer_email || '')
          .trim()
          .slice(0, 120),
        payment_method: String(data.payment_method || '')
          .trim()
          .slice(0, 60),
        bank_details: String(data.bank_details || '')
          .trim()
          .slice(0, 500),
        terms: String(data.terms || '')
          .trim()
          .slice(0, 1500),
        /* A reference the CUSTOMER gave - their PO number, a job id - printed
           on the document because their accounts department matches on it. */
        reference: String(data.reference || '')
          .trim()
          .slice(0, 60),
        items: parsed.lines,
        charges: money.charges,
        discount: money.discount,
        charges_total: money.charges_total,
        custom_blocks: docMath.normalizeBlocks(data.custom_blocks),
        layout: docMath.normalizeLayout(data.layout),
        notes: String(data.notes || '')
          .trim()
          .slice(0, 2000),
        subtotal: money.subtotal,
        tax_total: money.tax_total,
        total: money.total,
        due_date: docMath.dateOrNull(data.due_date),
        updated_date: now,
        updated_by: String(context.userName || ''),
      };
      if (wall.license) doc.license = wall.license;

      if (id) {
        if (!ObjectId.isValid(String(id))) {
          return { status: false, data: null, message: 'Invalid invoice id' };
        }
        /* An edit keeps the balance honest: nothing is owed on a draft, so
           the balance IS the total until a sale says otherwise. */
        doc.balance = money.total;
        doc.paid_amount = 0;
        const result = await collection.updateOne(
          { _id: new ObjectId(String(id)), ...wall, status: { $in: EDITABLE } },
          { $set: doc }
        );
        if (!result.matchedCount) {
          return {
            status: false,
            data: null,
            message: 'This invoice can no longer be edited - it has been issued, or it is closed',
          };
        }
        return { status: true, data: { id: String(id) }, message: 'Invoice updated' };
      }

      /* A new invoice starts from the shop's invoice defaults wherever the
         editor sent nothing: payment method and bank details are shared with
         quotations (a shop has one bank account), the terms are the invoice's
         own, and the due date follows the shop's credit days. */
      const defaults = await this._defaults(wall);
      if (!doc.payment_method)
        doc.payment_method = String(defaults.quote_default_payment_method || '')
          .trim()
          .slice(0, 60);
      if (!doc.bank_details)
        doc.bank_details = String(defaults.quote_default_bank_details || '')
          .trim()
          .slice(0, 500);
      if (!doc.terms)
        doc.terms = String(defaults.invoice_terms || '')
          .trim()
          .slice(0, 1500);
      if (!doc.due_date) {
        const days = InvoiceRepository._dueDaysOf(defaults);
        doc.due_date = new Date(now.getTime() + days * 86400000);
      }

      doc.invoice_id = await this._nextInvoiceId(
        collection,
        wall,
        InvoiceRepository._prefixOf(defaults)
      );
      doc.status = 'draft';
      doc.issue_date = now;
      doc.paid_amount = 0;
      doc.balance = money.total;
      doc.sale_id = null;
      doc.sale_number = '';
      /* Lineage: the quote this invoice grew from, if any. */
      doc.source_quote_id =
        data.source_quote_id && ObjectId.isValid(String(data.source_quote_id))
          ? new ObjectId(String(data.source_quote_id))
          : null;
      doc.source_quote_number = String(data.source_quote_number || '')
        .trim()
        .slice(0, 40);
      doc.created_date = now;
      doc.created_by = String(context.userName || '');
      const inserted = await collection.insertOne(doc);
      return {
        status: true,
        data: { id: String(inserted.insertedId), invoice_id: doc.invoice_id },
        message: 'Invoice saved',
      };
    } catch (error) {
      console.error('Error in InvoiceRepository.upsertInvoice:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  /*
   * Quote -> invoice. The quote's lines, charges and discount become the
   * invoice's, at the quoted prices - the promise the quote made is what the
   * invoice bills. Terms are the shop's INVOICE terms (a quotation's "valid
   * till" wording has no place on a bill); everything else carries over.
   */
  async createFromQuote(quote, context = {}) {
    if (!quote || !Array.isArray(quote.items) || !quote.items.length) {
      return { status: false, data: null, message: 'This quote has no lines to invoice' };
    }
    const payload = {
      lines: quote.items.map((l) => ({
        kind: l.kind,
        item_id: l.item_id ? String(l.item_id) : '',
        item_name: l.item_name,
        description: l.description || '',
        barcode_id: l.barcode_id || '',
        qty: l.qty,
        unit_price: l.unit_price,
        discount: l.discount ? { type: l.discount.type, value: l.discount.value } : undefined,
        tax_name: l.tax_name || '',
        tax_value: l.tax_value || 0,
        tax_type: l.tax_type || '',
      })),
      charges: (quote.charges || []).map((c) => ({
        name: c.name,
        type: c.type,
        value: c.value,
        sign: c.sign,
      })),
      discount: quote.discount
        ? { type: quote.discount.type, value: quote.discount.value }
        : undefined,
      customer_id: quote.customer_id ? String(quote.customer_id) : '',
      customer_name: quote.customer_name || '',
      customer_phone: quote.customer_phone || '',
      customer_address: quote.customer_address || '',
      customer_gstin: quote.customer_gstin || '',
      customer_email: quote.customer_email || '',
      payment_method: quote.payment_method || '',
      bank_details: quote.bank_details || '',
      custom_blocks: quote.custom_blocks || [],
      layout: quote.layout || undefined,
      notes: quote.notes || '',
      tax_total: quote.tax_total,
      total: quote.total,
      source_quote_id: String(quote._id || ''),
      source_quote_number: quote.quote_id || '',
    };
    return this.upsertInvoice(payload, '', context);
  }

  async listInvoices(params = {}, context = {}) {
    try {
      const wall = this._wall(context);
      if (!wall) return { status: false, data: null, message: 'Branch ID not found' };
      const filter = { ...wall };
      const now = new Date();
      const status = String(params.status || '');
      if (STATUSES.includes(status)) {
        filter.status = status;
      } else if (status === 'overdue') {
        /* the read-time fact, as a query: owed and past due */
        filter.status = { $in: OWED };
        filter.due_date = { $lt: now };
      } else if (status === 'owed') {
        filter.status = { $in: OWED };
      }

      const term = String(params.search || '')
        .trim()
        .slice(0, 80);
      if (term) {
        const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rx =
          String(params.exact) === 'true' ? new RegExp(`^${safe}$`, 'i') : new RegExp(safe, 'i');
        const field = String(params.field || 'all');
        if (field === 'invoice_id') filter.invoice_id = rx;
        else if (field === 'customer_name') filter.customer_name = rx;
        else filter.$or = [{ customer_name: rx }, { invoice_id: rx }];
      }

      /* Date range on created_date, same day-end rule as quotes: a date-only
         "to" includes its whole day; a precise instant is kept as sent. */
      const range = {};
      const rawFrom = params.from ? String(params.from) : '';
      const rawTo = params.to ? String(params.to) : '';
      const from = rawFrom ? new Date(rawFrom) : null;
      const to = rawTo ? new Date(rawTo) : null;
      if (from && !Number.isNaN(from.getTime())) range.$gte = from;
      if (to && !Number.isNaN(to.getTime())) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(rawTo.trim())) to.setHours(23, 59, 59, 999);
        range.$lte = to;
      }
      if (Object.keys(range).length) filter.created_date = range;

      const limit = Math.min(Math.max(Number(params.limit) || 100, 1), 200);
      const page = Math.max(Number(params.page) || 1, 1);
      const collection = await this.getCollection(this.collectionName);
      await this._ensureListIndex(collection);

      const SORTS = {
        recent: { created_date: -1 },
        total_desc: { total: -1, _id: -1 },
        total_asc: { total: 1, _id: -1 },
        due_asc: { due_date: 1, _id: -1 },
        due_desc: { due_date: -1, _id: -1 },
        balance_desc: { balance: -1, _id: -1 },
      };
      const sort = SORTS[String(params.sort || '')] || { created_date: -1 };

      /* A text search skips the count on purpose (see quotes): one extra row
         answers "is there more" without a second regex pass. */
      const countable = !term;
      let total = null;
      let rows;
      if (countable) {
        total = await collection.countDocuments(filter);
        rows = await collection
          .find(filter)
          .sort(sort)
          .skip((page - 1) * limit)
          .limit(limit)
          .toArray();
      } else {
        rows = await collection
          .find(filter)
          .sort(sort)
          .skip((page - 1) * limit)
          .limit(limit + 1)
          .toArray();
      }
      const hasMore = countable ? page * limit < total : rows.length > limit;
      if (!countable && rows.length > limit) rows = rows.slice(0, limit);

      return {
        status: true,
        data: rows.map((r) => InvoiceRepository._decorate(r, now)),
        meta: {
          total,
          page,
          limit,
          hasMore,
          pages: total === null ? null : Math.max(1, Math.ceil(total / limit)),
        },
        message: 'success',
      };
    } catch (error) {
      console.error('Error in InvoiceRepository.listInvoices:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  /* What the shop is owed, for the list's header strip: count and sum of
     every owed invoice, and of the overdue subset. Two cheap aggregations
     down the list index. */
  async summary(context = {}) {
    try {
      const wall = this._wall(context);
      if (!wall) return { status: false, data: null, message: 'Branch ID not found' };
      const collection = await this.getCollection(this.collectionName);
      const now = new Date();
      const rows = await collection
        .aggregate([
          { $match: { ...wall, status: { $in: OWED } } },
          {
            $group: {
              _id: null,
              owed_count: { $sum: 1 },
              owed_total: { $sum: { $ifNull: ['$balance', '$total'] } },
              overdue_count: {
                $sum: { $cond: [{ $lt: ['$due_date', now] }, 1, 0] },
              },
              overdue_total: {
                $sum: {
                  $cond: [{ $lt: ['$due_date', now] }, { $ifNull: ['$balance', '$total'] }, 0],
                },
              },
            },
          },
        ])
        .toArray();
      const s = rows[0] || {};
      return {
        status: true,
        data: {
          owed_count: s.owed_count || 0,
          owed_total: docMath.round2(s.owed_total || 0),
          overdue_count: s.overdue_count || 0,
          overdue_total: docMath.round2(s.overdue_total || 0),
        },
        message: 'success',
      };
    } catch (error) {
      console.error('Error in InvoiceRepository.summary:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  async getInvoice(id, context = {}) {
    try {
      const wall = this._wall(context);
      if (!wall) return { status: false, data: null, message: 'Branch ID not found' };
      if (!ObjectId.isValid(String(id))) {
        return { status: false, data: null, message: 'Invalid invoice id' };
      }
      const collection = await this.getCollection(this.collectionName);
      const doc = await collection.findOne({ _id: new ObjectId(String(id)), ...wall });
      if (!doc) return { status: false, data: null, message: 'Invoice not found' };
      return { status: true, data: InvoiceRepository._decorate(doc), message: 'success' };
    } catch (error) {
      console.error('Error in InvoiceRepository.getInvoice:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  /*
   * The mirror. A snapshot of the sale's payment state (built by
   * services/invoice-sync from the sale document) becomes the invoice's
   * status and balance. Replay-safe: the same snapshot twice is the same
   * document. A cancelled invoice is left alone - the sale that reached it
   * is somebody else's problem to explain, and silently un-cancelling a
   * document a customer was told is void would be worse.
   */
  async applySaleSnapshot(id, snapshot = {}, context = {}) {
    try {
      const wall = this._wall(context);
      if (!wall) return { status: false, data: null, message: 'Branch ID not found' };
      if (!ObjectId.isValid(String(id))) {
        return { status: false, data: null, message: 'Invalid invoice id' };
      }
      const saleId =
        snapshot.sale_id && ObjectId.isValid(String(snapshot.sale_id))
          ? new ObjectId(String(snapshot.sale_id))
          : null;
      if (!saleId) return { status: false, data: null, message: 'A sale id is required' };

      const collection = await this.getCollection(this.collectionName);
      const doc = await collection.findOne({ _id: new ObjectId(String(id)), ...wall });
      if (!doc) return { status: false, data: null, message: 'Invoice not found' };
      if (doc.status === 'cancelled') {
        return { status: false, data: null, message: 'This invoice was cancelled' };
      }
      /* One invoice, one sale. A different sale arriving is refused, not
         merged - two tills booking the same invoice is a mistake to surface. */
      if (doc.sale_id && String(doc.sale_id) !== String(saleId)) {
        return {
          status: false,
          data: null,
          message: 'This invoice was already recorded as sale ' + (doc.sale_number || ''),
        };
      }

      /* What is owed is what the SALE says - a shop with round-off on books
         210 for a 209.85 document, and the customer pays the sale's figure.
         The printed total stays the document's own; sale_total is kept beside
         it so the sheet can show both when they differ. */
      const saleTotal = docMath.round2(
        Number.isFinite(Number(snapshot.total)) && Number(snapshot.total) > 0
          ? Number(snapshot.total)
          : Number(doc.total) || 0
      );
      const paid = Math.max(
        0,
        Math.min(saleTotal, docMath.round2(Number(snapshot.paid_amount) || 0))
      );
      const balance = docMath.round2(Math.max(0, saleTotal - paid));
      const status = balance <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
      const now = new Date();
      const set = {
        status,
        sale_id: saleId,
        sale_number: String(snapshot.sale_number || doc.sale_number || '').slice(0, 40),
        sale_total: saleTotal,
        paid_amount: paid,
        balance,
        sale_payment_status: String(snapshot.payment_status || '').slice(0, 20),
        synced_date: now,
        updated_date: now,
      };
      if (!doc.sale_id) set.issued_date = now;
      if (status === 'paid' && !doc.paid_date) set.paid_date = now;
      if (status !== 'paid' && doc.paid_date) set.paid_date = null;
      await collection.updateOne({ _id: doc._id }, { $set: set });
      return {
        status: true,
        data: { id: String(doc._id), status, paid_amount: paid, balance },
        message: 'Invoice ' + status,
      };
    } catch (error) {
      console.error('Error in InvoiceRepository.applySaleSnapshot:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  /*
   * The one transition that needs no sale: cancel, while the document is a
   * draft. Once issued, stock and tax have moved and a customer may hold the
   * paper - the reversal is a return on the sale (a credit note is the
   * follow-up), never a word written over a record that says otherwise.
   */
  async transition(id, action, data = {}, context = {}) {
    try {
      const wall = this._wall(context);
      if (!wall) return { status: false, data: null, message: 'Branch ID not found' };
      if (!ObjectId.isValid(String(id))) {
        return { status: false, data: null, message: 'Invalid invoice id' };
      }
      const collection = await this.getCollection(this.collectionName);
      const doc = await collection.findOne({ _id: new ObjectId(String(id)), ...wall });
      if (!doc) return { status: false, data: null, message: 'Invoice not found' };

      if (action === 'cancel') {
        if (doc.status === 'cancelled') {
          return { status: false, data: null, message: 'This invoice is already cancelled' };
        }
        if (doc.status !== 'draft') {
          return {
            status: false,
            data: null,
            message:
              'This invoice has been issued - reverse it with a return on sale ' +
              (doc.sale_number || '') +
              ' instead',
          };
        }
        await collection.updateOne(
          { _id: doc._id },
          {
            $set: {
              status: 'cancelled',
              cancelled_date: new Date(),
              cancel_reason: String(data.reason || '')
                .trim()
                .slice(0, 200),
              updated_date: new Date(),
            },
          }
        );
        return { status: true, data: { id: String(doc._id) }, message: 'Invoice cancelled' };
      }

      return { status: false, data: null, message: 'Unknown action' };
    } catch (error) {
      console.error('Error in InvoiceRepository.transition:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  /* Share metadata: which S3 object currently represents this invoice, and
     when it first left the shop. Sharing changes no status - a shared draft
     is a proforma, a shared issued invoice is a bill - so `sent_date` is
     a fact on the record, not a state of it. */
  async recordShare(id, share, context) {
    try {
      const wall = this._wall(context);
      if (!wall) return { status: false, data: null, message: 'Branch ID not found' };
      if (!ObjectId.isValid(String(id))) {
        return { status: false, data: null, message: 'Invalid invoice id' };
      }
      const collection = await this.getCollection(this.collectionName);
      const result = await collection.updateOne(
        { _id: new ObjectId(String(id)), ...wall },
        {
          $set: {
            share: {
              key: String(share.key || ''),
              url: String(share.url || ''),
              rev: Number(share.rev) || 1,
              at: new Date(),
            },
            updated_date: new Date(),
          },
        }
      );
      if (!result.matchedCount) return { status: false, data: null, message: 'Invoice not found' };
      await collection.updateOne(
        { _id: new ObjectId(String(id)), ...wall, sent_date: { $exists: false } },
        { $set: { sent_date: new Date() } }
      );
      return { status: true, data: { rev: Number(share.rev) || 1 }, message: 'Share recorded' };
    } catch (error) {
      console.error('Error in InvoiceRepository.recordShare:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  /* Delete: drafts only - an issued invoice has a sale behind it. */
  async deleteInvoice(id, context = {}) {
    try {
      const wall = this._wall(context);
      if (!wall) return { status: false, data: null, message: 'Branch ID not found' };
      if (!ObjectId.isValid(String(id))) {
        return { status: false, data: null, message: 'Invalid invoice id' };
      }
      const collection = await this.getCollection(this.collectionName);
      const result = await collection.deleteOne({
        _id: new ObjectId(String(id)),
        ...wall,
        status: { $in: EDITABLE },
      });
      if (!result.deletedCount) {
        return {
          status: false,
          data: null,
          message: 'Only a draft can be deleted - an issued invoice is reversed on its sale',
        };
      }
      return { status: true, data: { id: String(id) }, message: 'Invoice deleted' };
    } catch (error) {
      console.error('Error in InvoiceRepository.deleteInvoice:', error);
      return { status: false, data: null, message: error.message };
    }
  }
}

module.exports = InvoiceRepository;
module.exports.BOOKED = BOOKED;
