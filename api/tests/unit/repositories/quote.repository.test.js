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

const mkFindChain = (rows) => ({
  find: () => mkFindChain(rows),
  sort: () => mkFindChain(rows),
  limit: () => mkFindChain(rows),
  project: () => mkFindChain(rows),
  toArray: async () => rows,
});

describe('QuoteRepository', () => {
  let repo;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequestedCollections.length = 0;
    repo = new QuoteRepository();
    mockCollection.find.mockReturnValue(mkFindChain([]));
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
          { item_id: ITEM, item_name: 'Rice', qty: 2, unit_price: 50, discount: { type: 'percent', value: 10 } },
          { kind: 'custom', item_name: 'Install and calibrate', qty: 1, unit_price: 100, discount: { type: 'amount', value: 20 } },
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
    const sendCall = mockCollection.updateOne.mock.calls[mockCollection.updateOne.mock.calls.length - 1];
    expect(sendCall[1].$set.status).toBe('sent');
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

  test('every method fails closed without a branch wall', async () => {
    expect((await repo.upsertQuote({ items: [] }, '', {})).status).toBe(false);
    expect((await repo.listQuotes({}, {})).status).toBe(false);
    expect((await repo.getQuote(QUOTE_ID, {})).status).toBe(false);
    expect((await repo.transition(QUOTE_ID, 'cancel', {}, {})).status).toBe(false);
    expect((await repo.deleteQuote(QUOTE_ID, {})).status).toBe(false);
    expect(mockRequestedCollections).toEqual([]);
  });
});
