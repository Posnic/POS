'use strict';

/**
 * Unit tests for src/repositories/sales.repository.js
 * SINGLETON export — module.exports = new SalesRepository()
 * ~9045 lines, 25+ methods, uses both Mongoose models and native MongoDB driver
 */

jest.mock('mongoose', () => {
  const ObjectIdMock = jest.fn((id) => ({
    toString: () => String(id),
    toHexString: () => String(id),
    equals: (o) => String(id) === String(o),
  }));
  ObjectIdMock.isValid = jest.fn(() => true);
  return { Types: { ObjectId: ObjectIdMock }, Schema: { Types: { ObjectId: ObjectIdMock } } };
});

jest.mock('mongodb', () => {
  const m = jest.fn((id) => ({ toString: () => String(id), toHexString: () => String(id) }));
  m.isValid = jest.fn(() => true);
  return { ObjectId: m };
});

jest.mock('../../../src/utils/helpers', () => ({
  formatDate: jest.fn((d) => (d ? new Date(d).toISOString() : null)),
}));

jest.mock('../../../src/constants', () => ({
  PAYMENT_STATUS: { PAID: 'paid', UNPAID: 'unpaid', PARTIAL: 'partial', PENDING: 'pending' },
  SALE_STATUS: { ACTIVE: 'active', CANCELLED: 'cancelled' },
}));

jest.mock('../../../src/repositories/stock-log.repository', () =>
  jest.fn().mockImplementation(() => ({
    createStockLog: jest.fn().mockResolvedValue({ status: true }),
  }))
);

const collections = {};
const mkCol = () => ({
  findOne: jest.fn().mockResolvedValue(null),
  find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
  findOneAndUpdate: jest.fn().mockResolvedValue(null),
  createIndex: jest.fn().mockResolvedValue('ok'),
  updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
  updateMany: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
  deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  countDocuments: jest.fn().mockResolvedValue(0),
  aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
  insertOne: jest.fn().mockResolvedValue({ insertedId: 'fake-id' }),
});

jest.mock('../../../src/models/base.model', () => {
  const mkColLocal = () => ({
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    findOneAndUpdate: jest.fn().mockResolvedValue(null),
    createIndex: jest.fn().mockResolvedValue('ok'),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    updateMany: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    countDocuments: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    insertOne: jest.fn().mockResolvedValue({ insertedId: 'fake-id' }),
  });

  const db = {
    collection: jest.fn().mockImplementation((name) => {
      if (!collections[name]) collections[name] = mkColLocal();
      return collections[name];
    }),
  };

  function MockBaseModel(c) {
    this.collectionName = c;
  }
  MockBaseModel.prototype.getCollection = jest.fn().mockImplementation((name) => {
    if (!collections[name]) collections[name] = mkColLocal();
    return Promise.resolve(collections[name]);
  });
  MockBaseModel.prototype.getDb = jest.fn().mockResolvedValue(db);
  MockBaseModel.prototype.changeLog = jest.fn().mockResolvedValue({});
  MockBaseModel.prototype.startingDate = jest.fn((d) => (d ? new Date(d) : new Date('2026-01-01')));
  MockBaseModel.prototype.endingDate = jest.fn((d) => (d ? new Date(d) : new Date('2026-12-31')));
  MockBaseModel.getDb = jest.fn().mockResolvedValue(db);
  MockBaseModel.license = null;
  MockBaseModel.currentBranch = null;
  MockBaseModel.loggedUser = null;
  MockBaseModel.loggedUserName = null;
  MockBaseModel.currentTimeZone = 'Asia/Kolkata';
  MockBaseModel.deletedDocumentBackup = jest.fn().mockResolvedValue({});
  return MockBaseModel;
});

const createQueryMock = (result) => {
  const chain = {
    populate: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(result),
    exec: jest.fn().mockResolvedValue(result),
  };
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return chain;
};

const MockSaleModel = jest.fn().mockImplementation((data) => ({
  ...data,
  save: jest.fn().mockResolvedValue({ _id: 'sale-id', ...data }),
}));

MockSaleModel.find = jest.fn().mockReturnValue(createQueryMock([]));
MockSaleModel.findOne = jest.fn().mockReturnValue(createQueryMock(null));
MockSaleModel.findById = jest.fn().mockReturnValue(createQueryMock(null));
MockSaleModel.paginate = jest.fn().mockResolvedValue({ docs: [], totalDocs: 0, totalPages: 0 });
MockSaleModel.aggregate = jest.fn().mockResolvedValue([]);
MockSaleModel.countDocuments = jest.fn().mockResolvedValue(0);

jest.mock('../../../src/models/sale.model', () => MockSaleModel);

const salesRepository = require('../../../src/repositories/sale.repository');
const BaseModel = require('../../../src/models/base.model');
const StockLogsRepository = require('../../../src/repositories/stock-log.repository');
const mongoose = require('mongoose');

const FAKE_ID = '64f9a1c2e3b4d5e6f7000001';
const FAKE_BRANCH = '64f9a1c2e3b4d5e6f7000002';
const FAKE_LICENSE = '64f9a1c2e3b4d5e6f7000003';
const FAKE_CUSTOMER = '64f9a1c2e3b4d5e6f7000004';
const FAKE_ITEM = '64f9a1c2e3b4d5e6f7000005';

describe('SalesRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    BaseModel.license = FAKE_LICENSE;
    BaseModel.currentBranch = FAKE_BRANCH;
    BaseModel.loggedUser = FAKE_ID;
    BaseModel.loggedUserName = 'Test User';
    BaseModel.currentTimeZone = 'Asia/Kolkata';

    // Reset all collection mocks
    Object.keys(collections).forEach((name) => {
      const col = collections[name];
      if (col && typeof col.findOne === 'function') {
        if (col.findOne && typeof col.findOne.mockResolvedValue === 'function')
          col.findOne.mockResolvedValue(null);
        if (col.find && typeof col.find.mockReturnValue === 'function')
          col.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });
        if (col.updateOne && typeof col.updateOne.mockResolvedValue === 'function')
          col.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
        if (col.updateMany && typeof col.updateMany.mockResolvedValue === 'function')
          col.updateMany.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
        if (col.deleteMany && typeof col.deleteMany.mockResolvedValue === 'function')
          col.deleteMany.mockResolvedValue({ deletedCount: 1 });
        if (col.countDocuments && typeof col.countDocuments.mockResolvedValue === 'function')
          col.countDocuments.mockResolvedValue(0);
        if (col.aggregate && typeof col.aggregate.mockReturnValue === 'function')
          col.aggregate.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });
        if (col.insertOne && typeof col.insertOne.mockResolvedValue === 'function')
          col.insertOne.mockResolvedValue({ insertedId: FAKE_ID });
      }
    });

    // A fixed per-till code ("DEV1") so bill-number tests are deterministic,
    // and clear the cached tag / one-time index flags between tests.
    salesRepository.constructor._deviceTag = undefined;
    salesRepository.constructor._deviceCode = undefined;
    salesRepository.constructor._branchCodes = undefined;
    salesRepository.constructor._salesIdIndexEnsured = false;
    salesRepository.constructor._countersIndexEnsured = false;
    if (!collections.device_meta) collections.device_meta = mkCol();
    collections.device_meta.findOne.mockResolvedValue({ _id: 'device_tag', tag: 'DEV1' });

    // Reset Mongoose model mocks
    MockSaleModel.find.mockReturnValue(createQueryMock([]));
    MockSaleModel.findOne.mockReturnValue(createQueryMock(null));
    MockSaleModel.findById.mockReturnValue(createQueryMock(null));
    MockSaleModel.paginate.mockResolvedValue({ docs: [], totalDocs: 0, totalPages: 0 });
    MockSaleModel.aggregate.mockResolvedValue([]);
    MockSaleModel.countDocuments.mockResolvedValue(0);

    // Reset mongoose ObjectId mock to avoid test pollution
    mongoose.Types.ObjectId.isValid.mockReturnValue(true);

    // Reset singleton defaultModel to force re-evaluation via getModel
    salesRepository.defaultModel = null;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('constructor & getModel', () => {
    test('singleton has getModel method', () => {
      expect(typeof salesRepository.getModel).toBe('function');
    });
    test('getModel returns injected SaleModel', () => {
      const customModel = jest.fn();
      const r = salesRepository.getModel(customModel);
      expect(r).toBe(customModel);
    });
    test('getModel caches default model', () => {
      const m1 = salesRepository.getModel();
      expect(m1).toBe(MockSaleModel);
      expect(salesRepository.defaultModel).toBe(MockSaleModel);
    });
  });

  describe('create', () => {
    test('creates and saves document', async () => {
      const data = { customer: FAKE_CUSTOMER, total: 100 };
      const instance = { ...data, save: jest.fn().mockResolvedValue({ _id: FAKE_ID, ...data }) };
      MockSaleModel.mockImplementation(() => instance);

      const r = await salesRepository.create(data);
      expect(MockSaleModel).toHaveBeenCalledWith(data);
      expect(instance.save).toHaveBeenCalled();
      expect(r).toEqual(instance);
    });
  });

  describe('paginate', () => {
    test('delegates to Model.paginate', async () => {
      const filter = { customer: FAKE_CUSTOMER };
      const options = { limit: 10, page: 1 };
      const expected = { docs: [], totalDocs: 0 };
      MockSaleModel.paginate.mockResolvedValue(expected);

      const r = await salesRepository.paginate(filter, options);
      expect(MockSaleModel.paginate).toHaveBeenCalledWith(filter, options);
      expect(r).toEqual(expected);
    });
  });

  describe('getById', () => {
    test('returns null when no id', async () => {
      const r = await salesRepository.getById(null);
      expect(r).toBeNull();
    });
    test('reads are TENANT-SCOPED: findOne carries license and branch, never a bare findById', async () => {
      // The old contract was Model.findById(id); the repository now refuses
      // to read across tenants - the stronger contract is the one to pin.
      const doc = { _id: FAKE_ID, total: 100 };
      MockSaleModel.findOne.mockReturnValue(createQueryMock(doc));
      const r = await salesRepository.getById(FAKE_ID);
      expect(MockSaleModel.findOne).toHaveBeenCalledWith({
        _id: FAKE_ID,
        license: FAKE_LICENSE,
        branch_id: FAKE_BRANCH,
      });
      expect(MockSaleModel.findById).not.toHaveBeenCalled();
      expect(r).toEqual(doc);
    });
  });

  describe('findById', () => {
    test('returns null when no id', async () => {
      const r = await salesRepository.findById(null);
      expect(r).toBeNull();
    });
    test('applies projection and populate over the tenant-scoped read', async () => {
      const doc = { _id: FAKE_ID, total: 100 };
      const q = createQueryMock(doc);
      MockSaleModel.findOne.mockReturnValue(q);
      const r = await salesRepository.findById(FAKE_ID, {
        projection: 'total',
        populate: 'customer',
      });
      expect(MockSaleModel.findOne).toHaveBeenCalledWith({
        _id: FAKE_ID,
        license: FAKE_LICENSE,
        branch_id: FAKE_BRANCH,
      });
      expect(q.select).toHaveBeenCalledWith('total');
      expect(r).toEqual(doc);
    });
    test('supports array populate', async () => {
      const doc = { _id: FAKE_ID };
      const q = createQueryMock(doc);
      MockSaleModel.findOne.mockReturnValue(q);
      await salesRepository.findById(FAKE_ID, { populate: ['customer', 'branch'] });
      expect(q.populate).toHaveBeenCalledTimes(2);
    });
  });

  describe('save', () => {
    test('returns null when no sale', async () => {
      const r = await salesRepository.save(null);
      expect(r).toBeNull();
    });
    test('calls sale.save()', async () => {
      const sale = { _id: FAKE_ID, save: jest.fn().mockResolvedValue({ _id: FAKE_ID }) };
      const r = await salesRepository.save(sale);
      expect(sale.save).toHaveBeenCalled();
      expect(r).toEqual({ _id: FAKE_ID });
    });
  });

  describe('updateWalletAmount', () => {
    test('updates wallet amount successfully', async () => {
      if (!collections.sales) collections.sales = mkCol();
      collections.sales.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
      const r = await salesRepository.updateWalletAmount(FAKE_ID, 50.5);
      expect(collections.sales.updateOne).toHaveBeenCalled();
      expect(r).toBe(true);
    });
    test('returns false when no match', async () => {
      if (!collections.sales) collections.sales = mkCol();
      collections.sales.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
      const r = await salesRepository.updateWalletAmount(FAKE_ID, 50);
      expect(r).toBe(false);
    });
    test('returns false on exception', async () => {
      if (!collections.sales) collections.sales = mkCol();
      collections.sales.updateOne.mockRejectedValue(new Error('fail'));
      const r = await salesRepository.updateWalletAmount(FAKE_ID, 50);
      expect(r).toBe(false);
    });
  });

  describe('aggregate', () => {
    test('delegates to Model.aggregate', async () => {
      const pipeline = [{ $match: {} }];
      MockSaleModel.aggregate.mockResolvedValue([{ total: 100 }]);
      const r = await salesRepository.aggregate(pipeline);
      expect(MockSaleModel.aggregate).toHaveBeenCalledWith(pipeline);
      expect(r).toEqual([{ total: 100 }]);
    });
  });

  describe('find', () => {
    test('delegates with projection', async () => {
      const docs = [{ _id: FAKE_ID }];
      MockSaleModel.find.mockReturnValue(createQueryMock(docs));
      const r = await salesRepository.find({ customer: FAKE_CUSTOMER }, 'total');
      expect(MockSaleModel.find).toHaveBeenCalledWith({ customer: FAKE_CUSTOMER });
      expect(r).toEqual(docs);
    });
  });

  describe('findOne', () => {
    test('delegates with projection', async () => {
      const doc = { _id: FAKE_ID };
      MockSaleModel.findOne.mockReturnValue(createQueryMock(doc));
      const r = await salesRepository.findOne({ _id: FAKE_ID }, 'total');
      expect(MockSaleModel.findOne).toHaveBeenCalledWith({ _id: FAKE_ID });
      expect(r).toEqual(doc);
    });
  });

  describe('countDocuments', () => {
    test('delegates to Model.countDocuments', async () => {
      MockSaleModel.countDocuments.mockResolvedValue(5);
      const r = await salesRepository.countDocuments({ status: 'active' });
      expect(MockSaleModel.countDocuments).toHaveBeenCalledWith({ status: 'active' });
      expect(r).toBe(5);
    });
  });

  describe('getSaleForReceipt', () => {
    test('returns null when no id', async () => {
      const r = await salesRepository.getSaleForReceipt(null);
      expect(r).toBeNull();
    });
    test('finds by id or sales_id with branch populate', async () => {
      const doc = { _id: FAKE_ID };
      MockSaleModel.findOne.mockReturnValue(createQueryMock(doc));
      const r = await salesRepository.getSaleForReceipt(FAKE_ID);
      expect(MockSaleModel.findOne).toHaveBeenCalledWith({
        $or: [{ _id: FAKE_ID }, { sales_id: FAKE_ID }],
      });
      expect(r).toEqual(doc);
    });
  });

  describe('getSaleForCustomerPrint', () => {
    test('returns null when no id', async () => {
      const r = await salesRepository.getSaleForCustomerPrint(null);
      expect(r).toBeNull();
    });
    test('finds with item populate', async () => {
      const doc = { _id: FAKE_ID, items: [] };
      MockSaleModel.findOne.mockReturnValue(createQueryMock(doc));
      const r = await salesRepository.getSaleForCustomerPrint(FAKE_ID);
      expect(MockSaleModel.findOne).toHaveBeenCalledWith({
        $or: [{ _id: FAKE_ID }, { sales_id: FAKE_ID }],
      });
      expect(r).toEqual(doc);
    });
  });

  describe('getLastSaleForBranch', () => {
    test('delegates to Model.findOne with sort', async () => {
      const doc = { _id: FAKE_ID };
      MockSaleModel.findOne.mockReturnValue(createQueryMock(doc));
      const r = await salesRepository.getLastSaleForBranch(FAKE_BRANCH, FAKE_LICENSE);
      expect(MockSaleModel.findOne).toHaveBeenCalledWith({
        branch_id: FAKE_BRANCH,
        license: FAKE_LICENSE,
      });
      expect(r).toEqual(doc);
    });
  });

  describe('generateSalesIdForBranch', () => {
    test('throws when no branchId', async () => {
      await expect(salesRepository.generateSalesIdForBranch()).rejects.toThrow(
        'branchId is required'
      );
    });
    test('generates first sales id', async () => {
      if (!collections.branches) collections.branches = mkCol();
      if (!collections.sales) collections.sales = mkCol();
      if (!collections.counters) collections.counters = mkCol();
      collections.branches.findOne.mockResolvedValue(null);
      collections.counters.findOne.mockResolvedValue(null);
      collections.sales.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });
      collections.counters.findOneAndUpdate.mockResolvedValue({ seq: 1 });
      const r = await salesRepository.generateSalesIdForBranch(FAKE_BRANCH);
      expect(r).toBe('S-DEV1-000001');
    });
    test('seeds from the highest issued number, not the last inserted sale', async () => {
      // The merge case that produced real duplicates: an older-numbered sale
      // inserted last. The seed scans for the maximum, so insertion order is
      // irrelevant.
      if (!collections.branches) collections.branches = mkCol();
      if (!collections.sales) collections.sales = mkCol();
      if (!collections.counters) collections.counters = mkCol();
      collections.branches.findOne.mockResolvedValue(null);
      collections.counters.findOne.mockResolvedValue(null);
      collections.sales.find.mockReturnValue({
        toArray: jest
          .fn()
          .mockResolvedValue([{ sales_id: 'SID000042' }, { sales_id: 'SID000007' }]),
      });
      collections.counters.findOneAndUpdate.mockResolvedValue({ seq: 43 });
      const r = await salesRepository.generateSalesIdForBranch(FAKE_BRANCH);
      expect(collections.counters.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'sales_id' }),
        { $setOnInsert: { seq: 42 } },
        { upsert: true }
      );
      expect(r).toBe('S-DEV1-000043');
    });
    test('uses custom prefix', async () => {
      if (!collections.branches) collections.branches = mkCol();
      if (!collections.counters) collections.counters = mkCol();
      collections.branches.findOne.mockResolvedValue({ sales_prefix: 'SAL' });
      collections.counters.findOne.mockResolvedValue({ seq: 7 });
      collections.counters.findOneAndUpdate.mockResolvedValue({ seq: 8 });
      const r = await salesRepository.generateSalesIdForBranch(FAKE_BRANCH);
      expect(r).toBe('SAL-DEV1-000008');
    });
    test('two simultaneous callers get distinct numbers', async () => {
      if (!collections.branches) collections.branches = mkCol();
      if (!collections.counters) collections.counters = mkCol();
      collections.branches.findOne.mockResolvedValue(null);
      collections.counters.findOne.mockResolvedValue({ seq: 4 });
      collections.counters.findOneAndUpdate
        .mockResolvedValueOnce({ seq: 5 })
        .mockResolvedValueOnce({ seq: 6 });
      const [a, b] = await Promise.all([
        salesRepository.generateSalesIdForBranch(FAKE_BRANCH),
        salesRepository.generateSalesIdForBranch(FAKE_BRANCH),
      ]);
      expect([a, b].sort()).toEqual(['S-DEV1-000005', 'S-DEV1-000006']);
    });
  });

  describe('bill-number uniqueness (per-till tagging)', () => {
    test('buildSalesId puts the till code between the prefix and the number', async () => {
      const id = await salesRepository.buildSalesId('SID', 45);
      expect(id).toBe('SID-DEV1-000045');
    });

    test('two tills with different codes never collide on the same number', async () => {
      salesRepository.constructor._deviceTag = 'AAAA';
      const a = await salesRepository.buildSalesId('SID', 5);
      salesRepository.constructor._deviceTag = 'BBBB';
      const b = await salesRepository.buildSalesId('SID', 5);
      expect(a).toBe('SID-AAAA-000005');
      expect(b).toBe('SID-BBBB-000005');
      expect(a).not.toBe(b);
    });

    test('buildSalesId falls back to the untagged form when no code is available', async () => {
      jest.spyOn(salesRepository, 'deviceTag').mockResolvedValue('');
      const id = await salesRepository.buildSalesId('SID', 7);
      expect(id).toBe('SID000007');
    });

    test('deviceTag generates and stores a code once, then caches it', async () => {
      salesRepository.constructor._deviceTag = undefined;
      collections.device_meta.findOne
        .mockResolvedValueOnce(null) // none stored yet
        .mockResolvedValueOnce({ _id: 'device_tag', tag: 'Z9Q2' }); // after upsert
      const t1 = await salesRepository.deviceTag();
      expect(t1).toBe('Z9Q2');
      expect(collections.device_meta.updateOne).toHaveBeenCalled();

      collections.device_meta.findOne.mockClear();
      const t2 = await salesRepository.deviceTag(); // served from cache
      expect(t2).toBe('Z9Q2');
      expect(collections.device_meta.findOne).not.toHaveBeenCalled();
    });

    test('isDuplicateSalesIdError matches only a sales_id duplicate key', () => {
      expect(
        salesRepository.isDuplicateSalesIdError({ code: 11000, message: 'E11000 dup: sales_id_1' })
      ).toBe(true);
      expect(
        salesRepository.isDuplicateSalesIdError({ code: 11000, keyPattern: { sales_id: 1 } })
      ).toBe(true);
      expect(
        salesRepository.isDuplicateSalesIdError({
          code: 11000,
          message: 'dup: billing_transaction_id_1',
        })
      ).toBe(false);
      expect(salesRepository.isDuplicateSalesIdError({ code: 121 })).toBe(false);
      expect(salesRepository.isDuplicateSalesIdError(null)).toBe(false);
    });

    test('createSaleUnique retries with the next number on a clash, then succeeds', async () => {
      const dup = new Error('E11000 dup: sales_id_1');
      dup.code = 11000;
      const spy = jest.spyOn(salesRepository, 'create');
      spy.mockRejectedValueOnce(dup).mockResolvedValueOnce({ _id: 'ok' });
      const nextId = jest.fn().mockResolvedValue('S-DEV1-000006');
      const data = { sales_id: 'S-DEV1-000005' };

      const r = await salesRepository.createSaleUnique(data, nextId);
      expect(r._id).toBe('ok');
      expect(nextId).toHaveBeenCalledTimes(1);
      expect(data.sales_id).toBe('S-DEV1-000006'); // number was bumped for the retry
    });

    test('createSaleUnique rethrows a non-duplicate error unchanged', async () => {
      jest.spyOn(salesRepository, 'create').mockRejectedValue(new Error('disk full'));
      await expect(salesRepository.createSaleUnique({}, jest.fn())).rejects.toThrow('disk full');
    });
  });

  describe('readable document numbers (SB1D1)', () => {
    test('deviceCode reads the gateway-assigned code from device_meta, caching a real one', async () => {
      collections.device_meta.findOne.mockResolvedValue({ _id: 'device_code', code: 'D3' });
      expect(await salesRepository.deviceCode()).toBe('D3');
    });

    test('deviceCode is empty (not cached) until a code has been assigned', async () => {
      collections.device_meta.findOne.mockResolvedValue(null);
      expect(await salesRepository.deviceCode()).toBe('');
      // A later assignment is then picked up without a restart.
      collections.device_meta.findOne.mockResolvedValue({ code: 'D5' });
      expect(await salesRepository.deviceCode()).toBe('D5');
    });

    test('branchCode ranks branches by creation order, oldest = B1', async () => {
      if (!collections.branches) collections.branches = mkCol();
      collections.branches.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          { _id: 'young', created_date: '2026-05-01' },
          { _id: 'old', created_date: '2025-01-01' },
          { _id: 'mid', created_date: '2025-09-01' },
        ]),
      });
      expect(await salesRepository.branchCode('old')).toBe('B1');
      expect(await salesRepository.branchCode('mid')).toBe('B2');
      expect(await salesRepository.branchCode('young')).toBe('B3');
    });

    test('buildDocNumber uses the readable scheme when branch and device codes exist', async () => {
      jest.spyOn(salesRepository, 'branchCode').mockResolvedValue('B1');
      jest.spyOn(salesRepository, 'deviceCode').mockResolvedValue('D2');
      expect(await salesRepository.buildDocNumber('S', 'anyBranch', 45)).toBe('SB1D2-000045');
      // A return carries the R- prefix on top of the S/P base.
      expect(await salesRepository.buildDocNumber('S', 'anyBranch', 12, { isReturn: true })).toBe(
        'R-SB1D2-000012'
      );
      // Purchases use P.
      expect(await salesRepository.buildDocNumber('P', 'anyBranch', 8)).toBe('PB1D2-000008');
    });

    test('buildDocNumber falls back to the till-tagged number when a code is missing', async () => {
      jest.spyOn(salesRepository, 'branchCode').mockResolvedValue('B1');
      jest.spyOn(salesRepository, 'deviceCode').mockResolvedValue(''); // no device code yet
      expect(
        await salesRepository.buildDocNumber('S', 'anyBranch', 45, { fallbackPrefix: 'SID' })
      ).toBe('SID-DEV1-000045');
    });
  });

  describe('salePage', () => {
    test('returns paginated results', async () => {
      const docs = [{ _id: FAKE_ID }];
      MockSaleModel.find.mockReturnValue(createQueryMock(docs));
      MockSaleModel.countDocuments.mockResolvedValue(1);
      const r = await salesRepository.salePage({}, { limit: 10, page: 1 }, FAKE_BRANCH);
      expect(r.status).toBe(true);
      expect(r.data.list).toEqual(docs);
      expect(r.data.total).toBe(1);
    });
    test('returns empty results', async () => {
      MockSaleModel.find.mockReturnValue(createQueryMock([]));
      MockSaleModel.countDocuments.mockResolvedValue(0);
      const r = await salesRepository.salePage({}, { limit: 10, page: 1 }, null);
      expect(r.status).toBe(true);
      expect(r.data.list).toEqual([]);
    });
    test('returns error on exception', async () => {
      MockSaleModel.find.mockImplementation(() => {
        throw new Error('fail');
      });
      const r = await salesRepository.salePage({}, {}, null);
      expect(r.status).toBe(false);
    });
  });

  describe('getLegacyDetails', () => {
    test('returns error for invalid id', async () => {
      mongoose.Types.ObjectId.isValid.mockReturnValueOnce(false);
      const r = await salesRepository.getLegacyDetails('bad-id');
      expect(r.status).toBe(false);
      expect(r.message).toBe('Invalid sale id');
    });
    test('returns not found when no document', async () => {
      if (!collections.sales) collections.sales = mkCol();
      collections.sales.findOne.mockResolvedValue(null);
      const r = await salesRepository.getLegacyDetails(FAKE_ID);
      expect(r.status).toBe(false);
      expect(r.message).toBe('Sale not found');
    });
    test('returns normalized sale doc', async () => {
      const saleDoc = {
        _id: { toString: () => FAKE_ID },
        sales_id: 'S001',
        customer_id: FAKE_CUSTOMER,
        items: [],
        branch_id: FAKE_BRANCH,
        license: FAKE_LICENSE,
        gst: 'enable',
      };
      if (!collections.sales) collections.sales = mkCol();
      collections.sales.findOne.mockResolvedValue(saleDoc);
      if (!collections.branches) collections.branches = mkCol();
      collections.branches.findOne.mockResolvedValue({
        _id: FAKE_BRANCH,
        name: 'Main',
        state: 'KA',
        country: 'India',
        indian_gst: 'gst_on',
        branch_gstin_number: 'GSTIN123',
      });
      if (!collections.customers) collections.customers = mkCol();
      collections.customers.findOne.mockResolvedValue({
        _id: FAKE_CUSTOMER,
        name: 'Customer1',
        balance: 100,
        partial_balance: false,
      });
      const r = await salesRepository.getLegacyDetails(FAKE_ID);
      expect(r).toBeDefined();
      expect(r).toHaveProperty('status');
      expect(r).toHaveProperty('data');
    });
  });

  describe('deleteSales', () => {
    test('returns error for empty array', async () => {
      const r = await salesRepository.deleteSales([]);
      expect(r.status).toBe(false);
      expect(r.message).toBe('No IDs provided');
    });
    test('returns error for no valid IDs', async () => {
      mongoose.Types.ObjectId.isValid.mockReturnValue(false);
      const r = await salesRepository.deleteSales(['bad']);
      expect(r.status).toBe(false);
      expect(r.message).toBe('No valid IDs provided');
    });
    test('deletes sales successfully', async () => {
      const saleDoc = {
        _id: FAKE_ID,
        customer_id: FAKE_CUSTOMER,
        items: [{ item_id: FAKE_ITEM, item_quantity: 1 }],
        partial_check: false,
      };
      if (!collections.sales) collections.sales = mkCol();
      collections.sales.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([saleDoc]) });
      if (!collections.items) collections.items = mkCol();
      collections.items.findOne.mockResolvedValue({
        available_quantity: 10,
        track_inventory: false,
      });
      const r = await salesRepository.deleteSales([FAKE_ID]);
      expect(r.status).toBe(true);
    });
  });

  describe('itemSaleDetailsPage', () => {
    test('returns empty when no item_id', async () => {
      const r = await salesRepository.itemSaleDetailsPage({}, {});
      expect(r.status).toBe(true);
      expect(r.data.sale).toEqual([]);
      expect(r.data.return).toEqual([]);
    });
    test('returns error on exception', async () => {
      MockSaleModel.aggregate.mockImplementation(() => {
        throw new Error('fail');
      });
      const r = await salesRepository.itemSaleDetailsPage({ item_id: FAKE_ITEM }, {});
      expect(r.status).toBe(false);
    });
  });

  describe('markKitchenPrintedModel', () => {
    test('returns error for empty ids', async () => {
      const r = await salesRepository.markKitchenPrintedModel([]);
      expect(r.status).toBe(false);
      expect(r.message).toBe('Invalid saleIds provided.');
    });
    test('marks sales as printed', async () => {
      if (!collections.sales) collections.sales = mkCol();
      collections.sales.findOne.mockResolvedValue({ _id: FAKE_ID, changes: [{}, {}] });
      collections.sales.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
      const r = await salesRepository.markKitchenPrintedModel([FAKE_ID]);
      expect(r.status).toBe(true);
      expect(r.data.modified_count).toBe(1);
    });
    test('returns error on exception', async () => {
      if (!collections.sales) collections.sales = mkCol();
      collections.sales.findOne.mockResolvedValue({ _id: FAKE_ID, changes: [{}] });
      collections.sales.updateOne.mockRejectedValue(new Error('fail'));
      const r = await salesRepository.markKitchenPrintedModel([FAKE_ID]);
      expect(r.status).toBe(false);
    });
  });

  describe('qrOrderModel', () => {
    test('returns error when no branch', async () => {
      const r = await salesRepository.qrOrderModel({});
      expect(r.status).toBe(false);
      expect(r.message).toBe('Branch is required');
    });
    test('returns error when branch not found', async () => {
      if (!collections.branches) collections.branches = mkCol();
      collections.branches.findOne.mockResolvedValue(null);
      const r = await salesRepository.qrOrderModel({ branch: FAKE_BRANCH });
      expect(r.status).toBe(false);
      expect(r.message).toBe('Branch not found');
    });
    test('a branch that never configured QR refuses anonymous orders', async () => {
      // The endpoint is anonymous by design; the QR identity is the opt-in.
      // Without this, any branch's raw ObjectId - no secret - was enough for
      // a stranger to put orders on its kitchen queue.
      if (!collections.branches) collections.branches = mkCol();
      collections.branches.findOne.mockResolvedValue({ _id: FAKE_BRANCH, name: 'Main' });
      const r = await salesRepository.qrOrderModel({
        branch: FAKE_BRANCH,
        items: [
          { item_id: FAKE_ITEM, item_name: 'Test', item_quantity: 1, item_price: 10, gst: 1 },
        ],
      });
      expect(r.status).toBe(false);
      expect(r.message).toBe('QR ordering is not enabled for this branch');
    });
    test('creates QR order successfully', async () => {
      if (!collections.branches) collections.branches = mkCol();
      collections.branches.findOne.mockResolvedValue({
        _id: FAKE_BRANCH,
        name: 'Main',
        kiosk: { store_id: 'QR-STORE-1' },
      });
      if (!collections.sales) collections.sales = mkCol();
      collections.sales.insertOne.mockResolvedValue({ insertedId: FAKE_ID });
      // Prices come from the ITEM MASTER now, not the anonymous payload -
      // the order refuses items it cannot verify, so the lookup must answer.
      if (!collections.items) collections.items = mkCol();
      collections.items.findOne.mockResolvedValue({
        _id: FAKE_ITEM,
        name: 'Test',
        selling_price: 10,
        tax: 0,
        tax_type: 'exclusive',
      });
      const r = await salesRepository.qrOrderModel({
        branch: FAKE_BRANCH,
        items: [
          { item_id: FAKE_ITEM, item_name: 'Test', item_quantity: 1, item_price: 10, gst: 1 },
        ],
      });
      expect(r.status).toBe(true);
      expect(r.data.sale_id).toBeDefined();
    });
  });

  describe('itemExpiryReportPage', () => {
    test('returns paginated expiry report', async () => {
      if (!collections.items) collections.items = mkCol();
      collections.items.countDocuments.mockResolvedValue(1);
      collections.items.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          {
            name: 'Item1',
            available_quantity: 5,
            category_name: 'Cat',
            items_expiry_date: new Date(),
          },
        ]),
      });
      const r = await salesRepository.itemExpiryReportPage(
        { starting_date: '2026-01-01', ending_date: '2026-12-31', branchid: FAKE_BRANCH },
        {}
      );
      expect(r.status).toBe(true);
      expect(r.list).toBeDefined();
    });
    test('returns error on exception', async () => {
      if (!collections.items) collections.items = mkCol();
      collections.items.countDocuments.mockImplementation(() => {
        throw new Error('fail');
      });
      const r = await salesRepository.itemExpiryReportPage({}, {});
      expect(r.status).toBe(false);
    });
  });
});
