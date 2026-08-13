'use strict';

/**
 * Unit tests for src/models/branch.model.js
 *
 * Confirmed filename: branch.model.js (NOT branch.model.js.js)
 *
 * Strategy: Hybrid
 *  A) Pure schema inspection  — Mongoose schema executes without a live DB.
 *  B) Mocked class tests      — BranchModel instance methods are tested by
 *     replacing this.model / this.baseModel with Jest mocks in beforeEach.
 *
 * No real database connection. No production credentials used.
 */

// ─── Module-level mocks (must be declared before any require) ─────────────────

jest.mock('../../../src/models/base.model', () => {
  const MockBaseModel = jest.fn().mockImplementation(() => ({
    checkPlan: jest.fn().mockResolvedValue(-1),
    assignFilterObjects: jest.fn().mockReturnValue({}),
    page: jest.fn().mockResolvedValue({ status: true, data: [], total_count: 0 }),
    getSelectFields: jest.fn().mockReturnValue({}),
    changeLog: jest.fn().mockResolvedValue({ status: true }),
    deletedDocumentBackup: jest.fn().mockResolvedValue({ status: true }),
    getAllDataChanges: jest.fn().mockResolvedValue([]),
  }));
  MockBaseModel.database = null;
  return MockBaseModel;
});

const mockUserFindOne = jest.fn();
const mockUserUpdateMany = jest.fn().mockResolvedValue({ modifiedCount: 1 });

jest.mock('../../../src/models/user.model', () => ({
  findOne: mockUserFindOne,
  updateMany: mockUserUpdateMany,
}));

jest.mock('../../../src/models/customer.model', () => ({}));
jest.mock('../../../src/models/supplier-legacy.model', () => ({}));

// ─── Imports ──────────────────────────────────────────────────────────────────

const mongoose = require('mongoose');
const { Types } = mongoose;

const Branch = require('../../../src/models/branch.model');
const { BranchModel } = require('../../../src/models/branch.model');
const BaseModel = require('../../../src/models/base.model');

// ─── Shorthand helpers ────────────────────────────────────────────────────────

const schema = Branch.schema;
const sp = (field) => schema.path(field);

const validId = () => new Types.ObjectId().toString();
const validObjId = () => new Types.ObjectId();

// ─── Per-test mock state ──────────────────────────────────────────────────────

let bm;
let mockModel;
let mockCollection;
let mockDb;
let consoleErrorSpy;
let consoleLogSpy;

function resetMocks() {
  mockCollection = {
    findOne: jest.fn().mockResolvedValue(null),
    insertOne: jest.fn().mockResolvedValue({ insertedId: validObjId() }),
    updateMany: jest.fn().mockResolvedValue({}),
  };

  mockDb = {
    collection: jest.fn().mockReturnValue(mockCollection),
  };

  mockModel = {
    findOne: jest.fn(),
    findById: jest.fn(),
    findByIdAndUpdate: jest.fn(),
    find: jest.fn(),
    countDocuments: jest.fn().mockResolvedValue(0),
    create: jest.fn(),
    aggregate: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({}),
    collection: { findOne: jest.fn().mockResolvedValue(null) },
    db: mockDb,
  };

  bm = new BranchModel();
  bm.model = mockModel;
  bm.baseModel = {
    checkPlan: jest.fn().mockResolvedValue(-1),
    assignFilterObjects: jest.fn().mockReturnValue({}),
    page: jest.fn().mockResolvedValue({ status: true, data: [], total_count: 0 }),
    getSelectFields: jest.fn().mockReturnValue({}),
    changeLog: jest.fn().mockResolvedValue({ status: true }),
    deletedDocumentBackup: jest.fn().mockResolvedValue({ status: true }),
    getAllDataChanges: jest.fn().mockResolvedValue([]),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  resetMocks();
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  consoleLogSpy.mockRestore();
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Filename confirmation
// ═══════════════════════════════════════════════════════════════════════════════
describe('filename confirmation', () => {
  test('source file is branch.model.js and exports Branch + BranchModel', () => {
    expect(Branch).toBeDefined();
    expect(BranchModel).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Module exports
// ═══════════════════════════════════════════════════════════════════════════════
describe('module exports', () => {
  test('default export has modelName Branch', () => {
    expect(Branch.modelName).toBe('Branch');
  });

  test('.Model export is the Branch Mongoose model', () => {
    const { Model } = require('../../../src/models/branch.model');
    expect(Model.modelName).toBe('Branch');
  });

  test('.BranchModel export is a constructor function', () => {
    const { BranchModel: BM } = require('../../../src/models/branch.model');
    expect(typeof BM).toBe('function');
    expect(new BM()).toBeInstanceOf(BM);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Mongoose schema — required fields
// ═══════════════════════════════════════════════════════════════════════════════
describe('Branch schema — required fields', () => {
  test('branch_name is required', () => {
    expect(sp('branch_name').isRequired).toBe(true);
  });

  test('store_email is optional', () => {
    expect(sp('store_email').isRequired).toBeFalsy();
  });

  test('store_telephone is optional', () => {
    expect(sp('store_telephone').isRequired).toBeFalsy();
  });

  test('license is optional', () => {
    expect(sp('license').isRequired).toBeFalsy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Mongoose schema — field types
// ═══════════════════════════════════════════════════════════════════════════════
describe('Branch schema — field types', () => {
  test('branch_name is String', () => {
    expect(sp('branch_name').instance).toBe('String');
  });

  test('branch_id is ObjectId with ref Branch', () => {
    expect(sp('branch_id').instance).toBe('ObjectId');
    expect(sp('branch_id').options.ref).toBe('Branch');
  });

  test('default_supplier is ObjectId with ref Supplier', () => {
    expect(sp('default_supplier').instance).toBe('ObjectId');
    expect(sp('default_supplier').options.ref).toBe('Supplier');
  });

  test('default_customer is ObjectId with ref Customer', () => {
    expect(sp('default_customer').instance).toBe('ObjectId');
    expect(sp('default_customer').options.ref).toBe('Customer');
  });

  test('created_by_id is ObjectId with ref User', () => {
    expect(sp('created_by_id').instance).toBe('ObjectId');
    expect(sp('created_by_id').options.ref).toBe('User');
  });

  test('license is ObjectId with ref License', () => {
    expect(sp('license').instance).toBe('ObjectId');
    expect(sp('license').options.ref).toBe('License');
  });

  test('discount_amount is Number', () => {
    expect(sp('discount_amount').instance).toBe('Number');
  });

  test('discount_percentage is Number', () => {
    expect(sp('discount_percentage').instance).toBe('Number');
  });

  test('auto_sms is Boolean', () => {
    expect(sp('auto_sms').instance).toBe('Boolean');
  });

  test('balance_view is Boolean', () => {
    expect(sp('balance_view').instance).toBe('Boolean');
  });

  test('register is Array', () => {
    expect(sp('register').instance).toBe('Array');
  });

  test('currency_type is Array', () => {
    expect(sp('currency_type').instance).toBe('Array');
  });

  test('created_date is Date', () => {
    expect(sp('created_date').instance).toBe('Date');
  });

  test('print_controls is defined in schema', () => {
    expect(sp('print_controls')).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Mongoose schema — default values
// ═══════════════════════════════════════════════════════════════════════════════
describe('Branch schema — default values', () => {
  test('logo defaults to store.png', () => {
    expect(sp('logo').defaultValue).toBe('store.png');
  });

  test('time_zone defaults to Asia/Calcutta', () => {
    expect(sp('time_zone').defaultValue).toBe('Asia/Calcutta');
  });

  test('time_format defaults to enable', () => {
    expect(sp('time_format').defaultValue).toBe('enable');
  });

  test('register defaults to []', () => {
    expect(sp('register').defaultValue()).toEqual([]);
  });

  test('currency_type defaults to []', () => {
    expect(sp('currency_type').defaultValue()).toEqual([]);
  });

  test('cashdenom_fields defaults to []', () => {
    expect(sp('cashdenom_fields').defaultValue()).toEqual([]);
  });

  test('email_fields defaults to []', () => {
    expect(sp('email_fields').defaultValue()).toEqual([]);
  });

  test('payment_gateway defaults to []', () => {
    expect(sp('payment_gateway').defaultValue()).toEqual([]);
  });

  test('kiosk defaults to []', () => {
    expect(sp('kiosk').defaultValue()).toEqual([]);
  });

  test('auto_sms defaults to false', () => {
    expect(sp('auto_sms').defaultValue).toBe(false);
  });

  test('sales_sms defaults to false', () => {
    expect(sp('sales_sms').defaultValue).toBe(false);
  });

  test('balance_view defaults to true', () => {
    expect(sp('balance_view').defaultValue).toBe(true);
  });

  test('stock_management defaults to false', () => {
    expect(sp('stock_management').defaultValue).toBe(false);
  });

  test('roundOff defaults to false', () => {
    expect(sp('roundOff').defaultValue).toBe(false);
  });

  test('whatsapp_device_id defaults to empty string', () => {
    expect(sp('whatsapp_device_id').defaultValue).toBe('');
  });

  test('sales_prefix defaults to S', () => {
    expect(sp('sales_prefix').defaultValue).toBe('S');
  });

  test('receiving_prefix defaults to RID', () => {
    expect(sp('receiving_prefix').defaultValue).toBe('RID');
  });

  test('printing_size defaults to receipt_medium', () => {
    expect(sp('printing_size').defaultValue).toBe('receipt_medium');
  });

  test('header_print defaults to default', () => {
    expect(sp('header_print').defaultValue).toBe('default');
  });

  test('client_dateformat defaults to yyyy/mm/dd', () => {
    expect(sp('client_dateformat').defaultValue).toBe('yyyy/mm/dd');
  });

  test('server_dateformat defaults to Y/m/d', () => {
    expect(sp('server_dateformat').defaultValue).toBe('Y/m/d');
  });

  test('phonepe_payment_gateway defaults to null', () => {
    expect(sp('phonepe_payment_gateway').defaultValue).toBeNull();
  });

  test('currency_value defaults to []', () => {
    expect(sp('currency_value').defaultValue()).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Mongoose schema — options
// ═══════════════════════════════════════════════════════════════════════════════
describe('Branch schema — options', () => {
  test('timestamps are mapped to created_date and updated_date', () => {
    expect(schema.options.timestamps).toEqual({
      createdAt: 'created_date',
      updatedAt: 'updated_date',
    });
  });

  test('versionKey is false', () => {
    expect(schema.options.versionKey).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. print_character duplicate-key note (production code issue)
// ═══════════════════════════════════════════════════════════════════════════════
describe('Branch schema — print_character duplicate key', () => {
  test('print_character is defined (second definition without default wins)', () => {
    // The schema defines print_character twice: line 89 with default:'default'
    // and line 123 without a default. Mongoose uses the last definition.
    // This is a known production code smell — the original default is lost.
    expect(sp('print_character')).toBeDefined();
    expect(sp('print_character').instance).toBe('String');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. simplifyDocument (module-level, accessed via BranchModel static)
// ═══════════════════════════════════════════════════════════════════════════════
describe('BranchModel.simplifyDocument (static)', () => {
  const sd = (d) => BranchModel.simplifyDocument(d);

  test('returns null as-is', () => {
    expect(sd(null)).toBeNull();
  });

  test('returns a string primitive as-is', () => {
    expect(sd('hello')).toBe('hello');
  });

  test('returns a number primitive as-is', () => {
    expect(sd(42)).toBe(42);
  });

  test('converts ObjectId field to string', () => {
    const oid = new Types.ObjectId();
    const result = sd({ _id: oid });
    expect(result._id).toBe(oid.toString());
  });

  test('adds id alias from _id after conversion', () => {
    const oid = new Types.ObjectId();
    const result = sd({ _id: oid });
    expect(result.id).toBe(oid.toString());
  });

  test('does not overwrite an existing id field', () => {
    const oid = new Types.ObjectId();
    const result = sd({ _id: oid, id: 'preset' });
    expect(result.id).toBe('preset');
  });

  test('converts Date field to ISO string', () => {
    const d = new Date('2024-01-15T10:00:00.000Z');
    const result = sd({ created_date: d });
    expect(result.created_date).toBe(d.toISOString());
  });

  test('processes arrays of objects recursively', () => {
    const oid = new Types.ObjectId();
    const result = sd([{ _id: oid }]);
    expect(result[0]._id).toBe(oid.toString());
  });

  test('processes nested objects recursively', () => {
    const oid = new Types.ObjectId();
    const result = sd({ nested: { ref: oid } });
    expect(result.nested.ref).toBe(oid.toString());
  });

  test('leaves string, number, boolean fields unchanged', () => {
    const result = sd({ name: 'Branch A', count: 5, active: true });
    expect(result.name).toBe('Branch A');
    expect(result.count).toBe(5);
    expect(result.active).toBe(true);
  });

  test('handles object with mixed field types', () => {
    const oid = new Types.ObjectId();
    const d = new Date('2024-06-01T00:00:00.000Z');
    const result = sd({ _id: oid, created_date: d, name: 'X', count: 1 });
    expect(result._id).toBe(oid.toString());
    expect(result.created_date).toBe(d.toISOString());
    expect(result.name).toBe('X');
    expect(result.count).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. BranchModel constructor
// ═══════════════════════════════════════════════════════════════════════════════
describe('BranchModel constructor', () => {
  test('exposes this.model', () => {
    const instance = new BranchModel();
    expect(instance.model).toBeDefined();
  });

  test('creates baseModel via new BaseModel("branches")', () => {
    expect(BaseModel).toHaveBeenCalledWith('branches');
  });

  test('fields map has branch_name with select:true', () => {
    const instance = new BranchModel();
    expect(instance.fields.branch_name).toMatchObject({ type: 'String', select: true });
  });

  test('fields map marks license with select:false', () => {
    const instance = new BranchModel();
    expect(instance.fields.license).toMatchObject({ select: false });
  });

  test('fields map has payment_gateway with defaultValue []', () => {
    const instance = new BranchModel();
    expect(instance.fields.payment_gateway.defaultValue).toEqual([]);
  });

  test('fields map has time_zone with defaultValue Asia/Calcutta', () => {
    const instance = new BranchModel();
    expect(instance.fields.time_zone.defaultValue).toBe('Asia/Calcutta');
  });

  test('fields map has time_format with defaultValue enable', () => {
    const instance = new BranchModel();
    expect(instance.fields.time_format.defaultValue).toBe('enable');
  });

  test('fields map marks created_by with select:false', () => {
    const instance = new BranchModel();
    expect(instance.fields.created_by).toMatchObject({ select: false });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. fillDefaultValue
// ═══════════════════════════════════════════════════════════════════════════════
describe('BranchModel.fillDefaultValue', () => {
  test('returns null as-is', () => {
    expect(bm.fillDefaultValue(null)).toBeNull();
  });

  test('returns string primitive as-is', () => {
    expect(bm.fillDefaultValue('raw')).toBe('raw');
  });

  test('returns number primitive as-is', () => {
    expect(bm.fillDefaultValue(0)).toBe(0);
  });

  test('fills missing select:true field with null', () => {
    const doc = { branch_name: 'Test' };
    const result = bm.fillDefaultValue(doc);
    expect(result).toHaveProperty('city');
    expect(result.city).toBeNull();
  });

  test('uses defaultValue from fields map when defined', () => {
    const doc = {};
    const result = bm.fillDefaultValue(doc);
    expect(result.payment_gateway).toEqual([]);
    expect(result.time_zone).toBe('Asia/Calcutta');
    expect(result.time_format).toBe('enable');
  });

  test('does not overwrite existing field values', () => {
    const doc = { city: 'Mumbai', time_zone: 'UTC' };
    const result = bm.fillDefaultValue(doc);
    expect(result.city).toBe('Mumbai');
    expect(result.time_zone).toBe('UTC');
  });

  test('ignores select:false fields (does not inject them)', () => {
    const doc = {};
    const result = bm.fillDefaultValue(doc);
    expect(result).not.toHaveProperty('license');
    expect(result).not.toHaveProperty('created_by');
    expect(result).not.toHaveProperty('updated_by');
  });

  test('fills multiple missing fields in one call', () => {
    const doc = { branch_name: 'HQ' };
    const result = bm.fillDefaultValue(doc);
    expect(result).toHaveProperty('store_email');
    expect(result).toHaveProperty('store_telephone');
    expect(result).toHaveProperty('country');
    expect(result).toHaveProperty('logo');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. buildFilters
// ═══════════════════════════════════════════════════════════════════════════════
describe('BranchModel.buildFilters', () => {
  test('returns empty object for empty input', () => {
    expect(bm.buildFilters({})).toEqual({});
  });

  test('returns empty object for null input', () => {
    expect(bm.buildFilters(null)).toEqual({});
  });

  test('adds branch_name as case-insensitive regex', () => {
    const q = bm.buildFilters({ branch_name: 'test' });
    expect(q.branch_name).toEqual({ $regex: 'test', $options: 'i' });
  });

  test('adds country as exact match', () => {
    const q = bm.buildFilters({ country: 'India' });
    expect(q.country).toBe('India');
  });

  test('adds state as exact match', () => {
    const q = bm.buildFilters({ state: 'Kerala' });
    expect(q.state).toBe('Kerala');
  });

  test('adds city as exact match', () => {
    const q = bm.buildFilters({ city: 'Kochi' });
    expect(q.city).toBe('Kochi');
  });

  test('adds license when value is a valid ObjectId string', () => {
    const id = validId();
    const q = bm.buildFilters({ license: id });
    expect(q.license).toBe(id);
  });

  test('ignores license when value is not a valid ObjectId', () => {
    const q = bm.buildFilters({ license: 'bad-id' });
    expect(q.license).toBeUndefined();
  });

  test('adds _id when value is a valid ObjectId string', () => {
    const id = validId();
    const q = bm.buildFilters({ _id: id });
    expect(q._id).toBe(id);
  });

  test('ignores _id when value is not a valid ObjectId', () => {
    const q = bm.buildFilters({ _id: 'xyz' });
    expect(q._id).toBeUndefined();
  });

  test('does not include unknown/arbitrary filter keys', () => {
    const q = bm.buildFilters({ random_key: 'value' });
    expect(q.random_key).toBeUndefined();
  });

  test('handles multiple valid filters simultaneously', () => {
    const licId = validId();
    const q = bm.buildFilters({ branch_name: 'HQ', country: 'IN', license: licId });
    expect(q.branch_name).toBeDefined();
    expect(q.country).toBe('IN');
    expect(q.license).toBe(licId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. getRegisterList
// ═══════════════════════════════════════════════════════════════════════════════
describe('BranchModel.getRegisterList', () => {
  test('returns status:false for null branchId', async () => {
    const r = await bm.getRegisterList(null);
    expect(r.status).toBe(false);
    expect(r.message).toBe('Branch id is required');
  });

  test('returns status:false for invalid ObjectId string', async () => {
    const r = await bm.getRegisterList('not-a-valid-id');
    expect(r.status).toBe(false);
    expect(r.message).toBe('Branch id is required');
  });

  test('returns status:false when branch not found', async () => {
    mockModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    const r = await bm.getRegisterList(validId());
    expect(r.status).toBe(false);
    expect(r.message).toBe('Branch not found');
  });

  test('returns open_register:null when no user provided', async () => {
    const registers = [{ register_id: validObjId(), register_name: 'Main' }];
    mockModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ register: registers }),
    });
    const r = await bm.getRegisterList(validId());
    expect(r.status).toBe(true);
    expect(r.data.open_register).toBeNull();
  });

  test('returns formatted register_data on success', async () => {
    const regId = validObjId();
    mockModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        register: [{ register_id: regId, register_name: 'Cashier 1' }],
      }),
    });
    const r = await bm.getRegisterList(validId());
    expect(r.status).toBe(true);
    expect(r.data.register_data).toHaveLength(1);
    expect(r.data.register_data[0].register_name).toBe('Cashier 1');
    expect(typeof r.data.register_data[0].register_id).toBe('string');
  });

  test('returns empty register_data when branch.register is not an array', async () => {
    mockModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ register: null }),
    });
    const r = await bm.getRegisterList(validId());
    expect(r.status).toBe(true);
    expect(r.data.register_data).toEqual([]);
  });

  test('includes open_register when user is provided and cashregister record exists', async () => {
    const cashRegId = validObjId();
    const regId = validObjId();
    mockCollection.findOne.mockResolvedValue({
      _id: cashRegId,
      register_id: regId,
      register_name: 'Main',
      register_status: 'Opened',
    });
    mockModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ register: [] }),
    });
    const user = { _id: validObjId(), license: validObjId() };
    const r = await bm.getRegisterList(validId(), user);
    expect(r.status).toBe(true);
    expect(r.data.open_register).not.toBeNull();
    expect(r.data.open_register.cash_register_id).toBe(cashRegId.toString());
    expect(r.data.open_register.register_name).toBe('Main');
  });

  test('returns status:false when an exception is thrown', async () => {
    mockModel.findById.mockImplementation(() => {
      throw new Error('DB failure');
    });
    const r = await bm.getRegisterList(validId());
    expect(r.status).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 13. getBranchDetails
// ═══════════════════════════════════════════════════════════════════════════════
describe('BranchModel.getBranchDetails', () => {
  test('returns status:false for null id', async () => {
    const r = await bm.getBranchDetails(null);
    expect(r.status).toBe(false);
    expect(r.message).toBe('Branch id is required');
  });

  test('returns status:false for invalid id', async () => {
    const r = await bm.getBranchDetails('not-an-id');
    expect(r.status).toBe(false);
    expect(r.message).toBe('Branch id is required');
  });

  test('returns status:false when branch not found', async () => {
    mockModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    const r = await bm.getBranchDetails(validId());
    expect(r.status).toBe(false);
    expect(r.message).toBe('Branch not found');
  });

  test('returns status:true with data on success', async () => {
    const doc = {
      _id: validObjId(),
      branch_name: 'HQ',
      time_zone: 'Asia/Kolkata',
      time_format: 'enable',
      currency_value: [{ currency_text: 'INR', currency_sign: '₹' }],
    };
    mockModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(doc) });
    const r = await bm.getBranchDetails(validId());
    expect(r.status).toBe(true);
    expect(r.data).toBeDefined();
    expect(r.data.branch_name).toBe('HQ');
  });

  test('applies time_zone fallback when missing or empty', async () => {
    const doc = { _id: validObjId(), branch_name: 'X', time_zone: '', currency_value: [] };
    mockModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(doc) });
    const r = await bm.getBranchDetails(validId());
    expect(r.data.time_zone).toBe('Asia/Calcutta');
  });

  test('applies time_format fallback when null', async () => {
    const doc = { _id: validObjId(), branch_name: 'X', time_format: null, currency_value: [] };
    mockModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(doc) });
    const r = await bm.getBranchDetails(validId());
    expect(r.data.time_format).toBe('enable');
  });

  test('applies INR default when currency_value is empty', async () => {
    const doc = { _id: validObjId(), branch_name: 'X', currency_value: [] };
    mockModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(doc) });
    const r = await bm.getBranchDetails(validId());
    expect(r.data.currency_value[0].currency_text).toBe('INR');
    expect(r.data.currency_value[0].currency_sign).toBe('₹');
  });

  test('sets razorKey and razorUrl to null when user context is absent', async () => {
    const doc = { _id: validObjId(), branch_name: 'X', currency_value: [] };
    mockModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(doc) });
    const r = await bm.getBranchDetails(validId());
    expect(r.data.razorKey).toBeNull();
    expect(r.data.razorUrl).toBeNull();
  });

  test('applies boolean defaults for notification fields', async () => {
    const doc = { _id: validObjId(), branch_name: 'X', currency_value: [] };
    mockModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(doc) });
    const r = await bm.getBranchDetails(validId());
    expect(r.data.enable_notification_reminders).toBe(false);
    expect(r.data.enable_email_reminders).toBe(false);
    expect(r.data.enable_sms_reminders).toBe(false);
    expect(r.data.enable_sms_auto_send).toBe(false);
  });

  test('applies string defaults for SMS fields', async () => {
    const doc = { _id: validObjId(), branch_name: 'X', currency_value: [] };
    mockModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(doc) });
    const r = await bm.getBranchDetails(validId());
    expect(r.data.sms_auto_send_time).toBe('10:00 am');
    expect(r.data.sms_retry_period).toBe('24');
    expect(r.data.sms_max_retries).toBe('2');
  });

  test('returns status:false when an exception is thrown', async () => {
    mockModel.findById.mockImplementation(() => {
      throw new Error('fail');
    });
    const r = await bm.getBranchDetails(validId());
    expect(r.status).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 14. getAllBranches
// ═══════════════════════════════════════════════════════════════════════════════
describe('BranchModel.getAllBranches', () => {
  function buildChain(items = []) {
    return {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(items),
    };
  }

  test('returns paginated result with correct structure', async () => {
    mockModel.find.mockReturnValue(buildChain());
    mockModel.countDocuments.mockResolvedValue(0);
    const r = await bm.getAllBranches({}, 1, 10);
    expect(r.status).toBe(true);
    expect(r.pagination).toMatchObject({ total: 0, page: 1, limit: 10 });
  });

  test('clamps page to 1 when a negative page is supplied', async () => {
    mockModel.find.mockReturnValue(buildChain());
    mockModel.countDocuments.mockResolvedValue(0);
    const r = await bm.getAllBranches({}, -5, 10);
    expect(r.pagination.page).toBe(1);
  });

  test('clamps page to 1 when page is 0', async () => {
    mockModel.find.mockReturnValue(buildChain());
    mockModel.countDocuments.mockResolvedValue(0);
    const r = await bm.getAllBranches({}, 0, 10);
    expect(r.pagination.page).toBe(1);
  });

  test('calculates total pages correctly', async () => {
    mockModel.find.mockReturnValue(buildChain());
    mockModel.countDocuments.mockResolvedValue(25);
    const r = await bm.getAllBranches({}, 1, 10);
    expect(r.pagination.pages).toBe(3);
  });

  test('returns minimum 1 page even when total is 0', async () => {
    mockModel.find.mockReturnValue(buildChain());
    mockModel.countDocuments.mockResolvedValue(0);
    const r = await bm.getAllBranches({}, 1, 10);
    expect(r.pagination.pages).toBe(1);
  });

  test('returns data array from find', async () => {
    const items = [{ branch_name: 'A' }, { branch_name: 'B' }];
    mockModel.find.mockReturnValue(buildChain(items));
    mockModel.countDocuments.mockResolvedValue(2);
    const r = await bm.getAllBranches();
    expect(r.data).toHaveLength(2);
  });

  test('returns status:false when an exception is thrown', async () => {
    mockModel.find.mockImplementation(() => {
      throw new Error('db error');
    });
    const r = await bm.getAllBranches();
    expect(r.status).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 15. getBranchById
// ═══════════════════════════════════════════════════════════════════════════════
describe('BranchModel.getBranchById', () => {
  test('returns status:false for null id', async () => {
    const r = await bm.getBranchById(null);
    expect(r.status).toBe(false);
  });

  test('returns status:false for invalid id string', async () => {
    const r = await bm.getBranchById('bad');
    expect(r.status).toBe(false);
  });

  test('returns status:false when branch not found', async () => {
    mockModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    const r = await bm.getBranchById(validId());
    expect(r.status).toBe(false);
    expect(r.message).toBe('Branch not found');
  });

  test('returns status:true with simplified document', async () => {
    const id = validObjId();
    const doc = { _id: id, branch_name: 'Branch A', created_date: new Date() };
    mockModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(doc) });
    const r = await bm.getBranchById(id.toString());
    expect(r.status).toBe(true);
    expect(r.data._id).toBe(id.toString());
  });

  test('simplifies ObjectId to string in returned data', async () => {
    const id = validObjId();
    const doc = { _id: id, branch_name: 'X' };
    mockModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(doc) });
    const r = await bm.getBranchById(id.toString());
    expect(typeof r.data._id).toBe('string');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 16. createBranch
// ═══════════════════════════════════════════════════════════════════════════════
describe('BranchModel.createBranch', () => {
  const user = {
    _id: validObjId(),
    username: 'admin',
    license: validObjId(),
  };
  const data = {
    name: 'New Branch',
    country: 'IN',
    state: 'KL',
    email: 'test@test.com',
    phone: '9999999999',
    register: ['Main Register'],
  };

  test('returns status:exist when a duplicate is found', async () => {
    mockModel.findOne.mockResolvedValue({ _id: validObjId() });
    const r = await bm.createBranch(data, user);
    expect(r.status).toBe('exist');
    expect(r.message).toMatch(/already exist/i);
  });

  test('returns status:false when plan branch limit is reached', async () => {
    mockModel.findOne.mockResolvedValue(null);
    const limitedUser = { ...user, plan_access: { branches: { add: '1' } } };
    mockModel.countDocuments.mockResolvedValue(1);
    const r = await bm.createBranch(data, limitedUser);
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/maximum/i);
  });

  test('returns status:true with insertId on successful create', async () => {
    const branchId = validObjId();
    mockModel.findOne.mockResolvedValue(null);
    mockModel.create.mockResolvedValue({ _id: branchId });
    mockModel.updateOne.mockResolvedValue({});
    mockUserUpdateMany.mockResolvedValue({});
    mockUserFindOne.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ branch_access: [] }),
    });
    const r = await bm.createBranch(data, user);
    expect(r.status).toBe(true);
    expect(r.data.insertId).toBe(branchId.toString());
  });

  test('returns branchList array on success', async () => {
    const branchId = validObjId();
    mockModel.findOne.mockResolvedValue(null);
    mockModel.create.mockResolvedValue({ _id: branchId });
    mockModel.updateOne.mockResolvedValue({});
    mockUserUpdateMany.mockResolvedValue({});
    mockUserFindOne.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({
        branch_access: [
          { branch_id: branchId, branch_name: 'New Branch', branch_image: 'store.png' },
        ],
      }),
    });
    const r = await bm.createBranch(data, user);
    expect(r.status).toBe(true);
    expect(Array.isArray(r.data.branchList)).toBe(true);
    expect(r.data.branchList[0].branch_name).toBe('New Branch');
  });

  test('returns status:false when an exception is thrown', async () => {
    mockModel.findOne.mockRejectedValue(new Error('DB error'));
    const r = await bm.createBranch(data, user);
    expect(r.status).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 17. updateBranch
// ═══════════════════════════════════════════════════════════════════════════════
describe('BranchModel.updateBranch', () => {
  const user = { _id: validObjId(), username: 'admin', license: validObjId() };
  const data = {
    name: 'Updated Branch',
    country: 'IN',
    state: 'KL',
    address: '123 Main St',
    email: 'a@b.com',
    phone: '1234567890',
    register: [],
  };

  test('returns status:false for an invalid id', async () => {
    const r = await bm.updateBranch('bad-id', data, user);
    expect(r.status).toBe(false);
    expect(r.message).toBe('Branch id is required');
  });

  test('returns status:false for null id', async () => {
    const r = await bm.updateBranch(null, data, user);
    expect(r.status).toBe(false);
  });

  test('returns status:false when branch not found after update', async () => {
    mockModel.findByIdAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue(null),
    });
    const r = await bm.updateBranch(validId(), data, user);
    expect(r.status).toBe(false);
    expect(r.message).toBe('Branch not found');
  });

  test('returns status:true with message on success', async () => {
    const id = validObjId();
    const doc = { _id: id, branch_name: 'Updated Branch' };
    mockModel.findByIdAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue(doc),
    });
    mockUserUpdateMany.mockResolvedValue({});
    jest.spyOn(bm, 'updateBranchNameInCollections').mockResolvedValue();
    const r = await bm.updateBranch(id.toString(), data, user);
    expect(r.status).toBe(true);
    expect(r.message).toBe('Branch updated successfully');
  });

  test('calls updateBranchNameInCollections on success', async () => {
    const id = validObjId();
    mockModel.findByIdAndUpdate.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: id, branch_name: 'Updated' }),
    });
    mockUserUpdateMany.mockResolvedValue({});
    const spy = jest.spyOn(bm, 'updateBranchNameInCollections').mockResolvedValue();
    await bm.updateBranch(id.toString(), data, user);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('returns status:false when an exception is thrown', async () => {
    mockModel.findByIdAndUpdate.mockImplementation(() => {
      throw new Error('fail');
    });
    const r = await bm.updateBranch(validId(), data, user);
    expect(r.status).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 18. getBranchRegisterList
// ═══════════════════════════════════════════════════════════════════════════════
describe('BranchModel.getBranchRegisterList', () => {
  test('returns status:false when all IDs are invalid', async () => {
    const r = await bm.getBranchRegisterList(['bad-id']);
    expect(r.status).toBe(false);
    expect(r.message).toBe('Invalid Branch IDs');
  });

  test('returns status:false for empty array', async () => {
    const r = await bm.getBranchRegisterList([]);
    expect(r.status).toBe(false);
    expect(r.message).toBe('Invalid Branch IDs');
  });

  test('accepts a single string branchId', async () => {
    mockModel.aggregate.mockResolvedValue([]);
    const r = await bm.getBranchRegisterList(validId());
    expect(r.status).toBe(true);
    expect(r.data).toEqual([]);
  });

  test('returns formatted register list on success', async () => {
    const regId = validObjId();
    const branchId = validObjId();
    mockModel.aggregate.mockResolvedValue([
      {
        register_id: regId,
        register_name: 'Cashier',
        branch_name: 'HQ',
        branch_id: branchId,
      },
    ]);
    const r = await bm.getBranchRegisterList([branchId.toString()]);
    expect(r.status).toBe(true);
    expect(r.data).toHaveLength(1);
    expect(r.data[0].register_name).toBe('Cashier');
    expect(typeof r.data[0].register_id).toBe('string');
    expect(typeof r.data[0].branch_id).toBe('string');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 19. userRegisterBranchSelect (alias)
// ═══════════════════════════════════════════════════════════════════════════════
describe('BranchModel.userRegisterBranchSelect', () => {
  test('delegates to getRegisterList with the same argument', async () => {
    const spy = jest.spyOn(bm, 'getRegisterList').mockResolvedValue({ status: true, data: {} });
    const id = validId();
    await bm.userRegisterBranchSelect(id);
    expect(spy).toHaveBeenCalledWith(id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 20. getPaymentGatewaySettings
// ═══════════════════════════════════════════════════════════════════════════════
describe('BranchModel.getPaymentGatewaySettings', () => {
  test('returns status:false when branchId is missing', async () => {
    const r = await bm.getPaymentGatewaySettings(null, validId());
    expect(r.status).toBe(false);
    expect(r.message).toBe('Branch ID required');
  });

  test('returns status:false when licenseId is missing', async () => {
    const r = await bm.getPaymentGatewaySettings(validId(), null);
    expect(r.status).toBe(false);
    expect(r.message).toBe('License ID required');
  });

  test('returns status:false when branch not found', async () => {
    mockModel.collection.findOne.mockResolvedValue(null);
    const r = await bm.getPaymentGatewaySettings(validId(), validId());
    expect(r.status).toBe(false);
    expect(r.message).toBe('Branch not found');
  });

  test('returns payment_gateway data on success', async () => {
    const gateway = [{ name: 'razorpay', status: true }];
    mockModel.collection.findOne.mockResolvedValue({ payment_gateway: gateway });
    const r = await bm.getPaymentGatewaySettings(validId(), validId());
    expect(r.status).toBe(true);
    expect(r.data).toEqual(gateway);
  });

  test('returns null when payment_gateway is absent from document', async () => {
    mockModel.collection.findOne.mockResolvedValue({});
    const r = await bm.getPaymentGatewaySettings(validId(), validId());
    expect(r.status).toBe(true);
    expect(r.data).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 21. getPhonePePaymentGatewaySettings
// ═══════════════════════════════════════════════════════════════════════════════
describe('BranchModel.getPhonePePaymentGatewaySettings', () => {
  test('returns status:false when branchId is missing', async () => {
    const r = await bm.getPhonePePaymentGatewaySettings(null);
    expect(r.status).toBe(false);
    expect(r.message).toBe('Branch ID required');
  });

  test('returns status:false when branch not found', async () => {
    mockModel.collection.findOne.mockResolvedValue(null);
    const r = await bm.getPhonePePaymentGatewaySettings(validId());
    expect(r.status).toBe(false);
    expect(r.message).toBe('Branch not found');
  });

  test('returns phonepe_payment_gateway when present', async () => {
    const pgData = { merchantId: 'M123', saltKey: 'KEY', name: 'phonepe', status: true };
    mockModel.collection.findOne.mockResolvedValue({ phonepe_payment_gateway: pgData });
    const r = await bm.getPhonePePaymentGatewaySettings(validId());
    expect(r.status).toBe(true);
    expect(r.data).toEqual(pgData);
  });

  test('returns default PhonePe structure when field is absent', async () => {
    mockModel.collection.findOne.mockResolvedValue({});
    const r = await bm.getPhonePePaymentGatewaySettings(validId());
    expect(r.status).toBe(true);
    expect(r.data.name).toBe('phonepe');
    expect(r.data.status).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 22. getEmailSettings
// ═══════════════════════════════════════════════════════════════════════════════
describe('BranchModel.getEmailSettings', () => {
  test('returns status:false when branchId is missing', async () => {
    const r = await bm.getEmailSettings(null, validId());
    expect(r.status).toBe(false);
    expect(r.message).toBe('Branch ID required');
  });

  test('returns status:false when licenseId is missing', async () => {
    const r = await bm.getEmailSettings(validId(), null);
    expect(r.status).toBe(false);
    expect(r.message).toBe('License ID required');
  });

  test('returns status:false when branch not found', async () => {
    mockModel.collection.findOne.mockResolvedValue(null);
    const r = await bm.getEmailSettings(validId(), validId());
    expect(r.status).toBe(false);
    expect(r.message).toBe('Branch not found');
  });

  test('returns email_fields array on success', async () => {
    const emailFields = [{ branch_id: validObjId(), email_address: [], report_type: 'daily' }];
    mockModel.collection.findOne.mockResolvedValue({ email_fields: emailFields });
    const r = await bm.getEmailSettings(validId(), validId());
    expect(r.status).toBe(true);
    expect(r.data).toEqual(emailFields);
  });

  test('returns empty array when email_fields is absent', async () => {
    mockModel.collection.findOne.mockResolvedValue({});
    const r = await bm.getEmailSettings(validId(), validId());
    expect(r.status).toBe(true);
    expect(r.data).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 23. deleteBranchCollectionData
// ═══════════════════════════════════════════════════════════════════════════════
describe('BranchModel.deleteBranchCollectionData', () => {
  const masterBranchId = validObjId();
  const user = {
    _id: validObjId(),
    license: validObjId(),
    branch_id: masterBranchId,
  };

  test('returns status:false when trying to delete the current (master) branch', async () => {
    const r = await bm.deleteBranchCollectionData([masterBranchId.toString()], user);
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/Master Branch/i);
  });

  test('returns status:true on successful delete of a non-master branch', async () => {
    const otherId = validId();
    mockModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: validObjId() }]) });
    mockModel.deleteMany.mockResolvedValue({});
    jest.spyOn(bm, 'getBranches').mockResolvedValue({ status: true, data: [] });
    const r = await bm.deleteBranchCollectionData([otherId], user);
    expect(r.status).toBe(true);
    expect(r.message).toBe('Branch deleted successfully');
  });

  test('calls changeLog for each deleted branch id', async () => {
    const otherId = validId();
    mockModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: validObjId() }]) });
    mockModel.deleteMany.mockResolvedValue({});
    jest.spyOn(bm, 'getBranches').mockResolvedValue({ status: true, data: [] });
    await bm.deleteBranchCollectionData([otherId], user);
    expect(bm.baseModel.changeLog).toHaveBeenCalledWith(
      'branches',
      user._id,
      expect.any(Types.ObjectId),
      'delete'
    );
  });

  test('returns status:false when an exception is thrown', async () => {
    const otherId = validId();
    mockModel.find.mockReturnValue({ lean: jest.fn().mockRejectedValue(new Error('DB fail')) });
    const r = await bm.deleteBranchCollectionData([otherId], user);
    expect(r.status).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 24. getBranches
// ═══════════════════════════════════════════════════════════════════════════════
describe('BranchModel.getBranches', () => {
  const user = { _id: validObjId(), license: validObjId() };

  test('returns empty array when user doc has no branch_access', async () => {
    mockUserFindOne.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ branch_access: null }),
    });
    const r = await bm.getBranches(user);
    expect(r.status).toBe(true);
    expect(r.data).toEqual([]);
  });

  test('returns empty array when user doc is not found', async () => {
    mockUserFindOne.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(null),
    });
    const r = await bm.getBranches(user);
    expect(r.status).toBe(true);
    expect(r.data).toEqual([]);
  });

  test('returns formatted branch list with id, branch_name, branch_image', async () => {
    const branchId = validObjId();
    mockUserFindOne.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({
        branch_access: [{ branch_id: branchId, branch_name: 'HQ', branch_image: 'store.png' }],
      }),
    });
    const r = await bm.getBranches(user);
    expect(r.status).toBe(true);
    expect(r.data).toHaveLength(1);
    expect(r.data[0].id).toBe(branchId.toString());
    expect(r.data[0].branch_name).toBe('HQ');
    expect(r.data[0].branch_image).toBe('store.png');
  });

  test('returns status:false when an exception is thrown', async () => {
    mockUserFindOne.mockImplementation(() => {
      throw new Error('fail');
    });
    const r = await bm.getBranches(user);
    expect(r.status).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 25. exportBranchOrder
// ═══════════════════════════════════════════════════════════════════════════════
describe('BranchModel.exportBranchOrder', () => {
  test('returns status:false for empty array', async () => {
    const r = await bm.exportBranchOrder([], validId());
    expect(r.status).toBe(false);
    expect(r.message).toBe('No branch IDs provided');
  });

  test('returns status:false when all IDs are falsy', async () => {
    const r = await bm.exportBranchOrder([null, undefined, ''], validId());
    expect(r.status).toBe(false);
    expect(r.message).toBe('No branch IDs provided');
  });

  test('returns exported branch data on success', async () => {
    const branches = [{ branch_name: 'HQ', store_email: 'hq@test.com', store_telephone: '000' }];
    mockModel.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(branches),
    });
    const r = await bm.exportBranchOrder([validId()], validId());
    expect(r.status).toBe(true);
    expect(r.data).toEqual(branches);
    expect(r.message).toBe('Branch Data Exported');
  });

  test('accepts data as an object (not just array) of IDs', async () => {
    mockModel.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([]),
    });
    const r = await bm.exportBranchOrder({ 0: validId() }, validId());
    expect(r.status).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 26. BranchModel.getDataChanges (static)
// ═══════════════════════════════════════════════════════════════════════════════
describe('BranchModel.getDataChanges (static)', () => {
  test('creates a new BaseModel("branches") internally', async () => {
    BaseModel.mockClear();
    BaseModel.mockImplementation(() => ({ getAllDataChanges: jest.fn().mockResolvedValue([]) }));
    await BranchModel.getDataChanges('branches', '2024-01-01');
    expect(BaseModel).toHaveBeenCalledWith('branches');
  });

  test('delegates to baseModel.getAllDataChanges with correct arguments', async () => {
    const changes = [{ _id: '1', action: 'update' }];
    const getAllMock = jest.fn().mockResolvedValue(changes);
    BaseModel.mockImplementation(() => ({ getAllDataChanges: getAllMock }));
    const result = await BranchModel.getDataChanges('branches', '2024-06-01');
    expect(getAllMock).toHaveBeenCalledWith('branches', null, '2024-06-01');
    expect(result).toEqual(changes);
  });
});
