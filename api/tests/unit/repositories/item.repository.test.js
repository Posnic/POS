'use strict';

/**
 * Unit tests for src/repositories/item.repository.js
 * File: 3538 lines, CLASS export, extends BaseModel, super("items")
 * Uses MongoDB native driver, Mongoose Branch model, StockLogsRepository
 * 34 methods — mix of rethrow and try-catch error strategies
 */

jest.mock('../../../src/constants/items.constants', () => ({
  DEFAULTS: { IMAGE: 'item.svg' },
  ITEM_STATUS: { REGULAR: 'regular', INSTANT: 'instant' },
  SUCCESS_MESSAGES: { ITEM_CREATED: 'Created', ITEM_UPDATED: 'Updated' },
  ERROR_MESSAGES: { ITEM_NOT_FOUND: 'Not found', BRANCH_LICENSE_REQUIRED: 'Required' },
}));

jest.mock('mongodb', () => {
  const m = jest.fn((id) => ({ toString: () => id, toHexString: () => id }));
  m.isValid = jest.fn(() => true);
  return { ObjectId: m };
});

jest.mock('../../../src/models/item.model', () => ({
  LegacyItemModel: { fields: { name: {}, price: {} }, collectionName: 'items' },
}));

jest.mock('../../../src/models/branch.model', () => ({
  findById: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
  findOne: jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue({ branch_name: 'Main Branch' }),
    }),
  }),
}));

jest.mock(
  '../../../src/repositories/stock-log.repository',
  () =>
    class {
      createStockLog() {
        return Promise.resolve();
      }
      updateItemNameInStockLogs() {
        return Promise.resolve();
      }
    }
);

let MockBaseModel;
jest.mock('../../../src/models/base.model', () => {
  function MockBaseModel(c) {
    this.collectionName = c;
  }
  MockBaseModel.prototype.toObjectId = jest.fn((id) => id);
  MockBaseModel.prototype.findOne = jest.fn(async function (query) {
    const collection = await this.getCollection(this.collectionName);
    return collection.findOne(query);
  });
  MockBaseModel.prototype.checkPlan = jest.fn().mockResolvedValue(0);
  MockBaseModel.prototype.assignFilterObjects = jest.fn((f) => f);
  MockBaseModel.prototype.startingDate = jest.fn((d) => new Date(d));
  MockBaseModel.prototype.endingDate = jest.fn((d) => new Date(d));
  MockBaseModel.startingDate = jest.fn((d) => new Date(d));
  MockBaseModel.endingDate = jest.fn((d) => new Date(d));
  MockBaseModel.simplifyFields = jest.fn((d) => d);
  MockBaseModel.getSelectFields = jest.fn(() => ({}));
  MockBaseModel.getAllDataChanges = jest.fn().mockResolvedValue([]);
  MockBaseModel.deletedDocumentBackup = jest.fn().mockResolvedValue({});
  MockBaseModel.currentTimeZone = 'Asia/Kolkata';
  MockBaseModel.license = null;
  return MockBaseModel;
});

const ItemRepository = require('../../../src/repositories/item.repository');
const BaseModel = require('../../../src/models/base.model');
const { ObjectId } = require('mongodb');
const Branch = require('../../../src/models/branch.model');

const FAKE_ID = '64f9a1c2e3b4d5e6f7000001';
const FAKE_BRANCH = '64f9a1c2e3b4d5e6f7000002';
const FAKE_LICENSE = '64f9a1c2e3b4d5e6f7000003';

const mkChain = (result) => ({
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  toArray: jest.fn().mockResolvedValue(result),
});

const mkAgg = (result) => ({
  toArray: jest.fn().mockResolvedValue(result),
});

describe('ItemRepository', () => {
  let repo;
  let col;
  let consoleErrorSpy;
  let consoleLogSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    col = {
      find: jest.fn().mockReturnValue(mkChain([])),
      findOne: jest.fn().mockResolvedValue(null),
      insertOne: jest.fn().mockResolvedValue({ insertedId: FAKE_ID }),
      insertMany: jest.fn().mockResolvedValue({ insertedIds: [FAKE_ID] }),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      updateMany: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      countDocuments: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockReturnValue(mkAgg([])),
    };
    repo = new ItemRepository();
    repo.getCollection = jest.fn().mockResolvedValue(col);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  test('extends BaseModel with "items"', () => {
    expect(repo.collectionName).toBe('items');
  });

  describe('findPage', () => {
    test('returns paginated items', async () => {
      col.find.mockReturnValue(mkChain([{ _id: FAKE_ID }]));
      col.countDocuments.mockResolvedValue(1);
      const r = await repo.findPage({ branchId: FAKE_BRANCH, licenseId: FAKE_LICENSE });
      expect(r.items).toHaveLength(1);
      expect(r.total).toBe(1);
      expect(r.page).toBe(1);
      const filter = col.find.mock.calls[0][0];
      expect(filter).toEqual(
        expect.objectContaining({
          'branch_access.branch_id': FAKE_BRANCH,
          license: FAKE_LICENSE,
        })
      );
      expect(filter).not.toHaveProperty('branch_id');
      expect(filter).not.toHaveProperty('branch_name');
    });
    test('rethrows error', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repo.findPage({})).rejects.toThrow('fail');
    });
    test('does not allow client filters to override branch or license scope', async () => {
      await repo.findPage({
        branchId: FAKE_BRANCH,
        licenseId: FAKE_LICENSE,
        filters: {
          branch_id: 'other-branch',
          branch_name: 'Other Branch',
          license: 'other-license',
        },
      });

      const filter = col.find.mock.calls[0][0];
      expect(filter['branch_access.branch_id']).toBe(FAKE_BRANCH);
      expect(filter).not.toHaveProperty('branch_id');
      expect(filter).not.toHaveProperty('branch_name');
      expect(filter.license).toBe(FAKE_LICENSE);
    });
  });

  describe('upsertItem', () => {
    const ctx = {
      branchId: FAKE_BRANCH,
      licenseId: FAKE_LICENSE,
      loggedUserName: 'admin',
      loggedUserId: 'u1',
    };
    const data = {
      name: 'Pen',
      barcode_id: 'B001',
      mrp_price: '10',
      company_price: '5',
      selling_price: '8',
      available_quantity: '100',
    };

    test('create returns success', async () => {
      col.findOne.mockResolvedValueOnce(null);
      const r = await repo.upsertItem(data, '', ctx);
      expect(r.status).toBe(true);
      expect(r.message).toBe('Created');
      const inserted = col.insertOne.mock.calls[0][0];
      expect(inserted.branch_id.toString()).toBe(FAKE_BRANCH);
      expect(inserted.branch_name).toBe('Main Branch');
      expect(inserted.license.toString()).toBe(FAKE_LICENSE);
    });

    test('rejects creation when the branch is not part of the current license', async () => {
      Branch.findOne.mockReturnValueOnce({
        select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }),
      });

      const r = await repo.upsertItem(data, '', ctx);

      expect(r.status).toBe(false);
      expect(col.insertOne).not.toHaveBeenCalled();
    });
    test('create returns exist when duplicate', async () => {
      col.findOne.mockResolvedValueOnce({ _id: { toString: () => 'other' } });
      const r = await repo.upsertItem(data, '', ctx);
      expect(r.status).toBe('exist');
    });
    test('update returns success', async () => {
      col.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ track_inventory: true, available_quantity: 50, name: 'Pen' });
      const r = await repo.upsertItem(data, FAKE_ID, ctx);
      expect(r.status).toBe(true);
      expect(r.message).toBe('Updated');
    });
    test('returns error without branch/license', async () => {
      const r = await repo.upsertItem(data, '', {});
      expect(r.status).toBe(false);
    });
    test('returns error on exception', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      const r = await repo.upsertItem(data, '', ctx);
      expect(r.status).toBe(false);
    });
  });

  describe('deleteItems', () => {
    test('deletes items with backup', async () => {
      col.find.mockReturnValue(
        mkChain([
          {
            _id: FAKE_ID,
            track_inventory: true,
            available_quantity: 5,
            barcode_id: 'B1',
            name: 'Pen',
          },
        ])
      );
      const r = await repo.deleteItems([FAKE_ID], {
        branchId: FAKE_BRANCH,
        licenseId: FAKE_LICENSE,
      });
      expect(r.status).toBe(true);
      expect(BaseModel.deletedDocumentBackup).toHaveBeenCalled();
    });
    test('returns error when no ids', async () => {
      const r = await repo.deleteItems([]);
      expect(r.status).toBe(false);
    });
    test('returns error on exception', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      const r = await repo.deleteItems([FAKE_ID]);
      expect(r.status).toBe(false);
    });
  });

  describe('getItemsByCategory', () => {
    test('returns items', async () => {
      col.find.mockReturnValue(mkChain([{ name: 'A' }]));
      const r = await repo.getItemsByCategory(FAKE_ID);
      expect(r).toEqual([{ name: 'A' }]);
    });
    test('rethrows error', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repo.getItemsByCategory(FAKE_ID)).rejects.toThrow('fail');
    });
  });

  describe('searchItems', () => {
    test('returns items by query', async () => {
      col.find.mockReturnValue(mkChain([{ name: 'A' }]));
      const r = await repo.searchItems('pen');
      expect(r).toEqual([{ name: 'A' }]);
    });
    test('rethrows error', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repo.searchItems('q')).rejects.toThrow('fail');
    });
  });

  describe('getItemTableRow', () => {
    test('returns item with status true', async () => {
      col.findOne.mockResolvedValue({
        _id: FAKE_ID,
        branch_access: [{ branch_id: FAKE_BRANCH, branch_name: 'Main' }],
        hsncode: '1234',
        items_mfg_date: null,
      });
      const r = await repo.getItemTableRow(FAKE_ID, {
        branchId: FAKE_BRANCH,
        licenseId: FAKE_LICENSE,
      });
      expect(r.status).toBe(true);
      const lookupFilter = col.findOne.mock.calls[0][0];
      expect(lookupFilter.license.toString()).toBe(FAKE_LICENSE);
      expect(lookupFilter.$or[0]['branch_access.branch_id'].toString()).toBe(FAKE_BRANCH);
      expect(lookupFilter.$or[1].branch_id.toString()).toBe(FAKE_BRANCH);
    });
    test('returns not found when invalid id', async () => {
      ObjectId.isValid.mockReturnValueOnce(false);
      const r = await repo.getItemTableRow('bad');
      expect(r.status).toBe(false);
    });
    test('returns not found when missing', async () => {
      col.findOne.mockResolvedValueOnce(null);
      const r = await repo.getItemTableRow(FAKE_ID);
      expect(r.status).toBe(false);
    });
    test('returns error on exception', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      const r = await repo.getItemTableRow(FAKE_ID);
      expect(r.status).toBe(false);
    });
  });

  describe('getLowStockItems', () => {
    test('returns low stock list', async () => {
      col.find.mockReturnValue(mkChain([{ name: 'A', available_quantity: 2 }]));
      col.countDocuments.mockResolvedValue(1);
      const r = await repo.getLowStockItems({ branchId: FAKE_BRANCH, notificationRange: 5 });
      expect(r.status).toBe(true);
      expect(r.data.list).toHaveLength(1);
    });
    test('returns error on exception', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      const r = await repo.getLowStockItems({});
      expect(r.status).toBe(false);
    });
  });

  describe('getOnlineItemsAjaxList', () => {
    test('returns suggestions', async () => {
      col.aggregate.mockReturnValue(mkAgg([{ _id: FAKE_ID, name: 'A' }]));
      const r = await repo.getOnlineItemsAjaxList(
        { query: 'a' },
        { branchId: FAKE_BRANCH, licenseId: FAKE_LICENSE }
      );
      expect(r.status).toBe(true);
      expect(r.data).toHaveLength(1);
    });
    test('returns error without branch', async () => {
      const r = await repo.getOnlineItemsAjaxList({}, {});
      expect(r.status).toBe(false);
    });
    test('returns error on exception', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      const r = await repo.getOnlineItemsAjaxList({ query: 'a' }, { branchId: FAKE_BRANCH });
      expect(r.status).toBe(false);
    });
  });

  describe('getOnlineSalesItems', () => {
    test('returns sales items', async () => {
      col.find.mockReturnValue(mkChain([{ track_inventory: false, name: 'A' }]));
      const r = await repo.getOnlineSalesItems(
        {},
        { branchId: FAKE_BRANCH, licenseId: FAKE_LICENSE }
      );
      expect(r.status).toBe(true);
    });
    test('returns error without branch', async () => {
      const r = await repo.getOnlineSalesItems({}, {});
      expect(r.status).toBe(false);
    });
    test('returns error on exception', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      const r = await repo.getOnlineSalesItems({}, { branchId: FAKE_BRANCH });
      expect(r.status).toBe(false);
    });
  });

  describe('createInstantItem', () => {
    test('creates instant item', async () => {
      const r = await repo.createInstantItem(
        { items_name: 'Instant' },
        { branchId: FAKE_BRANCH, licenseId: FAKE_LICENSE }
      );
      expect(r.status).toBe(true);
      expect(r.message).toBe('Created');
    });
    test('returns error without branch', async () => {
      const r = await repo.createInstantItem({}, {});
      expect(r.status).toBe(false);
    });
    test('returns error without license', async () => {
      const r = await repo.createInstantItem({}, { branchId: FAKE_BRANCH });
      expect(r.status).toBe(false);
    });
    test('returns error on exception', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      const r = await repo.createInstantItem(
        { items_name: 'X' },
        { branchId: FAKE_BRANCH, licenseId: FAKE_LICENSE }
      );
      expect(r.status).toBe(false);
    });
  });

  describe('deleteInstantItem', () => {
    test('deletes instant item', async () => {
      col.findOne.mockResolvedValueOnce({ _id: FAKE_ID });
      const r = await repo.deleteInstantItem(FAKE_ID, {
        branchId: FAKE_BRANCH,
        licenseId: FAKE_LICENSE,
      });
      expect(r.status).toBe(true);
    });
    test('returns error when invalid id', async () => {
      ObjectId.isValid.mockReturnValueOnce(false);
      const r = await repo.deleteInstantItem('bad');
      expect(r.status).toBe(false);
    });
    test('returns not found', async () => {
      col.findOne.mockResolvedValueOnce(null);
      const r = await repo.deleteInstantItem(FAKE_ID);
      expect(r.status).toBe(false);
    });
    test('returns error on exception', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      const r = await repo.deleteInstantItem(FAKE_ID);
      expect(r.status).toBe(false);
    });
  });

  describe('getReceivingItemsAjaxList', () => {
    test('returns receiving items', async () => {
      col.find.mockReturnValue(mkChain([{ name: 'A' }]));
      const r = await repo.getReceivingItemsAjaxList(
        { query: 'a' },
        { branchId: FAKE_BRANCH, licenseId: FAKE_LICENSE }
      );
      expect(r.status).toBe(true);
    });
    test('returns error without branch', async () => {
      const r = await repo.getReceivingItemsAjaxList({}, {});
      expect(r.status).toBe(false);
    });
    test('returns error on exception', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      const r = await repo.getReceivingItemsAjaxList({}, { branchId: FAKE_BRANCH });
      expect(r.status).toBe(false);
    });
  });

  describe('accessKiosk', () => {
    test('returns kiosk data', async () => {
      const branchCol = {
        findOne: jest.fn().mockResolvedValue({
          _id: FAKE_ID,
          license: FAKE_LICENSE,
          kiosk: [
            {
              store_id: 's1',
              logo: '',
              banner: '',
              homebanner: '',
              advertisement: '',
              payment_cod: '',
              payment_razorpay: '',
              payment_number: '',
              printer_name: '',
            },
          ],
        }),
      };
      repo.getCollection.mockImplementation((n) =>
        n === 'branches' ? Promise.resolve(branchCol) : Promise.resolve(col)
      );
      col.aggregate.mockReturnValue(
        mkAgg([{ category_id: FAKE_ID, category_name: 'A', items: [] }])
      );
      const r = await repo.accessKiosk('s1');
      expect(r.status).toBe(true);
    });
    test('returns not found when branch missing', async () => {
      const branchCol = { findOne: jest.fn().mockResolvedValue(null) };
      repo.getCollection.mockImplementation((n) =>
        n === 'branches' ? Promise.resolve(branchCol) : Promise.resolve(col)
      );
      const r = await repo.accessKiosk('s1');
      expect(r.status).toBe(false);
    });
    test('returns error on exception', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      const r = await repo.accessKiosk('s1');
      expect(r.status).toBe(false);
    });
  });

  describe('updateKioskStatus', () => {
    test('updates status', async () => {
      col.findOneAndUpdate = jest.fn().mockResolvedValue({ value: { _id: FAKE_ID } });
      const r = await repo.updateKioskStatus(FAKE_ID, true);
      expect(r.status).toBe(true);
    });
    test('returns error when invalid id', async () => {
      ObjectId.isValid.mockReturnValueOnce(false);
      const r = await repo.updateKioskStatus('bad', true);
      expect(r.status).toBe(false);
    });
    test('returns error on exception', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      const r = await repo.updateKioskStatus(FAKE_ID, true);
      expect(r.status).toBe(false);
    });
  });

  describe('getItemsByCategoryId', () => {
    test('returns items by category', async () => {
      col.find.mockReturnValue(mkChain([{ name: 'A' }]));
      const r = await repo.getItemsByCategoryId(FAKE_ID, { branchId: FAKE_BRANCH });
      expect(r.status).toBe(true);
    });
    test('returns error when missing categoryId', async () => {
      const r = await repo.getItemsByCategoryId('');
      expect(r.status).toBe(false);
    });
    test('returns error on exception', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      const r = await repo.getItemsByCategoryId(FAKE_ID);
      expect(r.status).toBe(false);
    });
  });

  describe('itemSearchPage', () => {
    test('returns search results', async () => {
      col.find.mockReturnValue(mkChain([{ name: 'A' }]));
      col.countDocuments.mockResolvedValue(1);
      const r = await repo.itemSearchPage(
        { search: 'a' },
        { branchId: FAKE_BRANCH, licenseId: FAKE_LICENSE }
      );
      expect(r.status).toBe(true);
    });
    test('returns success even without branch', async () => {
      col.find.mockReturnValue(mkChain([]));
      col.countDocuments.mockResolvedValue(0);
      const r = await repo.itemSearchPage({}, {});
      expect(r.status).toBe(true);
    });
    test('returns error on exception', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      const r = await repo.itemSearchPage({}, { branchId: FAKE_BRANCH });
      expect(r.status).toBe(false);
    });
  });

  describe('accessQr', () => {
    test('returns qr data', async () => {
      col.findOne.mockResolvedValue({ _id: FAKE_ID, name: 'A' });
      const r = await repo.accessQr({ projectType: 'store', branch: FAKE_BRANCH });
      expect(r.status).toBe(true);
    });
    test('returns error without branch', async () => {
      const r = await repo.accessQr({});
      expect(r.status).toBe(false);
    });
    test('returns error on exception', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      const r = await repo.accessQr({ projectType: 'store', branch: FAKE_BRANCH });
      expect(r.status).toBe(false);
    });
  });

  describe('accessMobileApp', () => {
    test('returns mobile app data', async () => {
      col.find.mockReturnValue(mkChain([{ name: 'A' }]));
      const r = await repo.accessMobileApp(FAKE_BRANCH);
      expect(r.status).toBe(true);
    });
    test('returns error on exception', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      const r = await repo.accessMobileApp(FAKE_BRANCH);
      expect(r.status).toBe(false);
    });
  });

  describe('updateItemQuantity', () => {
    test('updates quantity', async () => {
      const r = await repo.updateItemQuantity(FAKE_ID, 10);
      expect(r.status).toBe(true);
    });
    test('returns true even with invalid id', async () => {
      ObjectId.isValid.mockReturnValueOnce(false);
      const r = await repo.updateItemQuantity('bad', 10);
      expect(r.status).toBe(true);
    });
    test('rethrows error on exception', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repo.updateItemQuantity(FAKE_ID, 10)).rejects.toThrow('fail');
    });
  });

  describe('categoryProductDetails', () => {
    test('returns category products', async () => {
      col.find.mockReturnValue(mkChain([{ name: 'A' }]));
      const r = await repo.categoryProductDetails(
        { category_id: FAKE_ID },
        { branchId: FAKE_BRANCH }
      );
      expect(r.status).toBe(true);
    });
    test('returns success even without category_id', async () => {
      col.find.mockReturnValue(mkChain([]));
      col.countDocuments.mockResolvedValue(0);
      col.aggregate.mockReturnValue(mkAgg([]));
      const r = await repo.categoryProductDetails({}, {});
      expect(r.status).toBe(true);
    });
    test('returns error on exception', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      const r = await repo.categoryProductDetails(
        { category_id: FAKE_ID },
        { branchId: FAKE_BRANCH }
      );
      expect(r.status).toBe(false);
    });
  });

  describe('supplierProductDetails', () => {
    test('returns supplier products', async () => {
      col.find.mockReturnValue(mkChain([{ name: 'A' }]));
      const r = await repo.supplierProductDetails(
        { supplier_id: FAKE_ID },
        { branchId: FAKE_BRANCH }
      );
      expect(r.status).toBe(true);
    });
    test('returns success even without supplier_id', async () => {
      col.find.mockReturnValue(mkChain([]));
      col.countDocuments.mockResolvedValue(0);
      col.aggregate.mockReturnValue(mkAgg([]));
      const r = await repo.supplierProductDetails({}, {});
      expect(r.status).toBe(true);
    });
    test('returns error on exception', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      const r = await repo.supplierProductDetails(
        { supplier_id: FAKE_ID },
        { branchId: FAKE_BRANCH }
      );
      expect(r.status).toBe(false);
    });
  });

  describe('getCustomerSearchItems', () => {
    test('returns customer items', async () => {
      col.find.mockReturnValue(mkChain([{ name: 'A' }]));
      const r = await repo.getCustomerSearchItems('pen', { branchId: FAKE_BRANCH });
      expect(r.status).toBe(true);
    });
    test('returns success even without branch', async () => {
      col.find.mockReturnValue(mkChain([]));
      const r = await repo.getCustomerSearchItems('pen', {});
      expect(r.status).toBe(true);
    });
    test('returns error on exception', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      const r = await repo.getCustomerSearchItems('pen', { branchId: FAKE_BRANCH });
      expect(r.status).toBe(false);
    });
  });

  describe('itemStockReportTable', () => {
    test('returns stock report', async () => {
      col.aggregate.mockReturnValue(mkAgg([{ _id: FAKE_ID, total: 1 }]));
      const r = await repo.itemStockReportTable({ branchId: FAKE_BRANCH, licenseId: FAKE_LICENSE });
      expect(r.status).toBe(true);
    });
    test('returns error on exception', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      const r = await repo.itemStockReportTable({});
      expect(r.status).toBe(false);
    });
  });

  describe('getQuantityCount', () => {
    test('returns count and docs', async () => {
      col.countDocuments.mockResolvedValue(5);
      col.find.mockReturnValue(mkChain([{ name: 'A' }]));
      const r = await repo.getQuantityCount({});
      expect(r.count).toBe(5);
      expect(r.listDocs).toHaveLength(1);
    });
    test('rethrows error', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repo.getQuantityCount({})).rejects.toThrow('fail');
    });
  });

  describe('categoryItemsReportTable', () => {
    test('returns report', async () => {
      col.aggregate.mockReturnValue(
        mkAgg([
          { _id: { category_id: FAKE_ID, category_name: 'A' }, selling_price: 100, item_count: 2 },
        ])
      );
      const r = await repo.categoryItemsReportTable({
        paginatedPipeline: [{}],
        countPipeline: [{}],
      });
      expect(r.total).toBeGreaterThanOrEqual(0);
      expect(r.results).toBeDefined();
    });
    test('rethrows error', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repo.categoryItemsReportTable({})).rejects.toThrow('fail');
    });
  });

  describe('supplierItemsReportTable', () => {
    test('returns report', async () => {
      col.aggregate.mockReturnValue(
        mkAgg([
          { _id: { supplier_id: FAKE_ID, supplier_name: 'S' }, selling_price: 100, item_count: 2 },
        ])
      );
      const r = await repo.supplierItemsReportTable({ pipeline: [{}], countPipeline: [{}] });
      expect(r.total).toBeGreaterThanOrEqual(0);
      expect(r.results).toBeDefined();
    });
    test('rethrows error', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repo.supplierItemsReportTable({})).rejects.toThrow('fail');
    });
  });

  describe('itemReportTable', () => {
    test('returns items and total', async () => {
      col.find.mockReturnValue(mkChain([{ name: 'A' }]));
      col.countDocuments.mockResolvedValue(1);
      const r = await repo.itemReportTable({});
      expect(r.items).toHaveLength(1);
      expect(r.total).toBe(1);
    });
    test('rethrows error', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repo.itemReportTable({})).rejects.toThrow('fail');
    });
  });

  describe('importItems', () => {
    test('imports items', async () => {
      const item = {
        name: 'A',
        itemid: 'SKU1',
        barcode_id: 'B1',
        supplier_name: 'S',
        category_name: 'C',
        discount_amount: 0,
        discount_percentage: 0,
        tax: 0,
        tax_type: 'inclusive',
        mrp_price: 10,
        company_price: 5,
        selling_price: 8,
        available_quantity: 100,
        unit: 'qty',
        sort_order: 0,
      };
      col.findOne.mockResolvedValueOnce(null);
      const r = await repo.importItems([item], { branchId: FAKE_BRANCH, licenseId: FAKE_LICENSE });
      expect(r.status).toBe(true);
    });
    test('a matched item is updated, never re-inserted, and its image is preserved', async () => {
      const item = {
        name: 'A',
        itemid: 'SKU1',
        barcode_id: 'B1',
        supplier_name: 'S',
        category_name: 'C',
        discount_amount: 0,
        discount_percentage: 0,
        tax: 0,
        tax_type: 'inclusive',
        mrp_price: 10,
        company_price: 5,
        selling_price: 12, // changed price on re-import
        available_quantity: 100,
        unit: 'qty',
        sort_order: 0,
      };
      // The FIRST findOne is the existence check and finds a match; the later
      // supplier/category/tax/unit lookups fall through to the null default.
      col.findOne.mockResolvedValueOnce({
        _id: FAKE_ID,
        name: 'A',
        itemid: 'SKU1',
        image: 'kept.jpg',
      });
      const r = await repo.importItems([item], { branchId: FAKE_BRANCH, licenseId: FAKE_LICENSE });
      expect(r.status).toBe(true);
      // Updated in place, not inserted as a duplicate.
      expect(col.updateOne).toHaveBeenCalled();
      const [, update] = col.updateOne.mock.calls[col.updateOne.mock.calls.length - 1];
      // The new price is written...
      expect(update.$set.selling_price).toBe(12);
      // ...but image and multi_image are never touched.
      expect(update.$set).not.toHaveProperty('image');
      expect(update.$set).not.toHaveProperty('multi_image');
      // ...and the insert-time behaviour defaults are not reset.
      expect(update.$set).not.toHaveProperty('track_inventory');
      expect(update.$set).not.toHaveProperty('item_status');
    });
    test('returns error when no data', async () => {
      const r = await repo.importItems([]);
      expect(r.status).toBe(false);
    });
    test('returns error on exception', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      const r = await repo.importItems([{ name: 'A' }], { branchId: FAKE_BRANCH });
      expect(r.status).toBe(false);
    });
  });

  describe('exportItems', () => {
    test('exports items', async () => {
      col.find.mockReturnValue(mkChain([{ name: 'A' }]));
      const r = await repo.exportItems([FAKE_ID], {
        branchId: FAKE_BRANCH,
        licenseId: FAKE_LICENSE,
      });
      expect(r.status).toBe(true);
    });
    test('returns error when no ids', async () => {
      const r = await repo.exportItems([]);
      expect(r.status).toBe(false);
    });
    test('returns error on exception', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      const r = await repo.exportItems([FAKE_ID]);
      expect(r.status).toBe(false);
    });

    test('select-all exports every matching item, branch/licence scoped, not an id list', async () => {
      col.find.mockReturnValue(mkChain([{ name: 'A' }, { name: 'B' }]));
      const r = await repo.exportItems(
        { all: true, filters: { name: { $regex: 'a', $options: 'i' } } },
        { branchId: FAKE_BRANCH, licenseId: FAKE_LICENSE }
      );
      expect(r.status).toBe(true);
      expect(r.data).toHaveLength(2);

      const usedFilter = col.find.mock.calls[col.find.mock.calls.length - 1][0];
      // Not restricted to a set of ids - it must reach the whole matching set.
      expect(usedFilter._id).toBeUndefined();
      // Same scope the item list forces, so the export matches the list.
      expect(usedFilter['branch_access.branch_id']).toBeDefined();
      expect(usedFilter.license).toBeDefined();
      // The active list filter is carried through.
      expect(usedFilter.name).toBeDefined();
    });
  });

  describe('logItemChanges', () => {
    const withDb = () => {
      const inserted = [];
      const db = {
        collection: () => ({
          insertMany: (rows) => {
            inserted.push(...rows);
            return Promise.resolve({ insertedIds: rows.map((_, i) => i) });
          },
        }),
      };
      BaseModel.getDb = jest.fn().mockResolvedValue(db);
      return inserted;
    };

    test('records only the fields that changed, tagged with label and value_type', async () => {
      const inserted = withDb();
      const n = await repo.logItemChanges(
        { _id: FAKE_ID, name: 'Pen', branch_id: FAKE_BRANCH },
        { name: 'Pen', selling_price: 10, category_name: 'Stationery' },
        { name: 'Pencil', selling_price: 12, category_name: 'Stationery' },
        { userName: 'admin' },
        'Edit'
      );

      // name and selling_price moved; category did not.
      expect(n).toBe(2);
      expect(inserted.map((r) => r.field).sort()).toEqual(['name', 'selling_price']);
      expect(inserted.find((r) => r.field === 'category_name')).toBeUndefined();

      const name = inserted.find((r) => r.field === 'name');
      expect(name.value_type).toBe('text');
      expect(name.old_value).toBe('Pen');
      expect(name.new_value).toBe('Pencil');
      expect(name.process).toBe('Edit');

      const price = inserted.find((r) => r.field === 'selling_price');
      expect(price.value_type).toBe('money');
      expect(price.new_value).toBe(12);
    });

    test('writes nothing when no tracked field changed', async () => {
      const inserted = withDb();
      const n = await repo.logItemChanges(
        { _id: FAKE_ID, name: 'Pen' },
        { name: 'Pen', selling_price: 10 },
        { name: 'Pen', selling_price: 10 },
        {},
        'Edit'
      );
      expect(n).toBe(0);
      expect(inserted).toHaveLength(0);
    });

    test('a field only present in the new doc is not a change on its own', async () => {
      const inserted = withDb();
      // oldDoc lacks unit entirely; newDoc sets it - that is a real change.
      // But a field absent from newDoc must never be logged.
      const n = await repo.logItemChanges(
        { _id: FAKE_ID, name: 'Pen' },
        { name: 'Pen', unit: 'qty' },
        { name: 'Pen', selling_price: 8 },
        {},
        'Edit'
      );
      // Only selling_price is being set and it changed from absent(0)->8.
      expect(inserted.map((r) => r.field)).toEqual(['selling_price']);
      expect(n).toBe(1);
    });
  });

  describe('getDataChanges', () => {
    test('delegates to BaseModel', async () => {
      await repo.getDataChanges('items', '2026-01-01');
      expect(BaseModel.getAllDataChanges).toHaveBeenCalledWith(
        'items',
        'items',
        '2026-01-01',
        expect.any(Object)
      );
    });
  });

  describe('getCategoryItemsReport', () => {
    test('returns report', async () => {
      col.aggregate.mockReturnValue(
        mkAgg([
          { _id: { category_id: FAKE_ID, category_name: 'A' }, selling_price: 100, item_count: 2 },
        ])
      );
      const r = await repo.getCategoryItemsReport({
        branchIds: [FAKE_BRANCH],
        startingDate: '2026-01-01',
        endingDate: '2026-12-31',
        page: 1,
        limit: 5,
      });
      expect(r.status).toBe(true);
    });
    test('returns error on exception', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      const r = await repo.getCategoryItemsReport({ branchIds: [FAKE_BRANCH] });
      expect(r.status).toBe(false);
    });
  });

  describe('updateStock', () => {
    test('updates stock', async () => {
      const r = await repo.updateStock(FAKE_ID, 5);
      expect(r.modifiedCount).toBe(1);
    });
    test('rethrows error', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repo.updateStock(FAKE_ID, 5)).rejects.toThrow('fail');
    });
  });

  describe('updateQuantity', () => {
    test('updates quantity', async () => {
      const r = await repo.updateQuantity(FAKE_ID, -2);
      expect(r.modifiedCount).toBe(1);
    });
    test('rethrows error', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repo.updateQuantity(FAKE_ID, -2)).rejects.toThrow('fail');
    });
  });

  describe('findItemById', () => {
    test('calls findOne via BaseModel', async () => {
      col.findOne.mockResolvedValue({ _id: FAKE_ID });
      const r = await repo.findItemById(FAKE_ID);
      expect(col.findOne).toHaveBeenCalled();
      expect(r).toEqual({ _id: FAKE_ID });
    });
    test('rethrows error', async () => {
      repo.getCollection.mockRejectedValueOnce(new Error('fail'));
      await expect(repo.findItemById(FAKE_ID)).rejects.toThrow('fail');
    });
  });
});
