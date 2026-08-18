'use strict';

/**
 * Unit tests for src/models/install.model.js
 *
 * File confirmed: src/models/install.model.js (only install model — no duplicates)
 * Type: Native MongoDB driver orchestration model — InstallModel extends BaseModel
 * Export: module.exports = new InstallModel()  ← SINGLETON (not the class)
 *
 * Strategy: Mocked database tests
 *   - BaseModel fully mocked (no real DB)
 *   - bcryptjs mocked (no real hashing)
 *   - fs.readFileSync mocked (no real file I/O — returns fake JSON/HTML by filename)
 *   - getCollection() spied per test to return per-collection mock objects
 *   - insertDemoData / insertDefaultCategoryAndItem spied in isolation tests
 *
 * Collections touched by installInsertDocument:
 *   users, branches, grouptax, customers, suppliers, unit
 * Collections touched by insertDemoData:
 *   categories, items
 * Collections touched by insertDefaultCategoryAndItem:
 *   categories, items
 * Collections touched by cleanupByLicense:
 *   users, branches, customers, suppliers, categories, items,
 *   grouptax, unit, sales, receiving, expenses, stocklogs,
 *   payments, reports, notifications, settings  (15 total)
 */

// ─── Hoist mocks ─────────────────────────────────────────────────────────────

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2b$10$mocked_hashed_secret'),
}));

jest.mock('fs', () => ({
  readFileSync: jest.fn().mockImplementation((filePath) => {
    if (filePath.includes('print_a4html.txt')) return '<html>A4 Print</html>';
    if (filePath.includes('print_standard_html.txt')) return '<html>Standard Print</html>';
    if (filePath.includes('countries.json')) {
      return JSON.stringify({
        countries: [
          {
            value: 'India',
            sortname: 'IN',
            tax: [{ tax_name: 'GST', tax_value: '18' }],
          },
        ],
      });
    }
    if (filePath.includes('install_documents.json')) {
      return JSON.stringify({
        documents: [
          {
            categories: [
              { name: 'Electronics', description: 'Electronic devices', image: 'elec.png' },
            ],
            items: [
              {
                name: 'Test Phone',
                category_name: 'Electronics',
                mrp_price: '1000',
                company_price: '800',
                selling_price: '900',
                available_quantity: '10',
                image: 'phone.png',
                sort_order: '1',
                description: 'A test smartphone',
              },
            ],
          },
        ],
      });
    }
    return '{}';
  }),
}));

jest.mock('../../../src/models/base.model', () => {
  class MockBaseModel {
    static mongoClient = {};
    static database = {};

    constructor(collectionName) {
      this.collectionName = collectionName || 'branches';
    }

    async getCollection() {
      return null;
    }
    toObjectId(v) {
      if (!v) return null;
      const { ObjectId } = require('mongodb');
      try {
        return new ObjectId(String(v));
      } catch {
        return null;
      }
    }
  }
  return MockBaseModel;
});

// ─── Imports ──────────────────────────────────────────────────────────────────

const { ObjectId } = require('mongodb');
const im = require('../../../src/models/install.model');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const newId = () => new ObjectId();
const strId = () => newId().toString();

function makeCol(deletedCount = 1) {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    insertOne: jest.fn().mockResolvedValue({ insertedId: newId() }),
    insertMany: jest.fn().mockResolvedValue({ insertedIds: { 0: newId() } }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount }),
    find: jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue([{ _id: newId(), name: 'Electronics' }]),
    }),
  };
}

function makeInstallCols() {
  return {
    users: makeCol(),
    branches: makeCol(),
    grouptax: makeCol(),
    customers: makeCol(),
    suppliers: makeCol(),
    unit: makeCol(),
    categories: makeCol(),
    items: makeCol(),
  };
}

const validData = () => ({
  register_license: strId(),
  register_username: 'testadmin',
  register_useremail: 'testadmin@example.com',
  register_userpassword: 'Secure@123',
  register_firstname: 'Test',
  register_lastname: 'Admin',
  register_companyname: 'Test Company Ltd',
  register_address: '123 Test Street',
  register_fullnumber: '+911234567890',
  register_country: 'India',
  register_countryid: 'IN',
  register_state: 'Maharashtra',
  register_timezone: 'Asia/Kolkata',
  register_demo: 'off',
});

// ─── Global setup ─────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Module exports
// ═══════════════════════════════════════════════════════════════════════════════
describe('InstallModel — module exports', () => {
  test('exports an object (singleton instance, not a class)', () => {
    expect(typeof im).toBe('object');
    expect(im).not.toBeNull();
  });

  test('has all four expected methods', () => {
    expect(typeof im.installInsertDocument).toBe('function');
    expect(typeof im.insertDemoData).toBe('function');
    expect(typeof im.insertDefaultCategoryAndItem).toBe('function');
    expect(typeof im.cleanupByLicense).toBe('function');
  });

  test('collectionName is "branches"', () => {
    expect(im.collectionName).toBe('branches');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. installInsertDocument() — duplicate user detection
// ═══════════════════════════════════════════════════════════════════════════════
describe('InstallModel — installInsertDocument() duplicate detection', () => {
  test('returns status:false when username already exists', async () => {
    const cols = makeInstallCols();
    cols.users.findOne = jest.fn().mockResolvedValue({
      username: 'testadmin',
      email: 'other@example.com',
      license: newId(),
    });
    jest.spyOn(im, 'getCollection').mockImplementation(async (n) => cols[n] || makeCol());

    const r = await im.installInsertDocument(validData());
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/username.*already exists/i);
  });

  test('returns status:false when email already exists', async () => {
    const cols = makeInstallCols();
    cols.users.findOne = jest.fn().mockResolvedValue({
      username: 'otheradmin',
      email: 'testadmin@example.com',
      license: newId(),
    });
    jest.spyOn(im, 'getCollection').mockImplementation(async (n) => cols[n] || makeCol());

    const r = await im.installInsertDocument(validData());
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/email.*already exists/i);
  });

  test('returns status:false when license already exists', async () => {
    const data = validData();
    const licenseId = new ObjectId(data.register_license);
    const cols = makeInstallCols();
    cols.users.findOne = jest.fn().mockResolvedValue({
      username: 'different',
      email: 'different@example.com',
      license: licenseId,
    });
    jest.spyOn(im, 'getCollection').mockImplementation(async (n) => cols[n] || makeCol());

    const r = await im.installInsertDocument(data);
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/license.*already exists/i);
  });

  test('userCollection.findOne is called with $or on username, email, license', async () => {
    const cols = makeInstallCols();
    jest.spyOn(im, 'getCollection').mockImplementation(async (n) => cols[n] || makeCol());
    jest.spyOn(im, 'insertDefaultCategoryAndItem').mockResolvedValue();

    await im.installInsertDocument(validData());

    const [filter] = cols.users.findOne.mock.calls[0];
    expect(filter.$or).toHaveLength(3);
    expect(filter.$or[0]).toHaveProperty('username');
    expect(filter.$or[1]).toHaveProperty('email');
    expect(filter.$or[2]).toHaveProperty('license');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. installInsertDocument() — success flow
// ═══════════════════════════════════════════════════════════════════════════════
describe('InstallModel — installInsertDocument() success flow', () => {
  let cols;

  beforeEach(() => {
    cols = makeInstallCols();
    jest.spyOn(im, 'getCollection').mockImplementation(async (n) => cols[n] || makeCol());
    jest.spyOn(im, 'insertDefaultCategoryAndItem').mockResolvedValue();
    jest.spyOn(im, 'insertDemoData').mockResolvedValue();
  });

  test('returns status:true with success message', async () => {
    const r = await im.installInsertDocument(validData());
    expect(r.status).toBe(true);
    expect(r.message).toBe('Account created successfully');
  });

  test('inserts user with usertype "super_admin"', async () => {
    await im.installInsertDocument(validData());
    const [userDoc] = cols.users.insertOne.mock.calls[0];
    expect(userDoc.usertype).toBe('super_admin');
  });

  test('inserts user with the premium unlimited plan', async () => {
    await im.installInsertDocument(validData());
    const [userDoc] = cols.users.insertOne.mock.calls[0];
    expect(userDoc.plan.name).toBe('premium');
    expect(userDoc.plan.max_sales).toBe('unlimited');
  });

  test('inserts user with bcrypt-hashed secret key', async () => {
    await im.installInsertDocument(validData());
    const [userDoc] = cols.users.insertOne.mock.calls[0];
    expect(userDoc.userkey).toBe('$2b$10$mocked_hashed_secret');
  });

  test('inserts user with activate:true', async () => {
    await im.installInsertDocument(validData());
    const [userDoc] = cols.users.insertOne.mock.calls[0];
    expect(userDoc.activate).toBe(true);
  });

  test('stores correct username and email on user', async () => {
    const data = validData();
    await im.installInsertDocument(data);
    const [userDoc] = cols.users.insertOne.mock.calls[0];
    expect(userDoc.username).toBe(data.register_username);
    expect(userDoc.email).toBe(data.register_useremail);
  });

  test('user access: dashboard.read=true, plan.read=false', async () => {
    await im.installInsertDocument(validData());
    const [userDoc] = cols.users.insertOne.mock.calls[0];
    expect(userDoc.access.dashboard.read).toBe(true);
    expect(userDoc.access.sales.write).toBe(true);
    expect(userDoc.access.plan.read).toBe(false);
  });

  test('inserts branch with trimmed company name', async () => {
    const data = validData();
    await im.installInsertDocument(data);
    const [branchDoc] = cols.branches.insertOne.mock.calls[0];
    expect(branchDoc.branch_name).toBe(data.register_companyname.trim());
  });

  test('inserts branch with licenseId as ObjectId', async () => {
    await im.installInsertDocument(validData());
    const [branchDoc] = cols.branches.insertOne.mock.calls[0];
    expect(branchDoc.license).toBeInstanceOf(ObjectId);
  });

  test('inserts branch with stock_management:true', async () => {
    await im.installInsertDocument(validData());
    const [branchDoc] = cols.branches.insertOne.mock.calls[0];
    expect(branchDoc.stock_management).toBe(true);
  });

  test('inserts default customer named "Walk-in Customer"', async () => {
    await im.installInsertDocument(validData());
    const [customerDoc] = cols.customers.insertOne.mock.calls[0];
    expect(customerDoc.name).toBe('Walk-in Customer');
  });

  test('inserts default supplier named "General Supplier"', async () => {
    await im.installInsertDocument(validData());
    const [supplierDoc] = cols.suppliers.insertOne.mock.calls[0];
    expect(supplierDoc.name).toBe('General Supplier');
  });

  test('inserts default unit named "Quantity" with value "qty"', async () => {
    await im.installInsertDocument(validData());
    const [unitDoc] = cols.unit.insertOne.mock.calls[0];
    expect(unitDoc.name).toBe('Quantity');
    expect(unitDoc.value).toBe('qty');
  });

  test('updates user with branch_access array after branch creation', async () => {
    await im.installInsertDocument(validData());
    const [, updateArg] = cols.users.updateOne.mock.calls[0];
    expect(Array.isArray(updateArg.$set.branch_access)).toBe(true);
    expect(updateArg.$set.branch_access[0]).toHaveProperty('branch_id');
  });

  test('inserts grouptax record from countries.json for matching country', async () => {
    await im.installInsertDocument(validData());
    expect(cols.grouptax.insertOne).toHaveBeenCalledTimes(1);
    const [taxDoc] = cols.grouptax.insertOne.mock.calls[0];
    expect(taxDoc.name).toBe('GST');
    expect(taxDoc.rate).toBe(18);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. installInsertDocument() — demo flag routing
// ═══════════════════════════════════════════════════════════════════════════════
describe('InstallModel — installInsertDocument() demo flag', () => {
  beforeEach(() => {
    const cols = makeInstallCols();
    jest.spyOn(im, 'getCollection').mockImplementation(async (n) => cols[n] || makeCol());
    jest.spyOn(im, 'insertDemoData').mockResolvedValue();
    jest.spyOn(im, 'insertDefaultCategoryAndItem').mockResolvedValue();
  });

  test('calls insertDemoData (not insertDefaultCategoryAndItem) when register_demo is "on"', async () => {
    await im.installInsertDocument({ ...validData(), register_demo: 'on' });
    expect(im.insertDemoData).toHaveBeenCalledTimes(1);
    expect(im.insertDefaultCategoryAndItem).not.toHaveBeenCalled();
  });

  test('calls insertDefaultCategoryAndItem (not insertDemoData) when register_demo is "off"', async () => {
    await im.installInsertDocument({ ...validData(), register_demo: 'off' });
    expect(im.insertDefaultCategoryAndItem).toHaveBeenCalledTimes(1);
    expect(im.insertDemoData).not.toHaveBeenCalled();
  });

  test('calls insertDefaultCategoryAndItem when register_demo is undefined', async () => {
    const data = validData();
    delete data.register_demo;
    await im.installInsertDocument(data);
    expect(im.insertDefaultCategoryAndItem).toHaveBeenCalledTimes(1);
    expect(im.insertDemoData).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. installInsertDocument() — error handling
// ═══════════════════════════════════════════════════════════════════════════════
describe('InstallModel — installInsertDocument() error handling', () => {
  test('returns descriptive message for MongoDB E11000 duplicate key error', async () => {
    const e11000 = Object.assign(
      new Error('E11000 duplicate key error collection: testdb.users index: username_1'),
      {
        code: 11000,
        keyPattern: { username: 1 },
        keyValue: { username: 'testadmin' },
      }
    );
    jest.spyOn(im, 'getCollection').mockRejectedValue(e11000);

    const r = await im.installInsertDocument(validData());
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/Duplicate username/);
    expect(r.message).toMatch(/testadmin/);
  });

  test('returns status:false with error.message on general exceptions', async () => {
    jest.spyOn(im, 'getCollection').mockRejectedValue(new Error('Connection timeout'));
    const r = await im.installInsertDocument(validData());
    expect(r.status).toBe(false);
    expect(r.message).toBe('Connection timeout');
  });

  test('returns status:false when register_license is an invalid ObjectId', async () => {
    jest.spyOn(im, 'getCollection').mockResolvedValue(makeCol());
    const r = await im.installInsertDocument({ ...validData(), register_license: 'bad-id' });
    expect(r.status).toBe(false);
  });

  test('data field is empty string on error (not null)', async () => {
    jest.spyOn(im, 'getCollection').mockRejectedValue(new Error('fail'));
    const r = await im.installInsertDocument(validData());
    expect(r.data).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. insertDemoData()
// ═══════════════════════════════════════════════════════════════════════════════
describe('InstallModel — insertDemoData()', () => {
  const demoParams = {
    branchId: newId(),
    branchName: 'Demo Branch',
    userId: newId(),
    username: 'admin',
    licenseId: newId(),
    now: new Date(),
    userBranch: [],
    supplierId: newId(),
    supplierName: 'General Supplier',
    taxId: newId(),
    taxData: { name: 'GST', rate: 18 },
    unitId: newId(),
  };

  test('calls insertMany on categories collection from install_documents.json', async () => {
    const cols = { categories: makeCol(), items: makeCol() };
    jest.spyOn(im, 'getCollection').mockImplementation(async (n) => cols[n] || makeCol());

    await im.insertDemoData(demoParams);
    expect(cols.categories.insertMany).toHaveBeenCalledTimes(1);
    const [catDocs] = cols.categories.insertMany.mock.calls[0];
    expect(Array.isArray(catDocs)).toBe(true);
    expect(catDocs[0].name).toBe('Electronics');
  });

  test('calls insertMany on items collection with items mapped to categories', async () => {
    const catId = newId();
    const cols = {
      categories: {
        ...makeCol(),
        insertMany: jest.fn().mockResolvedValue({ insertedIds: { 0: catId } }),
        find: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([{ _id: catId, name: 'Electronics' }]),
        }),
      },
      items: makeCol(),
    };
    jest.spyOn(im, 'getCollection').mockImplementation(async (n) => cols[n] || makeCol());

    await im.insertDemoData(demoParams);
    expect(cols.items.insertMany).toHaveBeenCalledTimes(1);
  });

  test('does NOT throw on collection error — silently logs and continues', async () => {
    jest.spyOn(im, 'getCollection').mockRejectedValue(new Error('demo DB fail'));
    await expect(im.insertDemoData(demoParams)).resolves.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. insertDefaultCategoryAndItem()
// ═══════════════════════════════════════════════════════════════════════════════
describe('InstallModel — insertDefaultCategoryAndItem()', () => {
  const defParams = {
    branchId: newId(),
    branchName: 'Default Branch',
    userId: newId(),
    username: 'admin',
    licenseId: newId(),
    now: new Date(),
    userBranch: [],
    supplierId: newId(),
    supplierName: 'General Supplier',
    taxId: null,
    taxData: null,
    unitId: newId(),
  };

  test('inserts a category named "Supermarkets"', async () => {
    const cols = { categories: makeCol(), items: makeCol() };
    jest.spyOn(im, 'getCollection').mockImplementation(async (n) => cols[n] || makeCol());

    await im.insertDefaultCategoryAndItem(defParams);
    const [catDoc] = cols.categories.insertOne.mock.calls[0];
    expect(catDoc.name).toBe('Supermarkets');
  });

  test('inserts default item "Fortune Sunlite Refined Sunflower Oil 1L" with correct prices', async () => {
    const cols = { categories: makeCol(), items: makeCol() };
    jest.spyOn(im, 'getCollection').mockImplementation(async (n) => cols[n] || makeCol());

    await im.insertDefaultCategoryAndItem(defParams);
    const [itemDoc] = cols.items.insertOne.mock.calls[0];
    expect(itemDoc.name).toBe('Fortune Sunlite Refined Sunflower Oil 1L');
    expect(itemDoc.mrp_price).toBe(190.0);
    expect(itemDoc.selling_price).toBe(138.0);
    expect(itemDoc.available_quantity).toBe(100);
  });

  test('does NOT throw on collection error — silently logs and continues', async () => {
    jest.spyOn(im, 'getCollection').mockRejectedValue(new Error('default DB fail'));
    await expect(im.insertDefaultCategoryAndItem(defParams)).resolves.toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. cleanupByLicense()
// ═══════════════════════════════════════════════════════════════════════════════
describe('InstallModel — cleanupByLicense()', () => {
  test('returns status:true with totalDeleted sum on success', async () => {
    jest.spyOn(im, 'getCollection').mockResolvedValue(makeCol(3));

    const r = await im.cleanupByLicense(strId());
    expect(r.status).toBe(true);
    expect(r.data.totalDeleted).toBe(3 * 16);
  });

  test('returns the licenseId in response data', async () => {
    const id = strId();
    jest.spyOn(im, 'getCollection').mockResolvedValue(makeCol(0));

    const r = await im.cleanupByLicense(id);
    expect(r.data.license).toBe(id);
  });

  test('calls deleteMany exactly 16 times (one per collection)', async () => {
    const col = makeCol(0);
    jest.spyOn(im, 'getCollection').mockResolvedValue(col);

    await im.cleanupByLicense(strId());
    expect(col.deleteMany).toHaveBeenCalledTimes(16);
  });

  test('details object contains entries for all expected collections', async () => {
    jest.spyOn(im, 'getCollection').mockResolvedValue(makeCol(1));

    const r = await im.cleanupByLicense(strId());
    const EXPECTED = [
      'users',
      'branches',
      'customers',
      'suppliers',
      'categories',
      'items',
      'grouptax',
      'unit',
      'sales',
    ];
    for (const c of EXPECTED) {
      expect(r.data.details).toHaveProperty(c);
    }
  });

  test('includes success message with totalDeleted count', async () => {
    jest.spyOn(im, 'getCollection').mockResolvedValue(makeCol(2));

    const r = await im.cleanupByLicense(strId());
    expect(r.message).toMatch(/32/); // 16 collections × 2 each
  });

  test('returns status:false when licenseId is an invalid ObjectId', async () => {
    const r = await im.cleanupByLicense('not-a-valid-id');
    expect(r.status).toBe(false);
    expect(typeof r.message).toBe('string');
  });

  test('overall status stays true even if one collection deleteMany fails', async () => {
    let callCount = 0;
    jest.spyOn(im, 'getCollection').mockImplementation(async () => {
      callCount++;
      const col = makeCol(1);
      if (callCount === 3) {
        col.deleteMany = jest.fn().mockRejectedValue(new Error('auth fail'));
      }
      return col;
    });

    const r = await im.cleanupByLicense(strId());
    expect(r.status).toBe(true);
    const errorEntry = Object.values(r.data.details).find(
      (v) => typeof v === 'string' && v.startsWith('Error:')
    );
    expect(errorEntry).toBeDefined();
  });

  test('totalDeleted only counts successful collections when one fails', async () => {
    let callCount = 0;
    jest.spyOn(im, 'getCollection').mockImplementation(async () => {
      callCount++;
      const col = makeCol(4);
      if (callCount === 1) {
        col.deleteMany = jest.fn().mockRejectedValue(new Error('fail'));
      }
      return col;
    });

    const r = await im.cleanupByLicense(strId());
    expect(r.data.totalDeleted).toBe(4 * 15); // 15 successful × 4 each (1 failed)
  });
});
