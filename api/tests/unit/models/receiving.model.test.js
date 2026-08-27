'use strict';

/**
 * Unit tests for src/models/receiving.model.js
 *
 * File confirmed : src/models/receiving.model.js (sole Mongoose schema for receivings)
 * Similar files  : receiving-return.model.js (native-driver helper — already tested)
 *                  receiving.model.js.backup (ignored backup)
 * Type           : Mongoose schema model — exports Receiving (mongoose.model("Receiving", ...))
 * ORM            : Mongoose (MongoDB)
 *
 * Schema components:
 *   receivingItemSchema — embedded sub-schema (item, quantity, cost_price, selling_price, total)
 *   receivingSchema     — main schema (strict:false, timestamps createdAt→created_at, updatedAt→updated_at)
 *
 * Plugins : toJSON, paginate
 *
 * Hooks:
 *   pre("validate") — generates receiving_id / receiving_number using branch prefix + sequence
 *                     sets receiving_status based on status field
 *   post("save")    — updates Item.quantity + Supplier.balance when status="received"
 *
 * Static methods (last definition wins when duplicated):
 *   pendingReceivingReportPage, pendingSupplierReportPage,
 *   returnReceivingReportPage, returnReceivingProductReportPage,
 *   deleteReceivingCollectionData (defined TWICE — line 789 + 2121; line 2121 wins),
 *   exportReceivingsOrder        (defined TWICE — line 834 + 2286; line 2286 wins),
 *   productBasedReceivingReturnReportPage, supplierReceivingReportPage,
 *   receivingReportPage, receivingsGraphicalReports,
 *   getReceivingOrder, receivingInsertUpdate,
 *   returnPrintDetailsPage, gstNineReportPage,
 *   returnReceivingOrder (from receiving-return.model.js, attached at line 2562)
 *
 * Strategy:
 *   Section 1-11 : Pure schema inspection — no DB, no mocks needed
 *   Section 12   : Pre-validate hook — Branch.findOne + this.constructor.find mocked
 *   Section 13   : Post-save hook    — mongoose.model('Item'/'Supplier') spied
 *   Section 14+  : Static methods    — BaseModel.prototype.getCollection spied
 *                                      Receiving.aggregate spied where methods use it directly
 *
 * Production note: Two statics (deleteReceivingCollectionData, exportReceivingsOrder)
 *   are defined twice. The second definition overwrites the first and is the active code.
 *   The second delete/export implementations do NOT include the "empty array" / "no valid IDs"
 *   short-circuit guard present in the first definitions.
 */

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
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
    static currentTimeZone = 'Asia/Kolkata';

    static async deletedDocumentBackup() {
      return { status: true };
    }

    constructor(collectionName) {
      this.collectionName = collectionName;
    }

    async getCollection() {
      return null;
    }

    startingDate(d) {
      return d ? new Date(d) : new Date(0);
    }
    endingDate(d) {
      const dt = d ? new Date(d) : new Date();
      dt.setHours(23, 59, 59, 999);
      return dt;
    }
  }
  return MockBaseModel;
});

jest.mock('../../../src/models/branch.model', () => ({
  BranchModel: { findOne: jest.fn() },
}));

jest.mock('../../../src/models/supplier.model', () => ({}));

// ─── Imports ──────────────────────────────────────────────────────────────────
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
const Receiving = require('../../../src/models/receiving.model');
const MockBaseModel = require('../../../src/models/base.model');
const { BranchModel: MockBranch } = require('../../../src/models/branch.model');

// ─── Schema path helpers ──────────────────────────────────────────────────────
const schema = Receiving.schema;
const p = (name) => schema.path(name);
const itemPath = schema.path('items');
const itemSch = itemPath.schema;
const ip = (name) => itemSch.path(name);

// ─── Hook extraction helpers ──────────────────────────────────────────────────
function getLastPreHook(sch, event) {
  const list = sch.s?.hooks?._pres?.get(event) || [];
  const fns = list.filter((h) => typeof h.fn === 'function');
  return fns.length ? fns[fns.length - 1].fn : null;
}

function getFirstPostHook(sch, event) {
  const list = sch.s?.hooks?._posts?.get(event) || [];
  const fns = list.filter((h) => typeof h.fn === 'function');
  return fns.length ? fns[0].fn : null;
}

// ─── Collection mock factory ──────────────────────────────────────────────────
function makeColl(overrides = {}) {
  const emptyCursor = {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue([]),
  };
  return {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockReturnValue(emptyCursor),
    aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    insertOne: jest.fn().mockResolvedValue({ insertedId: new ObjectId() }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    countDocuments: jest.fn().mockResolvedValue(0),
    ...overrides,
  };
}

// ─── Shared fake IDs ──────────────────────────────────────────────────────────
const fakeBranchId = new ObjectId().toHexString();
const fakeLicenseId = new ObjectId().toHexString();
const fakeUserId = new ObjectId().toHexString();
const fakeItemId = new ObjectId().toHexString();
const fakeSupplierId = new ObjectId().toHexString();

// ─── Global reset ─────────────────────────────────────────────────────────────
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
  MockBaseModel.currentTimeZone = 'Asia/Kolkata';

  MockBranch.findOne.mockReset();
  MockBranch.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. Model identity
// ══════════════════════════════════════════════════════════════════════════════
describe('Receiving — model identity', () => {
  test('exports a Mongoose model constructor', () => {
    expect(typeof Receiving).toBe('function');
  });

  test('modelName is "Receiving"', () => {
    expect(Receiving.modelName).toBe('Receiving');
  });

  test('schema is a mongoose.Schema instance', () => {
    expect(schema).toBeInstanceOf(mongoose.Schema);
  });

  test('is registered in mongoose.models as "Receiving"', () => {
    expect(mongoose.models.Receiving).toBeDefined();
  });

  test('paginate static method exists (paginate plugin applied)', () => {
    expect(typeof Receiving.paginate).toBe('function');
  });

  test('returnReceivingOrder is attached from receiving-return.model.js', () => {
    expect(typeof Receiving.returnReceivingOrder).toBe('function');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. receivingItemSchema — field existence
// ══════════════════════════════════════════════════════════════════════════════
describe('receivingItemSchema — field paths exist', () => {
  test('item path exists', () => {
    expect(ip('item')).toBeDefined();
  });
  test('quantity path exists', () => {
    expect(ip('quantity')).toBeDefined();
  });
  test('cost_price path exists', () => {
    expect(ip('cost_price')).toBeDefined();
  });
  test('selling_price path exists', () => {
    expect(ip('selling_price')).toBeDefined();
  });
  test('total path exists', () => {
    expect(ip('total')).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. receivingItemSchema — item field
// ══════════════════════════════════════════════════════════════════════════════
describe('receivingItemSchema — item field', () => {
  test('item instance is "ObjectId"', () => {
    expect(ip('item').instance).toBe('ObjectId');
  });
  test('item refs "Item" model', () => {
    expect(ip('item').options.ref).toBe('Item');
  });
  test('item is required', () => {
    expect(ip('item').options.required).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. receivingItemSchema — quantity field
// ══════════════════════════════════════════════════════════════════════════════
describe('receivingItemSchema — quantity field', () => {
  test('quantity instance is "Number"', () => {
    expect(ip('quantity').instance).toBe('Number');
  });
  test('quantity is required', () => {
    expect(ip('quantity').options.required).toBe(true);
  });
  // A gram, not a unit. This asserted 1, which is one whole kilo for stock
  // bought by weight - 2.5kg of tomatoes is an ordinary delivery. Still above
  // zero, so an empty line is still refused.
  test('quantity min is a gram, so a weight is accepted', () => {
    expect(ip('quantity').options.min).toBe(0.001);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. receivingItemSchema — cost_price field
// ══════════════════════════════════════════════════════════════════════════════
describe('receivingItemSchema — cost_price field', () => {
  test('cost_price instance is "Number"', () => {
    expect(ip('cost_price').instance).toBe('Number');
  });
  test('cost_price is required', () => {
    expect(ip('cost_price').options.required).toBe(true);
  });
  test('cost_price min is 0 (allows zero cost)', () => {
    expect(ip('cost_price').options.min).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. receivingItemSchema — selling_price field
// ══════════════════════════════════════════════════════════════════════════════
describe('receivingItemSchema — selling_price field', () => {
  test('selling_price instance is "Number"', () => {
    expect(ip('selling_price').instance).toBe('Number');
  });
  test('selling_price is required', () => {
    expect(ip('selling_price').options.required).toBe(true);
  });
  test('selling_price min is 0', () => {
    expect(ip('selling_price').options.min).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. receivingItemSchema — total field
// ══════════════════════════════════════════════════════════════════════════════
describe('receivingItemSchema — total field', () => {
  test('total instance is "Number"', () => {
    expect(ip('total').instance).toBe('Number');
  });
  test('total is required', () => {
    expect(ip('total').options.required).toBe(true);
  });
  test('total min is 0', () => {
    expect(ip('total').options.min).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. receivingSchema — identifier fields
// ══════════════════════════════════════════════════════════════════════════════
describe('Receiving schema — receiving_id field', () => {
  test('path exists', () => {
    expect(p('receiving_id')).toBeDefined();
  });
  test('instance is "String"', () => {
    expect(p('receiving_id').instance).toBe('String');
  });
  test('has unique:true', () => {
    expect(p('receiving_id').options.unique).toBe(true);
  });
  test('is NOT required (generated by hook)', () => {
    expect(p('receiving_id').options.required).toBeFalsy();
  });
});

describe('Receiving schema — receiving_number field', () => {
  test('path exists', () => {
    expect(p('receiving_number')).toBeDefined();
  });
  test('instance is "String"', () => {
    expect(p('receiving_number').instance).toBe('String');
  });
  test('has unique:true', () => {
    expect(p('receiving_number').options.unique).toBe(true);
  });
  test('is NOT required (generated by hook)', () => {
    expect(p('receiving_number').options.required).toBeFalsy();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. receivingSchema — supplier field
// ══════════════════════════════════════════════════════════════════════════════
describe('Receiving schema — supplier field', () => {
  test('path exists', () => {
    expect(p('supplier')).toBeDefined();
  });
  test('instance is "ObjectId"', () => {
    expect(p('supplier').instance).toBe('ObjectId');
  });
  test('refs "Supplier" model', () => {
    expect(p('supplier').options.ref).toBe('Supplier');
  });
  test('is required', () => {
    expect(p('supplier').options.required).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. receivingSchema — items array
// ══════════════════════════════════════════════════════════════════════════════
describe('Receiving schema — items field', () => {
  test('path exists', () => {
    expect(p('items')).toBeDefined();
  });
  test('is a DocumentArray (Array instance)', () => {
    expect(p('items').instance).toBe('Array');
  });
  test('sub-schema has all 5 item paths', () => {
    const paths = Object.keys(itemSch.paths).filter((k) => !k.startsWith('_'));
    ['item', 'quantity', 'cost_price', 'selling_price', 'total'].forEach((f) => {
      expect(paths).toContain(f);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. receivingSchema — financial fields
// ══════════════════════════════════════════════════════════════════════════════
describe('Receiving schema — subtotal field', () => {
  test('path exists', () => {
    expect(p('subtotal')).toBeDefined();
  });
  test('instance is "Number"', () => {
    expect(p('subtotal').instance).toBe('Number');
  });
  test('is required', () => {
    expect(p('subtotal').options.required).toBe(true);
  });
  test('min is 0', () => {
    expect(p('subtotal').options.min).toBe(0);
  });
});

describe('Receiving schema — tax field', () => {
  test('path exists', () => {
    expect(p('tax')).toBeDefined();
  });
  test('instance is "Number"', () => {
    expect(p('tax').instance).toBe('Number');
  });
  test('default is 0', () => {
    expect(p('tax').options.default).toBe(0);
  });
  test('is NOT required', () => {
    expect(p('tax').options.required).toBeFalsy();
  });
});

describe('Receiving schema — discount field', () => {
  test('path exists', () => {
    expect(p('discount')).toBeDefined();
  });
  test('instance is "Number"', () => {
    expect(p('discount').instance).toBe('Number');
  });
  test('default is 0', () => {
    expect(p('discount').options.default).toBe(0);
  });
  test('is NOT required', () => {
    expect(p('discount').options.required).toBeFalsy();
  });
});

describe('Receiving schema — total field', () => {
  test('path exists', () => {
    expect(p('total')).toBeDefined();
  });
  test('instance is "Number"', () => {
    expect(p('total').instance).toBe('Number');
  });
  test('is required', () => {
    expect(p('total').options.required).toBe(true);
  });
  test('min is 0', () => {
    expect(p('total').options.min).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. receivingSchema — status fields
// ══════════════════════════════════════════════════════════════════════════════
describe('Receiving schema — receiving_status field', () => {
  test('path exists', () => {
    expect(p('receiving_status')).toBeDefined();
  });
  test('instance is "String"', () => {
    expect(p('receiving_status').instance).toBe('String');
  });
  test('default is "Open"', () => {
    expect(p('receiving_status').options.default).toBe('Open');
  });
  test('has no enum constraint (open string for PHP compat)', () => {
    expect(p('receiving_status').enumValues).toHaveLength(0);
  });
});

describe('Receiving schema — status field', () => {
  test('path exists', () => {
    expect(p('status')).toBeDefined();
  });
  test('instance is "String"', () => {
    expect(p('status').instance).toBe('String');
  });
  test('default is "draft"', () => {
    expect(p('status').options.default).toBe('draft');
  });
  test('enum includes "draft"', () => {
    expect(p('status').enumValues).toContain('draft');
  });
  test('enum includes "received"', () => {
    expect(p('status').enumValues).toContain('received');
  });
  test('enum includes "cancelled"', () => {
    expect(p('status').enumValues).toContain('cancelled');
  });
  test('enum has exactly 3 values', () => {
    expect(p('status').enumValues).toHaveLength(3);
  });
});

describe('Receiving schema — payment_status field', () => {
  test('path exists', () => {
    expect(p('payment_status')).toBeDefined();
  });
  test('instance is "String"', () => {
    expect(p('payment_status').instance).toBe('String');
  });
  test('default is "pending"', () => {
    expect(p('payment_status').options.default).toBe('pending');
  });
  test('enum includes "pending"', () => {
    expect(p('payment_status').enumValues).toContain('pending');
  });
  test('enum includes "partial"', () => {
    expect(p('payment_status').enumValues).toContain('partial');
  });
  test('enum includes "paid"', () => {
    expect(p('payment_status').enumValues).toContain('paid');
  });
  test('enum has exactly 3 values', () => {
    expect(p('payment_status').enumValues).toHaveLength(3);
  });
});

describe('Receiving schema — payment_method field', () => {
  test('path exists', () => {
    expect(p('payment_method')).toBeDefined();
  });
  test('instance is "String"', () => {
    expect(p('payment_method').instance).toBe('String');
  });
  test('default is "cash"', () => {
    expect(p('payment_method').options.default).toBe('cash');
  });
  test('enum includes "cash"', () => {
    expect(p('payment_method').enumValues).toContain('cash');
  });
  test('enum includes "credit"', () => {
    expect(p('payment_method').enumValues).toContain('credit');
  });
  test('enum includes "bank_transfer"', () => {
    expect(p('payment_method').enumValues).toContain('bank_transfer');
  });
  test('enum includes "cheque"', () => {
    expect(p('payment_method').enumValues).toContain('cheque');
  });
  test('enum includes "other"', () => {
    expect(p('payment_method').enumValues).toContain('other');
  });
  test('enum has exactly 5 values', () => {
    expect(p('payment_method').enumValues).toHaveLength(5);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 13. receivingSchema — optional metadata fields
// ══════════════════════════════════════════════════════════════════════════════
describe('Receiving schema — payment_due_date field', () => {
  test('path exists', () => {
    expect(p('payment_due_date')).toBeDefined();
  });
  test('instance is "Date"', () => {
    expect(p('payment_due_date').instance).toBe('Date');
  });
  test('is NOT required', () => {
    expect(p('payment_due_date').options.required).toBeFalsy();
  });
});

describe('Receiving schema — notes field', () => {
  test('path exists', () => {
    expect(p('notes')).toBeDefined();
  });
  test('instance is "String"', () => {
    expect(p('notes').instance).toBe('String');
  });
  test('is NOT required', () => {
    expect(p('notes').options.required).toBeFalsy();
  });
});

describe('Receiving schema — created_by field', () => {
  test('path exists', () => {
    expect(p('created_by')).toBeDefined();
  });
  test('instance is "ObjectId"', () => {
    expect(p('created_by').instance).toBe('ObjectId');
  });
  test('refs "User" model', () => {
    expect(p('created_by').options.ref).toBe('User');
  });
  test('is required', () => {
    expect(p('created_by').options.required).toBe(true);
  });
});

describe('Receiving schema — updated_by field', () => {
  test('path exists', () => {
    expect(p('updated_by')).toBeDefined();
  });
  test('instance is "ObjectId"', () => {
    expect(p('updated_by').instance).toBe('ObjectId');
  });
  test('refs "User" model', () => {
    expect(p('updated_by').options.ref).toBe('User');
  });
  test('is NOT required', () => {
    expect(p('updated_by').options.required).toBeFalsy();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 14. Schema options
// ══════════════════════════════════════════════════════════════════════════════
describe('Receiving schema — options', () => {
  test('timestamps.createdAt alias is "created_at"', () => {
    expect(schema.options.timestamps?.createdAt).toBe('created_at');
  });
  test('timestamps.updatedAt alias is "updated_at"', () => {
    expect(schema.options.timestamps?.updatedAt).toBe('updated_at');
  });
  test('"created_at" path added by timestamps plugin', () => {
    expect(p('created_at')).toBeDefined();
  });
  test('"updated_at" path added by timestamps plugin', () => {
    expect(p('updated_at')).toBeDefined();
  });
  test('strict is false (legacy PHP fields stored without error)', () => {
    expect(schema.options.strict).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 15. Plugins
// ══════════════════════════════════════════════════════════════════════════════
describe('Receiving schema — plugins', () => {
  test('paginate static method is present', () => {
    expect(typeof Receiving.paginate).toBe('function');
  });
  test('toJSON is defined in schema options', () => {
    expect(schema.options.toJSON).toBeDefined();
  });
  test('toJSON.transform is a function', () => {
    expect(typeof schema.options.toJSON?.transform).toBe('function');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 16. Pre-validate hook
// ══════════════════════════════════════════════════════════════════════════════
describe('Receiving — pre("validate") hook', () => {
  const hook = getLastPreHook(schema, 'validate');

  function makeFakeDoc(overrides = {}) {
    return {
      isNew: true,
      receiving_id: null,
      receiving_number: null,
      status: 'draft',
      receiving_status: null,
      branch_id: null,
      license_id: null,
      constructor: {
        find: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          lean: jest.fn().mockResolvedValue([]),
        }),
      },
      ...overrides,
    };
  }

  test('hook function is defined on schema', () => {
    expect(typeof hook).toBe('function');
  });

  test('skips generation when doc is not new and already has receiving_id', async () => {
    const next = jest.fn();
    const doc = makeFakeDoc({
      isNew: false,
      receiving_id: 'RID000001',
      receiving_number: 'RID000001',
    });
    await hook.call(doc);
    expect(doc.receiving_id).toBe('RID000001');
  });

  test('assigns receiving_id and receiving_number on new document', async () => {
    const next = jest.fn();
    MockBaseModel.currentBranch = null;
    const doc = makeFakeDoc();
    await hook.call(doc);
    expect(typeof doc.receiving_id).toBe('string');
    expect(doc.receiving_id).toBe(doc.receiving_number);
  });

  test('uses "RID" prefix when no branch is set', async () => {
    const next = jest.fn();
    MockBaseModel.currentBranch = null;
    const doc = makeFakeDoc();
    await hook.call(doc);
    expect(doc.receiving_id).toMatch(/^RID/);
  });

  test('defaults to "000001" increment when no previous docs exist', async () => {
    const next = jest.fn();
    MockBaseModel.currentBranch = null;
    const doc = makeFakeDoc();
    await hook.call(doc);
    expect(doc.receiving_id).toBe('RID000001');
  });

  test('uses branch.receiving_prefix from branchDoc when available', async () => {
    MockBranch.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ receiving_prefix: 'PUR' }),
    });
    const next = jest.fn();
    MockBaseModel.currentBranch = fakeBranchId;
    const doc = makeFakeDoc();
    await hook.call(doc);
    expect(doc.receiving_id).toMatch(/^PUR/);
  });

  test('falls back to "RID" when branch.receiving_prefix is empty string', async () => {
    MockBranch.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ receiving_prefix: '  ' }),
    });
    const next = jest.fn();
    MockBaseModel.currentBranch = fakeBranchId;
    const doc = makeFakeDoc();
    await hook.call(doc);
    expect(doc.receiving_id).toMatch(/^RID/);
  });

  test('increments numeric part from last receiving_id', async () => {
    const next = jest.fn();
    MockBaseModel.currentBranch = null;
    const doc = makeFakeDoc({
      constructor: {
        find: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          lean: jest.fn().mockResolvedValue([{ receiving_id: 'RID000007' }]),
        }),
      },
    });
    await hook.call(doc);
    expect(doc.receiving_id).toBe('RID000008');
  });

  test('zero-pads increment to 6 digits', async () => {
    const next = jest.fn();
    MockBaseModel.currentBranch = null;
    const doc = makeFakeDoc({
      constructor: {
        find: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          lean: jest.fn().mockResolvedValue([{ receiving_id: 'RID000099' }]),
        }),
      },
    });
    await hook.call(doc);
    expect(doc.receiving_id).toBe('RID000100');
    expect(doc.receiving_id.replace(/^RID/, '')).toHaveLength(6);
  });

  test('sets receiving_status="Open" for status="draft"', async () => {
    const next = jest.fn();
    MockBaseModel.currentBranch = null;
    const doc = makeFakeDoc({ status: 'draft' });
    await hook.call(doc);
    expect(doc.receiving_status).toBe('Open');
  });

  test('sets receiving_status="Received" for status="received"', async () => {
    const next = jest.fn();
    MockBaseModel.currentBranch = null;
    const doc = makeFakeDoc({ status: 'received' });
    await hook.call(doc);
    expect(doc.receiving_status).toBe('Received');
  });

  test('sets receiving_status="Cancelled" for status="cancelled"', async () => {
    const next = jest.fn();
    MockBaseModel.currentBranch = null;
    const doc = makeFakeDoc({ status: 'cancelled' });
    await hook.call(doc);
    expect(doc.receiving_status).toBe('Cancelled');
  });

  test('preserves existing receiving_status when already set', async () => {
    const next = jest.fn();
    MockBaseModel.currentBranch = null;
    const doc = makeFakeDoc({ receiving_status: 'PartialReturn', status: 'received' });
    await hook.call(doc);
    expect(doc.receiving_status).toBe('PartialReturn');
  });

  /* Mongoose 9 dropped next() from middleware: a hook resolves to carry on and
     rejects to fail the save. */
  test('resolves rather than rejecting on success', async () => {
    MockBaseModel.currentBranch = null;
    await expect(hook.call(makeFakeDoc())).resolves.toBeUndefined();
  });

  test('does not overwrite receiving_id when it is already set on new doc', async () => {
    const next = jest.fn();
    MockBaseModel.currentBranch = null;
    const doc = makeFakeDoc({ receiving_id: 'EXISTING001', receiving_number: 'EXISTING001' });
    await hook.call(doc);
    expect(doc.receiving_id).toBe('EXISTING001');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 17. Post-save hook
// ══════════════════════════════════════════════════════════════════════════════
describe('Receiving — post("save") hook', () => {
  const hook = getFirstPostHook(schema, 'save');

  test('hook function is defined on schema', () => {
    expect(typeof hook).toBe('function');
  });

  test('does nothing when doc.status is "draft" (not "received")', async () => {
    const mockFindByIdAndUpdate = jest.fn();
    jest.spyOn(mongoose, 'model').mockReturnValue({ findByIdAndUpdate: mockFindByIdAndUpdate });
    const doc = {
      status: 'draft',
      items: [{ item: fakeItemId, quantity: 2, cost_price: 100, selling_price: 150 }],
      payment_status: 'pending',
      supplier: fakeSupplierId,
      total: 200,
    };
    await hook.call({}, doc);
    expect(mockFindByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('does nothing when doc.status is "cancelled"', async () => {
    const mockFindByIdAndUpdate = jest.fn();
    jest.spyOn(mongoose, 'model').mockReturnValue({ findByIdAndUpdate: mockFindByIdAndUpdate });
    const doc = {
      status: 'cancelled',
      items: [],
      payment_status: 'pending',
      supplier: fakeSupplierId,
      total: 0,
    };
    await hook.call({}, doc);
    expect(mockFindByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('calls Item.findByIdAndUpdate for each item when status="received"', async () => {
    const mockItem = { findByIdAndUpdate: jest.fn().mockResolvedValue({}) };
    const mockSupplier = { findByIdAndUpdate: jest.fn().mockResolvedValue({}) };
    jest.spyOn(mongoose, 'model').mockImplementation((name) => {
      if (name === 'Item') return mockItem;
      if (name === 'Supplier') return mockSupplier;
    });
    const doc = {
      status: 'received',
      payment_status: 'pending',
      supplier: new ObjectId(fakeSupplierId),
      total: 500,
      items: [{ item: new ObjectId(fakeItemId), quantity: 3, cost_price: 100, selling_price: 150 }],
    };
    await hook.call({}, doc);
    expect(mockItem.findByIdAndUpdate).toHaveBeenCalledTimes(1);
    expect(mockItem.findByIdAndUpdate).toHaveBeenCalledWith(
      doc.items[0].item,
      expect.objectContaining({ $inc: expect.objectContaining({ quantity: 3 }) })
    );
  });

  test('sets cost_price and selling_price on Item update', async () => {
    const mockItem = { findByIdAndUpdate: jest.fn().mockResolvedValue({}) };
    const mockSupplier = { findByIdAndUpdate: jest.fn().mockResolvedValue({}) };
    jest.spyOn(mongoose, 'model').mockImplementation((name) => {
      if (name === 'Item') return mockItem;
      if (name === 'Supplier') return mockSupplier;
    });
    const doc = {
      status: 'received',
      payment_status: 'pending',
      supplier: new ObjectId(fakeSupplierId),
      total: 500,
      items: [{ item: new ObjectId(fakeItemId), quantity: 2, cost_price: 75, selling_price: 100 }],
    };
    await hook.call({}, doc);
    const update = mockItem.findByIdAndUpdate.mock.calls[0][1];
    expect(update.$set).toMatchObject({ cost_price: 75, selling_price: 100 });
  });

  test('calls Supplier.findByIdAndUpdate with $inc balance when payment_status != "paid"', async () => {
    const mockItem = { findByIdAndUpdate: jest.fn().mockResolvedValue({}) };
    const mockSupplier = { findByIdAndUpdate: jest.fn().mockResolvedValue({}) };
    jest.spyOn(mongoose, 'model').mockImplementation((name) => {
      if (name === 'Item') return mockItem;
      if (name === 'Supplier') return mockSupplier;
    });
    const doc = {
      status: 'received',
      payment_status: 'pending',
      supplier: new ObjectId(fakeSupplierId),
      total: 500,
      items: [],
    };
    await hook.call({}, doc);
    expect(mockSupplier.findByIdAndUpdate).toHaveBeenCalledWith(doc.supplier, {
      $inc: { balance: 500 },
    });
  });

  test('does NOT update Supplier balance when payment_status="paid"', async () => {
    const mockItem = { findByIdAndUpdate: jest.fn().mockResolvedValue({}) };
    const mockSupplier = { findByIdAndUpdate: jest.fn().mockResolvedValue({}) };
    jest.spyOn(mongoose, 'model').mockImplementation((name) => {
      if (name === 'Item') return mockItem;
      if (name === 'Supplier') return mockSupplier;
    });
    const doc = {
      status: 'received',
      payment_status: 'paid',
      supplier: new ObjectId(fakeSupplierId),
      total: 500,
      items: [],
    };
    await hook.call({}, doc);
    expect(mockSupplier.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test('calls Item.findByIdAndUpdate for every item in the array', async () => {
    const mockItem = { findByIdAndUpdate: jest.fn().mockResolvedValue({}) };
    const mockSupplier = { findByIdAndUpdate: jest.fn().mockResolvedValue({}) };
    jest.spyOn(mongoose, 'model').mockImplementation((name) => {
      if (name === 'Item') return mockItem;
      if (name === 'Supplier') return mockSupplier;
    });
    const item2Id = new ObjectId();
    const doc = {
      status: 'received',
      payment_status: 'partial',
      supplier: new ObjectId(fakeSupplierId),
      total: 300,
      items: [
        { item: new ObjectId(fakeItemId), quantity: 1, cost_price: 100, selling_price: 150 },
        { item: item2Id, quantity: 2, cost_price: 50, selling_price: 80 },
      ],
    };
    await hook.call({}, doc);
    expect(mockItem.findByIdAndUpdate).toHaveBeenCalledTimes(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 18. Static: getReceivingOrder
// ══════════════════════════════════════════════════════════════════════════════
describe('Receiving.getReceivingOrder', () => {
  function setupGetColl(coll = makeColl()) {
    jest.spyOn(MockBaseModel.prototype, 'getCollection').mockResolvedValue(coll);
  }

  test('returns { status:false, message:"Invalid receiving ID" } for non-ObjectId string', async () => {
    const result = await Receiving.getReceivingOrder('not-a-valid-id');
    expect(result.status).toBe(false);
    expect(result.message).toBe('Invalid receiving ID');
    expect(result.data).toBeNull();
  });

  test('returns { status:false } for null id', async () => {
    const result = await Receiving.getReceivingOrder(null);
    expect(result.status).toBe(false);
    expect(result.message).toBe('Invalid receiving ID');
  });

  test('returns { status:false } for empty string id', async () => {
    const result = await Receiving.getReceivingOrder('');
    expect(result.status).toBe(false);
    expect(result.message).toBe('Invalid receiving ID');
  });

  test('returns "Receiving not found" when collection.findOne returns null', async () => {
    setupGetColl(makeColl({ findOne: jest.fn().mockResolvedValue(null) }));
    const result = await Receiving.getReceivingOrder(new ObjectId().toHexString());
    expect(result.status).toBe(false);
    expect(result.message).toBe('Receiving not found');
  });

  test('returns { status:false, message } when getCollection throws', async () => {
    jest.spyOn(MockBaseModel.prototype, 'getCollection').mockRejectedValue(new Error('DB down'));
    const result = await Receiving.getReceivingOrder(new ObjectId().toHexString());
    expect(result.status).toBe(false);
    expect(result.message).toBe('DB down');
  });

  test('response shape is { status, data, message } on error', async () => {
    const result = await Receiving.getReceivingOrder('bad-id');
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('message');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 19. Static: deleteReceivingCollectionData (active = line 2121 version)
// ══════════════════════════════════════════════════════════════════════════════
describe('Receiving.deleteReceivingCollectionData', () => {
  function setupDeleteColls(receivingColl = makeColl()) {
    jest.spyOn(MockBaseModel.prototype, 'getCollection').mockImplementation(async (name) => {
      if (name === 'receivings') return receivingColl;
      if (name === 'items') return makeColl();
      if (name === 'branches')
        return makeColl({
          findOne: jest
            .fn()
            .mockResolvedValue({ stock_management: false, stock_management_log: false }),
        });
      if (name === 'stocklogs') return makeColl();
      return makeColl();
    });
    return receivingColl;
  }

  test('returns status:false when ids is null (TypeError caught)', async () => {
    jest.spyOn(MockBaseModel.prototype, 'getCollection').mockResolvedValue(makeColl());
    const result = await Receiving.deleteReceivingCollectionData(null);
    expect(result.status).toBe(false);
    expect(result.data).toBeNull();
    expect(typeof result.message).toBe('string');
  });

  test('returns status:false when ids is undefined (TypeError caught)', async () => {
    jest.spyOn(MockBaseModel.prototype, 'getCollection').mockResolvedValue(makeColl());
    const result = await Receiving.deleteReceivingCollectionData(undefined);
    expect(result.status).toBe(false);
  });

  test('returns { status:true, data: deletedCount, message: "success" } on success', async () => {
    const receivingColl = makeColl({
      find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 3 }),
    });
    setupDeleteColls(receivingColl);
    const result = await Receiving.deleteReceivingCollectionData([
      new ObjectId().toHexString(),
      new ObjectId().toHexString(),
      new ObjectId().toHexString(),
    ]);
    expect(result.status).toBe(true);
    expect(result.data).toBe(3);
    expect(result.message).toBe('success');
  });

  test('calls collection.deleteMany exactly once', async () => {
    const receivingColl = makeColl({
      find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    });
    setupDeleteColls(receivingColl);
    await Receiving.deleteReceivingCollectionData([new ObjectId().toHexString()]);
    expect(receivingColl.deleteMany).toHaveBeenCalledTimes(1);
  });

  test('backs up each receiving before deletion', async () => {
    const fakeReceiving = {
      _id: new ObjectId(),
      receiving_id: 'RID000001',
      receiving_status: 'Open',
      items: [],
    };
    const backupSpy = jest.spyOn(MockBaseModel, 'deletedDocumentBackup');
    const receivingColl = makeColl({
      find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([fakeReceiving]) }),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    });
    setupDeleteColls(receivingColl);
    await Receiving.deleteReceivingCollectionData([fakeReceiving._id.toHexString()]);
    expect(backupSpy).toHaveBeenCalledWith('receivings', fakeReceiving);
  });

  test('returns status:false when getCollection throws', async () => {
    jest
      .spyOn(MockBaseModel.prototype, 'getCollection')
      .mockRejectedValue(new Error('Collection error'));
    const result = await Receiving.deleteReceivingCollectionData([new ObjectId().toHexString()]);
    expect(result.status).toBe(false);
    expect(result.message).toBe('Collection error');
  });

  test('processes empty array without error (no docs found → deletedCount: 0)', async () => {
    const receivingColl = makeColl({
      find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
    });
    setupDeleteColls(receivingColl);
    const result = await Receiving.deleteReceivingCollectionData([]);
    expect(result.status).toBe(true);
    expect(result.data).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 20. Static: exportReceivingsOrder (active = line 2286 version)
// ══════════════════════════════════════════════════════════════════════════════
describe('Receiving.exportReceivingsOrder', () => {
  function setupExportColl(coll = makeColl()) {
    jest.spyOn(MockBaseModel.prototype, 'getCollection').mockResolvedValue(coll);
    return coll;
  }

  test('returns status:false when ids is null (TypeError caught)', async () => {
    setupExportColl();
    const result = await Receiving.exportReceivingsOrder(null);
    expect(result.status).toBe(false);
  });

  test('returns { status:true, data, message:"Receiving Data Exported" } on success', async () => {
    const fakeDocs = [{ receiving_id: 'RID000001', supplier_name: 'Vendor X' }];
    setupExportColl(
      makeColl({
        find: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnThis(),
          toArray: jest.fn().mockResolvedValue(fakeDocs),
        }),
      })
    );
    const result = await Receiving.exportReceivingsOrder([new ObjectId().toHexString()]);
    expect(result.status).toBe(true);
    expect(result.data).toEqual(fakeDocs);
    expect(result.message).toBe('Receiving Data Exported');
  });

  test('calls collection.find with _id.$in filter', async () => {
    const coll = setupExportColl(
      makeColl({
        find: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnThis(),
          toArray: jest.fn().mockResolvedValue([]),
        }),
      })
    );
    await Receiving.exportReceivingsOrder([new ObjectId().toHexString()]);
    expect(coll.find).toHaveBeenCalledTimes(1);
    const [filter] = coll.find.mock.calls[0];
    expect(filter).toHaveProperty('_id.$in');
    expect(Array.isArray(filter._id.$in)).toBe(true);
  });

  test('result includes license filter in find call', async () => {
    const coll = setupExportColl(
      makeColl({
        find: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnThis(),
          toArray: jest.fn().mockResolvedValue([]),
        }),
      })
    );
    await Receiving.exportReceivingsOrder([new ObjectId().toHexString()]);
    const [filter] = coll.find.mock.calls[0];
    expect(filter).toHaveProperty('license');
  });

  test('returns status:false when getCollection throws', async () => {
    jest
      .spyOn(MockBaseModel.prototype, 'getCollection')
      .mockRejectedValue(new Error('Export fail'));
    const result = await Receiving.exportReceivingsOrder([new ObjectId().toHexString()]);
    expect(result.status).toBe(false);
    expect(result.message).toBe('Export fail');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 21. Static: pendingReceivingReportPage
// ══════════════════════════════════════════════════════════════════════════════
describe('Receiving.pendingReceivingReportPage', () => {
  beforeEach(() => {
    jest.spyOn(Receiving, 'aggregate').mockResolvedValue([]);
  });

  test('returns status:true on success', async () => {
    const result = await Receiving.pendingReceivingReportPage({ branchid: [] });
    expect(result.status).toBe(true);
  });

  test('result.list is an array', async () => {
    const result = await Receiving.pendingReceivingReportPage({ branchid: [] });
    expect(Array.isArray(result.list)).toBe(true);
  });

  test('uses default limit of 5 when options.limit is missing', async () => {
    const result = await Receiving.pendingReceivingReportPage({ branchid: [] });
    expect(result.pagination.limit).toBe(5);
  });

  test('uses provided limit when options.limit is set', async () => {
    const result = await Receiving.pendingReceivingReportPage({ branchid: [] }, { limit: 10 });
    expect(result.pagination.limit).toBe(10);
  });

  test('uses default page of 1 when options.page is missing', async () => {
    const result = await Receiving.pendingReceivingReportPage({ branchid: [] });
    expect(result.pagination.page).toBe(1);
  });

  test('pagination object has page, limit, total, pages', async () => {
    const result = await Receiving.pendingReceivingReportPage({ branchid: [] });
    expect(result.pagination).toHaveProperty('page');
    expect(result.pagination).toHaveProperty('limit');
    expect(result.pagination).toHaveProperty('total');
    expect(result.pagination).toHaveProperty('pages');
  });

  test('returns status:false with message when aggregate throws', async () => {
    jest.spyOn(Receiving, 'aggregate').mockRejectedValue(new Error('Agg failed'));
    const result = await Receiving.pendingReceivingReportPage({ branchid: [] });
    expect(result.status).toBe(false);
    expect(result.message).toBe('Agg failed');
    expect(result.list).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 22. Static: pendingSupplierReportPage
// ══════════════════════════════════════════════════════════════════════════════
describe('Receiving.pendingSupplierReportPage', () => {
  beforeEach(() => {
    jest.spyOn(Receiving, 'aggregate').mockResolvedValue([]);
  });

  test('returns status:true on success', async () => {
    const result = await Receiving.pendingSupplierReportPage({ branchid: [] });
    expect(result.status).toBe(true);
  });

  test('uses default limit of 5', async () => {
    const result = await Receiving.pendingSupplierReportPage({ branchid: [] });
    expect(result.pagination.limit).toBe(5);
  });

  test('uses default page of 1', async () => {
    const result = await Receiving.pendingSupplierReportPage({ branchid: [] });
    expect(result.pagination.page).toBe(1);
  });

  test('returns status:false when aggregate throws', async () => {
    jest.spyOn(Receiving, 'aggregate').mockRejectedValue(new Error('Supplier agg fail'));
    const result = await Receiving.pendingSupplierReportPage({ branchid: [] });
    expect(result.status).toBe(false);
    expect(result.list).toBeNull();
  });

  test('result.list transforms _id into supplier fields', async () => {
    const supplierId = new ObjectId();
    jest.spyOn(Receiving, 'aggregate').mockResolvedValue([
      {
        _id: { supplier_id: supplierId, supplier_name: 'Vendor A' },
        total_amount: 1000,
        paid_amount: 500,
        balance: 500,
        receiving_count: 2,
      },
    ]);
    const result = await Receiving.pendingSupplierReportPage({ branchid: [] });
    expect(result.status).toBe(true);
    expect(result.list).toHaveLength(1);
    expect(result.list[0]).toMatchObject({
      supplier_name: 'Vendor A',
      total_amount: 1000,
      balance: 500,
      receiving_count: 2,
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 23. Static: returnPrintDetailsPage
// ══════════════════════════════════════════════════════════════════════════════
describe('Receiving.returnPrintDetailsPage', () => {
  test('returns status:false for invalid ObjectId string', async () => {
    const result = await Receiving.returnPrintDetailsPage('invalid-id');
    expect(result.status).toBe(false);
    expect(result.data).toBeNull();
    expect(result.message).toBe('Invalid return id');
  });

  test('returns status:false for null id', async () => {
    const result = await Receiving.returnPrintDetailsPage(null);
    expect(result.status).toBe(false);
    expect(result.message).toBe('Invalid return id');
  });

  test('returns status:false for empty string id', async () => {
    const result = await Receiving.returnPrintDetailsPage('');
    expect(result.status).toBe(false);
    expect(result.message).toBe('Invalid return id');
  });

  test('returns "Receiving Details Not Found" when aggregate returns empty array', async () => {
    jest.spyOn(Receiving, 'aggregate').mockResolvedValue([]);
    const result = await Receiving.returnPrintDetailsPage(new ObjectId().toHexString());
    expect(result.status).toBe(false);
    expect(result.message).toBe('Receiving Details Not Found');
  });

  test('error response has { status, data, message } shape', async () => {
    const result = await Receiving.returnPrintDetailsPage('bad');
    expect(result).toHaveProperty('status', false);
    expect(result).toHaveProperty('data', null);
    expect(result).toHaveProperty('message');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 24. Duplicate static method detection
// ══════════════════════════════════════════════════════════════════════════════
describe('Receiving — static method registration', () => {
  test('deleteReceivingCollectionData is a function', () => {
    expect(typeof Receiving.deleteReceivingCollectionData).toBe('function');
  });

  test('exportReceivingsOrder is a function', () => {
    expect(typeof Receiving.exportReceivingsOrder).toBe('function');
  });

  test('pendingReceivingReportPage is a function', () => {
    expect(typeof Receiving.pendingReceivingReportPage).toBe('function');
  });

  test('pendingSupplierReportPage is a function', () => {
    expect(typeof Receiving.pendingSupplierReportPage).toBe('function');
  });

  test('returnReceivingReportPage is a function', () => {
    expect(typeof Receiving.returnReceivingReportPage).toBe('function');
  });

  test('returnReceivingProductReportPage is a function', () => {
    expect(typeof Receiving.returnReceivingProductReportPage).toBe('function');
  });

  test('getReceivingOrder is a function', () => {
    expect(typeof Receiving.getReceivingOrder).toBe('function');
  });

  test('receivingInsertUpdate is a function', () => {
    expect(typeof Receiving.receivingInsertUpdate).toBe('function');
  });

  describe('purchase tax capture (PURCHASE_TAX_PLAN P2) - source contracts', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(__dirname, '../../../src/models/receiving.model.js'),
      'utf8'
    );

    test('a well-formed GSTIN decides intra vs inter state, not the typed name', () => {
      expect(src).toMatch(/gstin\.slice\(0, 2\)/);
      expect(src).toMatch(/gst_state_code\.json/);
    });

    test('the credit flag and declared invoice total are presence-gated', () => {
      expect(src).toMatch(/data\.itc_eligible !== undefined/);
      expect(src).toMatch(/invoice_total_declared !== undefined/);
      expect(src).toMatch(/invoice_total_mismatch/);
      /* recorded and shown, never blocked - the owner's ruling */
      expect(src).not.toMatch(/invoice_total_mismatch[\s\S]{0,120}throw/);
    });

    test('stock moves on transitions, never on saves', () => {
      /* The legacy update path re-added every line's quantity on each save
         of a Received purchase - masked for years by the broken status
         radio that posted every edit back as Open. The ledger now diffs
         the stored state against the incoming one. */
      const update = src.slice(src.indexOf('// UPDATE existing receiving'));
      expect(update).toMatch(/prevStatus = existingReceiving\.receiving_status/);
      expect(update).toMatch(/countedAfter\[key\] \|\| 0\) - \(countedBefore\[key\] \|\| 0\)/);
      expect(update).toMatch(/action: delta > 0 \? 'Add' : 'Deduct'/);
      /* the unconditional re-add is gone */
      expect(update).not.toMatch(/newQty = itemQuantity \+ availableQty/);
      /* a voided purchase is a closed book */
      expect(update).toMatch(/voided - it can no longer be edited/);
    });

    test('additional charges ride the total, never the tax heads', () => {
      /* Freight and its friends (the PO form block the owner asked back):
         presence-gated, summed onto total_amount, counted in the declared-
         invoice comparison - and nowhere near the per-line tax math. */
      expect(src).toMatch(/data\.additional_charges !== undefined/);
      expect(src).toMatch(/updateData\.additional_charges_total/);
      expect(src).toMatch(/receivingTotalAmount \+ chargesTotal/);
      const mismatchBlock = src.slice(
        src.indexOf('invoice_total_declared !== undefined'),
        src.indexOf('invoice_total_mismatch')
      );
      expect(mismatchBlock).toMatch(/chargesTotal/);
      /* the tax heads never see a charge */
      const taxBlock = src.slice(src.indexOf('igst_tax:'), src.indexOf('tax_fields:'));
      expect(taxBlock).not.toMatch(/charge/i);
    });
  });

  test('returnPrintDetailsPage is a function', () => {
    expect(typeof Receiving.returnPrintDetailsPage).toBe('function');
  });

  test('supplierReceivingReportPage is a function', () => {
    expect(typeof Receiving.supplierReceivingReportPage).toBe('function');
  });

  test('receivingReportPage is a function', () => {
    expect(typeof Receiving.receivingReportPage).toBe('function');
  });

  test('receivingsGraphicalReports is a function', () => {
    expect(typeof Receiving.receivingsGraphicalReports).toBe('function');
  });

  test('productBasedReceivingReturnReportPage is a function', () => {
    expect(typeof Receiving.productBasedReceivingReturnReportPage).toBe('function');
  });

  test('returnReceivingOrder is attached from receiving-return.model.js', () => {
    expect(typeof Receiving.returnReceivingOrder).toBe('function');
  });
});
