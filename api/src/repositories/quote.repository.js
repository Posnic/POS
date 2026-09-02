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
const { ensureIndexOnce } = require('../db/ensure-index');
const docMath = require('../services/document-math');

const STATUSES = Object.freeze([
  'open',
  'draft',
  'sent',
  'accepted',
  'declined',
  'invoiced',
  'converted',
  'cancelled',
]);
/* draft and sent behave like open: still editable, still convertible.
   accepted freezes edits (the promise is made); declined/converted/
   cancelled are history. invoiced (INVOICING_MODULE_DESIGN) means an
   invoice now carries the numbers: the quote is frozen like accepted, and
   it is the INVOICE that converts to the sale - which stamps the quote
   converted in turn, so the chain reads quote -> invoice -> sale. */
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

  /*
   * The money arithmetic moved to services/document-math when invoices
   * arrived: a quote becomes an invoice becomes a sale, and one copy of the
   * rounding rules is the only way the three documents agree. These thin
   * delegates keep the repository's own surface unchanged.
   */
  static _round2(n) {
    return docMath.round2(n);
  }

  static _discountOf(raw, gross) {
    return docMath.discountOf(raw, gross);
  }

  _normalizeLines(rows) {
    return docMath.normalizeLines(rows, 'quote');
  }

  _normalizeCharges(rows) {
    return docMath.normalizeCharges(rows);
  }

  _normalizeBlocks(rows) {
    return docMath.normalizeBlocks(rows);
  }

  _normalizeLayout(value) {
    return docMath.normalizeLayout(value);
  }

  _validUntil(value) {
    return docMath.dateOrNull(value);
  }

  /* Create (id empty) or update - open quotes only; history is not editable. */
  async upsertQuote(data = {}, id = '', context = {}) {
    try {
      const wall = this._wall(context);
      if (!wall) return { status: false, data: null, message: 'Branch ID not found' };

      const parsed = this._normalizeLines(data.lines || data.items);
      if (parsed.error) return { status: false, data: null, message: parsed.error };

      /* Money authority (QUOTATION_MODULE_DESIGN rule 4) lives in
         document-math.computeTotals, shared with invoices. */
      const money = docMath.computeTotals({
        lines: parsed.lines,
        charges: this._normalizeCharges(data.charges),
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
        charges: money.charges,
        discount: money.discount,
        charges_total: money.charges_total,
        custom_blocks: this._normalizeBlocks(data.custom_blocks),
        layout: this._normalizeLayout(data.layout),
        notes: String(data.notes || '')
          .trim()
          .slice(0, 2000),
        subtotal: money.subtotal,
        tax_total: money.tax_total,
        total: money.total,
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
    /* Once per DATABASE, not once per process. Each shop has its own database
       and one process serves many, so a static boolean would give the index to
       whichever shop happened to ask first and to nobody else. */
    await ensureIndexOnce(
      collection,
      { branch_id: 1, license: 1, created_date: -1 },
      { name: 'quote_list_by_branch' }
    );
    /* The whitelisted sorts (high amount, valid-till) walk these. */
    await ensureIndexOnce(
      collection,
      { branch_id: 1, license: 1, total: -1 },
      { name: 'quote_list_by_total' }
    );
    await ensureIndexOnce(
      collection,
      { branch_id: 1, license: 1, valid_until: 1 },
      { name: 'quote_list_by_valid_until' }
    );
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
      const rawFrom = params.from ? String(params.from) : '';
      const rawTo = params.to ? String(params.to) : '';
      const from = rawFrom ? new Date(rawFrom) : null;
      const to = rawTo ? new Date(rawTo) : null;
      if (from && !Number.isNaN(from.getTime())) range.$gte = from;
      if (to && !Number.isNaN(to.getTime())) {
        /* Only a DATE-ONLY value gets pushed to the end of its day.
           "2026-08-21" means "including the 21st", and comparing it against
           midnight would silently drop a day. But the filter bar now sends a
           precise instant, and forcing 23:59 onto that would widen a range the
           user deliberately narrowed - "up to 2pm" would quietly mean "up to
           midnight". The presence of a time is what tells the two apart. */
        if (/^\d{4}-\d{2}-\d{2}$/.test(rawTo.trim())) to.setHours(23, 59, 59, 999);
        range.$lte = to;
      }
      if (Object.keys(range).length) filter.created_date = range;
      const limit = Math.min(Math.max(Number(params.limit) || 100, 1), 200);
      const page = Math.max(Number(params.page) || 1, 1);
      const collection = await this.getCollection(this.collectionName);
      await this._ensureListIndex(collection);

      /*
       * The exact total is the most expensive thing on this screen and the
       * least useful, so it is only paid for when it is cheap.
       *
       * countDocuments runs the whole filter a SECOND time. Branch, status and
       * a date range are all served by the list index, so counting them is a
       * seek and worth having - real totals, real page numbers. An unanchored
       * regex cannot use any index, so counting a text search means running
       * that regex across every candidate row, twice per request.
       *
       * Nobody acts on "1,247 quotes". They act on "is mine here" and "is
       * there more". The second needs ONE extra row, not a count: ask for
       * limit + 1, and if it comes back there is a next page. One query
       * instead of two, on exactly the case that would hurt.
       */
      const countable = !term;
      let total = null;
      let rows;

      /*
       * Sort, whitelisted (owner: high amount, valid-till, date). Only
       * these names reach the query - a raw client field would sort by
       * anything on the document.
       */
      const QUOTE_SORTS = {
        recent: { created_date: -1 },
        total_desc: { total: -1, _id: -1 },
        total_asc: { total: 1, _id: -1 },
        valid_asc: { valid_until: 1, _id: -1 },
        valid_desc: { valid_until: -1, _id: -1 },
      };
      const sort = QUOTE_SORTS[String(params.sort || '')] || { created_date: -1 };

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

      // the probe row is proof of a next page, never something to display
      const hasMore = countable ? page * limit < total : rows.length > limit;
      if (!countable && rows.length > limit) rows = rows.slice(0, limit);

      return {
        status: true,
        data: rows,
        meta: {
          total,
          page,
          limit,
          hasMore,
          // pages is only honest when a total was actually measured
          pages: total === null ? null : Math.max(1, Math.ceil(total / limit)),
        },
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
        if (doc.status === 'invoiced') {
          return {
            status: false,
            data: null,
            message: 'This quote became an invoice - cancel the invoice instead',
          };
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

      /*
       * The quote became an invoice (INVOICING_MODULE_DESIGN): the invoice
       * repository creates the document and then stamps the quote here. One
       * quote, one invoice - a replay with the same invoice id succeeds, a
       * different one is refused.
       */
      if (action === 'invoice') {
        const invoiceId =
          data.invoice_id && ObjectId.isValid(String(data.invoice_id))
            ? new ObjectId(String(data.invoice_id))
            : null;
        if (!invoiceId) return { status: false, data: null, message: 'An invoice id is required' };
        if (doc.status === 'invoiced') {
          const same = doc.invoice_id && String(doc.invoice_id) === String(invoiceId);
          return same
            ? { status: true, data: { id: String(doc._id) }, message: 'Quote already invoiced' }
            : { status: false, data: null, message: 'This quote already has an invoice' };
        }
        if (!EDITABLE.includes(doc.status) && doc.status !== 'accepted') {
          return {
            status: false,
            data: null,
            message: 'Only an open or accepted quote can become an invoice',
          };
        }
        await collection.updateOne(
          { _id: doc._id },
          {
            $set: {
              status: 'invoiced',
              invoice_id: invoiceId,
              invoice_number: String(data.invoice_number || '').slice(0, 40),
              invoiced_date: new Date(),
              updated_date: new Date(),
            },
          }
        );
        return { status: true, data: { id: String(doc._id) }, message: 'Quote invoiced' };
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
        /* invoiced joins the list: the invoice's own conversion stamps the
           quote it came from, closing the chain. */
        if (
          !EDITABLE.includes(doc.status) &&
          doc.status !== 'accepted' &&
          doc.status !== 'invoiced'
        ) {
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
