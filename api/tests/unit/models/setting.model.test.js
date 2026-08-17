'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// Mock external dependencies BEFORE any require()
// ─────────────────────────────────────────────────────────────────────────────
jest.mock('dotenv', () => ({ config: jest.fn() }));

class MockObjectId {
  constructor(val) {
    if (val === undefined || val === null || val === '') {
      throw new Error('Invalid ObjectId: ' + val);
    }
    this._val = String(val);
  }
  toString() {
    return this._val;
  }
  static isValid(val) {
    return !!val;
  }
}

jest.mock('mongodb', () => ({
  ObjectId: MockObjectId,
  MongoClient: jest.fn(),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn().mockReturnValue('[]'),
}));

jest.mock('path', () => ({
  join: jest.fn((...args) => args.join('/')),
}));

jest.mock('bcryptjs', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Requires (after mocks)
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const bcrypt = require('bcryptjs');
const SettingModel = require('../../../src/models/setting.model');
const BaseModel = require('../../../src/models/base.model');

// ─────────────────────────────────────────────────────────────────────────────
// Test constants
// ─────────────────────────────────────────────────────────────────────────────
const BRANCH_ID = '507f1f77bcf86cd799439011';
const LICENSE_ID = '507f1f77bcf86cd799439022';
const USER_ID = '507f1f77bcf86cd799439033';
const TAX_ID = '507f1f77bcf86cd799439044';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function makeMockCollection(overrides = {}) {
  const cursorBase = {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue([]),
  };
  return {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockReturnValue({ ...cursorBase }),
    insertOne: jest.fn().mockResolvedValue({ insertedId: new MockObjectId(TAX_ID) }),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    countDocuments: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    replaceOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    ...overrides,
  };
}

function makeModel() {
  BaseModel.mongoClient = { db: jest.fn() };
  const m = new SettingModel();
  m.setContext({
    branchId: BRANCH_ID,
    licenseId: LICENSE_ID,
    user: { _id: USER_ID, username: 'testuser', access: {} },
  });
  return m;
}

let consoleErrorSpy;
let consoleLogSpy;
let consoleWarnSpy;

beforeEach(() => {
  jest.clearAllMocks();
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  // Re-apply defaults cleared by clearAllMocks
  BaseModel.mongoClient = { db: jest.fn() };
  BaseModel.database = null;
  BaseModel.license = null;
  BaseModel.currentBranch = null;
  BaseModel.currentBranchName = null;
  BaseModel.currentBranchCountry = null;
  BaseModel.loggedUser = null;
  BaseModel.loggedUserDetails = null;
  BaseModel.currentTimeZone = null;
  BaseModel.limit = 10;
});

afterEach(() => {
  consoleErrorSpy.mockRestore();
  consoleLogSpy.mockRestore();
  consoleWarnSpy.mockRestore();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Class identity & constructor
// ─────────────────────────────────────────────────────────────────────────────
describe('SettingModel — class identity', () => {
  test('is a function (class)', () => expect(typeof SettingModel).toBe('function'));

  test('extends BaseModel', () => {
    BaseModel.mongoClient = { db: jest.fn() };
    expect(new SettingModel()).toBeInstanceOf(BaseModel);
  });

  test('collectionName is "branches"', () => {
    BaseModel.mongoClient = { db: jest.fn() };
    expect(new SettingModel().collectionName).toBe('branches');
  });

  test('collection aliases are set correctly', () => {
    BaseModel.mongoClient = { db: jest.fn() };
    const m = new SettingModel();
    expect(m.taxCollection).toBe('grouptax');
    expect(m.denomCollection).toBe('denomination');
    expect(m.tableOrderCollection).toBe('tableorder');
    expect(m.paymentCollection).toBe('payment_method');
    expect(m.backupCollection).toBe('recycle_bin');
    expect(m.unitCollection).toBe('unit');
  });

  test('branchId, licenseId, user default to null', () => {
    BaseModel.mongoClient = { db: jest.fn() };
    const m = new SettingModel();
    expect(m.branchId).toBeNull();
    expect(m.licenseId).toBeNull();
    expect(m.user).toBeNull();
    expect(m.cachedFallbackTax).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. setContext
// ─────────────────────────────────────────────────────────────────────────────
describe('setContext', () => {
  let m;
  beforeEach(() => {
    m = makeModel();
  });

  test('sets branchId, licenseId, user', () => {
    m.setContext({ branchId: 'B1', licenseId: 'L1', user: { _id: 'U1' } });
    expect(m.branchId).toBe('B1');
    expect(m.licenseId).toBe('L1');
    expect(m.user).toEqual({ _id: 'U1' });
  });

  test('defaults all to null when called with empty object', () => {
    m.setContext({});
    expect(m.branchId).toBeNull();
    expect(m.licenseId).toBeNull();
    expect(m.user).toBeNull();
  });

  test('resets branchName to null on every call', () => {
    m.branchName = 'CachedName';
    m.setContext({ branchId: 'B2' });
    expect(m.branchName).toBeNull();
  });

  test('called without arguments leaves all null', () => {
    m.setContext();
    expect(m.branchId).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. normalizeId
// ─────────────────────────────────────────────────────────────────────────────
describe('normalizeId', () => {
  let m;
  beforeEach(() => {
    m = makeModel();
  });

  test('returns MockObjectId instance for valid string', () => {
    const result = m.normalizeId(BRANCH_ID);
    expect(result).toBeInstanceOf(MockObjectId);
    expect(result.toString()).toBe(BRANCH_ID);
  });

  test('returns null for null', () => expect(m.normalizeId(null)).toBeNull());

  test('returns undefined for undefined', () => expect(m.normalizeId(undefined)).toBeUndefined());

  test('returns 0 for 0 (falsy)', () => expect(m.normalizeId(0)).toBe(0));

  test('returns false for false (falsy)', () => expect(m.normalizeId(false)).toBe(false));

  test('passes string to ObjectId constructor', () => {
    const result = m.normalizeId('abc123xyz000');
    expect(result).toBeInstanceOf(MockObjectId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. buildFilter
// ─────────────────────────────────────────────────────────────────────────────
describe('buildFilter', () => {
  let m;
  beforeEach(() => {
    m = makeModel();
  });

  test('includes branch_id and license when both are set', () => {
    const f = m.buildFilter();
    expect(f).toHaveProperty('branch_id');
    expect(f).toHaveProperty('license');
  });

  test('merges extra properties into filter', () => {
    const f = m.buildFilter({ name: 'GST', rate: 18 });
    expect(f.name).toBe('GST');
    expect(f.rate).toBe(18);
  });

  test('omits branch_id when branchId is null', () => {
    m.branchId = null;
    expect(m.buildFilter()).not.toHaveProperty('branch_id');
  });

  test('omits license when licenseId is null', () => {
    m.licenseId = null;
    expect(m.buildFilter()).not.toHaveProperty('license');
  });

  test('returns only extra when both context ids are null', () => {
    m.branchId = null;
    m.licenseId = null;
    expect(m.buildFilter({ x: 1 })).toEqual({ x: 1 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. toBoolean
// ─────────────────────────────────────────────────────────────────────────────
describe('toBoolean', () => {
  let m;
  beforeEach(() => {
    m = makeModel();
  });

  test.each([
    [true, true],
    [false, false],
    ['true', true],
    ['false', false],
    ['1', true],
    ['0', false],
    ['yes', true],
    ['no', false],
    ['on', true],
    ['off', false],
    ['TRUE', true],
    ['FALSE', false],
    ['YES', true],
    [1, true],
    [0, false],
    [null, false],
    [undefined, false],
    ['', false],
  ])('toBoolean(%p) === %p', (input, expected) => {
    expect(m.toBoolean(input)).toBe(expected);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. toNumber
// ─────────────────────────────────────────────────────────────────────────────
describe('toNumber', () => {
  let m;
  beforeEach(() => {
    m = makeModel();
  });

  test('parses numeric string', () => expect(m.toNumber('42')).toBe(42));
  test('returns float', () => expect(m.toNumber(3.14)).toBe(3.14));
  test('returns 0 for null', () => expect(m.toNumber(null)).toBe(0));
  test('returns 0 for undefined', () => expect(m.toNumber(undefined)).toBe(0));
  test('returns 0 for ""', () => expect(m.toNumber('')).toBe(0));
  test('returns custom fallback for NaN string', () => expect(m.toNumber('abc', 99)).toBe(99));
  test('returns default 0 for NaN string', () => expect(m.toNumber('xyz')).toBe(0));
  test('returns negative numbers correctly', () => expect(m.toNumber('-5')).toBe(-5));
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. formatTaxDocument
// ─────────────────────────────────────────────────────────────────────────────
describe('formatTaxDocument', () => {
  let m;
  beforeEach(() => {
    m = makeModel();
  });

  test('returns null for null input', () => expect(m.formatTaxDocument(null)).toBeNull());

  test('returns null for undefined input', () => expect(m.formatTaxDocument(undefined)).toBeNull());

  test('maps doc fields to expected shape', () => {
    const doc = {
      _id: { toString: () => 'tid1' },
      name: 'GST 18%',
      rate: 18,
      tax_fields: [],
      tax_group: 'no',
    };
    const r = m.formatTaxDocument(doc);
    expect(r.tax_id).toBe('tid1');
    expect(r.tax_name).toBe('GST 18%');
    expect(r.tax_value).toBe(18);
    expect(r.tax_group).toBe('no');
    expect(Array.isArray(r.tax_fields)).toBe(true);
  });

  test('wraps single-object tax_fields into array', () => {
    const doc = {
      _id: { toString: () => 'id1' },
      name: 'T1',
      rate: 5,
      tax_fields: { tax_id: 'x' },
    };
    const r = m.formatTaxDocument(doc);
    expect(Array.isArray(r.tax_fields)).toBe(true);
    expect(r.tax_fields.length).toBe(1);
  });

  test('defaults tax_group to "all" when missing', () => {
    const doc = { _id: { toString: () => 'id1' }, name: 'T1', rate: 5 };
    expect(m.formatTaxDocument(doc).tax_group).toBe('all');
  });

  test('tax_fields defaults to [] when undefined', () => {
    const doc = { _id: { toString: () => 'id1' }, name: 'T1', rate: 5 };
    expect(m.formatTaxDocument(doc).tax_fields).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. loadFallbackTaxData
// ─────────────────────────────────────────────────────────────────────────────
describe('loadFallbackTaxData', () => {
  let m;
  beforeEach(() => {
    m = makeModel();
    m.cachedFallbackTax = null;
    jest.clearAllMocks();
    fs.existsSync.mockReturnValue(false);
  });

  test('returns [] when file does not exist', () => {
    fs.existsSync.mockReturnValue(false);
    expect(m.loadFallbackTaxData()).toEqual([]);
  });

  test('parses and returns data from existing file', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('[{"name":"Tax1","rate":5}]');
    const result = m.loadFallbackTaxData();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Tax1');
  });

  test('returns cached value without re-reading file', () => {
    m.cachedFallbackTax = [{ name: 'Cached' }];
    m.loadFallbackTaxData();
    expect(fs.existsSync).not.toHaveBeenCalled();
    expect(m.loadFallbackTaxData()).toEqual([{ name: 'Cached' }]);
  });

  test('returns [] on readFileSync error', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockImplementation(() => {
      throw new Error('IO error');
    });
    expect(m.loadFallbackTaxData()).toEqual([]);
  });

  test('caches empty array when file is missing', () => {
    fs.existsSync.mockReturnValue(false);
    m.loadFallbackTaxData();
    expect(m.cachedFallbackTax).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. getFallbackTaxList
// ─────────────────────────────────────────────────────────────────────────────
describe('getFallbackTaxList', () => {
  let m;
  beforeEach(() => {
    m = makeModel();
    jest.spyOn(m, 'loadFallbackTaxData').mockReturnValue([]);
  });

  test('returns [] when loadFallbackTaxData is empty', () => {
    expect(m.getFallbackTaxList()).toEqual([]);
  });

  test('filters by taxGroup "no"', () => {
    jest.spyOn(m, 'loadFallbackTaxData').mockReturnValue([
      {
        _id: { toString: () => 't1' },
        name: 'Tax1',
        rate: 5,
        tax_group: 'no',
        branch_id: { toString: () => BRANCH_ID },
      },
      {
        _id: { toString: () => 't2' },
        name: 'Tax2',
        rate: 10,
        tax_group: 'yes',
        branch_id: { toString: () => BRANCH_ID },
      },
    ]);
    const result = m.getFallbackTaxList('no');
    expect(result.every((t) => t.tax_group === 'no')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. getBranchName
// ─────────────────────────────────────────────────────────────────────────────
describe('getBranchName', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
  });

  test('returns cached branchName without DB call', async () => {
    m.branchName = 'Cached Branch';
    const r = await m.getBranchName();
    expect(r).toBe('Cached Branch');
    expect(m.getCollection).not.toHaveBeenCalled();
  });

  test('returns "" when no branchId', async () => {
    m.branchId = null;
    expect(await m.getBranchName()).toBe('');
  });

  test('fetches from DB and caches branch_name', async () => {
    col.findOne.mockResolvedValue({ branch_name: 'My Store' });
    const r = await m.getBranchName();
    expect(r).toBe('My Store');
    expect(m.branchName).toBe('My Store');
  });

  test('returns "" when DB returns null', async () => {
    col.findOne.mockResolvedValue(null);
    expect(await m.getBranchName()).toBe('');
  });

  test('returns "" on DB error', async () => {
    jest.spyOn(m, 'getCollection').mockRejectedValue(new Error('DB fail'));
    expect(await m.getBranchName()).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. getDefaultCustomer
// ─────────────────────────────────────────────────────────────────────────────
describe('getDefaultCustomer', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
  });

  test('returns status:false when no customerId', async () => {
    const r = await m.getDefaultCustomer(null);
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/required/i);
  });

  test('returns status:false when customer not found', async () => {
    col.findOne.mockResolvedValue(null);
    const r = await m.getDefaultCustomer(BRANCH_ID);
    expect(r.status).toBe(false);
    expect(r.message).toBe('Customer not found');
  });

  test('returns status:true with nested customer data when found', async () => {
    col.findOne.mockResolvedValue({
      _id: { toString: () => 'cid1' },
      name: 'John Doe',
      phone: '9999999999',
      email: 'john@test.com',
      address: '123 Main St',
      balance: 250,
    });
    const r = await m.getDefaultCustomer(BRANCH_ID);
    expect(r.status).toBe(true);
    expect(r.data.customer_name).toBe('John Doe');
    expect(r.data.customer.customer_balance).toBe(250);
    expect(r.data.customer.customer_phone).toBe('9999999999');
  });

  test('returns status:false on DB error', async () => {
    jest.spyOn(m, 'getCollection').mockRejectedValue(new Error('DB error'));
    const r = await m.getDefaultCustomer(BRANCH_ID);
    expect(r.status).toBe(false);
    expect(r.message).toBe('DB error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. getDefaultSupplier
// ─────────────────────────────────────────────────────────────────────────────
describe('getDefaultSupplier', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
  });

  test('returns status:false when no supplierId', async () => {
    const r = await m.getDefaultSupplier(null);
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/required/i);
  });

  test('returns status:false when supplier not found', async () => {
    const r = await m.getDefaultSupplier(BRANCH_ID);
    expect(r.status).toBe(false);
    expect(r.message).toBe('Supplier not found');
  });

  test('returns status:true with nested supplier data', async () => {
    col.findOne.mockResolvedValue({
      _id: { toString: () => 'sid1' },
      name: 'Supplier A',
      phone: '8888888888',
      address: 'Warehouse 1',
    });
    const r = await m.getDefaultSupplier(BRANCH_ID);
    expect(r.status).toBe(true);
    expect(r.data.supplier_name).toBe('Supplier A');
    expect(r.data.supplier.supplier_phone).toBe('8888888888');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. getDefaultCustomerSupplier
// ─────────────────────────────────────────────────────────────────────────────
describe('getDefaultCustomerSupplier', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
  });

  test('returns status:false when either id is missing', async () => {
    expect((await m.getDefaultCustomerSupplier(null, BRANCH_ID)).status).toBe(false);
    expect((await m.getDefaultCustomerSupplier(BRANCH_ID, null)).status).toBe(false);
    expect((await m.getDefaultCustomerSupplier(null, null)).status).toBe(false);
  });

  test('returns status:false when either record is not found', async () => {
    col.findOne.mockResolvedValue(null);
    const r = await m.getDefaultCustomerSupplier(BRANCH_ID, TAX_ID);
    expect(r.status).toBe(false);
    expect(r.message).toBe('Not found');
  });

  test('returns status:true with both customer and supplier', async () => {
    col.findOne
      .mockResolvedValueOnce({ _id: { toString: () => 'c1' }, name: 'Cust' })
      .mockResolvedValueOnce({ _id: { toString: () => 's1' }, name: 'Supp' });
    const r = await m.getDefaultCustomerSupplier(BRANCH_ID, TAX_ID);
    expect(r.status).toBe(true);
    expect(r.data.customer_name).toBe('Cust');
    expect(r.data.supplier_name).toBe('Supp');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 14. getThemeSettings
// ─────────────────────────────────────────────────────────────────────────────
describe('getThemeSettings', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
  });

  test('returns status:false when branchId or licenseId is null', async () => {
    m.branchId = null;
    const r = await m.getThemeSettings();
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/context required/i);
  });

  test('returns status:true with theme_settings when found', async () => {
    col.findOne.mockResolvedValue({ theme_settings: { preset: 'dark', primaryColor: '#000' } });
    const r = await m.getThemeSettings();
    expect(r.status).toBe(true);
    expect(r.data.theme_settings.preset).toBe('dark');
  });

  test('returns status:false when doc has no theme_settings', async () => {
    col.findOne.mockResolvedValue({ branch_name: 'Test' });
    const r = await m.getThemeSettings();
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/no theme settings/i);
  });

  test('returns status:false when doc is null', async () => {
    col.findOne.mockResolvedValue(null);
    const r = await m.getThemeSettings();
    expect(r.status).toBe(false);
  });

  test('returns status:false on DB error', async () => {
    jest.spyOn(m, 'getCollection').mockRejectedValue(new Error('fail'));
    const r = await m.getThemeSettings();
    expect(r.status).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. editGeneralSetting
// ─────────────────────────────────────────────────────────────────────────────
describe('editGeneralSetting', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
    jest.spyOn(m, 'updateBranchNameInCollections').mockResolvedValue(true);
  });

  test('returns status:true on matched update', async () => {
    col.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const r = await m.editGeneralSetting({ store_name: 'My Shop', setting_country: 'IN' });
    expect(r.status).toBe(true);
    expect(r.data).toHaveProperty('branch_name');
  });

  test('returns status:false when no branch matched (matchedCount 0)', async () => {
    col.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });
    const r = await m.editGeneralSetting({ store_name: 'Unknown' });
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/not found/i);
  });

  test('strips GMT offset from time_zone', async () => {
    col.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const r = await m.editGeneralSetting({ store_name: 'S', time_zone: 'Asia/Kolkata (GMT+5:30)' });
    expect(r.status).toBe(true);
    expect(r.data.time_zone).toBe('Asia/Kolkata');
  });

  test('hardware_weight_machine_enable is converted to boolean', async () => {
    col.updateOne.mockResolvedValue({ matchedCount: 1 });
    await m.editGeneralSetting({ hardware_weight_machine_enable: 'true' });
    const [, upd] = col.updateOne.mock.calls[0];
    expect(upd.$set.hardware_weight_machine_enable).toBe(true);
  });

  test('staff_shifts_enable stays on unless explicitly disabled', async () => {
    // Shipped live: an old client that does not send the field must not
    // switch the clock-in system off.
    col.updateOne.mockResolvedValue({ matchedCount: 1 });
    await m.editGeneralSetting({ store_name: 'S' });
    expect(col.updateOne.mock.calls[0][1].$set.staff_shifts_enable).toBe(true);

    col.updateOne.mockClear();
    await m.editGeneralSetting({ store_name: 'S', staff_shifts_enable: 'false' });
    expect(col.updateOne.mock.calls[0][1].$set.staff_shifts_enable).toBe(false);

    col.updateOne.mockClear();
    await m.editGeneralSetting({ store_name: 'S', staff_shifts_enable: 'true' });
    expect(col.updateOne.mock.calls[0][1].$set.staff_shifts_enable).toBe(true);
  });

  test('tips default off (opt-in) and roster defaults on (opt-out)', async () => {
    col.updateOne.mockResolvedValue({ matchedCount: 1 });
    await m.editGeneralSetting({ store_name: 'S' });
    let set = col.updateOne.mock.calls[0][1].$set;
    expect(set.staff_tips_enable).toBe(false);
    expect(set.staff_roster_enable).toBe(true);

    col.updateOne.mockClear();
    await m.editGeneralSetting({
      store_name: 'S',
      staff_tips_enable: 'true',
      staff_roster_enable: 'false',
    });
    set = col.updateOne.mock.calls[0][1].$set;
    expect(set.staff_tips_enable).toBe(true);
    expect(set.staff_roster_enable).toBe(false);
  });

  test('returns status:false on DB error', async () => {
    jest.spyOn(m, 'getCollection').mockRejectedValue(new Error('crash'));
    const r = await m.editGeneralSetting({ store_name: 'S' });
    expect(r.status).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 16. updateCommonSettings
// ─────────────────────────────────────────────────────────────────────────────
describe('updateCommonSettings', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
  });

  test('returns status:false when context is missing', async () => {
    m.branchId = null;
    const r = await m.updateCommonSettings({});
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/context is required/i);
  });

  test('returns status:true on success', async () => {
    m.user.access = { plan: { read: true } };
    const r = await m.updateCommonSettings({ print_url: 'true', sales_mail: 'false' });
    expect(r.status).toBe(true);
    expect(r.data).toHaveProperty('url');
  });

  test('does NOT include enable_notification_reminders when plan access is false', async () => {
    m.user.access = { plan: { read: false } };
    await m.updateCommonSettings({ enable_notification_reminders: 'true' });
    const branchUpdateCall = col.updateOne.mock.calls[col.updateOne.mock.calls.length - 1];
    expect(branchUpdateCall[1].$set).not.toHaveProperty('enable_notification_reminders');
  });

  test('includes enable_notification_reminders when plan access is truthy', async () => {
    m.user.access = { plan: { read: true } };
    await m.updateCommonSettings({ enable_notification_reminders: 'true' });
    const branchUpdateCall = col.updateOne.mock.calls[col.updateOne.mock.calls.length - 1];
    expect(branchUpdateCall[1].$set).toHaveProperty('enable_notification_reminders', true);
  });

  test('returns status:false on error (missing user._id)', async () => {
    m.user._id = null;
    const r = await m.updateCommonSettings({});
    expect(r.status).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. addTaxModel
// ─────────────────────────────────────────────────────────────────────────────
describe('addTaxModel', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
    jest.spyOn(m, 'getBranchName').mockResolvedValue('Test Branch');
  });

  test('returns status:false when duplicate tax exists', async () => {
    col.findOne.mockResolvedValue({ _id: 'existing', name: 'GST' });
    const r = await m.addTaxModel({ tax_name: 'GST', tax_value: 18 });
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/already exist/i);
  });

  test('inserts tax and returns status:true with inserted ID', async () => {
    col.findOne.mockResolvedValue(null);
    const r = await m.addTaxModel({ tax_name: 'SGST', tax_value: 9 });
    expect(r.status).toBe(true);
    expect(col.insertOne).toHaveBeenCalledTimes(1);
    expect(r.message).toBe('Tax Added Successfully');
  });

  test('pushes tax to tax_fields array after insert', async () => {
    col.findOne.mockResolvedValue(null);
    await m.addTaxModel({ tax_name: 'SGST', tax_value: 9 });
    expect(col.updateOne).toHaveBeenCalled();
    const [, upd] = col.updateOne.mock.calls[0];
    expect(upd.$push).toHaveProperty('tax_fields');
  });

  test('sets rate as float', async () => {
    col.findOne.mockResolvedValue(null);
    await m.addTaxModel({ tax_name: 'IGST', tax_value: '18.5' });
    const [insertArg] = col.insertOne.mock.calls[0];
    expect(insertArg.rate).toBe(18.5);
  });

  test('returns status:false on DB error', async () => {
    jest.spyOn(m, 'getCollection').mockRejectedValue(new Error('DB fail'));
    const r = await m.addTaxModel({ tax_name: 'GST', tax_value: 18 });
    expect(r.status).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 18. editTaxModel
// ─────────────────────────────────────────────────────────────────────────────
describe('editTaxModel', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection({
      aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    });
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
  });

  test('returns status:false (throws) when no tax_id', async () => {
    const r = await m.editTaxModel({ tax_name: 'GST', tax_value: 18 });
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/required/i);
  });

  test('returns status:false when duplicate name belongs to a different record', async () => {
    col.findOne
      .mockResolvedValueOnce({ _id: { toString: () => TAX_ID }, name: 'GST' }) // current tax
      .mockResolvedValueOnce({ _id: { toString: () => 'other_id' } }); // duplicate check
    const r = await m.editTaxModel({ tax_id: BRANCH_ID, tax_name: 'GST', tax_value: 18 });
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/already exist/i);
  });

  test('returns status:true on successful update', async () => {
    col.findOne.mockResolvedValue(null);
    const r = await m.editTaxModel({ tax_id: BRANCH_ID, tax_name: 'GST', tax_value: 18 });
    expect(r.status).toBe(true);
    expect(r.message).toBe('Tax Updated Successfully');
  });

  test('updates related tax groups when tax is used in groups', async () => {
    col.findOne.mockResolvedValue(null);
    col.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([{ _id: 'group1' }]),
    });
    await m.editTaxModel({ tax_id: BRANCH_ID, tax_name: 'GST', tax_value: 18 });
    expect(col.updateMany).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 19. deleteTaxModel
// ─────────────────────────────────────────────────────────────────────────────
describe('deleteTaxModel', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection({
      aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    });
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
  });

  test('returns status:false when no id provided', async () => {
    const r = await m.deleteTaxModel(null);
    expect(r.status).toBe(false);
  });

  test('returns status:false when tax is the branch default tax', async () => {
    col.findOne.mockResolvedValue({ default_tax: { toString: () => BRANCH_ID } });
    const r = await m.deleteTaxModel(BRANCH_ID);
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/default tax/i);
  });

  test('returns status:false when tax is used in tax groups', async () => {
    col.findOne.mockResolvedValue({});
    col.aggregate.mockReturnValue({ toArray: jest.fn().mockResolvedValue([{ name: 'GroupA' }]) });
    const r = await m.deleteTaxModel(BRANCH_ID);
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/tax group/i);
    expect(r.message).toContain('GroupA');
  });

  test('returns status:true on successful delete', async () => {
    col.findOne.mockResolvedValue({});
    col.deleteOne.mockResolvedValue({ deletedCount: 1 });
    const r = await m.deleteTaxModel(BRANCH_ID);
    expect(r.status).toBe(true);
    expect(r.message).toBe('Tax deleted successfully');
  });

  test('returns status:false when document not found (deletedCount 0)', async () => {
    col.findOne.mockResolvedValue({});
    col.deleteOne.mockResolvedValue({ deletedCount: 0 });
    const r = await m.deleteTaxModel(BRANCH_ID);
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/not found/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 20. addTaxGroupModel
// ─────────────────────────────────────────────────────────────────────────────
describe('addTaxGroupModel', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
    jest.spyOn(m, 'getBranchName').mockResolvedValue('Test Branch');
  });

  test('returns status:false when duplicate tax group name exists', async () => {
    col.findOne.mockResolvedValue({ _id: 'existing' });
    const r = await m.addTaxGroupModel({ tax_name: 'GST Group', tax_fields: [] });
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/already exist/i);
  });

  test('calculates sum of tax_values for group rate', async () => {
    col.findOne.mockResolvedValue(null);
    await m.addTaxGroupModel({
      tax_name: 'GST18',
      tax_fields: [
        { tax_id: TAX_ID, tax_name: 'CGST', tax_value: '9' },
        { tax_id: TAX_ID, tax_name: 'SGST', tax_value: '9' },
      ],
    });
    const [insertArg] = col.insertOne.mock.calls[0];
    expect(insertArg.rate).toBe(18);
    expect(insertArg.tax_group).toBe('yes');
  });

  test('returns status:true on success', async () => {
    col.findOne.mockResolvedValue(null);
    const r = await m.addTaxGroupModel({ tax_name: 'GroupA', tax_fields: [] });
    expect(r.status).toBe(true);
    expect(r.message).toBe('Tax Group Added Successfully');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 21. deleteTaxGroupModel (alias)
// ─────────────────────────────────────────────────────────────────────────────
describe('deleteTaxGroupModel', () => {
  test('delegates to deleteTaxModel', async () => {
    const m = makeModel();
    const spy = jest.spyOn(m, 'deleteTaxModel').mockResolvedValue({ status: true });
    await m.deleteTaxGroupModel(TAX_ID);
    expect(spy).toHaveBeenCalledWith(TAX_ID);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 22. paymentKeyModel
// ─────────────────────────────────────────────────────────────────────────────
describe('paymentKeyModel', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
  });

  test('returns status:true with the status value on success', async () => {
    col.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    const r = await m.paymentKeyModel({ key: 'rzp_key', secret: 'rzp_secret', status: 'true' });
    expect(r.status).toBe(true);
    expect(r.data).toBe('true');
    expect(r.message).toBe('Payment Gateway Updated');
  });

  test('stores payment_gateway with name "razorpay"', async () => {
    col.updateOne.mockResolvedValue({ matchedCount: 1 });
    await m.paymentKeyModel({ key: 'k', secret: 's', status: 'false' });
    const [, upd] = col.updateOne.mock.calls[0];
    expect(upd.$set.payment_gateway.name).toBe('razorpay');
    expect(upd.$set.payment_gateway.key).toBe('k');
    expect(upd.$set.payment_gateway.secret).toBe('s');
  });

  test('returns status:false when branch not found (matchedCount 0)', async () => {
    col.updateOne.mockResolvedValue({ matchedCount: 0 });
    const r = await m.paymentKeyModel({ key: 'k', secret: 's', status: 'false' });
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/not found/i);
  });

  test('returns status:false on exception', async () => {
    jest.spyOn(m, 'getCollection').mockRejectedValue(new Error('boom'));
    const r = await m.paymentKeyModel({ key: 'k' });
    expect(r.status).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 23. phonepePaymentKeyModel
// ─────────────────────────────────────────────────────────────────────────────
describe('phonepePaymentKeyModel', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
  });

  test('converts string "true" status to boolean true', async () => {
    const r = await m.phonepePaymentKeyModel({ merchantId: 'MID', saltKey: 'SK', status: 'true' });
    expect(r.status).toBe(true);
    expect(r.data).toBe(true);
  });

  test('converts string "false" status to boolean false', async () => {
    const r = await m.phonepePaymentKeyModel({ merchantId: 'MID', saltKey: 'SK', status: 'false' });
    expect(r.data).toBe(false);
  });

  test('stores phonepe_payment_gateway with name "phonepe"', async () => {
    await m.phonepePaymentKeyModel({ merchantId: 'MID', saltKey: 'SK', status: '1' });
    const [, upd] = col.updateOne.mock.calls[0];
    expect(upd.$set.phonepe_payment_gateway.name).toBe('phonepe');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 24. updateOfflineSetting
// ─────────────────────────────────────────────────────────────────────────────
describe('updateOfflineSetting', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
  });

  test('sets offline_mode=true for string "true"', async () => {
    await m.updateOfflineSetting({ offline_mode: 'true' });
    const [, upd] = col.updateOne.mock.calls[0];
    expect(upd.$set.offline_mode).toBe(true);
  });

  test('sets offline_mode=false for string "false"', async () => {
    await m.updateOfflineSetting({ offline_mode: 'false' });
    const [, upd] = col.updateOne.mock.calls[0];
    expect(upd.$set.offline_mode).toBe(false);
  });

  test('sets offline_mode=true for boolean true', async () => {
    await m.updateOfflineSetting({ offline_mode: true });
    const [, upd] = col.updateOne.mock.calls[0];
    expect(upd.$set.offline_mode).toBe(true);
  });

  test('returns status:true on success', async () => {
    const r = await m.updateOfflineSetting({ offline_mode: true });
    expect(r.status).toBe(true);
    expect(r.message).toBe('Offline setting updated successfully');
  });

  test('returns status:false on error', async () => {
    jest.spyOn(m, 'getCollection').mockRejectedValue(new Error('fail'));
    const r = await m.updateOfflineSetting({ offline_mode: true });
    expect(r.status).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 25. updateSmsSetting
// ─────────────────────────────────────────────────────────────────────────────
describe('updateSmsSetting', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
  });

  test('way2sms: sets smstype and way2sms-specific fields', async () => {
    const r = await m.updateSmsSetting('way2sms', {
      way2sms_api: 'api123',
      way2sms_userid: 'user1',
      way2sms_password: 'pass1',
    });
    expect(r.status).toBe(true);
    const [, upd] = col.updateOne.mock.calls[0];
    expect(upd.$set.smstype).toBe('way2sms');
    expect(upd.$set.way2sms_api).toBe('api123');
  });

  test('textlocal: sets smstype and textlocal-specific fields', async () => {
    const r = await m.updateSmsSetting('textlocal', {
      textlocal_api: 'tapi',
      textlocal_sender: 'SENDER',
    });
    expect(r.status).toBe(true);
    const [, upd] = col.updateOne.mock.calls[0];
    expect(upd.$set.smstype).toBe('textlocal');
    expect(upd.$set.textlocal_sender).toBe('SENDER');
  });

  test('updateTextLocalSmsSetting delegates with "textlocal" type', async () => {
    const spy = jest.spyOn(m, 'updateSmsSetting').mockResolvedValue({ status: true });
    await m.updateTextLocalSmsSetting({ textlocal_api: 'x' });
    expect(spy).toHaveBeenCalledWith('textlocal', expect.any(Object));
  });

  test('editWay2SmsSetting delegates with "way2sms" type', async () => {
    const spy = jest.spyOn(m, 'updateSmsSetting').mockResolvedValue({ status: true });
    await m.editWay2SmsSetting({ way2sms_api: 'x' });
    expect(spy).toHaveBeenCalledWith('way2sms', expect.any(Object));
  });

  test('returns status:false on error', async () => {
    jest.spyOn(m, 'getCollection').mockRejectedValue(new Error('fail'));
    const r = await m.updateSmsSetting('way2sms', {});
    expect(r.status).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 26. changePasswordModel
// ─────────────────────────────────────────────────────────────────────────────
describe('changePasswordModel', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
    bcrypt.compare.mockReset();
    bcrypt.hash.mockReset();
  });

  test('returns status:false when passwords do not match', async () => {
    const r = await m.changePasswordModel({
      new_password: 'abc',
      confirm_password: 'xyz',
      old_password: 'old',
    });
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/do not match/i);
  });

  test('returns status:false when user not found', async () => {
    col.findOne.mockResolvedValue(null);
    const r = await m.changePasswordModel({
      new_password: 'x',
      confirm_password: 'x',
      old_password: 'y',
    });
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/not found/i);
  });

  test('returns status:false when user has no password set', async () => {
    col.findOne.mockResolvedValue({ _id: USER_ID });
    const r = await m.changePasswordModel({
      new_password: 'x',
      confirm_password: 'x',
      old_password: 'y',
    });
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/not set/i);
  });

  test('returns status:false when old password is incorrect', async () => {
    col.findOne.mockResolvedValue({ _id: USER_ID, password: 'hashed' });
    bcrypt.compare.mockResolvedValue(false);
    const r = await m.changePasswordModel({
      new_password: 'newpass',
      confirm_password: 'newpass',
      old_password: 'wrong',
    });
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/incorrect/i);
  });

  test('returns status:true and updates password on success', async () => {
    col.findOne.mockResolvedValue({ _id: USER_ID, password: 'hashed' });
    bcrypt.compare.mockResolvedValue(true);
    bcrypt.hash.mockResolvedValue('new_hashed');
    col.updateOne.mockResolvedValue({ modifiedCount: 1 });
    const r = await m.changePasswordModel({
      new_password: 'newpass',
      confirm_password: 'newpass',
      old_password: 'oldpass',
    });
    expect(r.status).toBe(true);
    expect(r.message).toMatch(/updated/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 27. deleteStoreCollection
// ─────────────────────────────────────────────────────────────────────────────
describe('deleteStoreCollection', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
  });

  test('returns status:false when no collectionName', async () => {
    const r = await m.deleteStoreCollection(null);
    expect(r.status).toBe(false);
  });

  test('returns status:false for disallowed collection (users)', async () => {
    const r = await m.deleteStoreCollection('users');
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/not allowed/i);
  });

  test('returns status:false for disallowed collection (branches)', async () => {
    expect((await m.deleteStoreCollection('branches')).status).toBe(false);
  });

  test.each(['customers', 'suppliers', 'items', 'sales', 'receivings', 'expenses'])(
    'allows deletion of "%s"',
    async (collectionName) => {
      col.deleteMany.mockResolvedValue({ deletedCount: 3 });
      const r = await m.deleteStoreCollection(collectionName);
      expect(r.status).toBe(true);
      expect(r.data).toBe(3);
    }
  );

  test('returns status:false on DB error', async () => {
    jest.spyOn(m, 'getCollection').mockRejectedValue(new Error('fail'));
    const r = await m.deleteStoreCollection('sales');
    expect(r.status).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 28. deleteAllSelectedCollection
// ─────────────────────────────────────────────────────────────────────────────
describe('deleteAllSelectedCollection', () => {
  let m;
  beforeEach(() => {
    m = makeModel();
  });

  test('returns status:true with results map', async () => {
    jest
      .spyOn(m, 'deleteStoreCollection')
      .mockResolvedValueOnce({ status: true })
      .mockResolvedValueOnce({ status: false });
    const r = await m.deleteAllSelectedCollection({ collections: ['sales', 'users'] });
    expect(r.status).toBe(true);
    expect(r.data.sales).toBe('Deleted');
    expect(r.data.users).toBe('Failed');
  });

  test('returns status:true with empty results for empty array', async () => {
    const r = await m.deleteAllSelectedCollection({ collections: [] });
    expect(r.status).toBe(true);
    expect(r.data).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 29. addPaymentFiledModel
// ─────────────────────────────────────────────────────────────────────────────
describe('addPaymentFiledModel', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
  });

  test('returns status:false when duplicate payment exists', async () => {
    col.findOne.mockResolvedValue({ _id: 'existing' });
    const r = await m.addPaymentFiledModel({ payment_value: 'UPI' });
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/already exist/i);
  });

  test('returns status:true on successful insert', async () => {
    col.findOne.mockResolvedValue(null);
    const r = await m.addPaymentFiledModel({ payment_value: 'UPI' });
    expect(r.status).toBe(true);
    expect(r.message).toBe('Payment method added successfully');
  });

  test('inserts with both payment_field and payment_value', async () => {
    col.findOne.mockResolvedValue(null);
    await m.addPaymentFiledModel({ payment_value: 'UPI' });
    const [insertArg] = col.insertOne.mock.calls[0];
    expect(insertArg.payment_field).toBe('UPI');
    expect(insertArg.payment_value).toBe('UPI');
  });

  test('returns status:false on error', async () => {
    jest.spyOn(m, 'getCollection').mockRejectedValue(new Error('fail'));
    const r = await m.addPaymentFiledModel({ payment_value: 'UPI' });
    expect(r.status).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 30. editPaymentFiledModel
// ─────────────────────────────────────────────────────────────────────────────
describe('editPaymentFiledModel', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
  });

  test('returns status:false (throws) when no id provided', async () => {
    const r = await m.editPaymentFiledModel({ payment_value: 'UPI' });
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/required/i);
  });

  test('returns status:true on success', async () => {
    const r = await m.editPaymentFiledModel({ payment_id: BRANCH_ID, payment_value: 'Cash' });
    expect(r.status).toBe(true);
    expect(r.message).toBe('Payment method updated successfully');
  });

  test('sets payment_field in update data', async () => {
    await m.editPaymentFiledModel({ payment_id: BRANCH_ID, payment_value: 'Card' });
    const [, upd] = col.updateOne.mock.calls[0];
    expect(upd.$set.payment_field).toBe('Card');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 31. deletePaymentFiledModel
// ─────────────────────────────────────────────────────────────────────────────
describe('deletePaymentFiledModel', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
  });

  test('returns status:false when no id', async () => {
    const r = await m.deletePaymentFiledModel(null);
    expect(r.status).toBe(false);
  });

  test('returns status:false when not found (deletedCount 0)', async () => {
    col.deleteOne.mockResolvedValue({ deletedCount: 0 });
    const r = await m.deletePaymentFiledModel(BRANCH_ID);
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/not found/i);
  });

  test('returns status:true on success', async () => {
    col.deleteOne.mockResolvedValue({ deletedCount: 1 });
    const r = await m.deletePaymentFiledModel(BRANCH_ID);
    expect(r.status).toBe(true);
    expect(r.data).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 32. addDenomFiledModel
// ─────────────────────────────────────────────────────────────────────────────
describe('addDenomFiledModel', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
    jest.spyOn(m, 'getBranchName').mockResolvedValue('Branch');
  });

  test('returns status:false when duplicate denom exists', async () => {
    col.findOne.mockResolvedValue({ _id: 'existing' });
    const r = await m.addDenomFiledModel({ denom_value: 100 });
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/already exist/i);
  });

  test('stores branch_id as string in denom collection', async () => {
    col.findOne.mockResolvedValue(null);
    await m.addDenomFiledModel({ denom_value: 100 });
    const [insertArg] = col.insertOne.mock.calls[0];
    expect(typeof insertArg.branch_id).toBe('string');
  });

  test('returns status:true with inserted ID', async () => {
    col.findOne.mockResolvedValue(null);
    const r = await m.addDenomFiledModel({ denom_value: '50' });
    expect(r.status).toBe(true);
    expect(r.message).toBe('Field Added Successfully');
  });

  test('stores denom_value and cash_field as float', async () => {
    col.findOne.mockResolvedValue(null);
    await m.addDenomFiledModel({ denom_value: '100.50' });
    const [insertArg] = col.insertOne.mock.calls[0];
    expect(insertArg.denom_value).toBe(100.5);
    expect(insertArg.cash_field).toBe(100.5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 33. deleteDenomFiledModel
// ─────────────────────────────────────────────────────────────────────────────
describe('deleteDenomFiledModel', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
  });

  test('returns status:false when no id', async () => {
    const r = await m.deleteDenomFiledModel(null);
    expect(r.status).toBe(false);
  });

  test('returns status:false when not found', async () => {
    col.deleteOne.mockResolvedValue({ deletedCount: 0 });
    const r = await m.deleteDenomFiledModel(BRANCH_ID);
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/not found/i);
  });

  test('returns status:true on success', async () => {
    col.deleteOne.mockResolvedValue({ deletedCount: 1 });
    const r = await m.deleteDenomFiledModel(BRANCH_ID);
    expect(r.status).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 34. addTableOrderFiledModel
// ─────────────────────────────────────────────────────────────────────────────
describe('addTableOrderFiledModel', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
    jest.spyOn(m, 'getBranchName').mockResolvedValue('Branch');
  });

  test('returns status:false for duplicate table order value', async () => {
    col.findOne.mockResolvedValue({ _id: 'dup' });
    const r = await m.addTableOrderFiledModel({ tableorder_value: 'Table A' });
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/already exist/i);
  });

  test('returns status:true on successful add', async () => {
    col.findOne.mockResolvedValue(null);
    const r = await m.addTableOrderFiledModel({ tableorder_value: 'Table B' });
    expect(r.status).toBe(true);
    expect(r.message).toBe('Field Added Successfully');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 35. addUnitModel
// ─────────────────────────────────────────────────────────────────────────────
describe('addUnitModel', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
  });

  test('returns status:"error" when duplicate unit exists', async () => {
    col.findOne.mockResolvedValue({ _id: 'existing' });
    const r = await m.addUnitModel({ unit_name: 'kg', unit_value: 'kg' });
    expect(r.status).toBe('error');
    expect(r.message).toMatch(/already exist/i);
  });

  test('returns status:true on successful add', async () => {
    col.findOne.mockResolvedValue(null);
    const r = await m.addUnitModel({ unit_name: 'kg', unit_value: 'kg' });
    expect(r.status).toBe(true);
    expect(r.message).toBe('Unit Added Successfully');
  });

  test('trims unit_name and unit_value before insert', async () => {
    col.findOne.mockResolvedValue(null);
    await m.addUnitModel({ unit_name: '  kg  ', unit_value: '  Kilogram  ' });
    const [insertArg] = col.insertOne.mock.calls[0];
    expect(insertArg.name).toBe('kg');
    expect(insertArg.value).toBe('Kilogram');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 36. deleteUnitModel
// ─────────────────────────────────────────────────────────────────────────────
describe('deleteUnitModel', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
  });

  test('returns status:false when no id', async () => {
    const r = await m.deleteUnitModel(null);
    expect(r.status).toBe(false);
  });

  test('returns status:false when not found', async () => {
    col.deleteOne.mockResolvedValue({ deletedCount: 0 });
    const r = await m.deleteUnitModel(BRANCH_ID);
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/not found/i);
  });

  test('returns status:true on success', async () => {
    col.deleteOne.mockResolvedValue({ deletedCount: 1 });
    const r = await m.deleteUnitModel(BRANCH_ID);
    expect(r.status).toBe(true);
    expect(r.message).toBe('Unit deleted successfully');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 37. getStoreDetails
// ─────────────────────────────────────────────────────────────────────────────
describe('getStoreDetails', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
  });

  test('returns status:false when no branchId', async () => {
    m.branchId = null;
    const r = await m.getStoreDetails();
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/context required/i);
  });

  test('returns status:false when store not found', async () => {
    col.findOne.mockResolvedValue(null);
    const r = await m.getStoreDetails();
    expect(r.status).toBe(false);
    expect(r.message).toBe('Store details not found');
  });

  test('returns status:true with wrapped array of store details', async () => {
    col.findOne.mockResolvedValue({
      _id: { toString: () => BRANCH_ID },
      branch_name: 'My Store',
      store_email: 'store@test.com',
      store_telephone: '1234567890',
    });
    const r = await m.getStoreDetails();
    expect(r.status).toBe(true);
    expect(Array.isArray(r.data)).toBe(true);
    expect(r.data[0].store_name).toBe('My Store');
    expect(r.data[0].store_email).toBe('store@test.com');
  });

  test('returns status:false on error', async () => {
    jest.spyOn(m, 'getCollection').mockRejectedValue(new Error('fail'));
    const r = await m.getStoreDetails();
    expect(r.status).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 38. getTaxAll
// ─────────────────────────────────────────────────────────────────────────────
describe('getTaxAll', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
  });

  test('returns status:true with empty array when no taxes', async () => {
    const r = await m.getTaxAll();
    expect(r.status).toBe(true);
    expect(r.data).toEqual([]);
  });

  test('maps tax documents to expected shape', async () => {
    col.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      toArray: jest
        .fn()
        .mockResolvedValue([
          { _id: { toString: () => 't1' }, name: 'GST', rate: 18, tax_fields: [] },
        ]),
    });
    const r = await m.getTaxAll();
    expect(r.status).toBe(true);
    expect(r.data[0].tax_name).toBe('GST');
    expect(r.data[0].tax_value).toBe(18);
  });

  test('filters by tax_group when not "all"', async () => {
    col.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([]),
    });
    await m.getTaxAll('yes');
    const [filterArg] = col.find.mock.calls[0];
    expect(filterArg.tax_group).toBe('yes');
  });

  test('falls back to getFallbackTaxList on DB error', async () => {
    jest.spyOn(m, 'getCollection').mockRejectedValue(new Error('DB down'));
    jest
      .spyOn(m, 'getFallbackTaxList')
      .mockReturnValue([{ tax_id: 'f1', tax_name: 'Fallback', tax_value: 5 }]);
    const r = await m.getTaxAll();
    expect(r.status).toBe(true);
    expect(r.data[0].tax_name).toBe('Fallback');
  });

  test('returns status:false on error with no fallback', async () => {
    jest.spyOn(m, 'getCollection').mockRejectedValue(new Error('DB down'));
    jest.spyOn(m, 'getFallbackTaxList').mockReturnValue([]);
    const r = await m.getTaxAll();
    expect(r.status).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 39. getSystemSettings
// ─────────────────────────────────────────────────────────────────────────────
describe('getSystemSettings', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
  });

  test('returns status:true with empty object when nothing found', async () => {
    col.findOne.mockResolvedValue(null);
    const r = await m.getSystemSettings();
    expect(r.status).toBe(true);
    expect(r.data).toEqual({});
  });

  test('returns status:true with settings when found', async () => {
    col.findOne.mockResolvedValue({ smstype: 'way2sms', email: { host: 'smtp.test.com' } });
    const r = await m.getSystemSettings();
    expect(r.status).toBe(true);
    expect(r.data.smstype).toBe('way2sms');
  });

  test('returns status:false on error', async () => {
    jest.spyOn(m, 'getCollection').mockRejectedValue(new Error('fail'));
    const r = await m.getSystemSettings();
    expect(r.status).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 40. editThemeSettings
// ─────────────────────────────────────────────────────────────────────────────
describe('editThemeSettings', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
  });

  test('returns status:true with theme_settings on success', async () => {
    const r = await m.editThemeSettings({ preset: 'dark', primaryColor: '#000000' });
    expect(r.status).toBe(true);
    expect(r.data.preset).toBe('dark');
    expect(r.data.primaryColor).toBe('#000000');
  });

  test('uses defaults when no data provided', async () => {
    const r = await m.editThemeSettings({});
    expect(r.status).toBe(true);
    expect(r.data.preset).toBe('default');
    expect(r.data.primaryColor).toBe('#5a8dee');
    expect(r.data.fontFamily).toBe("'Mukta Vaani', sans-serif");
  });

  test('calls updateOne with $set theme_settings', async () => {
    await m.editThemeSettings({ preset: 'light' });
    const [, upd] = col.updateOne.mock.calls[0];
    expect(upd.$set).toHaveProperty('theme_settings');
    expect(upd.$set.theme_settings.preset).toBe('light');
  });

  test('returns status:false on error', async () => {
    jest.spyOn(m, 'getCollection').mockRejectedValue(new Error('fail'));
    const r = await m.editThemeSettings({ preset: 'dark' });
    expect(r.status).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 41. updateBranchLogoModel
// ─────────────────────────────────────────────────────────────────────────────
describe('updateBranchLogoModel', () => {
  let m;
  beforeEach(() => {
    m = makeModel();
  });

  test('returns status:true with "store.png" when no file uploaded', async () => {
    const r = await m.updateBranchLogoModel(null);
    expect(r.status).toBe(true);
    expect(r.data).toBe('store.png');
    expect(r.message).toBe('Image uploaded successfully');
  });

  test('returns /uploads/{filename} path when file provided', async () => {
    const r = await m.updateBranchLogoModel({ filename: 'logo_abc123.png' });
    expect(r.status).toBe(true);
    expect(r.data).toBe('/uploads/logo_abc123.png');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 42. getDasboardSalesCountModel
// ─────────────────────────────────────────────────────────────────────────────
describe('getDasboardSalesCountModel', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
  });

  test('returns status:false when branch not found', async () => {
    col.findOne.mockResolvedValue(null);
    const r = await m.getDasboardSalesCountModel();
    expect(r.status).toBe(false);
    expect(r.data).toBe(0);
  });

  test('returns status:false when no created_date on branch doc', async () => {
    col.findOne.mockResolvedValue({ branch_name: 'Test' });
    const r = await m.getDasboardSalesCountModel();
    expect(r.status).toBe(false);
  });

  test('returns status:true with number of days since creation', async () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    col.findOne.mockResolvedValue({ created_date: tenDaysAgo });
    const r = await m.getDasboardSalesCountModel();
    expect(r.status).toBe(true);
    expect(r.data).toBeGreaterThanOrEqual(9);
    expect(r.data).toBeLessThanOrEqual(11);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 43. restoreBackup
// ─────────────────────────────────────────────────────────────────────────────
describe('restoreBackup', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
  });

  test('returns status:false for empty ids array', async () => {
    const r = await m.restoreBackup([]);
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/no ids/i);
  });

  test('returns status:false when no docs found in backup', async () => {
    col.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });
    const r = await m.restoreBackup([BRANCH_ID]);
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/no documents found/i);
  });

  test('restores docs and returns status:true', async () => {
    col.find.mockReturnValue({
      toArray: jest
        .fn()
        .mockResolvedValue([
          { _id: new MockObjectId(BRANCH_ID), document_name: 'sales', branch_id: BRANCH_ID },
        ]),
    });
    col.findOne.mockResolvedValue(null);
    const r = await m.restoreBackup([BRANCH_ID]);
    expect(r.status).toBe(true);
    expect(r.message).toBe('Document Restored successfully');
  });

  test('replaces existing doc when already present in target', async () => {
    col.find.mockReturnValue({
      toArray: jest
        .fn()
        .mockResolvedValue([
          { _id: new MockObjectId(BRANCH_ID), document_name: 'sales', branch_id: BRANCH_ID },
        ]),
    });
    col.findOne.mockResolvedValue({ _id: new MockObjectId(BRANCH_ID) }); // exists in target
    const r = await m.restoreBackup([BRANCH_ID]);
    expect(r.status).toBe(true);
    expect(col.replaceOne).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 44. kioskUpdateInfoModel
// ─────────────────────────────────────────────────────────────────────────────
describe('kioskUpdateInfoModel', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
  });

  test('returns status:false when key not found in DB', async () => {
    col.findOne.mockResolvedValue(null);
    const r = await m.kioskUpdateInfoModel('KIOSK_V1');
    expect(r.status).toBe(false);
    expect(r.data).toBe('KIOSK_V1');
  });

  test('returns status:false when doc has no download_url', async () => {
    col.findOne.mockResolvedValue({ version: '1.0' });
    const r = await m.kioskUpdateInfoModel('KIOSK_V1');
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/download_url missing/i);
  });

  test('returns status:true with download_url and version', async () => {
    col.findOne.mockResolvedValue({ download_url: 'http://dl.example.com/k.zip', version: '2.0' });
    const r = await m.kioskUpdateInfoModel('KEY');
    expect(r.status).toBe(true);
    expect(r.data.download_url).toBe('http://dl.example.com/k.zip');
    expect(r.data.version).toBe('2.0');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 45. updateBranchNameInCollections
// ─────────────────────────────────────────────────────────────────────────────
describe('updateBranchNameInCollections', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
  });

  test('calls updateMany for all listed collections and returns true', async () => {
    const r = await m.updateBranchNameInCollections({ id: BRANCH_ID, branch_name: 'New Name' });
    expect(r).toBe(true);
    expect(col.updateMany).toHaveBeenCalled();
  });

  test('still returns true even if some collection updates fail', async () => {
    col.updateMany.mockRejectedValueOnce(new Error('fail once'));
    col.updateMany.mockResolvedValue({ modifiedCount: 1 });
    const r = await m.updateBranchNameInCollections({ id: BRANCH_ID, branch_name: 'Name' });
    expect(r).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 46. getSelectUnitAjaxList
// ─────────────────────────────────────────────────────────────────────────────
describe('getSelectUnitAjaxList', () => {
  let m, col;
  beforeEach(() => {
    m = makeModel();
    col = makeMockCollection();
    jest.spyOn(m, 'getCollection').mockResolvedValue(col);
  });

  test('returns status:true with empty array when no units', async () => {
    const r = await m.getSelectUnitAjaxList();
    expect(r.status).toBe(true);
    expect(r.data).toEqual([]);
  });

  test('maps unit docs to unit_id, unit_name, unit_value shape', async () => {
    col.find.mockReturnValue({
      toArray: jest
        .fn()
        .mockResolvedValue([{ _id: { toString: () => 'uid1' }, name: 'Kilogram', value: 'kg' }]),
    });
    const r = await m.getSelectUnitAjaxList();
    expect(r.status).toBe(true);
    expect(r.data[0].unit_id).toBe('uid1');
    expect(r.data[0].unit_name).toBe('Kilogram');
  });

  test('adds regex filter when query provided', async () => {
    col.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });
    await m.getSelectUnitAjaxList('kg');
    const [filterArg] = col.find.mock.calls[0];
    expect(filterArg.name).toHaveProperty('$regex');
  });

  test('returns status:false on error', async () => {
    jest.spyOn(m, 'getCollection').mockRejectedValue(new Error('fail'));
    const r = await m.getSelectUnitAjaxList();
    expect(r.status).toBe(false);
  });
});
