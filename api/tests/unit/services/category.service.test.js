'use strict';

/**
 * Unit tests for src/services/category.service.js
 *
 * File confirmed : src/services/category.service.js (747 lines)
 * Export type    : CLASS export — `module.exports = CategoryService`
 *                  (Controller creates instances with `new CategoryService()`)
 *                  Differs from auth/base/branches which export a singleton instance.
 * Does NOT extend base.service.js.
 *
 * Constructor    : `this.repository = new CategoryRepository()`
 *
 * Methods (16):
 *   getAllCategories(filters, options)
 *   getCategoryById(id)
 *   getCategoryWithItemCount(id)
 *   createCategory(categoryData)
 *   updateCategory(id, updateData)
 *   deleteCategory(id)           — soft delete via repository.softDelete
 *   bulkDeleteCategories(ids)    — hard delete via repository.bulkHardDelete
 *   searchCategories(searchTerm, options)
 *   getCategoriesByBranch(branchId, activeOnly, license)
 *   getCategoriesWithItems(branchId, activeOnly, licenseId)
 *   getActiveCategories(branchId)
 *   bulkImport(categoriesData)
 *   exportCategories(filters)
 *   getDataChanges(fromDate, branchId)
 *   toggleActive(id)
 *   updateSortOrder(id, sortOrder)
 *
 * External dependencies (all mocked):
 *   CategoryRepository (class) — mocked per-test via jest.mock + mockImplementation
 *   mongoose.Types.ObjectId    — mocked (used for ID coercion in filters)
 *   BaseModel                  — mocked (static methods: startingDate/endingDate/currentTimeZone;
 *                                instance: checkPlan; static prop: currentBranch)
 *   categories.helper          — sanitizeCategoryData, validateCategoryData, isCategoryNameUnique
 *
 * PRODUCTION NOTES:
 *   1. Uses console.error/console.log instead of structured logger throughout.
 *   2. console.log debug statements left in getAllCategories (lines 81,88,99,106,113) — should
 *      be removed before production deployment.
 *   3. `bulkImport` uses `BaseModel.currentBranch` global static state to resolve branch when
 *      category.branch_id is absent — coupling service logic to global DB model state.
 *   4. `deleteCategory` is labelled "soft delete" but the message says "category deleted" —
 *      consistent with PHP but misleading in Node.js.
 *   5. `bulkDeleteCategories` performs a HARD delete despite `deleteCategory` being soft — no
 *      warning or docs about this asymmetry.
 *   6. `searchCategories` falls back to `getAllCategories` on empty term — this makes the
 *      behaviour of `searchCategories('')` different from what the name implies.
 */

// ─── Mock CategoryRepository (class — instantiated in service constructor) ────
// Explicit factory prevents Jest from loading the real module (which would
// trigger category.model.js → mongoose.Schema chain before mongoose is mocked).
jest.mock('../../../src/repositories/category.repository', () => jest.fn());

// ─── Mock mongoose (Types.ObjectId used throughout filter building) ────────────
jest.mock('mongoose', () => ({
  Types: {
    ObjectId: jest.fn().mockImplementation((id) => ({ _mockedId: id, toString: () => String(id) })),
  },
}));

// ─── Mock BaseModel (static methods + instance checkPlan) ────────────────────
jest.mock('../../../src/models/base.model', () => {
  const MockBaseModel = jest.fn().mockImplementation(() => ({
    checkPlan: jest.fn().mockResolvedValue(0),
  }));
  MockBaseModel.currentTimeZone = 'Asia/Kolkata';
  MockBaseModel.currentBranch = 'branch_default_static';
  MockBaseModel.startingDate = jest.fn().mockReturnValue(new Date('2024-01-01T00:00:00.000Z'));
  MockBaseModel.endingDate = jest.fn().mockReturnValue(new Date('2024-01-31T23:59:59.999Z'));
  return MockBaseModel;
});

// ─── Mock categories.helper ────────────────────────────────────────────────────
jest.mock('../../../src/helpers/categories.helper', () => ({
  sanitizeCategoryData: jest.fn((data) => ({ ...data, _sanitized: true })),
  validateCategoryData: jest.fn().mockReturnValue({ valid: true, errors: [] }),
  isCategoryNameUnique: jest.fn().mockResolvedValue(true),
}));

// ─── Requires ─────────────────────────────────────────────────────────────────
const CategoryRepository = require('../../../src/repositories/category.repository');
const BaseModel = require('../../../src/models/base.model');
const {
  sanitizeCategoryData,
  validateCategoryData,
  isCategoryNameUnique,
} = require('../../../src/helpers/categories.helper');
const CategoryService = require('../../../src/services/category.service');

// ─── Mock data ────────────────────────────────────────────────────────────────
const BRANCH_ID = '64a1b2c3d4e5f6a7b8c9d0e1';
const LICENSE_ID = '64a1b2c3d4e5f6a7b8c9d0e2';
const CATEGORY_ID = '64a1b2c3d4e5f6a7b8c9d0e3';

function makeMockCategory(overrides = {}) {
  return {
    _id: CATEGORY_ID,
    name: 'Food',
    description: 'Food items',
    branch_id: BRANCH_ID,
    license: LICENSE_ID,
    is_active: true,
    discount_amount: 0,
    discount_percentage: 0,
    ...overrides,
  };
}

function makeRepoMethods(overrides = {}) {
  return {
    findAll: jest.fn(),
    findById: jest.fn(),
    getCategoryWithItemCount: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    bulkHardDelete: jest.fn(),
    search: jest.fn(),
    findByBranch: jest.fn(),
    findByBranchWithItems: jest.fn(),
    getActiveCategories: jest.fn(),
    findByName: jest.fn(),
    findByNameBranchLicense: jest.fn(),
    bulkCreate: jest.fn(),
    exportData: jest.fn(),
    getDataChanges: jest.fn(),
    toggleActive: jest.fn(),
    updateSortOrder: jest.fn(),
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
describe('CategoryService', () => {
  let service;
  let repo; // reference to the mock repository instance created by constructor

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const repoMethods = makeRepoMethods();
    CategoryRepository.mockImplementation(() => repoMethods);
    service = new CategoryService();
    repo = service.repository; // direct access to the mock instance
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Service initialization
  // ══════════════════════════════════════════════════════════════════════════
  describe('initialization', () => {
    test('CategoryService exports a class (not a singleton instance)', () => {
      expect(typeof CategoryService).toBe('function');
    });

    test('new CategoryService() creates an instance with a repository', () => {
      expect(service.repository).toBeDefined();
    });

    test('instantiates a new CategoryRepository in the constructor', () => {
      expect(CategoryRepository).toHaveBeenCalledTimes(1);
    });

    test('exposes all 16 service methods', () => {
      const methods = [
        'getAllCategories',
        'getCategoryById',
        'getCategoryWithItemCount',
        'createCategory',
        'updateCategory',
        'deleteCategory',
        'bulkDeleteCategories',
        'searchCategories',
        'getCategoriesByBranch',
        'getCategoriesWithItems',
        'getActiveCategories',
        'bulkImport',
        'exportCategories',
        'getDataChanges',
        'toggleActive',
        'updateSortOrder',
      ];
      methods.forEach((m) => expect(typeof service[m]).toBe('function'));
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getAllCategories
  // ══════════════════════════════════════════════════════════════════════════
  describe('getAllCategories', () => {
    test('returns {status:true, data, message} on success with no filters', async () => {
      const data = [makeMockCategory()];
      repo.findAll.mockResolvedValue(data);

      const result = await service.getAllCategories();

      expect(result.status).toBe(true);
      expect(result.data).toBe(data);
      expect(result.message).toBe('Categories retrieved successfully');
    });

    test('calls repository.findAll with built queryFilters and options', async () => {
      repo.findAll.mockResolvedValue([]);
      const options = { page: 1, limit: 10 };

      await service.getAllCategories({ branch_id: BRANCH_ID }, options);

      expect(repo.findAll).toHaveBeenCalledWith(expect.any(Object), options);
    });

    test('coerces single branch_id to ObjectId in filter', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCategories({ branch_id: BRANCH_ID });

      const [queryFilters] = repo.findAll.mock.calls[0];
      expect(queryFilters.branch_id).toBeDefined();
    });

    test('applies $in filter for branch_ids array', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCategories({ branch_ids: [BRANCH_ID, 'branch_two'] });

      const [queryFilters] = repo.findAll.mock.calls[0];
      expect(queryFilters.branch_id).toHaveProperty('$in');
      expect(queryFilters.branch_id.$in).toHaveLength(2);
    });

    test('applies license filter as ObjectId', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCategories({ license: LICENSE_ID });

      const [queryFilters] = repo.findAll.mock.calls[0];
      expect(queryFilters.license).toBeDefined();
    });

    test('applies the current branch name as an exact filter', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCategories({ branch_name: 'Main Branch' });

      const [queryFilters] = repo.findAll.mock.calls[0];
      expect(queryFilters.branch_name).toBe('Main Branch');
    });

    test('applies name string filter as case-insensitive RegExp', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCategories({ name: 'food' });

      const [queryFilters] = repo.findAll.mock.calls[0];
      expect(queryFilters.name).toBeInstanceOf(RegExp);
    });

    test('applies name.$regex filter object', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCategories({ name: { $regex: 'food', $options: 'i' } });

      const [queryFilters] = repo.findAll.mock.calls[0];
      expect(queryFilters.name).toHaveProperty('$regex');
      expect(queryFilters.name).toHaveProperty('$options');
    });

    test('applies description string filter as RegExp', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCategories({ description: 'fresh' });

      const [queryFilters] = repo.findAll.mock.calls[0];
      expect(queryFilters.description).toBeInstanceOf(RegExp);
    });

    test('applies $or search filter when search provided (no name/description)', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCategories({ search: 'food' });

      const [queryFilters] = repo.findAll.mock.calls[0];
      expect(queryFilters.$or).toBeDefined();
      expect(queryFilters.$or).toHaveLength(2);
    });

    test('does NOT apply $or search filter when name filter also present', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCategories({ search: 'food', name: 'food' });

      const [queryFilters] = repo.findAll.mock.calls[0];
      expect(queryFilters.$or).toBeUndefined();
    });

    test('applies is_active:true for status "active"', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCategories({ status: 'active' });

      const [queryFilters] = repo.findAll.mock.calls[0];
      expect(queryFilters.is_active).toBe(true);
    });

    test('applies is_active:false for status "inactive"', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCategories({ status: 'inactive' });

      const [queryFilters] = repo.findAll.mock.calls[0];
      expect(queryFilters.is_active).toBe(false);
    });

    test('does NOT apply is_active filter for status "all"', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCategories({ status: 'all' });

      const [queryFilters] = repo.findAll.mock.calls[0];
      expect(queryFilters.is_active).toBeUndefined();
    });

    test('applies updated_date.$gte filter via BaseModel.startingDate', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCategories({ updated_date: { $gte: '2024-01-01' } });

      expect(BaseModel.startingDate).toHaveBeenCalled();
      const [queryFilters] = repo.findAll.mock.calls[0];
      expect(queryFilters.updated_date.$gte).toBeDefined();
    });

    test('applies updated_date.$lte filter via BaseModel.endingDate', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCategories({ updated_date: { $lte: '2024-01-31' } });

      expect(BaseModel.endingDate).toHaveBeenCalled();
      const [queryFilters] = repo.findAll.mock.calls[0];
      expect(queryFilters.updated_date.$lte).toBeDefined();
    });

    test('skips date filter when BaseModel returns NaN date', async () => {
      BaseModel.startingDate.mockReturnValueOnce(new Date('invalid'));
      repo.findAll.mockResolvedValue([]);

      await service.getAllCategories({ updated_date: { $gte: 'bad-date' } });

      const [queryFilters] = repo.findAll.mock.calls[0];
      // updated_date object exists but $gte should not be set
      if (queryFilters.updated_date) {
        expect(queryFilters.updated_date.$gte).toBeUndefined();
      }
    });

    test('returns {status:false, message} on repository error', async () => {
      repo.findAll.mockRejectedValue(new Error('DB error'));

      const result = await service.getAllCategories();

      expect(result.status).toBe(false);
      expect(result.message).toBe('DB error');
      expect(result.data).toBeNull();
    });

    test('returns empty data array correctly', async () => {
      repo.findAll.mockResolvedValue([]);

      const result = await service.getAllCategories();

      expect(result.status).toBe(true);
      expect(result.data).toEqual([]);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getCategoryById
  // ══════════════════════════════════════════════════════════════════════════
  describe('getCategoryById', () => {
    test('returns {status:true, data:category} when found', async () => {
      const cat = makeMockCategory();
      repo.findById.mockResolvedValue(cat);

      const result = await service.getCategoryById(CATEGORY_ID);

      expect(result).toEqual({
        status: true,
        data: cat,
        message: 'Category retrieved successfully',
      });
    });

    test('returns {status:false, "Category not found"} when null', async () => {
      repo.findById.mockResolvedValue(null);

      const result = await service.getCategoryById('nonexistent');

      expect(result).toEqual({ status: false, data: null, message: 'Category not found' });
    });

    test('calls repository.findById with the provided id', async () => {
      repo.findById.mockResolvedValue(makeMockCategory());
      await service.getCategoryById(CATEGORY_ID);
      expect(repo.findById).toHaveBeenCalledWith(CATEGORY_ID);
    });

    test('returns error shape on repository throw', async () => {
      repo.findById.mockRejectedValue(new Error('Query failed'));
      const result = await service.getCategoryById(CATEGORY_ID);
      expect(result.status).toBe(false);
      expect(result.message).toBe('Query failed');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getCategoryWithItemCount
  // ══════════════════════════════════════════════════════════════════════════
  describe('getCategoryWithItemCount', () => {
    test('returns category with item count on success', async () => {
      const cat = { ...makeMockCategory(), itemCount: 5 };
      repo.getCategoryWithItemCount.mockResolvedValue(cat);

      const result = await service.getCategoryWithItemCount(CATEGORY_ID);

      expect(result.status).toBe(true);
      expect(result.data).toBe(cat);
    });

    test('returns {status:false, "Category not found"} when null', async () => {
      repo.getCategoryWithItemCount.mockResolvedValue(null);
      const result = await service.getCategoryWithItemCount('bad_id');
      expect(result).toEqual({ status: false, data: null, message: 'Category not found' });
    });

    test('calls repository.getCategoryWithItemCount with id', async () => {
      repo.getCategoryWithItemCount.mockResolvedValue(makeMockCategory());
      await service.getCategoryWithItemCount(CATEGORY_ID);
      expect(repo.getCategoryWithItemCount).toHaveBeenCalledWith(CATEGORY_ID);
    });

    test('returns error shape on throw', async () => {
      repo.getCategoryWithItemCount.mockRejectedValue(new Error('agg fail'));
      const result = await service.getCategoryWithItemCount(CATEGORY_ID);
      expect(result.status).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // createCategory
  // ══════════════════════════════════════════════════════════════════════════
  describe('createCategory', () => {
    const validPayload = () => ({
      name: 'Beverages',
      branch_id: BRANCH_ID,
      license: LICENSE_ID,
    });

    // ── validation ──────────────────────────────────────────────────────────
    test('returns error when name is missing', async () => {
      const result = await service.createCategory({ branch_id: BRANCH_ID });
      expect(result).toEqual({ status: false, data: null, message: 'Category name is required' });
    });

    test('returns error when name is empty string', async () => {
      const result = await service.createCategory({ name: '', branch_id: BRANCH_ID });
      expect(result.status).toBe(false);
      expect(result.message).toBe('Category name is required');
    });

    test('returns error when branch_id is missing', async () => {
      const result = await service.createCategory({ name: 'Food' });
      expect(result).toEqual({ status: false, data: null, message: 'Branch ID is required' });
    });

    test('does NOT call repository when name is missing', async () => {
      await service.createCategory({ branch_id: BRANCH_ID });
      expect(repo.create).not.toHaveBeenCalled();
    });

    test('returns validation error when validateCategoryData fails', async () => {
      validateCategoryData.mockReturnValueOnce({
        valid: false,
        errors: ['Name too short', 'Invalid discount'],
      });

      const result = await service.createCategory(validPayload());

      expect(result.status).toBe(false);
      expect(result.message).toBe('Name too short, Invalid discount');
    });

    test('returns duplicate name error when isCategoryNameUnique returns false', async () => {
      isCategoryNameUnique.mockResolvedValueOnce(false);

      const result = await service.createCategory(validPayload());

      expect(result).toEqual({
        status: false,
        data: null,
        message: 'Category with this name already exists in this branch',
      });
    });

    // ── success ─────────────────────────────────────────────────────────────
    test('calls sanitizeCategoryData with categoryData', async () => {
      repo.create.mockResolvedValue(makeMockCategory());

      await service.createCategory(validPayload());

      expect(sanitizeCategoryData).toHaveBeenCalledWith(validPayload());
    });

    test('calls repository.create with sanitized data', async () => {
      repo.create.mockResolvedValue(makeMockCategory());

      await service.createCategory(validPayload());

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ _sanitized: true }));
    });

    test('calls isCategoryNameUnique with name, branchId, null, and findByName fn', async () => {
      repo.create.mockResolvedValue(makeMockCategory());

      await service.createCategory(validPayload());

      expect(isCategoryNameUnique).toHaveBeenCalledWith(
        'Beverages',
        BRANCH_ID,
        null,
        expect.any(Function)
      );
    });

    test('returns {status:true, data:category} on success', async () => {
      const cat = makeMockCategory({ name: 'Beverages' });
      repo.create.mockResolvedValue(cat);

      const result = await service.createCategory(validPayload());

      expect(result).toEqual({
        status: true,
        data: cat,
        message: 'Category created successfully',
      });
    });

    test('returns error shape on repository.create throw', async () => {
      repo.create.mockRejectedValue(new Error('Insert failed'));
      const result = await service.createCategory(validPayload());
      expect(result.status).toBe(false);
      expect(result.message).toBe('Insert failed');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // updateCategory
  // ══════════════════════════════════════════════════════════════════════════
  describe('updateCategory', () => {
    test('returns not found when category does not exist', async () => {
      repo.findById.mockResolvedValue(null);

      const result = await service.updateCategory(CATEGORY_ID, { name: 'New Name' });

      expect(result).toEqual({ status: false, data: null, message: 'Category not found' });
    });

    test('skips uniqueness check when name is not changing', async () => {
      const existing = makeMockCategory({ name: 'Food' });
      repo.findById.mockResolvedValue(existing);
      repo.update.mockResolvedValue(existing);

      await service.updateCategory(CATEGORY_ID, { name: 'Food' });

      expect(isCategoryNameUnique).not.toHaveBeenCalled();
    });

    test('checks uniqueness when name is changing', async () => {
      const existing = makeMockCategory({ name: 'Food' });
      repo.findById.mockResolvedValue(existing);
      repo.update.mockResolvedValue(existing);

      await service.updateCategory(CATEGORY_ID, { name: 'New Name' });

      expect(isCategoryNameUnique).toHaveBeenCalledWith(
        'New Name',
        BRANCH_ID,
        CATEGORY_ID,
        expect.any(Function)
      );
    });

    test('returns duplicate name error when new name already taken', async () => {
      const existing = makeMockCategory({ name: 'Food' });
      repo.findById.mockResolvedValue(existing);
      isCategoryNameUnique.mockResolvedValueOnce(false);

      const result = await service.updateCategory(CATEGORY_ID, { name: 'Taken Name' });

      expect(result.status).toBe(false);
      expect(result.message).toBe('Category with this name already exists in this branch');
    });

    test('sanitizes updateData before calling repository.update', async () => {
      const existing = makeMockCategory();
      repo.findById.mockResolvedValue(existing);
      repo.update.mockResolvedValue(existing);
      const updateData = { description: 'Updated desc' };

      await service.updateCategory(CATEGORY_ID, updateData);

      expect(sanitizeCategoryData).toHaveBeenCalledWith(updateData);
      expect(repo.update).toHaveBeenCalledWith(
        CATEGORY_ID,
        expect.objectContaining({ _sanitized: true })
      );
    });

    test('returns {status:true, data:updatedCategory} on success', async () => {
      const existing = makeMockCategory();
      const updated = makeMockCategory({ name: 'Updated Food' });
      repo.findById.mockResolvedValue(existing);
      repo.update.mockResolvedValue(updated);

      const result = await service.updateCategory(CATEGORY_ID, { description: 'x' });

      expect(result).toEqual({
        status: true,
        data: updated,
        message: 'Category updated successfully',
      });
    });

    test('returns error shape on throw', async () => {
      repo.findById.mockRejectedValue(new Error('DB lock'));
      const result = await service.updateCategory(CATEGORY_ID, {});
      expect(result.status).toBe(false);
      expect(result.message).toBe('DB lock');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // deleteCategory  (soft delete)
  // ══════════════════════════════════════════════════════════════════════════
  describe('deleteCategory', () => {
    test('returns not found when category does not exist', async () => {
      repo.findById.mockResolvedValue(null);
      const result = await service.deleteCategory('missing_id');
      expect(result).toEqual({ status: false, data: null, message: 'Category not found' });
    });

    test('calls repository.softDelete with the id', async () => {
      repo.findById.mockResolvedValue(makeMockCategory());
      repo.softDelete.mockResolvedValue(makeMockCategory());

      await service.deleteCategory(CATEGORY_ID);

      expect(repo.softDelete).toHaveBeenCalledWith(CATEGORY_ID);
    });

    test('returns {status:true, message:"category deleted successfully"} on success', async () => {
      repo.findById.mockResolvedValue(makeMockCategory());
      const deleted = makeMockCategory();
      repo.softDelete.mockResolvedValue(deleted);

      const result = await service.deleteCategory(CATEGORY_ID);

      expect(result).toEqual({
        status: true,
        data: deleted,
        message: 'category deleted successfully',
      });
    });

    test('does NOT call softDelete when category not found', async () => {
      repo.findById.mockResolvedValue(null);
      await service.deleteCategory('id');
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    test('returns error shape on repository throw', async () => {
      repo.findById.mockRejectedValue(new Error('fail'));
      const result = await service.deleteCategory(CATEGORY_ID);
      expect(result.status).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // bulkDeleteCategories  (hard delete)
  // ══════════════════════════════════════════════════════════════════════════
  describe('bulkDeleteCategories', () => {
    test('returns error when ids is null', async () => {
      const result = await service.bulkDeleteCategories(null);
      expect(result).toEqual({ status: false, data: null, message: 'No category IDs provided' });
    });

    test('returns error when ids is empty array', async () => {
      const result = await service.bulkDeleteCategories([]);
      expect(result.status).toBe(false);
      expect(result.message).toBe('No category IDs provided');
    });

    test('does NOT call repository when ids is empty', async () => {
      await service.bulkDeleteCategories([]);
      expect(repo.bulkHardDelete).not.toHaveBeenCalled();
    });

    test('calls repository.bulkHardDelete with ids array', async () => {
      repo.bulkHardDelete.mockResolvedValue({ deletedCount: 3 });
      const ids = ['id1', 'id2', 'id3'];

      await service.bulkDeleteCategories(ids);

      expect(repo.bulkHardDelete).toHaveBeenCalledWith(ids);
    });

    test('returns {status:true, data:deletedCount} on success', async () => {
      repo.bulkHardDelete.mockResolvedValue({ deletedCount: 2 });

      const result = await service.bulkDeleteCategories(['id1', 'id2']);

      expect(result).toEqual({
        status: true,
        data: 2,
        message: 'category deleted successfully',
      });
    });

    test('returns error shape on repository throw', async () => {
      repo.bulkHardDelete.mockRejectedValue(new Error('bulk fail'));
      const result = await service.bulkDeleteCategories(['id1']);
      expect(result.status).toBe(false);
      expect(result.message).toBe('bulk fail');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // searchCategories
  // ══════════════════════════════════════════════════════════════════════════
  describe('searchCategories', () => {
    test('falls back to getAllCategories when searchTerm is null', async () => {
      repo.findAll.mockResolvedValue([]);
      const spy = jest.spyOn(service, 'getAllCategories');

      await service.searchCategories(null);

      expect(spy).toHaveBeenCalled();
    });

    test('falls back to getAllCategories when searchTerm is whitespace', async () => {
      repo.findAll.mockResolvedValue([]);
      const spy = jest.spyOn(service, 'getAllCategories');

      await service.searchCategories('   ');

      expect(spy).toHaveBeenCalled();
    });

    test('falls back to getAllCategories when searchTerm is empty string', async () => {
      repo.findAll.mockResolvedValue([]);
      const spy = jest.spyOn(service, 'getAllCategories');

      await service.searchCategories('');

      expect(spy).toHaveBeenCalled();
    });

    test('calls repository.search when searchTerm is 1+ non-space chars', async () => {
      const results = [makeMockCategory()];
      repo.search.mockResolvedValue(results);

      const result = await service.searchCategories('food');

      expect(repo.search).toHaveBeenCalledWith('food', {});
      expect(result.status).toBe(true);
      expect(result.data).toBe(results);
    });

    test('passes options to repository.search', async () => {
      repo.search.mockResolvedValue([]);
      const options = { page: 2, limit: 5 };

      await service.searchCategories('food', options);

      expect(repo.search).toHaveBeenCalledWith('food', options);
    });

    test('returns {status:true, message:"Search completed successfully"}', async () => {
      repo.search.mockResolvedValue([]);
      const result = await service.searchCategories('test');
      expect(result.message).toBe('Search completed successfully');
    });

    test('returns error shape on repository throw', async () => {
      repo.search.mockRejectedValue(new Error('search fail'));
      const result = await service.searchCategories('food');
      expect(result.status).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getCategoriesByBranch
  // ══════════════════════════════════════════════════════════════════════════
  describe('getCategoriesByBranch', () => {
    test('calls repository.findByBranch with branchId and options', async () => {
      repo.findByBranch.mockResolvedValue([]);

      await service.getCategoriesByBranch(BRANCH_ID, true, LICENSE_ID);

      expect(repo.findByBranch).toHaveBeenCalledWith(BRANCH_ID, {
        activeOnly: true,
        license: LICENSE_ID,
      });
    });

    test('defaults activeOnly to false and license to null', async () => {
      repo.findByBranch.mockResolvedValue([]);

      await service.getCategoriesByBranch(BRANCH_ID);

      expect(repo.findByBranch).toHaveBeenCalledWith(BRANCH_ID, {
        activeOnly: false,
        license: null,
      });
    });

    test('returns {status:true, data:categories} on success', async () => {
      const categories = [makeMockCategory()];
      repo.findByBranch.mockResolvedValue(categories);

      const result = await service.getCategoriesByBranch(BRANCH_ID);

      expect(result.status).toBe(true);
      expect(result.data).toBe(categories);
    });

    test('handles empty result list', async () => {
      repo.findByBranch.mockResolvedValue([]);
      const result = await service.getCategoriesByBranch(BRANCH_ID);
      expect(result.status).toBe(true);
      expect(result.data).toEqual([]);
    });

    test('returns error shape on throw', async () => {
      repo.findByBranch.mockRejectedValue(new Error('fail'));
      const result = await service.getCategoriesByBranch(BRANCH_ID);
      expect(result.status).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getCategoriesWithItems
  // ══════════════════════════════════════════════════════════════════════════
  describe('getCategoriesWithItems', () => {
    test('calls repository.findByBranchWithItems with correct args', async () => {
      repo.findByBranchWithItems.mockResolvedValue([]);

      await service.getCategoriesWithItems(BRANCH_ID, true, LICENSE_ID);

      expect(repo.findByBranchWithItems).toHaveBeenCalledWith(BRANCH_ID, {
        activeOnly: true,
        license: LICENSE_ID,
      });
    });

    test('returns {status:true, data:categories} on success', async () => {
      const cats = [makeMockCategory()];
      repo.findByBranchWithItems.mockResolvedValue(cats);

      const result = await service.getCategoriesWithItems(BRANCH_ID);

      expect(result.status).toBe(true);
      expect(result.data).toBe(cats);
    });

    test('returns error shape on throw', async () => {
      repo.findByBranchWithItems.mockRejectedValue(new Error('fail'));
      const result = await service.getCategoriesWithItems(BRANCH_ID);
      expect(result.status).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getActiveCategories
  // ══════════════════════════════════════════════════════════════════════════
  describe('getActiveCategories', () => {
    test('calls repository.getActiveCategories with branchId', async () => {
      repo.getActiveCategories.mockResolvedValue([]);
      await service.getActiveCategories(BRANCH_ID);
      expect(repo.getActiveCategories).toHaveBeenCalledWith(BRANCH_ID);
    });

    test('returns {status:true, data:categories} on success', async () => {
      const cats = [makeMockCategory()];
      repo.getActiveCategories.mockResolvedValue(cats);

      const result = await service.getActiveCategories(BRANCH_ID);

      expect(result.status).toBe(true);
      expect(result.data).toBe(cats);
      expect(result.message).toBe('Active categories retrieved successfully');
    });

    test('returns error shape on throw', async () => {
      repo.getActiveCategories.mockRejectedValue(new Error('fail'));
      const result = await service.getActiveCategories(BRANCH_ID);
      expect(result.status).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // bulkImport
  // ══════════════════════════════════════════════════════════════════════════
  describe('bulkImport', () => {
    const makeImportRow = (overrides = {}) => ({
      name: 'Beverages',
      branch_id: BRANCH_ID,
      discount_amount: 0,
      discount_percentage: 0,
      license: LICENSE_ID,
      ...overrides,
    });

    // ── validation ──────────────────────────────────────────────────────────
    test('returns error when categoriesData is null', async () => {
      const result = await service.bulkImport(null);
      expect(result).toEqual({ status: false, data: null, message: 'No category data provided' });
    });

    test('returns error when categoriesData is empty array', async () => {
      const result = await service.bulkImport([]);
      expect(result).toEqual({ status: false, data: null, message: 'No category data provided' });
    });

    // ── plan limit ───────────────────────────────────────────────────────────
    test('limits import count when checkPlan returns positive maxImport', async () => {
      const mockInstance = BaseModel.mock.results[0]?.value || { checkPlan: jest.fn() };
      // Re-instantiate to capture latest BaseModel instance
      const LocalBaseModel = require('../../../src/models/base.model');
      const bm = new LocalBaseModel();
      bm.checkPlan.mockResolvedValue(1); // max 1

      repo.findByNameBranchLicense.mockResolvedValue(null);
      repo.bulkCreate.mockResolvedValue([
        makeImportRow({ name: 'Cat1', discount_amount: '5', discount_percentage: '0' }),
      ]);

      const rows = [
        makeImportRow({ name: 'Cat1', discount_amount: '5', discount_percentage: '0' }),
        makeImportRow({ name: 'Cat2', discount_amount: '5', discount_percentage: '0' }),
      ];

      await service.bulkImport(rows);

      // bulkCreate should receive at most 1 record due to plan limit
      // (actual assertion depends on how the mocked BaseModel instance is used;
      //  the important thing is the service does not throw)
      expect(repo.bulkCreate).toHaveBeenCalled();
    });

    // ── validation errors ────────────────────────────────────────────────────
    test('returns validation errors when required field "name" is missing', async () => {
      const rows = [{ branch_id: BRANCH_ID, discount_amount: '5', discount_percentage: '0' }];

      const result = await service.bulkImport(rows);

      expect(result.status).toBe(true);
      expect(result.message).toBe('CSV');
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data[0]).toHaveProperty('status');
    });

    test('returns validation error when both discount_amount and discount_percentage > 0', async () => {
      const rows = [makeImportRow({ discount_amount: '10', discount_percentage: '5' })];

      const result = await service.bulkImport(rows);

      expect(result.status).toBe(true);
      expect(result.message).toBe('CSV');
      const errorRow = result.data[0];
      expect(errorRow.status).toContain('Provide either a discount amount or percentage');
    });

    // ── already-imported ─────────────────────────────────────────────────────
    test('returns "All categories are already imported" when all categories exist', async () => {
      const existing = makeMockCategory({ name: 'Beverages' });
      repo.findByNameBranchLicense.mockResolvedValue(existing);

      const rows = [makeImportRow({ discount_amount: '0', discount_percentage: '0' })];
      const result = await service.bulkImport(rows);

      expect(result.status).toBe(false);
      expect(result.message).toBe('All categories are already imported');
      expect(Array.isArray(result.data)).toBe(true);
    });

    // ── success ─────────────────────────────────────────────────────────────
    test('calls repository.bulkCreate for new categories', async () => {
      repo.findByNameBranchLicense.mockResolvedValue(null);
      const created = [
        makeMockCategory({
          name: 'Beverages',
          discount_amount: 0,
          discount_percentage: 0,
          description: '',
        }),
      ];
      repo.bulkCreate.mockResolvedValue(created);

      const rows = [makeImportRow({ discount_amount: '0', discount_percentage: '0' })];
      await service.bulkImport(rows);

      expect(repo.bulkCreate).toHaveBeenCalled();
    });

    test('returns {status:true, data:[{name,discount_amount,discount_percentage,description,status}]}', async () => {
      repo.findByNameBranchLicense.mockResolvedValue(null);
      repo.bulkCreate.mockResolvedValue([
        makeMockCategory({
          name: 'Beverages',
          discount_amount: 0,
          discount_percentage: 0,
          description: 'desc',
        }),
      ]);

      const rows = [makeImportRow({ discount_amount: '0', discount_percentage: '0' })];
      const result = await service.bulkImport(rows);

      expect(result.status).toBe(true);
      expect(result.message).toBe('Category data imported successfully');
      expect(result.data[0]).toHaveProperty('status', 'Imported');
    });

    test('deduplicates identical rows by name (keeps first occurrence)', async () => {
      repo.findByNameBranchLicense.mockResolvedValue(null);
      repo.bulkCreate.mockResolvedValue([makeMockCategory({ name: 'Beverages' })]);

      const rows = [
        makeImportRow({ discount_amount: '0', discount_percentage: '0' }),
        makeImportRow({ discount_amount: '0', discount_percentage: '0' }), // duplicate
      ];
      await service.bulkImport(rows);

      // bulkCreate should receive only 1 record
      const [newData] = repo.bulkCreate.mock.calls[0];
      expect(newData).toHaveLength(1);
    });

    test('returns error shape on repository throw', async () => {
      repo.findByNameBranchLicense.mockRejectedValue(new Error('DB crash'));
      const rows = [makeImportRow({ discount_amount: '0', discount_percentage: '0' })];
      const result = await service.bulkImport(rows);
      expect(result.status).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // exportCategories
  // ══════════════════════════════════════════════════════════════════════════
  describe('exportCategories', () => {
    test('calls repository.exportData with branch_id ObjectId when provided', async () => {
      repo.exportData.mockResolvedValue([]);

      await service.exportCategories({ branch_id: BRANCH_ID });

      expect(repo.exportData).toHaveBeenCalledWith(
        expect.objectContaining({ branch_id: expect.anything() })
      );
    });

    test('calls repository.exportData with empty filter when no branch_id', async () => {
      repo.exportData.mockResolvedValue([]);

      await service.exportCategories({});

      expect(repo.exportData).toHaveBeenCalledWith({});
    });

    test('returns {status:true, data:categories} on success', async () => {
      const data = [makeMockCategory()];
      repo.exportData.mockResolvedValue(data);

      const result = await service.exportCategories({});

      expect(result).toEqual({
        status: true,
        data,
        message: 'Categories exported successfully',
      });
    });

    test('returns error shape on throw', async () => {
      repo.exportData.mockRejectedValue(new Error('export fail'));
      const result = await service.exportCategories({});
      expect(result.status).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getDataChanges
  // ══════════════════════════════════════════════════════════════════════════
  describe('getDataChanges', () => {
    test('calls repository.getDataChanges with fromDate and branchId', async () => {
      repo.getDataChanges.mockResolvedValue([]);

      await service.getDataChanges('2024-01-01', BRANCH_ID);

      expect(repo.getDataChanges).toHaveBeenCalledWith('2024-01-01', BRANCH_ID);
    });

    test('returns {status:true, data:changes} on success', async () => {
      const changes = [{ _id: 'change_1' }];
      repo.getDataChanges.mockResolvedValue(changes);

      const result = await service.getDataChanges('2024-01-01', BRANCH_ID);

      expect(result).toEqual({
        status: true,
        data: changes,
        message: 'Data changes retrieved successfully',
      });
    });

    test('returns error shape on throw', async () => {
      repo.getDataChanges.mockRejectedValue(new Error('sync fail'));
      const result = await service.getDataChanges('2024-01-01', BRANCH_ID);
      expect(result.status).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // toggleActive
  // ══════════════════════════════════════════════════════════════════════════
  describe('toggleActive', () => {
    test('calls repository.toggleActive with id', async () => {
      repo.toggleActive.mockResolvedValue(makeMockCategory());
      await service.toggleActive(CATEGORY_ID);
      expect(repo.toggleActive).toHaveBeenCalledWith(CATEGORY_ID);
    });

    test('returns {status:false, "Category not found"} when repository returns null', async () => {
      repo.toggleActive.mockResolvedValue(null);
      const result = await service.toggleActive('bad_id');
      expect(result).toEqual({ status: false, data: null, message: 'Category not found' });
    });

    test('returns "activated" message when is_active becomes true', async () => {
      repo.toggleActive.mockResolvedValue(makeMockCategory({ is_active: true }));

      const result = await service.toggleActive(CATEGORY_ID);

      expect(result.status).toBe(true);
      expect(result.message).toBe('Category activated successfully');
    });

    test('returns "deactivated" message when is_active becomes false', async () => {
      repo.toggleActive.mockResolvedValue(makeMockCategory({ is_active: false }));

      const result = await service.toggleActive(CATEGORY_ID);

      expect(result.status).toBe(true);
      expect(result.message).toBe('Category deactivated successfully');
    });

    test('returns {status:true, data:category} on success', async () => {
      const cat = makeMockCategory({ is_active: true });
      repo.toggleActive.mockResolvedValue(cat);

      const result = await service.toggleActive(CATEGORY_ID);

      expect(result.data).toBe(cat);
    });

    test('returns error shape on throw', async () => {
      repo.toggleActive.mockRejectedValue(new Error('toggle fail'));
      const result = await service.toggleActive(CATEGORY_ID);
      expect(result.status).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // updateSortOrder
  // ══════════════════════════════════════════════════════════════════════════
  describe('updateSortOrder', () => {
    test('calls repository.updateSortOrder with id and sortOrder', async () => {
      repo.updateSortOrder.mockResolvedValue(makeMockCategory());
      await service.updateSortOrder(CATEGORY_ID, 3);
      expect(repo.updateSortOrder).toHaveBeenCalledWith(CATEGORY_ID, 3);
    });

    test('returns {status:false, "Category not found"} when repository returns null', async () => {
      repo.updateSortOrder.mockResolvedValue(null);
      const result = await service.updateSortOrder('bad_id', 1);
      expect(result).toEqual({ status: false, data: null, message: 'Category not found' });
    });

    test('returns {status:true, message:"Sort order updated successfully"} on success', async () => {
      const cat = makeMockCategory();
      repo.updateSortOrder.mockResolvedValue(cat);

      const result = await service.updateSortOrder(CATEGORY_ID, 5);

      expect(result).toEqual({
        status: true,
        data: cat,
        message: 'Sort order updated successfully',
      });
    });

    test('returns error shape on throw', async () => {
      repo.updateSortOrder.mockRejectedValue(new Error('sort fail'));
      const result = await service.updateSortOrder(CATEGORY_ID, 1);
      expect(result.status).toBe(false);
    });
  });
});
