'use strict';

/**
 * Unit tests for src/models/stock-log.model.js
 *
 * File confirmed : src/models/stock-log.model.js (35 lines)
 * Similar files  : none
 *   - stock-logs.model.js      — does NOT exist
 *   - inventory-log.model.js   — does NOT exist
 *   - stock.model.js           — does NOT exist
 *   - stock-log.schema.js      — does NOT exist
 *   - stock-log.model.ts       — does NOT exist
 *
 * Type           : Native-driver data-access class (NOT a Mongoose model)
 *                  extends BaseModel (src/models/base.model.js)
 *
 * Collection     : "stocklogs" (MongoDB collection name)
 *
 * ORM / Driver   : MongoDB native driver via BaseModel
 *
 * StockLogModel adds:
 *   1. constructor — sets collectionName = "stocklogs"
 *   2. static fields — 19-field legacy schema descriptor used by:
 *        - BaseModel.getSelectFields()   → MongoDB projection objects
 *        - Repository.assignFilterObjects() → filter type coercion
 *
 * All database operations (CRUD, pagination, aggregation, changeLog, etc.)
 * are inherited from BaseModel and are already exhaustively tested in
 * tests/unit/models/base.model.test.js.
 * This file tests ONLY what is unique to StockLogModel.
 *
 * Fields summary (19 total):
 *   ObjectId (5) : _id, branch_id, view_item_id, changed_by_userid, license
 *   String  (10) : item_barcode_id, item_name, item_quantity, process,
 *                  reference, action, opening_balance, closing_balance,
 *                  count, changed_by
 *   Date    (3)  : date, created_date, updated_date
 *   Boolean (1)  : stocklog
 *
 *   select:true  (18) — all fields except license
 *   select:false  (1) — license
 *
 * Related files (tested separately):
 *   src/repositories/stock-logs.repository.js
 *   src/services/stock-logs.service.js
 *   src/controllers/stock-logs.controller.js
 *   src/constants/stock-logs.constants.js
 *   src/helpers/stock-logs.helper.js
 *
 * Strategy: Follows register.model.test.js mock pattern exactly.
 *   - Mock 'mongodb'           → prevent real DB connections
 *   - Mock 'dotenv'            → prevent .env loading
 *   - Mock '../utils/helpers'  → stub formatDate
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
    insertOne: jest.fn().mockResolvedValue({ insertedId: 'ins001' }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
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
const StockLogModel = require('../../../src/models/stock-log.model');

const { ObjectId, _mockDb, _mockCollection } = jest.requireMock('mongodb');

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  _mockCollection.find.mockReturnValue(jest.requireMock('mongodb')._mockCursor);
  _mockCollection.findOne.mockResolvedValue(null);
  _mockCollection.insertOne.mockResolvedValue({ insertedId: 'ins001' });
  _mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });
  _mockCollection.deleteOne.mockResolvedValue({ deletedCount: 1 });
  _mockCollection.countDocuments.mockResolvedValue(0);
  _mockCollection.aggregate.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });
  _mockDb.collection.mockReturnValue(_mockCollection);

  ObjectId.isValid.mockImplementation((val) => {
    if (!val) return false;
    if (val instanceof ObjectId) return true;
    if (typeof val === 'string') return val.length >= 12;
    return false;
  });

  // Pre-seed mongoClient / database to prevent initializeDB being called
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

// ══════════════════════════════════════════════════════════════════════════════
// 1. Class identity
// ══════════════════════════════════════════════════════════════════════════════
describe('StockLogModel — class identity', () => {
  test('StockLogModel is a class (typeof function)', () => {
    expect(typeof StockLogModel).toBe('function');
  });

  test('new StockLogModel() creates an instance of StockLogModel', () => {
    const m = new StockLogModel();
    expect(m).toBeInstanceOf(StockLogModel);
  });

  test('new StockLogModel() is also an instance of BaseModel (extends BaseModel)', () => {
    const m = new StockLogModel();
    expect(m).toBeInstanceOf(BaseModel);
  });

  test('does not call initializeDB when mongoClient is already set', () => {
    const spy = jest.spyOn(BaseModel.prototype, 'initializeDB');
    new StockLogModel();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('collectionName is set to "stocklogs"', () => {
    const m = new StockLogModel();
    expect(m.collectionName).toBe('stocklogs');
  });

  test('getCollectionName() returns "stocklogs"', () => {
    const m = new StockLogModel();
    expect(m.getCollectionName()).toBe('stocklogs');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. fields — schema definition completeness
// ══════════════════════════════════════════════════════════════════════════════
describe('StockLogModel — fields schema definition', () => {
  let model;
  beforeEach(() => {
    model = new StockLogModel();
  });

  test('fields property is defined on instance', () => {
    expect(model.fields).toBeDefined();
    expect(typeof model.fields).toBe('object');
    expect(model.fields).not.toBeNull();
  });

  test('fields has exactly 20 entries', () => {
    expect(Object.keys(model.fields)).toHaveLength(20);
  });

  test('all expected field names are present', () => {
    const expectedFields = [
      '_id',
      'branch_id',
      'view_item_id',
      'item_barcode_id',
      'item_name',
      'item_quantity',
      'process',
      'reference',
      'note',
      'date',
      'created_date',
      'updated_date',
      'action',
      'stocklog',
      'opening_balance',
      'closing_balance',
      'count',
      'changed_by_userid',
      'changed_by',
      'license',
    ];
    const actualFields = Object.keys(model.fields);
    expectedFields.forEach((name) => {
      expect(actualFields).toContain(name);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. fields — ObjectId typed fields
// ══════════════════════════════════════════════════════════════════════════════
describe('StockLogModel — ObjectId typed fields', () => {
  let fields;
  beforeEach(() => {
    fields = new StockLogModel().fields;
  });

  test('_id has type "ObjectId"', () => {
    expect(fields._id.type).toBe('ObjectId');
  });

  test('_id has name:"id" alias (PHP-compatible serialization)', () => {
    expect(fields._id.name).toBe('id');
  });

  test('branch_id has type "ObjectId"', () => {
    expect(fields.branch_id.type).toBe('ObjectId');
  });

  test('view_item_id has type "ObjectId"', () => {
    expect(fields.view_item_id.type).toBe('ObjectId');
  });

  test('changed_by_userid has type "ObjectId"', () => {
    expect(fields.changed_by_userid.type).toBe('ObjectId');
  });

  test('license has type "ObjectId"', () => {
    expect(fields.license.type).toBe('ObjectId');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. fields — String typed fields
// ══════════════════════════════════════════════════════════════════════════════
describe('StockLogModel — String typed fields', () => {
  let fields;
  beforeEach(() => {
    fields = new StockLogModel().fields;
  });

  test('item_barcode_id has type "String"', () => {
    expect(fields.item_barcode_id.type).toBe('String');
  });

  test('item_name has type "String"', () => {
    expect(fields.item_name.type).toBe('String');
  });

  test('item_quantity has type "String"', () => {
    expect(fields.item_quantity.type).toBe('String');
  });

  test('process has type "String" (stock movement type: Sale, Receiving, etc.)', () => {
    expect(fields.process.type).toBe('String');
  });

  test('reference has type "String" (source document reference)', () => {
    expect(fields.reference.type).toBe('String');
  });

  test('action has type "String" (movement direction: increase/decrease)', () => {
    expect(fields.action.type).toBe('String');
  });

  test('opening_balance has type "String" (quantity before movement)', () => {
    expect(fields.opening_balance.type).toBe('String');
  });

  test('closing_balance has type "String" (quantity after movement)', () => {
    expect(fields.closing_balance.type).toBe('String');
  });

  test('count has type "String" (quantity changed)', () => {
    expect(fields.count.type).toBe('String');
  });

  test('changed_by has type "String" (user name who made the change)', () => {
    expect(fields.changed_by.type).toBe('String');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. fields — Date typed fields
// ══════════════════════════════════════════════════════════════════════════════
describe('StockLogModel — Date typed fields', () => {
  let fields;
  beforeEach(() => {
    fields = new StockLogModel().fields;
  });

  test('date has type "Date"', () => {
    expect(fields.date.type).toBe('Date');
  });

  test('created_date has type "Date"', () => {
    expect(fields.created_date.type).toBe('Date');
  });

  test('updated_date has type "Date"', () => {
    expect(fields.updated_date.type).toBe('Date');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. fields — Boolean typed fields
// ══════════════════════════════════════════════════════════════════════════════
describe('StockLogModel — Boolean typed fields', () => {
  let fields;
  beforeEach(() => {
    fields = new StockLogModel().fields;
  });

  test('stocklog has type "Boolean"', () => {
    expect(fields.stocklog.type).toBe('Boolean');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. fields — select values (controls MongoDB projection)
// ══════════════════════════════════════════════════════════════════════════════
describe('StockLogModel — fields select:true', () => {
  let fields;
  beforeEach(() => {
    fields = new StockLogModel().fields;
  });

  const selectTrueFields = [
    '_id',
    'branch_id',
    'view_item_id',
    'item_barcode_id',
    'item_name',
    'item_quantity',
    'process',
    'reference',
    'date',
    'created_date',
    'updated_date',
    'action',
    'stocklog',
    'opening_balance',
    'closing_balance',
    'count',
    'changed_by_userid',
    'changed_by',
  ];

  test('exactly 19 fields have select:true', () => {
    const count = Object.values(fields).filter((f) => f.select === true).length;
    expect(count).toBe(19);
  });

  selectTrueFields.forEach((fieldName) => {
    test(`${fieldName} has select:true`, () => {
      expect(fields[fieldName].select).toBe(true);
    });
  });
});

describe('StockLogModel — fields select:false (excluded from default projection)', () => {
  let fields;
  beforeEach(() => {
    fields = new StockLogModel().fields;
  });

  test('exactly 1 field has select:false', () => {
    const count = Object.values(fields).filter((f) => f.select === false).length;
    expect(count).toBe(1);
  });

  test('license has select:false (hidden from default fetch — multi-tenant isolation)', () => {
    expect(fields.license.select).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. static fields — class-level access
// ══════════════════════════════════════════════════════════════════════════════
describe('StockLogModel — static fields', () => {
  test('StockLogModel.fields is defined as a static property', () => {
    expect(StockLogModel.fields).toBeDefined();
    expect(typeof StockLogModel.fields).toBe('object');
    expect(StockLogModel.fields).not.toBeNull();
  });

  test('static fields and instance fields reference the same object', () => {
    const m = new StockLogModel();
    expect(m.fields).toBe(StockLogModel.fields);
  });

  test('static fields has all 20 field entries', () => {
    expect(Object.keys(StockLogModel.fields)).toHaveLength(20);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. getSelectFields integration with StockLogModel.fields
// ══════════════════════════════════════════════════════════════════════════════
describe('StockLogModel — getSelectFields integration', () => {
  let model;
  beforeEach(() => {
    model = new StockLogModel();
  });

  test('static getSelectFields returns 19-field projection when showAll=false', () => {
    const result = BaseModel.getSelectFields(model.fields, false);
    expect(Object.keys(result)).toHaveLength(19);
  });

  test('all returned projection values are 1 (MongoDB projection format)', () => {
    const result = BaseModel.getSelectFields(model.fields, false);
    Object.values(result).forEach((v) => expect(v).toBe(1));
  });

  test('projection includes _id', () => {
    const result = BaseModel.getSelectFields(model.fields, false);
    expect(result).toHaveProperty('_id', 1);
  });

  test('projection includes branch_id', () => {
    const result = BaseModel.getSelectFields(model.fields, false);
    expect(result).toHaveProperty('branch_id', 1);
  });

  test('projection includes view_item_id', () => {
    const result = BaseModel.getSelectFields(model.fields, false);
    expect(result).toHaveProperty('view_item_id', 1);
  });

  test('projection includes item_name', () => {
    const result = BaseModel.getSelectFields(model.fields, false);
    expect(result).toHaveProperty('item_name', 1);
  });

  test('projection includes process', () => {
    const result = BaseModel.getSelectFields(model.fields, false);
    expect(result).toHaveProperty('process', 1);
  });

  test('projection includes action', () => {
    const result = BaseModel.getSelectFields(model.fields, false);
    expect(result).toHaveProperty('action', 1);
  });

  test('projection includes opening_balance', () => {
    const result = BaseModel.getSelectFields(model.fields, false);
    expect(result).toHaveProperty('opening_balance', 1);
  });

  test('projection includes closing_balance', () => {
    const result = BaseModel.getSelectFields(model.fields, false);
    expect(result).toHaveProperty('closing_balance', 1);
  });

  test('projection includes count', () => {
    const result = BaseModel.getSelectFields(model.fields, false);
    expect(result).toHaveProperty('count', 1);
  });

  test('projection includes changed_by', () => {
    const result = BaseModel.getSelectFields(model.fields, false);
    expect(result).toHaveProperty('changed_by', 1);
  });

  test('projection includes stocklog', () => {
    const result = BaseModel.getSelectFields(model.fields, false);
    expect(result).toHaveProperty('stocklog', 1);
  });

  test('projection excludes license (select:false — multi-tenant field hidden)', () => {
    const result = BaseModel.getSelectFields(model.fields, false);
    expect(result).not.toHaveProperty('license');
  });

  test('showAll=true returns entire fields object', () => {
    const result = BaseModel.getSelectFields(model.fields, true);
    expect(result).toBe(model.fields);
  });

  test('instance getSelectFields returns same result as static call', () => {
    const staticResult = BaseModel.getSelectFields(model.fields, false);
    const instanceResult = model.getSelectFields(model.fields, false);
    expect(instanceResult).toEqual(staticResult);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. assignFilterObjects integration with StockLogModel.fields types
// ══════════════════════════════════════════════════════════════════════════════
describe('StockLogModel — assignFilterObjects with stock log field types', () => {
  let model;
  beforeEach(() => {
    model = new StockLogModel();
  });

  test('converts branch_id filter string to ObjectId (field type is ObjectId)', () => {
    const filters = { branch_id: 'abc123def456' };
    const result = model.assignFilterObjects(filters, model.fields);
    expect(result.branch_id).toBeInstanceOf(ObjectId);
  });

  test('converts view_item_id filter string to ObjectId (item reference coercion)', () => {
    const filters = { view_item_id: 'abc123def456' };
    const result = model.assignFilterObjects(filters, model.fields);
    expect(result.view_item_id).toBeInstanceOf(ObjectId);
  });

  test('converts changed_by_userid filter string to ObjectId (user reference coercion)', () => {
    const filters = { changed_by_userid: 'abc123def456' };
    const result = model.assignFilterObjects(filters, model.fields);
    expect(result.changed_by_userid).toBeInstanceOf(ObjectId);
  });

  test('converts license filter string to ObjectId (multi-tenant coercion)', () => {
    const filters = { license: 'abc123def456' };
    const result = model.assignFilterObjects(filters, model.fields);
    expect(result.license).toBeInstanceOf(ObjectId);
  });

  test('converts date filter string to Date (field type is Date)', () => {
    const filters = { date: '2024-01-15' };
    const result = model.assignFilterObjects(filters, model.fields);
    expect(result.date).toBeInstanceOf(Date);
  });

  test('converts created_date filter string to Date', () => {
    const filters = { created_date: '2024-06-01' };
    const result = model.assignFilterObjects(filters, model.fields);
    expect(result.created_date).toBeInstanceOf(Date);
  });

  test('converts updated_date filter string to Date', () => {
    const filters = { updated_date: '2024-12-31' };
    const result = model.assignFilterObjects(filters, model.fields);
    expect(result.updated_date).toBeInstanceOf(Date);
  });

  test('leaves item_name filter unchanged (field type is String)', () => {
    const filters = { item_name: 'Laptop 16GB' };
    const result = model.assignFilterObjects(filters, model.fields);
    expect(result.item_name).toBe('Laptop 16GB');
  });

  test('leaves process filter unchanged (movement type is String)', () => {
    const filters = { process: 'Sale' };
    const result = model.assignFilterObjects(filters, model.fields);
    expect(result.process).toBe('Sale');
  });

  test('leaves action filter unchanged (direction is String)', () => {
    const filters = { action: 'decrease' };
    const result = model.assignFilterObjects(filters, model.fields);
    expect(result.action).toBe('decrease');
  });

  test('leaves opening_balance filter unchanged (String field)', () => {
    const filters = { opening_balance: '100' };
    const result = model.assignFilterObjects(filters, model.fields);
    expect(result.opening_balance).toBe('100');
  });

  test('leaves closing_balance filter unchanged (String field)', () => {
    const filters = { closing_balance: '90' };
    const result = model.assignFilterObjects(filters, model.fields);
    expect(result.closing_balance).toBe('90');
  });

  test('leaves changed_by filter unchanged (user name is String)', () => {
    const filters = { changed_by: 'admin' };
    const result = model.assignFilterObjects(filters, model.fields);
    expect(result.changed_by).toBe('admin');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. getCollection — uses "stocklogs" as default collection name
// ══════════════════════════════════════════════════════════════════════════════
describe('StockLogModel — getCollection uses "stocklogs"', () => {
  let model;
  beforeEach(() => {
    model = new StockLogModel();
  });

  test('getCollection() calls db.collection with "stocklogs"', async () => {
    await model.getCollection();
    expect(_mockDb.collection).toHaveBeenCalledWith('stocklogs');
  });

  test('getCollection() returns the mock collection', async () => {
    const col = await model.getCollection();
    expect(col).toBe(_mockCollection);
  });

  test('getCollection("stocklogs") also works with explicit name', async () => {
    await model.getCollection('stocklogs');
    expect(_mockDb.collection).toHaveBeenCalledWith('stocklogs');
  });

  test('getCollection("items") allows accessing other collections cross-reference', async () => {
    await model.getCollection('items');
    expect(_mockDb.collection).toHaveBeenCalledWith('items');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. Inheritance — key BaseModel methods accessible on StockLogModel instance
// ══════════════════════════════════════════════════════════════════════════════
describe('StockLogModel — inherited BaseModel methods available', () => {
  let model;
  beforeEach(() => {
    model = new StockLogModel();
  });

  test('toObjectId is available on instance', () => {
    expect(typeof model.toObjectId).toBe('function');
  });

  test('toObjectId returns null for null input', () => {
    expect(model.toObjectId(null)).toBeNull();
  });

  test('toObjectId returns null for undefined input', () => {
    expect(model.toObjectId(undefined)).toBeNull();
  });

  test('toObjectId returns null for empty string', () => {
    expect(model.toObjectId('')).toBeNull();
  });

  test('toObjectId converts valid string to ObjectId', () => {
    const result = model.toObjectId('abc123def456abc1');
    expect(result).toBeInstanceOf(ObjectId);
  });

  test('findOne is available on instance', () => {
    expect(typeof model.findOne).toBe('function');
  });

  test('find is available on instance', () => {
    expect(typeof model.find).toBe('function');
  });

  test('insertOne is available on instance', () => {
    expect(typeof model.insertOne).toBe('function');
  });

  test('updateOne is available on instance', () => {
    expect(typeof model.updateOne).toBe('function');
  });

  test('deleteOne is available on instance', () => {
    expect(typeof model.deleteOne).toBe('function');
  });

  test('countDocuments is available on instance', () => {
    expect(typeof model.countDocuments).toBe('function');
  });

  test('aggregate is available on instance', () => {
    expect(typeof model.aggregate).toBe('function');
  });

  test('page is available on instance', () => {
    expect(typeof model.page).toBe('function');
  });

  test('getOneRow is available on instance', () => {
    expect(typeof model.getOneRow).toBe('function');
  });

  test('changeLog is available on instance', () => {
    expect(typeof model.changeLog).toBe('function');
  });

  test('checkPlan is available on instance', () => {
    expect(typeof model.checkPlan).toBe('function');
  });

  test('setCollectionName / getCollectionName round-trip', () => {
    model.setCollectionName('stocklogs_override');
    expect(model.getCollectionName()).toBe('stocklogs_override');
  });

  test('startingDate instance method is available', () => {
    expect(typeof model.startingDate).toBe('function');
  });

  test('endingDate instance method is available', () => {
    expect(typeof model.endingDate).toBe('function');
  });

  test('assignFilterObjects instance method is available', () => {
    expect(typeof model.assignFilterObjects).toBe('function');
  });

  test('deletedDocumentBackup instance method is available', () => {
    expect(typeof model.deletedDocumentBackup).toBe('function');
  });

  test('getSelectFields static method is available on class', () => {
    expect(typeof BaseModel.getSelectFields).toBe('function');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 13. Multiple instances are independent (no shared instance state)
// ══════════════════════════════════════════════════════════════════════════════
describe('StockLogModel — instance independence', () => {
  test('two instances share the static fields object (static property)', () => {
    const m1 = new StockLogModel();
    const m2 = new StockLogModel();
    expect(m1.fields).toBe(m2.fields);
  });

  test('mutating static fields on one instance affects the other (shared reference)', () => {
    const m1 = new StockLogModel();
    const m2 = new StockLogModel();
    m1.fields._testOnly = { type: 'String', select: true };
    expect(m2.fields).toHaveProperty('_testOnly');
    // cleanup
    delete m1.fields._testOnly;
  });

  test('setCollectionName on one instance does not affect another', () => {
    const m1 = new StockLogModel();
    const m2 = new StockLogModel();
    m1.setCollectionName('renamed_stocklogs');
    expect(m2.getCollectionName()).toBe('stocklogs');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 14. Domain semantics — stock audit field roles
// ══════════════════════════════════════════════════════════════════════════════
describe('StockLogModel — domain semantics (stock audit field roles)', () => {
  let fields;
  beforeEach(() => {
    fields = new StockLogModel().fields;
  });

  test('opening_balance represents quantity before movement and is a String field', () => {
    expect(fields.opening_balance.type).toBe('String');
    expect(fields.opening_balance.select).toBe(true);
  });

  test('closing_balance represents quantity after movement and is a String field', () => {
    expect(fields.closing_balance.type).toBe('String');
    expect(fields.closing_balance.select).toBe(true);
  });

  test('count represents quantity changed and is a String field', () => {
    expect(fields.count.type).toBe('String');
    expect(fields.count.select).toBe(true);
  });

  test('process is the source module/movement type field (String)', () => {
    expect(fields.process.type).toBe('String');
    expect(fields.process.select).toBe(true);
  });

  test('action is the movement direction field (String)', () => {
    expect(fields.action.type).toBe('String');
    expect(fields.action.select).toBe(true);
  });

  test('reference is the source document ID/reference field (String)', () => {
    expect(fields.reference.type).toBe('String');
    expect(fields.reference.select).toBe(true);
  });

  test('view_item_id is the item/product reference (ObjectId)', () => {
    expect(fields.view_item_id.type).toBe('ObjectId');
    expect(fields.view_item_id.select).toBe(true);
  });

  test('item_barcode_id is the item barcode reference (String)', () => {
    expect(fields.item_barcode_id.type).toBe('String');
    expect(fields.item_barcode_id.select).toBe(true);
  });

  test('item_quantity is the item quantity label (String)', () => {
    expect(fields.item_quantity.type).toBe('String');
    expect(fields.item_quantity.select).toBe(true);
  });

  test('changed_by_userid is the user ObjectId who triggered the stock movement', () => {
    expect(fields.changed_by_userid.type).toBe('ObjectId');
    expect(fields.changed_by_userid.select).toBe(true);
  });

  test('changed_by is the user name string who triggered the stock movement', () => {
    expect(fields.changed_by.type).toBe('String');
    expect(fields.changed_by.select).toBe(true);
  });

  test('stocklog is a Boolean audit flag', () => {
    expect(fields.stocklog.type).toBe('Boolean');
    expect(fields.stocklog.select).toBe(true);
  });

  test('branch_id is the branch/tenant isolation field (ObjectId)', () => {
    expect(fields.branch_id.type).toBe('ObjectId');
    expect(fields.branch_id.select).toBe(true);
  });

  test('license is the license/tenant isolation field, hidden from default projection', () => {
    expect(fields.license.type).toBe('ObjectId');
    expect(fields.license.select).toBe(false);
  });

  test('created_date and updated_date are audit timestamp Date fields', () => {
    expect(fields.created_date.type).toBe('Date');
    expect(fields.updated_date.type).toBe('Date');
  });
});
