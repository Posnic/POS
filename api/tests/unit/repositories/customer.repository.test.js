'use strict';

/**
 * Unit tests for src/repositories/customer.repository.js
 *
 * File        : src/repositories/customer.repository.js (869 lines, CLASS export)
 * Export type : CLASS — module.exports = CustomerRepository (not a singleton)
 * Base class  : EXTENDS BaseModel — class CustomerRepository extends BaseModel
 *
 * Pattern     : MongoDB native driver wrapper with BaseModel inheritance.
 *               Constructor: super("customers")
 *               Uses inherited methods: getCollection()
 *               Uses static properties: BaseModel.license, BaseModel.loggedUser, BaseModel.currentTimeZone, BaseModel.startingDate, BaseModel.endingDate
 *               Uses MongoDB native driver directly (not Mongoose): collection.find(), findOne(), insertOne(), findOneAndUpdate(), deleteOne(), deleteMany(), countDocuments(), aggregate()
 *               Uses mongodb.ObjectId for ID conversion
 *
 * Error strategy: Most methods RETHROW errors, but `getCustomerGraphicalReports` and `getCustomerOutstandingReport` have try-catch returning error objects.
 *
 * Methods (22):
 *   findAll(filters, options)              — pagination
 *   findById(id)                           — ObjectId conversion
 *   findByEmail(email)                     — exact email match
 *   findByPhone(phone)                     — exact phone match
 *   findByNameAndPhone(name, phone, branchId) — exact name + phone + branch
 *   search(searchTerm, options)            — $or regex on name/email/phone
 *   create(customerData)                   — insertOne + findById
 *   update(id, updateData)                 — findOneAndUpdate
 *   softDelete(id)                         — backup to recycle_bin + deleteOne, throws if not found
 *   bulkSoftDelete(ids)                    — backup to recycle_bin + deleteMany
 *   getSummary(customerId)                 — customer + sales aggregation
 *   updateTotalsAfterSale({ customerId, saleTotal, lastPurchaseDate }) — updateOne with $inc/$set
 *   findByLoyaltyTier(tier, options)       — pagination on loyalty.tier
 *   updateLoyaltyPoints(customerId, points, operation) — findOneAndUpdate with $inc
 *   getOutstandingReport(filters, options) — sales aggregation
 *   getDataChanges(fromDate)              — find with updated_date filter
 *   bulkCreate(customersData)              — insertMany + find by insertedIds
 *   exportData(filters)                   — find with projection
 *   getPaymentDetails(customerId)         — customer + sales query with date formatting
 *   getTransactions(customerId, options)  — sales pagination
 *   getCustomerGraphicalReports(params)    — complex sales aggregation with day-of-week grouping (try-catch)
 *   getCustomerOutstandingReport(params)   — complex transaction aggregation (try-catch)
 *
 * Mocked dependencies:
 *   src/models/base.model — getCollection, static license/loggedUser/currentTimeZone/startingDate/endingDate
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
    insertMany: jest.fn().mockResolvedValue({ insertedIds: { 0: 'id_1', 1: 'id_2' } }),
    findOneAndUpdate: jest.fn().mockResolvedValue(null),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
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
  MockBaseModel.currentTimeZone = 'Asia/Kolkata';
  MockBaseModel.startingDate = jest.fn((date, tz) => new Date(date || '2026-01-01'));
  MockBaseModel.endingDate = jest.fn((date, tz) => new Date(date || '2026-12-31'));

  return MockBaseModel;
});

jest.mock('mongodb', () => {
  const mockObjectId = jest.fn((id) => ({ toString: () => id }));
  mockObjectId.isValid = jest.fn(() => true);
  return { ObjectId: mockObjectId };
});

// ─── Requires ─────────────────────────────────────────────────────────────────

const Customer = require('../../../src/repositories/customer.repository');
const BaseModel = require('../../../src/models/base.model');
require('mongodb');

// ─── Shared fake data ─────────────────────────────────────────────────────────

const FAKE_ID = '64f9a1c2e3b4d5e6f7000001';
const FAKE_BRANCH_ID = '64f9a1c2e3b4d5e6f7000002';
const FAKE_LICENSE_ID = '64f9a1c2e3b4d5e6f7000003';

const FAKE_CUSTOMER = {
  _id: FAKE_ID,
  name: 'Test Customer',
  email: 'customer@example.com',
  phone: '9876543210',
  branch_id: FAKE_BRANCH_ID,
  license: FAKE_LICENSE_ID,
  is_deleted: false,
  created_date: new Date('2026-01-01T00:00:00.000Z'),
  updated_date: new Date('2026-01-01T00:00:00.000Z'),
};

const FAKE_CUSTOMER_2 = {
  _id: '64f9a1c2e3b4d5e6f7000004',
  name: 'Another Customer',
  email: 'another@example.com',
  phone: '9876543211',
  branch_id: FAKE_BRANCH_ID,
  license: FAKE_LICENSE_ID,
  is_deleted: false,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CustomerRepository (class, extends BaseModel)', () => {
  let repository;
  let mockCollection;
  let mockSalesCollection;
  let mockTransactionCollection;
  let mockRecycleCollection;
  let consoleErrorSpy;
  let consoleLogSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    // Reset static properties
    BaseModel.license = null;
    BaseModel.loggedUser = null;
    BaseModel.currentTimeZone = 'Asia/Kolkata';

    // Create fresh mock collections
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
      insertMany: jest
        .fn()
        .mockResolvedValue({ insertedIds: { 0: FAKE_ID, 1: FAKE_CUSTOMER_2._id } }),
      findOneAndUpdate: jest.fn().mockResolvedValue(FAKE_CUSTOMER),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      countDocuments: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    };

    mockSalesCollection = {
      find: jest.fn().mockReturnValue(mkQuery()),
      aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
      countDocuments: jest.fn().mockResolvedValue(0),
    };

    mockTransactionCollection = {
      aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
      countDocuments: jest.fn().mockResolvedValue(0),
    };

    mockRecycleCollection = {
      insertOne: jest.fn().mockResolvedValue({ insertedId: 'recycle_123' }),
      insertMany: jest.fn().mockResolvedValue({ insertedIds: {} }),
    };

    // Instantiate the class (not a singleton)
    repository = new Customer();

    // Spy on getCollection to return different collections based on name
    repository.getCollection = jest.fn().mockImplementation((name) => {
      if (name === 'customers') return Promise.resolve(mockCollection);
      if (name === 'customers_recycle_bin') return Promise.resolve(mockRecycleCollection);
      if (name === 'sales') return Promise.resolve(mockSalesCollection);
      if (name === 'transaction') return Promise.resolve(mockTransactionCollection);
      return Promise.resolve(mockCollection);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  // ── constructor ────────────────────────────────────────────────────────────

  describe('constructor', () => {
    test('extends BaseModel with "customers" collection', () => {
      expect(repository.collectionName).toBe('customers');
    });
  });

  // ── findAll ────────────────────────────────────────────────────────────────

  describe('findAll', () => {
    test('calls getCollection with collection name', async () => {
      await repository.findAll({});
      expect(repository.getCollection).toHaveBeenCalledWith('customers');
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
      expect(query.skip).toHaveBeenCalledWith(5);
      expect(query.limit).toHaveBeenCalledWith(5);
    });

    test('returns paginated result', async () => {
      mockCollection.find.mockReturnValueOnce({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([FAKE_CUSTOMER]),
      });
      mockCollection.countDocuments.mockResolvedValueOnce(1);
      const r = await repository.findAll({});
      expect(r).toEqual({
        data: [FAKE_CUSTOMER],
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
      expect(repository.getCollection).toHaveBeenCalledWith('customers');
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

    test('returns the customer document', async () => {
      mockCollection.findOne.mockResolvedValueOnce(FAKE_CUSTOMER);
      const r = await repository.findById(FAKE_ID);
      expect(r).toEqual(FAKE_CUSTOMER);
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.findById(FAKE_ID)).rejects.toThrow('GetCollection failed');
    });
  });

  // ── findByEmail ────────────────────────────────────────────────────────────

  describe('findByEmail', () => {
    test('calls collection.findOne with email', async () => {
      await repository.findByEmail('customer@example.com');
      expect(mockCollection.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'customer@example.com',
          license: BaseModel.license,
          is_deleted: { $ne: true },
        })
      );
    });

    test('returns the customer document', async () => {
      mockCollection.findOne.mockResolvedValueOnce(FAKE_CUSTOMER);
      const r = await repository.findByEmail('customer@example.com');
      expect(r).toEqual(FAKE_CUSTOMER);
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.findByEmail('customer@example.com')).rejects.toThrow(
        'GetCollection failed'
      );
    });
  });

  // ── findByPhone ────────────────────────────────────────────────────────────

  describe('findByPhone', () => {
    test('calls collection.findOne with phone', async () => {
      await repository.findByPhone('9876543210');
      expect(mockCollection.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          phone: '9876543210',
          license: BaseModel.license,
          is_deleted: { $ne: true },
        })
      );
    });

    test('returns the customer document', async () => {
      mockCollection.findOne.mockResolvedValueOnce(FAKE_CUSTOMER);
      const r = await repository.findByPhone('9876543210');
      expect(r).toEqual(FAKE_CUSTOMER);
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.findByPhone('9876543210')).rejects.toThrow('GetCollection failed');
    });
  });

  // ── findByNameAndPhone ─────────────────────────────────────────────────────

  describe('findByNameAndPhone', () => {
    test('calls collection.findOne with name, phone, and branch_id', async () => {
      await repository.findByNameAndPhone('Test Customer', '9876543210', FAKE_BRANCH_ID);
      expect(mockCollection.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Customer',
          phone: '9876543210',
          branch_id: expect.any(Object),
          license: BaseModel.license,
          is_deleted: { $ne: true },
        })
      );
    });

    test('returns the customer document', async () => {
      mockCollection.findOne.mockResolvedValueOnce(FAKE_CUSTOMER);
      const r = await repository.findByNameAndPhone('Test Customer', '9876543210', FAKE_BRANCH_ID);
      expect(r).toEqual(FAKE_CUSTOMER);
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(
        repository.findByNameAndPhone('Test Customer', '9876543210', FAKE_BRANCH_ID)
      ).rejects.toThrow('GetCollection failed');
    });
  });

  // ── search ────────────────────────────────────────────────────────────────

  describe('search', () => {
    test('calls collection.find with $or regex on name, email, phone', async () => {
      await repository.search('test');
      expect(mockCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          $or: expect.arrayContaining([
            expect.objectContaining({ name: expect.any(RegExp) }),
            expect.objectContaining({ email: expect.any(RegExp) }),
            expect.objectContaining({ phone: expect.any(RegExp) }),
          ]),
          license: BaseModel.license,
          is_deleted: { $ne: true },
        })
      );
    });

    test('applies branch_id filter when branchId provided', async () => {
      await repository.search('test', { branchId: FAKE_BRANCH_ID });
      expect(mockCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          branch_id: expect.any(Object),
        })
      );
    });

    test('returns { data, total } object', async () => {
      mockCollection.find.mockReturnValueOnce({
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([FAKE_CUSTOMER]),
      });
      mockCollection.countDocuments.mockResolvedValueOnce(1);
      const r = await repository.search('test');
      expect(r).toEqual({ data: [FAKE_CUSTOMER], total: 1 });
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.search('test')).rejects.toThrow('GetCollection failed');
    });
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    test('omits blank optional email to avoid unique-index collisions', async () => {
      await repository.create({ name: 'No Email', phone: '123', email: ' ' });
      expect(mockCollection.insertOne.mock.calls[0][0]).not.toHaveProperty('email');
    });
    const NEW_DATA = { name: 'New Customer', email: 'new@example.com' };

    test('calls insertOne with data plus license, timestamps, and is_deleted', async () => {
      await repository.create(NEW_DATA);
      expect(mockCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          ...NEW_DATA,
          license: BaseModel.license,
          created_date: expect.any(Date),
          updated_date: expect.any(Date),
          is_deleted: false,
        })
      );
    });

    /*
     * S7 (D5) step one. Customers are branch-scoped here while every
     * comparable product keeps them account-level. This writes the relation
     * items already use - branch_access[] - alongside branch_id, seeded with
     * the owning branch, so NOTHING becomes visible anywhere new. Sharing a
     * customer is then a deliberate grant rather than a migration side effect.
     */
    test('a new customer records the branch that owns it', async () => {
      await repository.create({ ...NEW_DATA, branch_id: 'b1', branch_name: 'Main' });
      const doc = mockCollection.insertOne.mock.calls[0][0];
      expect(doc.branch_access).toEqual([{ branch_id: 'b1', branch_name: 'Main' }]);
      // and the legacy field is untouched - this is additive, not a move
      expect(doc.branch_id).toBe('b1');
    });

    test('access lists ONLY the owning branch, so nothing is shared by default', async () => {
      await repository.create({ ...NEW_DATA, branch_id: 'b1', branch_name: 'Main' });
      const doc = mockCollection.insertOne.mock.calls[0][0];
      expect(doc.branch_access).toHaveLength(1);
    });

    test('an explicit branch_access is respected, never overwritten', async () => {
      const shared = [
        { branch_id: 'b1', branch_name: 'Main' },
        { branch_id: 'b2', branch_name: 'Second' },
      ];
      await repository.create({ ...NEW_DATA, branch_id: 'b1', branch_access: shared });
      expect(mockCollection.insertOne.mock.calls[0][0].branch_access).toEqual(shared);
    });

    test('no branch context yields an empty list rather than a bogus entry', async () => {
      const prev = BaseModel.currentBranch;
      BaseModel.currentBranch = null;
      await repository.create({ name: 'Orphan' });
      expect(mockCollection.insertOne.mock.calls[0][0].branch_access).toEqual([]);
      BaseModel.currentBranch = prev;
    });

    test('calls findById to retrieve the inserted document', async () => {
      await repository.create(NEW_DATA);
      expect(repository.getCollection).toHaveBeenCalledWith('customers');
    });

    test('returns the inserted document', async () => {
      mockCollection.findOne.mockResolvedValueOnce(FAKE_CUSTOMER);
      const r = await repository.create(NEW_DATA);
      expect(r).toEqual(FAKE_CUSTOMER);
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.create(NEW_DATA)).rejects.toThrow('GetCollection failed');
    });
  });

  // ── update ────────────────────────────────────────────────────────────────

  describe('update', () => {
    test('unsets email when an update clears the optional value', async () => {
      await repository.update(FAKE_ID, { email: '' });
      const update = mockCollection.findOneAndUpdate.mock.calls[0][1];
      expect(update.$set).not.toHaveProperty('email');
      expect(update.$unset).toEqual({ email: '' });
    });
    const UPDATE_DATA = { name: 'Updated Customer' };

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
          }),
        }),
        { returnDocument: 'after' }
      );
    });

    test('returns the updated document', async () => {
      const r = await repository.update(FAKE_ID, UPDATE_DATA);
      expect(r).toEqual(FAKE_CUSTOMER);
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.update(FAKE_ID, UPDATE_DATA)).rejects.toThrow('GetCollection failed');
    });
  });

  // ── softDelete ────────────────────────────────────────────────────────────

  describe('softDelete', () => {
    test('calls findOne to get customer before deletion', async () => {
      mockCollection.findOne.mockResolvedValueOnce(FAKE_CUSTOMER);
      await repository.softDelete(FAKE_ID);
      expect(mockCollection.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: expect.any(Object),
          license: BaseModel.license,
        })
      );
    });

    test('throws error when customer not found', async () => {
      mockCollection.findOne.mockResolvedValueOnce(null);
      await expect(repository.softDelete(FAKE_ID)).rejects.toThrow('Customer not found');
    });

    test('backs up to recycle_bin collection', async () => {
      mockCollection.findOne.mockResolvedValueOnce(FAKE_CUSTOMER);
      await repository.softDelete(FAKE_ID);
      expect(repository.getCollection).toHaveBeenCalledWith('customers_recycle_bin');
      expect(mockRecycleCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          ...FAKE_CUSTOMER,
          deleted_date: expect.any(Date),
          deleted_by: BaseModel.loggedUser || 'system',
        })
      );
    });

    test('calls deleteOne on main collection', async () => {
      mockCollection.findOne.mockResolvedValueOnce(FAKE_CUSTOMER);
      await repository.softDelete(FAKE_ID);
      expect(mockCollection.deleteOne).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: expect.any(Object),
          license: BaseModel.license,
        })
      );
    });

    test('returns the customer document', async () => {
      mockCollection.findOne.mockResolvedValueOnce(FAKE_CUSTOMER);
      const r = await repository.softDelete(FAKE_ID);
      expect(r).toEqual(FAKE_CUSTOMER);
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.softDelete(FAKE_ID)).rejects.toThrow('GetCollection failed');
    });
  });

  // ── bulkSoftDelete ────────────────────────────────────────────────────────

  describe('bulkSoftDelete', () => {
    test('finds all customers to be deleted', async () => {
      mockCollection.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([FAKE_CUSTOMER]),
      });
      await repository.bulkSoftDelete([FAKE_ID]);
      expect(mockCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: { $in: expect.any(Array) },
          license: BaseModel.license,
        })
      );
    });

    test('returns { deletedCount: 0 } when no customers found', async () => {
      mockCollection.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });
      const r = await repository.bulkSoftDelete([FAKE_ID]);
      expect(r).toEqual({ deletedCount: 0 });
    });

    test('backs up to recycle_bin collection', async () => {
      mockCollection.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([FAKE_CUSTOMER]),
      });
      await repository.bulkSoftDelete([FAKE_ID]);
      expect(mockRecycleCollection.insertMany).toHaveBeenCalled();
    });

    test('calls deleteMany on main collection', async () => {
      mockCollection.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([FAKE_CUSTOMER]),
      });
      await repository.bulkSoftDelete([FAKE_ID]);
      expect(mockCollection.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: { $in: expect.any(Array) },
          license: BaseModel.license,
        })
      );
    });

    test('returns { deletedCount, modifiedCount }', async () => {
      mockCollection.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([FAKE_CUSTOMER]),
      });
      const r = await repository.bulkSoftDelete([FAKE_ID]);
      expect(r).toEqual({ deletedCount: 1, modifiedCount: 1 });
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.bulkSoftDelete([FAKE_ID])).rejects.toThrow('GetCollection failed');
    });
  });

  // ── getSummary ────────────────────────────────────────────────────────────

  describe('getSummary', () => {
    test('calls findOne to get customer', async () => {
      await repository.getSummary(FAKE_ID);
      expect(mockCollection.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: expect.any(Object),
          license: BaseModel.license,
          is_deleted: { $ne: true },
        })
      );
    });

    test('returns null when customer not found', async () => {
      mockCollection.findOne.mockResolvedValueOnce(null);
      const r = await repository.getSummary(FAKE_ID);
      expect(r).toBeNull();
    });

    test('calls sales collection aggregate for sales summary', async () => {
      mockCollection.findOne.mockResolvedValueOnce(FAKE_CUSTOMER);
      await repository.getSummary(FAKE_ID);
      expect(repository.getCollection).toHaveBeenCalledWith('sales');
      expect(mockSalesCollection.aggregate).toHaveBeenCalled();
    });

    test('returns customer with sales summary', async () => {
      mockCollection.findOne.mockResolvedValueOnce(FAKE_CUSTOMER);
      mockSalesCollection.aggregate.mockReturnValueOnce({
        toArray: jest
          .fn()
          .mockResolvedValue([{ totalSales: 5, totalAmount: 1000, totalPaid: 800, totalDue: 200 }]),
      });
      const r = await repository.getSummary(FAKE_ID);
      expect(r).toEqual({
        customer: FAKE_CUSTOMER,
        totalSales: 5,
        totalAmount: 1000,
        totalPaid: 800,
        totalDue: 200,
      });
    });

    test('returns default summary when no sales data', async () => {
      mockCollection.findOne.mockResolvedValueOnce(FAKE_CUSTOMER);
      mockSalesCollection.aggregate.mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([]),
      });
      const r = await repository.getSummary(FAKE_ID);
      expect(r).toEqual({
        customer: FAKE_CUSTOMER,
        totalSales: 0,
        totalAmount: 0,
        totalPaid: 0,
        totalDue: 0,
      });
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.getSummary(FAKE_ID)).rejects.toThrow('GetCollection failed');
    });
  });

  // ── updateTotalsAfterSale ────────────────────────────────────────────────

  describe('updateTotalsAfterSale', () => {
    test('returns null when customerId not provided', async () => {
      const r = await repository.updateTotalsAfterSale({});
      expect(r).toBeNull();
    });

    test('calls updateOne with $inc for total_purchases', async () => {
      await repository.updateTotalsAfterSale({ customerId: FAKE_ID, saleTotal: 100 });
      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { _id: expect.any(Object) },
        expect.objectContaining({
          $inc: { total_purchases: 100 },
        })
      );
    });

    test('includes $set for last_purchase when provided', async () => {
      const lastPurchaseDate = new Date('2026-01-01');
      await repository.updateTotalsAfterSale({
        customerId: FAKE_ID,
        saleTotal: 100,
        lastPurchaseDate,
      });
      expect(mockCollection.updateOne).toHaveBeenCalledWith(
        { _id: expect.any(Object) },
        expect.objectContaining({
          $inc: { total_purchases: 100 },
          $set: { last_purchase: lastPurchaseDate },
        })
      );
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.updateTotalsAfterSale({ customerId: FAKE_ID })).rejects.toThrow(
        'GetCollection failed'
      );
    });
  });

  // ── findByLoyaltyTier ─────────────────────────────────────────────────────

  describe('findByLoyaltyTier', () => {
    test('calls collection.find with loyalty.tier filter', async () => {
      await repository.findByLoyaltyTier('gold');
      expect(mockCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          'loyalty.tier': 'gold',
          license: BaseModel.license,
          is_deleted: { $ne: true },
        })
      );
    });

    test('applies pagination', async () => {
      await repository.findByLoyaltyTier('gold', { page: 2, limit: 5 });
      const query = mockCollection.find.mock.results[0].value;
      expect(query.skip).toHaveBeenCalledWith(5);
      expect(query.limit).toHaveBeenCalledWith(5);
    });

    test('returns { data, total } object', async () => {
      mockCollection.find.mockReturnValueOnce({
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([FAKE_CUSTOMER]),
      });
      mockCollection.countDocuments.mockResolvedValueOnce(1);
      const r = await repository.findByLoyaltyTier('gold');
      expect(r).toEqual({ data: [FAKE_CUSTOMER], total: 1 });
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.findByLoyaltyTier('gold')).rejects.toThrow('GetCollection failed');
    });
  });

  // ── updateLoyaltyPoints ───────────────────────────────────────────────────

  describe('updateLoyaltyPoints', () => {
    test('calls findOneAndUpdate with $inc for add operation', async () => {
      await repository.updateLoyaltyPoints(FAKE_ID, 10, 'add');
      expect(mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: expect.any(Object),
          license: BaseModel.license,
          is_deleted: { $ne: true },
        }),
        { $inc: { 'loyalty.points': 10 } },
        { returnDocument: 'after' }
      );
    });

    test('calls findOneAndUpdate with $inc for subtract operation', async () => {
      await repository.updateLoyaltyPoints(FAKE_ID, 10, 'subtract');
      expect(mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: expect.any(Object),
          license: BaseModel.license,
          is_deleted: { $ne: true },
        }),
        { $inc: { 'loyalty.points': -10 } },
        { returnDocument: 'after' }
      );
    });

    test('returns the updated document', async () => {
      const r = await repository.updateLoyaltyPoints(FAKE_ID, 10);
      expect(r).toEqual(FAKE_CUSTOMER);
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.updateLoyaltyPoints(FAKE_ID, 10)).rejects.toThrow(
        'GetCollection failed'
      );
    });
  });

  // ── getOutstandingReport ───────────────────────────────────────────────────

  describe('getOutstandingReport', () => {
    test('calls sales collection aggregate', async () => {
      await repository.getOutstandingReport({}, { branchIds: [FAKE_BRANCH_ID] });
      expect(repository.getCollection).toHaveBeenCalledWith('sales');
      expect(mockSalesCollection.aggregate).toHaveBeenCalled();
    });

    test('includes branchIds in match stage when provided', async () => {
      await repository.getOutstandingReport({}, { branchIds: [FAKE_BRANCH_ID] });
      const pipeline = mockSalesCollection.aggregate.mock.calls[0][0];
      const matchStage = pipeline.find((stage) => stage.$match);
      expect(matchStage.$match.branch_id).toBeDefined();
    });

    test('applies pagination', async () => {
      await repository.getOutstandingReport({}, { page: 2, limit: 5 });
      const pipeline = mockSalesCollection.aggregate.mock.calls[0][0];
      expect(pipeline).toContainEqual({ $skip: 5 });
      expect(pipeline).toContainEqual({ $limit: 5 });
    });

    test('returns aggregated results', async () => {
      mockSalesCollection.aggregate.mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([{ _id: FAKE_ID, totalDue: 100 }]),
      });
      const r = await repository.getOutstandingReport({});
      expect(r).toEqual([{ _id: FAKE_ID, totalDue: 100 }]);
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.getOutstandingReport({})).rejects.toThrow('GetCollection failed');
    });
  });

  // ── getDataChanges ────────────────────────────────────────────────────────

  describe('getDataChanges', () => {
    test('calls collection.find with updated_date filter', async () => {
      await repository.getDataChanges('2026-01-01');
      expect(mockCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          license: BaseModel.license,
          updated_date: { $gte: expect.any(Date) },
        })
      );
    });

    test('returns array of changed customers', async () => {
      mockCollection.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([FAKE_CUSTOMER]),
      });
      const r = await repository.getDataChanges('2026-01-01');
      expect(r).toEqual([FAKE_CUSTOMER]);
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.getDataChanges('2026-01-01')).rejects.toThrow('GetCollection failed');
    });
  });

  // ── bulkCreate ───────────────────────────────────────────────────────────

  describe('bulkCreate', () => {
    test('omits blank emails from imported customers', async () => {
      mockCollection.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });
      await repository.bulkCreate([{ name: 'A', phone: '1', email: '' }]);
      expect(mockCollection.insertMany.mock.calls[0][0][0]).not.toHaveProperty('email');
    });
    const CUSTOMERS_DATA = [
      { name: 'Customer 1', email: 'c1@example.com' },
      { name: 'Customer 2', email: 'c2@example.com' },
    ];

    test('calls insertMany with data plus license, timestamps, and is_deleted', async () => {
      await repository.bulkCreate(CUSTOMERS_DATA);
      expect(mockCollection.insertMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            license: BaseModel.license,
            created_date: expect.any(Date),
            updated_date: expect.any(Date),
            is_deleted: false,
          }),
        ])
      );
    });

    test('calls find to retrieve inserted documents', async () => {
      await repository.bulkCreate(CUSTOMERS_DATA);
      expect(mockCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: { $in: expect.any(Array) },
        })
      );
    });

    test('returns inserted documents', async () => {
      mockCollection.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([FAKE_CUSTOMER]),
      });
      const r = await repository.bulkCreate(CUSTOMERS_DATA);
      expect(r).toEqual([FAKE_CUSTOMER]);
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.bulkCreate(CUSTOMERS_DATA)).rejects.toThrow('GetCollection failed');
    });
  });

  // ── exportData ────────────────────────────────────────────────────────────

  describe('exportData', () => {
    test('calls collection.find with projection', async () => {
      await repository.exportData({});
      expect(mockCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          license: BaseModel.license,
          is_deleted: { $ne: true },
        }),
        expect.objectContaining({
          projection: expect.objectContaining({
            name: 1,
            email: 1,
            phone: 1,
            address: 1,
          }),
        })
      );
    });

    test('returns array of customers', async () => {
      mockCollection.find.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([FAKE_CUSTOMER]),
      });
      const r = await repository.exportData({});
      expect(r).toEqual([FAKE_CUSTOMER]);
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.exportData({})).rejects.toThrow('GetCollection failed');
    });
  });

  // ── getPaymentDetails ─────────────────────────────────────────────────────

  describe('getPaymentDetails', () => {
    test('calls findOne to get customer', async () => {
      await repository.getPaymentDetails(FAKE_ID);
      expect(mockCollection.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: expect.any(Object),
          license: BaseModel.license,
          is_deleted: { $ne: true },
        })
      );
    });

    test('returns { wallet: 0, sales: [] } when customer not found', async () => {
      mockCollection.findOne.mockResolvedValueOnce(null);
      const r = await repository.getPaymentDetails(FAKE_ID);
      expect(r).toEqual({ wallet: 0, sales: [] });
    });

    test('calls sales collection find for partially paid sales', async () => {
      mockCollection.findOne.mockResolvedValueOnce(FAKE_CUSTOMER);
      await repository.getPaymentDetails(FAKE_ID);
      expect(repository.getCollection).toHaveBeenCalledWith('sales');
      expect(mockSalesCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          customer_id: expect.any(Object),
          payment_status: 'Partialy Paid',
          license: BaseModel.license,
        })
      );
    });

    test('returns wallet balance and formatted sales', async () => {
      mockCollection.findOne.mockResolvedValueOnce({ ...FAKE_CUSTOMER, balance: 500 });
      const mockSale = {
        _id: FAKE_ID,
        sales_id: 'SALE001',
        updated_date: new Date('2026-01-01T14:30:00.000Z'),
        payment_pending: 100,
        partial_balance: 50,
      };
      mockSalesCollection.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([mockSale]),
      });
      const r = await repository.getPaymentDetails(FAKE_ID);
      expect(r.wallet).toBe(500);
      expect(r.sales).toHaveLength(1);
      expect(r.sales[0]).toHaveProperty('date');
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.getPaymentDetails(FAKE_ID)).rejects.toThrow('GetCollection failed');
    });
  });

  // ── getTransactions ───────────────────────────────────────────────────────

  describe('getTransactions', () => {
    test('calls sales collection find with customer_id', async () => {
      await repository.getTransactions(FAKE_ID);
      expect(repository.getCollection).toHaveBeenCalledWith('sales');
      expect(mockSalesCollection.find).toHaveBeenCalledWith(
        expect.objectContaining({
          customer_id: expect.any(Object),
          license: BaseModel.license,
          is_deleted: { $ne: true },
        })
      );
    });

    test('applies pagination', async () => {
      await repository.getTransactions(FAKE_ID, { page: 2, limit: 5 });
      const query = mockSalesCollection.find.mock.results[0].value;
      expect(query.skip).toHaveBeenCalledWith(5);
      expect(query.limit).toHaveBeenCalledWith(5);
    });

    test('returns { data, total } object', async () => {
      mockSalesCollection.find.mockReturnValueOnce({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([FAKE_CUSTOMER]),
      });
      mockSalesCollection.countDocuments.mockResolvedValueOnce(1);
      const r = await repository.getTransactions(FAKE_ID);
      expect(r).toEqual({ data: [FAKE_CUSTOMER], total: 1 });
    });

    test('rethrows error from getCollection', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('GetCollection failed'));
      await expect(repository.getTransactions(FAKE_ID)).rejects.toThrow('GetCollection failed');
    });
  });

  // ── getCustomerGraphicalReports ─────────────────────────────────────────────

  describe('getCustomerGraphicalReports', () => {
    const params = {
      branchIds: [FAKE_BRANCH_ID],
      startingDate: '2026-01-01',
      endingDate: '2026-12-31',
      customerId: FAKE_ID,
    };

    test('calls BaseModel helper methods for date parsing', async () => {
      await repository.getCustomerGraphicalReports(params);
      expect(BaseModel.startingDate).toHaveBeenCalledWith('2026-01-01', 'Asia/Kolkata');
      expect(BaseModel.endingDate).toHaveBeenCalledWith('2026-12-31', 'Asia/Kolkata');
    });

    test('calls sales collection aggregate', async () => {
      await repository.getCustomerGraphicalReports(params);
      expect(repository.getCollection).toHaveBeenCalledWith('sales');
      expect(mockSalesCollection.aggregate).toHaveBeenCalled();
    });

    test('returns empty array when no sales data', async () => {
      mockSalesCollection.aggregate.mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([]),
      });
      const r = await repository.getCustomerGraphicalReports(params);
      expect(r).toEqual({
        status: true,
        data: [],
        message: '',
      });
    });

    test('returns sales data indexed by day of week', async () => {
      mockSalesCollection.aggregate.mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([
          { _id: 1, totalValue: 10 },
          { _id: 2, totalValue: 20 },
        ]),
      });
      const r = await repository.getCustomerGraphicalReports(params);
      expect(r.status).toBe(true);
      expect(r.data).toHaveLength(7);
      expect(r.data[0]).toHaveProperty('week');
      expect(r.data[0]).toHaveProperty('sales');
    });

    test('returns error object on exception', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('Aggregation failed'));
      const r = await repository.getCustomerGraphicalReports(params);
      expect(r.status).toBe(false);
      expect(r.message).toBe('Aggregation failed');
    });
  });

  // ── getCustomerOutstandingReport ────────────────────────────────────────────

  describe('getCustomerOutstandingReport', () => {
    const params = {
      branchIds: [FAKE_BRANCH_ID],
      startingDate: '2026-01-01',
      endingDate: '2026-12-31',
      customerId: FAKE_ID,
      page: 1,
      limit: 5,
    };

    test('calls transaction collection aggregate', async () => {
      await repository.getCustomerOutstandingReport(params);
      expect(repository.getCollection).toHaveBeenCalledWith('transaction');
      expect(mockTransactionCollection.aggregate).toHaveBeenCalled();
    });

    test('includes license filter when BaseModel.license is set', async () => {
      BaseModel.license = FAKE_LICENSE_ID;
      await repository.getCustomerOutstandingReport(params);
      const pipeline = mockTransactionCollection.aggregate.mock.calls[0][0];
      const matchStage = pipeline.find((stage) => stage.$match);
      expect(matchStage.$match.$and[1].license).toBeDefined();
    });

    test('includes customer_id filter when provided', async () => {
      await repository.getCustomerOutstandingReport(params);
      const pipeline = mockTransactionCollection.aggregate.mock.calls[0][0];
      const matchStage = pipeline[0].$match;
      expect(matchStage.$and).toContainEqual({ customer_id: expect.any(Object) });
    });

    test('applies pagination', async () => {
      await repository.getCustomerOutstandingReport(params);
      const pipeline = mockTransactionCollection.aggregate.mock.calls[0][0];
      expect(pipeline).toContainEqual({ $skip: 0 });
      expect(pipeline).toContainEqual({ $limit: 5 });
    });

    test('returns formatted transaction data', async () => {
      mockTransactionCollection.aggregate.mockReturnValueOnce({
        toArray: jest.fn().mockResolvedValue([
          {
            _id: { customer_id: FAKE_ID, customer_name: 'Test Customer' },
            totalInAmount: 1000,
            totalOutAmount: 500,
            totalPendingAmount: 200,
            totalAmountDue: 500,
            due: 200,
          },
        ]),
      });
      const r = await repository.getCustomerOutstandingReport(params);
      expect(r.status).toBe(true);
      expect(r.data.list).toHaveLength(1);
      expect(r.data.list[0]).toHaveProperty('credit');
      expect(r.data.list[0]).toHaveProperty('debit');
      expect(r.data.list[0]).toHaveProperty('wallet');
      expect(r.data.list[0]).toHaveProperty('pending');
      expect(r.data.list[0]).toHaveProperty('due');
    });

    test('returns error object on exception', async () => {
      repository.getCollection.mockRejectedValueOnce(new Error('Report failed'));
      const r = await repository.getCustomerOutstandingReport(params);
      expect(r.status).toBe(false);
      expect(r.message).toBe('Report failed');
    });
  });
});
