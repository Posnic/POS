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
  ERROR_MESSAGES: {
    ITEM_NOT_FOUND: 'Not found',
    BRANCH_LICENSE_REQUIRED: 'Required',
    BARCODE_EXISTS: 'Barcode exists',
  },
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
        .mockResolvedValueOnce(null) // identity duplicate check
        .mockResolvedValueOnce(null) // barcode uniqueness check
        .mockResolvedValueOnce({ track_inventory: true, available_quantity: 50, name: 'Pen' });
      const r = await repo.upsertItem(data, FAKE_ID, ctx);
      expect(r.status).toBe(true);
      expect(r.message).toBe('Updated');
    });

    /*
     * IC0: barcode uniqueness per branch. Two items answering one scan
     * corrupts scan-to-sell, so the primary barcode and the V3 alternates
     * are checked on both sides. Blank barcodes stay exempt.
     */
    test('create rejects a barcode another item already answers', async () => {
      col.findOne
        .mockResolvedValueOnce(null) // identity check passes
        .mockResolvedValueOnce({ _id: { toString: () => 'other-item' } }); // barcode clash
      const r = await repo.upsertItem(data, '', ctx);
      expect(r.status).toBe('exist');
      expect(r.message).toBe('Barcode exists');
      expect(col.insertOne).not.toHaveBeenCalled();
      const filter = col.findOne.mock.calls[1][0];
      expect(filter.$or).toEqual([
        { barcode_id: { $in: ['B001'] } },
        { barcodes: { $in: ['B001'] } },
      ]);
    });

    test('alternate barcodes are checked alongside the primary', async () => {
      col.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ _id: { toString: () => 'other-item' } });
      const r = await repo.upsertItem({ ...data, barcodes: [' ALT-1 ', ''] }, '', ctx);
      expect(r.status).toBe('exist');
      const filter = col.findOne.mock.calls[1][0];
      expect(filter.$or[0].barcode_id.$in).toEqual(['B001', 'ALT-1']);
    });

    test('an item may keep its own barcode on update (self-match allowed)', async () => {
      col.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ _id: { toString: () => FAKE_ID } }) // the clash is itself
        .mockResolvedValueOnce({ track_inventory: false, name: 'Pen' });
      const r = await repo.upsertItem(data, FAKE_ID, ctx);
      expect(r.status).toBe(true);
    });

    test('open_price is presence-gated: sent -> stored boolean, absent -> untouched', async () => {
      await repo.upsertItem({ ...data, open_price: 'true' }, '', ctx);
      expect(col.insertOne.mock.calls[0][0].open_price).toBe(true);

      col.insertOne.mockClear();
      col.findOne.mockResolvedValue(null);
      await repo.upsertItem(data, '', ctx); // no open_price key at all
      expect('open_price' in col.insertOne.mock.calls[0][0]).toBe(false);
    });

    test('blank barcodes skip the uniqueness query entirely', async () => {
      const noBarcode = { ...data, barcode_id: '' };
      await repo.upsertItem(noBarcode, '', ctx);
      // No findOne carried the barcode $or filter (the other calls are the
      // identity check and the branch lookup - one shared mock collection).
      const barcodeQueries = col.findOne.mock.calls.filter(([f]) => f && f.$or);
      expect(barcodeQueries).toHaveLength(0);
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

  describe('getItemsBySupplier', () => {
    const ctx = { branchId: FAKE_BRANCH, licenseId: FAKE_LICENSE };

    test('lists a supplier`s items in the receiving-autocomplete row shape', async () => {
      col.find.mockReturnValue(
        mkChain([{ _id: FAKE_ID, name: 'Oil 1L', itemid: '7', available_quantity: 3 }])
      );
      const r = await repo.getItemsBySupplier({ supplierId: FAKE_ID }, ctx);
      expect(r.status).toBe(true);
      expect(r.data[0]).toMatchObject({
        item_id: FAKE_ID,
        item_name: 'Oil 1L',
        item_code: '7',
        available_quantity: 3,
      });
      const filter = col.find.mock.calls[0][0];
      const flat = Object.assign({}, ...filter.$and);
      expect(String(flat.supplier_id)).toBe(FAKE_ID);
      expect('available_quantity' in flat).toBe(false); // no low-stock cut
    });

    test('low_stock narrows to tracked items at/below the range', async () => {
      col.find.mockReturnValue(mkChain([]));
      await repo.getItemsBySupplier(
        { supplierId: FAKE_ID, lowStockOnly: true, notificationRange: '5' },
        ctx
      );
      const flat = Object.assign({}, ...col.find.mock.calls[0][0].$and);
      expect(flat.track_inventory).toBe(true);
      expect(flat.available_quantity).toEqual({ $lte: 5 });
    });

    test('a missing or invalid supplier id is refused, not an unscoped query', async () => {
      const ObjectIdMock = require('mongodb').ObjectId;
      ObjectIdMock.isValid.mockReturnValueOnce(false);
      const r = await repo.getItemsBySupplier({ supplierId: 'nope' }, ctx);
      expect(r.status).toBe(false);
      expect(col.find).not.toHaveBeenCalled();
    });
  });

  describe('stockAdjustment', () => {
    const ctx = { branchId: FAKE_BRANCH, licenseId: FAKE_LICENSE, userId: 'u1', userName: 'admin' };
    const tracked = {
      _id: FAKE_ID,
      name: 'Oil 1L',
      barcode_id: 'B1',
      available_quantity: 10,
      track_inventory: true,
    };

    test('Inventory count SETS stock to what was counted', async () => {
      col.findOne.mockResolvedValue(tracked);
      const r = await repo.stockAdjustment(
        { reason: 'Inventory count', rows: [{ item_id: FAKE_ID, qty: 7 }] },
        ctx
      );
      expect(r.status).toBe(true);
      expect(r.data.updated).toBe(1);
      expect(col.updateOne.mock.calls[0][1].$set.available_quantity).toBe(7);
    });

    test('Loss SUBTRACTS and clamps at zero', async () => {
      col.findOne.mockResolvedValue(tracked);
      await repo.stockAdjustment({ reason: 'Loss', rows: [{ item_id: FAKE_ID, qty: 99 }] }, ctx);
      expect(col.updateOne.mock.calls[0][1].$set.available_quantity).toBe(0);
    });

    test('an unknown reason is refused before any write', async () => {
      const r = await repo.stockAdjustment(
        { reason: 'Shrinkage', rows: [{ item_id: FAKE_ID, qty: 1 }] },
        ctx
      );
      expect(r.status).toBe(false);
      expect(col.updateOne).not.toHaveBeenCalled();
    });

    test('items outside the branch/license are skipped, never written', async () => {
      col.findOne.mockResolvedValue(null); // scoped fetch finds nothing
      const r = await repo.stockAdjustment(
        { reason: 'Damage', rows: [{ item_id: FAKE_ID, qty: 1 }] },
        ctx
      );
      expect(r.status).toBe(true);
      expect(r.data.updated).toBe(0);
      expect(r.data.skipped).toBe(1);
      expect(col.updateOne).not.toHaveBeenCalled();
      // calls[0] is the branch-doc lookup (one shared mock collection);
      // calls[1] is the scoped item fetch under test.
      const filter = col.findOne.mock.calls[1][0];
      expect(String(filter['branch_access.branch_id'])).toBe(FAKE_BRANCH);
    });

    test('a no-op count (stock already matches) is skipped without a log', async () => {
      col.findOne.mockResolvedValue(tracked);
      const r = await repo.stockAdjustment(
        { reason: 'Inventory count', rows: [{ item_id: FAKE_ID, qty: 10 }] },
        ctx
      );
      expect(r.data.updated).toBe(0);
      expect(col.updateOne).not.toHaveBeenCalled();
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

  describe('bulkUpdatePrices', () => {
    const ctx = { branchId: FAKE_BRANCH, userName: 'admin', userId: 'u1' };
    const withDb = () => {
      const db = {
        collection: () => ({
          insertMany: () => Promise.resolve({}),
          insertOne: () => Promise.resolve({}), // bulk_price_updates batch record
        }),
      };
      BaseModel.getDb = jest.fn().mockResolvedValue(db);
    };

    test('rejects an unknown field, a negative amount, or a bad operation', async () => {
      expect((await repo.bulkUpdatePrices({ field: 'nope', op: 'percent', value: 5 })).status).toBe(
        false
      );
      expect(
        (await repo.bulkUpdatePrices({ field: 'selling_price', op: 'percent', value: -1 })).status
      ).toBe(false);
      expect(
        (await repo.bulkUpdatePrices({ field: 'selling_price', op: 'bad', value: 5 })).status
      ).toBe(false);
    });

    test('increases selling price by percent, only where it actually changes', async () => {
      withDb();
      col.find.mockReturnValue(
        mkChain([
          { _id: FAKE_ID, name: 'A', selling_price: 100, mrp_price: 200, company_price: 50 },
          { _id: 'zero', name: 'B', selling_price: 0, mrp_price: 0, company_price: 0 },
        ])
      );
      const r = await repo.bulkUpdatePrices(
        { scope: 'all', field: 'selling_price', op: 'percent', value: 10, direction: 'increase' },
        ctx
      );
      expect(r.status).toBe(true);
      expect(r.data.total).toBe(2);
      expect(r.data.updated).toBe(1); // only A (100 -> 110); B stays 0
      expect(col.updateOne).toHaveBeenCalledTimes(1);
      expect(col.updateOne.mock.calls[0][1].$set.selling_price).toBe(110);
    });

    test('a decrease never takes a price below zero', async () => {
      withDb();
      col.find.mockReturnValue(
        mkChain([{ _id: FAKE_ID, name: 'A', selling_price: 5, mrp_price: 100, company_price: 0 }])
      );
      await repo.bulkUpdatePrices(
        { scope: 'all', field: 'selling_price', op: 'amount', value: 20, direction: 'decrease' },
        ctx
      );
      expect(col.updateOne.mock.calls[0][1].$set.selling_price).toBe(0); // 5 - 20 clamped
    });

    test('skipViolations leaves items that would exceed MRP or fall below cost', async () => {
      withDb();
      col.find.mockReturnValue(
        mkChain([
          // +10% -> 110, over its 105 MRP: skipped
          { _id: '1', name: 'overMrp', selling_price: 100, mrp_price: 105, company_price: 10 },
          // +10% -> 110, under its 200 MRP: updated
          { _id: '2', name: 'ok', selling_price: 100, mrp_price: 200, company_price: 10 },
        ])
      );
      const r = await repo.bulkUpdatePrices(
        {
          scope: 'all',
          field: 'selling_price',
          op: 'percent',
          value: 10,
          direction: 'increase',
          skipViolations: true,
        },
        ctx
      );
      expect(r.data.updated).toBe(1);
      expect(r.data.skipped).toBe(1);
      expect(col.updateOne).toHaveBeenCalledTimes(1);
    });

    test('writes a batch audit record (who/what/how many) and returns its id', async () => {
      const batchInsert = jest.fn().mockResolvedValue({});
      BaseModel.getDb = jest.fn().mockResolvedValue({
        collection: (name) => ({
          insertMany: () => Promise.resolve({}),
          insertOne: name === 'bulk_price_updates' ? batchInsert : () => Promise.resolve({}),
        }),
      });
      col.find.mockReturnValue(
        mkChain([
          { _id: FAKE_ID, name: 'A', selling_price: 100, mrp_price: 200, company_price: 10 },
        ])
      );
      const r = await repo.bulkUpdatePrices(
        { scope: 'all', field: 'selling_price', op: 'percent', value: 10, direction: 'increase' },
        ctx
      );
      expect(r.data.updated).toBe(1);
      expect(r.data.batch_id).toBeDefined();
      expect(batchInsert).toHaveBeenCalledTimes(1);
      const rec = batchInsert.mock.calls[0][0];
      expect(rec.items_changed).toBe(1);
      expect(rec.field).toBe('selling_price');
      expect(rec.direction).toBe('increase');
      expect(rec.changed_by).toBe('admin');
    });

    test('writes no batch record when nothing actually changes', async () => {
      const batchInsert = jest.fn().mockResolvedValue({});
      BaseModel.getDb = jest.fn().mockResolvedValue({
        collection: (name) => ({
          insertMany: () => Promise.resolve({}),
          insertOne: name === 'bulk_price_updates' ? batchInsert : () => Promise.resolve({}),
        }),
      });
      col.find.mockReturnValue(
        mkChain([{ _id: 'z', name: 'Z', selling_price: 0, mrp_price: 0, company_price: 0 }])
      );
      const r = await repo.bulkUpdatePrices(
        { scope: 'all', field: 'selling_price', op: 'percent', value: 10, direction: 'increase' },
        ctx
      );
      expect(r.data.updated).toBe(0);
      expect(batchInsert).not.toHaveBeenCalled();
    });

    test('getBulkPriceUpdates lists runs newest first with a total', async () => {
      const runs = [{ _id: 'b1', items_changed: 3, field: 'selling_price' }];
      const chain = {
        find: () => chain,
        sort: () => chain,
        skip: () => chain,
        limit: () => chain,
        toArray: () => Promise.resolve(runs),
        countDocuments: () => Promise.resolve(7),
      };
      BaseModel.getDb = jest.fn().mockResolvedValue({ collection: () => chain });
      const r = await repo.getBulkPriceUpdates({ limit: 20, skip: 0 });
      expect(r.status).toBe(true);
      expect(r.data).toEqual(runs);
      expect(r.total).toBe(7);
    });
  });

  describe('bulkUpdateStock', () => {
    const ctx = { branchId: FAKE_BRANCH, userName: 'admin', userId: 'u1' };
    const withDb = (batchInsert) => {
      BaseModel.getDb = jest.fn().mockResolvedValue({
        collection: (name) => ({
          insertMany: () => Promise.resolve({}),
          insertOne:
            name === 'bulk_stock_updates' && batchInsert ? batchInsert : () => Promise.resolve({}),
        }),
      });
    };

    test('rejects a negative quantity or a bad operation', async () => {
      expect((await repo.bulkUpdateStock({ op: 'amount', value: -1 })).status).toBe(false);
      expect((await repo.bulkUpdateStock({ op: 'bad', value: 5 })).status).toBe(false);
    });

    test('adds stock by a flat quantity, only where it actually changes', async () => {
      withDb();
      col.find.mockReturnValue(
        mkChain([
          { _id: FAKE_ID, name: 'A', available_quantity: 10, track_inventory: true },
          { _id: 'z', name: 'B', available_quantity: 7, track_inventory: false },
        ])
      );
      const r = await repo.bulkUpdateStock(
        { scope: 'all', op: 'amount', value: 5, direction: 'increase' },
        ctx
      );
      expect(r.status).toBe(true);
      expect(r.data.total).toBe(2);
      expect(r.data.updated).toBe(2); // A 10->15, B 7->12
      expect(col.updateOne).toHaveBeenCalledTimes(2);
      expect(col.updateOne.mock.calls[0][1].$set.available_quantity).toBe(15);
    });

    test('a decrease never takes stock below zero', async () => {
      withDb();
      col.find.mockReturnValue(
        mkChain([{ _id: FAKE_ID, name: 'A', available_quantity: 3, track_inventory: true }])
      );
      await repo.bulkUpdateStock(
        { scope: 'all', op: 'amount', value: 20, direction: 'decrease' },
        ctx
      );
      expect(col.updateOne.mock.calls[0][1].$set.available_quantity).toBe(0);
    });

    test('writes a batch audit record carrying the note, and returns its id', async () => {
      const batchInsert = jest.fn().mockResolvedValue({});
      withDb(batchInsert);
      col.find.mockReturnValue(
        mkChain([{ _id: FAKE_ID, name: 'A', available_quantity: 10, track_inventory: true }])
      );
      const r = await repo.bulkUpdateStock(
        { scope: 'all', op: 'amount', value: 5, direction: 'increase', note: 'new delivery' },
        ctx
      );
      expect(r.data.updated).toBe(1);
      expect(r.data.batch_id).toBeDefined();
      expect(batchInsert).toHaveBeenCalledTimes(1);
      const rec = batchInsert.mock.calls[0][0];
      expect(rec.items_changed).toBe(1);
      expect(rec.direction).toBe('increase');
      expect(rec.changed_by).toBe('admin');
      expect(rec.note).toBe('new delivery');
    });

    test('writes no batch record when nothing actually changes', async () => {
      const batchInsert = jest.fn().mockResolvedValue({});
      withDb(batchInsert);
      col.find.mockReturnValue(
        mkChain([{ _id: 'z', name: 'Z', available_quantity: 0, track_inventory: true }])
      );
      const r = await repo.bulkUpdateStock(
        { scope: 'all', op: 'amount', value: 0, direction: 'increase' },
        ctx
      );
      expect(r.data.updated).toBe(0);
      expect(batchInsert).not.toHaveBeenCalled();
    });

    test('previewBulkUpdateStock counts how many would change without writing', async () => {
      col.find.mockReturnValue(
        mkChain([
          { _id: '1', name: 'A', available_quantity: 10 },
          { _id: '2', name: 'B', available_quantity: 4 },
        ])
      );
      const r = await repo.previewBulkUpdateStock(
        { scope: 'all', op: 'amount', value: 5, direction: 'increase' },
        ctx
      );
      expect(r.status).toBe(true);
      expect(r.data.total).toBe(2);
      expect(r.data.willChange).toBe(2);
      expect(col.updateOne).not.toHaveBeenCalled();
    });

    test('getBulkStockUpdates lists runs newest first with a total', async () => {
      const runs = [{ _id: 'b1', items_changed: 3, note: 'delivery' }];
      const chain = {
        find: () => chain,
        sort: () => chain,
        skip: () => chain,
        limit: () => chain,
        toArray: () => Promise.resolve(runs),
        countDocuments: () => Promise.resolve(4),
      };
      BaseModel.getDb = jest.fn().mockResolvedValue({ collection: () => chain });
      const r = await repo.getBulkStockUpdates({ limit: 20, skip: 0 });
      expect(r.status).toBe(true);
      expect(r.data).toEqual(runs);
      expect(r.total).toBe(4);
    });
  });

  describe('bulkSetMargin', () => {
    const ctx = { branchId: FAKE_BRANCH, userName: 'admin', userId: 'u1' };
    const withDb = () => {
      BaseModel.getDb = jest.fn().mockResolvedValue({
        collection: () => ({
          insertMany: () => Promise.resolve({}),
          insertOne: () => Promise.resolve({}),
        }),
      });
    };

    test('margin mode sets selling = cost / (1 - margin)', async () => {
      withDb();
      col.find.mockReturnValue(
        mkChain([{ _id: FAKE_ID, name: 'A', company_price: 60, selling_price: 0, mrp_price: 200 }])
      );
      const r = await repo.bulkSetMargin({ scope: 'all', margin: 40, mode: 'margin' }, ctx);
      expect(r.data.updated).toBe(1);
      expect(col.updateOne.mock.calls[0][1].$set.selling_price).toBe(100); // 60 / 0.6
    });

    test('markup mode sets selling = cost * (1 + margin)', async () => {
      withDb();
      col.find.mockReturnValue(
        mkChain([{ _id: FAKE_ID, name: 'A', company_price: 40, selling_price: 0, mrp_price: 200 }])
      );
      const r = await repo.bulkSetMargin({ scope: 'all', margin: 40, mode: 'markup' }, ctx);
      expect(r.data.updated).toBe(1);
      expect(col.updateOne.mock.calls[0][1].$set.selling_price).toBe(56); // 40 * 1.4
    });

    test('items with no cost are left alone and counted', async () => {
      withDb();
      col.find.mockReturnValue(
        mkChain([{ _id: 'z', name: 'Z', company_price: 0, selling_price: 10, mrp_price: 100 }])
      );
      const r = await repo.bulkSetMargin({ scope: 'all', margin: 40, mode: 'margin' }, ctx);
      expect(r.data.updated).toBe(0);
      expect(r.data.noCost).toBe(1);
      expect(col.updateOne).not.toHaveBeenCalled();
    });

    test('skipViolations skips items whose margin price would exceed MRP', async () => {
      withDb();
      col.find.mockReturnValue(
        mkChain([
          { _id: '1', name: 'overMrp', company_price: 90, selling_price: 0, mrp_price: 100 }, // 150 > 100
          { _id: '2', name: 'ok', company_price: 60, selling_price: 0, mrp_price: 200 }, // 100 <= 200
        ])
      );
      const r = await repo.bulkSetMargin(
        { scope: 'all', margin: 40, mode: 'margin', skipViolations: true },
        ctx
      );
      expect(r.data.updated).toBe(1);
      expect(r.data.skipped).toBe(1);
    });

    test('rejects a margin of 100% or more in margin mode', async () => {
      const r = await repo.bulkSetMargin({ scope: 'all', margin: 100, mode: 'margin' }, ctx);
      expect(r.status).toBe(false);
    });
  });

  describe('previewBulkUpdatePrices', () => {
    test('flags items an increase would push over MRP, without writing', async () => {
      col.find.mockReturnValue(
        mkChain([
          { name: 'a', selling_price: 100, mrp_price: 105, company_price: 10 }, // -> 110 > 105
          { name: 'b', selling_price: 100, mrp_price: 200, company_price: 10 }, // -> 110 ok
        ])
      );
      const r = await repo.previewBulkUpdatePrices(
        { scope: 'all', field: 'selling_price', op: 'percent', value: 10, direction: 'increase' },
        {}
      );
      expect(r.status).toBe(true);
      expect(r.data.willChange).toBe(2);
      expect(r.data.exceedsMrpCount).toBe(1);
      expect(r.data.exceedsMrp[0].name).toBe('a');
      expect(r.data.belowCostCount).toBe(0);
      expect(col.updateOne).not.toHaveBeenCalled(); // dry run
    });

    test('flags items a decrease would drop below cost', async () => {
      col.find.mockReturnValue(
        mkChain([{ name: 'c', selling_price: 100, mrp_price: 200, company_price: 95 }]) // -10% -> 90 < 95
      );
      const r = await repo.previewBulkUpdatePrices(
        { scope: 'all', field: 'selling_price', op: 'percent', value: 10, direction: 'decrease' },
        {}
      );
      expect(r.data.belowCostCount).toBe(1);
      expect(r.data.belowCost[0].name).toBe('c');
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
