'use strict';

/**
 * Unit tests for src/models/register.model.js
 *
 * File confirmed : src/models/register.model.js (31 lines)
 * Similar files  : none (only one register model in project)
 * Similar names  : None — no register.schema.js, cash-register.model.js,
 *                  register-log.model.js, registers.model.js, or register.model.ts
 *
 * Type           : Native-driver data-access class (NOT a Mongoose model)
 *                  extends BaseModel (src/models/base.model.js)
 *
 * Collection     : "cashregister" (MongoDB collection name)
 *
 * ORM / Driver   : MongoDB native driver via BaseModel
 *
 * RegisterModel adds:
 *   1. constructor — sets collectionName = "cashregister"
 *   2. this.fields  — 18-field legacy schema description used by:
 *                     - BaseModel.getSelectFields()  → MongoDB projection objects
 *                     - RegisterRepository.assignFilterObjects() → filter type coercion
 *
 * All database operations (CRUD, pagination, aggregation, changeLog, etc.)
 * are inherited from BaseModel and are already exhaustively tested in
 * tests/unit/models/base.model.test.js.
 * This file tests ONLY what is unique to RegisterModel.
 *
 * Related files (tested separately):
 *   src/services/register.service.js
 *   src/repositories/register.repository.js
 *   src/constants/registers.constants.js
 *
 * REGISTER_STATUS constants (from registers.constants.js):
 *   OPENED = "Opened"
 *   CLOSED = "Closed"
 *
 * Strategy: Follow base.model.test.js mock pattern exactly.
 *   - Mock 'mongodb' to prevent real DB connections
 *   - Mock 'dotenv' to prevent .env loading
 *   - Mock '../utils/helpers' for formatDate
 */

// ─── Mocks (must be declared before requires) ────────────────────────────────

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
const RegisterModel = require('../../../src/models/register.model');

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
describe('RegisterModel — class identity', () => {
  test('RegisterModel is a class (typeof function)', () => {
    expect(typeof RegisterModel).toBe('function');
  });

  test('new RegisterModel() creates an instance of RegisterModel', () => {
    const m = new RegisterModel();
    expect(m).toBeInstanceOf(RegisterModel);
  });

  test('new RegisterModel() is also an instance of BaseModel (extends BaseModel)', () => {
    const m = new RegisterModel();
    expect(m).toBeInstanceOf(BaseModel);
  });

  test('does not call initializeDB when mongoClient is already set', () => {
    const spy = jest.spyOn(BaseModel.prototype, 'initializeDB');
    new RegisterModel();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('collectionName is set to "cashregister"', () => {
    const m = new RegisterModel();
    expect(m.collectionName).toBe('cashregister');
  });

  test('getCollectionName() returns "cashregister"', () => {
    const m = new RegisterModel();
    expect(m.getCollectionName()).toBe('cashregister');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. fields — schema definition completeness
// ══════════════════════════════════════════════════════════════════════════════
describe('RegisterModel — fields schema definition', () => {
  let model;
  beforeEach(() => {
    model = new RegisterModel();
  });

  test('fields property is defined on instance', () => {
    expect(model.fields).toBeDefined();
    expect(typeof model.fields).toBe('object');
    expect(model.fields).not.toBeNull();
  });

  test('fields has exactly 18 entries', () => {
    expect(Object.keys(model.fields)).toHaveLength(18);
  });

  test('all expected field names are present', () => {
    const expectedFields = [
      '_id',
      'branch_id',
      'branch_name',
      'register_name',
      'register_id',
      'register_status',
      'payment_note',
      'date',
      'opening_float',
      'register_opendate',
      'register_closedate',
      'current_user',
      'current_user_id',
      'license',
      'register_sales',
      'cashInOutDetail',
      'cashDenomDetail',
      'countedAmount',
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
describe('RegisterModel — ObjectId typed fields', () => {
  let fields;
  beforeEach(() => {
    fields = new RegisterModel().fields;
  });

  test('_id has type "ObjectId"', () => {
    expect(fields._id.type).toBe('ObjectId');
  });

  test('_id has name:"id" alias (for PHP-compatible serialization)', () => {
    expect(fields._id.name).toBe('id');
  });

  test('branch_id has type "ObjectId"', () => {
    expect(fields.branch_id.type).toBe('ObjectId');
  });

  test('register_id has type "ObjectId"', () => {
    expect(fields.register_id.type).toBe('ObjectId');
  });

  test('current_user_id has type "ObjectId"', () => {
    expect(fields.current_user_id.type).toBe('ObjectId');
  });

  test('license has type "ObjectId"', () => {
    expect(fields.license.type).toBe('ObjectId');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. fields — String typed fields
// ══════════════════════════════════════════════════════════════════════════════
describe('RegisterModel — String typed fields', () => {
  let fields;
  beforeEach(() => {
    fields = new RegisterModel().fields;
  });

  test('branch_name has type "String"', () => {
    expect(fields.branch_name.type).toBe('String');
  });

  test('register_name has type "String"', () => {
    expect(fields.register_name.type).toBe('String');
  });

  test('register_status has type "String"', () => {
    expect(fields.register_status.type).toBe('String');
  });

  test('payment_note has type "String"', () => {
    expect(fields.payment_note.type).toBe('String');
  });

  test('current_user has type "String"', () => {
    expect(fields.current_user.type).toBe('String');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. fields — Date typed fields
// ══════════════════════════════════════════════════════════════════════════════
describe('RegisterModel — Date typed fields', () => {
  let fields;
  beforeEach(() => {
    fields = new RegisterModel().fields;
  });

  test('date has type "Date"', () => {
    expect(fields.date.type).toBe('Date');
  });

  test('register_opendate has type "Date"', () => {
    expect(fields.register_opendate.type).toBe('Date');
  });

  test('register_closedate has type "Date"', () => {
    expect(fields.register_closedate.type).toBe('Date');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 6. fields — Double and Array typed fields
// ══════════════════════════════════════════════════════════════════════════════
describe('RegisterModel — Double and Array typed fields', () => {
  let fields;
  beforeEach(() => {
    fields = new RegisterModel().fields;
  });

  test('opening_float has type "Double"', () => {
    expect(fields.opening_float.type).toBe('Double');
  });

  test('register_sales has type "Array"', () => {
    expect(fields.register_sales.type).toBe('Array');
  });

  test('cashInOutDetail has type "Array"', () => {
    expect(fields.cashInOutDetail.type).toBe('Array');
  });

  test('cashDenomDetail has type "Array"', () => {
    expect(fields.cashDenomDetail.type).toBe('Array');
  });

  test('countedAmount has type "Array"', () => {
    expect(fields.countedAmount.type).toBe('Array');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 7. fields — select values (controls MongoDB projection)
// ══════════════════════════════════════════════════════════════════════════════
describe('RegisterModel — fields select:true', () => {
  let fields;
  beforeEach(() => {
    fields = new RegisterModel().fields;
  });

  const selectTrueFields = [
    '_id',
    'branch_name',
    'register_name',
    'register_id',
    'register_status',
    'payment_note',
    'opening_float',
    'register_opendate',
    'register_closedate',
    'current_user',
    'register_sales',
    'cashInOutDetail',
    'cashDenomDetail',
    'countedAmount',
  ];

  test('exactly 14 fields have select:true', () => {
    const count = Object.values(fields).filter((f) => f.select === true).length;
    expect(count).toBe(14);
  });

  selectTrueFields.forEach((fieldName) => {
    test(`${fieldName} has select:true`, () => {
      expect(fields[fieldName].select).toBe(true);
    });
  });
});

describe('RegisterModel — fields select:false (excluded from default projection)', () => {
  let fields;
  beforeEach(() => {
    fields = new RegisterModel().fields;
  });

  const selectFalseFields = ['branch_id', 'date', 'current_user_id', 'license'];

  test('exactly 4 fields have select:false', () => {
    const count = Object.values(fields).filter((f) => f.select === false).length;
    expect(count).toBe(4);
  });

  selectFalseFields.forEach((fieldName) => {
    test(`${fieldName} has select:false (hidden from default fetch)`, () => {
      expect(fields[fieldName].select).toBe(false);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 8. getSelectFields integration with RegisterModel.fields
// ══════════════════════════════════════════════════════════════════════════════
describe('RegisterModel — getSelectFields integration', () => {
  let model;
  beforeEach(() => {
    model = new RegisterModel();
  });

  test('static getSelectFields returns 14-field projection when showAll=false', () => {
    const result = BaseModel.getSelectFields(model.fields, false);
    expect(Object.keys(result)).toHaveLength(14);
  });

  test('all returned projection values are 1 (MongoDB projection format)', () => {
    const result = BaseModel.getSelectFields(model.fields, false);
    Object.values(result).forEach((v) => expect(v).toBe(1));
  });

  test('projection includes _id', () => {
    const result = BaseModel.getSelectFields(model.fields, false);
    expect(result).toHaveProperty('_id', 1);
  });

  test('projection includes register_name', () => {
    const result = BaseModel.getSelectFields(model.fields, false);
    expect(result).toHaveProperty('register_name', 1);
  });

  test('projection includes register_status', () => {
    const result = BaseModel.getSelectFields(model.fields, false);
    expect(result).toHaveProperty('register_status', 1);
  });

  test('projection includes opening_float', () => {
    const result = BaseModel.getSelectFields(model.fields, false);
    expect(result).toHaveProperty('opening_float', 1);
  });

  test('projection includes register_opendate', () => {
    const result = BaseModel.getSelectFields(model.fields, false);
    expect(result).toHaveProperty('register_opendate', 1);
  });

  test('projection includes register_closedate', () => {
    const result = BaseModel.getSelectFields(model.fields, false);
    expect(result).toHaveProperty('register_closedate', 1);
  });

  test('projection excludes branch_id (select:false)', () => {
    const result = BaseModel.getSelectFields(model.fields, false);
    expect(result).not.toHaveProperty('branch_id');
  });

  test('projection excludes date (select:false)', () => {
    const result = BaseModel.getSelectFields(model.fields, false);
    expect(result).not.toHaveProperty('date');
  });

  test('projection excludes current_user_id (select:false)', () => {
    const result = BaseModel.getSelectFields(model.fields, false);
    expect(result).not.toHaveProperty('current_user_id');
  });

  test('projection excludes license (select:false)', () => {
    const result = BaseModel.getSelectFields(model.fields, false);
    expect(result).not.toHaveProperty('license');
  });

  test('showAll=true returns entire fields object', () => {
    const result = BaseModel.getSelectFields(model.fields, true);
    expect(result).toBe(model.fields);
  });

  test('instance getSelectFields returns same result as static', () => {
    const staticResult = BaseModel.getSelectFields(model.fields, false);
    const instanceResult = model.getSelectFields(model.fields, false);
    expect(instanceResult).toEqual(staticResult);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 9. assignFilterObjects integration with RegisterModel.fields types
// ══════════════════════════════════════════════════════════════════════════════
describe('RegisterModel — assignFilterObjects with register field types', () => {
  let model;
  beforeEach(() => {
    model = new RegisterModel();
  });

  test('converts branch_id filter string to ObjectId (field type is ObjectId)', () => {
    const filters = { branch_id: 'abc123def456' };
    const result = model.assignFilterObjects(filters, model.fields);
    expect(result.branch_id).toBeInstanceOf(ObjectId);
  });

  test('converts register_id filter string to ObjectId (field type is ObjectId)', () => {
    const filters = { register_id: 'abc123def456' };
    const result = model.assignFilterObjects(filters, model.fields);
    expect(result.register_id).toBeInstanceOf(ObjectId);
  });

  test('converts current_user_id filter string to ObjectId', () => {
    const filters = { current_user_id: 'abc123def456' };
    const result = model.assignFilterObjects(filters, model.fields);
    expect(result.current_user_id).toBeInstanceOf(ObjectId);
  });

  test('converts license filter string to ObjectId', () => {
    const filters = { license: 'abc123def456' };
    const result = model.assignFilterObjects(filters, model.fields);
    expect(result.license).toBeInstanceOf(ObjectId);
  });

  test('converts date filter string to Date (field type is Date)', () => {
    const filters = { date: '2024-01-15' };
    const result = model.assignFilterObjects(filters, model.fields);
    expect(result.date).toBeInstanceOf(Date);
  });

  test('converts register_opendate filter string to Date', () => {
    const filters = { register_opendate: '2024-01-15' };
    const result = model.assignFilterObjects(filters, model.fields);
    expect(result.register_opendate).toBeInstanceOf(Date);
  });

  test('converts register_closedate filter string to Date', () => {
    const filters = { register_closedate: '2024-12-31' };
    const result = model.assignFilterObjects(filters, model.fields);
    expect(result.register_closedate).toBeInstanceOf(Date);
  });

  test('leaves register_name filter unchanged (field type is String)', () => {
    const filters = { register_name: 'Main Register' };
    const result = model.assignFilterObjects(filters, model.fields);
    expect(result.register_name).toBe('Main Register');
  });

  test('leaves register_status filter unchanged (field type is String)', () => {
    const filters = { register_status: 'Opened' };
    const result = model.assignFilterObjects(filters, model.fields);
    expect(result.register_status).toBe('Opened');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 10. getCollection — uses "cashregister" as default collection name
// ══════════════════════════════════════════════════════════════════════════════
describe('RegisterModel — getCollection uses "cashregister"', () => {
  let model;
  beforeEach(() => {
    model = new RegisterModel();
  });

  test('getCollection() calls db.collection with "cashregister"', async () => {
    await model.getCollection();
    expect(_mockDb.collection).toHaveBeenCalledWith('cashregister');
  });

  test('getCollection() returns the mock collection', async () => {
    const col = await model.getCollection();
    expect(col).toBe(_mockCollection);
  });

  test('getCollection("cashregister") also works with explicit name', async () => {
    await model.getCollection('cashregister');
    expect(_mockDb.collection).toHaveBeenCalledWith('cashregister');
  });

  test('getCollection("denomination") allows accessing other collections', async () => {
    await model.getCollection('denomination');
    expect(_mockDb.collection).toHaveBeenCalledWith('denomination');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 11. Inheritance — key BaseModel methods accessible on RegisterModel instance
// ══════════════════════════════════════════════════════════════════════════════
describe('RegisterModel — inherited BaseModel methods available', () => {
  let model;
  beforeEach(() => {
    model = new RegisterModel();
  });

  test('toObjectId is available on instance', () => {
    expect(typeof model.toObjectId).toBe('function');
  });

  test('toObjectId returns null for falsy input', () => {
    expect(model.toObjectId(null)).toBeNull();
    expect(model.toObjectId(undefined)).toBeNull();
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
    model.setCollectionName('registers_override');
    expect(model.getCollectionName()).toBe('registers_override');
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
});

// ══════════════════════════════════════════════════════════════════════════════
// 12. Multiple instances are independent (no shared instance state)
// ══════════════════════════════════════════════════════════════════════════════
describe('RegisterModel — instance independence', () => {
  test('two instances have separate fields objects', () => {
    const m1 = new RegisterModel();
    const m2 = new RegisterModel();
    expect(m1.fields).not.toBe(m2.fields);
  });

  test('mutating one instance fields does not affect another', () => {
    const m1 = new RegisterModel();
    const m2 = new RegisterModel();
    m1.fields.custom_field = { type: 'String', select: true };
    expect(m2.fields).not.toHaveProperty('custom_field');
  });

  test('setCollectionName on one instance does not affect another', () => {
    const m1 = new RegisterModel();
    const m2 = new RegisterModel();
    m1.setCollectionName('renamed');
    expect(m2.getCollectionName()).toBe('cashregister');
  });
});
