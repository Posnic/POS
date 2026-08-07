'use strict';

/**
 * Unit tests for src/models/receiving-return.model.js
 *
 * File confirmed : src/models/receiving-return.model.js
 * Similar files  : receiving.model.js (Mongoose schema — entirely separate),
 *                  receiving.model.js.backup (ignored backup)
 *                  No purchase-return.model.js / return-receiving.model.js found
 * Type           : Data access helper function module (NOT a Mongoose schema)
 *                  Exports: { returnReceivingOrder }
 * ORM            : MongoDB Native Driver accessed via BaseModel
 *
 * Strategy: Mocked database tests
 *   - BaseModel fully mocked (no real DB connection, no env vars required)
 *   - BaseModel static context (license, loggedUser, currentBranch, …) set per test
 *   - getCollection() spied per test and returns named mock collection objects
 *   - All insertOne / updateOne / findOne calls are Jest mock functions
 *   - No real stock mutations, inventory updates, or supplier data touched
 *
 * Collections accessed by returnReceivingOrder:
 *   receivings  — updateOne ($set item fields, $pull item, $push items_return, $set totals)
 *                 findOne (recalculate totals after return)
 *   items       — findOne (get itemDoc: track_inventory, available_quantity)
 *                 updateOne ($set available_quantity after return)
 *   grouptax    — findOne (lookup existing tax)
 *                 insertOne + updateOne (create new tax when not found)
 *   branches    — findOne (read stock_management / stock_management_log flags)
 *   stocklogs   — insertOne (create stock movement log when conditions met)
 *
 * Key business logic tested:
 *   - Input validation (null data / missing id)
 *   - Full success path (track_inventory=true, stockManagement=true, tax found)
 *   - track_inventory flag (true/false/'true') controls inventory + stock-log
 *   - stock_management flag gates stock log creation
 *   - $set vs $pull in receivings based on remaining item_quantity
 *   - Tax: re-use existing vs create new (insertOne + $push tax_fields)
 *   - IGST path (supplier_state !== currentBranchState)
 *   - CGST/SGST path (supplier_state === currentBranchState, GST split by 2)
 *   - FullReturn / PartialReturn status based on remaining items total
 *   - Return record structure (returnId prefix, returnDate, returnValue array)
 *   - Error handling (DB throw → status:false with message)
 *   - Multiple return items processed in single call
 */

// ─── Hoist mock ───────────────────────────────────────────────────────────────
jest.mock('../../../src/models/base.model', () => {
  class MockBaseModel {
    static mongoClient = {};
    static database = {};
    static license = null;
    static loggedUser = null;
    static loggedUserName = null;
    static currentBranch = null;
    static currentBranchName = null;
    static currentBranchState = null;

    constructor(collectionName) {
      this.collectionName = collectionName;
    }

    async getCollection() {
      return null;
    } // overridden per test via spy
  }
  return MockBaseModel;
});

// ─── Imports ──────────────────────────────────────────────────────────────────
const { ObjectId } = require('mongodb');
const { returnReceivingOrder } = require('../../../src/models/receiving-return.model');
const MockBaseModel = require('../../../src/models/base.model');

// ─── Valid ObjectId strings used as fake IDs ──────────────────────────────────
const fakeBranchId = new ObjectId().toHexString();
const fakeLicenseId = new ObjectId().toHexString();
const fakeUserId = new ObjectId().toHexString();
const fakeItemId = new ObjectId().toHexString();
const fakeReceivingId = new ObjectId().toHexString();

// ══════════════════════════════════════════════════════════════════════════════
// Mock collection factories
// ══════════════════════════════════════════════════════════════════════════════
function makeReceivingsColl(findOneResult, overrides = {}) {
  return {
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    findOne: jest.fn().mockResolvedValue(
      findOneResult ?? {
        items: [{ total_amount: 100, item_quantity: 2, item_price: 50, tax: 5 }],
        items_return: [],
      }
    ),
    ...overrides,
  };
}

function makeItemsColl(itemDoc, overrides = {}) {
  return {
    findOne: jest.fn().mockResolvedValue(
      itemDoc ?? {
        _id: new ObjectId(fakeItemId),
        name: 'Widget A',
        barcode_id: 'BAR001',
        itemid: 'SKU001',
        track_inventory: true,
        available_quantity: 20,
        company_price: 100,
      }
    ),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    ...overrides,
  };
}

function makeTaxColl(taxDoc, overrides = {}) {
  return {
    findOne: jest.fn().mockResolvedValue(
      taxDoc ?? {
        rate: 5,
        name: '5% Tax',
        tax_fields: [{ tax_id: new ObjectId(), tax_name: '5% Tax', tax_value: 5 }],
      }
    ),
    insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    ...overrides,
  };
}

function makeBranchesColl(branchDoc, overrides = {}) {
  return {
    findOne: jest.fn().mockResolvedValue(
      branchDoc ?? {
        _id: new ObjectId(fakeBranchId),
        stock_management: true,
        stock_management_log: true,
      }
    ),
    ...overrides,
  };
}

function makeStocklogsColl(overrides = {}) {
  return {
    insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    ...overrides,
  };
}

// ─── Wire getCollection spy ───────────────────────────────────────────────────
function setupCollections({ receivings, items, grouptax, branches, stocklogs } = {}) {
  const cols = {
    receivings: receivings ?? makeReceivingsColl(),
    items: items ?? makeItemsColl(),
    grouptax: grouptax ?? makeTaxColl(),
    branches: branches ?? makeBranchesColl(),
    stocklogs: stocklogs ?? makeStocklogsColl(),
  };
  jest
    .spyOn(MockBaseModel.prototype, 'getCollection')
    .mockImplementation(async (name) => cols[name] ?? {});
  return cols;
}

// ─── Request payload builders ─────────────────────────────────────────────────
function makeItem(overrides = {}) {
  return {
    item_id: fakeItemId,
    item_name: 'Widget A',
    item_quantity: 5, // remaining in receiving after return
    return_quantity: 3, // quantity being returned
    total_amount: 500,
    return_total_amount: 300,
    item_unit: 'qty',
    item_tax: 5,
    gst: 5,
    return_gst: 5,
    ...overrides,
  };
}

function makeData(overrides = {}) {
  return {
    id: fakeReceivingId,
    supplier_state: 'Karnataka', // != 'Tamil Nadu' → IGST path
    items_return: [makeItem()],
    ...overrides,
  };
}

// ─── Reset per test ───────────────────────────────────────────────────────────
beforeEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});

  MockBaseModel.license = fakeLicenseId;
  MockBaseModel.loggedUser = fakeUserId;
  MockBaseModel.loggedUserName = 'Test User';
  MockBaseModel.currentBranch = fakeBranchId;
  MockBaseModel.currentBranchName = 'Test Branch';
  MockBaseModel.currentBranchState = 'Tamil Nadu';
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. Module exports
// ══════════════════════════════════════════════════════════════════════════════
describe('receiving-return.model — exports', () => {
  test('module exports returnReceivingOrder as a named export', () => {
    const mod = require('../../../src/models/receiving-return.model');
    expect(mod).toHaveProperty('returnReceivingOrder');
  });

  test('returnReceivingOrder is a function', () => {
    expect(typeof returnReceivingOrder).toBe('function');
  });

  test('returnReceivingOrder returns a Promise (is async)', () => {
    setupCollections();
    const result = returnReceivingOrder(makeData());
    expect(result).toBeInstanceOf(Promise);
    return result; // avoid unhandled rejection
  });

  test('module exports exactly one key', () => {
    const mod = require('../../../src/models/receiving-return.model');
    expect(Object.keys(mod)).toHaveLength(1);
    expect(Object.keys(mod)[0]).toBe('returnReceivingOrder');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. Input validation
// ══════════════════════════════════════════════════════════════════════════════
describe('returnReceivingOrder — input validation', () => {
  test('returns status:false when data is null', async () => {
    const result = await returnReceivingOrder(null);
    expect(result.status).toBe(false);
    expect(result.data).toBeNull();
    expect(result.message).toBe('Return receiving value is null');
  });

  test('returns status:false when data is undefined', async () => {
    const result = await returnReceivingOrder(undefined);
    expect(result.status).toBe(false);
    expect(result.data).toBeNull();
    expect(result.message).toBe('Return receiving value is null');
  });

  test('returns status:false when data.id is missing', async () => {
    const result = await returnReceivingOrder({ items_return: [makeItem()] });
    expect(result.status).toBe(false);
    expect(result.data).toBeNull();
    expect(result.message).toBe('Return receiving value is null');
  });

  test('returns status:false when data.id is empty string', async () => {
    const result = await returnReceivingOrder({ id: '', items_return: [] });
    expect(result.status).toBe(false);
    expect(result.message).toBe('Return receiving value is null');
  });

  test('does NOT call getCollection when validation fails', async () => {
    const spy = jest.spyOn(MockBaseModel.prototype, 'getCollection');
    await returnReceivingOrder(null);
    expect(spy).not.toHaveBeenCalled();
  });

  test('response shape is { status, data, message } on validation failure', async () => {
    const result = await returnReceivingOrder(null);
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('message');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. Happy path — success
// ══════════════════════════════════════════════════════════════════════════════
describe('returnReceivingOrder — success path', () => {
  test('returns status:true on successful return', async () => {
    setupCollections();
    const result = await returnReceivingOrder(makeData());
    expect(result.status).toBe(true);
  });

  test('returns correct success message', async () => {
    setupCollections();
    const result = await returnReceivingOrder(makeData());
    expect(result.message).toBe('Return receiving updated successfully');
  });

  test('result.data has print:false', async () => {
    setupCollections();
    const result = await returnReceivingOrder(makeData());
    expect(result.data.print).toBe(false);
  });

  test('result.data.receiving_id is a 24-char hex string', async () => {
    setupCollections();
    const result = await returnReceivingOrder(makeData());
    expect(typeof result.data.receiving_id).toBe('string');
    expect(result.data.receiving_id).toHaveLength(24);
  });

  test('all required collections are fetched', async () => {
    const spy = jest.fn().mockImplementation(async (name) => {
      if (name === 'receivings') return makeReceivingsColl();
      if (name === 'items') return makeItemsColl();
      if (name === 'grouptax') return makeTaxColl();
      if (name === 'branches') return makeBranchesColl();
      if (name === 'stocklogs') return makeStocklogsColl();
      return {};
    });
    jest.spyOn(MockBaseModel.prototype, 'getCollection').mockImplementation(spy);
    await returnReceivingOrder(makeData());
    const names = spy.mock.calls.map(([n]) => n);
    expect(names).toContain('receivings');
    expect(names).toContain('items');
    expect(names).toContain('grouptax');
    expect(names).toContain('branches');
    expect(names).toContain('stocklogs');
  });

  test('empty items_return processes without error', async () => {
    setupCollections();
    const result = await returnReceivingOrder(makeData({ items_return: [] }));
    expect(result.status).toBe(true);
  });

  test('missing items_return defaults to empty array', async () => {
    setupCollections();
    const result = await returnReceivingOrder({ id: fakeReceivingId, supplier_state: 'Karnataka' });
    expect(result.status).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. Inventory update behaviour (track_inventory)
// ══════════════════════════════════════════════════════════════════════════════
describe('returnReceivingOrder — inventory update', () => {
  test('updates item available_quantity when track_inventory=true', async () => {
    const cols = setupCollections();
    await returnReceivingOrder(makeData());
    expect(cols.items.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: expect.any(Object) }),
      expect.objectContaining({
        $set: expect.objectContaining({ available_quantity: expect.any(Number) }),
      })
    );
  });

  test('reduces available_quantity by return_quantity amount', async () => {
    const itemDoc = {
      _id: new ObjectId(fakeItemId),
      name: 'Widget A',
      barcode_id: 'BAR001',
      itemid: 'SKU001',
      track_inventory: true,
      available_quantity: 20,
      company_price: 100,
    };
    const cols = setupCollections({ items: makeItemsColl(itemDoc) });
    await returnReceivingOrder(makeData()); // return_quantity = 3
    expect(cols.items.updateOne).toHaveBeenCalledWith(
      expect.any(Object),
      { $set: { available_quantity: 17 } } // 20 - 3 = 17
    );
  });

  test('does NOT update item when track_inventory=false', async () => {
    const itemDoc = {
      _id: new ObjectId(fakeItemId),
      name: 'Widget A',
      barcode_id: 'BAR001',
      itemid: 'SKU001',
      track_inventory: false,
      available_quantity: 20,
      company_price: 100,
    };
    const cols = setupCollections({ items: makeItemsColl(itemDoc) });
    await returnReceivingOrder(makeData());
    expect(cols.items.updateOne).not.toHaveBeenCalled();
  });

  test('treats track_inventory="true" (string) as truthy and updates inventory', async () => {
    const itemDoc = {
      _id: new ObjectId(fakeItemId),
      name: 'Widget A',
      barcode_id: 'BAR001',
      itemid: 'SKU001',
      track_inventory: 'true',
      available_quantity: 10,
      company_price: 50,
    };
    const cols = setupCollections({ items: makeItemsColl(itemDoc) });
    await returnReceivingOrder(makeData());
    expect(cols.items.updateOne).toHaveBeenCalledTimes(1);
  });

  test('skips item when findOne returns null (item not in DB) and continues', async () => {
    const cols = setupCollections({
      items: makeItemsColl(null, { findOne: jest.fn().mockResolvedValue(null) }),
    });
    const result = await returnReceivingOrder(makeData());
    expect(result.status).toBe(true);
    expect(cols.items.updateOne).not.toHaveBeenCalled();
  });

  test('result is still success when all items are skipped due to not-found', async () => {
    setupCollections({
      items: makeItemsColl(null, { findOne: jest.fn().mockResolvedValue(null) }),
    });
    const result = await returnReceivingOrder(makeData());
    expect(result.status).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. Stock log creation
// ══════════════════════════════════════════════════════════════════════════════
describe('returnReceivingOrder — stock log creation', () => {
  test('creates stock log when stock_management=true and track_inventory=true', async () => {
    const cols = setupCollections();
    await returnReceivingOrder(makeData());
    expect(cols.stocklogs.insertOne).toHaveBeenCalledTimes(1);
  });

  test('does NOT create stock log when stock_management=false', async () => {
    const cols = setupCollections({
      branches: makeBranchesColl({ stock_management: false, stock_management_log: true }),
    });
    await returnReceivingOrder(makeData());
    expect(cols.stocklogs.insertOne).not.toHaveBeenCalled();
  });

  test('does NOT create stock log when track_inventory=false', async () => {
    const itemDoc = {
      _id: new ObjectId(fakeItemId),
      name: 'Widget A',
      barcode_id: 'BAR001',
      itemid: 'SKU001',
      track_inventory: false,
      available_quantity: 10,
      company_price: 50,
    };
    const cols = setupCollections({ items: makeItemsColl(itemDoc) });
    await returnReceivingOrder(makeData());
    expect(cols.stocklogs.insertOne).not.toHaveBeenCalled();
  });

  test('stock log process is "Return Receiving"', async () => {
    const cols = setupCollections();
    await returnReceivingOrder(makeData());
    const logArg = cols.stocklogs.insertOne.mock.calls[0][0];
    expect(logArg.process).toBe('Return Receiving');
  });

  test('stock log action is "Subtract"', async () => {
    const cols = setupCollections();
    await returnReceivingOrder(makeData());
    const logArg = cols.stocklogs.insertOne.mock.calls[0][0];
    expect(logArg.action).toBe('Subtract');
  });

  test('stock log reference equals the receiving id', async () => {
    const cols = setupCollections();
    await returnReceivingOrder(makeData());
    const logArg = cols.stocklogs.insertOne.mock.calls[0][0];
    expect(logArg.reference).toBe(fakeReceivingId);
  });

  test('stock log branch_id matches currentBranch', async () => {
    const cols = setupCollections();
    await returnReceivingOrder(makeData());
    const logArg = cols.stocklogs.insertOne.mock.calls[0][0];
    expect(logArg.branch_id.toHexString()).toBe(fakeBranchId);
  });

  test('stock log count is negative string of return_quantity', async () => {
    const cols = setupCollections();
    await returnReceivingOrder(makeData()); // return_quantity = 3
    const logArg = cols.stocklogs.insertOne.mock.calls[0][0];
    expect(logArg.count).toBe('-3');
  });

  test('stock log closing_balance = opening_balance - return_quantity', async () => {
    const itemDoc = {
      _id: new ObjectId(fakeItemId),
      name: 'Widget A',
      barcode_id: 'BAR001',
      itemid: 'SKU001',
      track_inventory: true,
      available_quantity: 20,
      company_price: 100,
    };
    const cols = setupCollections({ items: makeItemsColl(itemDoc) });
    await returnReceivingOrder(makeData()); // return_quantity = 3
    const logArg = cols.stocklogs.insertOne.mock.calls[0][0];
    expect(logArg.opening_balance).toBe(20);
    expect(logArg.closing_balance).toBe(17);
  });

  test('stock log item_quantity matches return_quantity', async () => {
    const cols = setupCollections();
    await returnReceivingOrder(makeData()); // return_quantity = 3
    const logArg = cols.stocklogs.insertOne.mock.calls[0][0];
    expect(logArg.item_quantity).toBe(3);
  });

  test('fetches stocklogs collection only when stock_management=true', async () => {
    const spy = jest.fn().mockImplementation(async (name) => {
      if (name === 'receivings') return makeReceivingsColl();
      if (name === 'items') return makeItemsColl();
      if (name === 'grouptax') return makeTaxColl();
      if (name === 'branches')
        return makeBranchesColl({ stock_management: false, stock_management_log: false });
      return {};
    });
    jest.spyOn(MockBaseModel.prototype, 'getCollection').mockImplementation(spy);
    await returnReceivingOrder(makeData());
    const names = spy.mock.calls.map(([n]) => n);
    expect(names).not.toContain('stocklogs');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. Receiving item update — $set vs $pull
// ══════════════════════════════════════════════════════════════════════════════
describe('returnReceivingOrder — receiving $set vs $pull', () => {
  test('uses $set on receiving item when item_quantity > 0 (partial return)', async () => {
    const cols = setupCollections();
    await returnReceivingOrder(makeData({ items_return: [makeItem({ item_quantity: 5 })] }));
    const setCall = cols.receivings.updateOne.mock.calls.find(
      ([, u]) => u.$set?.['items.$.item_quantity'] !== undefined
    );
    expect(setCall).toBeDefined();
  });

  test('uses $pull on receiving item when item_quantity = 0 (full item return)', async () => {
    const cols = setupCollections();
    await returnReceivingOrder(makeData({ items_return: [makeItem({ item_quantity: 0 })] }));
    const pullCall = cols.receivings.updateOne.mock.calls.find(
      ([, u]) => u.$pull?.items !== undefined
    );
    expect(pullCall).toBeDefined();
  });

  test('$set updates item_quantity, total_amount, igst_tax, cgst_tax, sgst_tax', async () => {
    const cols = setupCollections();
    await returnReceivingOrder(makeData({ items_return: [makeItem({ item_quantity: 5 })] }));
    const setCall = cols.receivings.updateOne.mock.calls.find(
      ([, u]) => u.$set?.['items.$.item_quantity'] !== undefined
    );
    const keys = Object.keys(setCall[1].$set);
    expect(keys).toContain('items.$.item_quantity');
    expect(keys).toContain('items.$.total_amount');
    expect(keys).toContain('items.$.igst_tax');
    expect(keys).toContain('items.$.cgst_tax');
    expect(keys).toContain('items.$.sgst_tax');
  });

  test('$pull filter uses item_id of the returned item', async () => {
    const cols = setupCollections();
    await returnReceivingOrder(makeData({ items_return: [makeItem({ item_quantity: 0 })] }));
    const pullCall = cols.receivings.updateOne.mock.calls.find(
      ([, u]) => u.$pull?.items !== undefined
    );
    expect(pullCall[1].$pull.items.item_id).toBe(fakeItemId);
  });

  test('does NOT produce a $pull call when item_quantity > 0', async () => {
    const cols = setupCollections();
    await returnReceivingOrder(makeData({ items_return: [makeItem({ item_quantity: 5 })] }));
    const pullCall = cols.receivings.updateOne.mock.calls.find(
      ([, u]) => u.$pull?.items !== undefined
    );
    expect(pullCall).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. Tax handling
// ══════════════════════════════════════════════════════════════════════════════
describe('returnReceivingOrder — tax handling', () => {
  test('uses existing tax when found (no insertOne on grouptax)', async () => {
    const existingTax = {
      rate: 5,
      name: '5% Tax',
      tax_fields: [{ tax_id: new ObjectId(), tax_name: '5% Tax', tax_value: 5 }],
    };
    const cols = setupCollections({ grouptax: makeTaxColl(existingTax) });
    await returnReceivingOrder(makeData());
    expect(cols.grouptax.insertOne).not.toHaveBeenCalled();
  });

  test('creates new tax when grouptax.findOne returns null', async () => {
    const cols = setupCollections({
      grouptax: makeTaxColl(null, {
        findOne: jest.fn().mockResolvedValue(null),
        insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
        updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      }),
    });
    await returnReceivingOrder(makeData());
    expect(cols.grouptax.insertOne).toHaveBeenCalledTimes(1);
  });

  test('pushes tax_fields entry after inserting new tax', async () => {
    const cols = setupCollections({
      grouptax: makeTaxColl(null, {
        findOne: jest.fn().mockResolvedValue(null),
        insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
        updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      }),
    });
    await returnReceivingOrder(makeData());
    const pushCall = cols.grouptax.updateOne.mock.calls.find(
      ([, u]) => u.$push?.tax_fields !== undefined
    );
    expect(pushCall).toBeDefined();
  });

  test('new tax name follows "<rate>% Tax" format', async () => {
    const cols = setupCollections({
      grouptax: makeTaxColl(null, {
        findOne: jest.fn().mockResolvedValue(null),
        insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
        updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      }),
    });
    await returnReceivingOrder(makeData({ items_return: [makeItem({ item_tax: 18 })] }));
    const insertArg = cols.grouptax.insertOne.mock.calls[0][0];
    expect(insertArg.name).toBe('18% Tax');
    expect(insertArg.rate).toBe(18);
  });

  test('new tax is created with correct branch and license context', async () => {
    const cols = setupCollections({
      grouptax: makeTaxColl(null, {
        findOne: jest.fn().mockResolvedValue(null),
        insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
        updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      }),
    });
    await returnReceivingOrder(makeData());
    const insertArg = cols.grouptax.insertOne.mock.calls[0][0];
    expect(insertArg.branch_id.toHexString()).toBe(fakeBranchId);
    expect(insertArg.license.toHexString()).toBe(fakeLicenseId);
  });

  test('new tax tax_group is "no"', async () => {
    const cols = setupCollections({
      grouptax: makeTaxColl(null, {
        findOne: jest.fn().mockResolvedValue(null),
        insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
        updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      }),
    });
    await returnReceivingOrder(makeData());
    const insertArg = cols.grouptax.insertOne.mock.calls[0][0];
    expect(insertArg.tax_group).toBe('no');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. IGST vs CGST/SGST (inter-state vs intra-state tax)
// ══════════════════════════════════════════════════════════════════════════════
describe('returnReceivingOrder — IGST vs CGST/SGST', () => {
  function getPushedReturnItem(cols) {
    const pushCall = cols.receivings.updateOne.mock.calls.find(
      ([, u]) => u.$push?.items_return !== undefined
    );
    return pushCall[1].$push.items_return.returnArray.returnValue[0];
  }

  test('uses IGST (full rate) when supplier_state !== currentBranchState', async () => {
    const cols = setupCollections();
    // currentBranchState='Tamil Nadu', supplier_state='Karnataka' → IGST
    await returnReceivingOrder(
      makeData({
        supplier_state: 'Karnataka',
        items_return: [makeItem({ gst: 18, return_gst: 18 })],
      })
    );
    const item = getPushedReturnItem(cols);
    expect(item.igst_tax).toBe(18);
    expect(item.cgst_tax).toBe(0);
    expect(item.sgst_tax).toBe(0);
  });

  test('uses CGST/SGST (rate/2) when supplier_state === currentBranchState', async () => {
    const cols = setupCollections();
    // Both 'Tamil Nadu' → CGST/SGST
    await returnReceivingOrder(
      makeData({
        supplier_state: 'Tamil Nadu',
        items_return: [makeItem({ gst: 18, return_gst: 18 })],
      })
    );
    const item = getPushedReturnItem(cols);
    expect(item.igst_tax).toBe(0);
    expect(item.cgst_tax).toBe(9); // 18 / 2
    expect(item.sgst_tax).toBe(9); // 18 / 2
  });

  test('CGST equals SGST (symmetric split)', async () => {
    const cols = setupCollections();
    await returnReceivingOrder(
      makeData({
        supplier_state: 'Tamil Nadu',
        items_return: [makeItem({ return_gst: 12 })],
      })
    );
    const item = getPushedReturnItem(cols);
    expect(item.cgst_tax).toBe(item.sgst_tax);
  });

  test('zero gst results in zero igst_tax / cgst_tax / sgst_tax', async () => {
    const cols = setupCollections();
    await returnReceivingOrder(
      makeData({
        items_return: [makeItem({ gst: 0, return_gst: 0 })],
      })
    );
    const item = getPushedReturnItem(cols);
    expect(item.igst_tax).toBe(0);
    expect(item.cgst_tax).toBe(0);
    expect(item.sgst_tax).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. Receiving status (FullReturn vs PartialReturn)
// ══════════════════════════════════════════════════════════════════════════════
describe('returnReceivingOrder — receiving_status', () => {
  function getTotalsUpdate(cols) {
    return cols.receivings.updateOne.mock.calls.find(
      ([, u]) => u.$set?.receiving_status !== undefined
    );
  }

  test('sets receiving_status="FullReturn" when items total = 0 after return', async () => {
    const cols = setupCollections({
      receivings: makeReceivingsColl({ items: [], items_return: [] }),
    });
    await returnReceivingOrder(makeData());
    const call = getTotalsUpdate(cols);
    expect(call[1].$set.receiving_status).toBe('FullReturn');
  });

  test('sets receiving_status="PartialReturn" when items still have remaining total', async () => {
    const cols = setupCollections({
      receivings: makeReceivingsColl({
        items: [{ total_amount: 200, item_quantity: 2, item_price: 100, tax: 5 }],
        items_return: [],
      }),
    });
    await returnReceivingOrder(makeData());
    const call = getTotalsUpdate(cols);
    expect(call[1].$set.receiving_status).toBe('PartialReturn');
  });

  test('totals $set includes all required keys', async () => {
    const cols = setupCollections();
    await returnReceivingOrder(makeData());
    const call = getTotalsUpdate(cols);
    const fields = call[1].$set;
    expect(fields).toHaveProperty('receiving_status');
    expect(fields).toHaveProperty('tax');
    expect(fields).toHaveProperty('items_subtotal');
    expect(fields).toHaveProperty('items_total');
    expect(fields).toHaveProperty('return_tax');
    expect(fields).toHaveProperty('items_return_subtotal');
    expect(fields).toHaveProperty('items_return_total');
    expect(fields).toHaveProperty('updated_date');
  });

  test('updated_date in totals $set is a Date instance', async () => {
    const cols = setupCollections();
    await returnReceivingOrder(makeData());
    const call = getTotalsUpdate(cols);
    expect(call[1].$set.updated_date).toBeInstanceOf(Date);
  });

  test('items_total equals sum of remaining item total_amounts', async () => {
    const cols = setupCollections({
      receivings: makeReceivingsColl({
        items: [
          { total_amount: 100, item_quantity: 1, item_price: 100, tax: 0 },
          { total_amount: 200, item_quantity: 2, item_price: 100, tax: 0 },
        ],
        items_return: [],
      }),
    });
    await returnReceivingOrder(makeData());
    const call = getTotalsUpdate(cols);
    expect(call[1].$set.items_total).toBe(300);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. Return record structure
// ══════════════════════════════════════════════════════════════════════════════
describe('returnReceivingOrder — return record structure', () => {
  function getPushCall(cols) {
    return cols.receivings.updateOne.mock.calls.find(
      ([, u]) => u.$push?.items_return !== undefined
    );
  }

  test('pushes items_return entry to receivings collection', async () => {
    const cols = setupCollections();
    await returnReceivingOrder(makeData());
    expect(getPushCall(cols)).toBeDefined();
  });

  test('returnArray has returnObjId, returnId, returnDate, returnValue', async () => {
    const cols = setupCollections();
    await returnReceivingOrder(makeData());
    const { returnArray } = getPushCall(cols)[1].$push.items_return;
    expect(returnArray).toHaveProperty('returnObjId');
    expect(returnArray).toHaveProperty('returnId');
    expect(returnArray).toHaveProperty('returnDate');
    expect(returnArray).toHaveProperty('returnValue');
  });

  test('returnId starts with "RFP"', async () => {
    const cols = setupCollections();
    await returnReceivingOrder(makeData());
    const { returnId } = getPushCall(cols)[1].$push.items_return.returnArray;
    expect(returnId).toMatch(/^RFP/);
  });

  test('returnDate is a Date instance', async () => {
    const cols = setupCollections();
    await returnReceivingOrder(makeData());
    const { returnDate } = getPushCall(cols)[1].$push.items_return.returnArray;
    expect(returnDate).toBeInstanceOf(Date);
  });

  test('returnValue is an array with one entry per processed item', async () => {
    const cols = setupCollections();
    await returnReceivingOrder(makeData()); // 1 item in items_return
    const { returnValue } = getPushCall(cols)[1].$push.items_return.returnArray;
    expect(Array.isArray(returnValue)).toBe(true);
    expect(returnValue).toHaveLength(1);
  });

  test('individual return item has item_id, item_name, item_quantity, tax_type', async () => {
    const cols = setupCollections();
    await returnReceivingOrder(makeData());
    const returnItem = getPushCall(cols)[1].$push.items_return.returnArray.returnValue[0];
    expect(returnItem.item_id).toBe(fakeItemId);
    expect(returnItem.item_name).toBe('Widget A');
    expect(typeof returnItem.item_quantity).toBe('number');
    expect(returnItem.tax_type).toBe('exclusive');
  });

  test('individual return item has return_id starting with "RFP"', async () => {
    const cols = setupCollections();
    await returnReceivingOrder(makeData());
    const returnItem = getPushCall(cols)[1].$push.items_return.returnArray.returnValue[0];
    expect(returnItem.return_id).toMatch(/^RFP/);
  });

  test('individual return item has return_date as a Date', async () => {
    const cols = setupCollections();
    await returnReceivingOrder(makeData());
    const returnItem = getPushCall(cols)[1].$push.items_return.returnArray.returnValue[0];
    expect(returnItem.return_date).toBeInstanceOf(Date);
  });

  test('item_unit is preserved from input', async () => {
    const cols = setupCollections();
    await returnReceivingOrder(makeData({ items_return: [makeItem({ item_unit: 'kg' })] }));
    const returnItem = getPushCall(cols)[1].$push.items_return.returnArray.returnValue[0];
    expect(returnItem.item_unit).toBe('kg');
  });

  test('item_unit defaults to "qty" when not provided', async () => {
    const cols = setupCollections();
    const item = makeItem();
    delete item.item_unit;
    await returnReceivingOrder(makeData({ items_return: [item] }));
    const returnItem = getPushCall(cols)[1].$push.items_return.returnArray.returnValue[0];
    expect(returnItem.item_unit).toBe('qty');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. Multiple return items
// ══════════════════════════════════════════════════════════════════════════════
describe('returnReceivingOrder — multiple return items', () => {
  test('processes all items when items_return has two entries', async () => {
    const item2Id = new ObjectId().toHexString();
    let callIndex = 0;
    const itemsColl = {
      findOne: jest.fn().mockImplementation(async () => {
        const docs = [
          {
            _id: new ObjectId(fakeItemId),
            name: 'Widget A',
            barcode_id: 'BAR001',
            itemid: 'SKU001',
            track_inventory: true,
            available_quantity: 20,
            company_price: 100,
          },
          {
            _id: new ObjectId(item2Id),
            name: 'Widget B',
            barcode_id: 'BAR002',
            itemid: 'SKU002',
            track_inventory: true,
            available_quantity: 15,
            company_price: 50,
          },
        ];
        return docs[callIndex++] ?? null;
      }),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    jest.spyOn(MockBaseModel.prototype, 'getCollection').mockImplementation(async (name) => {
      if (name === 'receivings') return makeReceivingsColl();
      if (name === 'items') return itemsColl;
      if (name === 'grouptax') return makeTaxColl();
      if (name === 'branches') return makeBranchesColl();
      if (name === 'stocklogs') return makeStocklogsColl();
      return {};
    });

    const result = await returnReceivingOrder(
      makeData({
        items_return: [
          makeItem({ item_id: fakeItemId, item_name: 'Widget A', return_quantity: 2 }),
          makeItem({ item_id: item2Id, item_name: 'Widget B', return_quantity: 1 }),
        ],
      })
    );

    expect(result.status).toBe(true);
    expect(itemsColl.findOne).toHaveBeenCalledTimes(2);
    expect(itemsColl.updateOne).toHaveBeenCalledTimes(2);
  });

  test('returnValue array has one entry per processed item', async () => {
    const item2Id = new ObjectId().toHexString();
    let ci = 0;
    const itemsColl = {
      findOne: jest.fn().mockImplementation(async () => {
        return (
          [
            {
              _id: new ObjectId(fakeItemId),
              name: 'Widget A',
              barcode_id: 'B1',
              itemid: 'S1',
              track_inventory: false,
              available_quantity: 10,
              company_price: 50,
            },
            {
              _id: new ObjectId(item2Id),
              name: 'Widget B',
              barcode_id: 'B2',
              itemid: 'S2',
              track_inventory: false,
              available_quantity: 10,
              company_price: 50,
            },
          ][ci++] ?? null
        );
      }),
      updateOne: jest.fn(),
    };
    jest.spyOn(MockBaseModel.prototype, 'getCollection').mockImplementation(async (name) => {
      if (name === 'items') return itemsColl;
      if (name === 'receivings') return makeReceivingsColl();
      if (name === 'grouptax') return makeTaxColl();
      if (name === 'branches') return makeBranchesColl();
      return {};
    });

    const cols = { receivings: null };
    jest.spyOn(MockBaseModel.prototype, 'getCollection').mockImplementation(async (name) => {
      if (name === 'receivings') {
        if (!cols.receivings) cols.receivings = makeReceivingsColl();
        return cols.receivings;
      }
      if (name === 'items') return itemsColl;
      if (name === 'grouptax') return makeTaxColl();
      if (name === 'branches') return makeBranchesColl();
      return {};
    });

    await returnReceivingOrder(
      makeData({
        items_return: [makeItem({ item_id: fakeItemId }), makeItem({ item_id: item2Id })],
      })
    );

    const pushCall = cols.receivings.updateOne.mock.calls.find(
      ([, u]) => u.$push?.items_return !== undefined
    );
    expect(pushCall[1].$push.items_return.returnArray.returnValue).toHaveLength(2);
  });

  test('creates a stock log for each tracked item', async () => {
    const item2Id = new ObjectId().toHexString();
    let ci2 = 0;
    const itemsColl = {
      findOne: jest.fn().mockImplementation(
        async () =>
          [
            {
              _id: new ObjectId(fakeItemId),
              name: 'Widget A',
              barcode_id: 'B1',
              itemid: 'S1',
              track_inventory: true,
              available_quantity: 10,
              company_price: 50,
            },
            {
              _id: new ObjectId(item2Id),
              name: 'Widget B',
              barcode_id: 'B2',
              itemid: 'S2',
              track_inventory: true,
              available_quantity: 8,
              company_price: 30,
            },
          ][ci2++]
      ),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const stocklogsColl = makeStocklogsColl();
    jest.spyOn(MockBaseModel.prototype, 'getCollection').mockImplementation(async (name) => {
      if (name === 'receivings') return makeReceivingsColl();
      if (name === 'items') return itemsColl;
      if (name === 'grouptax') return makeTaxColl();
      if (name === 'branches') return makeBranchesColl();
      if (name === 'stocklogs') return stocklogsColl;
      return {};
    });

    await returnReceivingOrder(
      makeData({
        items_return: [
          makeItem({ item_id: fakeItemId, return_quantity: 2 }),
          makeItem({ item_id: item2Id, return_quantity: 1 }),
        ],
      })
    );

    expect(stocklogsColl.insertOne).toHaveBeenCalledTimes(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. Error handling
// ══════════════════════════════════════════════════════════════════════════════
describe('returnReceivingOrder — error handling', () => {
  test('returns status:false when getCollection throws', async () => {
    jest
      .spyOn(MockBaseModel.prototype, 'getCollection')
      .mockRejectedValue(new Error('DB unavailable'));
    const result = await returnReceivingOrder(makeData());
    expect(result.status).toBe(false);
    expect(result.data).toBeNull();
    expect(result.message).toBe('DB unavailable');
  });

  test('returns status:false when receivings.updateOne throws', async () => {
    setupCollections({
      receivings: makeReceivingsColl(null, {
        updateOne: jest.fn().mockRejectedValue(new Error('Write failed')),
      }),
    });
    const result = await returnReceivingOrder(makeData());
    expect(result.status).toBe(false);
    expect(result.message).toBe('Write failed');
  });

  test('returns status:false when items.findOne throws', async () => {
    setupCollections({
      items: makeItemsColl(null, {
        findOne: jest.fn().mockRejectedValue(new Error('Item query error')),
      }),
    });
    const result = await returnReceivingOrder(makeData());
    expect(result.status).toBe(false);
    expect(result.message).toBe('Item query error');
  });

  test('returns status:false when branches.findOne throws', async () => {
    setupCollections({
      branches: makeBranchesColl(null, {
        findOne: jest.fn().mockRejectedValue(new Error('Branch query error')),
      }),
    });
    const result = await returnReceivingOrder(makeData());
    expect(result.status).toBe(false);
    expect(result.message).toBe('Branch query error');
  });

  test('returns status:false when grouptax.findOne throws', async () => {
    setupCollections({
      grouptax: makeTaxColl(null, {
        findOne: jest.fn().mockRejectedValue(new Error('Tax query error')),
      }),
    });
    const result = await returnReceivingOrder(makeData());
    expect(result.status).toBe(false);
    expect(result.message).toBe('Tax query error');
  });

  test('error response always has { status, data, message } shape', async () => {
    jest.spyOn(MockBaseModel.prototype, 'getCollection').mockRejectedValue(new Error('Boom'));
    const result = await returnReceivingOrder(makeData());
    expect(result).toHaveProperty('status', false);
    expect(result).toHaveProperty('data', null);
    expect(result).toHaveProperty('message');
    expect(typeof result.message).toBe('string');
  });

  test('logs error to console.error on DB failure', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(MockBaseModel.prototype, 'getCollection').mockRejectedValue(new Error('Boom'));
    await returnReceivingOrder(makeData());
    expect(spy).toHaveBeenCalled();
  });

  test('returns generic message when error has no message', async () => {
    jest.spyOn(MockBaseModel.prototype, 'getCollection').mockRejectedValue(new Error());
    const result = await returnReceivingOrder(makeData());
    expect(result.status).toBe(false);
    expect(result.message).toBeDefined();
  });
});
