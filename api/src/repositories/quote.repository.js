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

const STATUSES = Object.freeze([
  'open',
  'draft',
  'sent',
  'accepted',
  'declined',
  'converted',
  'cancelled',
]);
/* draft and sent behave like open: still editable, still convertible.
   accepted freezes edits (the promise is made); declined/converted/
   cancelled are history. */
const EDITABLE = Object.freeze(['open', 'draft', 'sent']);

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

  static _round2(n) {
    return Math.round(n * 100) / 100;
  }

  /* One optional discount, per line or quote-level: percent of the gross
     (0-100) or a flat amount capped at the gross. Anything malformed means
     "no discount", never a rejected save. */
  static _discountOf(raw, gross) {
    if (!raw || typeof raw !== 'object') return null;
    const type = raw.type === 'percent' ? 'percent' : raw.type === 'amount' ? 'amount' : null;
    const value = Number(raw.value);
    if (!type || !Number.isFinite(value) || value <= 0) return null;
    const computed =
      type === 'percent'
        ? QuoteRepository._round2((gross * Math.min(value, 100)) / 100)
        : QuoteRepository._round2(Math.min(value, gross));
    return { type, value: QuoteRepository._round2(value), computed };
  }

  /*
   * Lines, generalized (QUOTATION_MODULE_DESIGN Q1): a row is either a
   * catalog item snapshot (kind 'item') or free text (kind 'custom'). Edits
   * live HERE - the catalog is never touched by a quote. A row with a name
   * but no valid item id heals into a custom row rather than vanishing.
   */
  _normalizeLines(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return { error: 'Add at least one line' };
    if (rows.length > 500) return { error: 'At most 500 lines per quote' };
    const lines = [];
    for (const row of rows) {
      if (!row) continue;
      const hasItem = ObjectId.isValid(String(row.item_id));
      const name = String(row.item_name || row.name || '').trim();
      if (!hasItem && !name) continue;
      const qty = Number(row.qty);
      const price = Number(row.unit_price);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const unitPrice = Number.isFinite(price) && price >= 0 ? price : 0;
      const gross = QuoteRepository._round2(qty * unitPrice);
      const discount = QuoteRepository._discountOf(row.discount, gross);
      /*
       * Per-line tax (owner: "each line item will have different tax -
       * indian GST like that"), seeded from the item's own configured tax.
       * Inclusive stays inside the price; exclusive adds on top - the same
       * convention the sale runs, so a converted quote's tax matches by
       * construction.
       */
      const taxRateRaw = Number(row.tax_value !== undefined ? row.tax_value : row.tax);
      const taxRate = Number.isFinite(taxRateRaw) && taxRateRaw > 0 ? Math.min(taxRateRaw, 100) : 0;
      const taxTypeRaw = String(row.tax_type || '').toLowerCase();
      const taxType =
        taxRate > 0 ? (taxTypeRaw.indexOf('ex') === 0 ? 'exclusive' : 'inclusive') : '';
      const taxable = QuoteRepository._round2(gross - (discount ? discount.computed : 0));
      const taxAmount =
        taxRate > 0
          ? taxType === 'exclusive'
            ? QuoteRepository._round2((taxable * taxRate) / 100)
            : QuoteRepository._round2(taxable - taxable / (1 + taxRate / 100))
          : 0;
      lines.push({
        kind: hasItem && row.kind !== 'custom' ? 'item' : 'custom',
        item_id: hasItem && row.kind !== 'custom' ? new ObjectId(String(row.item_id)) : null,
        item_name: name.slice(0, 200),
        description: String(row.description || '')
          .trim()
          .slice(0, 500),
        barcode_id: String(row.barcode_id || '').trim(),
        qty,
        unit_price: unitPrice,
        discount,
        tax_name: String(row.tax_name || '')
          .trim()
          .slice(0, 40),
        tax_value: taxRate,
        tax_type: taxType,
        tax_amount: taxAmount,
        line_total:
          taxType === 'exclusive' ? QuoteRepository._round2(taxable + taxAmount) : taxable,
      });
    }
    if (!lines.length)
      return { error: 'No valid lines - each needs an item or a name, and a quantity' };
    return { lines };
  }

  /* Named charge/adjustment rows - "tax in any name" (CGST 9%, Freight,
     Installation), percent-of-base or flat, sign -1 for named deductions. */
  _normalizeCharges(rows) {
    if (!Array.isArray(rows)) return [];
    const charges = [];
    for (const row of rows.slice(0, 20)) {
      if (!row || typeof row !== 'object') continue;
      const name = String(row.name || '')
        .trim()
        .slice(0, 60);
      const type = row.type === 'percent' ? 'percent' : row.type === 'amount' ? 'amount' : null;
      const value = Number(row.value);
      if (!name || !type || !Number.isFinite(value) || value < 0) continue;
      charges.push({
        name,
        type,
        value: QuoteRepository._round2(value),
        sign: Number(row.sign) === -1 ? -1 : 1,
        computed: 0,
      });
    }
    return charges;
  }

  _normalizeBlocks(rows) {
    if (!Array.isArray(rows)) return [];
    const blocks = [];
    for (const row of rows.slice(0, 10)) {
      if (!row || typeof row !== 'object') continue;
      const title = String(row.title || '')
        .trim()
        .slice(0, 80);
      const text = String(row.text || '')
        .trim()
        .slice(0, 2000);
      if (!title && !text) continue;
      blocks.push({ title, text });
    }
    return blocks;
  }

  _normalizeLayout(value) {
    const KNOWN = ['billto', 'items', 'charges', 'payment', 'bank', 'terms', 'notes', 'custom'];
    if (!Array.isArray(value)) return null;
    const out = [];
    for (const v of value) {
      const t = String(v || '').trim();
      if (KNOWN.includes(t) && !out.includes(t)) out.push(t);
    }
    return out.length ? out : null;
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

      const parsed = this._normalizeLines(data.lines || data.items);
      if (parsed.error) return { status: false, data: null, message: parsed.error };

      const subtotal = QuoteRepository._round2(parsed.lines.reduce((s, l) => s + l.line_total, 0));
      const charges = this._normalizeCharges(data.charges);
      const quoteDiscount = QuoteRepository._discountOf(data.discount, subtotal);
      const chargeBase = QuoteRepository._round2(
        subtotal - (quoteDiscount ? quoteDiscount.computed : 0)
      );
      let chargesTotal = 0;
      for (const c of charges) {
        c.computed =
          c.type === 'percent' ? QuoteRepository._round2((chargeBase * c.value) / 100) : c.value;
        chargesTotal += c.sign * c.computed;
      }
      chargesTotal = QuoteRepository._round2(chargesTotal);
      const computedTotal = Math.max(0, QuoteRepository._round2(chargeBase + chargesTotal));
      /*
       * Money authority (QUOTATION_MODULE_DESIGN rule 4): the moment any of
       * the new money fields is used (charges, quote discount, line
       * discounts), the server's arithmetic is the stored truth and the
       * client's total is advisory. The legacy sale-screen path - plain
       * lines plus the cart's own grand total - keeps its behavior.
       */
      const hasNewMoney =
        charges.length > 0 || quoteDiscount !== null || parsed.lines.some((l) => l.discount);
      /* Lines carrying their own tax make the tax total OURS to compute;
         the legacy path (sale-screen carts) keeps sending its own figure. */
      const linesCarryTax = parsed.lines.some((l) => l.tax_value > 0);
      const computedTaxTotal = QuoteRepository._round2(
        parsed.lines.reduce((s, l) => s + (l.tax_amount || 0), 0)
      );
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
        charges,
        discount: quoteDiscount,
        charges_total: chargesTotal,
        custom_blocks: this._normalizeBlocks(data.custom_blocks),
        layout: this._normalizeLayout(data.layout),
        notes: String(data.notes || '')
          .trim()
          .slice(0, 2000),
        subtotal,
        tax_total: linesCarryTax
          ? computedTaxTotal
          : Number.isFinite(taxTotal) && taxTotal >= 0
            ? taxTotal
            : 0,
        total: hasNewMoney ? computedTotal : Number.isFinite(total) && total > 0 ? total : subtotal,
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
          { _id: new ObjectId(String(id)), ...wall, status: { $in: EDITABLE } },
          { $set: doc }
        );
        if (!result.matchedCount) {
          return {
            status: false,
            data: null,
            message: 'This quote can no longer be edited - it is accepted, converted or closed',
          };
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

  /*
   * Quote list: status filter, free-text search and paging all decided
   * HERE. They used to be decided in the browser over whatever the first
   * 100 rows happened to be, which was not merely slow - past 100 quotes a
   * search for an older one returned "no quotes here yet" for a quote that
   * plainly exists, and the pager only ever walked that same first 100.
   * `meta` carries the true total so the pager knows how far the list goes.
   */
  /*
   * The index the quote list needs.
   *
   * Without it every list request is a full collection scan, and the cost is
   * paid three times over:
   *
   *   - the scan itself, on a filter that is always branch + license
   *   - AGAIN for countDocuments, which the pager needs and which runs the
   *     same filter a second time on every request
   *   - and the sort. Sorting created_date with no index behind it happens in
   *     memory, which Mongo caps at 32MB. Past that it does not get slower, it
   *     ERRORS - so the list would go from working to "Could not load quotes"
   *     at some unannounced number of quotes.
   *
   * `{ branch_id, license, created_date }` fixes all three: Mongo walks only
   * this branch's quotes, already in the order the list wants them.
   *
   * It does NOT help the search regex - /term/i is unanchored and
   * case-insensitive, so no index can serve it. But the wall runs first, so
   * the regex is then tested against one branch's quotes rather than every
   * quote in the database, which is where the real cost was.
   *
   * Best-effort and once per process, following the sales precedent: an index
   * build that fails must never fail a page load.
   */
  async _ensureListIndex(collection) {
    if (this.constructor._listIndexEnsured) return;
    try {
      await collection.createIndex(
        { branch_id: 1, license: 1, created_date: -1 },
        { name: 'quote_list_by_branch' }
      );
      this.constructor._listIndexEnsured = true;
    } catch (e) {
      /* try again on a later request rather than break this one */
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
      /*
       * Free text, plus the two filters that actually get used on a long
       * list: WHICH field, and WHEN.
       *
       * `field` narrows the search to one column instead of both. `exact`
       * anchors it, and anchoring is not cosmetic: /^QUO-000012$/ can be
       * served by an index where /QUO/ cannot. A shop that searches by quote
       * number gets a seek instead of a scan of its whole history, which is
       * the difference that matters once the list is long.
       */
      const term = String(params.search || '')
        .trim()
        .slice(0, 80);
      if (term) {
        // user text becomes a regex: escape it, or a stray '(' is a 500
        const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rx =
          String(params.exact) === 'true' ? new RegExp(`^${safe}$`, 'i') : new RegExp(safe, 'i');
        const field = String(params.field || 'all');
        if (field === 'quote_id') filter.quote_id = rx;
        else if (field === 'customer_name') filter.customer_name = rx;
        else filter.$or = [{ customer_name: rx }, { quote_id: rx }];
      }

      /*
       * Date range on created_date. The list index is
       * { branch_id, license, created_date }, so a range is a seek down that
       * index and the sort it already needs comes free from the same walk.
       *
       * `to` is pushed to the END of its day. Picking 21 Aug means "including
       * the 21st"; comparing against midnight would silently drop a day of
       * quotes and read as data loss.
       */
      const range = {};
      const from = params.from ? new Date(String(params.from)) : null;
      const to = params.to ? new Date(String(params.to)) : null;
      if (from && !Number.isNaN(from.getTime())) range.$gte = from;
      if (to && !Number.isNaN(to.getTime())) {
        to.setHours(23, 59, 59, 999);
        range.$lte = to;
      }
      if (Object.keys(range).length) filter.created_date = range;
      const limit = Math.min(Math.max(Number(params.limit) || 100, 1), 200);
      const page = Math.max(Number(params.page) || 1, 1);
      const collection = await this.getCollection(this.collectionName);
      await this._ensureListIndex(collection);
      const total = await collection.countDocuments(filter);
      const rows = await collection
        .find(filter)
        .sort({ created_date: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray();
      return {
        status: true,
        data: rows,
        meta: { total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) },
        message: 'success',
      };
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
        if (doc.status === 'converted' || doc.status === 'cancelled') {
          return { status: false, data: null, message: 'This quote is already closed' };
        }
        await collection.updateOne(
          { _id: doc._id },
          { $set: { status: 'cancelled', updated_date: new Date() } }
        );
        return { status: true, data: { id: String(doc._id) }, message: 'Quote cancelled' };
      }

      /*
       * The quote left the shop (emailed, WhatsApped, linked): open/draft
       * become 'sent'. Idempotent and quiet - re-sending an already-sent
       * quote succeeds without touching it, and history states refuse.
       */
      if (action === 'send') {
        if (doc.status === 'sent') {
          return { status: true, data: { id: String(doc._id) }, message: 'Quote already sent' };
        }
        if (!EDITABLE.includes(doc.status)) {
          return { status: false, data: null, message: 'This quote is closed - nothing to send' };
        }
        await collection.updateOne(
          { _id: doc._id },
          { $set: { status: 'sent', sent_date: new Date(), updated_date: new Date() } }
        );
        return { status: true, data: { id: String(doc._id) }, message: 'Quote marked sent' };
      }

      /* The customer said yes / no. Accepting freezes edits - the numbers
         are now a promise; converting is still allowed (that IS the point). */
      if (action === 'accept' || action === 'decline') {
        if (!EDITABLE.includes(doc.status)) {
          return {
            status: false,
            data: null,
            message: 'Only an open quote can be accepted or declined',
          };
        }
        const status = action === 'accept' ? 'accepted' : 'declined';
        await collection.updateOne(
          { _id: doc._id },
          { $set: { status, [action + 'ed_date']: new Date(), updated_date: new Date() } }
        );
        return { status: true, data: { id: String(doc._id) }, message: 'Quote ' + status };
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
        if (!EDITABLE.includes(doc.status) && doc.status !== 'accepted') {
          return {
            status: false,
            data: null,
            message: 'Only an open or accepted quote can be converted',
          };
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

  /* Share metadata: which S3 object currently represents this quote. Any
     status may share - sending a converted quote's record is legitimate.
     Revisions are the caller's job; this only persists the newest one. */
  async recordShare(id, share, context) {
    try {
      const wall = this._wall(context);
      if (!wall) return { status: false, data: null, message: 'Branch ID not found' };
      if (!ObjectId.isValid(String(id))) {
        return { status: false, data: null, message: 'Invalid quote id' };
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
      if (!result.matchedCount) return { status: false, data: null, message: 'Quote not found' };
      /* A shared quote has been SENT - open/draft move on; anything else
         (sent already, accepted, history) is left exactly as it is. */
      await collection.updateOne(
        { _id: new ObjectId(String(id)), ...wall, status: { $in: ['open', 'draft'] } },
        { $set: { status: 'sent', sent_date: new Date() } }
      );
      return { status: true, data: { rev: Number(share.rev) || 1 }, message: 'Share recorded' };
    } catch (error) {
      console.error('Error in QuoteRepository.recordShare:', error);
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
        status: { $in: EDITABLE },
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
