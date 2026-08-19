'use strict';

/**
 * The PO receive bridge (PO_LIFECYCLE_DESIGN step 2): receivings are truth,
 * the PO is the mirror. The property that matters most is idempotence -
 * qty_received recomputed from scratch, so replays land on the same numbers.
 */

let mockCollections;

jest.mock('../../../src/models/base.model', () => {
  function MockBaseModel() {}
  MockBaseModel.prototype.getCollection = jest.fn(async (name) => mockCollections[name]);
  return MockBaseModel;
});

const { syncPoFromReceivings } = require('../../../src/services/po-receive-bridge');

const BRANCH = '64a000000000000000000aaa';
const PO = '64f9a1c2e3b4d5e6f7000009';
const ITEM_A = '64f9a1c2e3b4d5e6f7000001';
const ITEM_B = '64f9a1c2e3b4d5e6f7000002';

const ctx = { branchId: BRANCH };

function setup(po, receivings) {
  mockCollections = {
    purchase_orders: {
      findOne: jest.fn().mockResolvedValue(po),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    },
    receivings: {
      find: jest.fn().mockReturnValue({
        projection: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue(receivings),
      }),
    },
  };
}

const basePo = () => ({
  _id: PO,
  branch_id: BRANCH,
  status: 'ordered',
  items: [
    { item_id: ITEM_A, qty_ordered: 10, qty_received: 0 },
    { item_id: ITEM_B, qty_ordered: 5, qty_received: 0 },
  ],
});

describe('po-receive-bridge', () => {
  let errSpy;
  beforeEach(() => {
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => errSpy.mockRestore());

  test('partial receipt: quantities recomputed, status partial', async () => {
    setup(basePo(), [{ _id: 'r1', items: [{ item: ITEM_A, quantity: 4 }] }]);
    const r = await syncPoFromReceivings(PO, ctx);
    expect(r.status).toBe(true);
    expect(r.data.status).toBe('partial');
    const set = mockCollections.purchase_orders.updateOne.mock.calls[0][1].$set;
    expect(set.items[0].qty_received).toBe(4);
    expect(set.items[1].qty_received).toBe(0);
    expect(set.received_receiving_ids).toEqual(['r1']);
  });

  test('everything received closes the order', async () => {
    setup(basePo(), [
      { _id: 'r1', items: [{ item: ITEM_A, quantity: 10 }] },
      { _id: 'r2', items: [{ item: ITEM_B, quantity: 5 }] },
    ]);
    const r = await syncPoFromReceivings(PO, ctx);
    expect(r.data.status).toBe('closed');
    expect(r.data.outstanding).toBe(0);
  });

  test('idempotence: recomputed from scratch, never incremented blindly', async () => {
    // The PO already shows received history; a replay with the same
    // receivings must land on the SAME numbers, not double them.
    const po = basePo();
    po.items[0].qty_received = 4;
    po.status = 'partial';
    setup(po, [{ _id: 'r1', items: [{ item: ITEM_A, quantity: 4 }] }]);
    await syncPoFromReceivings(PO, ctx);
    const set = mockCollections.purchase_orders.updateOne.mock.calls[0][1].$set;
    expect(set.items[0].qty_received).toBe(4); // not 8
    expect(set.status).toBe('partial');
  });

  test('over-delivery records fulfilment at the plan, closes, never negative', async () => {
    setup(basePo(), [
      {
        _id: 'r1',
        items: [
          { item: ITEM_A, quantity: 25 },
          { item: ITEM_B, quantity: 9 },
        ],
      },
    ]);
    const r = await syncPoFromReceivings(PO, ctx);
    const set = mockCollections.purchase_orders.updateOne.mock.calls[0][1].$set;
    expect(set.items[0].qty_received).toBe(10);
    expect(set.items[1].qty_received).toBe(5);
    expect(r.data.status).toBe('closed');
  });

  test('terminal states stay terminal: a cancelled order re-syncs history, never reopens', async () => {
    const po = basePo();
    po.status = 'cancelled';
    setup(po, [{ _id: 'r1', items: [{ item: ITEM_A, quantity: 2 }] }]);
    const r = await syncPoFromReceivings(PO, ctx);
    const set = mockCollections.purchase_orders.updateOne.mock.calls[0][1].$set;
    expect(set.items[0].qty_received).toBe(2);
    expect(set.status).toBe('cancelled');
    expect(r.data.status).toBe('cancelled');
  });

  test('a missing PO is a quiet no-op, never a write', async () => {
    setup(null, []);
    const r = await syncPoFromReceivings(PO, ctx);
    expect(r.status).toBe(false);
    expect(mockCollections.purchase_orders.updateOne).not.toHaveBeenCalled();
  });
});
