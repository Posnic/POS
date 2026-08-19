'use strict';

/**
 * Incoming stock (PO step 3): read-time arithmetic over open POs only -
 * never stored, never stock math, fail-safe to empty.
 */

let mockPoCollection;

jest.mock('../../../src/models/base.model', () => {
  function MockBaseModel() {}
  MockBaseModel.prototype.getCollection = jest.fn(async () => mockPoCollection);
  return MockBaseModel;
});

const { incomingByItem } = require('../../../src/services/incoming-stock');

const BRANCH = '64a000000000000000000aaa';
const ITEM_A = '64f9a1c2e3b4d5e6f7000001';
const ITEM_B = '64f9a1c2e3b4d5e6f7000002';

function setup(orders) {
  mockPoCollection = {
    find: jest.fn().mockReturnValue({
      projection: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue(orders),
    }),
  };
}

describe('incoming-stock', () => {
  test('sums outstanding across open orders, per item', async () => {
    setup([
      { items: [{ item_id: ITEM_A, qty_ordered: 10, qty_received: 4 }] },
      {
        items: [
          { item_id: ITEM_A, qty_ordered: 5, qty_received: 0 },
          { item_id: ITEM_B, qty_ordered: 3, qty_received: 3 },
        ],
      },
    ]);
    const r = await incomingByItem({ branchId: BRANCH });
    expect(r[ITEM_A]).toBe(11); // 6 + 5
    expect(r[ITEM_B]).toBeUndefined(); // fully received = nothing incoming
    // Only OPEN orders are ever read.
    expect(mockPoCollection.find.mock.calls[0][0].status).toEqual({
      $in: ['ordered', 'partial'],
    });
  });

  test('itemIds narrows the answer', async () => {
    setup([
      {
        items: [
          { item_id: ITEM_A, qty_ordered: 10, qty_received: 0 },
          { item_id: ITEM_B, qty_ordered: 7, qty_received: 0 },
        ],
      },
    ]);
    const r = await incomingByItem({ branchId: BRANCH }, [ITEM_B]);
    expect(r).toEqual({ [ITEM_B]: 7 });
  });

  test('no branch context answers empty, never an unscoped query', async () => {
    setup([]);
    const r = await incomingByItem({});
    expect(r).toEqual({});
    expect(mockPoCollection.find).not.toHaveBeenCalled();
  });
});
