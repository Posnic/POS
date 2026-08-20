'use strict';

/**
 * Unit tests for src/repositories/supplier.repository.js
 * CLASS export — module.exports = SupplierRepository
 * Extends BaseModel, collectionName "suppliers"
 * Uses native MongoDB driver
 */

// ─── Mock mongodb ObjectId ────────────────────────────────────────────────────
jest.mock('mongodb', () => {
  const ObjectIdMock = jest.fn((id) => ({
    toString: () => String(id),
    toHexString: () => String(id),
    equals: (o) => String(id) === String(o),
  }));
  ObjectIdMock.isValid = jest.fn(() => true);
  return { ObjectId: ObjectIdMock };
});

// ─── Mock BaseModel ───────────────────────────────────────────────────────────
jest.mock('../../../src/models/base.model', () => {
  class MockBaseModel {
    constructor(collectionName) {
      this.collectionName = collectionName;
    }
  }
  MockBaseModel.prototype.getCollection = jest.fn();
  MockBaseModel.simplifyFields = jest.fn((doc) => doc);
  MockBaseModel.license = null;
  MockBaseModel.currentBranch = null;
  MockBaseModel.loggedUser = null;
  return MockBaseModel;
});

// ─── Imports ──────────────────────────────────────────────────────────────────
const SupplierRepository = require('../../../src/repositories/supplier.repository');
const BaseModel = require('../../../src/models/base.model');
require('mongodb');

// ─── Shared fake IDs ────────────────────────────────────────────────────────────
const FAKE_ID = '64f9a1c2e3b4d5e6f7000001';
const FAKE_ID_2 = '64f9a1c2e3b4d5e6f7000002';
const FAKE_LICENSE = '64f9a1c2e3b4d5e6f7000003';
const FAKE_BRANCH = '64f9a1c2e3b4d5e6f7000004';

// ─── Collection chain helper ──────────────────────────────────────────────────
const mkChain = (result) => ({
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  toArray: jest.fn().mockResolvedValue(result),
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('SupplierRepository', () => {
  let repo;
  let col;
  let recvCol;
  let recycleCol;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    BaseModel.license = FAKE_LICENSE;
    BaseModel.currentBranch = FAKE_BRANCH;
    BaseModel.loggedUser = FAKE_ID;

    col = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockReturnValue(mkChain([])),
      insertOne: jest.fn().mockResolvedValue({ insertedId: FAKE_ID }),
      insertMany: jest.fn().mockResolvedValue({ insertedIds: { 0: FAKE_ID, 1: FAKE_ID_2 } }),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      updateMany: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 2 }),
      countDocuments: jest.fn().mockResolvedValue(0),
      findOneAndUpdate: jest.fn().mockResolvedValue({ value: null }),
      aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    };

    recvCol = {
      find: jest.fn().mockReturnValue(mkChain([])),
      countDocuments: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    };

    recycleCol = {
      insertOne: jest.fn().mockResolvedValue({ insertedId: FAKE_ID }),
      insertMany: jest.fn().mockResolvedValue({ insertedIds: { 0: FAKE_ID } }),
    };

    repo = new SupplierRepository();
    // getCollection returns different collections by name
    repo.getCollection = jest.fn().mockImplementation((name) => {
      if (name === 'suppliers') return Promise.resolve(col);
      if (name === 'receiving') return Promise.resolve(recvCol);
      if (name === 'suppliers_recycle_bin') return Promise.resolve(recycleCol);
      return Promise.resolve(col);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Constructor ─────────────────────────────────────────────────────────────

  describe('constructor', () => {
    test('extends BaseModel with collectionName "suppliers"', () => {
      expect(repo.collectionName).toBe('suppliers');
    });
  });

  // ── findAll ───────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    test('returns paginated suppliers', async () => {
      const docs = [{ _id: FAKE_ID, name: 'Supplier A' }];
      col.find.mockReturnValue(mkChain(docs));
      col.countDocuments.mockResolvedValue(1);

      const r = await repo.findAll();

      expect(r.data).toEqual(docs);
      expect(r.total).toBe(1);
      expect(r.page).toBe(1);
      expect(r.limit).toBe(10);
      expect(r.totalPages).toBe(1);
      expect(col.find).toHaveBeenCalledWith(
        expect.objectContaining({ license: FAKE_LICENSE, is_deleted: { $ne: true } })
      );
    });

    test('applies custom page and limit', async () => {
      col.find.mockReturnValue(mkChain([]));
      col.countDocuments.mockResolvedValue(0);

      await repo.findAll({}, { page: 2, limit: 5 });

      const chain = col.find.mock.results[0].value;
      expect(chain.skip).toHaveBeenCalledWith(5);
      expect(chain.limit).toHaveBeenCalledWith(5);
    });

    test('merges additional filters', async () => {
      col.find.mockReturnValue(mkChain([]));
      col.countDocuments.mockResolvedValue(0);

      await repo.findAll({ status: 'active' });

      expect(col.find.mock.calls[0][0]).toMatchObject({
        status: 'active',
        license: FAKE_LICENSE,
        is_deleted: { $ne: true },
      });
    });

    test('handles empty results', async () => {
      col.find.mockReturnValue(mkChain([]));
      col.countDocuments.mockResolvedValue(0);

      const r = await repo.findAll();

      expect(r.data).toEqual([]);
      expect(r.total).toBe(0);
      expect(r.totalPages).toBe(0);
    });

    test('rethrows error when getCollection fails', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('db fail'));
      await expect(repo.findAll()).rejects.toThrow('db fail');
    });
  });

  // ── findById ──────────────────────────────────────────────────────────────────

  describe('findById', () => {
    test('returns supplier when found', async () => {
      const doc = { _id: FAKE_ID, name: 'Supplier A' };
      col.findOne.mockResolvedValue(doc);

      const r = await repo.findById(FAKE_ID);

      expect(r).toEqual(doc);
      expect(col.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: expect.anything(),
          license: FAKE_LICENSE,
          is_deleted: { $ne: true },
        })
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

  // ── findByEmail ──────────────────────────────────────────────────────────────

  describe('findByEmail', () => {
    test('returns supplier by email', async () => {
      const doc = { _id: FAKE_ID, email: 'test@example.com' };
      col.findOne.mockResolvedValue(doc);

      const r = await repo.findByEmail('test@example.com');

      expect(r).toEqual(doc);
      expect(col.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'test@example.com',
          license: FAKE_LICENSE,
          is_deleted: { $ne: true },
        })
      );
    });

    test('returns null when email not found', async () => {
      col.findOne.mockResolvedValue(null);
      const r = await repo.findByEmail('missing@example.com');
      expect(r).toBeNull();
    });
  });

  // ── findByPhone ──────────────────────────────────────────────────────────────

  describe('findByPhone', () => {
    test('returns supplier by phone', async () => {
      const doc = { _id: FAKE_ID, phone: '9876543210' };
      col.findOne.mockResolvedValue(doc);

      const r = await repo.findByPhone('9876543210');

      expect(r).toEqual(doc);
      expect(col.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          phone: '9876543210',
          license: FAKE_LICENSE,
          is_deleted: { $ne: true },
        })
      );
    });
  });

  // ── findByNamePhoneBranch ────────────────────────────────────────────────────

  describe('findByNamePhoneBranch', () => {
    test('finds by name and phone with branch', async () => {
      const doc = { _id: FAKE_ID, name: 'Acme' };
      col.findOne.mockResolvedValue(doc);

      const r = await repo.findByNamePhoneBranch('Acme', '9876543210', FAKE_BRANCH);

      expect(r).toEqual(doc);
      expect(col.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Acme',
          phone: '9876543210',
          branch_id: expect.anything(),
          license: FAKE_LICENSE,
          is_deleted: { $ne: true },
        })
      );
    });

    test('finds by name and phone without branch', async () => {
      col.findOne.mockResolvedValue(null);
      await repo.findByNamePhoneBranch('Acme', '9876543210', null);

      expect(col.findOne).toHaveBeenCalledWith(
        expect.not.objectContaining({ branch_id: expect.anything() })
      );
    });

    test('uses empty string when phone is falsy', async () => {
      await repo.findByNamePhoneBranch('Acme', null, null);

      expect(col.findOne).toHaveBeenCalledWith(expect.objectContaining({ phone: '' }));
    });
  });

  // ── search ────────────────────────────────────────────────────────────────────

  describe('search', () => {
    test('returns search results with pagination', async () => {
      const docs = [{ _id: FAKE_ID, name: 'Acme Corp' }];
      col.find.mockReturnValue(mkChain(docs));
      col.countDocuments.mockResolvedValue(1);

      const r = await repo.search('acme', { page: 1, limit: 10 });

      expect(r.data).toEqual(docs);
      expect(r.total).toBe(1);
      expect(col.find).toHaveBeenCalledWith(
        expect.objectContaining({
          license: FAKE_LICENSE,
          is_deleted: { $ne: true },
          $or: expect.any(Array),
        })
      );
    });

    test('scopes to the branch WITHOUT losing the search terms', async () => {
      /* S7: the scope accepts branch_access OR the legacy branch_id, and rides
         under $and because this query already owns the top-level $or for
         name/company/email/phone. A second $or would replace those terms, and
         a search that loses its terms quietly returns every supplier. */
      col.find.mockReturnValue(mkChain([]));
      col.countDocuments.mockResolvedValue(0);

      await repo.search('test', { branchId: FAKE_BRANCH });

      const filter = col.find.mock.calls[0][0];
      expect(filter.$or).toHaveLength(4);
      expect(filter.$and).toHaveLength(1);
      expect(filter.$and[0].$or.map((o) => Object.keys(o)[0])).toEqual([
        'branch_access.branch_id',
        'branch_id',
      ]);
    });

    test('handles empty search term', async () => {
      col.find.mockReturnValue(mkChain([]));
      col.countDocuments.mockResolvedValue(0);

      const r = await repo.search('');
      expect(r.data).toEqual([]);
      expect(r.total).toBe(0);
    });
  });

  // ── create ────────────────────────────────────────────────────────────────────

  describe('create', () => {
    test('creates supplier and returns created doc', async () => {
      const input = { name: 'Acme', email: 'a@example.com' };
      const created = { _id: FAKE_ID, ...input };
      col.findOne.mockResolvedValue(created);

      const r = await repo.create(input);

      expect(r).toEqual(created);
      expect(col.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Acme',
          email: 'a@example.com',
          license: FAKE_LICENSE,
          created_date: expect.any(Date),
          updated_date: expect.any(Date),
          is_deleted: false,
        })
      );
      expect(col.findOne).toHaveBeenCalled();
    });

    test('omits blank optional email to avoid unique-index collisions', async () => {
      await repo.create({ name: 'No Email', email: '   ' });
      expect(col.insertOne.mock.calls[0][0]).not.toHaveProperty('email');
    });

    test('rethrows on insert failure', async () => {
      col.insertOne.mockRejectedValue(new Error('insert fail'));
      await expect(repo.create({ name: 'X' })).rejects.toThrow('insert fail');
    });
  });

  // ── update ────────────────────────────────────────────────────────────────────

  describe('update', () => {
    test('updates supplier and returns updated doc', async () => {
      const updated = { _id: FAKE_ID, name: 'Updated' };
      col.findOneAndUpdate.mockResolvedValue({ value: updated });

      const r = await repo.update(FAKE_ID, { name: 'Updated' });

      expect(r).toEqual(updated);
      expect(col.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: expect.anything(),
          license: FAKE_LICENSE,
          is_deleted: { $ne: true },
        }),
        expect.objectContaining({
          $set: expect.objectContaining({
            name: 'Updated',
            updated_date: expect.any(Date),
          }),
        }),
        { returnDocument: 'after' }
      );
    });

    test('returns null when supplier not found', async () => {
      col.findOneAndUpdate.mockResolvedValue({ value: null });
      const r = await repo.update(FAKE_ID, { name: 'X' });
      expect(r).toBeNull();
    });

    test('unsets email when an update clears the optional value', async () => {
      await repo.update(FAKE_ID, { email: '' });
      const update = col.findOneAndUpdate.mock.calls[0][1];
      expect(update.$set).not.toHaveProperty('email');
      expect(update.$unset).toEqual({ email: '' });
    });
  });

  // ── softDelete ──────────────────────────────────────────────────────────────

  describe('softDelete', () => {
    test('backs up and hard deletes supplier', async () => {
      const doc = { _id: FAKE_ID, name: 'ToDelete' };
      col.findOne.mockResolvedValue(doc);

      const r = await repo.softDelete(FAKE_ID);

      expect(r).toEqual(doc);
      expect(recycleCol.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: FAKE_ID,
          name: 'ToDelete',
          deleted_date: expect.any(Date),
          deleted_by: FAKE_ID,
        })
      );
      expect(col.deleteOne).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: expect.anything(),
          license: FAKE_LICENSE,
        })
      );
    });

    test('throws when supplier not found', async () => {
      col.findOne.mockResolvedValue(null);
      await expect(repo.softDelete(FAKE_ID)).rejects.toThrow('Supplier not found');
    });

    test('uses "system" fallback when loggedUser is null', async () => {
      BaseModel.loggedUser = null;
      col.findOne.mockResolvedValue({ _id: FAKE_ID });

      await repo.softDelete(FAKE_ID);

      expect(recycleCol.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({ deleted_by: 'system' })
      );
    });
  });

  // ── bulkSoftDelete ───────────────────────────────────────────────────────────

  describe('bulkSoftDelete', () => {
    test('backs up and deletes multiple suppliers', async () => {
      const docs = [{ _id: FAKE_ID }, { _id: FAKE_ID_2 }];
      col.find.mockReturnValue(mkChain(docs));
      col.deleteMany.mockResolvedValue({ deletedCount: 2 });

      const r = await repo.bulkSoftDelete([FAKE_ID, FAKE_ID_2]);

      expect(r.deletedCount).toBe(2);
      expect(recycleCol.insertMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ _id: FAKE_ID, deleted_by: FAKE_ID }),
          expect.objectContaining({ _id: FAKE_ID_2, deleted_by: FAKE_ID }),
        ])
      );
    });

    test('returns zero when no suppliers match', async () => {
      col.find.mockReturnValue(mkChain([]));
      const r = await repo.bulkSoftDelete([FAKE_ID]);
      expect(r.deletedCount).toBe(0);
    });
  });

  // ── getSummary ────────────────────────────────────────────────────────────────

  describe('getSummary', () => {
    test('returns supplier with purchase summary', async () => {
      const supplier = { _id: FAKE_ID, name: 'Acme' };
      col.findOne.mockResolvedValue(supplier);
      recvCol.aggregate.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          {
            totalPurchases: 5,
            totalAmount: 10000,
            totalPaid: 8000,
            totalDue: 2000,
          },
        ]),
      });

      const r = await repo.getSummary(FAKE_ID);

      expect(r.supplier).toEqual(supplier);
      expect(r.totalPurchases).toBe(5);
      expect(r.totalAmount).toBe(10000);
      expect(r.totalPaid).toBe(8000);
      expect(r.totalDue).toBe(2000);
    });

    test('returns defaults when no purchases', async () => {
      col.findOne.mockResolvedValue({ _id: FAKE_ID });
      recvCol.aggregate.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });

      const r = await repo.getSummary(FAKE_ID);

      expect(r.totalPurchases).toBe(0);
      expect(r.totalAmount).toBe(0);
      expect(r.totalPaid).toBe(0);
      expect(r.totalDue).toBe(0);
    });

    test('returns null when supplier not found', async () => {
      col.findOne.mockResolvedValue(null);
      const r = await repo.getSummary(FAKE_ID);
      expect(r).toBeNull();
    });
  });

  // ── getOutstandingReport ─────────────────────────────────────────────────────

  describe('getOutstandingReport', () => {
    test('returns outstanding suppliers', async () => {
      const results = [{ _id: FAKE_ID, totalDue: 5000, totalPurchases: 3, supplierName: 'Acme' }];
      recvCol.aggregate.mockReturnValue({
        toArray: jest.fn().mockResolvedValue(results),
      });

      const r = await repo.getOutstandingReport({}, { page: 1, limit: 10 });

      expect(r).toEqual(results);
      expect(recvCol.aggregate).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            $match: expect.objectContaining({
              due_amount: { $gt: 0 },
              license: FAKE_LICENSE,
              is_deleted: { $ne: true },
            }),
          }),
          expect.objectContaining({ $sort: { totalDue: -1 } }),
          expect.objectContaining({ $limit: 10 }),
        ])
      );
    });

    test('filters by branch IDs when provided', async () => {
      recvCol.aggregate.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });

      await repo.getOutstandingReport({}, { branchIds: [FAKE_BRANCH] });

      expect(recvCol.aggregate).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            $match: expect.objectContaining({
              branch_id: { $in: expect.any(Array) },
            }),
          }),
        ])
      );
    });
  });

  // ── getDataChanges ─────────────────────────────────────────────────────────────

  describe('getDataChanges', () => {
    test('returns suppliers updated since fromDate', async () => {
      const docs = [{ _id: FAKE_ID }];
      col.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue(docs) });

      const fromDate = new Date('2024-01-01');
      const r = await repo.getDataChanges(fromDate);

      expect(r).toEqual(docs);
      expect(col.find).toHaveBeenCalledWith(
        expect.objectContaining({
          license: FAKE_LICENSE,
          updated_date: { $gte: fromDate },
        })
      );
    });
  });

  // ── bulkCreate ───────────────────────────────────────────────────────────────

  describe('bulkCreate', () => {
    test('inserts multiple suppliers and returns them', async () => {
      const inputs = [{ name: 'A' }, { name: 'B' }];
      const inserted = [
        { _id: FAKE_ID, name: 'A' },
        { _id: FAKE_ID_2, name: 'B' },
      ];
      col.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue(inserted) });

      const r = await repo.bulkCreate(inputs);

      expect(r).toEqual(inserted);
      expect(col.insertMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: 'A', license: FAKE_LICENSE, is_deleted: false }),
          expect.objectContaining({ name: 'B', license: FAKE_LICENSE, is_deleted: false }),
        ])
      );
    });

    test('omits blank emails from every imported supplier', async () => {
      col.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });
      await repo.bulkCreate([
        { name: 'A', email: '' },
        { name: 'B', email: '   ' },
      ]);
      expect(col.insertMany.mock.calls[0][0].every((doc) => !('email' in doc))).toBe(true);
    });
  });

  // ── exportData ─────────────────────────────────────────────────────────────────

  describe('exportData', () => {
    test('returns suppliers with projection', async () => {
      const docs = [{ name: 'A', email: 'a@test.com' }];
      col.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue(docs) });

      const r = await repo.exportData();

      expect(r).toEqual(docs);
      expect(col.find).toHaveBeenCalledWith(
        expect.objectContaining({ license: FAKE_LICENSE, is_deleted: { $ne: true } }),
        expect.objectContaining({
          projection: { name: 1, email: 1, phone: 1, address: 1 },
        })
      );
    });

    test('merges additional filters', async () => {
      col.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });

      await repo.exportData({ status: 'active' });

      expect(col.find.mock.calls[0][0]).toMatchObject({ status: 'active' });
    });
  });

  // ── getPaymentDetails ──────────────────────────────────────────────────────────

  describe('getPaymentDetails', () => {
    test('returns payment summary from receiving', async () => {
      recvCol.aggregate.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([
          {
            totalAmount: 10000,
            paidAmount: 7000,
            dueAmount: 3000,
          },
        ]),
      });

      const r = await repo.getPaymentDetails(FAKE_ID);

      expect(r).toEqual({ totalAmount: 10000, paidAmount: 7000, dueAmount: 3000 });
    });

    test('returns zeros when no receiving records', async () => {
      recvCol.aggregate.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });

      const r = await repo.getPaymentDetails(FAKE_ID);

      expect(r).toEqual({ totalAmount: 0, paidAmount: 0, dueAmount: 0 });
    });
  });

  // ── getTransactions ────────────────────────────────────────────────────────────

  describe('getTransactions', () => {
    test('returns paginated transactions', async () => {
      const docs = [{ _id: FAKE_ID, supplier_id: FAKE_ID }];
      recvCol.find.mockReturnValue(mkChain(docs));
      recvCol.countDocuments.mockResolvedValue(1);

      const r = await repo.getTransactions(FAKE_ID, { page: 1, limit: 10 });

      expect(r.data).toEqual(docs);
      expect(r.total).toBe(1);
      expect(recvCol.find).toHaveBeenCalledWith(
        expect.objectContaining({
          supplier_id: expect.anything(),
          license: FAKE_LICENSE,
          is_deleted: { $ne: true },
        })
      );
    });

    test('applies custom pagination', async () => {
      recvCol.find.mockReturnValue(mkChain([]));
      recvCol.countDocuments.mockResolvedValue(0);

      await repo.getTransactions(FAKE_ID, { page: 2, limit: 5 });

      const chain = recvCol.find.mock.results[0].value;
      expect(chain.skip).toHaveBeenCalledWith(5);
      expect(chain.limit).toHaveBeenCalledWith(5);
    });
  });

  // ── Multi-tenancy edge cases ──────────────────────────────────────────────────

  describe('Multi-tenancy edge cases', () => {
    test('findAll sets license to null when BaseModel.license is null', async () => {
      BaseModel.license = null;
      col.find.mockReturnValue(mkChain([]));
      col.countDocuments.mockResolvedValue(0);

      await repo.findAll();

      const query = col.find.mock.calls[0][0];
      expect(query.license).toBeNull();
    });

    test('create still adds license when BaseModel.license is null', async () => {
      BaseModel.license = null;
      col.findOne.mockResolvedValue(null);

      await repo.create({ name: 'X' });

      expect(col.insertOne).toHaveBeenCalledWith(expect.objectContaining({ license: null }));
    });
  });

  // ── Null and edge payload scenarios ───────────────────────────────────────────

  describe('Null and edge payload scenarios', () => {
    test('update with empty updateData', async () => {
      col.findOneAndUpdate.mockResolvedValue({ value: { _id: FAKE_ID } });
      const r = await repo.update(FAKE_ID, {});
      expect(r).toEqual({ _id: FAKE_ID });
    });

    test('bulkSoftDelete with single ID', async () => {
      col.find.mockReturnValue(mkChain([{ _id: FAKE_ID }]));
      col.deleteMany.mockResolvedValue({ deletedCount: 1 });

      const r = await repo.bulkSoftDelete([FAKE_ID]);
      expect(r.deletedCount).toBe(1);
    });

    test('search with special characters', async () => {
      col.find.mockReturnValue(mkChain([]));
      col.countDocuments.mockResolvedValue(0);

      await repo.search('test@#$%');
      expect(col.find).toHaveBeenCalled();
    });

    test('getOutstandingReport with empty branchIds', async () => {
      recvCol.aggregate.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });

      await repo.getOutstandingReport({}, { branchIds: [] });

      const pipeline = recvCol.aggregate.mock.calls[0][0];
      const matchStage = pipeline.find((s) => s.$match);
      expect(matchStage.$match).not.toHaveProperty('branch_id');
    });
  });

  /*
   * S7 (D5) - suppliers become account-level, same shape as customers.
   *
   * Additive only: access lists the owning branch, so nothing becomes visible
   * anywhere new. Purchase reporting across branches becomes POSSIBLE; it does
   * not just happen.
   */
  describe('SupplierRepository — branch_access (S7)', () => {
    test('a new supplier records the branch that owns it', async () => {
      await repo.create({ name: 'Acme', branch_id: 'b1', branch_name: 'Main' });
      const doc = col.insertOne.mock.calls[0][0];
      expect(doc.branch_access).toEqual([{ branch_id: 'b1', branch_name: 'Main' }]);
      expect(doc.branch_id).toBe('b1');
    });

    test('only the owning branch, so nothing is shared by default', async () => {
      await repo.create({ name: 'Acme', branch_id: 'b1', branch_name: 'Main' });
      expect(col.insertOne.mock.calls[0][0].branch_access).toHaveLength(1);
    });

    test('an explicit branch_access is respected, never overwritten', async () => {
      const shared = [
        { branch_id: 'b1', branch_name: 'Main' },
        { branch_id: 'b2', branch_name: 'Second' },
      ];
      await repo.create({ name: 'Acme', branch_id: 'b1', branch_access: shared });
      expect(col.insertOne.mock.calls[0][0].branch_access).toEqual(shared);
    });

    test('duplicate detection is NOT widened - that would merge by stealth', () => {
      /* findByNamePhoneBranch answers "does this supplier already exist HERE"
         during import. Widening it to branch_access would let an import in one
         branch match a supplier in another and skip creating one, which is
         merging - the thing the link-not-merge rule exists to prevent. */
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '../../../src/repositories/supplier.repository.js'),
        'utf8'
      );
      const at = src.indexOf('async findByNamePhoneBranch');
      expect(at).toBeGreaterThan(-1);
      const body = src.slice(at, src.indexOf('\n  }', at));
      expect(body).not.toContain('withBranchScope');
      expect(body).toContain('branch_id');
    });
  });
});
