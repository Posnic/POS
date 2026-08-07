'use strict';

/**
 * Unit tests for src/repositories/receiving.repository.js
 *
 * File confirmed : src/repositories/receiving.repository.js (486 lines, CLASS export)
 * Export type    : CLASS export — module.exports = ReceivingRepository
 * Extends        : BaseModel (super("receivings"))
 *
 * Methods (15):
 *   findAll, findById, findByReceivingId, findBySupplier, findByBranch,
 *   create, update, hardDelete, bulkHardDelete, getLastReceivingId,
 *   findByStatus, findByPaymentStatus, bulkCreate, exportByIds
 *
 * External dependencies (all mocked):
 *   BaseModel            — static license, currentBranch, loggedUser, loggedUserName
 *   mongodb ObjectId     — mocked
 *   StockLogsRepository  — class, mocked for hardDelete stock log integration
 */

// ─── Mock mongodb ObjectId ────────────────────────────────────────────────────
jest.mock('mongodb', () => {
  const m = jest.fn((id) => ({ toString: () => String(id), toHexString: () => String(id) }));
  m.isValid = jest.fn(() => true);
  return { ObjectId: m };
});

// ─── Mock StockLogsRepository (class) ─────────────────────────────────────────
jest.mock('../../../src/repositories/stock-log.repository', () =>
  jest.fn().mockImplementation(() => ({
    createStockLog: jest.fn().mockResolvedValue({ status: true }),
  }))
);

// ─── Mock BaseModel ───────────────────────────────────────────────────────────
let MockBaseModel;
jest.mock('../../../src/models/base.model', () => {
  function MockBaseModel(c) {
    this.collectionName = c;
  }
  MockBaseModel.prototype.toObjectId = jest.fn((id) => id);
  MockBaseModel.prototype.checkPlan = jest.fn().mockResolvedValue(0);
  MockBaseModel.prototype.assignFilterObjects = jest.fn((f) => f);
  MockBaseModel.prototype.startingDate = jest.fn((d) => new Date(d));
  MockBaseModel.prototype.endingDate = jest.fn((d) => new Date(d));
  MockBaseModel.startingDate = jest.fn((d) => new Date(d));
  MockBaseModel.endingDate = jest.fn((d) => new Date(d));
  MockBaseModel.simplifyFields = jest.fn((d) => d);
  MockBaseModel.getSelectFields = jest.fn(() => ({}));
  MockBaseModel.getAllDataChanges = jest.fn().mockResolvedValue([]);
  MockBaseModel.deletedDocumentBackup = jest.fn().mockResolvedValue({});
  MockBaseModel.currentTimeZone = 'Asia/Kolkata';
  MockBaseModel.license = null;
  MockBaseModel.currentBranch = null;
  MockBaseModel.loggedUser = null;
  MockBaseModel.loggedUserName = null;
  return MockBaseModel;
});

// ─── Imports (after mocks) ──────────────────────────────────────────────────
const ReceivingRepository = require('../../../src/repositories/receiving.repository');
const BaseModel = require('../../../src/models/base.model');
const StockLogsRepository = require('../../../src/repositories/stock-log.repository');
require('mongodb');

// ─── Shared fake IDs ────────────────────────────────────────────────────────
const FAKE_ID = '64f9a1c2e3b4d5e6f7000001';
const FAKE_SUPPLIER = '64f9a1c2e3b4d5e6f7000002';
const FAKE_BRANCH = '64f9a1c2e3b4d5e6f7000003';
const FAKE_LICENSE = '64f9a1c2e3b4d5e6f7000004';
const FAKE_ITEM = '64f9a1c2e3b4d5e6f7000005';

// ─── Query chain helpers ──────────────────────────────────────────────────────
const mkChain = (result) => ({
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  toArray: jest.fn().mockResolvedValue(result),
});

const mkAgg = (result) => ({
  toArray: jest.fn().mockResolvedValue(result),
});

// ══════════════════════════════════════════════════════════════════════════════
describe('ReceivingRepository', () => {
  let repo;
  let col;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    BaseModel.license = FAKE_LICENSE;
    BaseModel.currentBranch = FAKE_BRANCH;
    BaseModel.loggedUser = FAKE_ID;
    BaseModel.loggedUserName = 'Test User';

    col = {
      find: jest.fn().mockReturnValue(mkChain([])),
      findOne: jest.fn().mockResolvedValue(null),
      insertOne: jest.fn().mockResolvedValue({ insertedId: FAKE_ID }),
      insertMany: jest.fn().mockResolvedValue({ insertedIds: { 0: FAKE_ID } }),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      countDocuments: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockReturnValue(mkAgg([])),
    };

    repo = new ReceivingRepository();
    repo.getCollection = jest.fn().mockResolvedValue(col);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Constructor / Initialization
  // ════════════════════════════════════════════════════════════════════════════
  describe('constructor', () => {
    test('extends BaseModel with collectionName "receivings"', () => {
      expect(repo.collectionName).toBe('receivings');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // findAll
  // ════════════════════════════════════════════════════════════════════════════
  describe('findAll', () => {
    test('returns paginated receivings with defaults', async () => {
      col.find.mockReturnValue(mkChain([{ _id: FAKE_ID }]));
      col.countDocuments.mockResolvedValue(1);

      const r = await repo.findAll();

      expect(r.data).toEqual([{ _id: FAKE_ID }]);
      expect(r.total).toBe(1);
      expect(r.page).toBe(1);
      expect(r.limit).toBe(10);
      expect(r.totalPages).toBe(1);
    });

    test('applies custom page and limit', async () => {
      col.find.mockReturnValue(mkChain([]));
      col.countDocuments.mockResolvedValue(0);

      await repo.findAll({}, { page: 2, limit: 5 });

      expect(col.find.mock.calls[0][0]).toMatchObject({ license: FAKE_LICENSE });
      const chain = col.find.mock.results[0].value;
      expect(chain.skip).toHaveBeenCalledWith(5);
      expect(chain.limit).toHaveBeenCalledWith(5);
    });

    test('normalizes negative page and limit to safe values', async () => {
      col.find.mockReturnValue(mkChain([]));
      col.countDocuments.mockResolvedValue(0);

      const r = await repo.findAll({}, { page: -1, limit: -5 });

      expect(r.page).toBe(1);
      expect(r.limit).toBe(1);
    });

    test('applies filters merged with license', async () => {
      col.find.mockReturnValue(mkChain([]));
      col.countDocuments.mockResolvedValue(0);

      await repo.findAll({ supplier: FAKE_SUPPLIER });

      expect(col.find.mock.calls[0][0]).toMatchObject({
        supplier: FAKE_SUPPLIER,
        license: FAKE_LICENSE,
      });
    });

    test('applies custom sort', async () => {
      col.find.mockReturnValue(mkChain([]));
      col.countDocuments.mockResolvedValue(0);

      await repo.findAll({}, { sort: { created_date: 1 } });

      const chain = col.find.mock.results[0].value;
      expect(chain.sort).toHaveBeenCalledWith({ created_date: 1 });
    });

    test('rethrows error when getCollection fails', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('db fail'));
      await expect(repo.findAll()).rejects.toThrow('db fail');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // findById
  // ════════════════════════════════════════════════════════════════════════════
  describe('findById', () => {
    test('returns receiving when found', async () => {
      col.findOne.mockResolvedValue({ _id: FAKE_ID });

      const r = await repo.findById(FAKE_ID);

      expect(r).toEqual({ _id: FAKE_ID });
      expect(col.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: expect.anything(), license: FAKE_LICENSE })
      );
    });

    test('returns null when not found', async () => {
      col.findOne.mockResolvedValue(null);

      const r = await repo.findById(FAKE_ID);

      expect(r).toBeNull();
    });

    test('rethrows error on failure', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repo.findById(FAKE_ID)).rejects.toThrow('fail');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // findByReceivingId
  // ════════════════════════════════════════════════════════════════════════════
  describe('findByReceivingId', () => {
    test('returns receiving by human-readable ID', async () => {
      col.findOne.mockResolvedValue({ _id: FAKE_ID, receiving_id: 'RID000001' });

      const r = await repo.findByReceivingId('RID000001');

      expect(r).toEqual({ _id: FAKE_ID, receiving_id: 'RID000001' });
      expect(col.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ receiving_id: 'RID000001', license: FAKE_LICENSE })
      );
    });

    test('returns null when not found', async () => {
      col.findOne.mockResolvedValue(null);

      const r = await repo.findByReceivingId('RID999999');

      expect(r).toBeNull();
    });

    test('rethrows error on failure', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repo.findByReceivingId('RID000001')).rejects.toThrow('fail');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // findBySupplier
  // ════════════════════════════════════════════════════════════════════════════
  describe('findBySupplier', () => {
    test('returns paginated receivings for supplier', async () => {
      col.find.mockReturnValue(mkChain([{ _id: FAKE_ID }]));
      col.countDocuments.mockResolvedValue(1);

      const r = await repo.findBySupplier(FAKE_SUPPLIER);

      expect(r.data).toEqual([{ _id: FAKE_ID }]);
      expect(col.find).toHaveBeenCalledWith(
        expect.objectContaining({ supplier: expect.anything(), license: FAKE_LICENSE })
      );
    });

    test('uses custom pagination options', async () => {
      col.find.mockReturnValue(mkChain([]));
      col.countDocuments.mockResolvedValue(0);

      await repo.findBySupplier(FAKE_SUPPLIER, { page: 3, limit: 15 });

      const chain = col.find.mock.results[0].value;
      expect(chain.skip).toHaveBeenCalledWith(30);
      expect(chain.limit).toHaveBeenCalledWith(15);
    });

    test('rethrows error on failure', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repo.findBySupplier(FAKE_SUPPLIER)).rejects.toThrow('fail');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // findByBranch
  // ════════════════════════════════════════════════════════════════════════════
  describe('findByBranch', () => {
    test('returns paginated receivings for branch', async () => {
      col.find.mockReturnValue(mkChain([{ _id: FAKE_ID }]));
      col.countDocuments.mockResolvedValue(1);

      const r = await repo.findByBranch(FAKE_BRANCH);

      expect(r.data).toEqual([{ _id: FAKE_ID }]);
      expect(col.find).toHaveBeenCalledWith(
        expect.objectContaining({ branch_id: expect.anything(), license: FAKE_LICENSE })
      );
    });

    test('uses custom pagination options', async () => {
      col.find.mockReturnValue(mkChain([]));
      col.countDocuments.mockResolvedValue(0);

      await repo.findByBranch(FAKE_BRANCH, { page: 2, limit: 20 });

      const chain = col.find.mock.results[0].value;
      expect(chain.skip).toHaveBeenCalledWith(20);
      expect(chain.limit).toHaveBeenCalledWith(20);
    });

    test('rethrows error on failure', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repo.findByBranch(FAKE_BRANCH)).rejects.toThrow('fail');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // create
  // ════════════════════════════════════════════════════════════════════════════
  describe('create', () => {
    test('inserts receiving and returns created document', async () => {
      const data = { supplier: FAKE_SUPPLIER, total: 350 };
      col.findOne.mockResolvedValue({ _id: FAKE_ID, ...data });

      const r = await repo.create(data);

      expect(col.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          ...data,
          license: FAKE_LICENSE,
          created_date: expect.any(Date),
          updated_date: expect.any(Date),
        })
      );
      expect(r).toEqual({ _id: FAKE_ID, ...data });
    });

    test('rethrows error on failure', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repo.create({})).rejects.toThrow('fail');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // update
  // ════════════════════════════════════════════════════════════════════════════
  describe('update', () => {
    test('updates receiving and returns updated document', async () => {
      const updateData = { total: 400 };
      col.findOne.mockResolvedValue({ _id: FAKE_ID, total: 400 });

      const r = await repo.update(FAKE_ID, updateData);

      expect(col.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: expect.anything(), license: FAKE_LICENSE }),
        expect.objectContaining({
          $set: expect.objectContaining({
            total: 400,
            updated_date: expect.any(Date),
            updated_by: FAKE_ID,
            updated_by_id: FAKE_ID,
          }),
        })
      );
      expect(r).toEqual({ _id: FAKE_ID, total: 400 });
    });

    test('rethrows error on failure', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repo.update(FAKE_ID, {})).rejects.toThrow('fail');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // hardDelete
  // ════════════════════════════════════════════════════════════════════════════
  describe('hardDelete', () => {
    const receivingDoc = {
      _id: FAKE_ID,
      receiving_id: 'RID000001',
      receiving_status: 'Received',
      items: [{ item_id: FAKE_ITEM, item_quantity: 5, item_name: 'Widget', barcode_id: 'B001' }],
    };

    test('throws when receiving not found', async () => {
      col.findOne.mockResolvedValue(null);

      await expect(repo.hardDelete(FAKE_ID)).rejects.toThrow('Receiving not found');
    });

    test('deletes receiving without stock logs when stock_management is false', async () => {
      col.findOne.mockResolvedValue(receivingDoc);
      const branchCol = { findOne: jest.fn().mockResolvedValue({ stock_management: false }) };
      const recycleCol = { insertOne: jest.fn().mockResolvedValue({}) };

      repo.getCollection.mockImplementation((name) => {
        if (name === 'branches') return Promise.resolve(branchCol);
        if (name === 'recycle_bin') return Promise.resolve(recycleCol);
        return Promise.resolve(col);
      });

      const r = await repo.hardDelete(FAKE_ID);

      expect(r).toEqual(receivingDoc);
      expect(branchCol.findOne).toHaveBeenCalledWith({ _id: FAKE_BRANCH });
      expect(recycleCol.insertOne).toHaveBeenCalled();
      expect(col.deleteOne).toHaveBeenCalled();
      expect(StockLogsRepository).not.toHaveBeenCalled();
    });

    test('creates stock logs and updates item quantity when stock_management is true', async () => {
      col.findOne.mockResolvedValue(receivingDoc);
      const branchCol = {
        findOne: jest
          .fn()
          .mockResolvedValue({ stock_management: true, stock_management_log: true }),
      };
      const recycleCol = { insertOne: jest.fn().mockResolvedValue({}) };
      const itemsCol = {
        findOne: jest.fn().mockResolvedValue({
          _id: FAKE_ITEM,
          track_inventory: true,
          available_quantity: 20,
          barcode_id: 'B001',
          name: 'Widget',
        }),
        updateOne: jest.fn().mockResolvedValue({}),
      };

      repo.getCollection.mockImplementation((name) => {
        if (name === 'branches') return Promise.resolve(branchCol);
        if (name === 'recycle_bin') return Promise.resolve(recycleCol);
        if (name === 'items') return Promise.resolve(itemsCol);
        return Promise.resolve(col);
      });

      const r = await repo.hardDelete(FAKE_ID);

      expect(r).toEqual(receivingDoc);
      expect(itemsCol.findOne).toHaveBeenCalledWith({
        _id: expect.anything(),
        license: FAKE_LICENSE,
      });
      expect(itemsCol.updateOne).toHaveBeenCalledWith(
        { _id: expect.anything(), license: FAKE_LICENSE },
        { $set: { available_quantity: 15 } }
      );
    });

    test('skips items without track_inventory', async () => {
      col.findOne.mockResolvedValue(receivingDoc);
      const branchCol = { findOne: jest.fn().mockResolvedValue({ stock_management: true }) };
      const recycleCol = { insertOne: jest.fn().mockResolvedValue({}) };
      const itemsCol = {
        findOne: jest
          .fn()
          .mockResolvedValue({ _id: FAKE_ITEM, track_inventory: false, available_quantity: 20 }),
        updateOne: jest.fn().mockResolvedValue({}),
      };

      repo.getCollection.mockImplementation((name) => {
        if (name === 'branches') return Promise.resolve(branchCol);
        if (name === 'recycle_bin') return Promise.resolve(recycleCol);
        if (name === 'items') return Promise.resolve(itemsCol);
        return Promise.resolve(col);
      });

      await repo.hardDelete(FAKE_ID);

      expect(itemsCol.updateOne).not.toHaveBeenCalled();
    });

    test('skips items with missing item_id or item_quantity', async () => {
      const docWithBadItems = {
        ...receivingDoc,
        items: [{ item_quantity: 5 }, { item_id: FAKE_ITEM }],
      };
      col.findOne.mockResolvedValue(docWithBadItems);
      const branchCol = { findOne: jest.fn().mockResolvedValue({ stock_management: true }) };
      const recycleCol = { insertOne: jest.fn().mockResolvedValue({}) };
      const itemsCol = {
        findOne: jest.fn().mockResolvedValue({ track_inventory: true }),
        updateOne: jest.fn().mockResolvedValue({}),
      };

      repo.getCollection.mockImplementation((name) => {
        if (name === 'branches') return Promise.resolve(branchCol);
        if (name === 'recycle_bin') return Promise.resolve(recycleCol);
        if (name === 'items') return Promise.resolve(itemsCol);
        return Promise.resolve(col);
      });

      await repo.hardDelete(FAKE_ID);

      expect(itemsCol.findOne).not.toHaveBeenCalled();
    });

    test('backs up to recycle bin before deletion', async () => {
      col.findOne.mockResolvedValue(receivingDoc);
      const branchCol = { findOne: jest.fn().mockResolvedValue({ stock_management: false }) };
      const recycleCol = { insertOne: jest.fn().mockResolvedValue({}) };

      repo.getCollection.mockImplementation((name) => {
        if (name === 'branches') return Promise.resolve(branchCol);
        if (name === 'recycle_bin') return Promise.resolve(recycleCol);
        return Promise.resolve(col);
      });

      await repo.hardDelete(FAKE_ID);

      expect(recycleCol.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          collection_name: 'receivings',
          document: receivingDoc,
          deleted_date: expect.any(Date),
          deleted_by: 'Test User',
          deleted_by_id: FAKE_ID,
          license: FAKE_LICENSE,
        })
      );
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // bulkHardDelete
  // ════════════════════════════════════════════════════════════════════════════
  describe('bulkHardDelete', () => {
    test('returns deletedCount after bulk delete with backup', async () => {
      const docs = [{ _id: FAKE_ID }, { _id: FAKE_SUPPLIER }];
      col.find.mockReturnValue(mkChain(docs));
      const recycleCol = { insertMany: jest.fn().mockResolvedValue({}) };

      repo.getCollection.mockImplementation((name) => {
        if (name === 'recycle_bin') return Promise.resolve(recycleCol);
        return Promise.resolve(col);
      });

      const r = await repo.bulkHardDelete([FAKE_ID, FAKE_SUPPLIER]);

      expect(r.deletedCount).toBe(1);
      expect(recycleCol.insertMany).toHaveBeenCalled();
      expect(col.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({ _id: { $in: expect.any(Array) }, license: FAKE_LICENSE })
      );
    });

    test('returns deletedCount 0 when no receivings found', async () => {
      col.find.mockReturnValue(mkChain([]));

      const r = await repo.bulkHardDelete([FAKE_ID]);

      expect(r.deletedCount).toBe(0);
      expect(col.deleteMany).not.toHaveBeenCalled();
    });

    test('rethrows error on failure', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repo.bulkHardDelete([FAKE_ID])).rejects.toThrow('fail');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getLastReceivingId
  // ════════════════════════════════════════════════════════════════════════════
  describe('getLastReceivingId', () => {
    test('returns last receiving for branch', async () => {
      col.find.mockReturnValue(mkChain([{ _id: FAKE_ID, receiving_id: 'RID000005' }]));

      const r = await repo.getLastReceivingId(FAKE_BRANCH);

      expect(r).toEqual({ _id: FAKE_ID, receiving_id: 'RID000005' });
      expect(col.find).toHaveBeenCalledWith(
        expect.objectContaining({ branch_id: expect.anything(), license: FAKE_LICENSE })
      );
    });

    test('returns null when no receivings exist', async () => {
      col.find.mockReturnValue(mkChain([]));

      const r = await repo.getLastReceivingId();

      expect(r).toBeNull();
    });

    test('rethrows error on failure', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repo.getLastReceivingId()).rejects.toThrow('fail');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // findByStatus
  // ════════════════════════════════════════════════════════════════════════════
  describe('findByStatus', () => {
    test('returns paginated receivings by status', async () => {
      col.find.mockReturnValue(mkChain([{ _id: FAKE_ID, status: 'draft' }]));
      col.countDocuments.mockResolvedValue(1);

      const r = await repo.findByStatus('draft');

      expect(r.data).toEqual([{ _id: FAKE_ID, status: 'draft' }]);
      expect(col.find).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'draft', license: FAKE_LICENSE })
      );
    });

    test('rethrows error on failure', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repo.findByStatus('draft')).rejects.toThrow('fail');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // findByPaymentStatus
  // ════════════════════════════════════════════════════════════════════════════
  describe('findByPaymentStatus', () => {
    test('returns paginated receivings by payment status', async () => {
      col.find.mockReturnValue(mkChain([{ _id: FAKE_ID, payment_status: 'pending' }]));
      col.countDocuments.mockResolvedValue(1);

      const r = await repo.findByPaymentStatus('pending');

      expect(r.data).toEqual([{ _id: FAKE_ID, payment_status: 'pending' }]);
      expect(col.find).toHaveBeenCalledWith(
        expect.objectContaining({ payment_status: 'pending', license: FAKE_LICENSE })
      );
    });

    test('rethrows error on failure', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repo.findByPaymentStatus('paid')).rejects.toThrow('fail');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // bulkCreate
  // ════════════════════════════════════════════════════════════════════════════
  describe('bulkCreate', () => {
    test('inserts multiple receivings and returns them', async () => {
      const data = [{ supplier: FAKE_SUPPLIER }, { supplier: FAKE_SUPPLIER }];
      col.find.mockReturnValue(mkChain(data));

      const r = await repo.bulkCreate(data);

      expect(col.insertMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ supplier: FAKE_SUPPLIER, license: FAKE_LICENSE }),
        ])
      );
      expect(r).toEqual(data);
    });

    test('rethrows error on failure', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repo.bulkCreate([{}])).rejects.toThrow('fail');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // exportByIds
  // ════════════════════════════════════════════════════════════════════════════
  describe('exportByIds', () => {
    test('returns selected fields for given IDs', async () => {
      col.find.mockReturnValue(mkChain([{ receiving_id: 'RID001', supplier_name: 'S' }]));

      const r = await repo.exportByIds([FAKE_ID]);

      expect(col.find).toHaveBeenCalledWith(
        expect.objectContaining({ _id: { $in: expect.any(Array) }, license: FAKE_LICENSE })
      );
      expect(r).toEqual([{ receiving_id: 'RID001', supplier_name: 'S' }]);
    });

    test('rethrows error on failure', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repo.exportByIds([FAKE_ID])).rejects.toThrow('fail');
    });
  });
});
