'use strict';

/**
 * Unit tests for src/services/customer-category.service.js
 *
 * File confirmed : src/services/customer-category.service.js (376 lines)
 * Export type    : CLASS export — `module.exports = CustomerCategoryService`
 *                  (Same pattern as category.service.js — controller creates instances)
 * Does NOT extend base.service.js.
 *
 * Similarly-named files checked:
 *   src/services/customer-category.service.js  ← THIS FILE (active, used by controllers)
 *   No customerCategory.service.js or customer-categories.service.js found.
 *
 * Constructor : `this.repository = new CustomerCategoryRepository()`
 *
 * Methods (7):
 *   getAllCustomerCategories(filters, options)
 *   getCustomerCategoryById(id)
 *   createCustomerCategory(categoryData)
 *   updateCustomerCategory(id, updateData)
 *   deleteCustomerCategory(id)          — soft delete, checks deletedCount === 0
 *   deleteCustomerCategories(ids)       — bulk soft delete, no ID validation
 *   bulkImport(categoriesData)          — per-record create (not bulkCreate)
 *
 * External dependencies (all mocked):
 *   CustomerCategoryRepository (class)  — mocked per-test via jest.mock factory
 *   mongodb.ObjectId                    — mocked (used in getAllCustomerCategories)
 *
 * Key differences from category.service.js:
 *   - Uses `mongodb.ObjectId` (not `mongoose.Types.ObjectId`)
 *   - No BaseModel, no categories.helper
 *   - `deleteCustomerCategory` does NOT do a findById pre-check — it relies on
 *     `repository.softDelete` returning deletedCount === 0 to detect not-found
 *   - `updateCustomerCategory` duplicate check compares `duplicate._id.toString() !== id`
 *     to allow a record to keep its own name without triggering duplicate error
 *   - `bulkImport` creates records one-by-one (no bulkCreate)
 *   - `deleteCustomerCategories` has NO empty/null ids validation
 *
 * PRODUCTION NOTES:
 *   1. `deleteCustomerCategories(ids)` has no input validation — passing null/undefined
 *      ids will propagate to the repository without any error guard.
 *   2. `bulkImport` iterates `categoriesData` without checking if it is null/empty —
 *      calling `bulkImport(null)` or `bulkImport([])` will throw/loop silently (a
 *      for-of on null throws TypeError; on [] returns success with empty insertedRecords).
 *   3. `getAllCustomerCategories` date filter uses `new Date(str.trim())` directly
 *      instead of a timezone-aware parser — different from category.service.js which uses
 *      BaseModel.startingDate/endingDate for correct timezone handling.
 *   4. `console.error` used throughout instead of the project's structured logger.
 *   5. Name lookahead regex parsing ($and push) in `getAllCustomerCategories` is
 *      complex and untested in the original codebase — edge cases may silently miss results.
 */

// ─── Mock CustomerCategoryRepository (class — explicit factory) ───────────────
jest.mock('../../../src/repositories/customer-category.repository', () => jest.fn());

// ─── Mock mongodb ObjectId ────────────────────────────────────────────────────
jest.mock('mongodb', () => ({
  ObjectId: jest.fn().mockImplementation((id) => ({
    _mockedId: id,
    toString: () => String(id),
  })),
}));

// ─── Requires ─────────────────────────────────────────────────────────────────
const CustomerCategoryRepository = require('../../../src/repositories/customer-category.repository');
const { ObjectId } = require('mongodb');
const CustomerCategoryService = require('../../../src/services/customer-category.service');

// ─── Mock data ────────────────────────────────────────────────────────────────
const BRANCH_ID = '64a1b2c3d4e5f6a7b8c9d001';
const CATEGORY_ID = '64a1b2c3d4e5f6a7b8c9d002';
const OTHER_ID = '64a1b2c3d4e5f6a7b8c9d003';

function makeMockCategory(overrides = {}) {
  return {
    _id: CATEGORY_ID,
    name: 'Retail Customer',
    description: 'Retail customers',
    branch_id: BRANCH_ID,
    is_active: true,
    ...overrides,
  };
}

function makeRepoMethods(overrides = {}) {
  return {
    findAll: jest.fn(),
    findById: jest.fn(),
    findByName: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    softDeleteMany: jest.fn(),
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
describe('CustomerCategoryService', () => {
  let service;
  let repo;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const repoMethods = makeRepoMethods();
    CustomerCategoryRepository.mockImplementation(() => repoMethods);
    service = new CustomerCategoryService();
    repo = service.repository;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Service initialization
  // ══════════════════════════════════════════════════════════════════════════
  describe('initialization', () => {
    test('CustomerCategoryService exports a class (not a singleton)', () => {
      expect(typeof CustomerCategoryService).toBe('function');
    });

    test('new CustomerCategoryService() creates instance with repository', () => {
      expect(service.repository).toBeDefined();
    });

    test('instantiates CustomerCategoryRepository in constructor', () => {
      expect(CustomerCategoryRepository).toHaveBeenCalledTimes(1);
    });

    test('exposes all 7 service methods', () => {
      const methods = [
        'getAllCustomerCategories',
        'getCustomerCategoryById',
        'createCustomerCategory',
        'updateCustomerCategory',
        'deleteCustomerCategory',
        'deleteCustomerCategories',
        'bulkImport',
      ];
      methods.forEach((m) => expect(typeof service[m]).toBe('function'));
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getAllCustomerCategories
  // ══════════════════════════════════════════════════════════════════════════
  describe('getAllCustomerCategories', () => {
    // ── success ─────────────────────────────────────────────────────────────
    test('returns {status:true, data, message} on success with no filters', async () => {
      const data = [makeMockCategory()];
      repo.findAll.mockResolvedValue(data);

      const result = await service.getAllCustomerCategories();

      expect(result).toEqual({
        status: true,
        data,
        message: 'Customer categories retrieved successfully',
      });
    });

    test('passes built queryFilters and options to repository.findAll', async () => {
      repo.findAll.mockResolvedValue([]);
      const options = { page: 1, limit: 10 };

      await service.getAllCustomerCategories({ branch_id: BRANCH_ID }, options);

      expect(repo.findAll).toHaveBeenCalledWith(expect.any(Object), options);
    });

    // ── filters ──────────────────────────────────────────────────────────────
    test('coerces branch_id to ObjectId in queryFilters', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCustomerCategories({ branch_id: BRANCH_ID });

      expect(ObjectId).toHaveBeenCalledWith(BRANCH_ID);
      const [qf] = repo.findAll.mock.calls[0];
      expect(qf.branch_id).toBeDefined();
    });

    test('does not set branch_id filter when not provided', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCustomerCategories({});

      const [qf] = repo.findAll.mock.calls[0];
      expect(qf.branch_id).toBeUndefined();
    });

    test('applies name string as case-insensitive $regex filter', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCustomerCategories({ name: 'retail' });

      const [qf] = repo.findAll.mock.calls[0];
      expect(qf.name).toEqual({ $regex: 'retail', $options: 'i' });
    });

    test('applies name.$regex object filter (simple pattern, no lookahead)', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCustomerCategories({ name: { $regex: 'retail', $options: 'i' } });

      const [qf] = repo.findAll.mock.calls[0];
      expect(qf.name).toEqual({ $regex: 'retail', $options: 'i' });
    });

    test('converts lookahead name pattern to $and conditions', async () => {
      repo.findAll.mockResolvedValue([]);
      const lookahead = '(?=.*service)(?=.*man)';

      await service.getAllCustomerCategories({ name: { $regex: lookahead } });

      const [qf] = repo.findAll.mock.calls[0];
      expect(Array.isArray(qf.$and)).toBe(true);
      expect(qf.$and.length).toBeGreaterThanOrEqual(2);
      expect(qf.name).toBeUndefined();
    });

    test('applies description string as $regex filter', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCustomerCategories({ description: 'retail' });

      const [qf] = repo.findAll.mock.calls[0];
      expect(qf.description).toBeInstanceOf(RegExp);
    });

    test('applies description.$regex object filter', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCustomerCategories({ description: { $regex: 'retail', $options: 'i' } });

      const [qf] = repo.findAll.mock.calls[0];
      expect(qf.description).toHaveProperty('$regex');
    });

    test('applies $or search filter when search provided (no name/description)', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCustomerCategories({ search: 'retail' });

      const [qf] = repo.findAll.mock.calls[0];
      expect(qf.$or).toBeDefined();
      expect(qf.$or).toHaveLength(2);
    });

    test('does NOT apply $or search when name filter is also present', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCustomerCategories({ search: 'retail', name: 'retail' });

      const [qf] = repo.findAll.mock.calls[0];
      expect(qf.$or).toBeUndefined();
    });

    test('applies updated_date.$gte as Date object', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCustomerCategories({ updated_date: { $gte: '2024-01-01' } });

      const [qf] = repo.findAll.mock.calls[0];
      expect(qf.updated_date.$gte).toBeInstanceOf(Date);
    });

    test('applies updated_date.$lte as Date object', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCustomerCategories({ updated_date: { $lte: '2024-01-31' } });

      const [qf] = repo.findAll.mock.calls[0];
      expect(qf.updated_date.$lte).toBeInstanceOf(Date);
    });

    test('skips updated_date.$gte when date string is invalid', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCustomerCategories({ updated_date: { $gte: 'not-a-date' } });

      const [qf] = repo.findAll.mock.calls[0];
      if (qf.updated_date) {
        expect(qf.updated_date.$gte).toBeUndefined();
      }
    });

    test('applies created_date.$gte and $lte filters', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCustomerCategories({
        created_date: { $gte: '2024-01-01', $lte: '2024-01-31' },
      });

      const [qf] = repo.findAll.mock.calls[0];
      expect(qf.created_date.$gte).toBeInstanceOf(Date);
      expect(qf.created_date.$lte).toBeInstanceOf(Date);
    });

    test('handles empty result list', async () => {
      repo.findAll.mockResolvedValue([]);
      const result = await service.getAllCustomerCategories();
      expect(result.status).toBe(true);
      expect(result.data).toEqual([]);
    });

    // ── error handling ────────────────────────────────────────────────────────
    test('returns {status:false, message} on repository error', async () => {
      repo.findAll.mockRejectedValue(new Error('DB timeout'));
      const result = await service.getAllCustomerCategories();
      expect(result).toEqual({ status: false, data: null, message: 'DB timeout' });
    });

    test('does not re-throw on repository error', async () => {
      repo.findAll.mockRejectedValue(new Error('fail'));
      await expect(service.getAllCustomerCategories()).resolves.not.toThrow();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getCustomerCategoryById
  // ══════════════════════════════════════════════════════════════════════════
  describe('getCustomerCategoryById', () => {
    test('returns {status:true, data:category} when found', async () => {
      const cat = makeMockCategory();
      repo.findById.mockResolvedValue(cat);

      const result = await service.getCustomerCategoryById(CATEGORY_ID);

      expect(result).toEqual({
        status: true,
        data: cat,
        message: 'Customer category retrieved successfully',
      });
    });

    test('returns {status:false, "Customer category not found"} when null', async () => {
      repo.findById.mockResolvedValue(null);
      const result = await service.getCustomerCategoryById('missing');
      expect(result).toEqual({
        status: false,
        data: null,
        message: 'Customer category not found',
      });
    });

    test('calls repository.findById with the provided id', async () => {
      repo.findById.mockResolvedValue(makeMockCategory());
      await service.getCustomerCategoryById(CATEGORY_ID);
      expect(repo.findById).toHaveBeenCalledWith(CATEGORY_ID);
    });

    test('returns error shape on repository throw', async () => {
      repo.findById.mockRejectedValue(new Error('Query failed'));
      const result = await service.getCustomerCategoryById(CATEGORY_ID);
      expect(result.status).toBe(false);
      expect(result.message).toBe('Query failed');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // createCustomerCategory
  // ══════════════════════════════════════════════════════════════════════════
  describe('createCustomerCategory', () => {
    const validPayload = () => ({
      name: 'Wholesale',
      branch_id: BRANCH_ID,
    });

    // ── validation ──────────────────────────────────────────────────────────
    test('returns error when name is missing', async () => {
      const result = await service.createCustomerCategory({ branch_id: BRANCH_ID });
      expect(result).toEqual({
        status: false,
        data: null,
        message: 'Customer category name is required',
      });
    });

    test('returns error when name is empty string', async () => {
      const result = await service.createCustomerCategory({ name: '', branch_id: BRANCH_ID });
      expect(result.status).toBe(false);
      expect(result.message).toBe('Customer category name is required');
    });

    test('returns error when branch_id is missing', async () => {
      const result = await service.createCustomerCategory({ name: 'Wholesale' });
      expect(result).toEqual({
        status: false,
        data: null,
        message: 'Branch ID is required',
      });
    });

    test('does NOT call repository when name is missing', async () => {
      await service.createCustomerCategory({ branch_id: BRANCH_ID });
      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.findByName).not.toHaveBeenCalled();
    });

    // ── duplicate check ──────────────────────────────────────────────────────
    test('checks for duplicate name via repository.findByName', async () => {
      repo.findByName.mockResolvedValue(null);
      repo.create.mockResolvedValue(makeMockCategory());

      await service.createCustomerCategory(validPayload());

      expect(repo.findByName).toHaveBeenCalledWith('Wholesale', BRANCH_ID);
    });

    test('returns duplicate error when name already exists in branch', async () => {
      repo.findByName.mockResolvedValue(makeMockCategory({ name: 'Wholesale' }));

      const result = await service.createCustomerCategory(validPayload());

      expect(result).toEqual({
        status: false,
        data: null,
        message: 'This category details already exist in our system',
      });
    });

    test('does NOT call repository.create when duplicate exists', async () => {
      repo.findByName.mockResolvedValue(makeMockCategory());
      await service.createCustomerCategory(validPayload());
      expect(repo.create).not.toHaveBeenCalled();
    });

    // ── success ─────────────────────────────────────────────────────────────
    test('calls repository.create with categoryData when no duplicate', async () => {
      repo.findByName.mockResolvedValue(null);
      const cat = makeMockCategory({ name: 'Wholesale' });
      repo.create.mockResolvedValue(cat);

      await service.createCustomerCategory(validPayload());

      expect(repo.create).toHaveBeenCalledWith(validPayload());
    });

    test('returns {status:true, data:category} on success', async () => {
      repo.findByName.mockResolvedValue(null);
      const cat = makeMockCategory({ name: 'Wholesale' });
      repo.create.mockResolvedValue(cat);

      const result = await service.createCustomerCategory(validPayload());

      expect(result).toEqual({
        status: true,
        data: cat,
        message: 'Customer category created successfully',
      });
    });

    test('returns error shape on repository.create throw', async () => {
      repo.findByName.mockResolvedValue(null);
      repo.create.mockRejectedValue(new Error('Insert failed'));
      const result = await service.createCustomerCategory(validPayload());
      expect(result.status).toBe(false);
      expect(result.message).toBe('Insert failed');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // updateCustomerCategory
  // ══════════════════════════════════════════════════════════════════════════
  describe('updateCustomerCategory', () => {
    const existing = () => makeMockCategory({ _id: CATEGORY_ID, name: 'Old Name' });

    test('returns {status:false, "Customer category not found"} when category missing', async () => {
      repo.findById.mockResolvedValue(null);
      const result = await service.updateCustomerCategory(CATEGORY_ID, { name: 'New' });
      expect(result).toEqual({ status: false, data: null, message: 'Customer category not found' });
    });

    test('does NOT call update when category not found', async () => {
      repo.findById.mockResolvedValue(null);
      await service.updateCustomerCategory(CATEGORY_ID, {});
      expect(repo.update).not.toHaveBeenCalled();
    });

    // ── name uniqueness check ────────────────────────────────────────────────
    test('skips duplicate check when name is not provided in updateData', async () => {
      repo.findById.mockResolvedValue(existing());
      repo.update.mockResolvedValue(existing());

      await service.updateCustomerCategory(CATEGORY_ID, { description: 'Changed' });

      expect(repo.findByName).not.toHaveBeenCalled();
    });

    test('skips duplicate check when name is unchanged', async () => {
      repo.findById.mockResolvedValue(existing());
      repo.update.mockResolvedValue(existing());

      await service.updateCustomerCategory(CATEGORY_ID, { name: 'Old Name' });

      expect(repo.findByName).not.toHaveBeenCalled();
    });

    test('checks duplicate when name is changing', async () => {
      repo.findById.mockResolvedValue(existing());
      repo.findByName.mockResolvedValue(null);
      repo.update.mockResolvedValue(existing());

      await service.updateCustomerCategory(CATEGORY_ID, { name: 'New Name' });

      expect(repo.findByName).toHaveBeenCalledWith('New Name', BRANCH_ID);
    });

    test('returns duplicate error when different record has the same new name', async () => {
      repo.findById.mockResolvedValue(existing());
      // Duplicate is a DIFFERENT document
      repo.findByName.mockResolvedValue({
        _id: { toString: () => OTHER_ID },
        name: 'New Name',
        branch_id: BRANCH_ID,
      });

      const result = await service.updateCustomerCategory(CATEGORY_ID, { name: 'New Name' });

      expect(result).toEqual({
        status: false,
        data: null,
        message: 'This category details already exist in our system',
      });
    });

    test('allows update when duplicate._id matches the same record (own name)', async () => {
      repo.findById.mockResolvedValue(existing());
      // findByName returns the SAME document (e.g. partial match with same id)
      repo.findByName.mockResolvedValue({
        _id: { toString: () => CATEGORY_ID },
        name: 'New Name',
        branch_id: BRANCH_ID,
      });
      repo.update.mockResolvedValue({ ...existing(), name: 'New Name' });

      const result = await service.updateCustomerCategory(CATEGORY_ID, { name: 'New Name' });

      expect(result.status).toBe(true);
    });

    // ── update result checks ──────────────────────────────────────────────────
    test('returns {status:false, "Failed to update"} when repository.update returns null', async () => {
      repo.findById.mockResolvedValue(existing());
      repo.update.mockResolvedValue(null);

      const result = await service.updateCustomerCategory(CATEGORY_ID, { description: 'x' });

      expect(result).toEqual({
        status: false,
        data: null,
        message: 'Failed to update customer category',
      });
    });

    test('returns {status:true, data:updatedCategory} on success', async () => {
      repo.findById.mockResolvedValue(existing());
      const updated = makeMockCategory({ name: 'Updated Name' });
      repo.update.mockResolvedValue(updated);

      const result = await service.updateCustomerCategory(CATEGORY_ID, { description: 'x' });

      expect(result).toEqual({
        status: true,
        data: updated,
        message: 'Customer category updated successfully',
      });
    });

    test('calls repository.update with id and updateData', async () => {
      repo.findById.mockResolvedValue(existing());
      repo.update.mockResolvedValue(existing());
      const updateData = { description: 'New desc' };

      await service.updateCustomerCategory(CATEGORY_ID, updateData);

      expect(repo.update).toHaveBeenCalledWith(CATEGORY_ID, updateData);
    });

    test('returns error shape on throw', async () => {
      repo.findById.mockRejectedValue(new Error('DB lock'));
      const result = await service.updateCustomerCategory(CATEGORY_ID, {});
      expect(result.status).toBe(false);
      expect(result.message).toBe('DB lock');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // deleteCustomerCategory
  // ══════════════════════════════════════════════════════════════════════════
  describe('deleteCustomerCategory', () => {
    test('calls repository.softDelete with id', async () => {
      repo.softDelete.mockResolvedValue(1);
      await service.deleteCustomerCategory(CATEGORY_ID);
      expect(repo.softDelete).toHaveBeenCalledWith(CATEGORY_ID);
    });

    test('returns {status:false, "Customer category not found"} when deletedCount is 0', async () => {
      repo.softDelete.mockResolvedValue(0);
      const result = await service.deleteCustomerCategory('missing_id');
      expect(result).toEqual({ status: false, data: null, message: 'Customer category not found' });
    });

    test('returns {status:true, data:{deletedCount:1}} on success', async () => {
      repo.softDelete.mockResolvedValue(1);
      const result = await service.deleteCustomerCategory(CATEGORY_ID);
      expect(result).toEqual({
        status: true,
        data: { deletedCount: 1 },
        message: 'Customer category deleted successfully',
      });
    });

    test('detects not-found via deletedCount instead of findById pre-check', async () => {
      // Unlike category.service, this service does NOT call findById first
      repo.softDelete.mockResolvedValue(0);
      await service.deleteCustomerCategory('bad_id');
      expect(repo.findById).not.toHaveBeenCalled();
    });

    test('returns error shape on repository throw', async () => {
      repo.softDelete.mockRejectedValue(new Error('Delete failed'));
      const result = await service.deleteCustomerCategory(CATEGORY_ID);
      expect(result.status).toBe(false);
      expect(result.message).toBe('Delete failed');
    });

    test('does not re-throw on error', async () => {
      repo.softDelete.mockRejectedValue(new Error('crash'));
      await expect(service.deleteCustomerCategory(CATEGORY_ID)).resolves.not.toThrow();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // deleteCustomerCategories (bulk soft delete)
  // ══════════════════════════════════════════════════════════════════════════
  describe('deleteCustomerCategories', () => {
    test('calls repository.softDeleteMany with ids array', async () => {
      repo.softDeleteMany.mockResolvedValue(3);
      const ids = ['id1', 'id2', 'id3'];

      await service.deleteCustomerCategories(ids);

      expect(repo.softDeleteMany).toHaveBeenCalledWith(ids);
    });

    test('returns {status:true, data:{deletedCount}} on success', async () => {
      repo.softDeleteMany.mockResolvedValue(2);

      const result = await service.deleteCustomerCategories(['id1', 'id2']);

      expect(result).toEqual({
        status: true,
        data: { deletedCount: 2 },
        message: 'Customer category deleted successfully',
      });
    });

    test('returns {status:true} even when deletedCount is 0 (no validation in service)', async () => {
      repo.softDeleteMany.mockResolvedValue(0);

      const result = await service.deleteCustomerCategories(['nonexistent']);

      expect(result.status).toBe(true);
      expect(result.data).toEqual({ deletedCount: 0 });
    });

    test('returns error shape on repository throw', async () => {
      repo.softDeleteMany.mockRejectedValue(new Error('bulk delete fail'));
      const result = await service.deleteCustomerCategories(['id1']);
      expect(result.status).toBe(false);
      expect(result.message).toBe('bulk delete fail');
    });

    test('does not re-throw on error', async () => {
      repo.softDeleteMany.mockRejectedValue(new Error('crash'));
      await expect(service.deleteCustomerCategories(['id'])).resolves.not.toThrow();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // bulkImport
  // ══════════════════════════════════════════════════════════════════════════
  describe('bulkImport', () => {
    const makeRow = (overrides = {}) => ({
      name: 'Wholesale',
      branch_id: BRANCH_ID,
      description: 'Wholesale customers',
      ...overrides,
    });

    // ── all-existing ─────────────────────────────────────────────────────────
    test('returns {status:false, "Customer category data already imported"} when all exist', async () => {
      const existing = makeMockCategory({ name: 'Wholesale', description: 'desc' });
      repo.findByName.mockResolvedValue(existing);

      const result = await service.bulkImport([makeRow()]);

      expect(result).toEqual({
        status: false,
        data: [{ name: 'Wholesale', description: 'desc' }],
        message: 'Customer category data already imported',
      });
    });

    test('puts already-existing records in data array with {name, description}', async () => {
      const existing = makeMockCategory({ name: 'Retail', description: 'Retail customers' });
      repo.findByName.mockResolvedValue(existing);

      const result = await service.bulkImport([makeRow({ name: 'Retail' })]);

      expect(result.data[0]).toEqual({ name: 'Retail', description: 'Retail customers' });
    });

    test('defaults description to empty string when existing.description is absent', async () => {
      const existing = { _id: CATEGORY_ID, name: 'Retail' }; // no description field
      repo.findByName.mockResolvedValue(existing);

      const result = await service.bulkImport([makeRow({ name: 'Retail' })]);

      expect(result.data[0].description).toBe('');
    });

    // ── all-new ───────────────────────────────────────────────────────────────
    test('creates each new category individually (not bulkCreate)', async () => {
      repo.findByName.mockResolvedValue(null);
      const created = makeMockCategory({ name: 'Wholesale' });
      repo.create.mockResolvedValue(created);

      await service.bulkImport([makeRow()]);

      expect(repo.create).toHaveBeenCalledTimes(1);
      expect(repo.create).toHaveBeenCalledWith(makeRow());
    });

    test('returns {status:true, data:[{name, description}]} for imported records', async () => {
      repo.findByName.mockResolvedValue(null);
      repo.create.mockResolvedValue(
        makeMockCategory({ name: 'Wholesale', description: 'Wholesale customers' })
      );

      const result = await service.bulkImport([makeRow()]);

      expect(result).toEqual({
        status: true,
        data: [{ name: 'Wholesale', description: 'Wholesale customers' }],
        message: 'Customer category data imported successfully',
      });
    });

    test('defaults description to empty string when created record has no description', async () => {
      repo.findByName.mockResolvedValue(null);
      repo.create.mockResolvedValue({ _id: CATEGORY_ID, name: 'Wholesale' }); // no description

      const result = await service.bulkImport([makeRow()]);

      expect(result.data[0].description).toBe('');
    });

    // ── mixed existing + new ──────────────────────────────────────────────────
    test('imports only new records when some already exist', async () => {
      repo.findByName
        .mockResolvedValueOnce(makeMockCategory({ name: 'Existing' })) // first row exists
        .mockResolvedValueOnce(null); // second row is new

      repo.create.mockResolvedValue(makeMockCategory({ name: 'New Cat' }));

      const result = await service.bulkImport([
        makeRow({ name: 'Existing' }),
        makeRow({ name: 'New Cat' }),
      ]);

      expect(result.status).toBe(true);
      expect(repo.create).toHaveBeenCalledTimes(1);
    });

    test('calls repository.findByName for each row with name and branch_id', async () => {
      repo.findByName.mockResolvedValue(null);
      repo.create.mockResolvedValue(makeMockCategory());

      await service.bulkImport([makeRow({ name: 'Cat1' }), makeRow({ name: 'Cat2' })]);

      expect(repo.findByName).toHaveBeenCalledWith('Cat1', BRANCH_ID);
      expect(repo.findByName).toHaveBeenCalledWith('Cat2', BRANCH_ID);
    });

    test('skips inserting when repository.create returns falsy', async () => {
      repo.findByName.mockResolvedValue(null);
      repo.create.mockResolvedValue(null); // create returns null

      const result = await service.bulkImport([makeRow()]);

      // insertedRecords will be empty since inserted is null
      expect(result.status).toBe(true);
      expect(result.data).toEqual([]);
    });

    // ── error handling ────────────────────────────────────────────────────────
    test('returns error shape when repository.findByName throws', async () => {
      repo.findByName.mockRejectedValue(new Error('lookup fail'));
      const result = await service.bulkImport([makeRow()]);
      expect(result.status).toBe(false);
      expect(result.message).toBe('lookup fail');
    });

    test('returns error shape when repository.create throws', async () => {
      repo.findByName.mockResolvedValue(null);
      repo.create.mockRejectedValue(new Error('insert fail'));
      const result = await service.bulkImport([makeRow()]);
      expect(result.status).toBe(false);
    });

    test('does not re-throw on error', async () => {
      repo.findByName.mockRejectedValue(new Error('crash'));
      await expect(service.bulkImport([makeRow()])).resolves.not.toThrow();
    });
  });
});
