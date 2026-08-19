'use strict';

/**
 * Purchase orders (PO_LIFECYCLE_DESIGN.md build step 1).
 *
 * The one rule everything else leans on, pinned here: A PURCHASE ORDER
 * NEVER TOUCHES STOCK. The repository may only ever open its own
 * collection - no items, no stocklogs, no branches. If a future edit asks
 * BaseModel for any other collection, the invariant test goes red.
 */

let mockRequestedCollections;

jest.mock('../../../src/models/base.model', () => {
  function MockBaseModel(name) {
    this.collectionName = name;
  }
  MockBaseModel.prototype.getCollection = jest.fn(async function (name) {
    mockRequestedCollections.push(name || this.collectionName);
    return global.__poMockCollection;
  });
  return MockBaseModel;
});

const PurchaseOrderRepository = require('../../../src/repositories/purchase-order.repository');

const BRANCH = '64a000000000000000000aaa';
const LICENSE = '64a00000000000000000ccc1';
const ITEM = '64f9a1c2e3b4d5e6f7000001';
const PO_ID = '64f9a1c2e3b4d5e6f7000009';

const ctx = { branchId: BRANCH, licenseId: LICENSE, userName: 'admin', userId: 'u1' };

function mkCollection() {
  return {
    find: jest.fn().mockReturnValue({
      projection: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([]),
    }),
    findOne: jest.fn().mockResolvedValue(null),
    insertOne: jest.fn().mockResolvedValue({ insertedId: PO_ID }),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    countDocuments: jest.fn().mockResolvedValue(0),
  };
}

describe('PurchaseOrderRepository', () => {
  let repo;
  let col;
  let errSpy;

  beforeEach(() => {
    mockRequestedCollections = [];
    col = mkCollection();
    global.__poMockCollection = col;
    repo = new PurchaseOrderRepository();
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => errSpy.mockRestore());

  const validOrder = {
    supplier_name: 'New Supplier',
    status: 'ordered',
    items: [{ item_id: ITEM, item_name: 'Oil', qty_ordered: 10, unit_cost: 25.5 }],
    additional_costs: [{ label: 'freight', amount: 100 }],
  };

  test('create mints a PO id, totals the lines, and NEVER touches stock', async () => {
    const r = await repo.upsertOrder(validOrder, '', ctx);
    expect(r.status).toBe(true);
    expect(r.data.po_id).toBe('PO-000001');
    const doc = col.insertOne.mock.calls[0][0];
    expect(doc.total).toBe(255);
    expect(doc.additional_total).toBe(100);
    expect(doc.grand_total).toBe(355);
    expect(doc.items[0].qty_received).toBe(0);
    expect(String(doc.branch_id)).toBe(BRANCH);
    expect(String(doc.license)).toBe(LICENSE);
    // THE invariant: only its own collection, ever.
    expect([...new Set(mockRequestedCollections)]).toEqual(['purchase_orders']);
  });

  test('a lineless order is refused', async () => {
    const r = await repo.upsertOrder({ supplier_name: 'S', items: [] }, '', ctx);
    expect(r.status).toBe(false);
    expect(col.insertOne).not.toHaveBeenCalled();
  });

  test('editing keeps received history: qty_received re-attaches by item', async () => {
    col.findOne.mockResolvedValue({
      _id: PO_ID,
      status: 'ordered',
      po_id: 'PO-000004',
      items: [{ item_id: ITEM, qty_received: 4 }],
    });
    const r = await repo.upsertOrder(validOrder, PO_ID, ctx);
    expect(r.status).toBe(true);
    const set = col.updateOne.mock.calls[0][1].$set;
    expect(set.items[0].qty_received).toBe(4);
  });

  test('a partially received order refuses edits', async () => {
    col.findOne.mockResolvedValue({ _id: PO_ID, status: 'partial', items: [] });
    const r = await repo.upsertOrder(validOrder, PO_ID, ctx);
    expect(r.status).toBe(false);
    expect(col.updateOne).not.toHaveBeenCalled();
  });

  test('transition order: only a draft can be placed', async () => {
    col.findOne.mockResolvedValue({ _id: PO_ID, status: 'ordered', items: [] });
    const r = await repo.transition(PO_ID, 'order', ctx);
    expect(r.status).toBe(false);
  });

  test('cancel_remaining: nothing received -> cancelled, something -> closed', async () => {
    col.findOne.mockResolvedValue({
      _id: PO_ID,
      status: 'partial',
      items: [{ qty_ordered: 10, qty_received: 3 }],
    });
    const r = await repo.transition(PO_ID, 'cancel_remaining', ctx);
    expect(r.data.status).toBe('closed');

    col.findOne.mockResolvedValue({
      _id: PO_ID,
      status: 'ordered',
      items: [{ qty_ordered: 10, qty_received: 0 }],
    });
    const r2 = await repo.transition(PO_ID, 'cancel_remaining', ctx);
    expect(r2.data.status).toBe('cancelled');
  });

  test('delete is draft-only, enforced in the query itself', async () => {
    col.deleteOne.mockResolvedValue({ deletedCount: 0 });
    const r = await repo.deleteOrder(PO_ID, ctx);
    expect(r.status).toBe(false);
    expect(col.deleteOne.mock.calls[0][0].status).toBe('draft');
  });

  test('every read carries the branch wall', async () => {
    await repo.getOrder(PO_ID, ctx);
    expect(String(col.findOne.mock.calls[0][0].branch_id)).toBe(BRANCH);
    expect(String(col.findOne.mock.calls[0][0].license)).toBe(LICENSE);
  });

  test('no branch context is a refusal, not an unscoped query', async () => {
    const r = await repo.listOrders({}, {});
    expect(r.status).toBe(false);
    expect(col.find).not.toHaveBeenCalled();
  });
});
