'use strict';

/**
 * Unit tests for src/services/receiving.service.js
 *
 * File confirmed  : src/services/receiving.service.js (658 lines, class export)
 * Export type     : CLASS export — `module.exports = ReceivingService`
 * Does NOT extend base.service.js.
 *
 * Constructor:
 *   `this.repository          = new ReceivingRepository()`
 *   `this.stockLogsRepository = new StockLogsRepository()`
 *   `this.itemRepository      = new ItemRepository()`
 *
 * Methods (12):
 *   getAllReceivings(filters, options)
 *   getReceivingById(id)
 *   getReceivingByReceivingId(receivingId)
 *   createReceiving(receivingData)         — validation + stock log integration
 *   updateReceiving(id, updateData)        — validation + stock log integration
 *   returnReceiving(receivingId, returnData) — stock log integration (subtract)
 *   deleteReceiving(id)                    — hard delete
 *   bulkDeleteReceivings(ids)
 *   getReceivingsBySupplier(supplierId, options)
 *   getReceivingsByBranch(branchId, options)
 *   getReceivingsByStatus(status, options)
 *   getReceivingsByPaymentStatus(paymentStatus, options)
 *   exportReceivings(ids)
 *
 * External dependencies (all mocked):
 *   ReceivingRepository  — class, mocked per-test
 *   StockLogsRepository  — class, mocked per-test
 *   ItemRepository       — class, mocked per-test
 *   BaseModel            — static: database (collection.findOne), currentBranch,
 *                          loggedUser, loggedUserName, license
 *   mongodb ObjectId     — mocked
 *
 * PRODUCTION ISSUES FOUND:
 *   1. `BaseModel.database.collection('branches').findOne(...)` — Direct static DB
 *      access inside service methods (createReceiving, updateReceiving, returnReceiving).
 *      This tightly couples the service to a live DB connection on every call.
 *      Recommend injecting a branchRepository or accepting a context object.
 *   2. `BaseModel.currentBranch` / `BaseModel.loggedUser` — Global mutable state;
 *      concurrent requests can corrupt each other's context in a multi-tenant scenario.
 *   3. Stock log errors are silently caught per-item — a partial stock log failure
 *      leaves inventory in an inconsistent state with no rollback.
 *   4. `console.log` debug statements left in createReceiving, updateReceiving,
 *      returnReceiving — these expose internal state to production logs.
 *   5. `updateReceiving` stock log uses `closingBalance = openingBalance + itemQuantity`
 *      (same as create) — no check for duplicate stock logging if called twice.
 */

// ─── Mock ReceivingRepository (class) ────────────────────────────────────────
jest.mock('../../../src/repositories/receiving.repository', () => jest.fn());

// ─── Mock StockLogsRepository (class) ────────────────────────────────────────
jest.mock('../../../src/repositories/stock-log.repository', () => jest.fn());

// ─── Mock ItemRepository (class) ─────────────────────────────────────────────
jest.mock('../../../src/repositories/item.repository', () => jest.fn());

// ─── Mock BaseModel ───────────────────────────────────────────────────────────
// The service accesses: BaseModel.database.collection(...).findOne(...)
//                       BaseModel.currentBranch
//                       BaseModel.loggedUser
//                       BaseModel.loggedUserName
const mockBranchFindOne = jest.fn();
const mockCollection = jest.fn().mockReturnValue({ findOne: mockBranchFindOne });

jest.mock('../../../src/models/base.model', () => {
  const MockBaseModel = jest.fn();
  MockBaseModel.database = { collection: mockCollection };
  MockBaseModel.currentBranch = 'branch_obj_id_mock';
  MockBaseModel.loggedUser = 'user_obj_id_mock';
  MockBaseModel.loggedUserName = 'Test User';
  MockBaseModel.license = 'license_mock';
  return MockBaseModel;
});

// ─── Mock mongodb ObjectId ────────────────────────────────────────────────────
jest.mock('mongodb', () => {
  const mockObjectId = jest.fn().mockImplementation((id) => ({
    _mockId: id,
    toString: () => String(id),
  }));
  mockObjectId.isValid = jest.fn().mockReturnValue(true);
  return { ObjectId: mockObjectId };
});

// ─── Imports (after mocks) ────────────────────────────────────────────────────
const ReceivingRepository = require('../../../src/repositories/receiving.repository');
const StockLogsRepository = require('../../../src/repositories/stock-log.repository');
const ItemRepository = require('../../../src/repositories/item.repository');
const BaseModel = require('../../../src/models/base.model');
const { ObjectId } = require('mongodb');
const ReceivingService = require('../../../src/services/receiving.service');

const {
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  DEFAULTS,
} = require('../../../src/constants/receivings.constants');

// ─── IDs ──────────────────────────────────────────────────────────────────────
const RECEIVING_ID = 'receiving_id_123';
const SUPPLIER_ID = 'supplier_id_123';
const ITEM_ID = 'item_id_123';
const BRANCH_ID = 'branch_id_123';

// ─── Mock data factories ──────────────────────────────────────────────────────
function makeMockItem(overrides = {}) {
  return {
    _id: ITEM_ID,
    name: 'Test Item',
    barcode_id: 'BC-001',
    track_inventory: true,
    available_quantity: 10,
    ...overrides,
  };
}

function makeMockReceivingItem(overrides = {}) {
  return {
    item_id: ITEM_ID,
    item_name: 'Test Item',
    item_quantity: 5,
    cost_price: 70,
    subtotal: 350,
    ...overrides,
  };
}

function makeMockReceiving(overrides = {}) {
  return {
    _id: RECEIVING_ID,
    receiving_id: 'RID000001',
    supplier: SUPPLIER_ID,
    branch_id: BRANCH_ID,
    items: [makeMockReceivingItem()],
    total: 350,
    paid_amount: 100,
    balance: 250,
    tax: 0,
    discount: 0,
    status: 'draft',
    receiving_status: 'Open',
    payment_status: 'pending',
    payment_method: 'cash',
    is_deleted: false,
    ...overrides,
  };
}

function makePaginatedResult(overrides = {}) {
  return {
    data: [makeMockReceiving()],
    total: 1,
    page: 1,
    limit: 10,
    totalPages: 1,
    ...overrides,
  };
}

function makeRepoMethods(overrides = {}) {
  return {
    findAll: jest.fn(),
    findById: jest.fn(),
    findByReceivingId: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    hardDelete: jest.fn(),
    bulkHardDelete: jest.fn(),
    findBySupplier: jest.fn(),
    findByBranch: jest.fn(),
    findByStatus: jest.fn(),
    findByPaymentStatus: jest.fn(),
    exportByIds: jest.fn(),
    ...overrides,
  };
}

function makeStockLogsRepoMethods(overrides = {}) {
  return {
    createStockLog: jest.fn().mockResolvedValue({ status: true, data: {}, message: 'ok' }),
    ...overrides,
  };
}

function makeItemRepoMethods(overrides = {}) {
  return {
    findById: jest.fn(),
    updateStock: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
describe('ReceivingService', () => {
  let service;
  let repo;
  let stockLogsRepo;
  let itemRepo;
  let consoleErrorSpy;
  let consoleLogSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    // Reset mutable mock implementations
    mockBranchFindOne.mockResolvedValue(null);
    mockCollection.mockReturnValue({ findOne: mockBranchFindOne });

    const repoMethods = makeRepoMethods();
    const stockLogsMethods = makeStockLogsRepoMethods();
    const itemRepoMethods = makeItemRepoMethods();

    ReceivingRepository.mockImplementation(() => repoMethods);
    StockLogsRepository.mockImplementation(() => stockLogsMethods);
    ItemRepository.mockImplementation(() => itemRepoMethods);

    service = new ReceivingService();
    repo = service.repository;
    stockLogsRepo = service.stockLogsRepository;
    itemRepo = service.itemRepository;
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Initialization
  // ════════════════════════════════════════════════════════════════════════════
  describe('initialization', () => {
    test('ReceivingService exports a class (not a singleton)', () => {
      expect(typeof ReceivingService).toBe('function');
    });

    test('new ReceivingService() creates an instance', () => {
      expect(service).toBeInstanceOf(ReceivingService);
    });

    test('instantiates ReceivingRepository in constructor', () => {
      expect(ReceivingRepository).toHaveBeenCalledTimes(1);
      expect(service.repository).toBeDefined();
    });

    test('instantiates StockLogsRepository in constructor', () => {
      expect(StockLogsRepository).toHaveBeenCalledTimes(1);
      expect(service.stockLogsRepository).toBeDefined();
    });

    test('instantiates ItemRepository in constructor', () => {
      expect(ItemRepository).toHaveBeenCalledTimes(1);
      expect(service.itemRepository).toBeDefined();
    });

    test('exposes all 13 service methods', () => {
      const methods = [
        'getAllReceivings',
        'getReceivingById',
        'getReceivingByReceivingId',
        'createReceiving',
        'updateReceiving',
        'returnReceiving',
        'deleteReceiving',
        'bulkDeleteReceivings',
        'getReceivingsBySupplier',
        'getReceivingsByBranch',
        'getReceivingsByStatus',
        'getReceivingsByPaymentStatus',
        'exportReceivings',
      ];
      methods.forEach((m) => expect(typeof service[m]).toBe('function'));
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getAllReceivings
  // ════════════════════════════════════════════════════════════════════════════
  describe('getAllReceivings', () => {
    test('returns {status:true, data, message} on success with no filters', async () => {
      const paged = makePaginatedResult();
      repo.findAll.mockResolvedValue(paged);

      const result = await service.getAllReceivings();

      expect(result.status).toBe(true);
      expect(result.data).toEqual(paged);
      expect(result.message).toBe(SUCCESS_MESSAGES.RECEIVINGS_RETRIEVED);
    });

    test('calls repository.findAll with built queryFilters and options', async () => {
      repo.findAll.mockResolvedValue(makePaginatedResult());

      const options = { page: 2, limit: 20 };
      await service.getAllReceivings({ branch_id: BRANCH_ID }, options);

      const [calledFilters, calledOptions] = repo.findAll.mock.calls[0];
      expect(calledFilters.branch_id).toBeDefined();
      expect(calledOptions).toEqual(options);
    });

    test('coerces branch_id to ObjectId in queryFilters', async () => {
      repo.findAll.mockResolvedValue(makePaginatedResult());

      await service.getAllReceivings({ branch_id: BRANCH_ID });

      expect(ObjectId).toHaveBeenCalledWith(BRANCH_ID);
    });

    test('coerces supplier to ObjectId in queryFilters', async () => {
      repo.findAll.mockResolvedValue(makePaginatedResult());

      await service.getAllReceivings({ supplier: SUPPLIER_ID });

      expect(ObjectId).toHaveBeenCalledWith(SUPPLIER_ID);
    });

    test('includes status filter when provided', async () => {
      repo.findAll.mockResolvedValue(makePaginatedResult());

      await service.getAllReceivings({ status: 'draft' });

      const [calledFilters] = repo.findAll.mock.calls[0];
      expect(calledFilters.status).toBe('draft');
    });

    test('includes payment_status filter when provided', async () => {
      repo.findAll.mockResolvedValue(makePaginatedResult());

      await service.getAllReceivings({ payment_status: 'pending' });

      const [calledFilters] = repo.findAll.mock.calls[0];
      expect(calledFilters.payment_status).toBe('pending');
    });

    test('includes receiving_status filter when provided', async () => {
      repo.findAll.mockResolvedValue(makePaginatedResult());

      await service.getAllReceivings({ receiving_status: 'Open' });

      const [calledFilters] = repo.findAll.mock.calls[0];
      expect(calledFilters.receiving_status).toBe('Open');
    });

    test('builds updated_date range filter when both $gte and $lte are valid dates', async () => {
      repo.findAll.mockResolvedValue(makePaginatedResult());

      await service.getAllReceivings({
        updated_date: {
          $gte: '2024-01-01',
          $lte: '2024-01-31',
        },
      });

      const [calledFilters] = repo.findAll.mock.calls[0];
      expect(calledFilters.updated_date.$gte).toBeInstanceOf(Date);
      expect(calledFilters.updated_date.$lte).toBeInstanceOf(Date);
    });

    test('skips invalid $gte date in updated_date filter', async () => {
      repo.findAll.mockResolvedValue(makePaginatedResult());

      await service.getAllReceivings({
        updated_date: { $gte: 'not-a-date', $lte: '2024-01-31' },
      });

      const [calledFilters] = repo.findAll.mock.calls[0];
      expect(calledFilters.updated_date.$gte).toBeUndefined();
      expect(calledFilters.updated_date.$lte).toBeInstanceOf(Date);
    });

    test('builds created_date range filter when valid', async () => {
      repo.findAll.mockResolvedValue(makePaginatedResult());

      await service.getAllReceivings({
        created_date: {
          $gte: '2024-01-01',
          $lte: '2024-01-31',
        },
      });

      const [calledFilters] = repo.findAll.mock.calls[0];
      expect(calledFilters.created_date.$gte).toBeInstanceOf(Date);
      expect(calledFilters.created_date.$lte).toBeInstanceOf(Date);
    });

    test('returns empty list when repository returns no records', async () => {
      repo.findAll.mockResolvedValue({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 });

      const result = await service.getAllReceivings();

      expect(result.status).toBe(true);
      expect(result.data.data).toEqual([]);
      expect(result.data.total).toBe(0);
    });

    test('returns error when repository throws', async () => {
      repo.findAll.mockRejectedValue(new Error('DB failure'));

      const result = await service.getAllReceivings();

      expect(result.status).toBe(false);
      expect(result.message).toBe('DB failure');
      expect(result.data).toBeNull();
    });

    test('handles null filters gracefully — service catches TypeError and returns status:false', async () => {
      repo.findAll.mockResolvedValue(makePaginatedResult());

      // NOTE: Production issue — accessing null.branch_id throws TypeError.
      // The service catch block handles it and returns status:false.
      await expect(service.getAllReceivings(null)).resolves.toMatchObject({ status: false });
    });

    test('handles undefined filters gracefully', async () => {
      repo.findAll.mockResolvedValue(makePaginatedResult());

      await expect(service.getAllReceivings(undefined)).resolves.toMatchObject({ status: true });
    });

    test('passes options through to repository unchanged', async () => {
      repo.findAll.mockResolvedValue(makePaginatedResult());
      const opts = { page: 3, limit: 5, sort: { created_date: 1 } };

      await service.getAllReceivings({}, opts);

      expect(repo.findAll.mock.calls[0][1]).toEqual(opts);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getReceivingById
  // ════════════════════════════════════════════════════════════════════════════
  describe('getReceivingById', () => {
    test('returns receiving when found', async () => {
      const mockReceiving = makeMockReceiving();
      repo.findById.mockResolvedValue(mockReceiving);

      const result = await service.getReceivingById(RECEIVING_ID);

      expect(result.status).toBe(true);
      expect(result.data).toEqual(mockReceiving);
      expect(result.message).toBe(SUCCESS_MESSAGES.RECEIVING_RETRIEVED);
    });

    test('calls repository.findById with correct id', async () => {
      repo.findById.mockResolvedValue(makeMockReceiving());

      await service.getReceivingById(RECEIVING_ID);

      expect(repo.findById).toHaveBeenCalledWith(RECEIVING_ID);
    });

    test('returns not-found error when repository returns null', async () => {
      repo.findById.mockResolvedValue(null);

      const result = await service.getReceivingById(RECEIVING_ID);

      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.RECEIVING_NOT_FOUND);
      expect(result.data).toBeNull();
    });

    test('returns not-found error when repository returns undefined', async () => {
      repo.findById.mockResolvedValue(undefined);

      const result = await service.getReceivingById(RECEIVING_ID);

      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.RECEIVING_NOT_FOUND);
    });

    test('returns error when repository throws', async () => {
      repo.findById.mockRejectedValue(new Error('Invalid ObjectId'));

      const result = await service.getReceivingById('bad-id');

      expect(result.status).toBe(false);
      expect(result.message).toBe('Invalid ObjectId');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getReceivingByReceivingId
  // ════════════════════════════════════════════════════════════════════════════
  describe('getReceivingByReceivingId', () => {
    test('returns receiving when found by human-readable ID', async () => {
      repo.findByReceivingId.mockResolvedValue(makeMockReceiving());

      const result = await service.getReceivingByReceivingId('RID000001');

      expect(result.status).toBe(true);
      expect(result.message).toBe(SUCCESS_MESSAGES.RECEIVING_RETRIEVED);
    });

    test('calls repository.findByReceivingId with the receivingId', async () => {
      repo.findByReceivingId.mockResolvedValue(makeMockReceiving());

      await service.getReceivingByReceivingId('RID000001');

      expect(repo.findByReceivingId).toHaveBeenCalledWith('RID000001');
    });

    test('returns not-found when repository returns null', async () => {
      repo.findByReceivingId.mockResolvedValue(null);

      const result = await service.getReceivingByReceivingId('RID999999');

      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.RECEIVING_NOT_FOUND);
    });

    test('returns error when repository throws', async () => {
      repo.findByReceivingId.mockRejectedValue(new Error('lookup error'));

      const result = await service.getReceivingByReceivingId('RID000001');

      expect(result.status).toBe(false);
      expect(result.message).toBe('lookup error');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // createReceiving
  // ════════════════════════════════════════════════════════════════════════════
  describe('createReceiving', () => {
    const validData = {
      supplier: SUPPLIER_ID,
      branch_id: BRANCH_ID,
      items: [makeMockReceivingItem()],
      total: 350,
    };

    test('returns error when supplier is missing', async () => {
      const result = await service.createReceiving({ items: [makeMockReceivingItem()] });

      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.SUPPLIER_REQUIRED);
      expect(repo.create).not.toHaveBeenCalled();
    });

    test('returns error when supplier is null', async () => {
      const result = await service.createReceiving({
        supplier: null,
        items: [makeMockReceivingItem()],
      });

      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.SUPPLIER_REQUIRED);
    });

    test('returns error when items is missing', async () => {
      const result = await service.createReceiving({ supplier: SUPPLIER_ID });

      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.ITEMS_REQUIRED);
    });

    test('returns error when items is an empty array', async () => {
      const result = await service.createReceiving({ supplier: SUPPLIER_ID, items: [] });

      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.ITEMS_REQUIRED);
    });

    test('returns error when called with null payload', async () => {
      const result = await service.createReceiving(null);

      expect(result.status).toBe(false);
      expect(result.data).toBeNull();
    });

    test('returns error when called with undefined payload', async () => {
      const result = await service.createReceiving(undefined);

      expect(result.status).toBe(false);
    });

    test('creates receiving with default values when optional fields are absent', async () => {
      const created = makeMockReceiving();
      repo.create.mockResolvedValue(created);

      await service.createReceiving(validData);

      const calledData = repo.create.mock.calls[0][0];
      expect(calledData.status).toBe(DEFAULTS.STATUS);
      expect(calledData.receiving_status).toBe(DEFAULTS.RECEIVING_STATUS);
      expect(calledData.payment_status).toBe(DEFAULTS.PAYMENT_STATUS);
      expect(calledData.payment_method).toBe(DEFAULTS.PAYMENT_METHOD);
      expect(calledData.tax).toBe(DEFAULTS.TAX);
      expect(calledData.discount).toBe(DEFAULTS.DISCOUNT);
    });

    test('preserves provided status, payment_method, tax, discount over defaults', async () => {
      const created = makeMockReceiving();
      repo.create.mockResolvedValue(created);

      await service.createReceiving({
        ...validData,
        status: 'Received',
        payment_method: 'credit',
        tax: 10,
        discount: 5,
      });

      const calledData = repo.create.mock.calls[0][0];
      expect(calledData.status).toBe('Received');
      expect(calledData.payment_method).toBe('credit');
      expect(calledData.tax).toBe(10);
      expect(calledData.discount).toBe(5);
    });

    test('returns {status:true, data:receiving, message} on success', async () => {
      const created = makeMockReceiving();
      repo.create.mockResolvedValue(created);

      const result = await service.createReceiving(validData);

      expect(result.status).toBe(true);
      expect(result.data).toEqual(created);
      expect(result.message).toBe(SUCCESS_MESSAGES.RECEIVING_CREATED);
    });

    test('does NOT trigger stock log when status is not "Received"', async () => {
      repo.create.mockResolvedValue(makeMockReceiving());

      await service.createReceiving({ ...validData, status: 'draft' });

      expect(mockBranchFindOne).not.toHaveBeenCalled();
      expect(stockLogsRepo.createStockLog).not.toHaveBeenCalled();
    });

    test('returns error when repository.create throws', async () => {
      repo.create.mockRejectedValue(new Error('insert failed'));

      const result = await service.createReceiving(validData);

      expect(result.status).toBe(false);
      expect(result.message).toBe('insert failed');
    });

    // ── Stock log integration (status === 'Received') ──────────────────────
    describe('stock log integration when status === "Received"', () => {
      const receivedData = {
        supplier: SUPPLIER_ID,
        branch_id: BRANCH_ID,
        status: 'Received',
        items: [makeMockReceivingItem()],
      };

      test('fetches branch doc to check stock_management setting', async () => {
        repo.create.mockResolvedValue(makeMockReceiving({ status: 'Received' }));
        mockBranchFindOne.mockResolvedValue({ stock_management: false });

        await service.createReceiving(receivedData);

        expect(mockBranchFindOne).toHaveBeenCalledWith({
          _id: BaseModel.currentBranch,
        });
      });

      test('skips stock logs when stock_management is false', async () => {
        repo.create.mockResolvedValue(makeMockReceiving({ status: 'Received' }));
        mockBranchFindOne.mockResolvedValue({ stock_management: false });

        await service.createReceiving(receivedData);

        expect(stockLogsRepo.createStockLog).not.toHaveBeenCalled();
        expect(itemRepo.updateStock).not.toHaveBeenCalled();
      });

      test('skips stock logs when branchDoc is null', async () => {
        repo.create.mockResolvedValue(makeMockReceiving({ status: 'Received' }));
        mockBranchFindOne.mockResolvedValue(null);

        await service.createReceiving(receivedData);

        expect(stockLogsRepo.createStockLog).not.toHaveBeenCalled();
      });

      test('creates stock log and updates stock when stock_management is true and item tracks inventory', async () => {
        repo.create.mockResolvedValue(
          makeMockReceiving({ receiving_id: 'RID000001', status: 'Received' })
        );
        mockBranchFindOne.mockResolvedValue({ stock_management: true });
        itemRepo.findById.mockResolvedValue(
          makeMockItem({ track_inventory: true, available_quantity: 10 })
        );

        await service.createReceiving(receivedData);

        expect(stockLogsRepo.createStockLog).toHaveBeenCalledWith(
          expect.objectContaining({
            process: 'Add Receiving',
            action: 'Add',
            opening_balance: 10,
            closing_balance: 15,
            count: '5',
          })
        );
        expect(itemRepo.updateStock).toHaveBeenCalledWith(expect.anything(), 15);
      });

      test('creates stock log with correct item_name from item data', async () => {
        repo.create.mockResolvedValue(
          makeMockReceiving({ receiving_id: 'RID000001', status: 'Received' })
        );
        mockBranchFindOne.mockResolvedValue({ stock_management: true });
        itemRepo.findById.mockResolvedValue(
          makeMockItem({ name: 'Sugar', track_inventory: true, available_quantity: 0 })
        );

        const data = {
          ...receivedData,
          items: [{ item_id: ITEM_ID, item_quantity: 3 }],
        };
        await service.createReceiving(data);

        expect(stockLogsRepo.createStockLog).toHaveBeenCalledWith(
          expect.objectContaining({ item_name: 'Sugar' })
        );
      });

      test('accepts track_inventory as string "true"', async () => {
        repo.create.mockResolvedValue(makeMockReceiving({ status: 'Received' }));
        mockBranchFindOne.mockResolvedValue({ stock_management: true });
        itemRepo.findById.mockResolvedValue(
          makeMockItem({ track_inventory: 'true', available_quantity: 5 })
        );

        await service.createReceiving(receivedData);

        expect(stockLogsRepo.createStockLog).toHaveBeenCalled();
      });

      test('skips stock log when item track_inventory is false', async () => {
        repo.create.mockResolvedValue(makeMockReceiving({ status: 'Received' }));
        mockBranchFindOne.mockResolvedValue({ stock_management: true });
        itemRepo.findById.mockResolvedValue(makeMockItem({ track_inventory: false }));

        await service.createReceiving(receivedData);

        expect(stockLogsRepo.createStockLog).not.toHaveBeenCalled();
      });

      test('skips stock log when item is not found', async () => {
        repo.create.mockResolvedValue(makeMockReceiving({ status: 'Received' }));
        mockBranchFindOne.mockResolvedValue({ stock_management: true });
        itemRepo.findById.mockResolvedValue(null);

        await service.createReceiving(receivedData);

        expect(stockLogsRepo.createStockLog).not.toHaveBeenCalled();
      });

      test('skips item when item_quantity is falsy (zero)', async () => {
        repo.create.mockResolvedValue(makeMockReceiving({ status: 'Received' }));
        mockBranchFindOne.mockResolvedValue({ stock_management: true });
        itemRepo.findById.mockResolvedValue(makeMockItem({ track_inventory: true }));

        const data = {
          ...receivedData,
          items: [{ item_id: ITEM_ID, item_quantity: 0 }],
        };
        await service.createReceiving(data);

        expect(stockLogsRepo.createStockLog).not.toHaveBeenCalled();
      });

      test('skips item when item_id is missing', async () => {
        repo.create.mockResolvedValue(makeMockReceiving({ status: 'Received' }));
        mockBranchFindOne.mockResolvedValue({ stock_management: true });

        const data = {
          ...receivedData,
          items: [{ item_quantity: 5 }],
        };
        await service.createReceiving(data);

        expect(itemRepo.findById).not.toHaveBeenCalled();
      });

      test('processes multiple items and creates stock log for each', async () => {
        const items = [
          { item_id: 'item_001', item_quantity: 3 },
          { item_id: 'item_002', item_quantity: 7 },
        ];
        repo.create.mockResolvedValue(makeMockReceiving({ status: 'Received' }));
        mockBranchFindOne.mockResolvedValue({ stock_management: true });
        itemRepo.findById.mockResolvedValue(
          makeMockItem({ track_inventory: true, available_quantity: 0 })
        );

        await service.createReceiving({ ...receivedData, items });

        expect(stockLogsRepo.createStockLog).toHaveBeenCalledTimes(2);
        expect(itemRepo.updateStock).toHaveBeenCalledTimes(2);
      });

      test('continues processing remaining items when one item stock log throws', async () => {
        const items = [
          { item_id: 'item_001', item_quantity: 3 },
          { item_id: 'item_002', item_quantity: 7 },
        ];
        repo.create.mockResolvedValue(makeMockReceiving({ status: 'Received' }));
        mockBranchFindOne.mockResolvedValue({ stock_management: true });
        itemRepo.findById
          .mockResolvedValueOnce(makeMockItem({ track_inventory: true }))
          .mockResolvedValueOnce(makeMockItem({ track_inventory: true }));
        stockLogsRepo.createStockLog
          .mockRejectedValueOnce(new Error('stock log error'))
          .mockResolvedValueOnce({ status: true });

        // Should not throw
        const result = await service.createReceiving({ ...receivedData, items });

        expect(result.status).toBe(true);
      });

      test('uses receiving._id as reference when receiving_id is absent', async () => {
        repo.create.mockResolvedValue(
          makeMockReceiving({ _id: 'fallback_id', receiving_id: undefined, status: 'Received' })
        );
        mockBranchFindOne.mockResolvedValue({ stock_management: true });
        itemRepo.findById.mockResolvedValue(
          makeMockItem({ track_inventory: true, available_quantity: 5 })
        );

        await service.createReceiving(receivedData);

        expect(stockLogsRepo.createStockLog).toHaveBeenCalledWith(
          expect.objectContaining({ reference: 'fallback_id' })
        );
      });

      test('sets changed_by from BaseModel.loggedUserName', async () => {
        repo.create.mockResolvedValue(
          makeMockReceiving({ receiving_id: 'RID000001', status: 'Received' })
        );
        mockBranchFindOne.mockResolvedValue({ stock_management: true });
        itemRepo.findById.mockResolvedValue(
          makeMockItem({ track_inventory: true, available_quantity: 5 })
        );

        await service.createReceiving(receivedData);

        expect(stockLogsRepo.createStockLog).toHaveBeenCalledWith(
          expect.objectContaining({ changed_by: BaseModel.loggedUserName })
        );
      });

      test('still returns success even when stock log createStockLog returns status:false', async () => {
        repo.create.mockResolvedValue(
          makeMockReceiving({ receiving_id: 'RID000001', status: 'Received' })
        );
        mockBranchFindOne.mockResolvedValue({ stock_management: true });
        itemRepo.findById.mockResolvedValue(
          makeMockItem({ track_inventory: true, available_quantity: 5 })
        );
        stockLogsRepo.createStockLog.mockResolvedValue({ status: false, message: 'log failed' });

        const result = await service.createReceiving(receivedData);

        expect(result.status).toBe(true);
        expect(result.message).toBe(SUCCESS_MESSAGES.RECEIVING_CREATED);
      });
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // updateReceiving
  // ════════════════════════════════════════════════════════════════════════════
  describe('updateReceiving', () => {
    const updateData = {
      supplier: SUPPLIER_ID,
      items: [makeMockReceivingItem()],
      total: 400,
    };

    test('returns not-found when receiving does not exist', async () => {
      repo.findById.mockResolvedValue(null);

      const result = await service.updateReceiving(RECEIVING_ID, updateData);

      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.RECEIVING_NOT_FOUND);
      expect(repo.update).not.toHaveBeenCalled();
    });

    test('returns CANNOT_MODIFY_RECEIVED when existing status is "received" and new status differs', async () => {
      repo.findById.mockResolvedValue(makeMockReceiving({ status: 'received' }));

      const result = await service.updateReceiving(RECEIVING_ID, {
        ...updateData,
        status: 'draft',
      });

      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.CANNOT_MODIFY_RECEIVED);
      expect(repo.update).not.toHaveBeenCalled();
    });

    test('allows update when existing status is "received" and new status also is "received"', async () => {
      repo.findById.mockResolvedValue(makeMockReceiving({ status: 'received' }));
      repo.update.mockResolvedValue(makeMockReceiving({ status: 'received' }));

      const result = await service.updateReceiving(RECEIVING_ID, {
        ...updateData,
        status: 'received',
      });

      expect(result.status).toBe(true);
      expect(repo.update).toHaveBeenCalled();
    });

    test('calls repository.findById then repository.update in sequence', async () => {
      repo.findById.mockResolvedValue(makeMockReceiving({ status: 'draft' }));
      repo.update.mockResolvedValue(makeMockReceiving());
      const callOrder = [];
      repo.findById.mockImplementation(() => {
        callOrder.push('findById');
        return Promise.resolve(makeMockReceiving({ status: 'draft' }));
      });
      repo.update.mockImplementation(() => {
        callOrder.push('update');
        return Promise.resolve(makeMockReceiving());
      });

      await service.updateReceiving(RECEIVING_ID, updateData);

      expect(callOrder).toEqual(['findById', 'update']);
    });

    test('calls repository.update with correct id and data', async () => {
      repo.findById.mockResolvedValue(makeMockReceiving({ status: 'draft' }));
      repo.update.mockResolvedValue(makeMockReceiving());

      await service.updateReceiving(RECEIVING_ID, updateData);

      expect(repo.update).toHaveBeenCalledWith(RECEIVING_ID, updateData);
    });

    test('returns {status:true, data:updated, message} on success', async () => {
      repo.findById.mockResolvedValue(makeMockReceiving({ status: 'draft' }));
      const updated = makeMockReceiving({ total: 400 });
      repo.update.mockResolvedValue(updated);

      const result = await service.updateReceiving(RECEIVING_ID, updateData);

      expect(result.status).toBe(true);
      expect(result.data).toEqual(updated);
      expect(result.message).toBe(SUCCESS_MESSAGES.RECEIVING_UPDATED);
    });

    test('does NOT trigger stock log when updateData.status is not "Received"', async () => {
      repo.findById.mockResolvedValue(makeMockReceiving({ status: 'draft' }));
      repo.update.mockResolvedValue(makeMockReceiving());

      await service.updateReceiving(RECEIVING_ID, updateData);

      expect(mockBranchFindOne).not.toHaveBeenCalled();
    });

    test('returns error when repository.findById throws', async () => {
      repo.findById.mockRejectedValue(new Error('DB error'));

      const result = await service.updateReceiving(RECEIVING_ID, updateData);

      expect(result.status).toBe(false);
      expect(result.message).toBe('DB error');
    });

    test('returns error when repository.update throws', async () => {
      repo.findById.mockResolvedValue(makeMockReceiving({ status: 'draft' }));
      repo.update.mockRejectedValue(new Error('update failed'));

      const result = await service.updateReceiving(RECEIVING_ID, updateData);

      expect(result.status).toBe(false);
      expect(result.message).toBe('update failed');
    });

    // ── Stock log integration on update ───────────────────────────────────
    describe('stock log integration when updateData.status === "Received"', () => {
      const receivedUpdateData = {
        status: 'Received',
        alternative_id: 'RID000002',
        items: [makeMockReceivingItem()],
      };

      test('fetches branch doc when status is "Received"', async () => {
        repo.findById.mockResolvedValue(makeMockReceiving({ status: 'draft' }));
        repo.update.mockResolvedValue(makeMockReceiving({ status: 'Received' }));
        mockBranchFindOne.mockResolvedValue({ stock_management: false });

        await service.updateReceiving(RECEIVING_ID, receivedUpdateData);

        expect(mockBranchFindOne).toHaveBeenCalledWith({ _id: BaseModel.currentBranch });
      });

      test('creates stock log with "Edit Receiving" process when stock_management is true', async () => {
        repo.findById.mockResolvedValue(makeMockReceiving({ status: 'draft' }));
        repo.update.mockResolvedValue(makeMockReceiving());
        mockBranchFindOne.mockResolvedValue({ stock_management: true });
        itemRepo.findById.mockResolvedValue(
          makeMockItem({ track_inventory: true, available_quantity: 20 })
        );

        await service.updateReceiving(RECEIVING_ID, receivedUpdateData);

        expect(stockLogsRepo.createStockLog).toHaveBeenCalledWith(
          expect.objectContaining({
            process: 'Edit Receiving',
            action: 'Add',
            opening_balance: 20,
            closing_balance: 25,
          })
        );
      });

      test('uses alternative_id as reference in stock log', async () => {
        repo.findById.mockResolvedValue(makeMockReceiving({ status: 'draft' }));
        repo.update.mockResolvedValue(makeMockReceiving());
        mockBranchFindOne.mockResolvedValue({ stock_management: true });
        itemRepo.findById.mockResolvedValue(
          makeMockItem({ track_inventory: true, available_quantity: 0 })
        );

        await service.updateReceiving(RECEIVING_ID, receivedUpdateData);

        expect(stockLogsRepo.createStockLog).toHaveBeenCalledWith(
          expect.objectContaining({ reference: 'RID000002' })
        );
      });

      test('falls back to id when alternative_id is absent', async () => {
        repo.findById.mockResolvedValue(makeMockReceiving({ status: 'draft' }));
        repo.update.mockResolvedValue(makeMockReceiving());
        mockBranchFindOne.mockResolvedValue({ stock_management: true });
        itemRepo.findById.mockResolvedValue(
          makeMockItem({ track_inventory: true, available_quantity: 0 })
        );

        await service.updateReceiving(RECEIVING_ID, {
          status: 'Received',
          items: [makeMockReceivingItem()],
        });

        expect(stockLogsRepo.createStockLog).toHaveBeenCalledWith(
          expect.objectContaining({ reference: RECEIVING_ID })
        );
      });

      test('skips stock logs when stock_management is false', async () => {
        repo.findById.mockResolvedValue(makeMockReceiving({ status: 'draft' }));
        repo.update.mockResolvedValue(makeMockReceiving());
        mockBranchFindOne.mockResolvedValue({ stock_management: false });

        await service.updateReceiving(RECEIVING_ID, receivedUpdateData);

        expect(stockLogsRepo.createStockLog).not.toHaveBeenCalled();
      });

      test('continues processing other items when one item throws', async () => {
        const items = [
          { item_id: 'item_A', item_quantity: 2 },
          { item_id: 'item_B', item_quantity: 4 },
        ];
        repo.findById.mockResolvedValue(makeMockReceiving({ status: 'draft' }));
        repo.update.mockResolvedValue(makeMockReceiving());
        mockBranchFindOne.mockResolvedValue({ stock_management: true });
        itemRepo.findById
          .mockRejectedValueOnce(new Error('item A fetch failed'))
          .mockResolvedValueOnce(makeMockItem({ track_inventory: true, available_quantity: 0 }));

        const result = await service.updateReceiving(RECEIVING_ID, {
          ...receivedUpdateData,
          items,
        });

        expect(result.status).toBe(true);
        expect(stockLogsRepo.createStockLog).toHaveBeenCalledTimes(1);
      });
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // returnReceiving
  // ════════════════════════════════════════════════════════════════════════════
  describe('returnReceiving', () => {
    const returnData = {
      alternative_id: 'RID000001',
      items: [{ item_id: ITEM_ID, item_name: 'Test Item', return_quantity: 2 }],
    };

    test('returns {status:true, data:null, message:RECEIVING_RETURNED} on success', async () => {
      mockBranchFindOne.mockResolvedValue({ stock_management: false });

      const result = await service.returnReceiving(RECEIVING_ID, returnData);

      expect(result.status).toBe(true);
      expect(result.data).toBeNull();
      expect(result.message).toBe(SUCCESS_MESSAGES.RECEIVING_RETURNED);
    });

    test('fetches branch doc to check stock_management', async () => {
      mockBranchFindOne.mockResolvedValue({ stock_management: false });

      await service.returnReceiving(RECEIVING_ID, returnData);

      expect(mockBranchFindOne).toHaveBeenCalledWith({ _id: BaseModel.currentBranch });
    });

    test('skips stock updates when stock_management is false', async () => {
      mockBranchFindOne.mockResolvedValue({ stock_management: false });

      await service.returnReceiving(RECEIVING_ID, returnData);

      expect(itemRepo.findById).not.toHaveBeenCalled();
      expect(stockLogsRepo.createStockLog).not.toHaveBeenCalled();
    });

    test('skips stock updates when branchDoc is null', async () => {
      mockBranchFindOne.mockResolvedValue(null);

      await service.returnReceiving(RECEIVING_ID, returnData);

      expect(stockLogsRepo.createStockLog).not.toHaveBeenCalled();
    });

    test('creates stock log with "Return Receiving" process when stock_management is true', async () => {
      mockBranchFindOne.mockResolvedValue({ stock_management: true });
      itemRepo.findById.mockResolvedValue(
        makeMockItem({ track_inventory: true, available_quantity: 15 })
      );

      await service.returnReceiving(RECEIVING_ID, returnData);

      expect(stockLogsRepo.createStockLog).toHaveBeenCalledWith(
        expect.objectContaining({
          process: 'Return Receiving',
          action: 'Subtract',
          opening_balance: 15,
          closing_balance: 13,
          count: '-2',
        })
      );
    });

    test('updates item stock to closing balance (subtract) when returning', async () => {
      mockBranchFindOne.mockResolvedValue({ stock_management: true });
      itemRepo.findById.mockResolvedValue(
        makeMockItem({ track_inventory: true, available_quantity: 10 })
      );

      await service.returnReceiving(RECEIVING_ID, returnData);

      expect(itemRepo.updateStock).toHaveBeenCalledWith(expect.anything(), 8);
    });

    test('uses alternative_id as reference in stock log', async () => {
      mockBranchFindOne.mockResolvedValue({ stock_management: true });
      itemRepo.findById.mockResolvedValue(
        makeMockItem({ track_inventory: true, available_quantity: 10 })
      );

      await service.returnReceiving(RECEIVING_ID, returnData);

      expect(stockLogsRepo.createStockLog).toHaveBeenCalledWith(
        expect.objectContaining({ reference: 'RID000001' })
      );
    });

    test('falls back to receivingId when alternative_id is absent', async () => {
      mockBranchFindOne.mockResolvedValue({ stock_management: true });
      itemRepo.findById.mockResolvedValue(
        makeMockItem({ track_inventory: true, available_quantity: 10 })
      );

      await service.returnReceiving(RECEIVING_ID, {
        items: [{ item_id: ITEM_ID, return_quantity: 1 }],
      });

      expect(stockLogsRepo.createStockLog).toHaveBeenCalledWith(
        expect.objectContaining({ reference: RECEIVING_ID })
      );
    });

    test('skips item when item_id is missing', async () => {
      mockBranchFindOne.mockResolvedValue({ stock_management: true });

      await service.returnReceiving(RECEIVING_ID, {
        items: [{ return_quantity: 2 }],
      });

      expect(itemRepo.findById).not.toHaveBeenCalled();
    });

    test('skips item when return_quantity is falsy (zero)', async () => {
      mockBranchFindOne.mockResolvedValue({ stock_management: true });

      await service.returnReceiving(RECEIVING_ID, {
        items: [{ item_id: ITEM_ID, return_quantity: 0 }],
      });

      expect(itemRepo.findById).not.toHaveBeenCalled();
    });

    test('skips item when track_inventory is false', async () => {
      mockBranchFindOne.mockResolvedValue({ stock_management: true });
      itemRepo.findById.mockResolvedValue(makeMockItem({ track_inventory: false }));

      await service.returnReceiving(RECEIVING_ID, returnData);

      expect(stockLogsRepo.createStockLog).not.toHaveBeenCalled();
    });

    test('accepts track_inventory as string "true"', async () => {
      mockBranchFindOne.mockResolvedValue({ stock_management: true });
      itemRepo.findById.mockResolvedValue(
        makeMockItem({ track_inventory: 'true', available_quantity: 5 })
      );

      await service.returnReceiving(RECEIVING_ID, returnData);

      expect(stockLogsRepo.createStockLog).toHaveBeenCalled();
    });

    test('processes multiple returned items', async () => {
      mockBranchFindOne.mockResolvedValue({ stock_management: true });
      itemRepo.findById.mockResolvedValue(
        makeMockItem({ track_inventory: true, available_quantity: 20 })
      );

      await service.returnReceiving(RECEIVING_ID, {
        items: [
          { item_id: 'item_A', return_quantity: 1 },
          { item_id: 'item_B', return_quantity: 3 },
        ],
      });

      expect(stockLogsRepo.createStockLog).toHaveBeenCalledTimes(2);
      expect(itemRepo.updateStock).toHaveBeenCalledTimes(2);
    });

    test('continues processing remaining items when one item throws', async () => {
      mockBranchFindOne.mockResolvedValue({ stock_management: true });
      itemRepo.findById
        .mockRejectedValueOnce(new Error('item fetch error'))
        .mockResolvedValueOnce(makeMockItem({ track_inventory: true, available_quantity: 10 }));

      const result = await service.returnReceiving(RECEIVING_ID, {
        items: [
          { item_id: 'item_A', return_quantity: 1 },
          { item_id: 'item_B', return_quantity: 2 },
        ],
      });

      expect(result.status).toBe(true);
      expect(stockLogsRepo.createStockLog).toHaveBeenCalledTimes(1);
    });

    test('returns error when BaseModel.database.collection throws', async () => {
      mockCollection.mockImplementation(() => {
        throw new Error('collection error');
      });

      const result = await service.returnReceiving(RECEIVING_ID, returnData);

      expect(result.status).toBe(false);
      expect(result.message).toBe('collection error');
    });

    test('handles empty items array gracefully', async () => {
      mockBranchFindOne.mockResolvedValue({ stock_management: true });

      const result = await service.returnReceiving(RECEIVING_ID, { items: [] });

      expect(result.status).toBe(true);
      expect(stockLogsRepo.createStockLog).not.toHaveBeenCalled();
    });

    test('handles missing items in returnData gracefully', async () => {
      mockBranchFindOne.mockResolvedValue({ stock_management: true });

      const result = await service.returnReceiving(RECEIVING_ID, {});

      expect(result.status).toBe(true);
      expect(stockLogsRepo.createStockLog).not.toHaveBeenCalled();
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // deleteReceiving
  // ════════════════════════════════════════════════════════════════════════════
  describe('deleteReceiving', () => {
    test('calls repository.hardDelete with correct id', async () => {
      repo.hardDelete.mockResolvedValue({ deletedCount: 1 });

      await service.deleteReceiving(RECEIVING_ID);

      expect(repo.hardDelete).toHaveBeenCalledWith(RECEIVING_ID);
    });

    test('returns {status:true, data, message} on success', async () => {
      const dbResult = { deletedCount: 1 };
      repo.hardDelete.mockResolvedValue(dbResult);

      const result = await service.deleteReceiving(RECEIVING_ID);

      expect(result.status).toBe(true);
      expect(result.data).toEqual(dbResult);
      expect(result.message).toBe(SUCCESS_MESSAGES.RECEIVING_DELETED);
    });

    test('returns error when repository.hardDelete throws', async () => {
      repo.hardDelete.mockRejectedValue(new Error('delete failed'));

      const result = await service.deleteReceiving(RECEIVING_ID);

      expect(result.status).toBe(false);
      expect(result.message).toBe('delete failed');
    });

    test('passes through result even when deletedCount is 0 (no matching doc)', async () => {
      repo.hardDelete.mockResolvedValue({ deletedCount: 0 });

      const result = await service.deleteReceiving('non_existent_id');

      expect(result.status).toBe(true);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // bulkDeleteReceivings
  // ════════════════════════════════════════════════════════════════════════════
  describe('bulkDeleteReceivings', () => {
    test('returns error when ids is not an array', async () => {
      const result = await service.bulkDeleteReceivings('single-id');

      expect(result.status).toBe(false);
      expect(result.message).toBe('No IDs provided');
      expect(repo.bulkHardDelete).not.toHaveBeenCalled();
    });

    test('returns error when ids is an empty array', async () => {
      const result = await service.bulkDeleteReceivings([]);

      expect(result.status).toBe(false);
      expect(result.message).toBe('No IDs provided');
    });

    test('returns error when ids is null', async () => {
      const result = await service.bulkDeleteReceivings(null);

      expect(result.status).toBe(false);
    });

    test('returns error when ids is undefined', async () => {
      const result = await service.bulkDeleteReceivings(undefined);

      expect(result.status).toBe(false);
    });

    test('calls repository.bulkHardDelete with ids array', async () => {
      repo.bulkHardDelete.mockResolvedValue({ deletedCount: 2 });
      const ids = [RECEIVING_ID, 'receiving_456'];

      await service.bulkDeleteReceivings(ids);

      expect(repo.bulkHardDelete).toHaveBeenCalledWith(ids);
    });

    test('returns {status:true, data:result, message} on success', async () => {
      const dbResult = { deletedCount: 3 };
      repo.bulkHardDelete.mockResolvedValue(dbResult);

      const result = await service.bulkDeleteReceivings([RECEIVING_ID, 'id2', 'id3']);

      expect(result.status).toBe(true);
      expect(result.data).toEqual(dbResult);
      expect(result.message).toBe(SUCCESS_MESSAGES.RECEIVINGS_DELETED);
    });

    test('returns error when repository.bulkHardDelete throws', async () => {
      repo.bulkHardDelete.mockRejectedValue(new Error('bulk delete failed'));

      const result = await service.bulkDeleteReceivings([RECEIVING_ID]);

      expect(result.status).toBe(false);
      expect(result.message).toBe('bulk delete failed');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getReceivingsBySupplier
  // ════════════════════════════════════════════════════════════════════════════
  describe('getReceivingsBySupplier', () => {
    test('calls repository.findBySupplier with supplierId and options', async () => {
      repo.findBySupplier.mockResolvedValue(makePaginatedResult());
      const opts = { page: 1, limit: 10 };

      await service.getReceivingsBySupplier(SUPPLIER_ID, opts);

      expect(repo.findBySupplier).toHaveBeenCalledWith(SUPPLIER_ID, opts);
    });

    test('returns {status:true, data, message} on success', async () => {
      const paged = makePaginatedResult();
      repo.findBySupplier.mockResolvedValue(paged);

      const result = await service.getReceivingsBySupplier(SUPPLIER_ID);

      expect(result.status).toBe(true);
      expect(result.data).toEqual(paged);
      expect(result.message).toBe(SUCCESS_MESSAGES.RECEIVINGS_RETRIEVED);
    });

    test('returns empty list when no receivings found for supplier', async () => {
      repo.findBySupplier.mockResolvedValue({ data: [], total: 0, page: 1, limit: 10 });

      const result = await service.getReceivingsBySupplier(SUPPLIER_ID);

      expect(result.status).toBe(true);
      expect(result.data.data).toEqual([]);
    });

    test('returns error when repository throws', async () => {
      repo.findBySupplier.mockRejectedValue(new Error('supplier lookup error'));

      const result = await service.getReceivingsBySupplier(SUPPLIER_ID);

      expect(result.status).toBe(false);
      expect(result.message).toBe('supplier lookup error');
    });

    test('uses empty options by default', async () => {
      repo.findBySupplier.mockResolvedValue(makePaginatedResult());

      await service.getReceivingsBySupplier(SUPPLIER_ID);

      expect(repo.findBySupplier).toHaveBeenCalledWith(SUPPLIER_ID, {});
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getReceivingsByBranch
  // ════════════════════════════════════════════════════════════════════════════
  describe('getReceivingsByBranch', () => {
    test('calls repository.findByBranch with branchId and options', async () => {
      repo.findByBranch.mockResolvedValue(makePaginatedResult());

      await service.getReceivingsByBranch(BRANCH_ID, { page: 2 });

      expect(repo.findByBranch).toHaveBeenCalledWith(BRANCH_ID, { page: 2 });
    });

    test('returns {status:true, data, message} on success', async () => {
      repo.findByBranch.mockResolvedValue(makePaginatedResult());

      const result = await service.getReceivingsByBranch(BRANCH_ID);

      expect(result.status).toBe(true);
      expect(result.message).toBe(SUCCESS_MESSAGES.RECEIVINGS_RETRIEVED);
    });

    test('returns error when repository throws', async () => {
      repo.findByBranch.mockRejectedValue(new Error('branch lookup error'));

      const result = await service.getReceivingsByBranch(BRANCH_ID);

      expect(result.status).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getReceivingsByStatus
  // ════════════════════════════════════════════════════════════════════════════
  describe('getReceivingsByStatus', () => {
    test('calls repository.findByStatus with status and options', async () => {
      repo.findByStatus.mockResolvedValue(makePaginatedResult());

      await service.getReceivingsByStatus('Received', { page: 1 });

      expect(repo.findByStatus).toHaveBeenCalledWith('Received', { page: 1 });
    });

    test('returns {status:true, data, message} on success', async () => {
      repo.findByStatus.mockResolvedValue(makePaginatedResult());

      const result = await service.getReceivingsByStatus('Open');

      expect(result.status).toBe(true);
      expect(result.message).toBe(SUCCESS_MESSAGES.RECEIVINGS_RETRIEVED);
    });

    test('returns error when repository throws', async () => {
      repo.findByStatus.mockRejectedValue(new Error('status lookup error'));

      const result = await service.getReceivingsByStatus('Open');

      expect(result.status).toBe(false);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // getReceivingsByPaymentStatus
  // ════════════════════════════════════════════════════════════════════════════
  describe('getReceivingsByPaymentStatus', () => {
    test('calls repository.findByPaymentStatus with paymentStatus and options', async () => {
      repo.findByPaymentStatus.mockResolvedValue(makePaginatedResult());

      await service.getReceivingsByPaymentStatus('paid', { limit: 5 });

      expect(repo.findByPaymentStatus).toHaveBeenCalledWith('paid', { limit: 5 });
    });

    test('returns {status:true, data, message} on success', async () => {
      repo.findByPaymentStatus.mockResolvedValue(makePaginatedResult());

      const result = await service.getReceivingsByPaymentStatus('pending');

      expect(result.status).toBe(true);
      expect(result.message).toBe(SUCCESS_MESSAGES.RECEIVINGS_RETRIEVED);
    });

    test('returns error when repository throws', async () => {
      repo.findByPaymentStatus.mockRejectedValue(new Error('payment status error'));

      const result = await service.getReceivingsByPaymentStatus('paid');

      expect(result.status).toBe(false);
    });

    test('uses empty options by default', async () => {
      repo.findByPaymentStatus.mockResolvedValue(makePaginatedResult());

      await service.getReceivingsByPaymentStatus('pending');

      expect(repo.findByPaymentStatus).toHaveBeenCalledWith('pending', {});
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // exportReceivings
  // ════════════════════════════════════════════════════════════════════════════
  describe('exportReceivings', () => {
    test('returns error when ids is not an array', async () => {
      const result = await service.exportReceivings('single-id');

      expect(result.status).toBe(false);
      expect(result.message).toBe('No IDs provided for export');
      expect(repo.exportByIds).not.toHaveBeenCalled();
    });

    test('returns error when ids is an empty array', async () => {
      const result = await service.exportReceivings([]);

      expect(result.status).toBe(false);
      expect(result.message).toBe('No IDs provided for export');
    });

    test('returns error when ids is null', async () => {
      const result = await service.exportReceivings(null);

      expect(result.status).toBe(false);
    });

    test('calls repository.exportByIds with ids array', async () => {
      repo.exportByIds.mockResolvedValue([makeMockReceiving()]);
      const ids = [RECEIVING_ID, 'receiving_456'];

      await service.exportReceivings(ids);

      expect(repo.exportByIds).toHaveBeenCalledWith(ids);
    });

    test('returns {status:true, data:receivings, message} on success', async () => {
      const receivings = [makeMockReceiving()];
      repo.exportByIds.mockResolvedValue(receivings);

      const result = await service.exportReceivings([RECEIVING_ID]);

      expect(result.status).toBe(true);
      expect(result.data).toEqual(receivings);
      expect(result.message).toBe(SUCCESS_MESSAGES.RECEIVINGS_EXPORTED);
    });

    test('returns error when repository throws', async () => {
      repo.exportByIds.mockRejectedValue(new Error('export failed'));

      const result = await service.exportReceivings([RECEIVING_ID]);

      expect(result.status).toBe(false);
      expect(result.message).toBe('export failed');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Edge cases: null/undefined/empty payloads
  // ════════════════════════════════════════════════════════════════════════════
  describe('edge cases — null/undefined/empty payloads', () => {
    test('createReceiving with null payload returns status:false without throwing', async () => {
      await expect(service.createReceiving(null)).resolves.toMatchObject({ status: false });
    });

    test('createReceiving with undefined payload returns status:false without throwing', async () => {
      await expect(service.createReceiving(undefined)).resolves.toMatchObject({ status: false });
    });

    test('createReceiving with empty object returns SUPPLIER_REQUIRED error', async () => {
      const result = await service.createReceiving({});
      expect(result.message).toBe(ERROR_MESSAGES.SUPPLIER_REQUIRED);
    });

    test('updateReceiving with null updateData — service catches TypeError and returns status:false', async () => {
      repo.findById.mockResolvedValue(makeMockReceiving({ status: 'draft' }));
      repo.update.mockResolvedValue(makeMockReceiving());

      // NOTE: Production issue — accessing null.status throws TypeError.
      // The service catch block handles it and returns status:false.
      await expect(service.updateReceiving(RECEIVING_ID, null)).resolves.toMatchObject({
        status: false,
      });
    });

    test('deleteReceiving with undefined id passes through to repository', async () => {
      repo.hardDelete.mockResolvedValue({ deletedCount: 0 });

      await service.deleteReceiving(undefined);

      expect(repo.hardDelete).toHaveBeenCalledWith(undefined);
    });

    test('getReceivingsBySupplier with null supplierId passes through to repository', async () => {
      repo.findBySupplier.mockResolvedValue(makePaginatedResult());

      await service.getReceivingsBySupplier(null);

      expect(repo.findBySupplier).toHaveBeenCalledWith(null, {});
    });

    test('returnReceiving with null returnData returns status:false without throwing', async () => {
      await expect(service.returnReceiving(RECEIVING_ID, null)).resolves.toMatchObject({
        status: false,
      });
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // Error response shape consistency
  // ════════════════════════════════════════════════════════════════════════════
  describe('error response shape', () => {
    const errorCases = [
      ['getAllReceivings', () => repo.findAll.mockRejectedValue(new Error('err'))],
      ['getReceivingById', () => repo.findById.mockRejectedValue(new Error('err'))],
      [
        'getReceivingByReceivingId',
        () => repo.findByReceivingId.mockRejectedValue(new Error('err')),
      ],
      ['deleteReceiving', () => repo.hardDelete.mockRejectedValue(new Error('err'))],
      ['getReceivingsBySupplier', () => repo.findBySupplier.mockRejectedValue(new Error('err'))],
      ['getReceivingsByBranch', () => repo.findByBranch.mockRejectedValue(new Error('err'))],
      ['getReceivingsByStatus', () => repo.findByStatus.mockRejectedValue(new Error('err'))],
      [
        'getReceivingsByPaymentStatus',
        () => repo.findByPaymentStatus.mockRejectedValue(new Error('err')),
      ],
      ['exportReceivings', () => repo.exportByIds.mockRejectedValue(new Error('err'))],
    ];

    test.each(errorCases)(
      '%s returns {status:false, data:null, message:string} on error',
      async (method, setup) => {
        setup();
        // Some methods accept the ids array guard — pass a valid non-empty array
        const arg = method === 'exportReceivings' ? [RECEIVING_ID] : undefined;
        const result = await service[method](arg);
        expect(result.status).toBe(false);
        expect(result.data).toBeNull();
        expect(typeof result.message).toBe('string');
      }
    );
  });
});
