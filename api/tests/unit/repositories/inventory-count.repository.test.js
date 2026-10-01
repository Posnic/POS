'use strict';

let mockRequested;
jest.mock('../../../src/models/base.model', () => {
  function MockBaseModel(name) {
    this.collectionName = name;
  }
  MockBaseModel.prototype.getCollection = jest.fn(async function (name) {
    mockRequested.push(name || this.collectionName);
    return global.__inventoryCountCollection;
  });
  return MockBaseModel;
});

const InventoryCountRepository = require('../../../src/repositories/inventory-count.repository');
const BRANCH = '64a000000000000000000aaa';
const LICENSE = '64a00000000000000000ccc1';
const ITEM = '64f9a1c2e3b4d5e6f7000001';

describe('InventoryCountRepository', () => {
  beforeEach(() => {
    mockRequested = [];
    global.__inventoryCountCollection = {
      insertOne: jest.fn().mockResolvedValue({ insertedId: '64f9a1c2e3b4d5e6f7000009' }),
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([]),
      }),
      findOne: jest.fn().mockResolvedValue(null),
    };
  });

  test('creates an immutable expected-quantity worksheet without changing stock', async () => {
    const repo = new InventoryCountRepository();
    const result = await repo.createDraft(
      { items: [{ item_id: ITEM, item_name: 'Tea', expected_quantity: 7, unit: 'box' }] },
      { branchId: BRANCH, licenseId: LICENSE, userName: 'Owner' }
    );
    expect(result.status).toBe(true);
    const doc = global.__inventoryCountCollection.insertOne.mock.calls[0][0];
    expect(doc.status).toBe('draft');
    expect(doc.items[0].counted_quantity).toBeNull();
    expect(doc.items[0].expected_quantity).toBe(7);
    expect([...new Set(mockRequested)]).toEqual(['inventory_counts']);
  });

  test('refuses an unscoped or empty count', async () => {
    const repo = new InventoryCountRepository();
    expect((await repo.createDraft({ items: [] }, { branchId: BRANCH })).status).toBe(false);
    expect((await repo.createDraft({ items: [{ item_id: ITEM }] }, {})).status).toBe(false);
  });
});
