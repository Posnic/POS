'use strict';

/**
 * Unit tests for src/models/sale.model.js
 * ORM: Mongoose. Collection: "sales".
 * Exports: Sale (Mongoose model), Sale.LegacySaleModel (legacy native-driver descriptor).
 * Strategy: Pure schema inspection via schema.path() + pre-save hook extraction.
 * No real DB connections. External APIs mocked.
 */

// ─── Mocks (hoisted before requires) ─────────────────────────────────────────

jest.mock('../../../src/utils/email', () => ({
  sendEmail: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('../../../src/config', () => ({
  sendinblue_key: null,
  razorpay: { keyId: 'test_key', keySecret: 'test_secret' },
}));

jest.mock('@getbrevo/brevo', () => ({
  BrevoClient: jest.fn().mockImplementation(() => ({
    transactionalEmails: {
      sendTransacEmail: jest.fn().mockResolvedValue({ messageId: 'brevo-id' }),
    },
  })),
}));

jest.mock('razorpay', () =>
  jest.fn().mockImplementation(() => ({
    qrCode: {
      create: jest.fn().mockResolvedValue({
        id: 'qr_123',
        image_url: 'https://example.com/qr.png',
        status: 'active',
        payments_count_received: 0,
      }),
      fetch: jest.fn().mockResolvedValue({
        id: 'qr_123',
        status: 'active',
        payments_count_received: 0,
        payments_amount_received: 0,
      }),
    },
  }))
);

jest.mock('moment-timezone', () =>
  jest.fn().mockReturnValue({
    tz: jest.fn().mockReturnThis(),
    add: jest.fn().mockReturnThis(),
    unix: jest.fn().mockReturnValue(1700001800),
  })
);

jest.mock('axios', () => jest.fn().mockResolvedValue({ data: 'ok' }));

// ─── Requires ─────────────────────────────────────────────────────────────────

const mongoose = require('mongoose');
const Sale = require('../../../src/models/sale.model');
const BaseModel = require('../../../src/models/base.model');
const { sendEmail } = require('../../../src/utils/email');

// ─── Schema helpers ────────────────────────────────────────────────────────────

const saleSchema = Sale.schema;
const saleItemSchema = saleSchema.path('items').schema;
const paymentSchema = saleSchema.path('payments').schema;
const p = (f) => saleSchema.path(f);
const pi = (f) => saleItemSchema.path(f);
const pp = (f) => paymentSchema.path(f);
const LegacySaleModel = Sale.LegacySaleModel;

const SALE_PROCESS_VALUES = ['Add', 'Edit', 'Hold', 'PartialReturn', 'Return', 'KOT'];
const PAYMENT_METHOD_VALUES = ['cash', 'card', 'bank_transfer', 'credit', 'other'];
const EXTRA_DISCOUNT_TYPES = ['price', 'percentage', 'percent'];

// ─── Pre-save hook helpers ─────────────────────────────────────────────────────

function getPreSaveFn() {
  const pres = saleSchema.s.hooks._pres.get('save') || [];
  const hook = pres.find((h) => h.fn && h.fn.toString().includes('sales_id'));
  return hook?.fn;
}

function makeDoc(overrides = {}) {
  const base = {
    isNew: false,
    sales_id: 'INV000001',
    branch: null,
    branch_id: null,
    sale_method: null,
    items: [],
    subtotal: null,
    total: null,
    items_subtotal: 0,
    items_total: 0,
    number_of_items: 0,
    partial_balance: undefined,
    payment_pending: undefined,
    paid_amount: 0,
    balance: 0,
    date: new Date('2024-01-15'),
    created_date: null,
    updated_date: null,
    created_by: null,
    created_by_id: null,
    updated_by: null,
    updated_by_id: null,
    user_id: null,
    license: null,
    changes: [],
    isModified: jest.fn().mockReturnValue(false),
    set: jest.fn(function (key, val) {
      if (val === undefined) {
        delete this[key];
      } else {
        this[key] = val;
      }
    }),
  };
  return Object.assign(base, overrides);
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  BaseModel.license = null;
  BaseModel.currentBranch = null;
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// 1. Model identity
// ══════════════════════════════════════════════════════════════════════════════
describe('Sale — model identity', () => {
  test('module exports the Mongoose Sale model', () => {
    expect(Sale).toBeDefined();
    expect(typeof Sale).toBe('function');
  });

  test('modelName is "Sale"', () => {
    expect(Sale.modelName).toBe('Sale');
  });

  test('has standard Mongoose query methods', () => {
    expect(typeof Sale.find).toBe('function');
    expect(typeof Sale.findOne).toBe('function');
    expect(typeof Sale.create).toBe('function');
    expect(typeof Sale.countDocuments).toBe('function');
    expect(typeof Sale.updateOne).toBe('function');
    expect(typeof Sale.deleteOne).toBe('function');
  });

  test('schema is a mongoose.Schema instance', () => {
    expect(saleSchema).toBeInstanceOf(mongoose.Schema);
  });

  test('paginate plugin is attached', () => {
    expect(typeof Sale.paginate).toBe('function');
  });

  test('LegacySaleModel is attached as Sale.LegacySaleModel', () => {
    expect(Sale.LegacySaleModel).toBeDefined();
    expect(typeof Sale.LegacySaleModel).toBe('function');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. saleItemSchema — required fields
// ══════════════════════════════════════════════════════════════════════════════
describe('saleItemSchema › item field', () => {
  test('path exists', () => {
    expect(pi('item')).toBeDefined();
  });
  test('instance is ObjectId', () => {
    expect(pi('item').instance).toBe('ObjectId');
  });
  test('is required', () => {
    expect(pi('item').options.required).toBe(true);
  });
  test('refs "Item" model', () => {
    expect(pi('item').options.ref).toBe('Item');
  });
});

describe('saleItemSchema › name field', () => {
  test('path exists', () => {
    expect(pi('name')).toBeDefined();
  });
  test('instance is String', () => {
    expect(pi('name').instance).toBe('String');
  });
  test('is required', () => {
    expect(pi('name').options.required).toBe(true);
  });
});

describe('saleItemSchema › quantity field', () => {
  test('path exists', () => {
    expect(pi('quantity')).toBeDefined();
  });
  test('instance is Number', () => {
    expect(pi('quantity').instance).toBe('Number');
  });
  test('is required', () => {
    expect(pi('quantity').options.required).toBe(true);
  });
  // A gram, not a unit. This asserted 1, which is one whole kilo for
  // anything sold by weight - a 300g sale was refused by the schema
  // after the customer had already paid.
  test('min is a gram, so a weight is accepted', () => {
    expect(pi('quantity').options.min).toBe(0.001);
  });
});

describe('saleItemSchema › unit_price field', () => {
  test('path exists', () => {
    expect(pi('unit_price')).toBeDefined();
  });
  test('instance is Number', () => {
    expect(pi('unit_price').instance).toBe('Number');
  });
  test('is required', () => {
    expect(pi('unit_price').options.required).toBe(true);
  });
  test('min is 0', () => {
    expect(pi('unit_price').options.min).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. saleItemSchema — optional fields with defaults
// ══════════════════════════════════════════════════════════════════════════════
describe('saleItemSchema › optional numeric fields', () => {
  test.each([
    ['tax_rate', 0, 0, 100],
    ['tax_amount', 0, 0, undefined],
    ['discount', 0, 0, undefined],
  ])('%s has default %d and min %s', (field, def, min) => {
    expect(pi(field)).toBeDefined();
    expect(pi(field).options.default).toBe(def);
    expect(pi(field).options.min).toBe(min);
    expect(pi(field).options.required).toBeFalsy();
  });

  test('tax_rate has max 100', () => {
    expect(pi('tax_rate').options.max).toBe(100);
  });

  test('total is optional (no required, has min:0)', () => {
    expect(pi('total')).toBeDefined();
    expect(pi('total').options.required).toBeFalsy();
    expect(pi('total').options.min).toBe(0);
  });

  test.each([
    'sale_inline_item_price',
    'sale_inline_discount_value',
    'sale_inline_discount_pervalue',
    'item_discount',
    'item_available_quantity',
    'total_amount',
    'company_price_total',
  ])('"%s" is Number with default 0', (field) => {
    expect(pi(field)).toBeDefined();
    expect(pi(field).instance).toBe('Number');
    expect(pi(field).options.default).toBe(0);
  });
});

describe('saleItemSchema › Boolean fields', () => {
  test('return: Boolean, default false', () => {
    expect(pi('return').instance).toBe('Boolean');
    expect(pi('return').options.default).toBe(false);
  });

  test('track_inventory: Boolean, default true', () => {
    expect(pi('track_inventory').instance).toBe('Boolean');
    expect(pi('track_inventory').options.default).toBe(true);
  });

  test('negative_stock: Boolean, default false', () => {
    expect(pi('negative_stock').instance).toBe('Boolean');
    expect(pi('negative_stock').options.default).toBe(false);
  });
});

describe('saleItemSchema › ObjectId/Mixed fields', () => {
  test('category_id is ObjectId', () => {
    expect(pi('category_id').instance).toBe('ObjectId');
  });
  test('supplier_id is ObjectId', () => {
    expect(pi('supplier_id').instance).toBe('ObjectId');
  });
  test('tax_fields is Mixed', () => {
    expect(pi('tax_fields').instance).toBe('Mixed');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. paymentSchema — fields
// ══════════════════════════════════════════════════════════════════════════════
describe('paymentSchema › amount field', () => {
  test('instance is Number', () => {
    expect(pp('amount').instance).toBe('Number');
  });
  test('is required', () => {
    expect(pp('amount').options.required).toBe(true);
  });
  test('min is 0', () => {
    expect(pp('amount').options.min).toBe(0);
  });
});

describe('paymentSchema › method field', () => {
  test('instance is String', () => {
    expect(pp('method').instance).toBe('String');
  });
  test('is required', () => {
    expect(pp('method').options.required).toBe(true);
  });
  test('enum has exactly 5 values', () => {
    expect(pp('method').enumValues).toHaveLength(5);
  });

  test.each(PAYMENT_METHOD_VALUES)('enum contains "%s"', (v) => {
    expect(pp('method').enumValues).toContain(v);
  });
});

describe('paymentSchema › optional fields', () => {
  test('date is Date with default', () => {
    expect(pp('date').instance).toBe('Date');
    expect(pp('date').options.default).toBeTruthy();
    expect(pp('date').options.required).toBeFalsy();
  });

  test.each(['reference', 'notes'])('"%s" is optional String', (field) => {
    expect(pp(field)).toBeDefined();
    expect(pp(field).instance).toBe('String');
    expect(pp(field).options.required).toBeFalsy();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. saleSchema — branch / identity fields
// ══════════════════════════════════════════════════════════════════════════════
describe('saleSchema › branch fields', () => {
  test('branch_id is ObjectId ref Branch', () => {
    expect(p('branch_id').instance).toBe('ObjectId');
    expect(p('branch_id').options.ref).toBe('Branch');
  });

  test('branch is ObjectId ref Branch', () => {
    expect(p('branch').instance).toBe('ObjectId');
    expect(p('branch').options.ref).toBe('Branch');
  });

  test('branch_name is String', () => {
    expect(p('branch_name').instance).toBe('String');
  });

  test('sales_id is String with index', () => {
    expect(p('sales_id').instance).toBe('String');
    expect(p('sales_id').options.index).toBe(true);
  });

  test('billing transaction id has a unique per-license index', () => {
    expect(p('billing_transaction_id').instance).toBe('String');
    const index = saleSchema
      .indexes()
      .find(([keys]) => keys.license === 1 && keys.billing_transaction_id === 1);
    expect(index).toBeDefined();
    expect(index[1].unique).toBe(true);
  });

  test('cashregister_id is String', () => {
    expect(p('cashregister_id').instance).toBe('String');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. saleSchema — date / audit fields
// ══════════════════════════════════════════════════════════════════════════════
describe('saleSchema › date and audit fields', () => {
  test('date is Date with default', () => {
    expect(p('date').instance).toBe('Date');
    expect(p('date').options.default).toBeTruthy();
  });

  test.each(['created_date', 'updated_date'])('"%s" is Date, optional', (field) => {
    expect(p(field)).toBeDefined();
    expect(p(field).instance).toBe('Date');
    expect(p(field).options.required).toBeFalsy();
  });

  test('created_by is String', () => {
    expect(p('created_by').instance).toBe('String');
  });
  test('updated_by is String', () => {
    expect(p('updated_by').instance).toBe('String');
  });
  test('created_by_id is ObjectId ref User', () => {
    expect(p('created_by_id').options.ref).toBe('User');
  });
  test('updated_by_id is ObjectId ref User', () => {
    expect(p('updated_by_id').options.ref).toBe('User');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. saleSchema — customer fields
// ══════════════════════════════════════════════════════════════════════════════
describe('saleSchema › customer fields', () => {
  test('customer_id is ObjectId', () => {
    expect(p('customer_id').instance).toBe('ObjectId');
  });
  test('customer is ObjectId (raw, no ref)', () => {
    expect(p('customer').instance).toBe('ObjectId');
  });
  test('customer_name is String', () => {
    expect(p('customer_name').instance).toBe('String');
  });
  test('customer_balance is Number with default 0', () => {
    expect(p('customer_balance').instance).toBe('Number');
    expect(p('customer_balance').options.default).toBe(0);
  });
  test.each([
    'customer_phone',
    'customer_email',
    'customer_address',
    'customer_state',
    'customer_country',
  ])('"%s" is String', (f) => {
    expect(p(f)).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. saleSchema — sale_process enum
// ══════════════════════════════════════════════════════════════════════════════
describe('saleSchema › sale_process field', () => {
  test('instance is String', () => {
    expect(p('sale_process').instance).toBe('String');
  });
  test('default is "Add"', () => {
    expect(p('sale_process').options.default).toBe('Add');
  });
  test('enum has exactly 6 values', () => {
    expect(p('sale_process').enumValues).toHaveLength(6);
  });

  test.each(SALE_PROCESS_VALUES)('enum contains "%s"', (v) => {
    expect(p('sale_process').enumValues).toContain(v);
  });

  test('enum does NOT contain invalid value "Delete"', () => {
    expect(p('sale_process').enumValues).not.toContain('Delete');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. saleSchema — payment / status fields
// ══════════════════════════════════════════════════════════════════════════════
describe('saleSchema › payment and status fields', () => {
  test('payment_status default is "completed"', () => {
    expect(p('payment_status').options.default).toBe('completed');
  });

  test('payment_mode default is "Cash"', () => {
    expect(p('payment_mode').options.default).toBe('Cash');
  });

  test('partial_check is Mixed with default false', () => {
    expect(p('partial_check').instance).toBe('Mixed');
    expect(p('partial_check').options.default).toBe(false);
  });

  test('partial_balance is Number with default 0', () => {
    expect(p('partial_balance').options.default).toBe(0);
  });

  test('payment_pending is Number with default 0', () => {
    expect(p('payment_pending').options.default).toBe(0);
  });

  test('wallet_amount is Number with default 0', () => {
    expect(p('wallet_amount').options.default).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. saleSchema — totals / aggregate fields
// ══════════════════════════════════════════════════════════════════════════════
describe('saleSchema › totals and aggregate fields', () => {
  test.each([
    'sales_total',
    'sales_sub_total',
    'items_total',
    'items_return_total',
    'items_subtotal',
    'items_return_subtotal',
    'total_companyprice',
    'return_tax',
    'return_discount',
    'extra_discount',
    'sale_extra_discount',
    'return_extra_discount',
  ])('"%s" is Number with default 0', (field) => {
    expect(p(field)).toBeDefined();
    expect(p(field).instance).toBe('Number');
    expect(p(field).options.default).toBe(0);
  });

  test('tax has default 0 and min 0', () => {
    expect(p('tax').options.default).toBe(0);
    expect(p('tax').options.min).toBe(0);
  });

  test('discount has default 0 and min 0', () => {
    expect(p('discount').options.default).toBe(0);
    expect(p('discount').options.min).toBe(0);
  });

  test('number_of_items default is 0', () => {
    expect(p('number_of_items').options.default).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. saleSchema — extra_discount_type enum
// ══════════════════════════════════════════════════════════════════════════════
describe('saleSchema › extra_discount_type field', () => {
  test('instance is String', () => {
    expect(p('extra_discount_type').instance).toBe('String');
  });
  test('default is "price"', () => {
    expect(p('extra_discount_type').options.default).toBe('price');
  });
  test('enum has exactly 3 values', () => {
    expect(p('extra_discount_type').enumValues).toHaveLength(3);
  });

  test.each(EXTRA_DISCOUNT_TYPES)('enum contains "%s"', (v) => {
    expect(p('extra_discount_type').enumValues).toContain(v);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. saleSchema — restaurant / KOT fields
// ══════════════════════════════════════════════════════════════════════════════
describe('saleSchema › restaurant and KOT fields', () => {
  test('was_kot_proceeded is Boolean with default false', () => {
    expect(p('was_kot_proceeded').instance).toBe('Boolean');
    expect(p('was_kot_proceeded').options.default).toBe(false);
  });

  test('table_number is String with default ""', () => {
    expect(p('table_number').options.default).toBe('');
  });

  test('dine_type is String with default ""', () => {
    expect(p('dine_type').options.default).toBe('');
  });

  test('table_id is String', () => {
    expect(p('table_id').instance).toBe('String');
  });
  test('multi_payment is Mixed', () => {
    expect(p('multi_payment').instance).toBe('Mixed');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 13. saleSchema — arrays and options
// ══════════════════════════════════════════════════════════════════════════════
describe('saleSchema › arrays and schema options', () => {
  test('changes has default []', () => {
    expect(Array.isArray(p('changes').options.default)).toBe(true);
    expect(p('changes').options.default).toHaveLength(0);
  });

  test('items_return has default []', () => {
    expect(Array.isArray(p('items_return').options.default)).toBe(true);
  });

  test('timestamps option is false (no auto createdAt/updatedAt)', () => {
    expect(saleSchema.options.timestamps).toBe(false);
  });

  test('versionKey option is false', () => {
    expect(saleSchema.options.versionKey).toBe(false);
  });

  test('toJSON.virtuals is true', () => {
    expect(saleSchema.options.toJSON.virtuals).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 14. Pre-save hook
// ══════════════════════════════════════════════════════════════════════════════
describe('saleSchema pre-save hook', () => {
  test('at least one pre-save hook is registered', () => {
    const pres = saleSchema.s.hooks._pres.get('save') || [];
    expect(pres.length).toBeGreaterThan(0);
  });

  test('custom hook is locatable (contains "sales_id" logic)', () => {
    expect(getPreSaveFn()).toBeDefined();
  });

  test('generates fallback sales_id with "SID" prefix for new sale without one', async () => {
    const fn = getPreSaveFn();
    const ctx = makeDoc({ isNew: true, sales_id: null });
    await fn.call(ctx);
    expect(ctx.sales_id).toMatch(/^SID\d+$/);
  });

  test('preserves existing sales_id for new sale that already has one', async () => {
    const fn = getPreSaveFn();
    const ctx = makeDoc({ isNew: true, sales_id: 'INV000001' });
    await fn.call(ctx);
    expect(ctx.sales_id).toBe('INV000001');
  });

  test('syncs branch_id from branch when branch is set on a new sale', async () => {
    const fn = getPreSaveFn();
    const branchId = new mongoose.Types.ObjectId();
    const ctx = makeDoc({ isNew: true, branch: branchId, branch_id: null });
    await fn.call(ctx);
    expect(ctx.branch_id).toEqual(branchId);
  });

  test('calculates items_total from items array when total is not set', async () => {
    const fn = getPreSaveFn();
    const ctx = makeDoc({
      items: [
        { quantity: 2, total: 50 },
        { quantity: 1, total: 30 },
      ],
      total: null,
      items_total: 0,
    });
    await fn.call(ctx);
    expect(ctx.items_total).toBe(80);
  });

  test('uses provided total for items_total when total is set', async () => {
    const fn = getPreSaveFn();
    const ctx = makeDoc({ total: 200, items_total: 0, items: [] });
    await fn.call(ctx);
    expect(ctx.items_total).toBe(200);
  });

  test('calculates number_of_items as total quantity for non-Live-Order sale', async () => {
    const fn = getPreSaveFn();
    const ctx = makeDoc({
      sale_method: null,
      items: [
        { quantity: 3, total: 30 },
        { quantity: 2, total: 20 },
      ],
      number_of_items: 0,
      isModified: jest.fn().mockImplementation((f) => f === 'items'),
    });
    await fn.call(ctx);
    expect(ctx.number_of_items).toBe(5);
  });

  test('sets payment_pending to computed balance when partial fields missing', async () => {
    const fn = getPreSaveFn();
    const ctx = makeDoc({
      total: 100,
      paid_amount: 40,
      balance: 0,
      partial_balance: undefined,
      payment_pending: undefined,
    });
    await fn.call(ctx);
    expect(ctx.partial_balance).toBe(40);
    expect(ctx.payment_pending).toBe(60);
  });

  test('does NOT overwrite existing partial_balance / payment_pending', async () => {
    const fn = getPreSaveFn();
    const ctx = makeDoc({ total: 100, paid_amount: 40, partial_balance: 40, payment_pending: 60 });
    await fn.call(ctx);
    expect(ctx.partial_balance).toBe(40);
    expect(ctx.payment_pending).toBe(60);
  });

  test('sets license from BaseModel.license when doc has no license', async () => {
    BaseModel.license = 'license-xyz-001';
    const fn = getPreSaveFn();
    const ctx = makeDoc({ license: null });
    await fn.call(ctx);
    expect(ctx.license).toBe('license-xyz-001');
  });

  test('syncs created_date and updated_date when updated_date is missing', async () => {
    const fn = getPreSaveFn();
    const saleDate = new Date('2024-06-01');
    const ctx = makeDoc({ date: saleDate, created_date: null, updated_date: null });
    await fn.call(ctx);
    expect(ctx.updated_date).toEqual(saleDate);
    expect(ctx.created_date).toEqual(saleDate);
  });

  /* Mongoose 9 dropped next() from middleware: a hook resolves to carry on and
     rejects to fail the save. The rejection path is the one that matters - it
     is what stops a bad sale being written. */
  test('resolves rather than rejecting on success', async () => {
    const fn = getPreSaveFn();
    await expect(fn.call(makeDoc({}))).resolves.toBeUndefined();
  });

  test('rejects when something inside the hook throws, so the save fails', async () => {
    const fn = getPreSaveFn();
    const ctx = makeDoc();
    ctx.isModified = jest.fn().mockImplementation(() => {
      throw new Error('hook-error');
    });
    await expect(fn.call(ctx)).rejects.toThrow('hook-error');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 15. LegacySaleModel
// ══════════════════════════════════════════════════════════════════════════════
describe('LegacySaleModel', () => {
  test('typeof LegacySaleModel is function (class)', () => {
    expect(typeof LegacySaleModel).toBe('function');
  });

  test('collectionName is "sales"', () => {
    expect(LegacySaleModel.collectionName).toBe('sales');
  });

  test('fields is a defined object', () => {
    expect(LegacySaleModel.fields).toBeDefined();
    expect(typeof LegacySaleModel.fields).toBe('object');
  });

  test('fields has at least 40 entries (comprehensive schema)', () => {
    expect(Object.keys(LegacySaleModel.fields).length).toBeGreaterThanOrEqual(40);
  });

  test('_id field has name:"id" alias', () => {
    expect(LegacySaleModel.fields._id).toBeDefined();
    expect(LegacySaleModel.fields._id.name).toBe('id');
  });

  test('license field has select:false (hidden by default)', () => {
    expect(LegacySaleModel.fields.license).toBeDefined();
    expect(LegacySaleModel.fields.license.select).toBe(false);
  });

  test.each([
    'branch_id',
    'sales_id',
    'date',
    'items',
    'customer_id',
    'payment_status',
    'sale_process',
  ])('fields contains "%s"', (field) => {
    expect(LegacySaleModel.fields).toHaveProperty(field);
  });

  test('sale_process field has select:true', () => {
    expect(LegacySaleModel.fields.sale_process.select).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 16. Static methods — all attached to Sale
// ══════════════════════════════════════════════════════════════════════════════
describe('Sale — static methods attached', () => {
  test.each([
    'sendDailySalesMail',
    'generateQrCodeModel',
    'generateRazorPayQrCodekioskModel',
    'getRazorPayQrStatusModel',
    'razorPayQrCodeCloseModel',
    'qrCodeCloseModel',
    'getQrStatusModel',
    'kioskOrderModel',
  ])('Sale.%s is a function', (name) => {
    expect(typeof Sale[name]).toBe('function');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 17. Sale.sendDailySalesMail
// ══════════════════════════════════════════════════════════════════════════════
describe('Sale.sendDailySalesMail', () => {
  const baseInput = {
    email: 'test@example.com',
    data: {
      product_details: [],
      payment_details: [],
      tax_details: [],
      branch_details: { from_date: '2024-01-01', to_date: '2024-01-31', sales_type: 'Monthly' },
      extra_discount: { total_sale_extra_discount: 0 },
    },
  };

  test('returns {status:true, message:"Mail sent successfully"} via fallback (no apiKey)', async () => {
    const result = await Sale.sendDailySalesMail(baseInput);
    expect(result.status).toBe(true);
    expect(result.message).toBe('Mail sent successfully');
  });

  test('calls sendEmail in fallback path when no Brevo apiKey configured', async () => {
    await Sale.sendDailySalesMail(baseInput);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'test@example.com',
        subject: expect.stringContaining('sales report'),
      })
    );
  });

  test('uses Brevo when sendinblue_key is configured', async () => {
    const mockConfig = jest.requireMock('../../../src/config');
    mockConfig.sendinblue_key = 'brevo_test_key';
    const { BrevoClient } = jest.requireMock('@getbrevo/brevo');

    const result = await Sale.sendDailySalesMail(baseInput);

    mockConfig.sendinblue_key = null;
    expect(result.status).toBe(true);
    expect(BrevoClient).toHaveBeenCalled();
  });

  test('aggregates product qty_total correctly', async () => {
    const input = {
      ...baseInput,
      data: {
        ...baseInput.data,
        product_details: [
          {
            product_qty: '2',
            product_subtotal: '100',
            product_total: '110',
            product_profit: '10',
            product_tax: '10',
            product_discount: '0',
            product_name: 'A',
            product_sku: 'A001',
          },
          {
            product_qty: '3',
            product_subtotal: '150',
            product_total: '165',
            product_profit: '15',
            product_tax: '15',
            product_discount: '0',
            product_name: 'B',
            product_sku: 'B002',
          },
        ],
      },
    };
    const result = await Sale.sendDailySalesMail(input);
    expect(result.status).toBe(true);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Total quantity: 5'),
      })
    );
  });

  test('returns {status:false} when email sending throws an error', async () => {
    sendEmail.mockRejectedValueOnce(new Error('SMTP connection refused'));
    const result = await Sale.sendDailySalesMail(baseInput);
    expect(result.status).toBe(false);
    expect(result.message).toBe('SMTP connection refused');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 18. Sale.getQrStatusModel — mocked mongoose.connection
// ══════════════════════════════════════════════════════════════════════════════
describe('Sale.getQrStatusModel', () => {
  let collectionSpy;
  let mockWebhookCol;
  let mockPaymentCol;

  beforeEach(() => {
    mockWebhookCol = { findOne: jest.fn().mockResolvedValue(null) };
    mockPaymentCol = { findOne: jest.fn().mockResolvedValue(null) };
    collectionSpy = jest.spyOn(mongoose.connection, 'collection').mockImplementation((name) => {
      if (name === 'razorpay_webhook') return mockWebhookCol;
      if (name === 'payment') return mockPaymentCol;
      return { findOne: jest.fn().mockResolvedValue(null) };
    });
  });

  afterEach(() => collectionSpy.mockRestore());

  test('returns status:false when no webhook data and no branch context', async () => {
    BaseModel.currentBranch = null;
    BaseModel.license = null;
    const result = await Sale.getQrStatusModel('qr_test_001');
    expect(result.status).toBe(false);
  });

  test('returns status:true with qr_status when webhook data found', async () => {
    mockWebhookCol.findOne.mockResolvedValue({
      event: 'qr_code.credited',
      payload: {
        qr_code: { entity: { id: 'qr_test_001', status: 'closed' } },
        payment: null,
      },
      _id: new mongoose.Types.ObjectId(),
    });
    const result = await Sale.getQrStatusModel('qr_test_001');
    expect(result.status).toBe(true);
    expect(result.data.qr_status).toBe('closed');
    expect(result.data.event).toBe('qr_code.credited');
  });

  test('returns status:true and captured payment_status when payment in webhook', async () => {
    mockWebhookCol.findOne.mockResolvedValue({
      event: 'payment.captured',
      payload: {
        qr_code: { entity: { id: 'qr_test_002', status: 'closed' } },
        payment: { entity: { status: 'captured', id: 'pay_abc' } },
      },
      _id: new mongoose.Types.ObjectId(),
    });
    const result = await Sale.getQrStatusModel('qr_test_002');
    expect(result.status).toBe(true);
    expect(result.data.payment_status).toBe('captured');
  });

  test('handles error gracefully and returns status:false', async () => {
    mockWebhookCol.findOne.mockRejectedValue(new Error('DB failure'));
    const result = await Sale.getQrStatusModel('qr_bad');
    expect(result.status).toBe(false);
    expect(result.message).toContain('DB failure');
  });
});

// ─── Stock snapshots must never fail validation ────────────────────────────────

describe('item_available_quantity is a snapshot, not a constraint', () => {
  /*
   * It records what the item's stock WAS when the line was sold. Stock goes
   * negative on items whose negative_stock flag permits overselling, and the
   * item model puts no floor on available_quantity - so a floor here made the
   * two disagree. The cost was not a bad number: min:0 refused the whole
   * SALE ("Path `item_available_quantity` (-1) is less than minimum allowed
   * value (0)"), so a single item already in the red stopped the cashier
   * taking money for the entire basket.
   */
  test('no minimum is declared on the snapshot', () => {
    expect(pi('item_available_quantity').options.min).toBeUndefined();
  });

  test('a line recording negative stock passes validation', () => {
    // mongoose returns null from doValidateSync when the value is acceptable
    expect(pi('item_available_quantity').doValidateSync(-1)).toBeNull();
    expect(pi('item_available_quantity').doValidateSync(0)).toBeNull();
  });

  test('a real quantity being SOLD still has its floor', () => {
    // the fix is scoped to the snapshot; selling -1 of something stays invalid
    expect(pi('item_discount').options.min).toBe(0);
    expect(saleItemSchema.path('total_amount').options.min).toBe(0);
  });

  test('the item model it mirrors has no floor either', () => {
    const Item = require('../../../src/models/item.model');
    const schema = Item.schema || (Item.LegacyItemModel && null);
    if (schema && schema.path('available_quantity')) {
      expect(schema.path('available_quantity').options.min).toBeUndefined();
    }
  });
});

describe('invoice_key survives the strict schema', () => {
  /*
   * createInvoiceLink stores its S3 key with updateOne({ $set: { invoice_key } }).
   * The schema is strict, and a strict schema STRIPS unknown $set paths without
   * a word - the endpoint kept answering 200 while every call minted a brand
   * new PDF under a brand new key, because the stored key never stuck. The
   * field in the schema is the whole fix; this pin keeps it there.
   */
  test('the schema declares the field the endpoint writes', () => {
    expect(Sale.schema.path('invoice_key')).toBeDefined();
    expect(Sale.schema.path('invoice_key').instance).toBe('String');
  });
});
