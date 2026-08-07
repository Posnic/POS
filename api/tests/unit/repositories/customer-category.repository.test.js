'use strict';

/**
 * Unit tests for src/repositories/customer-category.repository.js
 *
 * File        : src/repositories/customer-category.repository.js (253 lines, CLASS export)
 * Export type : CLASS — module.exports = CustomerCategoryRepository (not a singleton)
 * Base class  : EXTENDS BaseModel — class CustomerCategoryRepository extends BaseModel
 *
 * Pattern     : MongoDB native driver wrapper with BaseModel inheritance.
 *               Constructor: super("customer_category")
 *               Uses inherited methods: getCollection(), changeLog(), deletedDocumentBackup()
 *               Uses static properties: BaseModel.license, BaseModel.loggedUser, BaseModel.loggedUserName
 *               Uses MongoDB native driver directly (not Mongoose): collection.find(), findOne(), insertOne(), findOneAndUpdate(), deleteOne(), deleteMany(), countDocuments()
 *               Uses mongodb.ObjectId for ID conversion
 *
 * Error strategy: ALL methods RETHROW — no soft error returns.
 *
 * Methods (8):
 *   findAll(filters, options)              — pagination, returns {data,total,page,limit,totalPages}
 *   findById(id)                           — collection.findOne with ObjectId
 *   findByName(name, branchId)             — case-insensitive regex with branch_id
 *   search(searchTerm, options)            — $or regex on name/description, pagination
 *   create(categoryData)                   — insertOne + findOne by insertedId
 *   update(id, updateData)                 — findOneAndUpdate with updated_by fields
 *   softDelete(id)                         — changeLog + deletedDocumentBackup + deleteOne
 *   softDeleteMany(ids)                    — changeLog per id + backup + deleteMany
 *   count(filters)                         — countDocuments
 *   exists(id)                             — countDocuments > 0
 *
 * Mocked dependencies:
 *   src/models/base.model — getCollection, changeLog, deletedDocumentBackup, static license/loggedUser/loggedUserName
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
    findOneAndUpdate: jest.fn().mockResolvedValue(null),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 0 }),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
    countDocuments: jest.fn().mockResolvedValue(0),
  };

  MockBaseModel = jest.fn(function (collectionName) {
    this.collectionName = collectionName;
    this.getCollection = jest.fn().mockResolvedValue(mockCollection);
    this.changeLog = jest.fn().mockResolvedValue({ status: true });
    this.deletedDocumentBackup = jest.fn().mockResolvedValue({ status: true });
  });

  MockBaseModel.license = null;
  MockBaseModel.loggedUser = null;
  MockBaseModel.loggedUserName = null;

  return MockBaseModel;
});

jest.mock('mongodb', () => {
  const mockObjectId = jest.fn((id) => ({ toString: () => id }));
  return { ObjectId: mockObjectId };
});

// ─── Requires ─────────────────────────────────────────────────────────────────

const CustomerCategory = require('../../../src/repositories/customer-category.repository');
const BaseModel = require('../../../src/models/base.model');
require('mongodb');

// ─── Shared fake data ─────────────────────────────────────────────────────────

const FAKE_ID = '64f9a1c2e3b4d5e6f7000001';
const FAKE_BRANCH_ID = '64f9a1c2e3b4d5e6f7000002';
const FAKE_LICENSE_ID = '64f9a1c2e3b4d5e6f7000003';

const FAKE_CATEGORY = {
  _id: FAKE_ID,
  name: 'Retail Customer',
  description: 'Retail customers',
  branch_id: FAKE_BRANCH_ID,
  license: FAKE_LICENSE_ID,
  is_deleted: false,
  created_date: new Date('2026-01-01T00:00:00.000Z'),
  updated_date: new Date('2026-01-01T00:00:00.000Z'),
};

const FAKE_CATEGORY_2 = {
  _id: '64f9a1c2e3b4d5e6f7000004',
  name: 'Wholesale Customer',
  description: 'Wholesale customers',
  branch_id: FAKE_BRANCH_ID,
  license: FAKE_LICENSE_ID,
  is_deleted: false,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CustomerCategoryRepository (class, extends BaseModel)', () => {
  let repository;
  let mockCollection;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset static properties
    BaseModel.license = null;
    BaseModel.loggedUser = null;
    BaseModel.loggedUserName = null;

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
      findOneAndUpdate: jest.fn().mockResolvedValue(FAKE_CATEGORY),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      countDocuments: jest.fn().mockResolvedValue(0),
    };

    // Instantiate the class (not a singleton)
    repository = new CustomerCategory();

    // Spy on inherited instance methods
    jest.spyOn(repository, 'getCollection').mockResolvedValue(mockCollection);
    jest.spyOn(repository, 'changeLog').mockResolvedValue({ status: true });
    jest.spyOn(repository, 'deletedDocumentBackup').mockResolvedValue({ status: true });
  });

  // ── constructor ────────────────────────────────────────────────────────────

  describe('constructor', () => {
    test('extends BaseModel with "customer_category" collection', () => {
      expect(repository.collectionName).toBe('customer_category');
    });
  });

  // ── findAll ────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    test('calls getCollection with collection name', async () => {
      await repository.findAll({});
      expect(repository.getCollection).toHaveBeenCalledWith('customer_category');
    });

    test('calls collection.find with filters including license and is_deleted', async () => {
      await repository.findAll({ status: 'active' });
      expect(mockCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'active',
          license: BaseModel.license,
          is_deleted: { $ne: true },
        })
      );
    });

    test('applies sort, skip, and limit to query', async () => {
      await repository.findAll({}, { page: 2, limit: 5, sort: { name: 1 } });
      const query = mockCollection.find.mock.results[0].value;
      expect(query.sort).toHaveBeenCalledWith({ name: 1 });
      expect(query.skip).toHaveBeenCalledWith(5); // (2-1)*5
      expect(query.limit).toHaveBeenCalledWith(5);
    });

    test('uses default page=1, limit=10, sort when not provided', async () => {
      await repository.findAll({});
      const query = mockCollection.find.mock.results[0].value;
      expect(query.sort).toHaveBeenCalledWith({ created_date: -1 });
      expect(query.skip).toHaveBeenCalledWith(0);
      expect(query.limit).toHaveBeenCalledWith(10);
    });

    test('calls countDocuments on collection', async () => {
      await repository.findAll({});
      expect(mockCollection.countDocuments).toHaveBeenCalled();
    });

    test('returns paginated result with data, total, page, limit, totalPages', async () => {
      mockCollection.find.mockReturnValueOnce({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([FAKE_CATEGORY]),
      });
      mockCollection.countDocuments.mockResolvedValueOnce(1);
      const r = await repository.findAll({});
      expect(r).toEqual({
        data: [FAKE_CATEGORY],
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

  // ── findById ────────────────────────────────────────────────────────────────

  describe('findById', () => {
    test('calls getCollection with collection name', async () => {
      await repository.findById(FAKE_ID);
      expect(repository.getCollection).toHaveBeenCalledWith('customer_category');
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

    test('returns the category document', async () => {
      mockCollection.findOne.mockResolvedValueOnce(FAKE_CATEGORY);
      const r = await repository.findById(FAKE_ID);
      expect(r).toEqual(FAKE_CATEGORY);
    });

    test('returns null when category not found', async () => {
      mockCollection.findOne.mockResolvedValueOnce(null);
      const r = await repository.findById('nonexistent');
      expect(r).toBeNull();
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.findById(FAKE_ID)).rejects.toThrow('GetCollection failed');
    });
  });

  // ── findByName ─────────────────────────────────────────────────────────────

  describe('findByName', () => {
    test('calls getCollection with collection name', async () => {
      await repository.findByName('Retail', FAKE_BRANCH_ID);
      expect(repository.getCollection).toHaveBeenCalledWith('customer_category');
    });

    test('calls collection.findOne with case-insensitive regex and branch_id', async () => {
      await repository.findByName('Retail', FAKE_BRANCH_ID);
      expect(mockCollection.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          name: expect.objectContaining({ $regex: expect.any(RegExp) }),
          branch_id: expect.any(Object),
          license: BaseModel.license,
          is_deleted: { $ne: true },
        })
      );
    });

    test('returns the category document', async () => {
      mockCollection.findOne.mockResolvedValueOnce(FAKE_CATEGORY);
      const r = await repository.findByName('Retail', FAKE_BRANCH_ID);
      expect(r).toEqual(FAKE_CATEGORY);
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.findByName('Retail', FAKE_BRANCH_ID)).rejects.toThrow(
        'GetCollection failed'
      );
    });
  });

  // ── search ────────────────────────────────────────────────────────────────

  describe('search', () => {
    test('calls getCollection with collection name', async () => {
      await repository.search('retail');
      expect(repository.getCollection).toHaveBeenCalledWith('customer_category');
    });

    test('calls collection.find with $or regex on name and description', async () => {
      await repository.search('retail');
      expect(mockCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          $or: expect.arrayContaining([
            expect.objectContaining({ name: expect.any(RegExp) }),
            expect.objectContaining({ description: expect.any(RegExp) }),
          ]),
          license: BaseModel.license,
          is_deleted: { $ne: true },
        })
      );
    });

    test('applies branch_id filter when branchId provided', async () => {
      await repository.search('retail', { branchId: FAKE_BRANCH_ID });
      expect(mockCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          branch_id: expect.any(Object),
        })
      );
    });

    test('applies pagination with default page=1, limit=10', async () => {
      await repository.search('retail');
      const query = mockCollection.find.mock.results[0].value;
      expect(query.skip).toHaveBeenCalledWith(0);
      expect(query.limit).toHaveBeenCalledWith(10);
    });

    test('applies custom pagination when provided', async () => {
      await repository.search('retail', { page: 2, limit: 5 });
      const query = mockCollection.find.mock.results[0].value;
      expect(query.skip).toHaveBeenCalledWith(5);
      expect(query.limit).toHaveBeenCalledWith(5);
    });

    test('returns paginated result with data, total, page, limit, totalPages', async () => {
      mockCollection.find.mockReturnValueOnce({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([FAKE_CATEGORY]),
      });
      mockCollection.countDocuments.mockResolvedValueOnce(1);
      const r = await repository.search('retail');
      expect(r).toEqual({
        data: [FAKE_CATEGORY],
        total: 1,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.search('retail')).rejects.toThrow('GetCollection failed');
    });
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    const NEW_DATA = { name: 'New Category', description: 'Test' };

    test('calls getCollection with collection name', async () => {
      await repository.create(NEW_DATA);
      expect(repository.getCollection).toHaveBeenCalledWith('customer_category');
    });

    test('calls insertOne with data plus timestamps and is_deleted=false', async () => {
      await repository.create(NEW_DATA);
      expect(mockCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          ...NEW_DATA,
          created_date: expect.any(Date),
          updated_date: expect.any(Date),
          is_deleted: false,
        })
      );
    });

    test('calls findOne to retrieve the inserted document by insertedId', async () => {
      await repository.create(NEW_DATA);
      expect(mockCollection.findOne).toHaveBeenCalledWith({ _id: FAKE_ID });
    });

    test('returns the inserted document', async () => {
      mockCollection.findOne.mockResolvedValueOnce(FAKE_CATEGORY);
      const r = await repository.create(NEW_DATA);
      expect(r).toEqual(FAKE_CATEGORY);
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.create(NEW_DATA)).rejects.toThrow('GetCollection failed');
    });
  });

  // ── update ────────────────────────────────────────────────────────────────

  describe('update', () => {
    const UPDATE_DATA = { name: 'Updated Category' };

    test('calls getCollection with collection name', async () => {
      await repository.update(FAKE_ID, UPDATE_DATA);
      expect(repository.getCollection).toHaveBeenCalledWith('customer_category');
    });

    test('calls findOneAndUpdate with ObjectId id and update data', async () => {
      await repository.update(FAKE_ID, UPDATE_DATA);
      expect(mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: expect.any(Object),
          license: BaseModel.license,
          is_deleted: { $ne: true },
        }),
        expect.objectContaining({
          $set: expect.objectContaining({
            ...UPDATE_DATA,
            updated_date: expect.any(Date),
            updated_by: BaseModel.loggedUserName,
            updated_by_id: BaseModel.loggedUser,
          }),
        }),
        { returnDocument: 'after' }
      );
    });

    test('returns the updated document', async () => {
      const r = await repository.update(FAKE_ID, UPDATE_DATA);
      expect(r).toEqual(FAKE_CATEGORY);
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.update(FAKE_ID, UPDATE_DATA)).rejects.toThrow('GetCollection failed');
    });
  });

  // ── softDelete ────────────────────────────────────────────────────────────

  describe('softDelete', () => {
    test('calls getCollection with collection name', async () => {
      await repository.softDelete(FAKE_ID);
      expect(repository.getCollection).toHaveBeenCalledWith('customer_category');
    });

    test('calls changeLog before deletion', async () => {
      await repository.softDelete(FAKE_ID);
      expect(repository.changeLog).toHaveBeenCalledWith(
        'customer_category',
        BaseModel.loggedUser,
        expect.any(Object),
        'delete'
      );
    });

    test('calls deletedDocumentBackup before deletion when category exists', async () => {
      mockCollection.findOne.mockResolvedValueOnce(FAKE_CATEGORY);
      await repository.softDelete(FAKE_ID);
      expect(repository.deletedDocumentBackup).toHaveBeenCalledWith(
        'customer_category',
        FAKE_CATEGORY
      );
    });

    test('does NOT call deletedDocumentBackup when category does not exist', async () => {
      mockCollection.findOne.mockResolvedValueOnce(null);
      await repository.softDelete(FAKE_ID);
      expect(repository.deletedDocumentBackup).not.toHaveBeenCalled();
    });

    test('calls deleteOne with ObjectId id and license', async () => {
      await repository.softDelete(FAKE_ID);
      expect(mockCollection.deleteOne).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: expect.any(Object),
          license: BaseModel.license,
        })
      );
    });

    test('returns deletedCount', async () => {
      const r = await repository.softDelete(FAKE_ID);
      expect(r).toBe(1);
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.softDelete(FAKE_ID)).rejects.toThrow('GetCollection failed');
    });
  });

  // ── softDeleteMany ────────────────────────────────────────────────────────

  describe('softDeleteMany', () => {
    test('calls getCollection with collection name', async () => {
      await repository.softDeleteMany([FAKE_ID]);
      expect(repository.getCollection).toHaveBeenCalledWith('customer_category');
    });

    test('calls changeLog for each id', async () => {
      await repository.softDeleteMany([FAKE_ID, FAKE_CATEGORY_2._id]);
      expect(repository.changeLog).toHaveBeenCalledTimes(2);
    });

    test('calls deletedDocumentBackup for each category found', async () => {
      mockCollection.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([FAKE_CATEGORY, FAKE_CATEGORY_2]),
      });
      await repository.softDeleteMany([FAKE_ID, FAKE_CATEGORY_2._id]);
      expect(repository.deletedDocumentBackup).toHaveBeenCalledTimes(2);
    });

    test('calls deleteMany with $in filter and license', async () => {
      await repository.softDeleteMany([FAKE_ID]);
      expect(mockCollection.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          $and: expect.arrayContaining([
            { _id: { $in: expect.any(Array) } },
            { license: BaseModel.license },
          ]),
        })
      );
    });

    test('returns deletedCount', async () => {
      const r = await repository.softDeleteMany([FAKE_ID]);
      expect(r).toBe(1);
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.softDeleteMany([FAKE_ID])).rejects.toThrow('GetCollection failed');
    });
  });

  // ── count ────────────────────────────────────────────────────────────────

  describe('count', () => {
    test('calls getCollection with collection name', async () => {
      await repository.count({});
      expect(repository.getCollection).toHaveBeenCalledWith('customer_category');
    });

    test('calls countDocuments with filters including license and is_deleted', async () => {
      await repository.count({ status: 'active' });
      expect(mockCollection.countDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'active',
          license: BaseModel.license,
          is_deleted: { $ne: true },
        })
      );
    });

    test('returns the count', async () => {
      mockCollection.countDocuments.mockResolvedValueOnce(5);
      const r = await repository.count({});
      expect(r).toBe(5);
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.count({})).rejects.toThrow('GetCollection failed');
    });
  });

  // ── exists ────────────────────────────────────────────────────────────────

  describe('exists', () => {
    test('calls getCollection with collection name', async () => {
      await repository.exists(FAKE_ID);
      expect(repository.getCollection).toHaveBeenCalledWith('customer_category');
    });

    test('calls countDocuments with ObjectId id, license, and is_deleted', async () => {
      await repository.exists(FAKE_ID);
      expect(mockCollection.countDocuments).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: expect.any(Object),
          license: BaseModel.license,
          is_deleted: { $ne: true },
        })
      );
    });

    test('returns true when count > 0', async () => {
      mockCollection.countDocuments.mockResolvedValueOnce(1);
      const r = await repository.exists(FAKE_ID);
      expect(r).toBe(true);
    });

    test('returns false when count is 0', async () => {
      mockCollection.countDocuments.mockResolvedValueOnce(0);
      const r = await repository.exists(FAKE_ID);
      expect(r).toBe(false);
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.exists(FAKE_ID)).rejects.toThrow('GetCollection failed');
    });
  });
});
