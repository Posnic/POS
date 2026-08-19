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
    expect([...new Set(mockRequestedCollections)]).toEqual(['quotes']);
    const doc = mockCollection.insertOne.mock.calls[0][0];
    expect(doc.status).toBe('open');
    expect(doc.subtotal).toBe(100);
    expect(doc.total).toBe(100);
    expect(String(doc.branch_id)).toBe(BRANCH);
    expect(String(doc.license)).toBe(LICENSE);
  });

  test('create refuses an empty line list', async () => {
    const r = await repo.upsertQuote({ items: [] }, '', ctx);
    expect(r.status).toBe(false);
  });

  test('update touches open quotes only - the filter says so', async () => {
    mockCollection.updateOne.mockResolvedValue({ matchedCount: 0 });
    const r = await repo.upsertQuote(
      { items: [{ item_id: ITEM, qty: 1, unit_price: 10 }] },
      QUOTE_ID,
      ctx
    );
    expect(r.status).toBe(false);
    const filter = mockCollection.updateOne.mock.calls[0][0];
    expect(filter.status).toBe('open');
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

  test('delete is open-only in the query itself', async () => {
    mockCollection.deleteOne.mockResolvedValue({ deletedCount: 0 });
    const r = await repo.deleteQuote(QUOTE_ID, ctx);
    expect(r.status).toBe(false);
    const filter = mockCollection.deleteOne.mock.calls[0][0];
    expect(filter.status).toBe('open');
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
