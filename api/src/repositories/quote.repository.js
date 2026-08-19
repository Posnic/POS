'use strict';

/*
 * Quotes (Lightspeed study LS2): a priced offer, printable and convertible,
 * and NOTHING else. A quote never touches stock, never records a payment,
 * never becomes revenue by itself - the sale it converts into does all of
 * that through the ordinary sale path, which sends source_quote_id so the
 * quote can be stamped converted. A test pins that the only collection this
 * repository touches is its own.
 */

const BaseModel = require('../models/base.model');
const { ObjectId } = require('mongodb');

const STATUSES = Object.freeze(['open', 'converted', 'cancelled']);

class QuoteRepository extends BaseModel {
  constructor() {
    super('quotes');
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

  /* Next quote number for the branch: QUO-000001 style, resilient to holes. */
  async _nextQuoteId(collection, wall) {
    const rows = await collection
      .find({ branch_id: wall.branch_id }, { projection: { quote_id: 1 } })
      .toArray();
    let max = 0;
    for (const r of rows) {
      const n = Number(String((r && r.quote_id) || '').replace(/^QUO-?/i, ''));
      if (Number.isFinite(n)) max = Math.max(max, n);
    }
    return 'QUO-' + String(max + 1).padStart(6, '0');
  }

  _normalizeLines(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return { error: 'Add at least one line' };
    if (rows.length > 500) return { error: 'At most 500 lines per quote' };
    const lines = [];
    for (const row of rows) {
      if (!row || !ObjectId.isValid(String(row.item_id))) continue;
      const qty = Number(row.qty);
      const price = Number(row.unit_price);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const unitPrice = Number.isFinite(price) && price >= 0 ? price : 0;
      lines.push({
        item_id: new ObjectId(String(row.item_id)),
        item_name: String(row.item_name || '').trim(),
        barcode_id: String(row.barcode_id || '').trim(),
        qty,
        unit_price: unitPrice,
        line_total: Math.round(qty * unitPrice * 100) / 100,
      });
    }
    if (!lines.length) return { error: 'No valid lines - each needs an item and a quantity' };
    return { lines };
  }

  _validUntil(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /* Create (id empty) or update - open quotes only; history is not editable. */
  async upsertQuote(data = {}, id = '', context = {}) {
    try {
      const wall = this._wall(context);
      if (!wall) return { status: false, data: null, message: 'Branch ID not found' };

      const parsed = this._normalizeLines(data.items);
      if (parsed.error) return { status: false, data: null, message: parsed.error };

      const subtotal = Math.round(parsed.lines.reduce((s, l) => s + l.line_total, 0) * 100) / 100;
      const taxTotal = Number(data.tax_total);
      const total = Number(data.total);

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
        // Professional quotation fields (owner spec): all presence-tolerant
        // strings the preview edits in place.
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
        items: parsed.lines,
        subtotal,
        tax_total: Number.isFinite(taxTotal) && taxTotal >= 0 ? taxTotal : 0,
        total: Number.isFinite(total) && total > 0 ? total : subtotal,
        valid_until: this._validUntil(data.valid_until),
        note: String(data.note || '')
          .trim()
          .slice(0, 500),
        updated_date: now,
        updated_by: String(context.userName || ''),
      };
      if (wall.license) doc.license = wall.license;

      if (id) {
        if (!ObjectId.isValid(String(id))) {
          return { status: false, data: null, message: 'Invalid quote id' };
        }
        const result = await collection.updateOne(
          { _id: new ObjectId(String(id)), ...wall, status: 'open' },
          { $set: doc }
        );
        if (!result.matchedCount) {
          return { status: false, data: null, message: 'Only an open quote can be edited' };
        }
        return { status: true, data: { id: String(id) }, message: 'Quote updated' };
      }

      /* A new quote starts from the shop's quotation defaults (settings)
         wherever the sale screen sent nothing - each stays editable on the
         quote's preview. A defaults lookup that fails is only a nicety
         missed, never a failed save. */
      if (!doc.payment_method || !doc.bank_details || !doc.terms) {
        try {
          const branches = await this.getCollection('branches');
          const b = await branches.findOne(
            { _id: wall.branch_id },
            {
              projection: {
                quote_default_payment_method: 1,
                quote_default_bank_details: 1,
                quote_default_terms: 1,
              },
            }
          );
          if (b) {
            if (!doc.payment_method)
              doc.payment_method = String(b.quote_default_payment_method || '')
                .trim()
                .slice(0, 60);
            if (!doc.bank_details)
              doc.bank_details = String(b.quote_default_bank_details || '')
                .trim()
                .slice(0, 500);
            if (!doc.terms)
              doc.terms = String(b.quote_default_terms || '')
                .trim()
                .slice(0, 1500);
          }
        } catch (e) {
          /* defaults are a nicety */
        }
      }

      doc.quote_id = await this._nextQuoteId(collection, wall);
      doc.status = 'open';
      doc.converted_sale_id = null;
      doc.created_date = now;
      doc.created_by = String(context.userName || '');
      const inserted = await collection.insertOne(doc);
      return {
        status: true,
        data: { id: String(inserted.insertedId), quote_id: doc.quote_id },
        message: 'Quote saved',
      };
    } catch (error) {
      console.error('Error in QuoteRepository.upsertQuote:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  async listQuotes(params = {}, context = {}) {
    try {
      const wall = this._wall(context);
      if (!wall) return { status: false, data: null, message: 'Branch ID not found' };
      const filter = { ...wall };
      if (params.status && STATUSES.includes(String(params.status))) {
        filter.status = String(params.status);
      }
      const limit = Math.min(Number(params.limit) || 100, 200);
      const collection = await this.getCollection(this.collectionName);
      const rows = await collection.find(filter).sort({ created_date: -1 }).limit(limit).toArray();
      return { status: true, data: rows, message: 'success' };
    } catch (error) {
      console.error('Error in QuoteRepository.listQuotes:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  async getQuote(id, context = {}) {
    try {
      const wall = this._wall(context);
      if (!wall) return { status: false, data: null, message: 'Branch ID not found' };
      if (!ObjectId.isValid(String(id))) {
        return { status: false, data: null, message: 'Invalid quote id' };
      }
      const collection = await this.getCollection(this.collectionName);
      const doc = await collection.findOne({ _id: new ObjectId(String(id)), ...wall });
      if (!doc) return { status: false, data: null, message: 'Quote not found' };
      return { status: true, data: doc, message: 'success' };
    } catch (error) {
      console.error('Error in QuoteRepository.getQuote:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  /*
   * Transitions: convert (open -> converted, stamping the sale that came
   * from it) and cancel (open -> cancelled). Converting an already
   * converted quote with the SAME sale id is a replay and succeeds;
   * with a different sale id it is refused - one quote, one sale.
   */
  async transition(id, action, data = {}, context = {}) {
    try {
      const wall = this._wall(context);
      if (!wall) return { status: false, data: null, message: 'Branch ID not found' };
      if (!ObjectId.isValid(String(id))) {
        return { status: false, data: null, message: 'Invalid quote id' };
      }
      const collection = await this.getCollection(this.collectionName);
      const doc = await collection.findOne({ _id: new ObjectId(String(id)), ...wall });
      if (!doc) return { status: false, data: null, message: 'Quote not found' };

      if (action === 'cancel') {
        if (doc.status !== 'open') {
          return { status: false, data: null, message: 'Only an open quote can be cancelled' };
        }
        await collection.updateOne(
          { _id: doc._id },
          { $set: { status: 'cancelled', updated_date: new Date() } }
        );
        return { status: true, data: { id: String(doc._id) }, message: 'Quote cancelled' };
      }

      if (action === 'convert') {
        const saleId =
          data.sale_id && ObjectId.isValid(String(data.sale_id))
            ? new ObjectId(String(data.sale_id))
            : null;
        if (doc.status === 'converted') {
          const same =
            saleId && doc.converted_sale_id && String(doc.converted_sale_id) === String(saleId);
          return same
            ? { status: true, data: { id: String(doc._id) }, message: 'Quote already converted' }
            : { status: false, data: null, message: 'This quote was already converted to a sale' };
        }
        if (doc.status !== 'open') {
          return { status: false, data: null, message: 'Only an open quote can be converted' };
        }
        await collection.updateOne(
          { _id: doc._id },
          {
            $set: {
              status: 'converted',
              converted_sale_id: saleId,
              converted_date: new Date(),
              updated_date: new Date(),
            },
          }
        );
        return { status: true, data: { id: String(doc._id) }, message: 'Quote converted' };
      }

      return { status: false, data: null, message: 'Unknown action' };
    } catch (error) {
      console.error('Error in QuoteRepository.transition:', error);
      return { status: false, data: null, message: error.message };
    }
  }

  /* Delete: open quotes only, enforced in the query itself. */
  async deleteQuote(id, context = {}) {
    try {
      const wall = this._wall(context);
      if (!wall) return { status: false, data: null, message: 'Branch ID not found' };
      if (!ObjectId.isValid(String(id))) {
        return { status: false, data: null, message: 'Invalid quote id' };
      }
      const collection = await this.getCollection(this.collectionName);
      const result = await collection.deleteOne({
        _id: new ObjectId(String(id)),
        ...wall,
        status: 'open',
      });
      if (!result.deletedCount) {
        return { status: false, data: null, message: 'Only an open quote can be deleted' };
      }
      return { status: true, data: { id: String(id) }, message: 'Quote deleted' };
    } catch (error) {
      console.error('Error in QuoteRepository.deleteQuote:', error);
      return { status: false, data: null, message: error.message };
    }
  }
}

module.exports = QuoteRepository;
