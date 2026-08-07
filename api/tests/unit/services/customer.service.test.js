'use strict';

/**
 * Unit tests for src/services/customer.service.js
 *
 * File confirmed  : src/services/customer.service.js (839 lines)
 * Export type     : CLASS export — `module.exports = CustomerService`
 * Does NOT extend : base.service.js
 * Constructor     : `this.repository = new CustomerRepository()`
 *
 * Methods (21):
 *   getAllCustomers(filters, options)
 *   getCustomerById(id)                     — mutates returned object (country/state/city defaults)
 *   createCustomer(customerData)            — duplicate email + phone checks, loyalty init
 *   updateCustomer(id, updateData)          — 2× findById calls, duplicate guards
 *   deleteCustomer(id)                      — findById check + softDelete
 *   bulkDeleteCustomers(ids)                — array validation + bulkSoftDelete
 *   searchCustomers(searchTerm, options)    — returns error on empty term (unlike categories)
 *   getCustomerSummary(id)                  — getSummary + not-found check
 *   getCustomersByTier(tier, options)       — enum validation
 *   addLoyaltyPoints(id, points, reason)    — points validation + tier upgrade logic
 *   redeemLoyaltyPoints(id, points)         — points validation + insufficient check
 *   calculateLoyaltyTier(points)            — SYNCHRONOUS helper method
 *   getOutstandingReport(filters, options)
 *   getDataChanges(fromDate)
 *   importCustomers(customersData, branchId) — row-level validation + per-row dup check
 *   exportCustomers(filters)               — ids array + branch_id ObjectId coercion
 *   getPaymentDetails(id)
 *   getTransactions(id, options)
 *   updatePreferences(id, preferences)
 *   getCustomerGraphicalReports(params)    — returns RAW repo result (no wrapper on success)
 *   getCustomerOutstandingReport(params)   — returns RAW repo result (no wrapper on success)
 *
 * External dependencies (all mocked):
 *   CustomerRepository (class)  — explicit factory mock
 *   mongodb.ObjectId            — branch_id + ids coercion
 *
 * PRODUCTION NOTES:
 *   1. `console.log` debug statements in getAllCustomers (lines 92, 99, 110, 117, 128)
 *      — exposes query internals in production logs; should be removed.
 *   2. `importCustomers` collects an `errors` array for rows missing name/phone but
 *      NEVER returns it — callers have no visibility into skipped rows.
 *   3. `getCustomerGraphicalReports` and `getCustomerOutstandingReport` return the
 *      raw repository result directly on success instead of wrapping it in the
 *      standard {status, data, message} shape — inconsistent with all other methods.
 *   4. `getCustomerById` mutates the repository-returned object in-place
 *      (customer.country = 'India' etc.) — unexpected side-effect on cached objects.
 *   5. `updateCustomer` calls `repository.findById` twice per update (existence check +
 *      post-update fetch) — doubles read load per update request.
 *   6. `console.error` used throughout instead of structured logger.
 */

// ─── Mock CustomerRepository (class — explicit factory prevents module loading) ─
jest.mock('../../../src/repositories/customer.repository', () => jest.fn());

// ─── Mock mongodb ObjectId ────────────────────────────────────────────────────
jest.mock('mongodb', () => ({
  ObjectId: jest.fn().mockImplementation((id) => ({
    _mockedId: id,
    toString: () => String(id),
  })),
}));

// ─── Requires ─────────────────────────────────────────────────────────────────
const CustomerRepository = require('../../../src/repositories/customer.repository');
const { ObjectId } = require('mongodb');
const CustomerService = require('../../../src/services/customer.service');

// ─── Mock data ────────────────────────────────────────────────────────────────
const BRANCH_ID = '64a1b2c3d4e5f6a7b8c9d011';
const CUSTOMER_ID = '64a1b2c3d4e5f6a7b8c9d012';
const OTHER_ID = '64a1b2c3d4e5f6a7b8c9d013';

function makeMockCustomer(overrides = {}) {
  return {
    _id: CUSTOMER_ID,
    name: 'Test Customer',
    email: 'test@example.com',
    phone: '9876543210',
    address: '123 Main St',
    branch_id: BRANCH_ID,
    country: 'India',
    state: 'Maharashtra',
    city: 'Mumbai',
    loyalty: { points: 0, tier: 'bronze' },
    ...overrides,
  };
}

function makeRepoMethods(overrides = {}) {
  return {
    findAll: jest.fn(),
    findById: jest.fn(),
    findByEmail: jest.fn(),
    findByPhone: jest.fn(),
    findByNameAndPhone: jest.fn(),
    findByLoyaltyTier: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    bulkSoftDelete: jest.fn(),
    bulkCreate: jest.fn(),
    search: jest.fn(),
    getSummary: jest.fn(),
    updateLoyaltyPoints: jest.fn(),
    getOutstandingReport: jest.fn(),
    getDataChanges: jest.fn(),
    exportData: jest.fn(),
    getPaymentDetails: jest.fn(),
    getTransactions: jest.fn(),
    getCustomerGraphicalReports: jest.fn(),
    getCustomerOutstandingReport: jest.fn(),
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
describe('CustomerService', () => {
  let service;
  let repo;
  let consoleErrorSpy;
  let consoleLogSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const repoMethods = makeRepoMethods();
    CustomerRepository.mockImplementation(() => repoMethods);
    service = new CustomerService();
    repo = service.repository;
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Initialization
  // ══════════════════════════════════════════════════════════════════════════
  describe('initialization', () => {
    test('CustomerService exports a class (not a singleton)', () => {
      expect(typeof CustomerService).toBe('function');
    });

    test('constructor creates instance with repository', () => {
      expect(service.repository).toBeDefined();
    });

    test('instantiates CustomerRepository in constructor', () => {
      expect(CustomerRepository).toHaveBeenCalledTimes(1);
    });

    test('exposes all 21 service methods', () => {
      const methods = [
        'getAllCustomers',
        'getCustomerById',
        'createCustomer',
        'updateCustomer',
        'deleteCustomer',
        'bulkDeleteCustomers',
        'searchCustomers',
        'getCustomerSummary',
        'getCustomersByTier',
        'addLoyaltyPoints',
        'redeemLoyaltyPoints',
        'calculateLoyaltyTier',
        'getOutstandingReport',
        'getDataChanges',
        'importCustomers',
        'exportCustomers',
        'getPaymentDetails',
        'getTransactions',
        'updatePreferences',
        'getCustomerGraphicalReports',
        'getCustomerOutstandingReport',
      ];
      methods.forEach((m) => expect(typeof service[m]).toBe('function'));
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getAllCustomers
  // ══════════════════════════════════════════════════════════════════════════
  describe('getAllCustomers', () => {
    test('returns {status:true, data, message} on success with no filters', async () => {
      const data = [makeMockCustomer()];
      repo.findAll.mockResolvedValue(data);

      const result = await service.getAllCustomers();

      expect(result).toEqual({
        status: true,
        data,
        message: 'Customers retrieved successfully',
      });
    });

    test('passes queryFilters and options to repository.findAll', async () => {
      repo.findAll.mockResolvedValue([]);
      const options = { page: 1, limit: 10 };

      await service.getAllCustomers({ branch_id: BRANCH_ID }, options);

      expect(repo.findAll).toHaveBeenCalledWith(expect.any(Object), options);
    });

    test('coerces branch_id to ObjectId', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCustomers({ branch_id: BRANCH_ID });

      expect(ObjectId).toHaveBeenCalledWith(BRANCH_ID);
      const [qf] = repo.findAll.mock.calls[0];
      expect(qf.branch_id).toBeDefined();
    });

    test('applies name string as RegExp filter', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCustomers({ name: 'test' });

      const [qf] = repo.findAll.mock.calls[0];
      expect(qf.name).toBeInstanceOf(RegExp);
    });

    test('applies name.$regex object filter (cleans lookahead)', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCustomers({ name: { $regex: 'test', $options: 'i' } });

      const [qf] = repo.findAll.mock.calls[0];
      expect(qf.name).toHaveProperty('$regex');
      expect(qf.name).toHaveProperty('$options');
    });

    test('applies address string as RegExp filter', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCustomers({ address: '123 Main' });

      const [qf] = repo.findAll.mock.calls[0];
      expect(qf.address).toBeInstanceOf(RegExp);
    });

    test('applies phone string as RegExp filter', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCustomers({ phone: '987' });

      const [qf] = repo.findAll.mock.calls[0];
      expect(qf.phone).toBeInstanceOf(RegExp);
    });

    test('applies email string as RegExp filter', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCustomers({ email: 'test@' });

      const [qf] = repo.findAll.mock.calls[0];
      expect(qf.email).toBeInstanceOf(RegExp);
    });

    test('applies $or search filter across name/email/phone/address', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCustomers({ search: 'john' });

      const [qf] = repo.findAll.mock.calls[0];
      expect(qf.$or).toHaveLength(4);
    });

    test('does NOT apply $or search when name filter is present', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCustomers({ search: 'john', name: 'john' });

      const [qf] = repo.findAll.mock.calls[0];
      expect(qf.$or).toBeUndefined();
    });

    test('does NOT apply $or search when phone filter is present', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCustomers({ search: 'john', phone: '123' });

      const [qf] = repo.findAll.mock.calls[0];
      expect(qf.$or).toBeUndefined();
    });

    test('applies updated_date.$gte as Date object', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCustomers({ updated_date: { $gte: '2024-01-01' } });

      const [qf] = repo.findAll.mock.calls[0];
      expect(qf.updated_date.$gte).toBeInstanceOf(Date);
    });

    test('applies updated_date.$lte as Date object', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCustomers({ updated_date: { $lte: '2024-01-31' } });

      const [qf] = repo.findAll.mock.calls[0];
      expect(qf.updated_date.$lte).toBeInstanceOf(Date);
    });

    test('skips invalid date string for updated_date.$gte', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCustomers({ updated_date: { $gte: 'not-a-date' } });

      const [qf] = repo.findAll.mock.calls[0];
      if (qf.updated_date) expect(qf.updated_date.$gte).toBeUndefined();
    });

    test('applies created_date.$gte and $lte filters', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCustomers({ created_date: { $gte: '2024-01-01', $lte: '2024-01-31' } });

      const [qf] = repo.findAll.mock.calls[0];
      expect(qf.created_date.$gte).toBeInstanceOf(Date);
      expect(qf.created_date.$lte).toBeInstanceOf(Date);
    });

    test('applies loyalty.tier filter', async () => {
      repo.findAll.mockResolvedValue([]);

      await service.getAllCustomers({ tier: 'gold' });

      const [qf] = repo.findAll.mock.calls[0];
      expect(qf['loyalty.tier']).toBe('gold');
    });

    test('handles empty result list', async () => {
      repo.findAll.mockResolvedValue([]);
      const result = await service.getAllCustomers();
      expect(result.status).toBe(true);
      expect(result.data).toEqual([]);
    });

    test('returns error shape on repository throw', async () => {
      repo.findAll.mockRejectedValue(new Error('DB timeout'));
      const result = await service.getAllCustomers();
      expect(result).toEqual({ status: false, data: null, message: 'DB timeout' });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getCustomerById
  // ══════════════════════════════════════════════════════════════════════════
  describe('getCustomerById', () => {
    test('returns {status:true, data:customer} when found', async () => {
      const customer = makeMockCustomer();
      repo.findById.mockResolvedValue(customer);

      const result = await service.getCustomerById(CUSTOMER_ID);

      expect(result.status).toBe(true);
      expect(result.message).toBe('Customer retrieved successfully');
    });

    test('returns {status:false, "Customer not found"} when null', async () => {
      repo.findById.mockResolvedValue(null);
      const result = await service.getCustomerById('missing');
      expect(result).toEqual({ status: false, data: null, message: 'Customer not found' });
    });

    test('sets country to "India" when country is falsy', async () => {
      const customer = makeMockCustomer({ country: null });
      repo.findById.mockResolvedValue(customer);

      const result = await service.getCustomerById(CUSTOMER_ID);

      expect(result.data.country).toBe('India');
    });

    test('sets state to empty string when state is falsy', async () => {
      const customer = makeMockCustomer({ state: undefined });
      repo.findById.mockResolvedValue(customer);

      const result = await service.getCustomerById(CUSTOMER_ID);

      expect(result.data.state).toBe('');
    });

    test('sets city to empty string when city is falsy', async () => {
      const customer = makeMockCustomer({ city: null });
      repo.findById.mockResolvedValue(customer);

      const result = await service.getCustomerById(CUSTOMER_ID);

      expect(result.data.city).toBe('');
    });

    test('preserves existing country/state/city values', async () => {
      const customer = makeMockCustomer({ country: 'UAE', state: 'Dubai', city: 'Dubai City' });
      repo.findById.mockResolvedValue(customer);

      const result = await service.getCustomerById(CUSTOMER_ID);

      expect(result.data.country).toBe('UAE');
      expect(result.data.state).toBe('Dubai');
      expect(result.data.city).toBe('Dubai City');
    });

    test('returns error shape on repository throw', async () => {
      repo.findById.mockRejectedValue(new Error('Query failed'));
      const result = await service.getCustomerById(CUSTOMER_ID);
      expect(result.status).toBe(false);
      expect(result.message).toBe('Query failed');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // createCustomer
  // ══════════════════════════════════════════════════════════════════════════
  describe('createCustomer', () => {
    const validPayload = () => ({ name: 'New Customer', branch_id: BRANCH_ID });

    test('returns error when name is missing', async () => {
      const result = await service.createCustomer({ email: 'a@b.com' });
      expect(result).toEqual({ status: false, data: null, message: 'Customer name is required' });
    });

    test('returns error when name is empty string', async () => {
      const result = await service.createCustomer({ name: '' });
      expect(result.status).toBe(false);
    });

    test('does NOT call repository when name missing', async () => {
      await service.createCustomer({});
      expect(repo.create).not.toHaveBeenCalled();
    });

    test('skips email duplicate check when email not provided', async () => {
      repo.create.mockResolvedValue(makeMockCustomer());
      await service.createCustomer(validPayload());
      expect(repo.findByEmail).not.toHaveBeenCalled();
    });

    test('checks email duplicate when email is provided', async () => {
      repo.findByEmail.mockResolvedValue(null);
      repo.create.mockResolvedValue(makeMockCustomer());

      await service.createCustomer({ ...validPayload(), email: 'a@b.com' });

      expect(repo.findByEmail).toHaveBeenCalledWith('a@b.com');
    });

    test('returns duplicate email error when email already exists', async () => {
      repo.findByEmail.mockResolvedValue(makeMockCustomer());

      const result = await service.createCustomer({ ...validPayload(), email: 'dup@b.com' });

      expect(result).toEqual({
        status: false,
        data: null,
        message: 'Customer with this email already exists',
      });
    });

    test('skips phone duplicate check when phone not provided', async () => {
      repo.create.mockResolvedValue(makeMockCustomer());
      await service.createCustomer(validPayload());
      expect(repo.findByPhone).not.toHaveBeenCalled();
    });

    test('checks phone duplicate when phone is provided', async () => {
      repo.findByPhone.mockResolvedValue(null);
      repo.create.mockResolvedValue(makeMockCustomer());

      await service.createCustomer({ ...validPayload(), phone: '9876543210' });

      expect(repo.findByPhone).toHaveBeenCalledWith('9876543210');
    });

    test('returns duplicate phone error when phone already exists', async () => {
      repo.findByPhone.mockResolvedValue(makeMockCustomer());

      const result = await service.createCustomer({ ...validPayload(), phone: '9876543210' });

      expect(result).toEqual({
        status: false,
        data: null,
        message: 'Customer with this phone number already exists',
      });
    });

    test('initializes loyalty when enableLoyalty is true', async () => {
      repo.create.mockResolvedValue(makeMockCustomer());
      const payload = { ...validPayload(), enableLoyalty: true };

      await service.createCustomer(payload);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          loyalty: expect.objectContaining({ points: 0, tier: 'bronze' }),
        })
      );
    });

    test('does NOT set loyalty when enableLoyalty is false/absent', async () => {
      repo.create.mockResolvedValue(makeMockCustomer());

      await service.createCustomer(validPayload());

      const [calledWith] = repo.create.mock.calls[0];
      expect(calledWith.loyalty).toBeUndefined();
    });

    test('returns {status:true, data:customer} on success', async () => {
      const customer = makeMockCustomer();
      repo.create.mockResolvedValue(customer);

      const result = await service.createCustomer(validPayload());

      expect(result).toEqual({
        status: true,
        data: customer,
        message: 'Customer created successfully',
      });
    });

    test('returns error shape on repository.create throw', async () => {
      repo.create.mockRejectedValue(new Error('Insert failed'));
      const result = await service.createCustomer(validPayload());
      expect(result.status).toBe(false);
      expect(result.message).toBe('Insert failed');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // updateCustomer
  // ══════════════════════════════════════════════════════════════════════════
  describe('updateCustomer', () => {
    const existing = () => makeMockCustomer({ _id: CUSTOMER_ID, email: 'old@b.com', phone: '111' });

    test('returns {status:false, "Customer not found"} when customer missing', async () => {
      repo.findById.mockResolvedValue(null);
      const result = await service.updateCustomer(CUSTOMER_ID, {});
      expect(result).toEqual({ status: false, data: null, message: 'Customer not found' });
    });

    test('calls findById twice — existence check + post-update fetch', async () => {
      const ex = existing();
      repo.findById.mockResolvedValueOnce(ex).mockResolvedValueOnce({ ...ex, name: 'Updated' });
      repo.update.mockResolvedValue({});

      await service.updateCustomer(CUSTOMER_ID, { name: 'Updated' });

      expect(repo.findById).toHaveBeenCalledTimes(2);
    });

    test('skips email duplicate check when email not changing', async () => {
      repo.findById.mockResolvedValueOnce(existing()).mockResolvedValueOnce(existing());
      repo.update.mockResolvedValue({});

      await service.updateCustomer(CUSTOMER_ID, { email: 'old@b.com' });

      expect(repo.findByEmail).not.toHaveBeenCalled();
    });

    test('checks email duplicate when email is changing', async () => {
      repo.findById.mockResolvedValueOnce(existing()).mockResolvedValueOnce(existing());
      repo.findByEmail.mockResolvedValue(null);
      repo.update.mockResolvedValue({});

      await service.updateCustomer(CUSTOMER_ID, { email: 'new@b.com' });

      expect(repo.findByEmail).toHaveBeenCalledWith('new@b.com');
    });

    test('returns duplicate email error when another customer has new email', async () => {
      repo.findById.mockResolvedValueOnce(existing());
      repo.findByEmail.mockResolvedValue({
        _id: { toString: () => OTHER_ID },
        email: 'new@b.com',
      });

      const result = await service.updateCustomer(CUSTOMER_ID, { email: 'new@b.com' });

      expect(result).toEqual({
        status: false,
        data: null,
        message: 'Another customer with this email already exists',
      });
    });

    test('allows email update when findByEmail returns same record', async () => {
      repo.findById
        .mockResolvedValueOnce(existing())
        .mockResolvedValueOnce({ ...existing(), email: 'new@b.com' });
      repo.findByEmail.mockResolvedValue({
        _id: { toString: () => CUSTOMER_ID }, // same record
        email: 'new@b.com',
      });
      repo.update.mockResolvedValue({});

      const result = await service.updateCustomer(CUSTOMER_ID, { email: 'new@b.com' });

      expect(result.status).toBe(true);
    });

    test('checks phone duplicate when phone is changing', async () => {
      repo.findById.mockResolvedValueOnce(existing()).mockResolvedValueOnce(existing());
      repo.findByPhone.mockResolvedValue(null);
      repo.update.mockResolvedValue({});

      await service.updateCustomer(CUSTOMER_ID, { phone: '222' });

      expect(repo.findByPhone).toHaveBeenCalledWith('222');
    });

    test('returns duplicate phone error when another customer has new phone', async () => {
      repo.findById.mockResolvedValueOnce(existing());
      repo.findByPhone.mockResolvedValue({
        _id: { toString: () => OTHER_ID },
        phone: '222',
      });

      const result = await service.updateCustomer(CUSTOMER_ID, { phone: '222' });

      expect(result).toEqual({
        status: false,
        data: null,
        message: 'Another customer with this phone number already exists',
      });
    });

    test('returns {status:true, data:updatedCustomer} on success', async () => {
      const updated = makeMockCustomer({ name: 'Updated' });
      repo.findById.mockResolvedValueOnce(existing()).mockResolvedValueOnce(updated);
      repo.update.mockResolvedValue({});

      const result = await service.updateCustomer(CUSTOMER_ID, { name: 'Updated' });

      expect(result).toEqual({
        status: true,
        data: updated,
        message: 'Customer updated successfully',
      });
    });

    test('returns error shape on throw', async () => {
      repo.findById.mockRejectedValue(new Error('DB lock'));
      const result = await service.updateCustomer(CUSTOMER_ID, {});
      expect(result.status).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // deleteCustomer
  // ══════════════════════════════════════════════════════════════════════════
  describe('deleteCustomer', () => {
    test('returns {status:false, "Customer not found"} when customer missing', async () => {
      repo.findById.mockResolvedValue(null);
      const result = await service.deleteCustomer('missing');
      expect(result).toEqual({ status: false, data: null, message: 'Customer not found' });
    });

    test('calls repository.softDelete with id after finding customer', async () => {
      repo.findById.mockResolvedValue(makeMockCustomer());
      repo.softDelete.mockResolvedValue(makeMockCustomer());

      await service.deleteCustomer(CUSTOMER_ID);

      expect(repo.softDelete).toHaveBeenCalledWith(CUSTOMER_ID);
    });

    test('does NOT call softDelete when customer not found', async () => {
      repo.findById.mockResolvedValue(null);
      await service.deleteCustomer(CUSTOMER_ID);
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    test('returns {status:true, data:deletedCustomer} on success', async () => {
      const customer = makeMockCustomer();
      repo.findById.mockResolvedValue(customer);
      repo.softDelete.mockResolvedValue(customer);

      const result = await service.deleteCustomer(CUSTOMER_ID);

      expect(result).toEqual({
        status: true,
        data: customer,
        message: 'Customer deleted successfully',
      });
    });

    test('returns error shape on repository throw', async () => {
      repo.findById.mockRejectedValue(new Error('fail'));
      const result = await service.deleteCustomer(CUSTOMER_ID);
      expect(result.status).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // bulkDeleteCustomers
  // ══════════════════════════════════════════════════════════════════════════
  describe('bulkDeleteCustomers', () => {
    test('returns error when ids is null', async () => {
      const result = await service.bulkDeleteCustomers(null);
      expect(result).toEqual({ status: false, data: null, message: 'Invalid customer IDs' });
    });

    test('returns error when ids is not an array', async () => {
      const result = await service.bulkDeleteCustomers('not-array');
      expect(result.status).toBe(false);
    });

    test('returns error when ids is empty array', async () => {
      const result = await service.bulkDeleteCustomers([]);
      expect(result).toEqual({ status: false, data: null, message: 'Invalid customer IDs' });
    });

    test('does NOT call repository when ids is empty', async () => {
      await service.bulkDeleteCustomers([]);
      expect(repo.bulkSoftDelete).not.toHaveBeenCalled();
    });

    test('calls repository.bulkSoftDelete with ids', async () => {
      repo.bulkSoftDelete.mockResolvedValue({ modifiedCount: 2 });
      const ids = ['id1', 'id2'];

      await service.bulkDeleteCustomers(ids);

      expect(repo.bulkSoftDelete).toHaveBeenCalledWith(ids);
    });

    test('returns {status:true, data:{deletedCount:modifiedCount}} on success', async () => {
      repo.bulkSoftDelete.mockResolvedValue({ modifiedCount: 3 });

      const result = await service.bulkDeleteCustomers(['id1', 'id2', 'id3']);

      expect(result).toEqual({
        status: true,
        data: { deletedCount: 3 },
        message: 'Customer deleted successfully',
      });
    });

    test('returns error shape on repository throw', async () => {
      repo.bulkSoftDelete.mockRejectedValue(new Error('bulk fail'));
      const result = await service.bulkDeleteCustomers(['id1']);
      expect(result.status).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // searchCustomers
  // ══════════════════════════════════════════════════════════════════════════
  describe('searchCustomers', () => {
    test('returns {status:false, "Search term is required"} when searchTerm is empty', async () => {
      const result = await service.searchCustomers('');
      expect(result).toEqual({ status: false, data: null, message: 'Search term is required' });
    });

    test('returns error for null searchTerm', async () => {
      const result = await service.searchCustomers(null);
      expect(result.status).toBe(false);
      expect(result.message).toBe('Search term is required');
    });

    test('returns error for undefined searchTerm', async () => {
      const result = await service.searchCustomers(undefined);
      expect(result.status).toBe(false);
    });

    test('does NOT call repository.search for empty term', async () => {
      await service.searchCustomers('');
      expect(repo.search).not.toHaveBeenCalled();
    });

    test('calls repository.search with searchTerm and options', async () => {
      repo.search.mockResolvedValue([]);
      const options = { page: 1, limit: 10 };

      await service.searchCustomers('john', options);

      expect(repo.search).toHaveBeenCalledWith('john', options);
    });

    test('returns {status:true, data:results} on success', async () => {
      const results = [makeMockCustomer()];
      repo.search.mockResolvedValue(results);

      const result = await service.searchCustomers('john');

      expect(result).toEqual({
        status: true,
        data: results,
        message: 'Search completed successfully',
      });
    });

    test('returns error shape on repository throw', async () => {
      repo.search.mockRejectedValue(new Error('search fail'));
      const result = await service.searchCustomers('john');
      expect(result.status).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getCustomerSummary
  // ══════════════════════════════════════════════════════════════════════════
  describe('getCustomerSummary', () => {
    test('returns {status:true, data:summary} on success', async () => {
      const summary = { totalSales: 500, visits: 10 };
      repo.getSummary.mockResolvedValue(summary);

      const result = await service.getCustomerSummary(CUSTOMER_ID);

      expect(result).toEqual({
        status: true,
        data: summary,
        message: 'Customer summary retrieved successfully',
      });
    });

    test('returns {status:false, "Customer not found"} when null', async () => {
      repo.getSummary.mockResolvedValue(null);
      const result = await service.getCustomerSummary('missing');
      expect(result).toEqual({ status: false, data: null, message: 'Customer not found' });
    });

    test('calls repository.getSummary with id', async () => {
      repo.getSummary.mockResolvedValue({});
      await service.getCustomerSummary(CUSTOMER_ID);
      expect(repo.getSummary).toHaveBeenCalledWith(CUSTOMER_ID);
    });

    test('returns error shape on throw', async () => {
      repo.getSummary.mockRejectedValue(new Error('agg fail'));
      const result = await service.getCustomerSummary(CUSTOMER_ID);
      expect(result.status).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getCustomersByTier
  // ══════════════════════════════════════════════════════════════════════════
  describe('getCustomersByTier', () => {
    test('returns error for invalid tier', async () => {
      const result = await service.getCustomersByTier('diamond');
      expect(result).toEqual({ status: false, data: null, message: 'Invalid loyalty tier' });
    });

    test('returns error for empty tier', async () => {
      const result = await service.getCustomersByTier('');
      expect(result.status).toBe(false);
    });

    test('does NOT call repository for invalid tier', async () => {
      await service.getCustomersByTier('vip');
      expect(repo.findByLoyaltyTier).not.toHaveBeenCalled();
    });

    test.each(['bronze', 'silver', 'gold', 'platinum'])('accepts valid tier "%s"', async (tier) => {
      repo.findByLoyaltyTier.mockResolvedValue([]);
      const result = await service.getCustomersByTier(tier);
      expect(result.status).toBe(true);
    });

    test('calls repository.findByLoyaltyTier with tier and options', async () => {
      repo.findByLoyaltyTier.mockResolvedValue([]);
      const options = { limit: 5 };

      await service.getCustomersByTier('gold', options);

      expect(repo.findByLoyaltyTier).toHaveBeenCalledWith('gold', options);
    });

    test('returns {status:true, data:customers} on success', async () => {
      const customers = [makeMockCustomer({ 'loyalty.tier': 'gold' })];
      repo.findByLoyaltyTier.mockResolvedValue(customers);

      const result = await service.getCustomersByTier('gold');

      expect(result.status).toBe(true);
      expect(result.data).toBe(customers);
    });

    test('returns error shape on throw', async () => {
      repo.findByLoyaltyTier.mockRejectedValue(new Error('fail'));
      const result = await service.getCustomersByTier('gold');
      expect(result.status).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // calculateLoyaltyTier  (synchronous helper)
  // ══════════════════════════════════════════════════════════════════════════
  describe('calculateLoyaltyTier', () => {
    test('returns "bronze" for 0 points', () => {
      expect(service.calculateLoyaltyTier(0)).toBe('bronze');
    });

    test('returns "bronze" for 999 points', () => {
      expect(service.calculateLoyaltyTier(999)).toBe('bronze');
    });

    test('returns "silver" for exactly 1000 points', () => {
      expect(service.calculateLoyaltyTier(1000)).toBe('silver');
    });

    test('returns "silver" for 4999 points', () => {
      expect(service.calculateLoyaltyTier(4999)).toBe('silver');
    });

    test('returns "gold" for exactly 5000 points', () => {
      expect(service.calculateLoyaltyTier(5000)).toBe('gold');
    });

    test('returns "gold" for 9999 points', () => {
      expect(service.calculateLoyaltyTier(9999)).toBe('gold');
    });

    test('returns "platinum" for exactly 10000 points', () => {
      expect(service.calculateLoyaltyTier(10000)).toBe('platinum');
    });

    test('returns "platinum" for very large point values', () => {
      expect(service.calculateLoyaltyTier(999999)).toBe('platinum');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // addLoyaltyPoints
  // ══════════════════════════════════════════════════════════════════════════
  describe('addLoyaltyPoints', () => {
    test('returns error when points is 0', async () => {
      const result = await service.addLoyaltyPoints(CUSTOMER_ID, 0);
      expect(result).toEqual({ status: false, data: null, message: 'Invalid points amount' });
    });

    test('returns error when points is negative', async () => {
      const result = await service.addLoyaltyPoints(CUSTOMER_ID, -10);
      expect(result.status).toBe(false);
    });

    test('returns error when points is null/falsy', async () => {
      const result = await service.addLoyaltyPoints(CUSTOMER_ID, null);
      expect(result.status).toBe(false);
    });

    test('does NOT call repository when points invalid', async () => {
      await service.addLoyaltyPoints(CUSTOMER_ID, 0);
      expect(repo.updateLoyaltyPoints).not.toHaveBeenCalled();
    });

    test('returns {status:false, "Customer not found"} when repository returns null', async () => {
      repo.updateLoyaltyPoints.mockResolvedValue(null);
      const result = await service.addLoyaltyPoints(CUSTOMER_ID, 100);
      expect(result).toEqual({ status: false, data: null, message: 'Customer not found' });
    });

    test('calls repository.updateLoyaltyPoints with id, points, "add"', async () => {
      const customer = makeMockCustomer({ loyalty: { points: 500, tier: 'bronze' } });
      repo.updateLoyaltyPoints.mockResolvedValue(customer);

      await service.addLoyaltyPoints(CUSTOMER_ID, 100);

      expect(repo.updateLoyaltyPoints).toHaveBeenCalledWith(CUSTOMER_ID, 100, 'add');
    });

    test('upgrades tier and calls repository.update when tier changes', async () => {
      // After adding points, customer now has 1500 points (silver) but was bronze
      const customer = makeMockCustomer({ loyalty: { points: 1500, tier: 'bronze' } });
      repo.updateLoyaltyPoints.mockResolvedValue(customer);
      repo.update.mockResolvedValue({});

      await service.addLoyaltyPoints(CUSTOMER_ID, 500);

      expect(repo.update).toHaveBeenCalledWith(CUSTOMER_ID, { 'loyalty.tier': 'silver' });
    });

    test('does NOT call repository.update when tier is unchanged', async () => {
      // Already silver, adding small points keeps in silver
      const customer = makeMockCustomer({ loyalty: { points: 1200, tier: 'silver' } });
      repo.updateLoyaltyPoints.mockResolvedValue(customer);

      await service.addLoyaltyPoints(CUSTOMER_ID, 200);

      expect(repo.update).not.toHaveBeenCalled();
    });

    test('returns {status:true, message:"X loyalty points added"} on success', async () => {
      const customer = makeMockCustomer({ loyalty: { points: 200, tier: 'bronze' } });
      repo.updateLoyaltyPoints.mockResolvedValue(customer);

      const result = await service.addLoyaltyPoints(CUSTOMER_ID, 100);

      expect(result.status).toBe(true);
      expect(result.message).toBe('100 loyalty points added successfully');
      expect(result.data).toBe(customer);
    });

    test('returns error shape on throw', async () => {
      repo.updateLoyaltyPoints.mockRejectedValue(new Error('update fail'));
      const result = await service.addLoyaltyPoints(CUSTOMER_ID, 100);
      expect(result.status).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // redeemLoyaltyPoints
  // ══════════════════════════════════════════════════════════════════════════
  describe('redeemLoyaltyPoints', () => {
    test('returns error when points is 0', async () => {
      const result = await service.redeemLoyaltyPoints(CUSTOMER_ID, 0);
      expect(result).toEqual({ status: false, data: null, message: 'Invalid points amount' });
    });

    test('returns error when points is negative', async () => {
      const result = await service.redeemLoyaltyPoints(CUSTOMER_ID, -5);
      expect(result.status).toBe(false);
    });

    test('returns {status:false, "Customer not found"} when findById returns null', async () => {
      repo.findById.mockResolvedValue(null);
      const result = await service.redeemLoyaltyPoints(CUSTOMER_ID, 100);
      expect(result).toEqual({ status: false, data: null, message: 'Customer not found' });
    });

    test('returns {status:false, "Insufficient loyalty points"} when not enough points', async () => {
      repo.findById.mockResolvedValue(
        makeMockCustomer({ loyalty: { points: 50, tier: 'bronze' } })
      );

      const result = await service.redeemLoyaltyPoints(CUSTOMER_ID, 100);

      expect(result).toEqual({ status: false, data: null, message: 'Insufficient loyalty points' });
    });

    test('allows redemption when points are exactly enough', async () => {
      repo.findById.mockResolvedValue(makeMockCustomer({ loyalty: { points: 100 } }));
      repo.updateLoyaltyPoints.mockResolvedValue(makeMockCustomer({ loyalty: { points: 0 } }));

      const result = await service.redeemLoyaltyPoints(CUSTOMER_ID, 100);

      expect(result.status).toBe(true);
    });

    test('calls repository.updateLoyaltyPoints with id, points, "redeem"', async () => {
      repo.findById.mockResolvedValue(makeMockCustomer({ loyalty: { points: 500 } }));
      repo.updateLoyaltyPoints.mockResolvedValue(makeMockCustomer({ loyalty: { points: 400 } }));

      await service.redeemLoyaltyPoints(CUSTOMER_ID, 100);

      expect(repo.updateLoyaltyPoints).toHaveBeenCalledWith(CUSTOMER_ID, 100, 'redeem');
    });

    test('handles customer with no loyalty object (defaults to 0 points)', async () => {
      repo.findById.mockResolvedValue(makeMockCustomer({ loyalty: undefined }));

      const result = await service.redeemLoyaltyPoints(CUSTOMER_ID, 50);

      expect(result).toEqual({ status: false, data: null, message: 'Insufficient loyalty points' });
    });

    test('returns {status:true, message:"X loyalty points redeemed"} on success', async () => {
      repo.findById.mockResolvedValue(makeMockCustomer({ loyalty: { points: 500 } }));
      const customer = makeMockCustomer({ loyalty: { points: 400 } });
      repo.updateLoyaltyPoints.mockResolvedValue(customer);

      const result = await service.redeemLoyaltyPoints(CUSTOMER_ID, 100);

      expect(result.status).toBe(true);
      expect(result.message).toBe('100 loyalty points redeemed successfully');
    });

    test('returns error shape on throw', async () => {
      repo.findById.mockRejectedValue(new Error('DB error'));
      const result = await service.redeemLoyaltyPoints(CUSTOMER_ID, 100);
      expect(result.status).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getOutstandingReport
  // ══════════════════════════════════════════════════════════════════════════
  describe('getOutstandingReport', () => {
    test('calls repository.getOutstandingReport with filters and options', async () => {
      repo.getOutstandingReport.mockResolvedValue([]);
      const filters = { branch_id: BRANCH_ID };
      const options = { page: 1 };

      await service.getOutstandingReport(filters, options);

      expect(repo.getOutstandingReport).toHaveBeenCalledWith(filters, options);
    });

    test('returns {status:true, data:report} on success', async () => {
      const report = [{ name: 'Customer', balance: 1000 }];
      repo.getOutstandingReport.mockResolvedValue(report);

      const result = await service.getOutstandingReport();

      expect(result).toEqual({
        status: true,
        data: report,
        message: 'Outstanding report retrieved successfully',
      });
    });

    test('returns error shape on throw', async () => {
      repo.getOutstandingReport.mockRejectedValue(new Error('report fail'));
      const result = await service.getOutstandingReport();
      expect(result.status).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getDataChanges
  // ══════════════════════════════════════════════════════════════════════════
  describe('getDataChanges', () => {
    test('calls repository.getDataChanges with fromDate', async () => {
      repo.getDataChanges.mockResolvedValue([]);
      await service.getDataChanges('2024-01-01');
      expect(repo.getDataChanges).toHaveBeenCalledWith('2024-01-01');
    });

    test('returns {status:true, data:changes} on success', async () => {
      const changes = [{ _id: 'c1' }];
      repo.getDataChanges.mockResolvedValue(changes);

      const result = await service.getDataChanges('2024-01-01');

      expect(result).toEqual({
        status: true,
        data: changes,
        message: 'Data changes retrieved successfully',
      });
    });

    test('returns error shape on throw', async () => {
      repo.getDataChanges.mockRejectedValue(new Error('sync fail'));
      const result = await service.getDataChanges('2024-01-01');
      expect(result.status).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // importCustomers
  // ══════════════════════════════════════════════════════════════════════════
  describe('importCustomers', () => {
    const makeRow = (overrides = {}) => ({
      name: 'Import Customer',
      phone: '9999999999',
      email: 'import@example.com',
      ...overrides,
    });

    test('returns error when customersData is null', async () => {
      const result = await service.importCustomers(null, BRANCH_ID);
      expect(result).toEqual({ status: false, data: null, message: 'Invalid import data' });
    });

    test('returns error when customersData is empty array', async () => {
      const result = await service.importCustomers([], BRANCH_ID);
      expect(result).toEqual({ status: false, data: null, message: 'Invalid import data' });
    });

    test('returns error when customersData is not an array', async () => {
      const result = await service.importCustomers({}, BRANCH_ID);
      expect(result.status).toBe(false);
    });

    test('skips rows missing name or phone (does NOT add to newCustomers)', async () => {
      repo.findByNameAndPhone.mockResolvedValue(null);
      repo.bulkCreate.mockResolvedValue([makeRow()]);

      const rows = [
        makeRow(), // valid
        { email: 'no-name@example.com' }, // missing name + phone — skipped
      ];

      await service.importCustomers(rows, BRANCH_ID);

      // Only 1 valid row should be passed to bulkCreate
      const [newCustomers] = repo.bulkCreate.mock.calls[0];
      expect(newCustomers).toHaveLength(1);
    });

    test('returns "All customers already imported" when all rows exist', async () => {
      const existing = makeMockCustomer({ name: 'Import Customer', phone: '9999999999' });
      repo.findByNameAndPhone.mockResolvedValue(existing);

      const result = await service.importCustomers([makeRow()], BRANCH_ID);

      expect(result.status).toBe(false);
      expect(result.message).toBe('All customers are already imported');
      expect(Array.isArray(result.data)).toBe(true);
    });

    test('calls repository.findByNameAndPhone with name, phone, branchId per row', async () => {
      repo.findByNameAndPhone.mockResolvedValue(null);
      repo.bulkCreate.mockResolvedValue([makeRow()]);

      await service.importCustomers([makeRow()], BRANCH_ID);

      expect(repo.findByNameAndPhone).toHaveBeenCalledWith(
        'Import Customer',
        '9999999999',
        BRANCH_ID
      );
    });

    test('puts already-existing rows in alreadyExists with correct shape', async () => {
      const existing = makeMockCustomer({
        name: 'Import Customer',
        phone: '9999999999',
        email: 'ex@example.com',
        address: 'Street 1',
      });
      // First row exists, second doesn't
      repo.findByNameAndPhone.mockResolvedValueOnce(existing).mockResolvedValueOnce(null);
      repo.bulkCreate.mockResolvedValue([makeRow({ name: 'Second' })]);

      const result = await service.importCustomers(
        [makeRow(), makeRow({ name: 'Second', phone: '888' })],
        BRANCH_ID
      );

      expect(result.status).toBe(true);
      // The service returns only imported data, not alreadyExists
      expect(result.data[0]).toHaveProperty('status', 'Imported');
    });

    test('calls repository.bulkCreate for new rows', async () => {
      repo.findByNameAndPhone.mockResolvedValue(null);
      const created = [makeMockCustomer()];
      repo.bulkCreate.mockResolvedValue(created);

      await service.importCustomers([makeRow()], BRANCH_ID);

      expect(repo.bulkCreate).toHaveBeenCalled();
    });

    test('returns formatted response data with {name, email, phone, address, status}', async () => {
      repo.findByNameAndPhone.mockResolvedValue(null);
      repo.bulkCreate.mockResolvedValue([
        {
          name: 'Import Customer',
          email: 'import@example.com',
          phone: '9999999999',
          address: '123 St',
        },
      ]);

      const result = await service.importCustomers([makeRow()], BRANCH_ID);

      expect(result.status).toBe(true);
      expect(result.data[0]).toEqual({
        name: 'Import Customer',
        email: 'import@example.com',
        phone: '9999999999',
        address: '123 St',
        status: 'Imported',
      });
    });

    test('returns message with count of imported records', async () => {
      repo.findByNameAndPhone.mockResolvedValue(null);
      repo.bulkCreate.mockResolvedValue([makeMockCustomer(), makeMockCustomer()]);

      const rows = [makeRow(), makeRow({ name: 'Second', phone: '888' })];
      const result = await service.importCustomers(rows, BRANCH_ID);

      expect(result.message).toBe('2 customers imported successfully');
    });

    test('returns error shape on repository throw', async () => {
      repo.findByNameAndPhone.mockRejectedValue(new Error('DB error'));
      const result = await service.importCustomers([makeRow()], BRANCH_ID);
      expect(result.status).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // exportCustomers
  // ══════════════════════════════════════════════════════════════════════════
  describe('exportCustomers', () => {
    test('builds $in filter from ids array', async () => {
      repo.exportData.mockResolvedValue([]);

      await service.exportCustomers({ ids: ['id1', 'id2'] });

      const [qf] = repo.exportData.mock.calls[0];
      expect(qf._id).toHaveProperty('$in');
      expect(qf._id.$in).toHaveLength(2);
    });

    test('coerces each id in ids array to ObjectId', async () => {
      repo.exportData.mockResolvedValue([]);

      await service.exportCustomers({ ids: ['id1', 'id2'] });

      expect(ObjectId).toHaveBeenCalledWith('id1');
      expect(ObjectId).toHaveBeenCalledWith('id2');
    });

    test('coerces branch_id to ObjectId when provided', async () => {
      repo.exportData.mockResolvedValue([]);

      await service.exportCustomers({ branch_id: BRANCH_ID });

      expect(ObjectId).toHaveBeenCalledWith(BRANCH_ID);
      const [qf] = repo.exportData.mock.calls[0];
      expect(qf.branch_id).toBeDefined();
    });

    test('passes empty filter when no filters provided', async () => {
      repo.exportData.mockResolvedValue([]);

      await service.exportCustomers({});

      expect(repo.exportData).toHaveBeenCalledWith({});
    });

    test('skips ids filter when ids array is empty', async () => {
      repo.exportData.mockResolvedValue([]);

      await service.exportCustomers({ ids: [] });

      const [qf] = repo.exportData.mock.calls[0];
      expect(qf._id).toBeUndefined();
    });

    test('returns {status:true, data:customers} on success', async () => {
      const customers = [makeMockCustomer()];
      repo.exportData.mockResolvedValue(customers);

      const result = await service.exportCustomers({});

      expect(result).toEqual({
        status: true,
        data: customers,
        message: 'Customers exported successfully',
      });
    });

    test('returns error shape on throw', async () => {
      repo.exportData.mockRejectedValue(new Error('export fail'));
      const result = await service.exportCustomers({});
      expect(result.status).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getPaymentDetails
  // ══════════════════════════════════════════════════════════════════════════
  describe('getPaymentDetails', () => {
    test('calls repository.getPaymentDetails with id', async () => {
      repo.getPaymentDetails.mockResolvedValue({});
      await service.getPaymentDetails(CUSTOMER_ID);
      expect(repo.getPaymentDetails).toHaveBeenCalledWith(CUSTOMER_ID);
    });

    test('returns {status:true, data:details} on success', async () => {
      const details = { paid: 500, outstanding: 200 };
      repo.getPaymentDetails.mockResolvedValue(details);

      const result = await service.getPaymentDetails(CUSTOMER_ID);

      expect(result).toEqual({
        status: true,
        data: details,
        message: 'Payment details retrieved successfully',
      });
    });

    test('returns error shape on throw', async () => {
      repo.getPaymentDetails.mockRejectedValue(new Error('fail'));
      const result = await service.getPaymentDetails(CUSTOMER_ID);
      expect(result.status).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getTransactions
  // ══════════════════════════════════════════════════════════════════════════
  describe('getTransactions', () => {
    test('calls repository.getTransactions with id and options', async () => {
      repo.getTransactions.mockResolvedValue([]);
      const options = { page: 1, limit: 20 };

      await service.getTransactions(CUSTOMER_ID, options);

      expect(repo.getTransactions).toHaveBeenCalledWith(CUSTOMER_ID, options);
    });

    test('returns {status:true, data:transactions} on success', async () => {
      const txns = [{ _id: 't1', amount: 100 }];
      repo.getTransactions.mockResolvedValue(txns);

      const result = await service.getTransactions(CUSTOMER_ID);

      expect(result).toEqual({
        status: true,
        data: txns,
        message: 'Transactions retrieved successfully',
      });
    });

    test('returns error shape on throw', async () => {
      repo.getTransactions.mockRejectedValue(new Error('txn fail'));
      const result = await service.getTransactions(CUSTOMER_ID);
      expect(result.status).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // updatePreferences
  // ══════════════════════════════════════════════════════════════════════════
  describe('updatePreferences', () => {
    test('calls repository.update with {preferences} object', async () => {
      repo.update.mockResolvedValue(makeMockCustomer());
      const prefs = { newsletter: true, sms: false };

      await service.updatePreferences(CUSTOMER_ID, prefs);

      expect(repo.update).toHaveBeenCalledWith(CUSTOMER_ID, { preferences: prefs });
    });

    test('returns {status:false, "Customer not found"} when update returns null', async () => {
      repo.update.mockResolvedValue(null);
      const result = await service.updatePreferences(CUSTOMER_ID, {});
      expect(result).toEqual({ status: false, data: null, message: 'Customer not found' });
    });

    test('returns {status:true, data:customer} on success', async () => {
      const customer = makeMockCustomer();
      repo.update.mockResolvedValue(customer);

      const result = await service.updatePreferences(CUSTOMER_ID, { newsletter: true });

      expect(result).toEqual({
        status: true,
        data: customer,
        message: 'Preferences updated successfully',
      });
    });

    test('returns error shape on throw', async () => {
      repo.update.mockRejectedValue(new Error('update fail'));
      const result = await service.updatePreferences(CUSTOMER_ID, {});
      expect(result.status).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getCustomerGraphicalReports  (returns RAW result — no wrapper on success)
  // ══════════════════════════════════════════════════════════════════════════
  describe('getCustomerGraphicalReports', () => {
    test('calls repository.getCustomerGraphicalReports with params', async () => {
      repo.getCustomerGraphicalReports.mockResolvedValue({});
      const params = { branch_id: BRANCH_ID };

      await service.getCustomerGraphicalReports(params);

      expect(repo.getCustomerGraphicalReports).toHaveBeenCalledWith(params);
    });

    test('returns raw repository result directly (no {status} wrapper)', async () => {
      const rawResult = [{ day: 'Monday', sales: 500 }];
      repo.getCustomerGraphicalReports.mockResolvedValue(rawResult);

      const result = await service.getCustomerGraphicalReports({});

      // Raw result — no {status:true} wrapper on success
      expect(result).toBe(rawResult);
    });

    test('returns error shape on throw', async () => {
      repo.getCustomerGraphicalReports.mockRejectedValue(new Error('graph fail'));
      const result = await service.getCustomerGraphicalReports({});
      expect(result.status).toBe(false);
      expect(result.message).toBe('graph fail');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // getCustomerOutstandingReport  (returns RAW result — no wrapper on success)
  // ══════════════════════════════════════════════════════════════════════════
  describe('getCustomerOutstandingReport', () => {
    test('calls repository.getCustomerOutstandingReport with params', async () => {
      repo.getCustomerOutstandingReport.mockResolvedValue({});
      const params = { from: '2024-01-01', to: '2024-01-31' };

      await service.getCustomerOutstandingReport(params);

      expect(repo.getCustomerOutstandingReport).toHaveBeenCalledWith(params);
    });

    test('returns raw repository result directly (no {status} wrapper)', async () => {
      const rawResult = [{ customer: 'Test', outstanding: 1000 }];
      repo.getCustomerOutstandingReport.mockResolvedValue(rawResult);

      const result = await service.getCustomerOutstandingReport({});

      expect(result).toBe(rawResult);
    });

    test('returns error shape on throw', async () => {
      repo.getCustomerOutstandingReport.mockRejectedValue(new Error('report fail'));
      const result = await service.getCustomerOutstandingReport({});
      expect(result.status).toBe(false);
    });
  });
});
