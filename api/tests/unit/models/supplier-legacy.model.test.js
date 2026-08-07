'use strict';

/**
 * Unit tests for src/models/supplier-legacy.model.js
 *
 * File confirmed : src/models/supplier-legacy.model.js (739 lines)
 * Similar files  :
 *   - src/models/supplier.model.js  — EXISTS (Mongoose model, newer schema — NOT used by production routes)
 *   - suppliers.model.js            — does NOT exist
 *   - supplier-legacy.schema.js     — does NOT exist
 *   - supplier.model.ts             — does NOT exist
 *
 * Active usage confirmed in:
 *   - src/controllers/suppliers.controller.js  (primary consumer)
 *   - src/models/branch.model.js               (static updateSupplierModel called there)
 *
 * Type    : Full-featured native-driver model class (NOT Mongoose)
 *           extends BaseModel (src/models/base.model.js)
 *
 * Collection : "suppliers"
 *
 * Contrast with supplier.model.js:
 *   - supplier.model.js  = Mongoose schema, strict field validation, email uniqueness,
 *                          status/balance fields — NOT actively wired to controllers
 *   - supplier-legacy.model.js = PHP-converted native-driver model, the live model
 *                                used by all supplier endpoints
 *
 * Methods:
 *   supplierDetails(id)
 *   supplierInsertUpdate(data, id)
 *   getDataChanges(module, from)
 *   getSupplierTableRow(id)
 *   deleteSupplierCollectionData(ids, defaultSupplierId)
 *   getSuppliersAjaxList(branchIds, query)
 *   importSupplierModel(data)
 *   supplierPage(filters, options)
 *   exportSupplierOrder(ids)
 *   static updateSupplierModel(data)
 *   getSupplierGraphicalReports(value)
 *
 * Fields (20):
 *   ObjectId (5) : _id, branch_id, created_by_id, updated_by_id, license
 *   String  (13) : branch_name, name, email, phone, address, country, state,
 *                  city, gst, gst_type, gst_number, created_by, updated_by
 *   Date    (2)  : created_date, updated_date
 *
 *   select:true  (13) : _id, name, email, phone, address, country, state, city,
 *                       gst, gst_type, gst_number, created_date, updated_date
 *   select:false  (7) : branch_id, branch_name, created_by_id, created_by,
 *                       updated_by_id, updated_by, license
 *
 * importFields (4): name, email, phone, address
 *
 * Strategy: Pure unit tests with mocks — follows register.model.test.js pattern.
 *   - All BaseModel database methods spied on per-describe or per-test
 *   - No real DB connections
 *   - No real supplier/branch/receiving data
 */

// ─── Mocks (must be declared before requires) ─────────────────────────────────

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('../../../src/utils/helpers', () => ({
  formatDate: jest.fn((d) => (d instanceof Date ? '2024-01-01' : String(d))),
}));

jest.mock('mongodb', () => {
  function MockObjectId(id) {
    if (!(this instanceof MockObjectId)) return new MockObjectId(id);
    this._mockId = id;
    this.toString = () => String(id !== undefined && id !== null ? id : 'mockid000000000000000000');
  }
  MockObjectId.isValid = jest.fn((val) => {
    if (!val) return false;
    if (val instanceof MockObjectId) return true;
    if (typeof val === 'string') return val.length >= 12;
    return false;
  });

  const mockCursor = {
    toArray: jest.fn().mockResolvedValue([]),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
  };

  const mockCollection = {
    find: jest.fn().mockReturnValue(mockCursor),
    findOne: jest.fn().mockResolvedValue(null),
    insertOne: jest.fn().mockResolvedValue({ insertedId: new MockObjectId('ins001aaaaaa') }),
    insertMany: jest
      .fn()
      .mockResolvedValue({ insertedIds: { 0: new MockObjectId('ins001aaaaaa') } }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 2 }),
    deleteMany: jest.fn().mockResolvedValue({ deletedCount: 2 }),
    countDocuments: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
  };

  const mockDb = {
    collection: jest.fn().mockReturnValue(mockCollection),
  };

  const mockClient = {
    db: jest.fn().mockReturnValue(mockDb),
    startSession: jest.fn(),
  };

  return {
    MongoClient: { connect: jest.fn().mockResolvedValue(mockClient) },
    ObjectId: MockObjectId,
    _mockClient: mockClient,
    _mockDb: mockDb,
    _mockCollection: mockCollection,
    _mockCursor: mockCursor,
  };
});

// ─── Requires ─────────────────────────────────────────────────────────────────

const BaseModel = require('../../../src/models/base.model');
const SupplierModel = require('../../../src/models/supplier-legacy.model');

const { ObjectId, _mockDb, _mockCollection, _mockCursor } = jest.requireMock('mongodb');

// ─── Constants ────────────────────────────────────────────────────────────────

const BRANCH_ID = 'aabbcc112233';
const LICENSE_ID = 'ddeeff445566';
const USER_ID = '112233aabbcc';
const SUPPLIER_ID = '778899xxyyzz';

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});

  _mockCursor.toArray.mockResolvedValue([]);
  _mockCursor.sort.mockReturnThis();
  _mockCursor.limit.mockReturnThis();
  _mockCursor.skip.mockReturnThis();

  _mockCollection.find.mockReturnValue(_mockCursor);
  _mockCollection.findOne.mockResolvedValue(null);
  _mockCollection.insertOne.mockResolvedValue({ insertedId: new ObjectId('ins001aaaaaa') });
  _mockCollection.insertMany.mockResolvedValue({
    insertedIds: { 0: new ObjectId('ins001aaaaaa') },
  });
  _mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });
  _mockCollection.updateMany.mockResolvedValue({ modifiedCount: 2 });
  _mockCollection.deleteMany.mockResolvedValue({ deletedCount: 2 });
  _mockCollection.countDocuments.mockResolvedValue(0);
  _mockCollection.aggregate.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });
  _mockDb.collection.mockReturnValue(_mockCollection);

  ObjectId.isValid.mockImplementation((val) => {
    if (!val) return false;
    if (val instanceof ObjectId) return true;
    if (typeof val === 'string') return val.length >= 12;
    return false;
  });

  BaseModel.mongoClient = jest.requireMock('mongodb')._mockClient;
  BaseModel.database = _mockDb;
  BaseModel.license = null;
  BaseModel.currentBranch = null;
  BaseModel.currentBranchName = null;
  BaseModel.loggedUser = null;
  BaseModel.loggedUserDetails = null;
  BaseModel.currentTimeZone = null;
  BaseModel.limit = 10;
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── Helper ───────────────────────────────────────────────────────────────────

function makeModel() {
  const m = new SupplierModel();
  m.branchId = BRANCH_ID;
  m.licenseId = LICENSE_ID;
  m.loggedUserId = USER_ID;
  m.loggedUserName = 'testuser';
  m.branchName = 'Test Branch';
  return m;
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. Class identity
// ══════════════════════════════════════════════════════════════════════════════
describe('SupplierModel — class identity', () => {
  test('SupplierModel is a class (typeof function)', () => {
    expect(typeof SupplierModel).toBe('function');
  });

  test('new SupplierModel() creates an instance of SupplierModel', () => {
    expect(new SupplierModel()).toBeInstanceOf(SupplierModel);
  });

  test('new SupplierModel() is also an instance of BaseModel', () => {
    expect(new SupplierModel()).toBeInstanceOf(BaseModel);
  });

  test('does not call initializeDB when mongoClient is already set', () => {
    const spy = jest.spyOn(BaseModel.prototype, 'initializeDB');
    new SupplierModel();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('collectionName is set to "suppliers"', () => {
    expect(new SupplierModel().collectionName).toBe('suppliers');
  });

  test('static collectionName is "suppliers"', () => {
    expect(SupplierModel.collectionName).toBe('suppliers');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. Constructor — instance context fields default to null
// ══════════════════════════════════════════════════════════════════════════════
describe('SupplierModel — constructor context fields', () => {
  let m;
  beforeEach(() => {
    m = new SupplierModel();
  });

  test('branchId defaults to null', () => expect(m.branchId).toBeNull());
  test('licenseId defaults to null', () => expect(m.licenseId).toBeNull());
  test('loggedUserId defaults to null', () => expect(m.loggedUserId).toBeNull());
  test('loggedUserName defaults to null', () => expect(m.loggedUserName).toBeNull());
  test('branchName defaults to null', () => expect(m.branchName).toBeNull());
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. fields — schema definition completeness
// ══════════════════════════════════════════════════════════════════════════════
describe('SupplierModel — fields schema definition', () => {
  test('static fields is defined as a class property', () => {
    expect(SupplierModel.fields).toBeDefined();
    expect(typeof SupplierModel.fields).toBe('object');
    expect(SupplierModel.fields).not.toBeNull();
  });

  test('instance.fields is undefined (only accessible via SupplierModel.fields)', () => {
    const m = new SupplierModel();
    expect(m.fields).toBeUndefined();
  });

  test('static fields has exactly 20 entries', () => {
    expect(Object.keys(SupplierModel.fields)).toHaveLength(20);
  });

  test('all expected field names are present', () => {
    const expected = [
      '_id',
      'branch_id',
      'branch_name',
      'name',
      'email',
      'phone',
      'address',
      'country',
      'state',
      'city',
      'gst',
      'gst_type',
      'gst_number',
      'created_date',
      'updated_date',
      'created_by_id',
      'created_by',
      'updated_by_id',
      'updated_by',
      'license',
    ];
    const actual = Object.keys(SupplierModel.fields);
    expected.forEach((name) => expect(actual).toContain(name));
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. importFields — schema definition
// ══════════════════════════════════════════════════════════════════════════════
describe('SupplierModel — importFields schema', () => {
  test('importFields is defined as a static property', () => {
    expect(SupplierModel.importFields).toBeDefined();
    expect(typeof SupplierModel.importFields).toBe('object');
  });

  test('importFields has exactly 4 entries', () => {
    expect(Object.keys(SupplierModel.importFields)).toHaveLength(4);
  });

  test('importFields contains name, email, phone, address', () => {
    ['name', 'email', 'phone', 'address'].forEach((f) => {
      expect(SupplierModel.importFields).toHaveProperty(f);
    });
  });

  test('all importFields have select:true', () => {
    Object.values(SupplierModel.importFields).forEach((f) => {
      expect(f.select).toBe(true);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. fields — ObjectId typed fields
// ══════════════════════════════════════════════════════════════════════════════
describe('SupplierModel — ObjectId typed fields', () => {
  let fields;
  beforeEach(() => {
    fields = SupplierModel.fields;
  });

  test('_id has type "ObjectId"', () => expect(fields._id.type).toBe('ObjectId'));
  test('_id has name:"id" alias', () => expect(fields._id.name).toBe('id'));
  test('branch_id has type "ObjectId"', () => expect(fields.branch_id.type).toBe('ObjectId'));
  test('created_by_id has type "ObjectId"', () =>
    expect(fields.created_by_id.type).toBe('ObjectId'));
  test('updated_by_id has type "ObjectId"', () =>
    expect(fields.updated_by_id.type).toBe('ObjectId'));
  test('license has type "ObjectId"', () => expect(fields.license.type).toBe('ObjectId'));
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. fields — String typed fields
// ══════════════════════════════════════════════════════════════════════════════
describe('SupplierModel — String typed fields', () => {
  let fields;
  beforeEach(() => {
    fields = SupplierModel.fields;
  });

  test('branch_name has type "String"', () => expect(fields.branch_name.type).toBe('String'));
  test('name has type "String"', () => expect(fields.name.type).toBe('String'));
  test('email has type "String"', () => expect(fields.email.type).toBe('String'));
  test('phone has type "String"', () => expect(fields.phone.type).toBe('String'));
  test('address has type "String"', () => expect(fields.address.type).toBe('String'));
  test('country has type "String"', () => expect(fields.country.type).toBe('String'));
  test('state has type "String"', () => expect(fields.state.type).toBe('String'));
  test('city has type "String"', () => expect(fields.city.type).toBe('String'));
  test('gst has type "String"', () => expect(fields.gst.type).toBe('String'));
  test('gst_type has type "String"', () => expect(fields.gst_type.type).toBe('String'));
  test('gst_number has type "String"', () => expect(fields.gst_number.type).toBe('String'));
  test('created_by has type "String"', () => expect(fields.created_by.type).toBe('String'));
  test('updated_by has type "String"', () => expect(fields.updated_by.type).toBe('String'));
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. fields — Date typed fields
// ══════════════════════════════════════════════════════════════════════════════
describe('SupplierModel — Date typed fields', () => {
  let fields;
  beforeEach(() => {
    fields = SupplierModel.fields;
  });

  test('created_date has type "Date"', () => expect(fields.created_date.type).toBe('Date'));
  test('updated_date has type "Date"', () => expect(fields.updated_date.type).toBe('Date'));
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. fields — select:true / select:false
// ══════════════════════════════════════════════════════════════════════════════
describe('SupplierModel — fields select:true', () => {
  let fields;
  beforeEach(() => {
    fields = SupplierModel.fields;
  });

  const selectTrueFields = [
    '_id',
    'name',
    'email',
    'phone',
    'address',
    'country',
    'state',
    'city',
    'gst',
    'gst_type',
    'gst_number',
    'created_date',
    'updated_date',
  ];

  test('exactly 13 fields have select:true', () => {
    expect(Object.values(fields).filter((f) => f.select === true)).toHaveLength(13);
  });

  selectTrueFields.forEach((fieldName) => {
    test(`${fieldName} has select:true`, () => {
      expect(fields[fieldName].select).toBe(true);
    });
  });
});

describe('SupplierModel — fields select:false (hidden from default projection)', () => {
  let fields;
  beforeEach(() => {
    fields = SupplierModel.fields;
  });

  const selectFalseFields = [
    'branch_id',
    'branch_name',
    'created_by_id',
    'created_by',
    'updated_by_id',
    'updated_by',
    'license',
  ];

  test('exactly 7 fields have select:false', () => {
    expect(Object.values(fields).filter((f) => f.select === false)).toHaveLength(7);
  });

  selectFalseFields.forEach((fieldName) => {
    test(`${fieldName} has select:false`, () => {
      expect(fields[fieldName].select).toBe(false);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. getSelectFields integration
// ══════════════════════════════════════════════════════════════════════════════
describe('SupplierModel — getSelectFields integration', () => {
  let model;
  beforeEach(() => {
    model = new SupplierModel();
  });

  test('returns 13-field projection when showAll=false', () => {
    expect(Object.keys(BaseModel.getSelectFields(SupplierModel.fields, false))).toHaveLength(13);
  });

  test('all projection values are 1', () => {
    const proj = BaseModel.getSelectFields(SupplierModel.fields, false);
    Object.values(proj).forEach((v) => expect(v).toBe(1));
  });

  test('projection includes name, email, phone, address', () => {
    const proj = BaseModel.getSelectFields(SupplierModel.fields, false);
    ['name', 'email', 'phone', 'address'].forEach((f) => expect(proj).toHaveProperty(f, 1));
  });

  test('projection excludes license', () => {
    expect(BaseModel.getSelectFields(SupplierModel.fields, false)).not.toHaveProperty('license');
  });

  test('projection excludes branch_id, created_by, updated_by', () => {
    const proj = BaseModel.getSelectFields(SupplierModel.fields, false);
    ['branch_id', 'created_by', 'updated_by'].forEach((f) => expect(proj).not.toHaveProperty(f));
  });

  test('showAll=true returns entire fields object (SupplierModel.fields)', () => {
    expect(BaseModel.getSelectFields(SupplierModel.fields, true)).toBe(SupplierModel.fields);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. supplierDetails
// ══════════════════════════════════════════════════════════════════════════════
describe('SupplierModel — supplierDetails', () => {
  let m;
  beforeEach(() => {
    m = makeModel();
    jest.spyOn(m, 'getCollection').mockResolvedValue(_mockCollection);
  });

  test('returns null when findOne finds nothing', async () => {
    _mockCollection.findOne.mockResolvedValue(null);
    expect(await m.supplierDetails(SUPPLIER_ID)).toBeNull();
  });

  test('returns the supplier document when found', async () => {
    const doc = { _id: new ObjectId(SUPPLIER_ID), name: 'Supplier A', phone: '9999999999' };
    _mockCollection.findOne.mockResolvedValue(doc);
    const result = await m.supplierDetails(SUPPLIER_ID);
    expect(result.name).toBe('Supplier A');
  });

  test('returns null on DB error (error is swallowed)', async () => {
    jest.spyOn(m, 'getCollection').mockRejectedValue(new Error('DB fail'));
    expect(await m.supplierDetails(SUPPLIER_ID)).toBeNull();
  });

  test('queries with both _id and license filter', async () => {
    await m.supplierDetails(SUPPLIER_ID);
    const [filterArg] = _mockCollection.findOne.mock.calls[0];
    expect(filterArg).toHaveProperty('_id');
    expect(filterArg).toHaveProperty('license');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. supplierInsertUpdate — insert path
// ══════════════════════════════════════════════════════════════════════════════
describe('SupplierModel — supplierInsertUpdate (insert)', () => {
  let m;
  beforeEach(() => {
    m = makeModel();
    jest.spyOn(m, 'getCollection').mockResolvedValue(_mockCollection);
    jest.spyOn(m, 'checkPlan').mockResolvedValue(0);
    jest.spyOn(m, 'changeLog').mockResolvedValue(null);
    _mockCollection.findOne.mockResolvedValue(null);
  });

  test('returns status:true with supplier_id on successful insert', async () => {
    const r = await m.supplierInsertUpdate({ name: 'Acme Ltd', phone: '1234567890' });
    expect(r.status).toBe(true);
    expect(r.data).toHaveProperty('supplier_id');
    expect(r.message).toBe('Supplier added successfully');
  });

  test('calls insertOne with correct field shape', async () => {
    await m.supplierInsertUpdate({
      name: 'Acme Ltd',
      phone: '9876543210',
      email: 'acme@test.com',
      address: 'HQ',
    });
    const [insertArg] = _mockCollection.insertOne.mock.calls[0];
    expect(insertArg.name).toBe('Acme Ltd');
    expect(insertArg.branch_id).toBeDefined();
    expect(insertArg.license).toBeDefined();
    expect(insertArg.created_date).toBeInstanceOf(Date);
  });

  test('gst is set to "enable" when indian_gst is "gst_on"', async () => {
    await m.supplierInsertUpdate({ name: 'X', phone: 'Y', indian_gst: 'gst_on' });
    const [insertArg] = _mockCollection.insertOne.mock.calls[0];
    expect(insertArg.gst).toBe('enable');
  });

  test('gst is set to "disable" when indian_gst is anything else', async () => {
    await m.supplierInsertUpdate({ name: 'X', phone: 'Y', indian_gst: 'gst_off' });
    const [insertArg] = _mockCollection.insertOne.mock.calls[0];
    expect(insertArg.gst).toBe('disable');
  });

  test('calls changeLog with "insert" action after insert', async () => {
    await m.supplierInsertUpdate({ name: 'X', phone: 'Y' });
    expect(m.changeLog).toHaveBeenCalledWith(
      'suppliers',
      expect.anything(),
      expect.anything(),
      'insert'
    );
  });

  test('trims name, email, phone, address before insert', async () => {
    await m.supplierInsertUpdate({
      name: '  Acme  ',
      phone: '  999  ',
      email: '  a@b.com  ',
      address: '  HQ  ',
    });
    const [insertArg] = _mockCollection.insertOne.mock.calls[0];
    expect(insertArg.name).toBe('Acme');
    expect(insertArg.phone).toBe('999');
    expect(insertArg.email).toBe('a@b.com');
    expect(insertArg.address).toBe('HQ');
  });

  test('uses gstin_number when gst_number is absent', async () => {
    await m.supplierInsertUpdate({ name: 'X', phone: 'Y', gstin_number: 'GSTIN123ABCDE' });
    const [insertArg] = _mockCollection.insertOne.mock.calls[0];
    expect(insertArg.gst_number).toBe('GSTIN123ABCDE');
  });

  test('returns status:false on exception', async () => {
    jest.spyOn(m, 'getCollection').mockRejectedValue(new Error('DB crash'));
    const r = await m.supplierInsertUpdate({ name: 'X' });
    expect(r.status).toBe(false);
    expect(r.message).toBe('DB crash');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. supplierInsertUpdate — update path
// ══════════════════════════════════════════════════════════════════════════════
describe('SupplierModel — supplierInsertUpdate (update)', () => {
  let m;
  beforeEach(() => {
    m = makeModel();
    jest.spyOn(m, 'getCollection').mockResolvedValue(_mockCollection);
    jest.spyOn(m, 'checkPlan').mockResolvedValue(0);
    jest.spyOn(m, 'changeLog').mockResolvedValue(null);
    _mockCollection.findOne.mockResolvedValue(null);
  });

  test('returns status:true with modifiedCount on successful update', async () => {
    _mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });
    const r = await m.supplierInsertUpdate({ name: 'Updated Supplier', phone: '999' }, SUPPLIER_ID);
    expect(r.status).toBe(true);
    expect(r.data).toBe(1);
    expect(r.message).toBe('Supplier updated successfully');
  });

  test('calls updateOne with $set containing correct fields', async () => {
    await m.supplierInsertUpdate({ name: 'Test', phone: '111', city: 'Mumbai' }, SUPPLIER_ID);
    const [, updateArg] = _mockCollection.updateOne.mock.calls[0];
    expect(updateArg.$set.name).toBe('Test');
    expect(updateArg.$set.city).toBe('Mumbai');
    expect(updateArg.$set.updated_date).toBeInstanceOf(Date);
  });

  test('calls changeLog with "update" action after update', async () => {
    await m.supplierInsertUpdate({ name: 'X', phone: 'Y' }, SUPPLIER_ID);
    expect(m.changeLog).toHaveBeenCalledWith(
      'suppliers',
      expect.anything(),
      expect.anything(),
      'update'
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 13. supplierInsertUpdate — duplicate / plan limit
// ══════════════════════════════════════════════════════════════════════════════
describe('SupplierModel — supplierInsertUpdate (duplicate and plan limit)', () => {
  let m;
  beforeEach(() => {
    m = makeModel();
    jest.spyOn(m, 'getCollection').mockResolvedValue(_mockCollection);
    jest.spyOn(m, 'checkPlan').mockResolvedValue(0);
    jest.spyOn(m, 'changeLog').mockResolvedValue(null);
  });

  test('returns status:"exist" when supplier with same name+phone already exists', async () => {
    _mockCollection.findOne.mockResolvedValue({ _id: new ObjectId('different001'), name: 'Acme' });
    const r = await m.supplierInsertUpdate({ name: 'Acme', phone: '9999999999' });
    expect(r.status).toBe('exist');
    expect(r.message).toMatch(/already exist/i);
  });

  test('allows update when the matching record IS the same supplier', async () => {
    _mockCollection.findOne.mockResolvedValue({ _id: new ObjectId(SUPPLIER_ID), name: 'Acme' });
    _mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });
    const r = await m.supplierInsertUpdate({ name: 'Acme', phone: '9999' }, SUPPLIER_ID);
    expect(r.status).toBe(true);
  });

  test('returns status:"error" when plan limit is reached', async () => {
    _mockCollection.findOne.mockResolvedValue(null);
    jest.spyOn(m, 'checkPlan').mockResolvedValue(5);
    _mockCollection.countDocuments.mockResolvedValue(5);
    const r = await m.supplierInsertUpdate({ name: 'New Supplier', phone: '111' });
    expect(r.status).toBe('error');
    expect(r.message).toMatch(/limit reached/i);
  });

  test('allows insert when count is below plan limit', async () => {
    _mockCollection.findOne.mockResolvedValue(null);
    jest.spyOn(m, 'checkPlan').mockResolvedValue(10);
    _mockCollection.countDocuments.mockResolvedValue(4);
    const r = await m.supplierInsertUpdate({ name: 'Allowed Supplier', phone: '111' });
    expect(r.status).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 14. getDataChanges
// ══════════════════════════════════════════════════════════════════════════════
describe('SupplierModel — getDataChanges', () => {
  let m;
  beforeEach(() => {
    m = makeModel();
    jest.spyOn(m, 'getAllDataChanges').mockResolvedValue([]);
  });

  test('delegates to getAllDataChanges with "suppliers" collection', async () => {
    await m.getDataChanges('sync', '2024-01-01');
    expect(m.getAllDataChanges).toHaveBeenCalledWith(
      'suppliers',
      'sync',
      '2024-01-01',
      expect.anything()
    );
  });

  test('passes the select projection from SupplierModel.fields', async () => {
    await m.getDataChanges('sync', '2024-01-01');
    const [, , , projection] = m.getAllDataChanges.mock.calls[0];
    expect(typeof projection).toBe('object');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 15. getSupplierTableRow
// ══════════════════════════════════════════════════════════════════════════════
describe('SupplierModel — getSupplierTableRow', () => {
  let m;
  beforeEach(() => {
    m = makeModel();
  });

  test('returns status:true with data when getOneRow succeeds', async () => {
    jest
      .spyOn(m, 'getOneRow')
      .mockResolvedValue({ status: true, data: { name: 'Sup A' }, message: 'ok' });
    const r = await m.getSupplierTableRow(SUPPLIER_ID);
    expect(r.status).toBe(true);
    expect(r.data.name).toBe('Sup A');
  });

  test('returns status:false when getOneRow returns status:false', async () => {
    jest
      .spyOn(m, 'getOneRow')
      .mockResolvedValue({ status: false, data: null, message: 'not found' });
    const r = await m.getSupplierTableRow(SUPPLIER_ID);
    expect(r.status).toBe(false);
    expect(r.data).toBeNull();
    expect(r.message).toBe('error');
  });

  test('returns status:false on exception', async () => {
    jest.spyOn(m, 'getOneRow').mockRejectedValue(new Error('Crash'));
    const r = await m.getSupplierTableRow(SUPPLIER_ID);
    expect(r.status).toBe(false);
    expect(r.message).toBe('Crash');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 16. deleteSupplierCollectionData
// ══════════════════════════════════════════════════════════════════════════════
describe('SupplierModel — deleteSupplierCollectionData', () => {
  let m;
  beforeEach(() => {
    m = makeModel();
    jest.spyOn(m, 'getCollection').mockResolvedValue(_mockCollection);
    jest.spyOn(m, 'changeLog').mockResolvedValue(null);
    jest.spyOn(m, 'deletedDocumentBackup').mockResolvedValue(null);
    _mockCursor.toArray.mockResolvedValue([]);
  });

  test('returns status:false when trying to delete the default supplier', async () => {
    const r = await m.deleteSupplierCollectionData([SUPPLIER_ID], SUPPLIER_ID);
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/default supplier/i);
  });

  test('returns status:true with deletedCount on successful delete', async () => {
    _mockCollection.deleteMany.mockResolvedValue({ deletedCount: 2 });
    const r = await m.deleteSupplierCollectionData([SUPPLIER_ID, BRANCH_ID]);
    expect(r.status).toBe(true);
    expect(r.data).toBe(2);
    expect(r.message).toBe('Supplier deleted successfully');
  });

  test('calls changeLog once per deleted supplier id', async () => {
    await m.deleteSupplierCollectionData([SUPPLIER_ID, BRANCH_ID]);
    expect(m.changeLog).toHaveBeenCalledTimes(2);
    expect(m.changeLog).toHaveBeenCalledWith(
      'suppliers',
      expect.anything(),
      expect.anything(),
      'delete'
    );
  });

  test('calls deletedDocumentBackup for each found document', async () => {
    _mockCursor.toArray.mockResolvedValue([{ _id: new ObjectId(SUPPLIER_ID), name: 'S1' }]);
    await m.deleteSupplierCollectionData([SUPPLIER_ID]);
    expect(m.deletedDocumentBackup).toHaveBeenCalledWith(
      'suppliers',
      expect.objectContaining({ name: 'S1' })
    );
  });

  test('returns status:false on exception', async () => {
    jest.spyOn(m, 'getCollection').mockRejectedValue(new Error('DB down'));
    const r = await m.deleteSupplierCollectionData([SUPPLIER_ID]);
    expect(r.status).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 17. getSuppliersAjaxList
// ══════════════════════════════════════════════════════════════════════════════
describe('SupplierModel — getSuppliersAjaxList', () => {
  let m;
  beforeEach(() => {
    m = makeModel();
    jest.spyOn(m, 'getCollection').mockResolvedValue(_mockCollection);
  });

  test('returns status:true with empty array when no suppliers found', async () => {
    _mockCursor.toArray.mockResolvedValue([]);
    const r = await m.getSuppliersAjaxList([BRANCH_ID]);
    expect(r.status).toBe(true);
    expect(r.data).toEqual([]);
  });

  test('maps returned documents to expected shape', async () => {
    _mockCursor.toArray.mockResolvedValue([
      {
        _id: new ObjectId(SUPPLIER_ID),
        name: 'Acme Ltd',
        phone: '9876543210',
        email: 'acme@test.com',
        address: 'HQ Road',
        state: 'MH',
        gst_type: 'regular',
        gst_number: 'GST001',
        branch_name: 'Branch A',
      },
    ]);
    const r = await m.getSuppliersAjaxList([BRANCH_ID]);
    expect(r.data[0].id).toBe(SUPPLIER_ID);
    expect(r.data[0].name).toBe('Acme Ltd');
    expect(r.data[0].gst_number).toBe('GST001');
    expect(r.data[0].branch).toBe('Branch A');
  });

  test('applies regex search on name, phone, email when query is provided', async () => {
    _mockCursor.toArray.mockResolvedValue([]);
    await m.getSuppliersAjaxList([BRANCH_ID], 'acme');
    const [filterArg] = _mockCollection.find.mock.calls[0];
    const orCondition = filterArg.$and.find((c) => c.$or);
    expect(
      orCondition.$or.some(
        (c) =>
          c.name instanceof RegExp ||
          c.name?.$regex !== undefined ||
          (c.name && typeof c.name === 'object')
      )
    ).toBe(true);
  });

  test('handles scalar branchId (non-array)', async () => {
    _mockCursor.toArray.mockResolvedValue([]);
    const r = await m.getSuppliersAjaxList(BRANCH_ID);
    expect(r.status).toBe(true);
  });

  test('returns status:false on exception', async () => {
    jest.spyOn(m, 'getCollection').mockRejectedValue(new Error('fail'));
    const r = await m.getSuppliersAjaxList([BRANCH_ID]);
    expect(r.status).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 18. importSupplierModel
// ══════════════════════════════════════════════════════════════════════════════
describe('SupplierModel — importSupplierModel', () => {
  let m;
  beforeEach(() => {
    m = makeModel();
    jest.spyOn(m, 'getCollection').mockResolvedValue(_mockCollection);
    jest.spyOn(m, 'checkPlan').mockResolvedValue(0);
    _mockCollection.findOne.mockResolvedValue(null);
    _mockCursor.toArray.mockResolvedValue([]);
  });

  test('returns status:true with validation errors when name field is missing', async () => {
    const data = [{ phone: '9999999999', email: 'a@b.com', address: 'HQ' }];
    const r = await m.importSupplierModel(data);
    expect(r.status).toBe(true);
    expect(r.message).toBe('CSV');
    expect(r.data).toHaveLength(1);
    expect(r.data[0].status).toContain('name');
  });

  test('returns status:false when all suppliers already exist', async () => {
    _mockCollection.findOne.mockResolvedValue({ _id: new ObjectId(SUPPLIER_ID), name: 'Existing' });
    const data = [{ name: 'Existing Supplier', phone: '9999999999' }];
    const r = await m.importSupplierModel(data);
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/already imported/i);
  });

  test('inserts new suppliers and returns status:true on success', async () => {
    _mockCollection.findOne.mockResolvedValue(null);
    _mockCollection.insertMany.mockResolvedValue({
      insertedIds: { 0: new ObjectId('ins001aaaaaa') },
    });
    const data = [
      { name: 'New Supplier', phone: '1111111111', email: 'new@test.com', address: 'New St' },
    ];
    const r = await m.importSupplierModel(data);
    expect(r.status).toBe(true);
    expect(r.message).toBe('Supplier data imported successfully');
    expect(_mockCollection.insertMany).toHaveBeenCalledTimes(1);
  });

  test('respects plan limit — caps import count to maxImport', async () => {
    jest.spyOn(m, 'checkPlan').mockResolvedValue(1);
    const data = [
      { name: 'Sup1', phone: '111' },
      { name: 'Sup2', phone: '222' },
      { name: 'Sup3', phone: '333' },
    ];
    _mockCollection.findOne.mockResolvedValue(null);
    await m.importSupplierModel(data);
    const [insertArg] = _mockCollection.insertMany.mock.calls[0];
    expect(insertArg).toHaveLength(1);
  });

  test('returns status:false on exception', async () => {
    jest.spyOn(m, 'getCollection').mockRejectedValue(new Error('IO error'));
    const r = await m.importSupplierModel([{ name: 'X' }]);
    expect(r.status).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 19. supplierPage
// ══════════════════════════════════════════════════════════════════════════════
describe('SupplierModel — supplierPage', () => {
  let m;
  beforeEach(() => {
    m = makeModel();
    jest.spyOn(m, 'getCollection').mockResolvedValue(_mockCollection);
    jest.spyOn(BaseModel, 'simplifyFields').mockImplementation((item) => item);
    _mockCollection.countDocuments.mockResolvedValue(0);
    _mockCursor.toArray.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('returns status:false when branchId or licenseId is null', async () => {
    m.branchId = null;
    const r = await m.supplierPage();
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/context required/i);
  });

  test('returns status:true with pagination shape on success', async () => {
    _mockCollection.countDocuments.mockResolvedValue(10);
    _mockCursor.toArray.mockResolvedValue([{ _id: new ObjectId(SUPPLIER_ID), name: 'Sup A' }]);
    const r = await m.supplierPage({}, { page: 1, limit: 5 });
    expect(r.status).toBe(true);
    expect(r.data).toHaveProperty('total', 10);
    expect(r.data).toHaveProperty('current_page', 1);
    expect(r.data).toHaveProperty('total_pages');
    expect(r.data).toHaveProperty('per_page', 5);
    expect(Array.isArray(r.data.list)).toBe(true);
  });

  test('returns total_pages:1 when total is 0', async () => {
    _mockCollection.countDocuments.mockResolvedValue(0);
    const r = await m.supplierPage({}, { page: 1, limit: 5 });
    expect(r.data.total_pages).toBe(1);
  });

  test('returns status:false on exception', async () => {
    jest.spyOn(m, 'getCollection').mockRejectedValue(new Error('fail'));
    const r = await m.supplierPage();
    expect(r.status).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 20. exportSupplierOrder
// ══════════════════════════════════════════════════════════════════════════════
describe('SupplierModel — exportSupplierOrder', () => {
  let m;
  beforeEach(() => {
    m = makeModel();
    jest.spyOn(m, 'getCollection').mockResolvedValue(_mockCollection);
    _mockCursor.toArray.mockResolvedValue([]);
  });

  test('returns status:true with empty data when ids is empty array', async () => {
    const r = await m.exportSupplierOrder([]);
    expect(r.status).toBe(true);
    expect(r.data).toEqual([]);
    expect(r.message).toBe('Supplier Data Exported');
  });

  test('returns status:true with empty data when ids is null', async () => {
    const r = await m.exportSupplierOrder(null);
    expect(r.status).toBe(true);
    expect(r.data).toEqual([]);
  });

  test('filters out invalid ObjectIds (short strings)', async () => {
    const r = await m.exportSupplierOrder(['bad', 'short']);
    expect(r.status).toBe(true);
    expect(r.data).toEqual([]);
    expect(_mockCollection.find).not.toHaveBeenCalled();
  });

  test('queries DB with valid ObjectIds and returns data', async () => {
    const doc = { _id: new ObjectId(SUPPLIER_ID), name: 'Sup A', email: 'a@b.com' };
    _mockCursor.toArray.mockResolvedValue([doc]);
    const r = await m.exportSupplierOrder([SUPPLIER_ID]);
    expect(r.status).toBe(true);
    expect(r.data).toHaveLength(1);
    expect(r.data[0].name).toBe('Sup A');
  });

  test('returns graceful empty result on DB error', async () => {
    jest.spyOn(m, 'getCollection').mockRejectedValue(new Error('crash'));
    const r = await m.exportSupplierOrder([SUPPLIER_ID]);
    expect(r.status).toBe(true);
    expect(r.data).toEqual([]);
    expect(r.message).toBe('Supplier Data Exported');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 21. updateSupplierModel (static)
// ══════════════════════════════════════════════════════════════════════════════
describe('SupplierModel — static updateSupplierModel', () => {
  test('returns 0 when BaseModel.database is not set', async () => {
    BaseModel.database = null;
    const r = await SupplierModel.updateSupplierModel({ id: BRANCH_ID, branch_name: 'New' });
    expect(r).toBe(0);
  });

  test('calls updateMany on suppliers collection and returns modifiedCount', async () => {
    BaseModel.database = _mockDb;
    _mockCollection.updateMany.mockResolvedValue({ modifiedCount: 3 });
    const r = await SupplierModel.updateSupplierModel({
      id: BRANCH_ID,
      branch_name: 'Updated Branch',
    });
    expect(r).toBe(3);
    expect(_mockCollection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ branch_id: expect.any(ObjectId) }),
      expect.objectContaining({ $set: { branch_name: 'Updated Branch' } })
    );
  });

  test('returns 0 on exception', async () => {
    BaseModel.database = _mockDb;
    _mockCollection.updateMany.mockRejectedValue(new Error('DB fail'));
    const r = await SupplierModel.updateSupplierModel({ id: BRANCH_ID, branch_name: 'X' });
    expect(r).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 22. getSupplierGraphicalReports
// ══════════════════════════════════════════════════════════════════════════════
describe('SupplierModel — getSupplierGraphicalReports', () => {
  let m;
  beforeEach(() => {
    m = makeModel();
    jest.spyOn(m, 'startingDate').mockReturnValue(1000000);
    jest.spyOn(m, 'endingDate').mockReturnValue(2000000);
  });

  test('returns status:false when BaseModel.database is not set', async () => {
    BaseModel.database = null;
    const r = await m.getSupplierGraphicalReports({
      branchid: [BRANCH_ID],
      starting_date: '',
      ending_date: '',
    });
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/not connected/i);
  });

  test('returns status:true with empty graphical data when no receivings', async () => {
    BaseModel.database = _mockDb;
    _mockCollection.aggregate.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });
    const r = await m.getSupplierGraphicalReports({
      branchid: [BRANCH_ID],
      starting_date: '',
      ending_date: '',
    });
    expect(r.status).toBe(true);
    expect(r.data).toEqual({});
  });

  test('maps aggregation results into graphical data object', async () => {
    BaseModel.database = _mockDb;
    _mockCollection.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        {
          _id: { supplier_name: 'Acme Supplies' },
          total_amount: 50000.567,
          avg: 10000.123,
          receiving_count: 5,
        },
      ]),
    });
    const r = await m.getSupplierGraphicalReports({
      branchid: [BRANCH_ID],
      starting_date: '',
      ending_date: '',
    });
    expect(r.status).toBe(true);
    expect(r.data).toHaveProperty('Acme Supplies');
    expect(r.data['Acme Supplies'].total).toBe(50000.57);
    expect(r.data['Acme Supplies']['no.of.sale']).toBe(5);
  });

  test('returns status:false on exception', async () => {
    BaseModel.database = _mockDb;
    _mockCollection.aggregate.mockImplementation(() => {
      throw new Error('agg fail');
    });
    const r = await m.getSupplierGraphicalReports({
      branchid: [BRANCH_ID],
      starting_date: '',
      ending_date: '',
    });
    expect(r.status).toBe(false);
    expect(r.message).toBe('agg fail');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 23. assignFilterObjects — type coercion with SupplierModel.fields
// ══════════════════════════════════════════════════════════════════════════════
describe('SupplierModel — assignFilterObjects type coercion', () => {
  let model;
  beforeEach(() => {
    model = makeModel();
  });

  test('converts branch_id filter string to ObjectId', () => {
    const r = model.assignFilterObjects({ branch_id: 'abc123def456' }, SupplierModel.fields);
    expect(r.branch_id).toBeInstanceOf(ObjectId);
  });

  test('converts license filter string to ObjectId', () => {
    const r = model.assignFilterObjects({ license: 'abc123def456' }, SupplierModel.fields);
    expect(r.license).toBeInstanceOf(ObjectId);
  });

  test('converts created_date filter string to Date', () => {
    const r = model.assignFilterObjects({ created_date: '2024-06-01' }, SupplierModel.fields);
    expect(r.created_date).toBeInstanceOf(Date);
  });

  test('leaves name filter unchanged (String field)', () => {
    const r = model.assignFilterObjects({ name: 'Acme Ltd' }, SupplierModel.fields);
    expect(r.name).toBe('Acme Ltd');
  });

  test('leaves gst_type filter unchanged (String field)', () => {
    const r = model.assignFilterObjects({ gst_type: 'regular' }, SupplierModel.fields);
    expect(r.gst_type).toBe('regular');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 24. Instance independence
// ══════════════════════════════════════════════════════════════════════════════
describe('SupplierModel — instance independence', () => {
  test('context fields on one instance do not affect another', () => {
    const m1 = makeModel();
    const m2 = new SupplierModel();
    expect(m2.branchId).toBeNull();
    expect(m2.licenseId).toBeNull();
    expect(m1.branchId).toBe(BRANCH_ID);
  });

  test('setCollectionName on one instance does not affect another', () => {
    const m1 = new SupplierModel();
    const m2 = new SupplierModel();
    m1.setCollectionName('suppliers_v2');
    expect(m2.getCollectionName()).toBe('suppliers');
  });

  test('static fields is accessible on the class (not on instances)', () => {
    const m1 = new SupplierModel();
    expect(m1.fields).toBeUndefined();
    expect(SupplierModel.fields).toBeDefined();
    expect(Object.keys(SupplierModel.fields)).toHaveLength(20);
  });
});
