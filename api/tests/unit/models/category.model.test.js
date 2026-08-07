'use strict';

/**
 * Unit tests for src/models/category.model.js
 *
 * Confirmed filename: category.model.js (single file, no duplicates)
 *
 * Strategy: Hybrid
 *  A) Pure schema inspection  — Mongoose schema executes without a live DB.
 *  B) Mocked static method tests — Replace this.find / countDocuments /
 *     insertMany with Jest spies before each relevant test.
 *  C) Instance method tests — Bind the schema method to a plain stub object.
 *  D) Pre-save hook tests — Extract registered hook fn from Kareem internals.
 *
 * No real database connection. No production credentials used.
 */

// ─── Module-level mocks ───────────────────────────────────────────────────────

jest.mock('../../../src/models/base.model', () => jest.fn().mockImplementation(() => ({})));

// ─── Imports ──────────────────────────────────────────────────────────────────

const mongoose = require('mongoose');
const { Types } = mongoose;

const Category = require('../../../src/models/category.model');
const schema = Category.schema;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sp = (field) => schema.path(field);
const validId = () => new Types.ObjectId().toString();
const objId = () => new Types.ObjectId();

// Extract the custom pre-save hook function from the schema.
// Mongoose adds its own internal hooks (validateBeforeSave) too, so we
// identify the custom one by matching its source code.
function getPresaveHook() {
  const pres = schema.s.hooks._pres && schema.s.hooks._pres.get('save');
  if (!pres || pres.length === 0) return null;
  const entry = pres.find((h) => {
    const fn = h.fn || h;
    return typeof fn === 'function' && fn.toString().includes('discount_amount');
  });
  return entry ? entry.fn || entry : null;
}

// ─── Reset spies before every test ───────────────────────────────────────────

beforeEach(() => {
  jest.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. File / export confirmation
// ═══════════════════════════════════════════════════════════════════════════════
describe('category.model — exports', () => {
  test('default export is a Mongoose model named Category', () => {
    expect(Category.modelName).toBe('Category');
  });

  test('exports a Mongoose Model constructor', () => {
    expect(typeof Category).toBe('function');
    expect(Category.db).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Schema — required fields
// ═══════════════════════════════════════════════════════════════════════════════
describe('Category schema — required fields', () => {
  test('branch_id is required', () => {
    expect(sp('branch_id').isRequired).toBe(true);
  });

  test('branch_name is required', () => {
    expect(sp('branch_name').isRequired).toBe(true);
  });

  test('name is required', () => {
    expect(sp('name').isRequired).toBe(true);
  });

  test('discount_amount is NOT required', () => {
    expect(sp('discount_amount').isRequired).toBeFalsy();
  });

  test('discount_percentage is NOT required', () => {
    expect(sp('discount_percentage').isRequired).toBeFalsy();
  });

  test('description is optional', () => {
    expect(sp('description').isRequired).toBeFalsy();
  });

  test('image is optional', () => {
    expect(sp('image').isRequired).toBeFalsy();
  });

  test('is_active is optional (has default)', () => {
    expect(sp('is_active').isRequired).toBeFalsy();
  });

  test('license is optional', () => {
    expect(sp('license').isRequired).toBeFalsy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Schema — field types
// ═══════════════════════════════════════════════════════════════════════════════
describe('Category schema — field types', () => {
  test('branch_id is ObjectId with ref Branch', () => {
    expect(sp('branch_id').instance).toBe('ObjectId');
    expect(sp('branch_id').options.ref).toBe('Branch');
  });

  test('branch_name is String', () => {
    expect(sp('branch_name').instance).toBe('String');
  });

  test('name is String', () => {
    expect(sp('name').instance).toBe('String');
  });

  test('discount_amount is Number', () => {
    expect(sp('discount_amount').instance).toBe('Number');
  });

  test('discount_percentage is Number', () => {
    expect(sp('discount_percentage').instance).toBe('Number');
  });

  test('description is String', () => {
    expect(sp('description').instance).toBe('String');
  });

  test('image is String', () => {
    expect(sp('image').instance).toBe('String');
  });

  test('created_by is String', () => {
    expect(sp('created_by').instance).toBe('String');
  });

  test('created_by_id is ObjectId with ref User', () => {
    expect(sp('created_by_id').instance).toBe('ObjectId');
    expect(sp('created_by_id').options.ref).toBe('User');
  });

  test('updated_by is String', () => {
    expect(sp('updated_by').instance).toBe('String');
  });

  test('updated_by_id is ObjectId with ref User', () => {
    expect(sp('updated_by_id').instance).toBe('ObjectId');
    expect(sp('updated_by_id').options.ref).toBe('User');
  });

  test('is_active is Boolean', () => {
    expect(sp('is_active').instance).toBe('Boolean');
  });

  test('license is ObjectId with ref License', () => {
    expect(sp('license').instance).toBe('ObjectId');
    expect(sp('license').options.ref).toBe('License');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Schema — default values
// ═══════════════════════════════════════════════════════════════════════════════
describe('Category schema — default values', () => {
  test('discount_amount defaults to 0', () => {
    expect(sp('discount_amount').defaultValue).toBe(0);
  });

  test('discount_percentage defaults to 0', () => {
    expect(sp('discount_percentage').defaultValue).toBe(0);
  });

  test('is_active defaults to true', () => {
    expect(sp('is_active').defaultValue).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Schema — string constraints
// ═══════════════════════════════════════════════════════════════════════════════
describe('Category schema — string constraints', () => {
  test('name has minlength 2', () => {
    expect(sp('name').options.minlength).toBe(2);
  });

  test('name has maxlength 100', () => {
    expect(sp('name').options.maxlength).toBe(100);
  });

  test('description has maxlength 500', () => {
    expect(sp('description').options.maxlength).toBe(500);
  });

  test('branch_name has trim true', () => {
    expect(sp('branch_name').options.trim).toBe(true);
  });

  test('name has trim true', () => {
    expect(sp('name').options.trim).toBe(true);
  });

  test('description has trim true', () => {
    expect(sp('description').options.trim).toBe(true);
  });

  test('image has trim true', () => {
    expect(sp('image').options.trim).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Schema — Number constraints
// ═══════════════════════════════════════════════════════════════════════════════
describe('Category schema — number constraints', () => {
  test('discount_amount has min 0', () => {
    expect(sp('discount_amount').options.min).toBe(0);
  });

  test('discount_percentage has min 0', () => {
    expect(sp('discount_percentage').options.min).toBe(0);
  });

  test('discount_percentage has max 100', () => {
    expect(sp('discount_percentage').options.max).toBe(100);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Schema — timestamps
// ═══════════════════════════════════════════════════════════════════════════════
describe('Category schema — timestamps', () => {
  test('timestamps use created_date and updated_date keys', () => {
    expect(schema.options.timestamps).toEqual({
      createdAt: 'created_date',
      updatedAt: 'updated_date',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Schema — indexes
// ═══════════════════════════════════════════════════════════════════════════════
describe('Category schema — indexes', () => {
  const indexes = schema.indexes();

  test('has a text index covering name and description', () => {
    const textIdx = indexes.find(([fields]) => fields.name === 'text' || fields['$**'] === 'text');
    expect(textIdx).toBeDefined();
    const [fields] = textIdx;
    expect(fields.name).toBe('text');
    expect(fields.description).toBe('text');
  });

  test('has a unique compound index on name + branch_id', () => {
    const uniqueIdx = indexes.find(
      ([fields, opts]) => fields.name === 1 && fields.branch_id === 1 && opts && opts.unique
    );
    expect(uniqueIdx).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Pre-save hook — discount conflict validation
// ═══════════════════════════════════════════════════════════════════════════════
describe('Category pre-save hook — discount conflict', () => {
  let hookFn;

  beforeEach(() => {
    hookFn = getPresaveHook();
  });

  test('pre-save hook is registered on the schema', () => {
    expect(hookFn).toBeDefined();
  });

  /* Mongoose 9 stopped passing next() to middleware: a hook returns to carry
     on and throws to fail. These called hookFn with a callback and asserted it
     ran, which tested the old protocol rather than the rule. */
  test('allows a discount set by amount alone', () => {
    expect(() => hookFn.call({ discount_amount: 10, discount_percentage: 0 })).not.toThrow();
  });

  test('allows a discount set by percentage alone', () => {
    expect(() => hookFn.call({ discount_amount: 0, discount_percentage: 15 })).not.toThrow();
  });

  test('allows no discount at all', () => {
    expect(() => hookFn.call({ discount_amount: 0, discount_percentage: 0 })).not.toThrow();
  });

  test('refuses a discount set both ways at once', () => {
    expect(() => hookFn.call({ discount_amount: 5, discount_percentage: 10 })).toThrow(
      /Cannot set both/i
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Static: findCategories
// ═══════════════════════════════════════════════════════════════════════════════
describe('Category.findCategories (static)', () => {
  const branchId = objId();

  function buildChain(docs) {
    const chain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(docs),
    };
    return chain;
  }

  test('returns paginated results with default page/limit', async () => {
    const docs = [{ _id: objId(), name: 'Electronics' }];
    jest.spyOn(Category, 'find').mockReturnValue(buildChain(docs));
    jest.spyOn(Category, 'countDocuments').mockResolvedValue(1);

    const result = await Category.findCategories({ branch_id: branchId });

    expect(result.data).toEqual(docs);
    expect(result.pagination.total).toBe(1);
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.limit).toBe(10);
    expect(result.pagination.totalPages).toBe(1);
  });

  test('applies search as $text query when provided', async () => {
    jest.spyOn(Category, 'find').mockReturnValue(buildChain([]));
    jest.spyOn(Category, 'countDocuments').mockResolvedValue(0);

    await Category.findCategories({ branch_id: branchId, search: 'food' });

    expect(Category.find).toHaveBeenCalledWith(
      expect.objectContaining({ $text: { $search: 'food' } })
    );
  });

  test('adds is_active:true filter when status is "active"', async () => {
    jest.spyOn(Category, 'find').mockReturnValue(buildChain([]));
    jest.spyOn(Category, 'countDocuments').mockResolvedValue(0);

    await Category.findCategories({ branch_id: branchId, status: 'active' });

    expect(Category.find).toHaveBeenCalledWith(expect.objectContaining({ is_active: true }));
  });

  test('adds is_active:false filter when status is "inactive"', async () => {
    jest.spyOn(Category, 'find').mockReturnValue(buildChain([]));
    jest.spyOn(Category, 'countDocuments').mockResolvedValue(0);

    await Category.findCategories({ branch_id: branchId, status: 'inactive' });

    expect(Category.find).toHaveBeenCalledWith(expect.objectContaining({ is_active: false }));
  });

  test('omits is_active filter when status is "all"', async () => {
    jest.spyOn(Category, 'find').mockReturnValue(buildChain([]));
    jest.spyOn(Category, 'countDocuments').mockResolvedValue(0);

    await Category.findCategories({ branch_id: branchId, status: 'all' });

    const call = Category.find.mock.calls[0][0];
    expect(call.is_active).toBeUndefined();
  });

  test('calculates totalPages correctly for multi-page result', async () => {
    jest.spyOn(Category, 'find').mockReturnValue(buildChain([]));
    jest.spyOn(Category, 'countDocuments').mockResolvedValue(25);

    const result = await Category.findCategories({ branch_id: branchId, page: 1, limit: 10 });

    expect(result.pagination.totalPages).toBe(3);
  });

  test('skips correct number of records on page 2', async () => {
    const chain = buildChain([]);
    jest.spyOn(Category, 'find').mockReturnValue(chain);
    jest.spyOn(Category, 'countDocuments').mockResolvedValue(20);

    await Category.findCategories({ branch_id: branchId, page: 2, limit: 10 });

    expect(chain.skip).toHaveBeenCalledWith(10);
    expect(chain.limit).toHaveBeenCalledWith(10);
  });

  test('returns numeric page and limit in pagination', async () => {
    jest.spyOn(Category, 'find').mockReturnValue(buildChain([]));
    jest.spyOn(Category, 'countDocuments').mockResolvedValue(5);

    const result = await Category.findCategories({ branch_id: branchId, page: '2', limit: '5' });

    expect(typeof result.pagination.page).toBe('number');
    expect(typeof result.pagination.limit).toBe('number');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. Static: isNameUnique
// ═══════════════════════════════════════════════════════════════════════════════
describe('Category.isNameUnique (static)', () => {
  const branchId = objId();

  test('returns true when countDocuments is 0', async () => {
    jest.spyOn(Category, 'countDocuments').mockResolvedValue(0);
    const result = await Category.isNameUnique('Electronics', branchId);
    expect(result).toBe(true);
  });

  test('returns false when countDocuments > 0', async () => {
    jest.spyOn(Category, 'countDocuments').mockResolvedValue(1);
    const result = await Category.isNameUnique('Electronics', branchId);
    expect(result).toBe(false);
  });

  test('includes $ne excludeId in query when provided', async () => {
    jest.spyOn(Category, 'countDocuments').mockResolvedValue(0);
    const excludeId = validId();
    await Category.isNameUnique('Electronics', branchId, excludeId);

    expect(Category.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ _id: { $ne: excludeId } })
    );
  });

  test('does not include _id in query when excludeId is null', async () => {
    jest.spyOn(Category, 'countDocuments').mockResolvedValue(0);
    await Category.isNameUnique('Electronics', branchId, null);

    const call = Category.countDocuments.mock.calls[0][0];
    expect(call._id).toBeUndefined();
  });

  test('queries with exact name and branch_id', async () => {
    jest.spyOn(Category, 'countDocuments').mockResolvedValue(0);
    await Category.isNameUnique('Electronics', branchId);

    expect(Category.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Electronics', branch_id: branchId })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. Static: importCategoryModel
// ═══════════════════════════════════════════════════════════════════════════════
describe('Category.importCategoryModel (static)', () => {
  const user = {
    _id: objId(),
    username: 'admin',
    branch_id: objId(),
    branch_name: 'HQ',
  };

  test('returns status:false for empty rows array', async () => {
    const r = await Category.importCategoryModel([], user);
    expect(r.status).toBe(false);
    expect(r.message).toBe('No categories to import');
  });

  test('returns status:false for non-array rows', async () => {
    const r = await Category.importCategoryModel(null, user);
    expect(r.status).toBe(false);
    expect(r.message).toBe('No categories to import');
  });

  test('returns status:false when branch_id is missing from user', async () => {
    const r = await Category.importCategoryModel([{ name: 'Food' }], {});
    expect(r.status).toBe(false);
    expect(r.message).toBe('Branch context is missing for import');
  });

  test('returns status:false with no-valid-rows message when only row has a blank name', async () => {
    // Blank-name rows are filtered out during deduplication (Step 1),
    // so they never reach the CSV validation path.
    const r = await Category.importCategoryModel([{ name: '' }], user);
    expect(r.status).toBe(false);
    expect(r.message).toBe('No valid category rows to import');
  });

  test('returns CSV error when both discount_amount and discount_percentage > 0', async () => {
    const rows = [{ name: 'Food', discount_amount: 5, discount_percentage: 10 }];
    const r = await Category.importCategoryModel(rows, user);
    expect(r.status).toBe(true);
    expect(r.message).toBe('CSV');
    expect(r.data[0].status).toMatch(/discount/i);
  });

  test('deduplicates rows by name case-insensitively', async () => {
    jest.spyOn(Category, 'find').mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });
    jest
      .spyOn(Category, 'insertMany')
      .mockResolvedValue([
        { name: 'Food', discount_amount: 0, discount_percentage: 0, description: '' },
      ]);

    const rows = [{ name: 'Food' }, { name: 'FOOD' }, { name: 'food' }];
    const r = await Category.importCategoryModel(rows, user);
    expect(r.status).toBe(true);
    expect(Category.insertMany).toHaveBeenCalledTimes(1);
    const inserted = Category.insertMany.mock.calls[0][0];
    expect(inserted).toHaveLength(1);
  });

  test('returns status:false with alreadyData when all categories already exist', async () => {
    jest.spyOn(Category, 'find').mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest
        .fn()
        .mockResolvedValue([
          { name: 'Food', discount_amount: 0, discount_percentage: 0, description: '' },
        ]),
    });

    const r = await Category.importCategoryModel([{ name: 'Food' }], user);
    expect(r.status).toBe(false);
    expect(r.message).toBe('All categories are already imported');
    expect(Array.isArray(r.data)).toBe(true);
    expect(r.data[0].name).toBe('Food');
  });

  test('inserts only new (non-existing) categories', async () => {
    jest.spyOn(Category, 'find').mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest
        .fn()
        .mockResolvedValue([
          { name: 'Electronics', discount_amount: 0, discount_percentage: 0, description: '' },
        ]),
    });
    jest
      .spyOn(Category, 'insertMany')
      .mockResolvedValue([
        { name: 'Food', discount_amount: 0, discount_percentage: 0, description: '' },
      ]);

    const rows = [{ name: 'Food' }, { name: 'Electronics' }];
    const r = await Category.importCategoryModel(rows, user);
    expect(r.status).toBe(true);
    expect(r.message).toBe('Category data imported successfully');
    const inserted = Category.insertMany.mock.calls[0][0];
    expect(inserted.map((d) => d.name)).toEqual(['Food']);
  });

  test('returns mapped responseData on successful import', async () => {
    jest.spyOn(Category, 'find').mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });
    jest
      .spyOn(Category, 'insertMany')
      .mockResolvedValue([
        { name: 'Beverages', discount_amount: 5, discount_percentage: 0, description: 'Drinks' },
      ]);

    const r = await Category.importCategoryModel([{ name: 'Beverages', discount_amount: 5 }], user);
    expect(r.status).toBe(true);
    expect(r.data[0].name).toBe('Beverages');
    expect(r.data[0].discount_amount).toBe(5);
  });

  test('inserts documents with branch_id and branch_name from user', async () => {
    jest.spyOn(Category, 'find').mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });
    jest
      .spyOn(Category, 'insertMany')
      .mockResolvedValue([
        { name: 'Toys', discount_amount: 0, discount_percentage: 0, description: '' },
      ]);

    await Category.importCategoryModel([{ name: 'Toys' }], user);

    const inserted = Category.insertMany.mock.calls[0][0];
    expect(inserted[0].branch_id.toString()).toBe(user.branch_id.toString());
    expect(inserted[0].branch_name).toBe(user.branch_name);
  });

  test('resolves branch_id from user.branch._id when user.branch_id is absent', async () => {
    const altUser = {
      _id: objId(),
      username: 'admin',
      branch: { _id: objId(), branch_name: 'Branch A' },
    };
    jest.spyOn(Category, 'find').mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });
    jest
      .spyOn(Category, 'insertMany')
      .mockResolvedValue([
        { name: 'Dairy', discount_amount: 0, discount_percentage: 0, description: '' },
      ]);

    const r = await Category.importCategoryModel([{ name: 'Dairy' }], altUser);
    expect(r.status).toBe(true);
  });

  test('returns status:false with error message when insertMany throws', async () => {
    jest.spyOn(Category, 'find').mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });
    jest.spyOn(Category, 'insertMany').mockRejectedValue(new Error('DB error'));

    const r = await Category.importCategoryModel([{ name: 'Food' }], user);
    expect(r.status).toBe(false);
    expect(r.message).toBe('DB error');
  });

  test('skips rows with falsy/blank names during deduplication', async () => {
    jest.spyOn(Category, 'find').mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });
    jest
      .spyOn(Category, 'insertMany')
      .mockResolvedValue([
        { name: 'Meat', discount_amount: 0, discount_percentage: 0, description: '' },
      ]);

    const rows = [{ name: '' }, { name: null }, { name: 'Meat' }];
    const r = await Category.importCategoryModel(rows, user);
    expect(r.status).toBe(true);
    const inserted = Category.insertMany.mock.calls[0][0];
    expect(inserted.map((d) => d.name)).toEqual(['Meat']);
  });

  test('defaults image to category.svg when image is not in row', async () => {
    jest.spyOn(Category, 'find').mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });
    jest
      .spyOn(Category, 'insertMany')
      .mockResolvedValue([
        { name: 'Grains', discount_amount: 0, discount_percentage: 0, description: '' },
      ]);

    await Category.importCategoryModel([{ name: 'Grains' }], user);

    const inserted = Category.insertMany.mock.calls[0][0];
    expect(inserted[0].image).toBe('category.svg');
  });

  test('returns status:false with no valid rows message when all rows are blank', async () => {
    const r = await Category.importCategoryModel([{ name: '' }, { name: '  ' }], user);
    expect(r.status).toBe(false);
    expect(r.message).toBe('No valid category rows to import');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 13. Instance method: toggleStatus
// ═══════════════════════════════════════════════════════════════════════════════
describe('Category instance method — toggleStatus', () => {
  const toggleFn = schema.methods.toggleStatus;

  function makeInstance(is_active) {
    const doc = {
      is_active,
      updated_by: null,
      save: jest.fn().mockResolvedValue(true),
    };
    return doc;
  }

  test('flips is_active from true to false', async () => {
    const doc = makeInstance(true);
    await toggleFn.call(doc, 'user123');
    expect(doc.is_active).toBe(false);
  });

  test('flips is_active from false to true', async () => {
    const doc = makeInstance(false);
    await toggleFn.call(doc, 'user123');
    expect(doc.is_active).toBe(true);
  });

  test('sets updated_by to the passed userId', async () => {
    const doc = makeInstance(true);
    await toggleFn.call(doc, 'admin-uid');
    expect(doc.updated_by).toBe('admin-uid');
  });

  test('calls this.save() exactly once', async () => {
    const doc = makeInstance(true);
    await toggleFn.call(doc, 'uid');
    expect(doc.save).toHaveBeenCalledTimes(1);
  });

  test('returns the result of this.save()', async () => {
    const doc = makeInstance(false);
    const result = await toggleFn.call(doc, 'uid');
    expect(result).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 14. Edge cases — importCategoryModel data normalization
// ═══════════════════════════════════════════════════════════════════════════════
describe('Category.importCategoryModel — edge cases', () => {
  const user = {
    _id: objId(),
    username: 'tester',
    branch_id: objId(),
    branch_name: 'Store A',
  };

  function setupInsert(docs) {
    jest.spyOn(Category, 'find').mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });
    jest.spyOn(Category, 'insertMany').mockResolvedValue(docs);
  }

  test('trims whitespace from name before inserting', async () => {
    setupInsert([{ name: 'Snacks', discount_amount: 0, discount_percentage: 0, description: '' }]);
    await Category.importCategoryModel([{ name: '  Snacks  ' }], user);
    const inserted = Category.insertMany.mock.calls[0][0];
    expect(inserted[0].name).toBe('Snacks');
  });

  test('trims whitespace from description before inserting', async () => {
    setupInsert([
      { name: 'Spices', discount_amount: 0, discount_percentage: 0, description: 'Indian spices' },
    ]);
    await Category.importCategoryModel(
      [{ name: 'Spices', description: '  Indian spices  ' }],
      user
    );
    const inserted = Category.insertMany.mock.calls[0][0];
    expect(inserted[0].description).toBe('Indian spices');
  });

  test('treats discount_amount as 0 when it is undefined', async () => {
    setupInsert([{ name: 'Dairy', discount_amount: 0, discount_percentage: 0, description: '' }]);
    await Category.importCategoryModel([{ name: 'Dairy' }], user);
    const inserted = Category.insertMany.mock.calls[0][0];
    expect(inserted[0].discount_amount).toBe(0);
  });

  test('treats discount_percentage as 0 when it is null', async () => {
    setupInsert([{ name: 'Frozen', discount_amount: 0, discount_percentage: 0, description: '' }]);
    await Category.importCategoryModel([{ name: 'Frozen', discount_percentage: null }], user);
    const inserted = Category.insertMany.mock.calls[0][0];
    expect(inserted[0].discount_percentage).toBe(0);
  });

  test('uses user.email as created_by when username is absent', async () => {
    const userNoUsername = { ...user, username: undefined, email: 'test@example.com' };
    setupInsert([{ name: 'Herbs', discount_amount: 0, discount_percentage: 0, description: '' }]);
    await Category.importCategoryModel([{ name: 'Herbs' }], userNoUsername);
    const inserted = Category.insertMany.mock.calls[0][0];
    expect(inserted[0].created_by).toBe('test@example.com');
  });

  test('uses user.name as created_by when username and email are absent', async () => {
    const userNoEmail = { ...user, username: undefined, email: undefined, name: 'John' };
    setupInsert([{ name: 'Sauces', discount_amount: 0, discount_percentage: 0, description: '' }]);
    await Category.importCategoryModel([{ name: 'Sauces' }], userNoEmail);
    const inserted = Category.insertMany.mock.calls[0][0];
    expect(inserted[0].created_by).toBe('John');
  });

  test('sets branch_name to Default Branch when user.branch_name is absent', async () => {
    const userNoBranchName = { _id: objId(), username: 'a', branch_id: objId() };
    setupInsert([{ name: 'Grains', discount_amount: 0, discount_percentage: 0, description: '' }]);
    await Category.importCategoryModel([{ name: 'Grains' }], userNoBranchName);
    const inserted = Category.insertMany.mock.calls[0][0];
    expect(inserted[0].branch_name).toBe('Default Branch');
  });
});
