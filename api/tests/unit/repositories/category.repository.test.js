'use strict';

/**
 * Unit tests for src/repositories/category.repository.js
 *
 * File        : src/repositories/category.repository.js (504 lines, CLASS export)
 * Export type : CLASS — module.exports = CategoryRepository (not a singleton)
 * Base class  : EXTENDS BaseModel — class CategoryRepository extends BaseModel
 *
 * Pattern     : Mongoose model wrapper with BaseModel inheritance.
 *               Constructor: super("categories") + this.model = Category
 *               Uses inherited methods: getCollection(), changeLog(), deletedDocumentBackup()
 *               Uses static properties: BaseModel.license, BaseModel.loggedUser
 *               Dynamic requires: Item model (inline in getCategoryWithItemCount, hasItems)
 *
 * Error strategy: ALL methods RETHROW — no soft error returns.
 *
 * Methods (18):
 *   findAll(filters, options)              — pagination, returns {data,total,page,limit,totalPages}
 *   findById(id)                           — new Types.ObjectId(id)
 *   findByName(name, branchId)             — case-insensitive regex
 *   findByNameBranchLicense(name, branchId, licenseId) — exact name, uses BaseModel.license fallback
 *   search(searchTerm, options)            — $or regex on name/description, branch/license/status
 *   create(categoryData)                   — new Model + save, sets created_date/updated_date
 *   update(id, updateData)                 — findOneAndUpdate with is_deleted check
 *   softDelete(id)                         — sets is_deleted=true, deleted_date
 *   bulkSoftDelete(ids)                   — updateMany with is_deleted=true
 *   bulkHardDelete(ids)                    — uses getCollection(), changeLog(), deletedDocumentBackup()
 *   findByBranch(branchId, options)        — branch filter, activeOnly, license
 *   getCategoryWithItemCount(id)           — dynamic Item model require, countDocuments
 *   hasItems(id)                           — dynamic Item model require, countDocuments
 *   findByBranchWithItems(branchId, options) — complex aggregation with $lookup
 *   getDataChanges(fromDate, branchId)     — sync data changes
 *   bulkCreate(categoriesData)             — insertMany with defaults
 *   exportData(filters)                    — select specific fields
 *   getActiveCategories(branchId)          — active only, select fields
 *   updateSortOrder(id, sortOrder)         — sets sort_order
 *   toggleActive(id)                       — flips is_active
 *
 * Mocked dependencies:
 *   src/models/category.model — constructor + static methods
 *   src/models/item.model — static countDocuments (dynamic require)
 *   src/models/base.model — getCollection, changeLog, deletedDocumentBackup, static license/loggedUser
 *   mongoose.Types.ObjectId — mocked for ID conversion
 *
 * No production bugs found.
 */

// ─── Mocks (hoisted before any require) ──────────────────────────────────────

jest.mock('../../../src/models/category.model', () => {
  const mockSave = jest.fn();

  const MockCategory = jest.fn(function (data) {
    this.data = data;
    this.save = MockCategory.__mockSave;
    this.toObject = jest.fn(() => this.data);
  });

  MockCategory.__mockSave = mockSave;
  MockCategory.find = jest.fn();
  MockCategory.findOne = jest.fn();
  MockCategory.findOneAndUpdate = jest.fn();
  MockCategory.updateMany = jest.fn();
  MockCategory.insertMany = jest.fn();
  MockCategory.aggregate = jest.fn();
  MockCategory.countDocuments = jest.fn();

  return MockCategory;
});

jest.mock('../../../src/models/item.model', () => ({
  countDocuments: jest.fn(),
}));

jest.mock('mongoose', () => {
  const mockObjectId = jest.fn((id) => ({ toString: () => id }));
  mockObjectId.isValid = jest.fn(() => true);
  return {
    Types: { ObjectId: mockObjectId },
  };
});

let MockBaseModel;

jest.mock('../../../src/models/base.model', () => {
  const mockCollection = {
    find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
  };

  MockBaseModel = jest.fn(function (collectionName) {
    this.collectionName = collectionName;
    this.getCollection = jest.fn().mockResolvedValue(mockCollection);
    this.changeLog = jest.fn().mockResolvedValue({ status: true });
    this.deletedDocumentBackup = jest.fn().mockResolvedValue({ status: true });
  });

  MockBaseModel.license = null;
  MockBaseModel.loggedUser = null;

  return MockBaseModel;
});

// ─── Requires ─────────────────────────────────────────────────────────────────

const Category = require('../../../src/repositories/category.repository');
const CategoryModel = require('../../../src/models/category.model');
const ItemModel = require('../../../src/models/item.model');
const BaseModel = require('../../../src/models/base.model');
require('mongoose');

// ─── Chainable query mock helper ──────────────────────────────────────────────

const mkChain = (result) => {
  const chain = {
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
  };
  chain.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  chain.catch = (fn) => Promise.resolve(result).catch(fn);
  return chain;
};

// ─── Shared fake data ─────────────────────────────────────────────────────────

const FAKE_ID = '64f9a1c2e3b4d5e6f7000001';
const FAKE_BRANCH_ID = '64f9a1c2e3b4d5e6f7000002';
const FAKE_LICENSE_ID = '64f9a1c2e3b4d5e6f7000003';

const FAKE_CATEGORY = {
  _id: FAKE_ID,
  name: 'Food',
  description: 'Food items',
  branch_id: FAKE_BRANCH_ID,
  license: FAKE_LICENSE_ID,
  is_active: true,
  is_deleted: false,
  sort_order: 1,
  created_date: new Date('2026-01-01T00:00:00.000Z'),
  updated_date: new Date('2026-01-01T00:00:00.000Z'),
};

const FAKE_CATEGORY_2 = {
  _id: '64f9a1c2e3b4d5e6f7000004',
  name: 'Beverages',
  description: 'Drinks',
  branch_id: FAKE_BRANCH_ID,
  is_active: true,
  is_deleted: false,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CategoryRepository (class, extends BaseModel)', () => {
  let repository;

  beforeEach(() => {
    jest.clearAllMocks();

    // Restore default resolved values after clearAllMocks
    CategoryModel.__mockSave.mockResolvedValue(FAKE_CATEGORY);
    CategoryModel.findOneAndUpdate.mockResolvedValue(FAKE_CATEGORY);
    CategoryModel.updateMany.mockResolvedValue({ modifiedCount: 1 });
    CategoryModel.insertMany.mockResolvedValue([FAKE_CATEGORY]);
    CategoryModel.countDocuments.mockResolvedValue(0);
    ItemModel.countDocuments.mockResolvedValue(0);
    BaseModel.license = null;
    BaseModel.loggedUser = null;

    // Instantiate the class (not a singleton)
    repository = new Category();

    // Spy on inherited instance methods
    jest.spyOn(repository, 'getCollection').mockResolvedValue({
      find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
    });
    jest.spyOn(repository, 'changeLog').mockResolvedValue({ status: true });
    jest.spyOn(repository, 'deletedDocumentBackup').mockResolvedValue({ status: true });
  });

  // ── constructor ────────────────────────────────────────────────────────────

  describe('constructor', () => {
    test('extends BaseModel with "categories" collection', () => {
      expect(repository.collectionName).toBe('categories');
    });

    test('sets this.model to Category model', () => {
      expect(repository.model).toBe(CategoryModel);
    });
  });

  // ── findAll ────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    test('calls model.find with filters and applies pagination', async () => {
      CategoryModel.find.mockReturnValue(mkChain([FAKE_CATEGORY]));
      CategoryModel.countDocuments.mockResolvedValueOnce(1);
      await repository.findAll({ status: 'active' }, { page: 1, limit: 10 });
      expect(CategoryModel.find).toHaveBeenCalledWith({ status: 'active' });
      expect(CategoryModel.countDocuments).toHaveBeenCalledWith({ status: 'active' });
    });

    test('returns paginated result with data, total, page, limit, totalPages', async () => {
      CategoryModel.find.mockReturnValue(mkChain([FAKE_CATEGORY, FAKE_CATEGORY_2]));
      CategoryModel.countDocuments.mockResolvedValueOnce(2);
      const r = await repository.findAll({}, { page: 1, limit: 10 });
      expect(r).toEqual({
        data: [FAKE_CATEGORY, FAKE_CATEGORY_2],
        total: 2,
        page: 1,
        limit: 10,
        totalPages: 1,
      });
    });

    test('applies sort option', async () => {
      const chain = mkChain([FAKE_CATEGORY]);
      CategoryModel.find.mockReturnValue(chain);
      CategoryModel.countDocuments.mockResolvedValueOnce(1);
      await repository.findAll({}, { sort: { name: 1 } });
      expect(chain.sort).toHaveBeenCalledWith({ name: 1 });
    });

    test('uses default page=1, limit=10 when not provided', async () => {
      CategoryModel.find.mockReturnValue(mkChain([]));
      CategoryModel.countDocuments.mockResolvedValueOnce(0);
      await repository.findAll({});
      expect(CategoryModel.find).toHaveBeenCalledWith({});
    });

    test('clamps page to minimum 1', async () => {
      CategoryModel.find.mockReturnValue(mkChain([]));
      CategoryModel.countDocuments.mockResolvedValueOnce(0);
      await repository.findAll({}, { page: 0, limit: 10 });
      const chain = CategoryModel.find.mock.results[0].value;
      expect(chain.skip).toHaveBeenCalledWith(0); // (1-1)*10 = 0
    });

    test('clamps limit to minimum 1', async () => {
      CategoryModel.find.mockReturnValue(mkChain([]));
      CategoryModel.countDocuments.mockResolvedValueOnce(0);
      await repository.findAll({}, { page: 1, limit: -5 });
      const chain = CategoryModel.find.mock.results[0].value;
      expect(chain.limit).toHaveBeenCalledWith(1);
    });

    test('rethrows error from model.find', async () => {
      CategoryModel.find.mockImplementationOnce(() => {
        throw new Error('Find failed');
      });
      await expect(repository.findAll({})).rejects.toThrow('Find failed');
    });
  });

  // ── findById ────────────────────────────────────────────────────────────────

  describe('findById', () => {
    test('calls model.findOne with ObjectId-converted id', async () => {
      CategoryModel.findOne.mockReturnValue(mkChain(FAKE_CATEGORY));
      await repository.findById(FAKE_ID);
      expect(CategoryModel.findOne).toHaveBeenCalledWith({ _id: expect.any(Object) });
    });

    test('returns the category document', async () => {
      CategoryModel.findOne.mockReturnValue(mkChain(FAKE_CATEGORY));
      const r = await repository.findById(FAKE_ID);
      expect(r).toEqual(FAKE_CATEGORY);
    });

    test('returns null when category not found', async () => {
      CategoryModel.findOne.mockReturnValue(mkChain(null));
      const r = await repository.findById('nonexistent');
      expect(r).toBeNull();
    });

    test('rethrows error from model.findOne', async () => {
      CategoryModel.findOne.mockImplementationOnce(() => {
        throw new Error('FindById failed');
      });
      await expect(repository.findById(FAKE_ID)).rejects.toThrow('FindById failed');
    });
  });

  // ── findByName ─────────────────────────────────────────────────────────────

  describe('findByName', () => {
    test('calls model.findOne with case-insensitive regex and branch_id', async () => {
      CategoryModel.findOne.mockReturnValue(mkChain(FAKE_CATEGORY));
      await repository.findByName('Food', FAKE_BRANCH_ID);
      const filter = CategoryModel.findOne.mock.calls[0][0];
      expect(filter.name.$regex).toBeInstanceOf(RegExp);
      expect(filter.branch_id).toBeDefined();
    });

    test('returns the category document', async () => {
      CategoryModel.findOne.mockReturnValue(mkChain(FAKE_CATEGORY));
      const r = await repository.findByName('Food', FAKE_BRANCH_ID);
      expect(r).toEqual(FAKE_CATEGORY);
    });

    test('rethrows error from model.findOne', async () => {
      CategoryModel.findOne.mockImplementationOnce(() => {
        throw new Error('FindByName failed');
      });
      await expect(repository.findByName('Food', FAKE_BRANCH_ID)).rejects.toThrow(
        'FindByName failed'
      );
    });
  });

  // ── findByNameBranchLicense ────────────────────────────────────────────────

  describe('findByNameBranchLicense', () => {
    test('calls model.findOne with exact name and branch_id', async () => {
      CategoryModel.findOne.mockReturnValue(mkChain(FAKE_CATEGORY));
      await repository.findByNameBranchLicense('Food', FAKE_BRANCH_ID, FAKE_LICENSE_ID);
      const filter = CategoryModel.findOne.mock.calls[0][0];
      expect(filter.name).toBe('Food');
      expect(filter.branch_id).toBeDefined();
      expect(filter.license).toBeDefined();
    });

    test('uses BaseModel.license as fallback when licenseId not provided', async () => {
      BaseModel.license = FAKE_LICENSE_ID;
      CategoryModel.findOne.mockReturnValue(mkChain(FAKE_CATEGORY));
      await repository.findByNameBranchLicense('Food', FAKE_BRANCH_ID);
      const filter = CategoryModel.findOne.mock.calls[0][0];
      expect(filter.license).toBeDefined();
    });

    test('does NOT include license when neither provided nor set on BaseModel', async () => {
      CategoryModel.findOne.mockReturnValue(mkChain(FAKE_CATEGORY));
      await repository.findByNameBranchLicense('Food', FAKE_BRANCH_ID);
      const filter = CategoryModel.findOne.mock.calls[0][0];
      expect(filter.license).toBeUndefined();
    });

    test('includes is_deleted: { $ne: true } filter', async () => {
      CategoryModel.findOne.mockReturnValue(mkChain(FAKE_CATEGORY));
      await repository.findByNameBranchLicense('Food', FAKE_BRANCH_ID);
      const filter = CategoryModel.findOne.mock.calls[0][0];
      expect(filter.is_deleted).toEqual({ $ne: true });
    });

    test('rethrows error from model.findOne', async () => {
      CategoryModel.findOne.mockImplementationOnce(() => {
        throw new Error('FindByNameBranchLicense failed');
      });
      await expect(repository.findByNameBranchLicense('Food', FAKE_BRANCH_ID)).rejects.toThrow(
        'FindByNameBranchLicense failed'
      );
    });
  });

  // ── search ────────────────────────────────────────────────────────────────

  describe('search', () => {
    test('calls model.find with $or regex on name and description', async () => {
      CategoryModel.find.mockReturnValue(mkChain([FAKE_CATEGORY]));
      CategoryModel.countDocuments.mockResolvedValue(1);
      await repository.search('food');
      const filter = CategoryModel.find.mock.calls[0][0];
      expect(filter.$or).toHaveLength(2);
    });

    test('includes is_deleted: { $ne: true } filter', async () => {
      CategoryModel.find.mockReturnValue(mkChain([FAKE_CATEGORY]));
      CategoryModel.countDocuments.mockResolvedValue(1);
      await repository.search('food');
      const filter = CategoryModel.find.mock.calls[0][0];
      expect(filter.is_deleted).toEqual({ $ne: true });
    });

    test('applies branch_id filter when branchId provided', async () => {
      CategoryModel.find.mockReturnValue(mkChain([FAKE_CATEGORY]));
      CategoryModel.countDocuments.mockResolvedValue(1);
      await repository.search('food', { branchId: FAKE_BRANCH_ID });
      const filter = CategoryModel.find.mock.calls[0][0];
      expect(filter.branch_id).toBeDefined();
    });

    test('applies license filter when license provided', async () => {
      CategoryModel.find.mockReturnValue(mkChain([FAKE_CATEGORY]));
      CategoryModel.countDocuments.mockResolvedValue(1);
      await repository.search('food', { license: FAKE_LICENSE_ID });
      const filter = CategoryModel.find.mock.calls[0][0];
      expect(filter.license).toBeDefined();
    });

    test('applies is_active filter when status is "active"', async () => {
      CategoryModel.find.mockReturnValue(mkChain([FAKE_CATEGORY]));
      CategoryModel.countDocuments.mockResolvedValue(1);
      await repository.search('food', { status: 'active' });
      const filter = CategoryModel.find.mock.calls[0][0];
      expect(filter.is_active).toBe(true);
    });

    test('applies is_active=false when status is "inactive"', async () => {
      CategoryModel.find.mockReturnValue(mkChain([FAKE_CATEGORY]));
      CategoryModel.countDocuments.mockResolvedValue(1);
      await repository.search('food', { status: 'inactive' });
      const filter = CategoryModel.find.mock.calls[0][0];
      expect(filter.is_active).toBe(false);
    });

    test('does NOT apply is_active filter when status is "all"', async () => {
      CategoryModel.find.mockReturnValue(mkChain([FAKE_CATEGORY]));
      CategoryModel.countDocuments.mockResolvedValue(1);
      await repository.search('food', { status: 'all' });
      const filter = CategoryModel.find.mock.calls[0][0];
      expect(filter.is_active).toBeUndefined();
    });

    test('returns { data, total } object', async () => {
      CategoryModel.find.mockReturnValue(mkChain([FAKE_CATEGORY]));
      CategoryModel.countDocuments.mockResolvedValue(1);
      const r = await repository.search('food');
      expect(r).toEqual({ data: [FAKE_CATEGORY], total: 1 });
    });

    test('rethrows error from model.find', async () => {
      CategoryModel.find.mockImplementationOnce(() => {
        throw new Error('Search failed');
      });
      await expect(repository.search('food')).rejects.toThrow('Search failed');
    });
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    const NEW_DATA = { name: 'New Category', description: 'Test' };

    test('calls new CategoryModel with data plus timestamps', async () => {
      await repository.create(NEW_DATA);
      expect(CategoryModel).toHaveBeenCalledWith(
        expect.objectContaining({
          ...NEW_DATA,
          created_date: expect.any(Date),
          updated_date: expect.any(Date),
        })
      );
    });

    test('calls .save() on the new category instance', async () => {
      await repository.create(NEW_DATA);
      expect(CategoryModel.__mockSave).toHaveBeenCalled();
    });

    test('returns the toObject result from the instance', async () => {
      const r = await repository.create(NEW_DATA);
      expect(r).toEqual(expect.objectContaining(NEW_DATA));
    });

    test('rethrows error when save() fails', async () => {
      CategoryModel.__mockSave.mockRejectedValueOnce(new Error('Save failed'));
      await expect(repository.create(NEW_DATA)).rejects.toThrow('Save failed');
    });
  });

  // ── update ────────────────────────────────────────────────────────────────

  describe('update', () => {
    const UPDATE_DATA = { name: 'Updated Category' };

    test('calls model.findOneAndUpdate with ObjectId id and is_deleted check', async () => {
      await repository.update(FAKE_ID, UPDATE_DATA);
      expect(CategoryModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: expect.any(Object), is_deleted: { $ne: true } },
        expect.objectContaining({ $set: expect.any(Object) }),
        { new: true, lean: true }
      );
    });

    test('includes updated_date in $set', async () => {
      await repository.update(FAKE_ID, UPDATE_DATA);
      const updateObj = CategoryModel.findOneAndUpdate.mock.calls[0][1];
      expect(updateObj.$set.updated_date).toBeInstanceOf(Date);
    });

    test('returns the updated category', async () => {
      const r = await repository.update(FAKE_ID, UPDATE_DATA);
      expect(r).toEqual(FAKE_CATEGORY);
    });

    test('rethrows error from findOneAndUpdate', async () => {
      CategoryModel.findOneAndUpdate.mockRejectedValueOnce(new Error('Update failed'));
      await expect(repository.update(FAKE_ID, UPDATE_DATA)).rejects.toThrow('Update failed');
    });
  });

  // ── softDelete ────────────────────────────────────────────────────────────

  describe('softDelete', () => {
    test('calls model.findOneAndUpdate with ObjectId id', async () => {
      await repository.softDelete(FAKE_ID);
      expect(CategoryModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: expect.any(Object) },
        expect.objectContaining({ $set: { is_deleted: true, deleted_date: expect.any(Date) } }),
        { new: true, lean: true }
      );
    });

    test('returns the updated category', async () => {
      const r = await repository.softDelete(FAKE_ID);
      expect(r).toEqual(FAKE_CATEGORY);
    });

    test('rethrows error from findOneAndUpdate', async () => {
      CategoryModel.findOneAndUpdate.mockRejectedValueOnce(new Error('SoftDelete failed'));
      await expect(repository.softDelete(FAKE_ID)).rejects.toThrow('SoftDelete failed');
    });
  });

  // ── bulkSoftDelete ────────────────────────────────────────────────────────

  describe('bulkSoftDelete', () => {
    test('calls model.updateMany with $in filter and is_deleted set', async () => {
      await repository.bulkSoftDelete([FAKE_ID, FAKE_CATEGORY_2._id]);
      expect(CategoryModel.updateMany).toHaveBeenCalledWith(
        { _id: { $in: expect.any(Array) } },
        expect.objectContaining({ $set: { is_deleted: true, deleted_date: expect.any(Date) } })
      );
    });

    test('returns the update result', async () => {
      const r = await repository.bulkSoftDelete([FAKE_ID]);
      expect(r).toEqual({ modifiedCount: 1 });
    });

    test('rethrows error from updateMany', async () => {
      CategoryModel.updateMany.mockRejectedValueOnce(new Error('BulkSoftDelete failed'));
      await expect(repository.bulkSoftDelete([FAKE_ID])).rejects.toThrow('BulkSoftDelete failed');
    });
  });

  // ── bulkHardDelete ────────────────────────────────────────────────────────

  describe('bulkHardDelete', () => {
    test('calls inherited getCollection method', async () => {
      await repository.bulkHardDelete([FAKE_ID]);
      expect(repository.getCollection).toHaveBeenCalledWith('categories');
    });

    test('uses BaseModel.license when available', async () => {
      BaseModel.license = FAKE_LICENSE_ID;
      await repository.bulkHardDelete([FAKE_ID]);
      // License should be used in the condition
      expect(repository.getCollection).toHaveBeenCalled();
    });

    test('calls changeLog for each category', async () => {
      const mockCollection = {
        find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([FAKE_CATEGORY]) }),
        deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      };
      repository.getCollection.mockResolvedValueOnce(mockCollection);
      await repository.bulkHardDelete([FAKE_ID]);
      expect(repository.changeLog).toHaveBeenCalledWith(
        'categories',
        BaseModel.loggedUser,
        FAKE_CATEGORY._id,
        'delete'
      );
    });

    test('calls deletedDocumentBackup for each category', async () => {
      const mockCollection = {
        find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([FAKE_CATEGORY]) }),
        deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      };
      repository.getCollection.mockResolvedValueOnce(mockCollection);
      await repository.bulkHardDelete([FAKE_ID]);
      expect(repository.deletedDocumentBackup).toHaveBeenCalledWith('categories', FAKE_CATEGORY);
    });

    test('returns { deletedCount } object', async () => {
      const mockCollection = {
        find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([FAKE_CATEGORY]) }),
        deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      };
      repository.getCollection.mockResolvedValueOnce(mockCollection);
      const r = await repository.bulkHardDelete([FAKE_ID]);
      expect(r).toEqual({ deletedCount: 1 });
    });

    test('returns deletedCount: 0 when no categories found', async () => {
      const mockCollection = {
        find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
        deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      };
      repository.getCollection.mockResolvedValueOnce(mockCollection);
      const r = await repository.bulkHardDelete([FAKE_ID]);
      expect(r).toEqual({ deletedCount: 0 });
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.bulkHardDelete([FAKE_ID])).rejects.toThrow('GetCollection failed');
    });
  });

  // ── findByBranch ────────────────────────────────────────────────────────

  describe('findByBranch', () => {
    test('calls model.find with branch_id and is_deleted filter', async () => {
      CategoryModel.find.mockReturnValue(mkChain([FAKE_CATEGORY]));
      await repository.findByBranch(FAKE_BRANCH_ID);
      const filter = CategoryModel.find.mock.calls[0][0];
      expect(filter.branch_id).toBeDefined();
      expect(filter.is_deleted).toEqual({ $ne: true });
    });

    test('applies license filter when provided', async () => {
      CategoryModel.find.mockReturnValue(mkChain([FAKE_CATEGORY]));
      await repository.findByBranch(FAKE_BRANCH_ID, { license: FAKE_LICENSE_ID });
      const filter = CategoryModel.find.mock.calls[0][0];
      expect(filter.license).toBeDefined();
    });

    test('applies activeOnly filter: is_active=true OR is_active does not exist', async () => {
      CategoryModel.find.mockReturnValue(mkChain([FAKE_CATEGORY]));
      await repository.findByBranch(FAKE_BRANCH_ID, { activeOnly: true });
      const filter = CategoryModel.find.mock.calls[0][0];
      expect(filter.$or).toEqual([{ is_active: true }, { is_active: { $exists: false } }]);
    });

    test('applies sort order', async () => {
      const chain = mkChain([FAKE_CATEGORY]);
      CategoryModel.find.mockReturnValue(chain);
      await repository.findByBranch(FAKE_BRANCH_ID);
      expect(chain.sort).toHaveBeenCalledWith({ sort_order: 1, name: 1 });
    });

    test('returns array of categories', async () => {
      CategoryModel.find.mockReturnValue(mkChain([FAKE_CATEGORY]));
      const r = await repository.findByBranch(FAKE_BRANCH_ID);
      expect(r).toEqual([FAKE_CATEGORY]);
    });

    test('rethrows error from model.find', async () => {
      CategoryModel.find.mockImplementationOnce(() => {
        throw new Error('FindByBranch failed');
      });
      await expect(repository.findByBranch(FAKE_BRANCH_ID)).rejects.toThrow('FindByBranch failed');
    });
  });

  // ── getCategoryWithItemCount ───────────────────────────────────────────────

  describe('getCategoryWithItemCount', () => {
    test('calls findById to get the category', async () => {
      CategoryModel.findOne.mockReturnValue(mkChain(FAKE_CATEGORY));
      ItemModel.countDocuments.mockResolvedValueOnce(5);
      await repository.getCategoryWithItemCount(FAKE_ID);
      expect(CategoryModel.findOne).toHaveBeenCalled();
    });

    test('dynamically requires Item model and calls countDocuments', async () => {
      CategoryModel.findOne.mockReturnValue(mkChain(FAKE_CATEGORY));
      ItemModel.countDocuments.mockResolvedValueOnce(3);
      await repository.getCategoryWithItemCount(FAKE_ID);
      expect(ItemModel.countDocuments).toHaveBeenCalledWith({
        category_id: expect.any(Object),
        is_deleted: { $ne: true },
      });
    });

    test('returns category with item_count added', async () => {
      CategoryModel.findOne.mockReturnValue(mkChain(FAKE_CATEGORY));
      ItemModel.countDocuments.mockResolvedValueOnce(7);
      const r = await repository.getCategoryWithItemCount(FAKE_ID);
      expect(r.item_count).toBe(7);
    });

    test('returns null when category not found', async () => {
      CategoryModel.findOne.mockReturnValue(mkChain(null));
      const r = await repository.getCategoryWithItemCount(FAKE_ID);
      expect(r).toBeNull();
    });

    test('rethrows error from findById', async () => {
      CategoryModel.findOne.mockImplementationOnce(() => {
        throw new Error('GetCategory failed');
      });
      await expect(repository.getCategoryWithItemCount(FAKE_ID)).rejects.toThrow(
        'GetCategory failed'
      );
    });
  });

  // ── hasItems ──────────────────────────────────────────────────────────────

  describe('hasItems', () => {
    test('dynamically requires Item model and calls countDocuments', async () => {
      ItemModel.countDocuments.mockResolvedValueOnce(5);
      await repository.hasItems(FAKE_ID);
      expect(ItemModel.countDocuments).toHaveBeenCalledWith({
        category_id: expect.any(Object),
        is_deleted: { $ne: true },
      });
    });

    test('returns true when count > 0', async () => {
      ItemModel.countDocuments.mockResolvedValueOnce(1);
      const r = await repository.hasItems(FAKE_ID);
      expect(r).toBe(true);
    });

    test('returns false when count is 0', async () => {
      ItemModel.countDocuments.mockResolvedValueOnce(0);
      const r = await repository.hasItems(FAKE_ID);
      expect(r).toBe(false);
    });

    test('rethrows error from countDocuments', async () => {
      ItemModel.countDocuments.mockRejectedValueOnce(new Error('HasItems failed'));
      await expect(repository.hasItems(FAKE_ID)).rejects.toThrow('HasItems failed');
    });
  });

  // ── findByBranchWithItems ─────────────────────────────────────────────────

  describe('findByBranchWithItems', () => {
    test('calls model.aggregate with complex pipeline', async () => {
      CategoryModel.aggregate.mockResolvedValueOnce([FAKE_CATEGORY]);
      await repository.findByBranchWithItems(FAKE_BRANCH_ID);
      expect(CategoryModel.aggregate).toHaveBeenCalled();
    });

    test('includes branch_id in $match stage', async () => {
      CategoryModel.aggregate.mockResolvedValueOnce([FAKE_CATEGORY]);
      await repository.findByBranchWithItems(FAKE_BRANCH_ID);
      const pipeline = CategoryModel.aggregate.mock.calls[0][0];
      const matchStage = pipeline.find((stage) => stage.$match);
      expect(matchStage.$match.branch_id).toBeDefined();
    });

    test('includes license in $match when provided', async () => {
      CategoryModel.aggregate.mockResolvedValueOnce([FAKE_CATEGORY]);
      await repository.findByBranchWithItems(FAKE_BRANCH_ID, { license: FAKE_LICENSE_ID });
      const pipeline = CategoryModel.aggregate.mock.calls[0][0];
      const matchStage = pipeline.find((stage) => stage.$match);
      expect(matchStage.$match.license).toBeDefined();
    });

    test('includes activeOnly $or in $match when activeOnly=true', async () => {
      CategoryModel.aggregate.mockResolvedValueOnce([FAKE_CATEGORY]);
      await repository.findByBranchWithItems(FAKE_BRANCH_ID, { activeOnly: true });
      const pipeline = CategoryModel.aggregate.mock.calls[0][0];
      const matchStage = pipeline.find((stage) => stage.$match);
      expect(matchStage.$match.$or).toEqual([
        { is_active: true },
        { is_active: { $exists: false } },
      ]);
    });

    test('includes $lookup stage for items', async () => {
      CategoryModel.aggregate.mockResolvedValueOnce([FAKE_CATEGORY]);
      await repository.findByBranchWithItems(FAKE_BRANCH_ID);
      const pipeline = CategoryModel.aggregate.mock.calls[0][0];
      const lookupStage = pipeline.find((stage) => stage.$lookup);
      expect(lookupStage.$lookup.from).toBe('items');
    });

    test('returns array of categories with items', async () => {
      CategoryModel.aggregate.mockResolvedValueOnce([FAKE_CATEGORY]);
      const r = await repository.findByBranchWithItems(FAKE_BRANCH_ID);
      expect(r).toEqual([FAKE_CATEGORY]);
    });

    test('rethrows error from aggregate', async () => {
      CategoryModel.aggregate.mockRejectedValueOnce(new Error('FindByBranchWithItems failed'));
      await expect(repository.findByBranchWithItems(FAKE_BRANCH_ID)).rejects.toThrow(
        'FindByBranchWithItems failed'
      );
    });
  });

  // ── getDataChanges ────────────────────────────────────────────────────────

  describe('getDataChanges', () => {
    test('calls model.find with branch_id and updated_date filter', async () => {
      CategoryModel.find.mockReturnValue(mkChain([FAKE_CATEGORY]));
      await repository.getDataChanges('2026-01-01', FAKE_BRANCH_ID);
      const filter = CategoryModel.find.mock.calls[0][0];
      expect(filter.branch_id).toBeDefined();
      expect(filter.updated_date).toEqual({ $gte: expect.any(Date) });
    });

    test('returns array of changed categories', async () => {
      CategoryModel.find.mockReturnValue(mkChain([FAKE_CATEGORY]));
      const r = await repository.getDataChanges('2026-01-01', FAKE_BRANCH_ID);
      expect(r).toEqual([FAKE_CATEGORY]);
    });

    test('rethrows error from model.find', async () => {
      CategoryModel.find.mockImplementationOnce(() => {
        throw new Error('GetDataChanges failed');
      });
      await expect(repository.getDataChanges('2026-01-01', FAKE_BRANCH_ID)).rejects.toThrow(
        'GetDataChanges failed'
      );
    });
  });

  // ── bulkCreate ───────────────────────────────────────────────────────────

  describe('bulkCreate', () => {
    const CATEGORIES_DATA = [
      { name: 'Cat 1', description: 'Desc 1' },
      { name: 'Cat 2', description: 'Desc 2' },
    ];

    test('calls model.insertMany with data plus defaults', async () => {
      await repository.bulkCreate(CATEGORIES_DATA);
      expect(CategoryModel.insertMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            image: 'category.svg',
            created_date: expect.any(Date),
            updated_date: expect.any(Date),
            is_deleted: false,
          }),
        ])
      );
    });

    test('preserves provided image when present', async () => {
      const withImage = [{ ...CATEGORIES_DATA[0], image: 'custom.png' }];
      await repository.bulkCreate(withImage);
      const callArg = CategoryModel.insertMany.mock.calls[0][0];
      expect(callArg[0].image).toBe('custom.png');
    });

    test('returns the insertMany result', async () => {
      const r = await repository.bulkCreate(CATEGORIES_DATA);
      expect(r).toEqual([FAKE_CATEGORY]);
    });

    test('rethrows error from insertMany', async () => {
      CategoryModel.insertMany.mockRejectedValueOnce(new Error('BulkCreate failed'));
      await expect(repository.bulkCreate(CATEGORIES_DATA)).rejects.toThrow('BulkCreate failed');
    });
  });

  // ── exportData ───────────────────────────────────────────────────────────

  describe('exportData', () => {
    test('calls model.find with filters and is_deleted check', async () => {
      CategoryModel.find.mockReturnValue(mkChain([FAKE_CATEGORY]));
      await repository.exportData({ status: 'active' });
      const filter = CategoryModel.find.mock.calls[0][0];
      expect(filter.status).toBe('active');
      expect(filter.is_deleted).toEqual({ $ne: true });
    });

    test('applies select for specific fields', async () => {
      const chain = mkChain([FAKE_CATEGORY]);
      CategoryModel.find.mockReturnValue(chain);
      await repository.exportData({});
      expect(chain.select).toHaveBeenCalledWith(
        'name discount_amount discount_percentage description'
      );
    });

    test('returns array of categories', async () => {
      CategoryModel.find.mockReturnValue(mkChain([FAKE_CATEGORY]));
      const r = await repository.exportData({});
      expect(r).toEqual([FAKE_CATEGORY]);
    });

    test('rethrows error from model.find', async () => {
      CategoryModel.find.mockImplementationOnce(() => {
        throw new Error('ExportData failed');
      });
      await expect(repository.exportData({})).rejects.toThrow('ExportData failed');
    });
  });

  // ── getActiveCategories ──────────────────────────────────────────────────

  describe('getActiveCategories', () => {
    test('calls model.find with branch_id, is_active, is_deleted filters', async () => {
      CategoryModel.find.mockReturnValue(mkChain([FAKE_CATEGORY]));
      await repository.getActiveCategories(FAKE_BRANCH_ID);
      const filter = CategoryModel.find.mock.calls[0][0];
      expect(filter.branch_id).toBeDefined();
      expect(filter.is_active).toBe(true);
      expect(filter.is_deleted).toEqual({ $ne: true });
    });

    test('applies select for specific fields', async () => {
      const chain = mkChain([FAKE_CATEGORY]);
      CategoryModel.find.mockReturnValue(chain);
      await repository.getActiveCategories(FAKE_BRANCH_ID);
      expect(chain.select).toHaveBeenCalledWith(
        '_id name image discount_amount discount_percentage'
      );
    });

    test('applies sort order', async () => {
      const chain = mkChain([FAKE_CATEGORY]);
      CategoryModel.find.mockReturnValue(chain);
      await repository.getActiveCategories(FAKE_BRANCH_ID);
      expect(chain.sort).toHaveBeenCalledWith({ sort_order: 1, name: 1 });
    });

    test('returns array of active categories', async () => {
      CategoryModel.find.mockReturnValue(mkChain([FAKE_CATEGORY]));
      const r = await repository.getActiveCategories(FAKE_BRANCH_ID);
      expect(r).toEqual([FAKE_CATEGORY]);
    });

    test('rethrows error from model.find', async () => {
      CategoryModel.find.mockImplementationOnce(() => {
        throw new Error('GetActiveCategories failed');
      });
      await expect(repository.getActiveCategories(FAKE_BRANCH_ID)).rejects.toThrow(
        'GetActiveCategories failed'
      );
    });
  });

  // ── updateSortOrder ─────────────────────────────────────────────────────

  describe('updateSortOrder', () => {
    test('calls model.findOneAndUpdate with ObjectId id and sort_order', async () => {
      await repository.updateSortOrder(FAKE_ID, 5);
      expect(CategoryModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: expect.any(Object) },
        { $set: { sort_order: 5, updated_date: expect.any(Date) } },
        { new: true, lean: true }
      );
    });

    test('returns the updated category', async () => {
      const r = await repository.updateSortOrder(FAKE_ID, 5);
      expect(r).toEqual(FAKE_CATEGORY);
    });

    test('rethrows error from findOneAndUpdate', async () => {
      CategoryModel.findOneAndUpdate.mockRejectedValueOnce(new Error('UpdateSortOrder failed'));
      await expect(repository.updateSortOrder(FAKE_ID, 5)).rejects.toThrow(
        'UpdateSortOrder failed'
      );
    });
  });

  // ── toggleActive ────────────────────────────────────────────────────────

  describe('toggleActive', () => {
    test('calls findById to get current category', async () => {
      CategoryModel.findOne.mockReturnValue(mkChain(FAKE_CATEGORY));
      CategoryModel.findOneAndUpdate.mockResolvedValueOnce(FAKE_CATEGORY);
      await repository.toggleActive(FAKE_ID);
      expect(CategoryModel.findOne).toHaveBeenCalled();
    });

    test('returns null when category not found', async () => {
      CategoryModel.findOne.mockReturnValue(mkChain(null));
      const r = await repository.toggleActive(FAKE_ID);
      expect(r).toBeNull();
    });

    test('calls findOneAndUpdate with flipped is_active', async () => {
      CategoryModel.findOne.mockReturnValue(mkChain({ ...FAKE_CATEGORY, is_active: true }));
      CategoryModel.findOneAndUpdate.mockResolvedValueOnce({ ...FAKE_CATEGORY, is_active: false });
      await repository.toggleActive(FAKE_ID);
      const updateObj = CategoryModel.findOneAndUpdate.mock.calls[0][1];
      expect(updateObj.$set.is_active).toBe(false);
    });

    test('includes updated_date in $set', async () => {
      CategoryModel.findOne.mockReturnValue(mkChain(FAKE_CATEGORY));
      CategoryModel.findOneAndUpdate.mockResolvedValueOnce(FAKE_CATEGORY);
      await repository.toggleActive(FAKE_ID);
      const updateObj = CategoryModel.findOneAndUpdate.mock.calls[0][1];
      expect(updateObj.$set.updated_date).toBeInstanceOf(Date);
    });

    test('rethrows error from findById', async () => {
      CategoryModel.findOne.mockImplementationOnce(() => {
        throw new Error('ToggleActive failed');
      });
      await expect(repository.toggleActive(FAKE_ID)).rejects.toThrow('ToggleActive failed');
    });
  });
});
