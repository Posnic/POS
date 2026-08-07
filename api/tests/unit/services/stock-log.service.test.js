'use strict';

/**
 * Unit tests for src/services/stock-logs.service.js
 *
 * File        : src/services/stock-logs.service.js (68 lines, CLASS export)
 * Export type : CLASS — `module.exports = StockLogsService`
 * Base class  : None — does NOT extend base.service.js
 *
 * Constructor : `this.repository = new StockLogsRepository()`
 *   Accepts an ignored legacy parameter for backward compat.
 *
 * Methods (7 — all pure delegations, no try/catch in service):
 *   getStockLogs(filters, options)              — delegates to repository.getStockLogs
 *   getStockLogDetail(id)                       — delegates to repository.getStockLogDetail
 *   createStockLog(logData)                     — delegates to repository.createStockLog
 *   deleteStockLogs(ids)                        — delegates to repository.deleteStockLogs
 *   exportStockLogs(filters)                    — delegates to repository.exportStockLogs
 *   updateItemNameInStockLogs(itemId, name)     — delegates to repository.updateItemNameInStockLogs
 *   cleanupOldDeletedLogs(daysOld)              — delegates to repository.cleanupOldDeletedLogs
 *
 * Mocked dependencies:
 *   StockLogsRepository — class constructor mock returning mockRepositoryInstance
 *
 * PRODUCTION ISSUES FOUND:
 *   1. No try/catch in any service method — repository rejections bubble uncaught
 *      to the controller. If the controller also does not catch, the server returns
 *      an unhandled 500. A service-level catch layer is missing.
 *   2. `cleanupOldDeletedLogs` default of 90 days permanently deletes records with
 *      no additional safety check (e.g., no "are you sure" flag, no dry-run mode).
 *   3. `updateItemNameInStockLogs` validation (itemId/newItemName required) lives in
 *      the REPOSITORY, not the service. The service layer does no input validation at all.
 *   4. The constructor ignores its argument silently — callers passing a model to the
 *      old constructor receive no warning that the argument is discarded.
 */

// ─── Mock StockLogsRepository (class constructor) ────────────────────────────

const mockRepositoryInstance = {
  getStockLogs: jest.fn(),
  getStockLogDetail: jest.fn(),
  createStockLog: jest.fn(),
  deleteStockLogs: jest.fn(),
  exportStockLogs: jest.fn(),
  updateItemNameInStockLogs: jest.fn(),
  cleanupOldDeletedLogs: jest.fn(),
};

jest.mock('../../../src/repositories/stock-log.repository', () =>
  jest.fn(() => mockRepositoryInstance)
);

// ─── Requires ─────────────────────────────────────────────────────────────────

const StockLogsRepository = require('../../../src/repositories/stock-log.repository');
const StockLogsService = require('../../../src/services/stock-log.service');

// ─── Shared helpers ───────────────────────────────────────────────────────────

const FAKE_LOG_ID = '64f8f2f4c2b9c0a1e4000001';
const FAKE_ITEM_ID = '64f8f2f4c2b9c0a1e4000002';
const FAKE_BRANCH_ID = '64f8f2f4c2b9c0a1e4000003';

const mockStockLog = {
  _id: FAKE_LOG_ID,
  branch_id: FAKE_BRANCH_ID,
  view_item_id: FAKE_ITEM_ID,
  item_name: 'Test Product',
  item_barcode_id: 'BAR001',
  item_quantity: 5,
  process: 'Sale',
  reference: 'S-2024-001',
  action: 'Decrease',
  stocklog: true,
  opening_balance: 10,
  closing_balance: 5,
  count: 1,
  changed_by: 'Admin User',
  changed_by_userid: '64f8f2f4c2b9c0a1e4000099',
  date: new Date('2024-01-15T10:00:00Z'),
  is_deleted: false,
};

const OK = (data, msg) => ({ status: true, data, message: msg });
const FAIL = (msg) => ({ status: false, data: null, message: msg });

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('StockLogsService', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new StockLogsService();
  });

  // ── constructor ──────────────────────────────────────────────────────────────

  describe('constructor', () => {
    test('instantiates StockLogsRepository and assigns to this.repository', () => {
      expect(StockLogsRepository).toHaveBeenCalledTimes(1);
      expect(service.repository).toBe(mockRepositoryInstance);
    });

    test('ignores legacy model argument without throwing', () => {
      expect(() => new StockLogsService({ legacyModel: true })).not.toThrow();
    });

    test('each new instance gets a fresh constructor call', () => {
      const s2 = new StockLogsService();
      expect(StockLogsRepository).toHaveBeenCalledTimes(2);
      expect(s2.repository).toBe(mockRepositoryInstance);
    });
  });

  // ── getStockLogs ─────────────────────────────────────────────────────────────

  describe('getStockLogs', () => {
    test('delegates to repository.getStockLogs and returns its result', async () => {
      const mockResult = OK([mockStockLog], 'Stock logs retrieved successfully');
      mockRepositoryInstance.getStockLogs.mockResolvedValue(mockResult);

      const result = await service.getStockLogs({ process: 'Sale' }, { page: 1, limit: 10 });
      expect(result).toBe(mockResult);
    });

    test('passes filters and options to repository unchanged', async () => {
      const filters = { item_name: 'Widget', process: 'Receiving' };
      const options = { page: 2, limit: 25, sort: { date: -1 } };
      mockRepositoryInstance.getStockLogs.mockResolvedValue(OK([], 'ok'));

      await service.getStockLogs(filters, options);
      expect(mockRepositoryInstance.getStockLogs).toHaveBeenCalledWith(filters, options);
    });

    test('uses empty object defaults when called with no arguments', async () => {
      mockRepositoryInstance.getStockLogs.mockResolvedValue(OK([], 'ok'));

      await service.getStockLogs();
      expect(mockRepositoryInstance.getStockLogs).toHaveBeenCalledWith({}, {});
    });

    test('uses empty filters default when only options provided', async () => {
      mockRepositoryInstance.getStockLogs.mockResolvedValue(OK([], 'ok'));
      const options = { page: 3 };

      await service.getStockLogs(undefined, options);
      expect(mockRepositoryInstance.getStockLogs).toHaveBeenCalledWith({}, options);
    });

    test('propagates repository rejection (no catch in service)', async () => {
      mockRepositoryInstance.getStockLogs.mockRejectedValue(new Error('DB connection lost'));
      await expect(service.getStockLogs()).rejects.toThrow('DB connection lost');
    });

    test('returns status:false result from repository unchanged', async () => {
      const failResult = FAIL('Failed to retrieve stock logs');
      mockRepositoryInstance.getStockLogs.mockResolvedValue(failResult);
      expect(await service.getStockLogs()).toBe(failResult);
    });

    test('handles branch filter correctly', async () => {
      const filters = { branch_id: FAKE_BRANCH_ID };
      mockRepositoryInstance.getStockLogs.mockResolvedValue(OK([mockStockLog], 'ok'));

      await service.getStockLogs(filters, {});
      expect(mockRepositoryInstance.getStockLogs).toHaveBeenCalledWith(filters, {});
    });

    test('handles date range filter correctly', async () => {
      const filters = { created_date_from: '2024-01-01', created_date_to: '2024-01-31' };
      mockRepositoryInstance.getStockLogs.mockResolvedValue(OK([], 'ok'));

      await service.getStockLogs(filters);
      expect(mockRepositoryInstance.getStockLogs).toHaveBeenCalledWith(filters, {});
    });

    test('returns empty data array result when no logs found', async () => {
      const emptyResult = OK([], 'Stock logs retrieved successfully');
      mockRepositoryInstance.getStockLogs.mockResolvedValue(emptyResult);

      const result = await service.getStockLogs();
      expect(result.status).toBe(true);
      expect(result.data).toEqual([]);
    });

    test('handles pagination options: page, limit, sort', async () => {
      const options = { page: 5, limit: 50, sort: { _id: 1 } };
      mockRepositoryInstance.getStockLogs.mockResolvedValue(OK([], 'ok'));

      await service.getStockLogs({}, options);
      expect(mockRepositoryInstance.getStockLogs).toHaveBeenCalledWith({}, options);
    });

    test('handles process filter for sale movement type', async () => {
      const filters = { process: 'Sale' };
      mockRepositoryInstance.getStockLogs.mockResolvedValue(OK([mockStockLog], 'ok'));

      await service.getStockLogs(filters);
      expect(mockRepositoryInstance.getStockLogs.mock.calls[0][0]).toEqual(filters);
    });

    test('handles process filter for receiving movement type', async () => {
      const filters = { process: 'Receiving' };
      mockRepositoryInstance.getStockLogs.mockResolvedValue(OK([mockStockLog], 'ok'));

      await service.getStockLogs(filters);
      expect(mockRepositoryInstance.getStockLogs.mock.calls[0][0]).toEqual(filters);
    });
  });

  // ── getStockLogDetail ─────────────────────────────────────────────────────────

  describe('getStockLogDetail', () => {
    test('delegates to repository.getStockLogDetail and returns its result', async () => {
      const mockResult = OK(mockStockLog, 'Stock log retrieved successfully');
      mockRepositoryInstance.getStockLogDetail.mockResolvedValue(mockResult);

      const result = await service.getStockLogDetail(FAKE_LOG_ID);
      expect(result).toBe(mockResult);
    });

    test('passes id to repository unchanged', async () => {
      mockRepositoryInstance.getStockLogDetail.mockResolvedValue(OK(null, 'ok'));

      await service.getStockLogDetail(FAKE_LOG_ID);
      expect(mockRepositoryInstance.getStockLogDetail).toHaveBeenCalledWith(FAKE_LOG_ID);
    });

    test('returns not-found result from repository unchanged', async () => {
      const notFound = FAIL('Stock log not found');
      mockRepositoryInstance.getStockLogDetail.mockResolvedValue(notFound);

      expect(await service.getStockLogDetail('nonexistent_id')).toBe(notFound);
    });

    test('propagates repository rejection', async () => {
      mockRepositoryInstance.getStockLogDetail.mockRejectedValue(new Error('Invalid ObjectId'));
      await expect(service.getStockLogDetail('bad_id')).rejects.toThrow('Invalid ObjectId');
    });

    test('calls repository exactly once per invocation', async () => {
      mockRepositoryInstance.getStockLogDetail.mockResolvedValue(OK(mockStockLog, 'ok'));

      await service.getStockLogDetail(FAKE_LOG_ID);
      expect(mockRepositoryInstance.getStockLogDetail).toHaveBeenCalledTimes(1);
    });
  });

  // ── createStockLog ────────────────────────────────────────────────────────────

  describe('createStockLog', () => {
    const saleLogData = {
      branch_id: FAKE_BRANCH_ID,
      view_item_id: FAKE_ITEM_ID,
      item_name: 'Test Product',
      item_barcode_id: 'BAR001',
      item_quantity: -5,
      process: 'Sale',
      reference: 'S-2024-001',
      action: 'Decrease',
      stocklog: true,
      opening_balance: 10,
      closing_balance: 5,
      count: 1,
      changed_by: 'Admin',
      changed_by_userid: '64f8f2f4c2b9c0a1e4000099',
      date: new Date('2024-01-15'),
    };

    test('delegates to repository.createStockLog and returns its result', async () => {
      const mockResult = OK({ _id: FAKE_LOG_ID, ...saleLogData }, 'Stock log created successfully');
      mockRepositoryInstance.createStockLog.mockResolvedValue(mockResult);

      const result = await service.createStockLog(saleLogData);
      expect(result).toBe(mockResult);
    });

    test('passes logData to repository unchanged', async () => {
      mockRepositoryInstance.createStockLog.mockResolvedValue(OK({}, 'ok'));

      await service.createStockLog(saleLogData);
      expect(mockRepositoryInstance.createStockLog).toHaveBeenCalledWith(saleLogData);
    });

    test('propagates repository rejection', async () => {
      mockRepositoryInstance.createStockLog.mockRejectedValue(new Error('Insert failed'));
      await expect(service.createStockLog(saleLogData)).rejects.toThrow('Insert failed');
    });

    test('passes sale log with stocklog:true correctly', async () => {
      const logData = { ...saleLogData, stocklog: true };
      mockRepositoryInstance.createStockLog.mockResolvedValue(OK({}, 'ok'));

      await service.createStockLog(logData);
      expect(mockRepositoryInstance.createStockLog).toHaveBeenCalledWith(
        expect.objectContaining({ stocklog: true })
      );
    });

    test('passes log with stocklog:false (opening/closing N/A case) correctly', async () => {
      const logData = { ...saleLogData, stocklog: false };
      mockRepositoryInstance.createStockLog.mockResolvedValue(OK({}, 'ok'));

      await service.createStockLog(logData);
      expect(mockRepositoryInstance.createStockLog).toHaveBeenCalledWith(
        expect.objectContaining({ stocklog: false })
      );
    });

    test('passes receiving log data correctly', async () => {
      const receivingLog = {
        ...saleLogData,
        process: 'Receiving',
        action: 'Increase',
        item_quantity: 10,
        opening_balance: 5,
        closing_balance: 15,
      };
      mockRepositoryInstance.createStockLog.mockResolvedValue(OK({}, 'ok'));

      await service.createStockLog(receivingLog);
      expect(mockRepositoryInstance.createStockLog).toHaveBeenCalledWith(receivingLog);
    });

    test('passes manual adjustment log correctly', async () => {
      const adjustLog = { ...saleLogData, process: 'Manual Adjustment', action: 'Adjust' };
      mockRepositoryInstance.createStockLog.mockResolvedValue(OK({}, 'ok'));

      await service.createStockLog(adjustLog);
      expect(mockRepositoryInstance.createStockLog).toHaveBeenCalledWith(adjustLog);
    });

    test('handles decimal quantities without modification', async () => {
      const logData = {
        ...saleLogData,
        item_quantity: 2.5,
        opening_balance: 10.5,
        closing_balance: 8,
      };
      mockRepositoryInstance.createStockLog.mockResolvedValue(OK({}, 'ok'));

      await service.createStockLog(logData);
      expect(mockRepositoryInstance.createStockLog.mock.calls[0][0].item_quantity).toBe(2.5);
    });

    test('returns status:false result from repository unchanged', async () => {
      const failResult = FAIL('Failed to create stock log');
      mockRepositoryInstance.createStockLog.mockResolvedValue(failResult);

      expect(await service.createStockLog(saleLogData)).toBe(failResult);
    });
  });

  // ── deleteStockLogs ───────────────────────────────────────────────────────────

  describe('deleteStockLogs', () => {
    test('delegates to repository.deleteStockLogs and returns its result', async () => {
      const mockResult = OK({ deletedCount: 2 }, 'Stock logs deleted successfully');
      mockRepositoryInstance.deleteStockLogs.mockResolvedValue(mockResult);

      const result = await service.deleteStockLogs([FAKE_LOG_ID, FAKE_ITEM_ID]);
      expect(result).toBe(mockResult);
    });

    test('passes ids array to repository unchanged', async () => {
      const ids = [FAKE_LOG_ID, FAKE_ITEM_ID];
      mockRepositoryInstance.deleteStockLogs.mockResolvedValue(OK({ deletedCount: 2 }, 'ok'));

      await service.deleteStockLogs(ids);
      expect(mockRepositoryInstance.deleteStockLogs).toHaveBeenCalledWith(ids);
    });

    test('passes single-element array to repository', async () => {
      const ids = [FAKE_LOG_ID];
      mockRepositoryInstance.deleteStockLogs.mockResolvedValue(OK({ deletedCount: 1 }, 'ok'));

      await service.deleteStockLogs(ids);
      expect(mockRepositoryInstance.deleteStockLogs).toHaveBeenCalledWith(ids);
    });

    test('passes empty array to repository without guarding', async () => {
      const failResult = FAIL('No stock log IDs provided');
      mockRepositoryInstance.deleteStockLogs.mockResolvedValue(failResult);

      const result = await service.deleteStockLogs([]);
      expect(result).toBe(failResult);
      expect(mockRepositoryInstance.deleteStockLogs).toHaveBeenCalledWith([]);
    });

    test('propagates repository rejection', async () => {
      mockRepositoryInstance.deleteStockLogs.mockRejectedValue(new Error('Update failed'));
      await expect(service.deleteStockLogs([FAKE_LOG_ID])).rejects.toThrow('Update failed');
    });

    test('returns no-match result from repository unchanged', async () => {
      const noMatch = FAIL('No matching stock logs found');
      mockRepositoryInstance.deleteStockLogs.mockResolvedValue(noMatch);

      expect(await service.deleteStockLogs(['nonexistent'])).toBe(noMatch);
    });
  });

  // ── exportStockLogs ───────────────────────────────────────────────────────────

  describe('exportStockLogs', () => {
    const mockExportData = [
      {
        Date: '01/15/2024, 10:00:00',
        'Item Name': 'Test Product',
        Barcode: 'BAR001',
        Quantity: 5,
        Process: 'Sale',
        Reference: 'S-2024-001',
        Action: 'Decrease',
        'Changed By': 'Admin',
        'Opening Balance': 10,
        'Closing Balance': 5,
      },
    ];

    test('delegates to repository.exportStockLogs and returns its result', async () => {
      const mockResult = OK(mockExportData, 'Stock logs exported successfully');
      mockRepositoryInstance.exportStockLogs.mockResolvedValue(mockResult);

      const result = await service.exportStockLogs({ process: 'Sale' });
      expect(result).toBe(mockResult);
    });

    test('passes filters to repository unchanged', async () => {
      const filters = { process: 'Receiving', branch_id: FAKE_BRANCH_ID };
      mockRepositoryInstance.exportStockLogs.mockResolvedValue(OK([], 'ok'));

      await service.exportStockLogs(filters);
      expect(mockRepositoryInstance.exportStockLogs).toHaveBeenCalledWith(filters);
    });

    test('uses empty object default when called with no arguments', async () => {
      mockRepositoryInstance.exportStockLogs.mockResolvedValue(OK([], 'ok'));

      await service.exportStockLogs();
      expect(mockRepositoryInstance.exportStockLogs).toHaveBeenCalledWith({});
    });

    test('propagates repository rejection', async () => {
      mockRepositoryInstance.exportStockLogs.mockRejectedValue(new Error('Export failed'));
      await expect(service.exportStockLogs()).rejects.toThrow('Export failed');
    });

    test('returns empty export data from repository unchanged', async () => {
      const emptyResult = OK([], 'Stock logs exported successfully');
      mockRepositoryInstance.exportStockLogs.mockResolvedValue(emptyResult);

      const result = await service.exportStockLogs();
      expect(result.data).toEqual([]);
    });

    test('passes date range filter for export', async () => {
      const filters = { created_date_from: '2024-01-01', created_date_to: '2024-01-31' };
      mockRepositoryInstance.exportStockLogs.mockResolvedValue(OK(mockExportData, 'ok'));

      await service.exportStockLogs(filters);
      expect(mockRepositoryInstance.exportStockLogs).toHaveBeenCalledWith(filters);
    });
  });

  // ── updateItemNameInStockLogs ─────────────────────────────────────────────────

  describe('updateItemNameInStockLogs', () => {
    test('delegates to repository.updateItemNameInStockLogs and returns its result', async () => {
      const mockResult = OK({ modifiedCount: 5 }, 'Item name updated in 5 stock log(s)');
      mockRepositoryInstance.updateItemNameInStockLogs.mockResolvedValue(mockResult);

      const result = await service.updateItemNameInStockLogs(FAKE_ITEM_ID, 'New Product Name');
      expect(result).toBe(mockResult);
    });

    test('passes itemId and newItemName to repository unchanged', async () => {
      mockRepositoryInstance.updateItemNameInStockLogs.mockResolvedValue(
        OK({ modifiedCount: 3 }, 'ok')
      );

      await service.updateItemNameInStockLogs(FAKE_ITEM_ID, 'Updated Name');
      expect(mockRepositoryInstance.updateItemNameInStockLogs).toHaveBeenCalledWith(
        FAKE_ITEM_ID,
        'Updated Name'
      );
    });

    test('propagates repository rejection', async () => {
      mockRepositoryInstance.updateItemNameInStockLogs.mockRejectedValue(
        new Error('Update failed')
      );
      await expect(service.updateItemNameInStockLogs(FAKE_ITEM_ID, 'Name')).rejects.toThrow(
        'Update failed'
      );
    });

    test('passes missing-field validation result from repository unchanged', async () => {
      const validationFail = FAIL('Item ID and new item name are required');
      mockRepositoryInstance.updateItemNameInStockLogs.mockResolvedValue(validationFail);

      const result = await service.updateItemNameInStockLogs(null, null);
      expect(result).toBe(validationFail);
    });

    test('passes name with special characters to repository unchanged', async () => {
      const specialName = 'Product & Co. (XL) — 500g';
      mockRepositoryInstance.updateItemNameInStockLogs.mockResolvedValue(
        OK({ modifiedCount: 1 }, 'ok')
      );

      await service.updateItemNameInStockLogs(FAKE_ITEM_ID, specialName);
      expect(mockRepositoryInstance.updateItemNameInStockLogs).toHaveBeenCalledWith(
        FAKE_ITEM_ID,
        specialName
      );
    });

    test('returns zero-modified result when no logs match the item', async () => {
      const zeroResult = OK({ modifiedCount: 0 }, 'Item name updated in 0 stock log(s)');
      mockRepositoryInstance.updateItemNameInStockLogs.mockResolvedValue(zeroResult);

      const result = await service.updateItemNameInStockLogs(FAKE_ITEM_ID, 'New Name');
      expect(result.data.modifiedCount).toBe(0);
    });
  });

  // ── cleanupOldDeletedLogs ─────────────────────────────────────────────────────

  describe('cleanupOldDeletedLogs', () => {
    test('delegates to repository.cleanupOldDeletedLogs and returns its result', async () => {
      const mockResult = OK({ deletedCount: 12 }, 'Permanently deleted 12 old stock log(s)');
      mockRepositoryInstance.cleanupOldDeletedLogs.mockResolvedValue(mockResult);

      const result = await service.cleanupOldDeletedLogs(90);
      expect(result).toBe(mockResult);
    });

    test('uses default 90 days when called with no argument', async () => {
      mockRepositoryInstance.cleanupOldDeletedLogs.mockResolvedValue(OK({ deletedCount: 0 }, 'ok'));

      await service.cleanupOldDeletedLogs();
      expect(mockRepositoryInstance.cleanupOldDeletedLogs).toHaveBeenCalledWith(90);
    });

    test('passes custom daysOld to repository', async () => {
      mockRepositoryInstance.cleanupOldDeletedLogs.mockResolvedValue(OK({ deletedCount: 5 }, 'ok'));

      await service.cleanupOldDeletedLogs(30);
      expect(mockRepositoryInstance.cleanupOldDeletedLogs).toHaveBeenCalledWith(30);
    });

    test('passes daysOld of 1 (aggressive cleanup)', async () => {
      mockRepositoryInstance.cleanupOldDeletedLogs.mockResolvedValue(
        OK({ deletedCount: 100 }, 'ok')
      );

      await service.cleanupOldDeletedLogs(1);
      expect(mockRepositoryInstance.cleanupOldDeletedLogs).toHaveBeenCalledWith(1);
    });

    test('passes large daysOld value', async () => {
      mockRepositoryInstance.cleanupOldDeletedLogs.mockResolvedValue(OK({ deletedCount: 0 }, 'ok'));

      await service.cleanupOldDeletedLogs(3650);
      expect(mockRepositoryInstance.cleanupOldDeletedLogs).toHaveBeenCalledWith(3650);
    });

    test('propagates repository rejection', async () => {
      mockRepositoryInstance.cleanupOldDeletedLogs.mockRejectedValue(new Error('Delete failed'));
      await expect(service.cleanupOldDeletedLogs()).rejects.toThrow('Delete failed');
    });

    test('returns no-old-logs result from repository unchanged', async () => {
      const noneResult = OK({ deletedCount: 0 }, 'No old deleted logs to cleanup');
      mockRepositoryInstance.cleanupOldDeletedLogs.mockResolvedValue(noneResult);

      const result = await service.cleanupOldDeletedLogs(90);
      expect(result).toBe(noneResult);
      expect(result.data.deletedCount).toBe(0);
    });
  });

  // ── delegation contract ───────────────────────────────────────────────────────

  describe('delegation contract (all methods return repository result directly)', () => {
    test.each([
      ['getStockLogs', () => service.getStockLogs({}, {}), 'getStockLogs'],
      ['getStockLogDetail', () => service.getStockLogDetail(FAKE_LOG_ID), 'getStockLogDetail'],
      ['createStockLog', () => service.createStockLog({}), 'createStockLog'],
      ['deleteStockLogs', () => service.deleteStockLogs([FAKE_LOG_ID]), 'deleteStockLogs'],
      ['exportStockLogs', () => service.exportStockLogs({}), 'exportStockLogs'],
      [
        'updateItemNameInStockLogs',
        () => service.updateItemNameInStockLogs('id', 'n'),
        'updateItemNameInStockLogs',
      ],
      ['cleanupOldDeletedLogs', () => service.cleanupOldDeletedLogs(90), 'cleanupOldDeletedLogs'],
    ])(
      '%s returns the exact object from repository (reference equality)',
      async (name, invoke, repoMethod) => {
        const sentinel = { __sentinel: name };
        mockRepositoryInstance[repoMethod].mockResolvedValue(sentinel);
        expect(await invoke()).toBe(sentinel);
      }
    );

    test.each([
      ['getStockLogs', () => service.getStockLogs(), 'getStockLogs'],
      ['getStockLogDetail', () => service.getStockLogDetail('id'), 'getStockLogDetail'],
      ['createStockLog', () => service.createStockLog({}), 'createStockLog'],
      ['deleteStockLogs', () => service.deleteStockLogs(['id']), 'deleteStockLogs'],
      ['exportStockLogs', () => service.exportStockLogs(), 'exportStockLogs'],
      [
        'updateItemNameInStockLogs',
        () => service.updateItemNameInStockLogs('id', 'n'),
        'updateItemNameInStockLogs',
      ],
      ['cleanupOldDeletedLogs', () => service.cleanupOldDeletedLogs(), 'cleanupOldDeletedLogs'],
    ])('%s propagates repository rejection', async (name, invoke, repoMethod) => {
      mockRepositoryInstance[repoMethod].mockRejectedValue(new Error(`${name} repo error`));
      await expect(invoke()).rejects.toThrow(`${name} repo error`);
    });
  });
});
