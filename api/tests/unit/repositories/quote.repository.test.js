'use strict';

/*
 * Quotes: the invariant worth pinning is the same one purchase orders pin -
 * a quote NEVER touches stock or payments. The mock records every collection
 * name the repository opens; creating, converting and deleting must only
 * ever open 'quotes'.
 */

const mockRequestedCollections = [];
const mockCollection = {
  find: jest.fn(),
  findOne: jest.fn(),
  insertOne: jest.fn(),
  updateOne: jest.fn(),
  deleteOne: jest.fn(),
};

jest.mock('../../../src/models/base.model', () => {
  return class MockBaseModel {
    constructor(name) {
      this.collectionName = name;
    }

    async getCollection(name) {
      mockRequestedCollections.push(name);
      return mockCollection;
    }
  };
});

const QuoteRepository = require('../../../src/repositories/quote.repository');
const { ObjectId } = require('mongodb');

const BRANCH = '64b000000000000000000001';
const LICENSE = '64b000000000000000000002';
const QUOTE_ID = '64b000000000000000000003';
const ITEM = '64b000000000000000000004';
const SALE = '64b000000000000000000005';
const ctx = { branchId: BRANCH, licenseId: LICENSE, userName: 'tester' };

/* `calls` collects what the chain was asked for, so paging tests can assert
   the repository skipped and limited rather than trusting the row array. */
const mkFindChain = (rows, calls = {}) => ({
  find: () => mkFindChain(rows, calls),
  sort: () => mkFindChain(rows, calls),
  skip: (n) => {
    calls.skip = n;
    return mkFindChain(rows, calls);
  },
  limit: (n) => {
    calls.limit = n;
    return mkFindChain(rows, calls);
  },
  project: () => mkFindChain(rows, calls),
  toArray: async () => rows,
});

describe('QuoteRepository', () => {
  let repo;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestedCollections.length = 0;
    repo = new QuoteRepository();
    mockCollection.find.mockReturnValue(mkFindChain([]));
    mockCollection.countDocuments = jest.fn().mockResolvedValue(0);
    mockCollection.createIndex = jest.fn().mockResolvedValue('quote_list_by_branch');
    // the index is ensured once per PROCESS, so reset the latch between tests
    Object.getPrototypeOf(repo).constructor._listIndexEnsured = false;
  });

  test('create writes only the quotes collection and numbers QUO-000001', async () => {
    mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId(QUOTE_ID) });
    const r = await repo.upsertQuote(
      { items: [{ item_id: ITEM, item_name: 'Rice', qty: 2, unit_price: 50 }] },
      '',
      ctx
    );
    expect(r.status).toBe(true);
    expect(r.data.quote_id).toBe('QUO-000001');
    /* branches is READ for the quotation-defaults prefill; every WRITE
       still lands only in quotes - the invariant this file exists for. */
    expect([...new Set(mockRequestedCollections)]).toEqual(['quotes', 'branches']);
    expect(mockCollection.insertOne).toHaveBeenCalledTimes(1);
    expect(mockCollection.updateOne).not.toHaveBeenCalled();
    expect(mockCollection.deleteOne).not.toHaveBeenCalled();
    const doc = mockCollection.insertOne.mock.calls[0][0];
    expect(doc.status).toBe('open');
    expect(doc.subtotal).toBe(100);
    expect(doc.total).toBe(100);
    expect(String(doc.branch_id)).toBe(BRANCH);
    expect(String(doc.license)).toBe(LICENSE);
  });

  test('a new quote starts from the shop quotation defaults, without overwriting what the till sent', async () => {
    mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId(QUOTE_ID) });
    mockCollection.findOne.mockResolvedValue({
      quote_default_payment_method: 'UPI or bank transfer',
      quote_default_bank_details: 'HDFC0001234 / 50100234567890',
      quote_default_terms: '50% advance confirms the order.',
    });
    const r = await repo.upsertQuote(
      {
        items: [{ item_id: ITEM, item_name: 'Rice', qty: 2, unit_price: 50 }],
        payment_method: 'Cash only',
      },
      '',
      ctx
    );
    expect(r.status).toBe(true);
    const doc = mockCollection.insertOne.mock.calls[0][0];
    expect(doc.payment_method).toBe('Cash only');
    expect(doc.bank_details).toBe('HDFC0001234 / 50100234567890');
    expect(doc.terms).toBe('50% advance confirms the order.');
  });

  test('server math is the stored truth: line discounts, quote discount, named charges', async () => {
    mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId(QUOTE_ID) });
    const r = await repo.upsertQuote(
      {
        items: [
          {
            item_id: ITEM,
            item_name: 'Rice',
            qty: 2,
            unit_price: 50,
            discount: { type: 'percent', value: 10 },
          },
          {
            kind: 'custom',
            item_name: 'Install and calibrate',
            qty: 1,
            unit_price: 100,
            discount: { type: 'amount', value: 20 },
          },
        ],
        discount: { type: 'amount', value: 5 },
        charges: [
          { name: 'CGST 9%', type: 'percent', value: 9 },
          { name: 'Freight', type: 'amount', value: 40 },
          { name: 'Loyalty rebate', type: 'amount', value: 10, sign: -1 },
        ],
        total: 999999,
      },
      '',
      ctx
    );
    expect(r.status).toBe(true);
    const doc = mockCollection.insertOne.mock.calls[0][0];
    expect(doc.items[0].line_total).toBe(90);
    expect(doc.items[1].kind).toBe('custom');
    expect(doc.items[1].item_id).toBeNull();
    expect(doc.items[1].line_total).toBe(80);
    expect(doc.subtotal).toBe(170);
    expect(doc.discount.computed).toBe(5);
    expect(doc.charges[0].computed).toBe(14.85);
    expect(doc.charges[1].computed).toBe(40);
    expect(doc.charges[2].computed).toBe(10);
    expect(doc.charges_total).toBe(44.85);
    /* 165 + 44.85 - the client's 999999 is advisory and ignored */
    expect(doc.total).toBe(209.85);
  });

  test('a row with a name but no valid item id heals into a custom row', async () => {
    mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId(QUOTE_ID) });
    const r = await repo.upsertQuote(
      { items: [{ item_id: 'null', item_name: 'Delivery charge', qty: 1, unit_price: 50 }] },
      '',
      ctx
    );
    expect(r.status).toBe(true);
    const doc = mockCollection.insertOne.mock.calls[0][0];
    expect(doc.items[0].kind).toBe('custom');
    expect(doc.items[0].item_id).toBeNull();
    expect(doc.total).toBe(50);
  });

  test('accepting freezes edits; converting an accepted quote still works', async () => {
    mockCollection.findOne.mockResolvedValue({ _id: new ObjectId(QUOTE_ID), status: 'open' });
    mockCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
    const acc = await repo.transition(QUOTE_ID, 'accept', {}, ctx);
    expect(acc.status).toBe(true);
    expect(mockCollection.updateOne.mock.calls[0][1].$set.status).toBe('accepted');

    mockCollection.updateOne.mockResolvedValue({ matchedCount: 0 });
    const edit = await repo.upsertQuote(
      { items: [{ item_id: ITEM, item_name: 'Rice', qty: 1, unit_price: 10 }] },
      QUOTE_ID,
      ctx
    );
    expect(edit.status).toBe(false);

    mockCollection.findOne.mockResolvedValue({ _id: new ObjectId(QUOTE_ID), status: 'accepted' });
    mockCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
    const conv = await repo.transition(QUOTE_ID, 'convert', { sale_id: SALE }, ctx);
    expect(conv.status).toBe(true);
  });

  test('sharing marks an open quote sent; send transition is idempotent', async () => {
    mockCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
    const r = await repo.recordShare(
      QUOTE_ID,
      { key: 'quotes/x/y.pdf', url: 'https://b.s3/x.pdf', rev: 1 },
      ctx
    );
    expect(r.status).toBe(true);
    /* second write flips open/draft to sent, scoped in the query itself */
    const statusCall = mockCollection.updateOne.mock.calls[1];
    expect(statusCall[0].status).toEqual({ $in: ['open', 'draft'] });
    expect(statusCall[1].$set.status).toBe('sent');

    mockCollection.findOne.mockResolvedValue({ _id: new ObjectId(QUOTE_ID), status: 'sent' });
    const again = await repo.transition(QUOTE_ID, 'send', {}, ctx);
    expect(again.status).toBe(true);
    expect(again.message).toBe('Quote already sent');

    mockCollection.findOne.mockResolvedValue({ _id: new ObjectId(QUOTE_ID), status: 'open' });
    const sent = await repo.transition(QUOTE_ID, 'send', {}, ctx);
    expect(sent.status).toBe(true);
    const sendCall =
      mockCollection.updateOne.mock.calls[mockCollection.updateOne.mock.calls.length - 1];
    expect(sendCall[1].$set.status).toBe('sent');
  });

  test('per-line tax: inclusive stays in the price, exclusive adds; tax total is computed', async () => {
    mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId(QUOTE_ID) });
    const r = await repo.upsertQuote(
      {
        items: [
          {
            item_id: ITEM,
            item_name: 'Incl',
            qty: 1,
            unit_price: 118,
            tax_name: 'GST 18%',
            tax_value: 18,
            tax_type: 'inclusive',
          },
          {
            item_id: ITEM,
            item_name: 'Excl',
            qty: 1,
            unit_price: 100,
            tax_name: 'VAT 10%',
            tax_value: 10,
            tax_type: 'exclusive',
          },
        ],
        tax_total: 999,
      },
      '',
      ctx
    );
    expect(r.status).toBe(true);
    const doc = mockCollection.insertOne.mock.calls[0][0];
    expect(doc.items[0].tax_amount).toBe(18);
    expect(doc.items[0].line_total).toBe(118);
    expect(doc.items[1].tax_amount).toBe(10);
    expect(doc.items[1].line_total).toBe(110);
    expect(doc.subtotal).toBe(228);
    /* our sum, not the client's 999 */
    expect(doc.tax_total).toBe(28);
  });

  test('create refuses an empty line list', async () => {
    const r = await repo.upsertQuote({ items: [] }, '', ctx);
    expect(r.status).toBe(false);
  });

  test('update touches the editable family only - the filter says so', async () => {
    mockCollection.updateOne.mockResolvedValue({ matchedCount: 0 });
    const r = await repo.upsertQuote(
      { items: [{ item_id: ITEM, qty: 1, unit_price: 10 }] },
      QUOTE_ID,
      ctx
    );
    expect(r.status).toBe(false);
    const filter = mockCollection.updateOne.mock.calls[0][0];
    /* accepted/declined/converted/cancelled stay immutable via the query */
    expect(filter.status).toEqual({ $in: ['open', 'draft', 'sent'] });
  });

  test('convert stamps the sale and is replay-safe for the same sale', async () => {
    mockCollection.findOne.mockResolvedValue({
      _id: new ObjectId(QUOTE_ID),
      status: 'open',
    });
    mockCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
    const r = await repo.transition(QUOTE_ID, 'convert', { sale_id: SALE }, ctx);
    expect(r.status).toBe(true);
    const set = mockCollection.updateOne.mock.calls[0][1].$set;
    expect(set.status).toBe('converted');
    expect(String(set.converted_sale_id)).toBe(SALE);

    mockCollection.findOne.mockResolvedValue({
      _id: new ObjectId(QUOTE_ID),
      status: 'converted',
      converted_sale_id: new ObjectId(SALE),
    });
    const replay = await repo.transition(QUOTE_ID, 'convert', { sale_id: SALE }, ctx);
    expect(replay.status).toBe(true);

    const other = await repo.transition(QUOTE_ID, 'convert', { sale_id: ITEM }, ctx);
    expect(other.status).toBe(false);
  });

  test('cancel refuses anything but open', async () => {
    mockCollection.findOne.mockResolvedValue({
      _id: new ObjectId(QUOTE_ID),
      status: 'converted',
    });
    const r = await repo.transition(QUOTE_ID, 'cancel', {}, ctx);
    expect(r.status).toBe(false);
  });

  test('delete touches the editable family only, in the query itself', async () => {
    mockCollection.deleteOne.mockResolvedValue({ deletedCount: 0 });
    const r = await repo.deleteQuote(QUOTE_ID, ctx);
    expect(r.status).toBe(false);
    const filter = mockCollection.deleteOne.mock.calls[0][0];
    expect(filter.status).toEqual({ $in: ['open', 'draft', 'sent'] });
  });

  /*
   * Listing: status, search and paging are the SERVER's job. They used to be
   * done in the browser over the first 100 rows, so past 100 quotes a search
   * for an older one answered "no quotes" for a quote that exists.
   */
  test('search matches customer name or quote number, case-insensitively', async () => {
    await repo.listQuotes({ search: 'acme' }, ctx);
    const filter = mockCollection.find.mock.calls[0][0];
    expect(filter.$or).toHaveLength(2);
    expect(filter.$or[0].customer_name).toBeInstanceOf(RegExp);
    expect(filter.$or[0].customer_name.flags).toContain('i');
    expect(filter.$or[0].customer_name.test('ACME Traders')).toBe(true);
    expect(filter.$or[1].quote_id.test('QUO-000012')).toBe(false);
  });

  test('a search term full of regex metacharacters is matched literally', async () => {
    // Unescaped, '(' alone is an invalid regex and this call would throw.
    const r = await repo.listQuotes({ search: 'a+b(c' }, ctx);
    expect(r.status).toBe(true);
    const filter = mockCollection.find.mock.calls[0][0];
    expect(filter.$or[0].customer_name.test('a+b(c ltd')).toBe(true);
    expect(filter.$or[0].customer_name.test('aaab')).toBe(false);
  });

  test('paging skips whole pages and reports the true total', async () => {
    mockCollection.countDocuments.mockResolvedValue(137);
    const calls = {};
    mockCollection.find.mockReturnValue(mkFindChain([], calls));
    const r = await repo.listQuotes({ page: 3, limit: 20 }, ctx);
    expect(calls.skip).toBe(40);
    expect(calls.limit).toBe(20);
    // the pager needs the count of ALL matches, not of this page's rows
    expect(r.meta).toEqual({ total: 137, page: 3, limit: 20, pages: 7 });
  });

  test('the count is taken over the same filter the rows are read with', async () => {
    await repo.listQuotes({ search: 'acme', status: 'open' }, ctx);
    expect(mockCollection.countDocuments).toHaveBeenCalledWith(
      mockCollection.find.mock.calls[0][0]
    );
  });

  test('a hostile page size cannot ask for the whole collection', async () => {
    const calls = {};
    mockCollection.find.mockReturnValue(mkFindChain([], calls));
    await repo.listQuotes({ limit: 100000, page: 0 }, ctx);
    expect(calls.limit).toBe(200);
    expect(calls.skip).toBe(0); // page 0 is clamped to the first page
  });

  test('an unknown status is ignored rather than filtering everything out', async () => {
    await repo.listQuotes({ status: 'not-a-status' }, ctx);
    expect(mockCollection.find.mock.calls[0][0].status).toBeUndefined();
  });

  test('every method fails closed without a branch wall', async () => {
    expect((await repo.upsertQuote({ items: [] }, '', {})).status).toBe(false);
    expect((await repo.listQuotes({}, {})).status).toBe(false);
    expect((await repo.getQuote(QUOTE_ID, {})).status).toBe(false);
    expect((await repo.transition(QUOTE_ID, 'cancel', {}, {})).status).toBe(false);
    expect((await repo.deleteQuote(QUOTE_ID, {})).status).toBe(false);
    expect(mockRequestedCollections).toEqual([]);
  });

  /*
   * The index the list needs.
   *
   * Without it every list request is a full collection scan, paid three times:
   * the scan, then countDocuments running the same filter again for the pager,
   * then an in-memory sort of created_date. That last one is the dangerous
   * part - Mongo caps in-memory sorts at 32MB and ERRORS past it, so the list
   * would go from working to "Could not load quotes" at some unannounced
   * number of quotes rather than merely getting slower.
   */
  describe('QuoteRepository — list index', () => {
    test('the list ensures an index that covers wall + sort order', async () => {
      await repo.listQuotes({}, ctx);
      expect(mockCollection.createIndex).toHaveBeenCalled();

      const [keys] = mockCollection.createIndex.mock.calls[0];
      // the wall comes first so Mongo walks only this branch's quotes...
      expect(Object.keys(keys).slice(0, 2)).toEqual(['branch_id', 'license']);
      // ...already in the order the list asks for, so the sort is free
      expect(keys.created_date).toBe(-1);
    });

    test('it is ensured before the count, not after the read', async () => {
      await repo.listQuotes({}, ctx);
      const indexOrder = mockCollection.createIndex.mock.invocationCallOrder[0];
      const countOrder = mockCollection.countDocuments.mock.invocationCallOrder[0];
      expect(indexOrder).toBeLessThan(countOrder);
    });

    test('a failed index build never fails the list', async () => {
      /* Best-effort by design: a shop mid-build, or a permission quirk, must
         not turn into a blank quotes page. It simply tries again next request. */
      mockCollection.createIndex.mockRejectedValue(new Error('index build busy'));
      const r = await repo.listQuotes({}, ctx);
      expect(r.status).toBe(true);
    });

    test('it is built once per process, not on every request', async () => {
      await repo.listQuotes({}, ctx);
      await repo.listQuotes({}, ctx);
      await repo.listQuotes({}, ctx);
      expect(mockCollection.createIndex).toHaveBeenCalledTimes(1);
    });
  });
});
