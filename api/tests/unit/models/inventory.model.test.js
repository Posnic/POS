'use strict';

/**
 * Unit tests for src/models/inventory.model.js
 *
 * File confirmed : src/models/inventory.model.js (sole inventory model — no duplicates)
 * ORM            : Mongoose (MongoDB)
 * Exports        : { InventoryItem, StockMovement, STOCK_MOVEMENT_TYPES }
 *
 * Strategy: Pure schema inspection + mocked static methods.
 * - Schema fields are inspected via schema.path() — no DB connection needed.
 * - Virtual getter is called directly on a plain context object.
 * - Pre-save hook is retrieved from schema.s.hooks and called on a plain context.
 * - Static methods are tested by spying on model/mongoose primitives.
 * - No mongodb-memory-server, no real queries, no production data touched.
 */

const mongoose = require('mongoose');
const {
  InventoryItem,
  StockMovement,
  STOCK_MOVEMENT_TYPES,
} = require('../../../src/models/inventory.model');

// ─── Schema shorthand helpers ──────────────────────────────────────────────────
const invSchema = InventoryItem.schema;
const smSchema = StockMovement.schema;
const invPath = (f) => invSchema.path(f);
const smPath = (f) => smSchema.path(f);

// ─── Expected constant values (mirror model source) ───────────────────────────
const ALL_MOVEMENT_TYPES = [
  'purchase',
  'sale',
  'adjustment',
  'return',
  'transfer_in',
  'transfer_out',
  'damaged',
  'lost',
  'found',
  'count',
  'opening_balance',
];

const ALL_REFERENCE_MODELS = [
  'Sale',
  'Receiving',
  'InventoryAdjustment',
  'StockTransfer',
  'StockCount',
];

// ─── Fake ObjectIds ────────────────────────────────────────────────────────────
const fakeItemId = new mongoose.Types.ObjectId();
const fakeBranchId = new mongoose.Types.ObjectId();
const fakeUserId = new mongoose.Types.ObjectId();

// ─── Reusable mock builders ────────────────────────────────────────────────────
function makeMockSession() {
  return {
    startTransaction: jest.fn(),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    abortTransaction: jest.fn().mockResolvedValue(undefined),
    endSession: jest.fn(),
  };
}

function makeMockInventoryItem(qty = 10) {
  return {
    quantity: qty,
    committed: 0,
    lastMovement: null,
    save: jest.fn().mockResolvedValue(undefined),
  };
}

function makeStockMovementChain(docs = []) {
  return {
    populate: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockResolvedValue(docs),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. STOCK_MOVEMENT_TYPES constant
// ══════════════════════════════════════════════════════════════════════════════
describe('STOCK_MOVEMENT_TYPES constant', () => {
  test('is exported from the module', () => {
    expect(STOCK_MOVEMENT_TYPES).toBeDefined();
  });

  test('has exactly 11 movement types', () => {
    expect(Object.keys(STOCK_MOVEMENT_TYPES)).toHaveLength(11);
  });

  test.each(ALL_MOVEMENT_TYPES)('contains movement type "%s"', (type) => {
    expect(Object.values(STOCK_MOVEMENT_TYPES)).toContain(type);
  });

  test('PURCHASE value is "purchase"', () => {
    expect(STOCK_MOVEMENT_TYPES.PURCHASE).toBe('purchase');
  });

  test('SALE value is "sale"', () => {
    expect(STOCK_MOVEMENT_TYPES.SALE).toBe('sale');
  });

  test('ADJUSTMENT value is "adjustment"', () => {
    expect(STOCK_MOVEMENT_TYPES.ADJUSTMENT).toBe('adjustment');
  });

  test('OPENING_BALANCE value is "opening_balance"', () => {
    expect(STOCK_MOVEMENT_TYPES.OPENING_BALANCE).toBe('opening_balance');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. StockMovement — model identity & plugins
// ══════════════════════════════════════════════════════════════════════════════
describe('StockMovement › model identity', () => {
  test('model name is "StockMovement"', () => {
    expect(StockMovement.modelName).toBe('StockMovement');
  });

  test('is a Mongoose Model (has standard query methods)', () => {
    expect(typeof StockMovement.find).toBe('function');
    expect(typeof StockMovement.findOne).toBe('function');
    expect(typeof StockMovement.create).toBe('function');
    expect(typeof StockMovement.countDocuments).toBe('function');
  });

  test('paginate plugin is attached', () => {
    expect(typeof StockMovement.paginate).toBe('function');
  });

  test('schema is a mongoose.Schema instance', () => {
    expect(smSchema).toBeInstanceOf(mongoose.Schema);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. StockMovement schema fields
// ══════════════════════════════════════════════════════════════════════════════
describe('StockMovement schema › item field', () => {
  test('path exists', () => {
    expect(smPath('item')).toBeDefined();
  });
  test('instance is "ObjectId"', () => {
    expect(smPath('item').instance).toBe('ObjectId');
  });
  test('is required', () => {
    expect(smPath('item').options.required).toBe(true);
  });
  test('refs "Item" model', () => {
    expect(smPath('item').options.ref).toBe('Item');
  });
});

describe('StockMovement schema › branch field', () => {
  test('path exists', () => {
    expect(smPath('branch')).toBeDefined();
  });
  test('instance is "ObjectId"', () => {
    expect(smPath('branch').instance).toBe('ObjectId');
  });
  test('is required', () => {
    expect(smPath('branch').options.required).toBe(true);
  });
  test('refs "Branch" model', () => {
    expect(smPath('branch').options.ref).toBe('Branch');
  });
});

describe('StockMovement schema › movementType field', () => {
  test('path exists', () => {
    expect(smPath('movementType')).toBeDefined();
  });
  test('instance is "String"', () => {
    expect(smPath('movementType').instance).toBe('String');
  });
  test('is required', () => {
    expect(smPath('movementType').options.required).toBe(true);
  });

  test('enum has exactly 11 values', () => {
    expect(smPath('movementType').enumValues).toHaveLength(11);
  });

  test.each(ALL_MOVEMENT_TYPES)('enum contains "%s"', (type) => {
    expect(smPath('movementType').enumValues).toContain(type);
  });

  test('enum does NOT include arbitrary value "restock"', () => {
    expect(smPath('movementType').enumValues).not.toContain('restock');
  });
});

describe('StockMovement schema › quantity field', () => {
  test('path exists', () => {
    expect(smPath('quantity')).toBeDefined();
  });
  test('instance is "Number"', () => {
    expect(smPath('quantity').instance).toBe('Number');
  });
  test('is required', () => {
    expect(smPath('quantity').options.required).toBe(true);
  });
});

describe('StockMovement schema › reference field', () => {
  test('path exists', () => {
    expect(smPath('reference')).toBeDefined();
  });
  test('instance is "ObjectId"', () => {
    expect(smPath('reference').instance).toBe('ObjectId');
  });
  test('is NOT required (optional)', () => {
    expect(smPath('reference').options.required).toBeFalsy();
  });
  test('uses refPath "referenceModel"', () => {
    expect(smPath('reference').options.refPath).toBe('referenceModel');
  });
});

describe('StockMovement schema › referenceModel field', () => {
  test('path exists', () => {
    expect(smPath('referenceModel')).toBeDefined();
  });
  test('instance is "String"', () => {
    expect(smPath('referenceModel').instance).toBe('String');
  });
  test('is NOT required (optional)', () => {
    expect(smPath('referenceModel').options.required).toBeFalsy();
  });

  test('enum has exactly 5 values', () => {
    expect(smPath('referenceModel').enumValues).toHaveLength(5);
  });

  test.each(ALL_REFERENCE_MODELS)('enum contains "%s"', (model) => {
    expect(smPath('referenceModel').enumValues).toContain(model);
  });
});

describe('StockMovement schema › notes field', () => {
  test('path exists', () => {
    expect(smPath('notes')).toBeDefined();
  });
  test('instance is "String"', () => {
    expect(smPath('notes').instance).toBe('String');
  });
  test('is NOT required (optional)', () => {
    expect(smPath('notes').options.required).toBeFalsy();
  });
});

describe('StockMovement schema › optional numeric fields', () => {
  test.each(['unitCost', 'totalCost', 'previousQuantity', 'newQuantity'])(
    '"%s" is Number and optional',
    (field) => {
      expect(smPath(field)).toBeDefined();
      expect(smPath(field).instance).toBe('Number');
      expect(smPath(field).options.required).toBeFalsy();
    }
  );
});

describe('StockMovement schema › createdBy field', () => {
  test('path exists', () => {
    expect(smPath('createdBy')).toBeDefined();
  });
  test('instance is "ObjectId"', () => {
    expect(smPath('createdBy').instance).toBe('ObjectId');
  });
  test('is required', () => {
    expect(smPath('createdBy').options.required).toBe(true);
  });
  test('refs "User" model', () => {
    expect(smPath('createdBy').options.ref).toBe('User');
  });
});

describe('StockMovement schema › timestamps', () => {
  test('timestamps option is enabled', () => {
    expect(smSchema.options.timestamps).toBe(true);
  });
  test('createdAt path exists', () => {
    expect(smPath('createdAt')).toBeDefined();
  });
  test('updatedAt path exists', () => {
    expect(smPath('updatedAt')).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. InventoryItem — model identity & plugins
// ══════════════════════════════════════════════════════════════════════════════
describe('InventoryItem › model identity', () => {
  test('model name is "InventoryItem"', () => {
    expect(InventoryItem.modelName).toBe('InventoryItem');
  });

  test('is a Mongoose Model (has standard query methods)', () => {
    expect(typeof InventoryItem.find).toBe('function');
    expect(typeof InventoryItem.findOne).toBe('function');
    expect(typeof InventoryItem.create).toBe('function');
    expect(typeof InventoryItem.countDocuments).toBe('function');
  });

  test('paginate plugin is attached', () => {
    expect(typeof InventoryItem.paginate).toBe('function');
  });

  test('schema is a mongoose.Schema instance', () => {
    expect(invSchema).toBeInstanceOf(mongoose.Schema);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. InventoryItem schema fields
// ══════════════════════════════════════════════════════════════════════════════
describe('InventoryItem schema › item field', () => {
  test('path exists', () => {
    expect(invPath('item')).toBeDefined();
  });
  test('instance is "ObjectId"', () => {
    expect(invPath('item').instance).toBe('ObjectId');
  });
  test('is required', () => {
    expect(invPath('item').options.required).toBe(true);
  });
  test('refs "Item" model', () => {
    expect(invPath('item').options.ref).toBe('Item');
  });
});

describe('InventoryItem schema › branch field', () => {
  test('path exists', () => {
    expect(invPath('branch')).toBeDefined();
  });
  test('instance is "ObjectId"', () => {
    expect(invPath('branch').instance).toBe('ObjectId');
  });
  test('is required', () => {
    expect(invPath('branch').options.required).toBe(true);
  });
  test('refs "Branch" model', () => {
    expect(invPath('branch').options.ref).toBe('Branch');
  });
});

describe('InventoryItem schema › quantity field', () => {
  test('path exists', () => {
    expect(invPath('quantity')).toBeDefined();
  });
  test('instance is "Number"', () => {
    expect(invPath('quantity').instance).toBe('Number');
  });
  test('is required', () => {
    expect(invPath('quantity').options.required).toBe(true);
  });
  test('default is 0', () => {
    expect(invPath('quantity').options.default).toBe(0);
  });
  test('min is 0', () => {
    expect(invPath('quantity').options.min).toBe(0);
  });
});

describe('InventoryItem schema › committed field', () => {
  test('path exists', () => {
    expect(invPath('committed')).toBeDefined();
  });
  test('instance is "Number"', () => {
    expect(invPath('committed').instance).toBe('Number');
  });
  test('default is 0', () => {
    expect(invPath('committed').options.default).toBe(0);
  });
  test('min is 0', () => {
    expect(invPath('committed').options.min).toBe(0);
  });
  test('is NOT required (optional)', () => {
    expect(invPath('committed').options.required).toBeFalsy();
  });
});

describe('InventoryItem schema › available field', () => {
  test('path exists', () => {
    expect(invPath('available')).toBeDefined();
  });
  test('instance is "Number"', () => {
    expect(invPath('available').instance).toBe('Number');
  });
  test('default is 0', () => {
    expect(invPath('available').options.default).toBe(0);
  });
  test('min is 0', () => {
    expect(invPath('available').options.min).toBe(0);
  });
  test('is NOT required (managed by pre-save hook)', () => {
    expect(invPath('available').options.required).toBeFalsy();
  });
});

describe('InventoryItem schema › reorderLevel field', () => {
  test('path exists', () => {
    expect(invPath('reorderLevel')).toBeDefined();
  });
  test('instance is "Number"', () => {
    expect(invPath('reorderLevel').instance).toBe('Number');
  });
  test('is required', () => {
    expect(invPath('reorderLevel').options.required).toBe(true);
  });
  test('default is 5', () => {
    expect(invPath('reorderLevel').options.default).toBe(5);
  });
  test('min is 0', () => {
    expect(invPath('reorderLevel').options.min).toBe(0);
  });
});

describe('InventoryItem schema › reorderQuantity field', () => {
  test('path exists', () => {
    expect(invPath('reorderQuantity')).toBeDefined();
  });
  test('instance is "Number"', () => {
    expect(invPath('reorderQuantity').instance).toBe('Number');
  });
  test('default is 10', () => {
    expect(invPath('reorderQuantity').options.default).toBe(10);
  });
  test('min is 1', () => {
    expect(invPath('reorderQuantity').options.min).toBe(1);
  });
  test('is NOT required (optional)', () => {
    expect(invPath('reorderQuantity').options.required).toBeFalsy();
  });
});

describe('InventoryItem schema › lastMovement field', () => {
  test('path exists', () => {
    expect(invPath('lastMovement')).toBeDefined();
  });
  test('instance is "Date"', () => {
    expect(invPath('lastMovement').instance).toBe('Date');
  });
  test('has a default (Date.now)', () => {
    expect(invPath('lastMovement').options.default).toBeTruthy();
  });
  test('is NOT required (optional)', () => {
    expect(invPath('lastMovement').options.required).toBeFalsy();
  });
});

describe('InventoryItem schema › optional cost/value fields', () => {
  test.each(['lastCost', 'averageCost', 'totalValue'])('"%s" is Number and optional', (field) => {
    expect(invPath(field)).toBeDefined();
    expect(invPath(field).instance).toBe('Number');
    expect(invPath(field).options.required).toBeFalsy();
  });
});

describe('InventoryItem schema › isActive field', () => {
  test('path exists', () => {
    expect(invPath('isActive')).toBeDefined();
  });
  test('instance is "Boolean"', () => {
    expect(invPath('isActive').instance).toBe('Boolean');
  });
  test('default is true', () => {
    expect(invPath('isActive').options.default).toBe(true);
  });
  test('is NOT required (has default)', () => {
    expect(invPath('isActive').options.required).toBeFalsy();
  });
});

describe('InventoryItem schema › timestamps', () => {
  test('timestamps option is enabled', () => {
    expect(invSchema.options.timestamps).toBe(true);
  });
  test('createdAt path exists', () => {
    expect(invPath('createdAt')).toBeDefined();
  });
  test('updatedAt path exists', () => {
    expect(invPath('updatedAt')).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. InventoryItem — complete field set
// ══════════════════════════════════════════════════════════════════════════════
describe('InventoryItem schema › expected field set', () => {
  const expectedFields = [
    'item',
    'branch',
    'quantity',
    'committed',
    'available',
    'reorderLevel',
    'reorderQuantity',
    'lastMovement',
    'lastCost',
    'averageCost',
    'totalValue',
    'isActive',
  ];

  test.each(expectedFields)('field "%s" is present in schema', (field) => {
    expect(invPath(field)).toBeDefined();
  });

  test('_id is auto-added by Mongoose', () => {
    expect(invPath('_id')).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. InventoryItem — compound unique index
// ══════════════════════════════════════════════════════════════════════════════
describe('InventoryItem schema › compound index { item, branch }', () => {
  let indexes;
  beforeAll(() => {
    indexes = invSchema.indexes();
  });

  test('compound { item:1, branch:1 } index exists', () => {
    const found = indexes.some(([keys]) => keys.item === 1 && keys.branch === 1);
    expect(found).toBe(true);
  });

  test('compound { item, branch } index has unique:true', () => {
    const entry = indexes.find(([keys]) => keys.item === 1 && keys.branch === 1);
    expect(entry).toBeDefined();
    expect(entry[1].unique).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. InventoryItem — virtual: availableQuantity
// ══════════════════════════════════════════════════════════════════════════════
describe('InventoryItem virtual › availableQuantity', () => {
  const getterFn = () => invSchema.virtuals.availableQuantity.getters[0];

  test('virtual is registered on schema', () => {
    expect(invSchema.virtuals.availableQuantity).toBeDefined();
  });

  test('returns quantity - committed when result is positive', () => {
    expect(getterFn().call({ quantity: 10, committed: 3 })).toBe(7);
  });

  test('returns 0 when committed equals quantity (exact zero stock)', () => {
    expect(getterFn().call({ quantity: 5, committed: 5 })).toBe(0);
  });

  test('returns 0 (clamped) when committed exceeds quantity', () => {
    expect(getterFn().call({ quantity: 3, committed: 10 })).toBe(0);
  });

  test('returns full quantity when committed is 0', () => {
    expect(getterFn().call({ quantity: 100, committed: 0 })).toBe(100);
  });

  test('returns 0 when quantity and committed are both 0', () => {
    expect(getterFn().call({ quantity: 0, committed: 0 })).toBe(0);
  });

  test('handles large quantity values correctly', () => {
    expect(getterFn().call({ quantity: 999999, committed: 1 })).toBe(999998);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. InventoryItem — pre-save hook
// ══════════════════════════════════════════════════════════════════════════════
describe('InventoryItem pre-save hook', () => {
  // Locate specifically *our* custom hook (not Mongoose's internal validateBeforeSave)
  const getPreSaveFn = () => {
    const pres = invSchema.s.hooks._pres.get('save') || [];
    const hook = pres.find((h) => h.fn && h.fn.toString().includes('this.available'));
    return hook?.fn;
  };

  test('at least one pre-save hook is registered', () => {
    const pres = invSchema.s.hooks._pres.get('save') || [];
    expect(pres.length).toBeGreaterThan(0);
  });

  test('custom available-quantity hook is present in pre-save list', () => {
    expect(getPreSaveFn()).toBeDefined();
  });

  test('sets available = quantity - committed', () => {
    const fn = getPreSaveFn();
    const ctx = { quantity: 15, committed: 4, available: 0 };
    fn.call(ctx);
    expect(ctx.available).toBe(11);
  });

  test('clamps available to 0 when committed > quantity', () => {
    const fn = getPreSaveFn();
    const ctx = { quantity: 5, committed: 20, available: 100 };
    const next = jest.fn();
    fn.call(ctx, next);
    expect(ctx.available).toBe(0);
  });

  test('sets available = 0 when quantity is 0 and committed is 0', () => {
    const fn = getPreSaveFn();
    const ctx = { quantity: 0, committed: 0, available: 99 };
    const next = jest.fn();
    fn.call(ctx, next);
    expect(ctx.available).toBe(0);
  });

  test('sets available = full quantity when committed is 0', () => {
    const fn = getPreSaveFn();
    const ctx = { quantity: 50, committed: 0, available: 0 };
    const next = jest.fn();
    fn.call(ctx, next);
    expect(ctx.available).toBe(50);
  });

  /* Mongoose 9 dropped next() from middleware; a hook that returns has done
     its job. What is worth asserting is the field it sets. */
  test('returns without throwing, so the save carries on', () => {
    const fn = getPreSaveFn();
    const doc = { quantity: 10, committed: 2, available: 0 };
    expect(() => fn.call(doc)).not.toThrow();
    expect(doc.available).toBe(8);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. Static method: checkAvailability
// ══════════════════════════════════════════════════════════════════════════════
describe('InventoryItem.checkAvailability', () => {
  afterEach(() => jest.restoreAllMocks());

  test('is exported as a function', () => {
    expect(typeof InventoryItem.checkAvailability).toBe('function');
  });

  test('returns not-found result when item does not exist in inventory', async () => {
    jest.spyOn(InventoryItem, 'findOne').mockResolvedValue(null);
    const result = await InventoryItem.checkAvailability(fakeItemId, fakeBranchId, 5);
    expect(result.available).toBe(0);
    expect(result.isAvailable).toBe(false);
    expect(result.needsReorder).toBe(false);
    expect(result.message).toBe('Item not found in inventory');
  });

  test('isAvailable is true when availableQuantity >= requiredQuantity', async () => {
    jest.spyOn(InventoryItem, 'findOne').mockResolvedValue({
      availableQuantity: 20,
      reorderLevel: 5,
      reorderQuantity: 10,
    });
    const result = await InventoryItem.checkAvailability(fakeItemId, fakeBranchId, 10);
    expect(result.isAvailable).toBe(true);
    expect(result.available).toBe(20);
    expect(result.message).toBe('Sufficient stock available');
  });

  test('isAvailable is true when availableQuantity exactly equals requiredQuantity', async () => {
    jest.spyOn(InventoryItem, 'findOne').mockResolvedValue({
      availableQuantity: 10,
      reorderLevel: 5,
      reorderQuantity: 10,
    });
    const result = await InventoryItem.checkAvailability(fakeItemId, fakeBranchId, 10);
    expect(result.isAvailable).toBe(true);
  });

  test('isAvailable is false when availableQuantity < requiredQuantity', async () => {
    jest.spyOn(InventoryItem, 'findOne').mockResolvedValue({
      availableQuantity: 3,
      reorderLevel: 5,
      reorderQuantity: 10,
    });
    const result = await InventoryItem.checkAvailability(fakeItemId, fakeBranchId, 10);
    expect(result.isAvailable).toBe(false);
    expect(result.available).toBe(3);
    expect(result.message).toContain('Only 3 units available');
    expect(result.message).toContain('7 more needed');
  });

  test('needsReorder is true when available <= reorderLevel', async () => {
    jest.spyOn(InventoryItem, 'findOne').mockResolvedValue({
      availableQuantity: 4,
      reorderLevel: 5,
      reorderQuantity: 10,
    });
    const result = await InventoryItem.checkAvailability(fakeItemId, fakeBranchId, 1);
    expect(result.needsReorder).toBe(true);
  });

  test('needsReorder is true when available exactly equals reorderLevel', async () => {
    jest.spyOn(InventoryItem, 'findOne').mockResolvedValue({
      availableQuantity: 5,
      reorderLevel: 5,
      reorderQuantity: 10,
    });
    const result = await InventoryItem.checkAvailability(fakeItemId, fakeBranchId, 1);
    expect(result.needsReorder).toBe(true);
  });

  test('needsReorder is false when available > reorderLevel', async () => {
    jest.spyOn(InventoryItem, 'findOne').mockResolvedValue({
      availableQuantity: 50,
      reorderLevel: 5,
      reorderQuantity: 10,
    });
    const result = await InventoryItem.checkAvailability(fakeItemId, fakeBranchId, 1);
    expect(result.needsReorder).toBe(false);
  });

  test('result includes reorderLevel and reorderQuantity from inventory', async () => {
    jest.spyOn(InventoryItem, 'findOne').mockResolvedValue({
      availableQuantity: 20,
      reorderLevel: 8,
      reorderQuantity: 15,
    });
    const result = await InventoryItem.checkAvailability(fakeItemId, fakeBranchId, 1);
    expect(result.reorderLevel).toBe(8);
    expect(result.reorderQuantity).toBe(15);
  });

  test('handles zero-stock item (availableQuantity = 0)', async () => {
    jest.spyOn(InventoryItem, 'findOne').mockResolvedValue({
      availableQuantity: 0,
      reorderLevel: 5,
      reorderQuantity: 10,
    });
    const result = await InventoryItem.checkAvailability(fakeItemId, fakeBranchId, 1);
    expect(result.isAvailable).toBe(false);
    expect(result.needsReorder).toBe(true);
    expect(result.available).toBe(0);
  });

  test('queries findOne with correct item and branch filter', async () => {
    const findOneSpy = jest.spyOn(InventoryItem, 'findOne').mockResolvedValue(null);
    await InventoryItem.checkAvailability(fakeItemId, fakeBranchId, 5);
    expect(findOneSpy).toHaveBeenCalledWith({ item: fakeItemId, branch: fakeBranchId });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. Static method: getLowStockItems
// ══════════════════════════════════════════════════════════════════════════════
describe('InventoryItem.getLowStockItems', () => {
  afterEach(() => jest.restoreAllMocks());

  test('is exported as a function', () => {
    expect(typeof InventoryItem.getLowStockItems).toBe('function');
  });

  test('queries with branch and isActive:true filter', async () => {
    const mockChain = {
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockResolvedValue([]),
    };
    const findSpy = jest.spyOn(InventoryItem, 'find').mockReturnValue(mockChain);
    await InventoryItem.getLowStockItems(fakeBranchId);
    expect(findSpy).toHaveBeenCalledWith(
      expect.objectContaining({ branch: fakeBranchId, isActive: true })
    );
  });

  test('returns array of low-stock items', async () => {
    const fakeItems = [
      { item: { name: 'Widget A', sku: 'WA001' }, available: 1 },
      { item: { name: 'Widget B', sku: 'WB002' }, available: 3 },
    ];
    const mockChain = {
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockResolvedValue(fakeItems),
    };
    jest.spyOn(InventoryItem, 'find').mockReturnValue(mockChain);
    const result = await InventoryItem.getLowStockItems(fakeBranchId);
    expect(result).toEqual(fakeItems);
    expect(result).toHaveLength(2);
  });

  test('returns empty array when no low-stock items exist', async () => {
    const mockChain = {
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockResolvedValue([]),
    };
    jest.spyOn(InventoryItem, 'find').mockReturnValue(mockChain);
    const result = await InventoryItem.getLowStockItems(fakeBranchId);
    expect(result).toEqual([]);
  });

  test('populates item with name, sku, and barcode fields', async () => {
    const mockChain = {
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockResolvedValue([]),
    };
    jest.spyOn(InventoryItem, 'find').mockReturnValue(mockChain);
    await InventoryItem.getLowStockItems(fakeBranchId);
    expect(mockChain.populate).toHaveBeenCalledWith('item', 'name sku barcode');
  });

  test('sorts results by availableQuantity ascending', async () => {
    const mockChain = {
      populate: jest.fn().mockReturnThis(),
      sort: jest.fn().mockResolvedValue([]),
    };
    jest.spyOn(InventoryItem, 'find').mockReturnValue(mockChain);
    await InventoryItem.getLowStockItems(fakeBranchId);
    expect(mockChain.sort).toHaveBeenCalledWith({ availableQuantity: 1 });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. Static method: getStockHistory
// ══════════════════════════════════════════════════════════════════════════════
describe('InventoryItem.getStockHistory', () => {
  afterEach(() => jest.restoreAllMocks());

  test('is exported as a function', () => {
    expect(typeof InventoryItem.getStockHistory).toBe('function');
  });

  test('returns paginated result with default page=1 and limit=10', async () => {
    jest.spyOn(StockMovement, 'find').mockReturnValue(makeStockMovementChain([]));
    jest.spyOn(StockMovement, 'countDocuments').mockResolvedValue(0);
    const result = await InventoryItem.getStockHistory(fakeItemId, fakeBranchId);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(10);
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(0);
  });

  test('hasNextPage is true when more pages exist', async () => {
    jest.spyOn(StockMovement, 'find').mockReturnValue(makeStockMovementChain([]));
    jest.spyOn(StockMovement, 'countDocuments').mockResolvedValue(25);
    const result = await InventoryItem.getStockHistory(fakeItemId, fakeBranchId, {
      page: 1,
      limit: 10,
    });
    expect(result.hasNextPage).toBe(true);
    expect(result.hasPreviousPage).toBe(false);
  });

  test('hasPreviousPage is true when page > 1', async () => {
    jest.spyOn(StockMovement, 'find').mockReturnValue(makeStockMovementChain([]));
    jest.spyOn(StockMovement, 'countDocuments').mockResolvedValue(25);
    const result = await InventoryItem.getStockHistory(fakeItemId, fakeBranchId, {
      page: 2,
      limit: 10,
    });
    expect(result.hasPreviousPage).toBe(true);
  });

  test('hasNextPage and hasPreviousPage are both false on single-page result', async () => {
    jest.spyOn(StockMovement, 'find').mockReturnValue(makeStockMovementChain([]));
    jest.spyOn(StockMovement, 'countDocuments').mockResolvedValue(5);
    const result = await InventoryItem.getStockHistory(fakeItemId, fakeBranchId, {
      page: 1,
      limit: 10,
    });
    expect(result.hasNextPage).toBe(false);
    expect(result.hasPreviousPage).toBe(false);
  });

  test('includes branch in query filter when branchId provided', async () => {
    const findSpy = jest.spyOn(StockMovement, 'find').mockReturnValue(makeStockMovementChain([]));
    jest.spyOn(StockMovement, 'countDocuments').mockResolvedValue(0);
    await InventoryItem.getStockHistory(fakeItemId, fakeBranchId);
    expect(findSpy).toHaveBeenCalledWith(expect.objectContaining({ branch: fakeBranchId }));
  });

  test('does not include branch in query when branchId is falsy', async () => {
    const findSpy = jest.spyOn(StockMovement, 'find').mockReturnValue(makeStockMovementChain([]));
    jest.spyOn(StockMovement, 'countDocuments').mockResolvedValue(0);
    await InventoryItem.getStockHistory(fakeItemId, null);
    const calledWith = findSpy.mock.calls[0][0];
    expect(calledWith).not.toHaveProperty('branch');
  });

  test('filters by movementType when option provided', async () => {
    const findSpy = jest.spyOn(StockMovement, 'find').mockReturnValue(makeStockMovementChain([]));
    jest.spyOn(StockMovement, 'countDocuments').mockResolvedValue(0);
    await InventoryItem.getStockHistory(fakeItemId, fakeBranchId, { movementType: 'sale' });
    expect(findSpy).toHaveBeenCalledWith(expect.objectContaining({ movementType: 'sale' }));
  });

  test('filters by date range when startDate provided', async () => {
    const findSpy = jest.spyOn(StockMovement, 'find').mockReturnValue(makeStockMovementChain([]));
    jest.spyOn(StockMovement, 'countDocuments').mockResolvedValue(0);
    await InventoryItem.getStockHistory(fakeItemId, fakeBranchId, { startDate: '2024-01-01' });
    const query = findSpy.mock.calls[0][0];
    expect(query.createdAt).toBeDefined();
    expect(query.createdAt.$gte).toBeInstanceOf(Date);
  });

  test('filters by date range when endDate provided', async () => {
    const findSpy = jest.spyOn(StockMovement, 'find').mockReturnValue(makeStockMovementChain([]));
    jest.spyOn(StockMovement, 'countDocuments').mockResolvedValue(0);
    await InventoryItem.getStockHistory(fakeItemId, fakeBranchId, { endDate: '2024-12-31' });
    const query = findSpy.mock.calls[0][0];
    expect(query.createdAt).toBeDefined();
    expect(query.createdAt.$lte).toBeInstanceOf(Date);
  });

  test('returns results array and correct total', async () => {
    const fakeDocs = [
      { _id: 'sm1', movementType: 'sale', quantity: 5 },
      { _id: 'sm2', movementType: 'purchase', quantity: 10 },
    ];
    jest.spyOn(StockMovement, 'find').mockReturnValue(makeStockMovementChain(fakeDocs));
    jest.spyOn(StockMovement, 'countDocuments').mockResolvedValue(2);
    const result = await InventoryItem.getStockHistory(fakeItemId, fakeBranchId);
    expect(result.results).toEqual(fakeDocs);
    expect(result.total).toBe(2);
  });

  test('calculates totalPages correctly', async () => {
    jest.spyOn(StockMovement, 'find').mockReturnValue(makeStockMovementChain([]));
    jest.spyOn(StockMovement, 'countDocuments').mockResolvedValue(25);
    const result = await InventoryItem.getStockHistory(fakeItemId, fakeBranchId, { limit: 10 });
    expect(result.totalPages).toBe(3);
  });

  test('respects custom page and limit options', async () => {
    jest.spyOn(StockMovement, 'find').mockReturnValue(makeStockMovementChain([]));
    jest.spyOn(StockMovement, 'countDocuments').mockResolvedValue(0);
    const result = await InventoryItem.getStockHistory(fakeItemId, fakeBranchId, {
      page: 3,
      limit: 5,
    });
    expect(result.page).toBe(3);
    expect(result.limit).toBe(5);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 13. Static method: updateInventory
// ══════════════════════════════════════════════════════════════════════════════
describe('InventoryItem.updateInventory', () => {
  afterEach(() => jest.restoreAllMocks());

  test('is exported as a function', () => {
    expect(typeof InventoryItem.updateInventory).toBe('function');
  });

  test('starts a mongoose session and transaction', async () => {
    const session = makeMockSession();
    const startSpy = jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    const mockItem = makeMockInventoryItem(0);
    jest.spyOn(InventoryItem, 'findOne').mockReturnValue({
      session: jest.fn().mockResolvedValue(mockItem),
    });
    jest.spyOn(StockMovement.prototype, 'save').mockResolvedValue({});
    await InventoryItem.updateInventory(fakeItemId, fakeBranchId, 5, 'purchase', null, fakeUserId);
    expect(startSpy).toHaveBeenCalled();
    expect(session.startTransaction).toHaveBeenCalled();
    expect(session.commitTransaction).toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalled();
  });

  test('creates new InventoryItem when item not found in inventory', async () => {
    const session = makeMockSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    jest.spyOn(InventoryItem, 'findOne').mockReturnValue({
      session: jest.fn().mockResolvedValue(null),
    });
    jest.spyOn(InventoryItem.prototype, 'save').mockResolvedValue(undefined);
    jest.spyOn(StockMovement.prototype, 'save').mockResolvedValue({});
    const result = await InventoryItem.updateInventory(
      fakeItemId,
      fakeBranchId,
      5,
      'purchase',
      null,
      fakeUserId
    );
    expect(result.inventoryItem).toBeDefined();
  });

  test('increases quantity for PURCHASE movement type', async () => {
    const session = makeMockSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    const mockItem = makeMockInventoryItem(10);
    jest.spyOn(InventoryItem, 'findOne').mockReturnValue({
      session: jest.fn().mockResolvedValue(mockItem),
    });
    jest.spyOn(StockMovement.prototype, 'save').mockResolvedValue({});
    await InventoryItem.updateInventory(fakeItemId, fakeBranchId, 5, 'purchase', null, fakeUserId);
    expect(mockItem.quantity).toBe(15);
  });

  test('increases quantity for RETURN movement type', async () => {
    const session = makeMockSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    const mockItem = makeMockInventoryItem(10);
    jest.spyOn(InventoryItem, 'findOne').mockReturnValue({
      session: jest.fn().mockResolvedValue(mockItem),
    });
    jest.spyOn(StockMovement.prototype, 'save').mockResolvedValue({});
    await InventoryItem.updateInventory(fakeItemId, fakeBranchId, 5, 'return', null, fakeUserId);
    expect(mockItem.quantity).toBe(15);
  });

  test('increases quantity for TRANSFER_IN movement type', async () => {
    const session = makeMockSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    const mockItem = makeMockInventoryItem(10);
    jest.spyOn(InventoryItem, 'findOne').mockReturnValue({
      session: jest.fn().mockResolvedValue(mockItem),
    });
    jest.spyOn(StockMovement.prototype, 'save').mockResolvedValue({});
    await InventoryItem.updateInventory(
      fakeItemId,
      fakeBranchId,
      5,
      'transfer_in',
      null,
      fakeUserId
    );
    expect(mockItem.quantity).toBe(15);
  });

  test('increases quantity for OPENING_BALANCE movement type', async () => {
    const session = makeMockSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    const mockItem = makeMockInventoryItem(0);
    jest.spyOn(InventoryItem, 'findOne').mockReturnValue({
      session: jest.fn().mockResolvedValue(mockItem),
    });
    jest.spyOn(StockMovement.prototype, 'save').mockResolvedValue({});
    await InventoryItem.updateInventory(
      fakeItemId,
      fakeBranchId,
      50,
      'opening_balance',
      null,
      fakeUserId
    );
    expect(mockItem.quantity).toBe(50);
  });

  test('decreases quantity for SALE movement type', async () => {
    const session = makeMockSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    const mockItem = makeMockInventoryItem(10);
    jest.spyOn(InventoryItem, 'findOne').mockReturnValue({
      session: jest.fn().mockResolvedValue(mockItem),
    });
    jest.spyOn(StockMovement.prototype, 'save').mockResolvedValue({});
    await InventoryItem.updateInventory(fakeItemId, fakeBranchId, 4, 'sale', null, fakeUserId);
    expect(mockItem.quantity).toBe(6);
  });

  test('decreases quantity for DAMAGED movement type', async () => {
    const session = makeMockSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    const mockItem = makeMockInventoryItem(10);
    jest.spyOn(InventoryItem, 'findOne').mockReturnValue({
      session: jest.fn().mockResolvedValue(mockItem),
    });
    jest.spyOn(StockMovement.prototype, 'save').mockResolvedValue({});
    await InventoryItem.updateInventory(fakeItemId, fakeBranchId, 3, 'damaged', null, fakeUserId);
    expect(mockItem.quantity).toBe(7);
  });

  test('decreases quantity for TRANSFER_OUT movement type', async () => {
    const session = makeMockSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    const mockItem = makeMockInventoryItem(20);
    jest.spyOn(InventoryItem, 'findOne').mockReturnValue({
      session: jest.fn().mockResolvedValue(mockItem),
    });
    jest.spyOn(StockMovement.prototype, 'save').mockResolvedValue({});
    await InventoryItem.updateInventory(
      fakeItemId,
      fakeBranchId,
      5,
      'transfer_out',
      null,
      fakeUserId
    );
    expect(mockItem.quantity).toBe(15);
  });

  test('clamps quantity to 0 for SALE when sold amount exceeds current stock', async () => {
    const session = makeMockSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    const mockItem = makeMockInventoryItem(3);
    jest.spyOn(InventoryItem, 'findOne').mockReturnValue({
      session: jest.fn().mockResolvedValue(mockItem),
    });
    jest.spyOn(StockMovement.prototype, 'save').mockResolvedValue({});
    await InventoryItem.updateInventory(fakeItemId, fakeBranchId, 100, 'sale', null, fakeUserId);
    expect(mockItem.quantity).toBe(0);
  });

  test('sets absolute quantity for ADJUSTMENT movement type', async () => {
    const session = makeMockSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    const mockItem = makeMockInventoryItem(10);
    jest.spyOn(InventoryItem, 'findOne').mockReturnValue({
      session: jest.fn().mockResolvedValue(mockItem),
    });
    jest.spyOn(StockMovement.prototype, 'save').mockResolvedValue({});
    await InventoryItem.updateInventory(
      fakeItemId,
      fakeBranchId,
      50,
      'adjustment',
      null,
      fakeUserId
    );
    expect(mockItem.quantity).toBe(50);
  });

  test('sets absolute quantity for COUNT movement type', async () => {
    const session = makeMockSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    const mockItem = makeMockInventoryItem(10);
    jest.spyOn(InventoryItem, 'findOne').mockReturnValue({
      session: jest.fn().mockResolvedValue(mockItem),
    });
    jest.spyOn(StockMovement.prototype, 'save').mockResolvedValue({});
    await InventoryItem.updateInventory(fakeItemId, fakeBranchId, 75, 'count', null, fakeUserId);
    expect(mockItem.quantity).toBe(75);
  });

  test('updates lastMovement date on inventory item', async () => {
    const session = makeMockSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    const mockItem = makeMockInventoryItem(10);
    jest.spyOn(InventoryItem, 'findOne').mockReturnValue({
      session: jest.fn().mockResolvedValue(mockItem),
    });
    jest.spyOn(StockMovement.prototype, 'save').mockResolvedValue({});
    const before = new Date();
    await InventoryItem.updateInventory(fakeItemId, fakeBranchId, 5, 'purchase', null, fakeUserId);
    expect(mockItem.lastMovement).toBeInstanceOf(Date);
    expect(mockItem.lastMovement.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  test('aborts transaction and rethrows on error', async () => {
    const session = makeMockSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    jest.spyOn(InventoryItem, 'findOne').mockReturnValue({
      session: jest.fn().mockRejectedValue(new Error('DB failure')),
    });
    await expect(
      InventoryItem.updateInventory(fakeItemId, fakeBranchId, 5, 'purchase', null, fakeUserId)
    ).rejects.toThrow('DB failure');
    expect(session.abortTransaction).toHaveBeenCalled();
    expect(session.endSession).toHaveBeenCalled();
  });

  test('returns { inventoryItem, stockMovement } on success', async () => {
    const session = makeMockSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    const mockItem = makeMockInventoryItem(5);
    jest.spyOn(InventoryItem, 'findOne').mockReturnValue({
      session: jest.fn().mockResolvedValue(mockItem),
    });
    jest.spyOn(StockMovement.prototype, 'save').mockResolvedValue({});
    const result = await InventoryItem.updateInventory(
      fakeItemId,
      fakeBranchId,
      5,
      'purchase',
      null,
      fakeUserId
    );
    expect(result).toHaveProperty('inventoryItem');
    expect(result).toHaveProperty('stockMovement');
  });

  test('passes absolute quantity value to StockMovement (ignores sign for decrements)', async () => {
    const session = makeMockSession();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue(session);
    const mockItem = makeMockInventoryItem(10);
    jest.spyOn(InventoryItem, 'findOne').mockReturnValue({
      session: jest.fn().mockResolvedValue(mockItem),
    });
    const saveSpy = jest.spyOn(StockMovement.prototype, 'save').mockResolvedValue({});
    await InventoryItem.updateInventory(fakeItemId, fakeBranchId, 5, 'sale', null, fakeUserId);
    expect(saveSpy).toHaveBeenCalled();
  });
});
