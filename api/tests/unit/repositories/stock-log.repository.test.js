'use strict';

/**
 * Unit tests for src/repositories/stock-logs.repository.js
 * CLASS export — module.exports = StockLogsRepository
 * Extends BaseModel, uses native MongoDB driver
 */

// ─── Mock mongodb ObjectId ────────────────────────────────────────────────────
jest.mock('mongodb', () => {
  const ObjectIdMock = jest.fn((id) => ({
    toString: () => String(id),
    toHexString: () => String(id),
    equals: (o) => String(id) === String(o),
  }));
  ObjectIdMock.isValid = jest.fn(() => true);
  return { ObjectId: ObjectIdMock };
});

// ─── Mock stock-logs helper ───────────────────────────────────────────────────
jest.mock('../../../src/helpers/stock-logs.helper', () => ({
  applyCreatedDateRangeFilter: jest.fn((query) => query),
  applyDateRangeFilters: jest.fn((query) => query),
}));

// ─── Mock BaseModel ───────────────────────────────────────────────────────────
jest.mock('../../../src/models/base.model', () => {
  class MockBaseModel {
    constructor(collectionName) {
      this.collectionName = collectionName;
    }
  }
  MockBaseModel.prototype.getCollection = jest.fn();
  MockBaseModel.prototype.page = jest.fn();
  MockBaseModel.simplifyFields = jest.fn((doc) => doc);
  MockBaseModel.deletedDocumentBackup = jest.fn().mockResolvedValue({ status: true });
  MockBaseModel.license = null;
  MockBaseModel.currentBranch = null;
  MockBaseModel.loggedUser = null;
  MockBaseModel.currentTimeZone = 'Asia/Kolkata';
  return MockBaseModel;
});

// ─── Imports (after mocks) ────────────────────────────────────────────────────
const StockLogsRepository = require('../../../src/repositories/stock-log.repository');
const BaseModel = require('../../../src/models/base.model');
require('mongodb');
const { ERROR_MESSAGES, SUCCESS_MESSAGES } = require('../../../src/constants/stock-logs.constants');

// ─── Shared fake IDs ──────────────────────────────────────────────────────────
const FAKE_ID = '64f9a1c2e3b4d5e6f7000001';
const FAKE_BRANCH = '64f9a1c2e3b4d5e6f7000002';
const FAKE_LICENSE = '64f9a1c2e3b4d5e6f7000003';
const FAKE_ITEM = '64f9a1c2e3b4d5e6f7000004';

// ─── Collection chain helpers ─────────────────────────────────────────────────
const mkFindChain = (result) => ({
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  toArray: jest.fn().mockResolvedValue(result),
});

// ══════════════════════════════════════════════════════════════════════════════
describe('StockLogsRepository', () => {
  let repo;
  let col;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});

    // Set BaseModel static context
    BaseModel.license = FAKE_LICENSE;
    BaseModel.currentBranch = FAKE_BRANCH;
    BaseModel.loggedUser = FAKE_ID;

    // Mock collection
    col = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockReturnValue(mkFindChain([])),
      insertOne: jest.fn().mockResolvedValue({ insertedId: FAKE_ID }),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      updateMany: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      countDocuments: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    };

    repo = new StockLogsRepository();
    repo.getCollection = jest.fn().mockResolvedValue(col);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Constructor ─────────────────────────────────────────────────────────────

  describe('constructor', () => {
    test('extends BaseModel with collectionName "stocklogs"', () => {
      expect(repo.collectionName).toBe('stocklogs');
    });
  });

  // ── getStockLogs ────────────────────────────────────────────────────────────

  describe('getStockLogs', () => {
    test('returns paginated stock logs', async () => {
      const pageResult = {
        status: true,
        data: { list: [{ _id: FAKE_ID }], total: 1, current_page: 1, total_pages: 1, per_page: 10 },
        message: 'success',
      };
      repo.page.mockResolvedValue(pageResult);

      const r = await repo.getStockLogs({}, { page: 1, limit: 10 });

      expect(r.status).toBe(true);
      expect(r.data.list).toEqual([{ _id: FAKE_ID }]);
      expect(r.message).toBe(SUCCESS_MESSAGES.STOCK_LOGS_RETRIEVED);
    });

    test('applies license and branch filters', async () => {
      repo.page.mockResolvedValue({
        status: true,
        data: { list: [], total: 0, current_page: 1, total_pages: 0, per_page: 10 },
        message: 'success',
      });

      await repo.getStockLogs({ process: 'sale' });

      expect(repo.page).toHaveBeenCalledWith(
        'stocklogs',
        {},
        expect.objectContaining({
          process: 'sale',
          is_deleted: { $ne: true },
          license: FAKE_LICENSE,
          branch_id: FAKE_BRANCH,
        }),
        expect.objectContaining({ page: 1, limit: 10 })
      );
    });

    test('uses default pagination values', async () => {
      repo.page.mockResolvedValue({
        status: true,
        data: { list: [], total: 0, current_page: 1, total_pages: 0, per_page: 10 },
        message: 'success',
      });

      await repo.getStockLogs();

      expect(repo.page).toHaveBeenCalledWith(
        'stocklogs',
        {},
        expect.objectContaining({ is_deleted: { $ne: true } }),
        expect.objectContaining({ page: 1, limit: 10 })
      );
    });

    test('returns error when page fails', async () => {
      repo.page.mockResolvedValue({ status: false, message: 'page error' });

      const r = await repo.getStockLogs();

      expect(r.status).toBe(false);
      expect(r.message).toBe('page error');
    });

    test('catches exception and returns error', async () => {
      repo.page.mockRejectedValue(new Error('db fail'));

      const r = await repo.getStockLogs();

      expect(r.status).toBe(false);
      expect(r.message).toBe('db fail');
    });
  });

  // ── getStockLogDetail ───────────────────────────────────────────────────────

  describe('getStockLogDetail', () => {
    test('returns stock log when found', async () => {
      const logDoc = { _id: FAKE_ID, item_name: 'Widget' };
      col.findOne.mockResolvedValue(logDoc);

      const r = await repo.getStockLogDetail(FAKE_ID);

      expect(r.status).toBe(true);
      expect(r.data).toEqual(logDoc);
      expect(r.message).toBe(SUCCESS_MESSAGES.STOCK_LOG_RETRIEVED);
      expect(col.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: expect.anything(),
          is_deleted: { $ne: true },
          license: FAKE_LICENSE,
        })
      );
    });

    test('returns not found when log does not exist', async () => {
      col.findOne.mockResolvedValue(null);

      const r = await repo.getStockLogDetail(FAKE_ID);

      expect(r.status).toBe(false);
      expect(r.message).toBe(ERROR_MESSAGES.STOCK_LOG_NOT_FOUND);
    });

    test('catches exception and returns error', async () => {
      col.findOne.mockRejectedValue(new Error('find fail'));

      const r = await repo.getStockLogDetail(FAKE_ID);

      expect(r.status).toBe(false);
      expect(r.message).toBe('find fail');
    });
  });

  // ── createStockLog ────────────────────────────────────────────────────────────

  describe('createStockLog', () => {
    test('creates stock log with all fields', async () => {
      const logData = {
        branch_id: FAKE_BRANCH,
        view_item_id: FAKE_ITEM,
        item_barcode_id: 'BAR001',
        item_name: 'Widget',
        item_quantity: '5',
        process: 'sale',
        reference: 'SALE001',
        action: 'stock_out',
        stocklog: true,
        opening_balance: '100',
        closing_balance: '95',
        count: '5',
        changed_by: 'Admin',
        changed_by_userid: FAKE_ID,
        date: new Date('2024-01-15'),
      };

      const r = await repo.createStockLog(logData);

      expect(r.status).toBe(true);
      expect(r.message).toBe(SUCCESS_MESSAGES.STOCK_LOG_CREATED);
      expect(col.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          branch_id: expect.anything(),
          view_item_id: expect.anything(),
          item_name: 'Widget',
          item_quantity: '5',
          process: 'sale',
          stocklog: true,
          opening_balance: '100',
          closing_balance: '95',
          license: FAKE_LICENSE,
        })
      );
    });

    test('uses defaults when optional fields missing', async () => {
      const logData = {
        item_name: 'Widget',
        item_quantity: '1',
      };

      const r = await repo.createStockLog(logData);

      expect(r.status).toBe(true);
      expect(col.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          item_name: 'Widget',
          branch_id: expect.anything(),
          license: FAKE_LICENSE,
        })
      );
    });

    test('uses N/A for balances when stocklog is false', async () => {
      const logData = {
        item_name: 'Widget',
        stocklog: false,
        opening_balance: '100',
        closing_balance: '95',
      };

      await repo.createStockLog(logData);

      expect(col.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          opening_balance: 'N/A',
          closing_balance: 'N/A',
        })
      );
    });

    test('catches exception and returns error', async () => {
      col.insertOne.mockRejectedValue(new Error('insert fail'));

      const r = await repo.createStockLog({ item_name: 'X' });

      expect(r.status).toBe(false);
      expect(r.message).toBe('insert fail');
    });
  });

  // ── deleteStockLogs ───────────────────────────────────────────────────────────

  describe('deleteStockLogs', () => {
    test('returns error for empty array', async () => {
      const r = await repo.deleteStockLogs([]);

      expect(r.status).toBe(false);
      expect(r.message).toBe(ERROR_MESSAGES.NO_STOCK_LOG_IDS_PROVIDED);
    });

    test('returns error for non-array', async () => {
      const r = await repo.deleteStockLogs(null);

      expect(r.status).toBe(false);
      expect(r.message).toBe(ERROR_MESSAGES.NO_STOCK_LOG_IDS_PROVIDED);
    });

    test('soft deletes stock logs with backup', async () => {
      const logs = [{ _id: FAKE_ID, item_name: 'A' }];
      col.find.mockReturnValue(mkFindChain(logs));

      const r = await repo.deleteStockLogs([FAKE_ID]);

      expect(r.status).toBe(true);
      expect(r.data.deletedCount).toBe(1);
      expect(r.message).toBe(SUCCESS_MESSAGES.STOCK_LOGS_DELETED);
      expect(BaseModel.deletedDocumentBackup).toHaveBeenCalledTimes(1);
      expect(col.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: { $in: expect.any(Array) },
          license: FAKE_LICENSE,
        }),
        expect.objectContaining({
          $set: expect.objectContaining({
            is_deleted: true,
            deleted_at: expect.any(Date),
          }),
        })
      );
    });

    test('returns error when no logs match', async () => {
      col.find.mockReturnValue(mkFindChain([]));
      col.updateMany.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });

      const r = await repo.deleteStockLogs([FAKE_ID]);

      expect(r.status).toBe(false);
      expect(r.message).toBe(ERROR_MESSAGES.NO_MATCHING_STOCK_LOGS);
    });

    test('catches exception and returns error', async () => {
      col.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockRejectedValue(new Error('find fail')),
      });

      const r = await repo.deleteStockLogs([FAKE_ID]);

      expect(r.status).toBe(false);
      expect(r.message).toBe('find fail');
    });
  });

  // ── exportStockLogs ─────────────────────────────────────────────────────────

  describe('exportStockLogs', () => {
    test('returns formatted export data', async () => {
      const logs = [
        {
          date: new Date('2024-01-15'),
          item_name: 'Widget',
          item_barcode_id: 'BAR001',
          item_quantity: '5',
          process: 'sale',
          reference: 'SALE001',
          action: 'stock_out',
          changed_by: 'Admin',
          opening_balance: '100',
          closing_balance: '95',
        },
      ];
      col.find.mockReturnValue(mkFindChain(logs));

      const r = await repo.exportStockLogs({});

      expect(r.status).toBe(true);
      expect(r.data).toHaveLength(1);
      expect(r.data[0]).toMatchObject({
        Date: expect.any(String),
        'Item Name': 'Widget',
        Barcode: 'BAR001',
        Quantity: '5',
      });
      expect(r.message).toBe(SUCCESS_MESSAGES.STOCK_LOGS_EXPORTED);
    });

    test('applies license filter', async () => {
      col.find.mockReturnValue(mkFindChain([]));

      await repo.exportStockLogs({ process: 'sale' });

      expect(col.find).toHaveBeenCalledWith(
        expect.objectContaining({
          process: 'sale',
          license: FAKE_LICENSE,
          is_deleted: { $ne: true },
        })
      );
    });

    test('catches exception and returns error', async () => {
      col.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockRejectedValue(new Error('export fail')),
      });

      const r = await repo.exportStockLogs();

      expect(r.status).toBe(false);
      expect(r.message).toBe('export fail');
    });
  });

  // ── updateItemNameInStockLogs ─────────────────────────────────────────────────

  describe('updateItemNameInStockLogs', () => {
    test('returns error when itemId missing', async () => {
      const r = await repo.updateItemNameInStockLogs(null, 'New Name');

      expect(r.status).toBe(false);
      expect(r.message).toBe('Item ID and new item name are required');
    });

    test('returns error when newItemName missing', async () => {
      const r = await repo.updateItemNameInStockLogs(FAKE_ITEM, null);

      expect(r.status).toBe(false);
      expect(r.message).toBe('Item ID and new item name are required');
    });

    test('updates item name and returns modified count', async () => {
      col.updateMany.mockResolvedValue({ modifiedCount: 3 });

      const r = await repo.updateItemNameInStockLogs(FAKE_ITEM, 'Updated Widget');

      expect(r.status).toBe(true);
      expect(r.data.modifiedCount).toBe(3);
      expect(col.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          view_item_id: expect.anything(),
          license: FAKE_LICENSE,
        }),
        expect.objectContaining({
          $set: expect.objectContaining({
            item_name: 'Updated Widget',
            updated_date: expect.any(Date),
          }),
        })
      );
    });

    test('catches exception and returns error', async () => {
      col.updateMany.mockRejectedValue(new Error('update fail'));

      const r = await repo.updateItemNameInStockLogs(FAKE_ITEM, 'New');

      expect(r.status).toBe(false);
      expect(r.message).toBe('update fail');
    });
  });

  // ── cleanupOldDeletedLogs ─────────────────────────────────────────────────────

  describe('cleanupOldDeletedLogs', () => {
    test('returns no logs when none to cleanup', async () => {
      col.find.mockReturnValue(mkFindChain([]));

      const r = await repo.cleanupOldDeletedLogs(90);

      expect(r.status).toBe(true);
      expect(r.data.deletedCount).toBe(0);
      expect(r.message).toBe('No old deleted logs to cleanup');
    });

    test('permanently deletes old soft-deleted logs', async () => {
      const oldLogs = [{ _id: FAKE_ID, is_deleted: true }];
      col.find.mockReturnValue(mkFindChain(oldLogs));
      col.deleteMany.mockResolvedValue({ deletedCount: 1 });

      const r = await repo.cleanupOldDeletedLogs(30);

      expect(r.status).toBe(true);
      expect(r.data.deletedCount).toBe(1);
      expect(col.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          is_deleted: true,
          deleted_at: { $lte: expect.any(Date) },
          license: FAKE_LICENSE,
        })
      );
    });

    test('uses default 90 days', async () => {
      col.find.mockReturnValue(mkFindChain([]));

      await repo.cleanupOldDeletedLogs();

      expect(col.find).toHaveBeenCalledWith(
        expect.objectContaining({
          is_deleted: true,
          deleted_at: { $lte: expect.any(Date) },
        })
      );
    });

    test('catches exception and returns error', async () => {
      col.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockRejectedValue(new Error('cleanup fail')),
      });

      const r = await repo.cleanupOldDeletedLogs(90);

      expect(r.status).toBe(false);
      expect(r.message).toBe('cleanup fail');
    });
  });

  // ── Multi-tenancy edge cases ─────────────────────────────────────────────────

  describe('Multi-tenancy edge cases', () => {
    test('getStockLogs omits branch filter when currentBranch is null', async () => {
      BaseModel.currentBranch = null;
      repo.page.mockResolvedValue({
        status: true,
        data: { list: [], total: 0, current_page: 1, total_pages: 0, per_page: 10 },
        message: 'success',
      });

      await repo.getStockLogs();

      expect(repo.page).toHaveBeenCalledWith(
        'stocklogs',
        {},
        expect.not.objectContaining({ branch_id: expect.anything() }),
        expect.any(Object)
      );
    });

    test('getStockLogs omits license filter when license is null', async () => {
      BaseModel.license = null;
      repo.page.mockResolvedValue({
        status: true,
        data: { list: [], total: 0, current_page: 1, total_pages: 0, per_page: 10 },
        message: 'success',
      });

      await repo.getStockLogs();

      expect(repo.page).toHaveBeenCalledWith(
        'stocklogs',
        {},
        expect.not.objectContaining({ license: expect.anything() }),
        expect.any(Object)
      );
    });

    test('getStockLogDetail omits license when null', async () => {
      BaseModel.license = null;
      col.findOne.mockResolvedValue({ _id: FAKE_ID });

      await repo.getStockLogDetail(FAKE_ID);

      expect(col.findOne).toHaveBeenCalledWith(
        expect.not.objectContaining({ license: expect.anything() })
      );
    });
  });

  // ── Null/edge payload scenarios ──────────────────────────────────────────────

  describe('Null and edge payload scenarios', () => {
    test('createStockLog with empty payload', async () => {
      const r = await repo.createStockLog({});

      expect(r.status).toBe(true);
      expect(col.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          item_name: undefined,
          license: FAKE_LICENSE,
        })
      );
    });

    test('createStockLog with zero quantity', async () => {
      await repo.createStockLog({ item_quantity: '0' });

      expect(col.insertOne).toHaveBeenCalledWith(expect.objectContaining({ item_quantity: '0' }));
    });

    test('createStockLog with negative quantity', async () => {
      await repo.createStockLog({ item_quantity: '-5' });

      expect(col.insertOne).toHaveBeenCalledWith(expect.objectContaining({ item_quantity: '-5' }));
    });

    test('deleteStockLogs with string IDs array', async () => {
      const logs = [{ _id: 'id1' }];
      col.find.mockReturnValue(mkFindChain(logs));

      const r = await repo.deleteStockLogs(['id1', 'id2']);

      expect(r.status).toBe(true);
      expect(col.updateMany).toHaveBeenCalled();
    });
  });
});
