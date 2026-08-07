'use strict';

/**
 * Unit tests for src/repositories/expense.repository.js
 *
 * File        : src/repositories/expense.repository.js (293 lines, CLASS export)
 * Export type : CLASS — module.exports = ExpenseRepository (not a singleton)
 * Base class  : EXTENDS BaseModel — class ExpenseRepository extends BaseModel
 *
 * Pattern     : MongoDB native driver wrapper with BaseModel inheritance.
 *               Constructor: super("expenses")
 *               Uses inherited method: getCollection()
 *               Uses static properties: BaseModel.license, BaseModel.loggedUser
 *               Uses static method: BaseModel.deletedDocumentBackup(document, params)
 *               Uses MongoDB native driver directly: collection.find, findOne, insertOne,
 *               findOneAndUpdate, deleteOne, deleteMany, countDocuments, aggregate
 *               Uses mongodb.ObjectId for ID conversion
 *
 * Error strategy: ALL methods RETHROW errors — no soft error returns.
 *
 * Methods (9):
 *   findAll(filters, options)              — pagination with sort/skip/limit
 *   findLatest()                           — findOne with sort, returns _id.toString() or null
 *   findById(id)                           — findOne with ObjectId
 *   create(expenseData)                    — insertOne with date parsing, then findById
 *   update(id, updateData)                 — findOneAndUpdate with $set, returns result.value
 *   softDelete(id)                         — findOne, backup via BaseModel.deletedDocumentBackup, deleteOne
 *   softDeleteMany(ids)                    — find $in, backup loop, deleteMany
 *   getSummary(filters)                    — aggregate with $match + $group (totalAmount, count, avgAmount)
 *   search(searchTerm, options)            — $or regex on category/recipientname/description/type, pagination
 *
 * Mocked dependencies:
 *   src/models/base.model — getCollection (instance), deletedDocumentBackup (static), license
 *   mongodb — ObjectId for ID conversion
 *
 * No production bugs found.
 */

// ─── Mocks (hoisted before any require) ──────────────────────────────────────

let MockBaseModel;

jest.mock('../../../src/models/base.model', () => {
  const mockCollection = {
    find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    findOne: jest.fn().mockResolvedValue(null),
    insertOne: jest.fn().mockResolvedValue({ insertedId: 'inserted_123' }),
    findOneAndUpdate: jest.fn().mockResolvedValue({ value: null }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    countDocuments: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
  };

  MockBaseModel = jest.fn(function (collectionName) {
    this.collectionName = collectionName;
    this.getCollection = jest.fn().mockResolvedValue(mockCollection);
  });

  MockBaseModel.license = null;
  MockBaseModel.loggedUser = null;
  MockBaseModel.deletedDocumentBackup = jest.fn().mockResolvedValue({ status: true });

  return MockBaseModel;
});

jest.mock('mongodb', () => {
  const mockObjectId = jest.fn((id) => ({ toString: () => id }));
  mockObjectId.isValid = jest.fn(() => true);
  return { ObjectId: mockObjectId };
});

// ─── Requires ─────────────────────────────────────────────────────────────────

const Expense = require('../../../src/repositories/expense.repository');
const BaseModel = require('../../../src/models/base.model');
require('mongodb');

// ─── Shared fake data ─────────────────────────────────────────────────────────

const FAKE_ID = '64f9a1c2e3b4d5e6f7000001';
const FAKE_BRANCH_ID = '64f9a1c2e3b4d5e6f7000002';
const FAKE_LICENSE_ID = '64f9a1c2e3b4d5e6f7000003';

const FAKE_EXPENSE = {
  _id: FAKE_ID,
  amount: 150.5,
  type: 'Office',
  date: new Date('2026-01-15'),
  category: 'Rent',
  recipientname: 'Landlord Corp',
  approvedby: 'Manager',
  description: 'Monthly rent payment',
  branch_id: FAKE_BRANCH_ID,
  branch_name: 'Main Branch',
  license: FAKE_LICENSE_ID,
  created_date: new Date('2026-01-01T00:00:00.000Z'),
  updated_date: new Date('2026-01-01T00:00:00.000Z'),
  created_by: 'admin',
  created_by_id: 'admin_123',
  updated_by: 'admin',
  updated_by_id: 'admin_123',
  is_deleted: false,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ExpenseRepository (class, extends BaseModel)', () => {
  let repository;
  let mockCollection;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset static properties
    BaseModel.license = null;
    BaseModel.loggedUser = null;

    // Create fresh mock collection
    const mkQuery = () => ({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([]),
    });

    mockCollection = {
      find: jest.fn().mockReturnValue(mkQuery()),
      findOne: jest.fn().mockResolvedValue(null),
      insertOne: jest.fn().mockResolvedValue({ insertedId: FAKE_ID }),
      findOneAndUpdate: jest.fn().mockResolvedValue({ value: FAKE_EXPENSE }),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      countDocuments: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    };

    // Instantiate the class
    repository = new Expense();

    // Spy on getCollection
    repository.getCollection = jest.fn().mockResolvedValue(mockCollection);
  });

  // ── constructor ────────────────────────────────────────────────────────────

  describe('constructor', () => {
    test('extends BaseModel with "expenses" collection', () => {
      expect(repository.collectionName).toBe('expenses');
    });
  });

  // ── findAll ────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    test('calls getCollection with collection name', async () => {
      await repository.findAll({});
      expect(repository.getCollection).toHaveBeenCalledWith('expenses');
    });

    test('calls collection.find with filters including license and is_deleted', async () => {
      await repository.findAll({ category: 'Rent' });
      expect(mockCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'Rent',
          license: BaseModel.license,
          is_deleted: { $ne: true },
        })
      );
    });

    test('applies sort, skip, and limit to query', async () => {
      await repository.findAll({}, { page: 2, limit: 5, sort: { amount: -1 } });
      const query = mockCollection.find.mock.results[0].value;
      expect(query.sort).toHaveBeenCalledWith({ amount: -1 });
      expect(query.skip).toHaveBeenCalledWith(5);
      expect(query.limit).toHaveBeenCalledWith(5);
    });

    test('returns paginated result with data, total, page, limit, totalPages', async () => {
      mockCollection.find.mockReturnValueOnce({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([FAKE_EXPENSE]),
      });
      mockCollection.countDocuments.mockResolvedValueOnce(1);
      const r = await repository.findAll({});
      expect(r).toEqual({
        data: [FAKE_EXPENSE],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.findAll({})).rejects.toThrow('GetCollection failed');
    });
  });

  // ── findLatest ─────────────────────────────────────────────────────────────

  describe('findLatest', () => {
    test('calls findOne with license and is_deleted filters', async () => {
      await repository.findLatest();
      expect(mockCollection.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          license: BaseModel.license,
          is_deleted: { $ne: true },
        }),
        expect.objectContaining({
          sort: { created_date: -1 },
          projection: { _id: 1 },
        })
      );
    });

    test('returns _id.toString() when expense found', async () => {
      mockCollection.findOne.mockResolvedValueOnce({ _id: { toString: () => FAKE_ID } });
      const r = await repository.findLatest();
      expect(r).toBe(FAKE_ID);
    });

    test('returns null when no expense found', async () => {
      mockCollection.findOne.mockResolvedValueOnce(null);
      const r = await repository.findLatest();
      expect(r).toBeNull();
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.findLatest()).rejects.toThrow('GetCollection failed');
    });
  });

  // ── findById ───────────────────────────────────────────────────────────────

  describe('findById', () => {
    test('calls getCollection with collection name', async () => {
      await repository.findById(FAKE_ID);
      expect(repository.getCollection).toHaveBeenCalledWith('expenses');
    });

    test('calls collection.findOne with ObjectId-converted id', async () => {
      await repository.findById(FAKE_ID);
      expect(mockCollection.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: expect.any(Object),
          license: BaseModel.license,
          is_deleted: { $ne: true },
        })
      );
    });

    test('returns the expense document', async () => {
      mockCollection.findOne.mockResolvedValueOnce(FAKE_EXPENSE);
      const r = await repository.findById(FAKE_ID);
      expect(r).toEqual(FAKE_EXPENSE);
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.findById(FAKE_ID)).rejects.toThrow('GetCollection failed');
    });
  });

  // ── create ─────────────────────────────────────────────────────────────────

  describe('create', () => {
    const NEW_DATA = {
      amount: '200.50',
      type: 'Utilities',
      date: '2026-02-01',
      category: 'Electricity',
      recipientname: 'Power Co',
      approvedby: 'Admin',
      description: 'Electric bill',
      branch_id: FAKE_BRANCH_ID,
      branch_name: 'Main Branch',
      created_by: 'admin',
      created_by_id: 'admin_123',
    };

    test('calls insertOne with parsed amount and default fields', async () => {
      await repository.create(NEW_DATA);
      expect(mockCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 200.5,
          type: 'Utilities',
          category: 'Electricity',
          recipientname: 'Power Co',
          approvedby: 'Admin',
          description: 'Electric bill',
          branch_id: FAKE_BRANCH_ID,
          branch_name: 'Main Branch',
          license: BaseModel.license,
          is_deleted: false,
          created_date: expect.any(Date),
          updated_date: expect.any(Date),
          created_by: 'admin',
          created_by_id: 'admin_123',
          updated_by: 'admin',
          updated_by_id: 'admin_123',
        })
      );
    });

    test('parses date when valid date string provided', async () => {
      await repository.create(NEW_DATA);
      const insertedDoc = mockCollection.insertOne.mock.calls[0][0];
      expect(insertedDoc.date).toEqual(new Date('2026-02-01'));
    });

    test('uses current date when no date provided', async () => {
      const dataNoDate = { ...NEW_DATA };
      delete dataNoDate.date;
      await repository.create(dataNoDate);
      const insertedDoc = mockCollection.insertOne.mock.calls[0][0];
      expect(insertedDoc.date).toBeInstanceOf(Date);
    });

    test('uses current date when invalid date string provided', async () => {
      await repository.create({ ...NEW_DATA, date: 'invalid-date' });
      const insertedDoc = mockCollection.insertOne.mock.calls[0][0];
      expect(insertedDoc.date).toBeInstanceOf(Date);
    });

    test('calls findById to retrieve the inserted document', async () => {
      mockCollection.findOne.mockResolvedValueOnce(FAKE_EXPENSE);
      await repository.create(NEW_DATA);
      expect(mockCollection.findOne).toHaveBeenCalled();
    });

    test('returns the inserted document', async () => {
      mockCollection.findOne.mockResolvedValueOnce(FAKE_EXPENSE);
      const r = await repository.create(NEW_DATA);
      expect(r).toEqual(FAKE_EXPENSE);
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.create(NEW_DATA)).rejects.toThrow('GetCollection failed');
    });
  });

  // ── update ─────────────────────────────────────────────────────────────────

  describe('update', () => {
    const UPDATE_DATA = {
      amount: '300.75',
      type: 'Maintenance',
      date: '2026-03-01',
      category: 'Repair',
      recipientname: 'Repair Guy',
      approvedby: 'Supervisor',
      description: 'Fix AC',
      updated_by: 'editor',
      updated_by_id: 'editor_123',
    };

    test('calls findOneAndUpdate with ObjectId id and $set fields', async () => {
      await repository.update(FAKE_ID, UPDATE_DATA);
      expect(mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: expect.any(Object),
          license: BaseModel.license,
          is_deleted: { $ne: true },
        }),
        expect.objectContaining({
          $set: expect.objectContaining({
            amount: 300.75,
            type: 'Maintenance',
            category: 'Repair',
            recipientname: 'Repair Guy',
            approvedby: 'Supervisor',
            description: 'Fix AC',
            updated_by: 'editor',
            updated_by_id: 'editor_123',
            updated_date: expect.any(Date),
          }),
        }),
        { returnDocument: 'after' }
      );
    });

    test('parses date when valid date string provided', async () => {
      await repository.update(FAKE_ID, UPDATE_DATA);
      const updateSet = mockCollection.findOneAndUpdate.mock.calls[0][1].$set;
      expect(updateSet.date).toEqual(new Date('2026-03-01'));
    });

    test('does NOT include date in $set when invalid date provided', async () => {
      await repository.update(FAKE_ID, { ...UPDATE_DATA, date: 'invalid' });
      const updateSet = mockCollection.findOneAndUpdate.mock.calls[0][1].$set;
      expect(updateSet.date).toBeUndefined();
    });

    test('only includes amount when amount is provided', async () => {
      await repository.update(FAKE_ID, { updated_by: 'admin' });
      const updateSet = mockCollection.findOneAndUpdate.mock.calls[0][1].$set;
      expect(updateSet.amount).toBeUndefined();
    });

    test('does NOT include created_date, created_by, or created_by_id in $set', async () => {
      await repository.update(FAKE_ID, UPDATE_DATA);
      const updateSet = mockCollection.findOneAndUpdate.mock.calls[0][1].$set;
      expect(updateSet.created_date).toBeUndefined();
      expect(updateSet.created_by).toBeUndefined();
      expect(updateSet.created_by_id).toBeUndefined();
    });

    test('returns result.value from findOneAndUpdate', async () => {
      const r = await repository.update(FAKE_ID, UPDATE_DATA);
      expect(r).toEqual(FAKE_EXPENSE);
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.update(FAKE_ID, UPDATE_DATA)).rejects.toThrow('GetCollection failed');
    });
  });

  // ── softDelete ─────────────────────────────────────────────────────────────

  describe('softDelete', () => {
    test('calls findOne to get expense before deletion', async () => {
      await repository.softDelete(FAKE_ID);
      expect(mockCollection.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: expect.any(Object),
          license: BaseModel.license,
        })
      );
    });

    test('calls BaseModel.deletedDocumentBackup when expense exists', async () => {
      mockCollection.findOne.mockResolvedValueOnce(FAKE_EXPENSE);
      await repository.softDelete(FAKE_ID);
      expect(BaseModel.deletedDocumentBackup).toHaveBeenCalledWith('expenses', FAKE_EXPENSE);
    });

    test('does NOT call deletedDocumentBackup when expense does not exist', async () => {
      mockCollection.findOne.mockResolvedValueOnce(null);
      await repository.softDelete(FAKE_ID);
      expect(BaseModel.deletedDocumentBackup).not.toHaveBeenCalled();
    });

    test('calls deleteOne on main collection', async () => {
      mockCollection.findOne.mockResolvedValueOnce(FAKE_EXPENSE);
      await repository.softDelete(FAKE_ID);
      expect(mockCollection.deleteOne).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: expect.any(Object),
          license: BaseModel.license,
        })
      );
    });

    test('returns deletedCount', async () => {
      mockCollection.findOne.mockResolvedValueOnce(FAKE_EXPENSE);
      const r = await repository.softDelete(FAKE_ID);
      expect(r).toBe(1);
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.softDelete(FAKE_ID)).rejects.toThrow('GetCollection failed');
    });
  });

  // ── softDeleteMany ─────────────────────────────────────────────────────────

  describe('softDeleteMany', () => {
    test('finds all expenses to be deleted', async () => {
      mockCollection.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([FAKE_EXPENSE]) });
      await repository.softDeleteMany([FAKE_ID]);
      expect(mockCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: { $in: expect.any(Array) },
          license: BaseModel.license,
        })
      );
    });

    test('calls BaseModel.deletedDocumentBackup for each found expense', async () => {
      mockCollection.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([FAKE_EXPENSE]) });
      await repository.softDeleteMany([FAKE_ID]);
      expect(BaseModel.deletedDocumentBackup).toHaveBeenCalledWith('expenses', FAKE_EXPENSE);
    });

    test('does NOT call deletedDocumentBackup when no expenses found', async () => {
      mockCollection.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });
      BaseModel.deletedDocumentBackup.mockClear();
      await repository.softDeleteMany([FAKE_ID]);
      expect(BaseModel.deletedDocumentBackup).not.toHaveBeenCalled();
    });

    test('calls deleteMany on main collection', async () => {
      mockCollection.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([FAKE_EXPENSE]) });
      await repository.softDeleteMany([FAKE_ID]);
      expect(mockCollection.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: { $in: expect.any(Array) },
          license: BaseModel.license,
        })
      );
    });

    test('returns deletedCount', async () => {
      mockCollection.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([FAKE_EXPENSE]) });
      const r = await repository.softDeleteMany([FAKE_ID]);
      expect(r).toBe(1);
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.softDeleteMany([FAKE_ID])).rejects.toThrow('GetCollection failed');
    });
  });

  // ── getSummary ─────────────────────────────────────────────────────────────

  describe('getSummary', () => {
    test('calls collection.aggregate with $match and $group', async () => {
      await repository.getSummary({ category: 'Rent' });
      expect(mockCollection.aggregate).toHaveBeenCalled();
      const pipeline = mockCollection.aggregate.mock.calls[0][0];
      expect(pipeline).toContainEqual(
        expect.objectContaining({
          $match: expect.objectContaining({
            category: 'Rent',
            license: BaseModel.license,
            is_deleted: { $ne: true },
          }),
        })
      );
      expect(pipeline).toContainEqual(
        expect.objectContaining({
          $group: expect.objectContaining({
            _id: null,
            totalAmount: { $sum: '$amount' },
            count: { $sum: 1 },
            avgAmount: { $avg: '$amount' },
          }),
        })
      );
    });

    test('returns summary from aggregation result', async () => {
      mockCollection.aggregate.mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([{ totalAmount: 1000, count: 5, avgAmount: 200 }]),
      });
      const r = await repository.getSummary({});
      expect(r).toEqual({ totalAmount: 1000, count: 5, avgAmount: 200 });
    });

    test('returns zero values when aggregation result is empty', async () => {
      mockCollection.aggregate.mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue([]) });
      const r = await repository.getSummary({});
      expect(r).toEqual({ totalAmount: 0, count: 0, avgAmount: 0 });
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.getSummary({})).rejects.toThrow('GetCollection failed');
    });
  });

  // ── search ─────────────────────────────────────────────────────────────────

  describe('search', () => {
    test('calls collection.find with $or regex on category, recipientname, description, type', async () => {
      await repository.search('rent');
      expect(mockCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          $or: expect.arrayContaining([
            expect.objectContaining({ category: expect.any(RegExp) }),
            expect.objectContaining({ recipientname: expect.any(RegExp) }),
            expect.objectContaining({ description: expect.any(RegExp) }),
            expect.objectContaining({ type: expect.any(RegExp) }),
          ]),
          license: BaseModel.license,
          is_deleted: { $ne: true },
        })
      );
    });

    test('applies branch_id filter when branchId provided', async () => {
      await repository.search('rent', { branchId: FAKE_BRANCH_ID });
      expect(mockCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          branch_id: expect.any(Object),
        })
      );
    });

    test('returns { data, total } object', async () => {
      mockCollection.find.mockReturnValueOnce({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([FAKE_EXPENSE]),
      });
      mockCollection.countDocuments.mockResolvedValueOnce(1);
      const r = await repository.search('rent');
      expect(r).toEqual({ data: [FAKE_EXPENSE], total: 1 });
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.search('rent')).rejects.toThrow('GetCollection failed');
    });
  });
});
