'use strict';

/**
 * Unit tests for src/repositories/install.repository.js
 * File: 238 lines, CLASS export, extends BaseModel, super("branches")
 * Uses MongoDB native driver: getCollection with dynamic collection names
 * Uses mongodb.ObjectId, imports CLEANUP_COLLECTIONS from install.constants
 * Error strategy: ALL methods rethrow errors
 */

jest.mock('../../../src/constants/install.constants', () => ({
  CLEANUP_COLLECTIONS: ['users', 'branches', 'customers'],
}));
jest.mock('mongodb', () => {
  const m = jest.fn((id) => ({ toString: () => id }));
  m.isValid = jest.fn(() => true);
  return { ObjectId: m };
});

let MockBaseModel;
jest.mock('../../../src/models/base.model', () => {
  MockBaseModel = jest.fn(function (c) {
    this.collectionName = c;
    this.getCollection = jest.fn();
  });
  MockBaseModel.license = null;
  return MockBaseModel;
});

const Install = require('../../../src/repositories/install.repository');
const BaseModel = require('../../../src/models/base.model');

const FAKE_ID = '64f9a1c2e3b4d5e6f7000001';
const FAKE_LICENSE_ID = '64f9a1c2e3b4d5e6f7000002';

describe('InstallRepository', () => {
  let repository;
  let col = {};
  let consoleErrorSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    BaseModel.license = null;
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    // Shared collection mocks per collection name
    col = {
      users: {
        findOne: jest.fn().mockResolvedValue(null),
        insertOne: jest.fn().mockResolvedValue({ insertedId: FAKE_ID }),
        updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      },
      branches: {
        insertOne: jest.fn().mockResolvedValue({ insertedId: FAKE_ID }),
        updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      },
      categories: {
        insertOne: jest.fn().mockResolvedValue({ insertedId: FAKE_ID }),
        insertMany: jest.fn().mockResolvedValue({ insertedIds: { 0: FAKE_ID } }),
        find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
        deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      },
      items: {
        insertOne: jest.fn().mockResolvedValue({ insertedId: FAKE_ID }),
        insertMany: jest.fn().mockResolvedValue({ insertedIds: { 0: FAKE_ID } }),
        deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      },
      grouptax: {
        insertOne: jest.fn().mockResolvedValue({ insertedId: FAKE_ID }),
        deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      },
      customers: {
        insertOne: jest.fn().mockResolvedValue({ insertedId: FAKE_ID }),
        deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      },
      suppliers: {
        insertOne: jest.fn().mockResolvedValue({ insertedId: FAKE_ID }),
        deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      },
      unit: {
        insertOne: jest.fn().mockResolvedValue({ insertedId: FAKE_ID }),
        deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      },
    };

    repository = new Install();
    repository.getCollection = jest.fn().mockImplementation((name) => {
      return Promise.resolve(col[name]);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('constructor', () => {
    test('extends BaseModel with "branches"', () => {
      expect(repository.collectionName).toBe('branches');
    });
  });

  describe('findExistingUser', () => {
    test('finds user by $or on username, email, license', async () => {
      await repository.findExistingUser({ username: 'a', email: 'b', licenseId: 'l' });
      expect(col.users.findOne).toHaveBeenCalledWith({
        $or: [{ username: 'a' }, { email: 'b' }, { license: 'l' }],
      });
    });
    test('returns user doc', async () => {
      col.users.findOne.mockResolvedValueOnce({ _id: FAKE_ID });
      const r = await repository.findExistingUser({ username: 'a', email: 'b', licenseId: 'l' });
      expect(r).toEqual({ _id: FAKE_ID });
    });
    test('rethrows error', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(
        repository.findExistingUser({ username: 'a', email: 'b', licenseId: 'l' })
      ).rejects.toThrow('fail');
    });
  });

  describe('insertUser', () => {
    test('inserts into users and returns insertedId', async () => {
      const r = await repository.insertUser({ name: 'u' });
      expect(col.users.insertOne).toHaveBeenCalledWith({ name: 'u' });
      expect(r).toEqual(FAKE_ID);
    });
    test('rethrows error', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repository.insertUser({})).rejects.toThrow('fail');
    });
  });

  describe('updateUserBranchAccess', () => {
    test('updateOne with _id and license filter', async () => {
      await repository.updateUserBranchAccess(FAKE_ID, FAKE_LICENSE_ID, { branch: 'b1' });
      expect(col.users.updateOne).toHaveBeenCalledWith(
        { _id: FAKE_ID, license: FAKE_LICENSE_ID },
        { $set: { branch: 'b1' } }
      );
    });
    test('rethrows error', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repository.updateUserBranchAccess(FAKE_ID, FAKE_LICENSE_ID, {})).rejects.toThrow(
        'fail'
      );
    });
  });

  describe('insertBranch', () => {
    test('inserts into branches and returns insertedId', async () => {
      const r = await repository.insertBranch({ name: 'Main' });
      expect(col.branches.insertOne).toHaveBeenCalledWith({ name: 'Main' });
      expect(r).toEqual(FAKE_ID);
    });
    test('rethrows error', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repository.insertBranch({})).rejects.toThrow('fail');
    });
  });

  describe('updateBranch', () => {
    test('updateOne with _id and license filter', async () => {
      await repository.updateBranch(FAKE_ID, FAKE_LICENSE_ID, { name: 'Updated' });
      expect(col.branches.updateOne).toHaveBeenCalledWith(
        { _id: FAKE_ID, license: FAKE_LICENSE_ID },
        { $set: { name: 'Updated' } }
      );
    });
    test('rethrows error', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repository.updateBranch(FAKE_ID, FAKE_LICENSE_ID, {})).rejects.toThrow('fail');
    });
  });

  describe('addBranchEmailFields', () => {
    test('updateOne with $push on email_fields', async () => {
      await repository.addBranchEmailFields(FAKE_ID, FAKE_LICENSE_ID, { email: 'a@x.com' });
      expect(col.branches.updateOne).toHaveBeenCalledWith(
        { _id: FAKE_ID, license: FAKE_LICENSE_ID },
        { $push: { email_fields: { email: 'a@x.com' } } }
      );
    });
    test('rethrows error', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repository.addBranchEmailFields(FAKE_ID, FAKE_LICENSE_ID, {})).rejects.toThrow(
        'fail'
      );
    });
  });

  describe('insertTax', () => {
    test('inserts into grouptax and returns insertedId', async () => {
      const r = await repository.insertTax({ name: 'GST' });
      expect(col.grouptax.insertOne).toHaveBeenCalledWith({ name: 'GST' });
      expect(r).toEqual(FAKE_ID);
    });
    test('rethrows error', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repository.insertTax({})).rejects.toThrow('fail');
    });
  });

  describe('insertCustomer', () => {
    test('inserts into customers and returns insertedId', async () => {
      const r = await repository.insertCustomer({ name: 'Alice' });
      expect(col.customers.insertOne).toHaveBeenCalledWith({ name: 'Alice' });
      expect(r).toEqual(FAKE_ID);
    });
    test('rethrows error', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repository.insertCustomer({})).rejects.toThrow('fail');
    });
  });

  describe('insertSupplier', () => {
    test('inserts into suppliers and returns insertedId', async () => {
      const r = await repository.insertSupplier({ name: 'Bob' });
      expect(col.suppliers.insertOne).toHaveBeenCalledWith({ name: 'Bob' });
      expect(r).toEqual(FAKE_ID);
    });
    test('rethrows error', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repository.insertSupplier({})).rejects.toThrow('fail');
    });
  });

  describe('insertUnit', () => {
    test('inserts into unit and returns insertedId', async () => {
      const r = await repository.insertUnit({ name: 'kg' });
      expect(col.unit.insertOne).toHaveBeenCalledWith({ name: 'kg' });
      expect(r).toEqual(FAKE_ID);
    });
    test('rethrows error', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repository.insertUnit({})).rejects.toThrow('fail');
    });
  });

  describe('insertCategories', () => {
    test('insertMany into categories and returns ids', async () => {
      const cats = [{ name: 'A' }, { name: 'B' }];
      col.categories.insertMany.mockResolvedValueOnce({ insertedIds: { 0: 'id1', 1: 'id2' } });
      const r = await repository.insertCategories(cats);
      expect(col.categories.insertMany).toHaveBeenCalledWith(cats);
      expect(r).toEqual(['id1', 'id2']);
    });
    test('rethrows error', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repository.insertCategories([])).rejects.toThrow('fail');
    });
  });

  describe('findCategoriesByIds', () => {
    test('finds categories by $in ids and license', async () => {
      col.categories.find.mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([{ name: 'A' }]),
      });
      const r = await repository.findCategoriesByIds([FAKE_ID], FAKE_LICENSE_ID);
      expect(col.categories.find).toHaveBeenCalledWith({
        _id: { $in: expect.any(Array) },
        license: FAKE_LICENSE_ID,
      });
      expect(r).toEqual([{ name: 'A' }]);
    });
    test('rethrows error', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repository.findCategoriesByIds([FAKE_ID], FAKE_LICENSE_ID)).rejects.toThrow(
        'fail'
      );
    });
  });

  describe('insertCategory', () => {
    test('inserts into categories and returns insertedId', async () => {
      const r = await repository.insertCategory({ name: 'A' });
      expect(col.categories.insertOne).toHaveBeenCalledWith({ name: 'A' });
      expect(r).toEqual(FAKE_ID);
    });
    test('rethrows error', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repository.insertCategory({})).rejects.toThrow('fail');
    });
  });

  describe('insertItems', () => {
    test('insertMany into items when data non-empty', async () => {
      const items = [{ name: 'i1' }];
      await repository.insertItems(items);
      expect(col.items.insertMany).toHaveBeenCalledWith(items);
    });
    test('returns void when empty array', async () => {
      const r = await repository.insertItems([]);
      expect(r).toBeUndefined();
      expect(col.items.insertMany).not.toHaveBeenCalled();
    });
    test('rethrows error', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repository.insertItems([{}])).rejects.toThrow('fail');
    });
  });

  describe('insertItem', () => {
    test('inserts into items and returns insertedId', async () => {
      const r = await repository.insertItem({ name: 'i1' });
      expect(col.items.insertOne).toHaveBeenCalledWith({ name: 'i1' });
      expect(r).toEqual(FAKE_ID);
    });
    test('rethrows error', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repository.insertItem({})).rejects.toThrow('fail');
    });
  });

  describe('cleanupByLicense', () => {
    test('deletes from all CLEANUP_COLLECTIONS', async () => {
      col.users.deleteMany.mockResolvedValue({ deletedCount: 1 });
      col.branches.deleteMany.mockResolvedValue({ deletedCount: 1 });
      col.customers.deleteMany.mockResolvedValue({ deletedCount: 1 });
      const r = await repository.cleanupByLicense(FAKE_LICENSE_ID);
      expect(col.users.deleteMany).toHaveBeenCalledWith({ license: FAKE_LICENSE_ID });
      expect(col.branches.deleteMany).toHaveBeenCalledWith({ license: FAKE_LICENSE_ID });
      expect(col.customers.deleteMany).toHaveBeenCalledWith({ license: FAKE_LICENSE_ID });
      expect(r.totalDeleted).toBeGreaterThanOrEqual(0);
      expect(r.details).toBeDefined();
    });
    test('handles errors per collection without throwing', async () => {
      col.users.deleteMany.mockRejectedValueOnce(new Error('fail'));
      const r = await repository.cleanupByLicense(FAKE_LICENSE_ID);
      expect(r.details).toBeDefined();
    });
    test('returns error details when a collection fails to delete', async () => {
      col.users.deleteMany.mockRejectedValueOnce(new Error('fail'));
      const r = await repository.cleanupByLicense(FAKE_LICENSE_ID);
      expect(r.details.users).toBe('Error: fail');
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
});
