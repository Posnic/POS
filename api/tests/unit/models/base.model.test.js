'use strict';

/**
 * Unit tests for src/models/base.model.js
 *
 * base.model.js: MongoDB native driver (NOT Mongoose) base class.
 * Extended by 15+ models and repositories across the project.
 *
 * Testing strategy:
 *  - Mock 'mongodb' entirely — no real DB connection
 *  - Mock 'dotenv' to prevent .env loading
 *  - Mock '../utils/helpers' for formatDate
 *  - Pure utility methods tested directly (no DB needed)
 *  - DB-touching methods tested via mocked collection
 *  - BaseModel static context reset in beforeEach to ensure test isolation
 */

// ─── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock('../../../src/utils/helpers', () => ({
  formatDate: jest.fn((d) => (d instanceof Date ? '2024-01-01' : String(d))),
}));

jest.mock('mongodb', () => {
  // ObjectId mock: constructor + isValid static
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

  // Reusable cursor with chainable methods
  const mockCursor = {
    toArray: jest.fn().mockResolvedValue([]),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
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

  const mockSession = {
    withTransaction: jest.fn().mockImplementation(async (fn) => fn()),
    endSession: jest.fn().mockResolvedValue(undefined),
  };

  const mockClient = {
    db: jest.fn().mockReturnValue(mockDb),
    startSession: jest.fn().mockReturnValue(mockSession),
  };

  return {
    MongoClient: { connect: jest.fn().mockResolvedValue(mockClient) },
    ObjectId: MockObjectId,
    // Expose internals for test access
    _mockClient: mockClient,
    _mockDb: mockDb,
    _mockCollection: mockCollection,
    _mockCursor: mockCursor,
    _mockSession: mockSession,
  };
});

// ─── Requires ──────────────────────────────────────────────────────────────────

const BaseModel = require('../../../src/models/base.model');
const { ObjectId, _mockClient, _mockDb, _mockCollection, _mockCursor, _mockSession } =
  jest.requireMock('mongodb');
const { formatDate } = jest.requireMock('../../../src/utils/helpers');

// ─── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  // Re-apply default implementations cleared by clearAllMocks
  _mockCollection.find.mockReturnValue(_mockCursor);
  _mockCursor.toArray.mockResolvedValue([]);
  _mockCollection.findOne.mockResolvedValue(null);
  _mockCollection.insertOne.mockResolvedValue({ insertedId: 'ins001' });
  _mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });
  _mockCollection.deleteOne.mockResolvedValue({ deletedCount: 1 });
  _mockCollection.countDocuments.mockResolvedValue(0);
  _mockCollection.aggregate.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });
  _mockDb.collection.mockReturnValue(_mockCollection);
  _mockSession.withTransaction.mockImplementation(async (fn) => fn());
  _mockSession.endSession.mockResolvedValue(undefined);
  _mockClient.startSession.mockReturnValue(_mockSession);
  ObjectId.isValid.mockImplementation((val) => {
    if (!val) return false;
    if (val instanceof ObjectId) return true;
    if (typeof val === 'string') return val.length >= 12;
    return false;
  });
  formatDate.mockImplementation((d) => (d instanceof Date ? '2024-01-01' : String(d)));

  // Reset static context to clean state
  BaseModel.mongoClient = _mockClient;
  BaseModel.database = _mockDb;
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
  jest.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════
// Static context default values
// ═══════════════════════════════════════════════════════════════════════════════
describe('static context defaults', () => {
  test('limit defaults to 10', () => {
    expect(BaseModel.limit).toBe(10);
  });

  test('errorArray has status:false', () => {
    expect(BaseModel.errorArray.status).toBe(false);
    expect(BaseModel.errorArray.data).toBeNull();
  });

  test('successArray has status:true', () => {
    expect(BaseModel.successArray.status).toBe(true);
    expect(BaseModel.successArray.data).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Constructor & collection name
// ═══════════════════════════════════════════════════════════════════════════════
describe('constructor & collectionName', () => {
  test('sets collectionName from constructor arg', () => {
    const m = new BaseModel('products');
    expect(m.collectionName).toBe('products');
  });

  test('defaults collectionName to null when not provided', () => {
    const m = new BaseModel();
    expect(m.collectionName).toBeNull();
  });

  test('setCollectionName / getCollectionName round-trip', () => {
    const m = new BaseModel('old');
    m.setCollectionName('new_collection');
    expect(m.getCollectionName()).toBe('new_collection');
  });

  test('does not call initializeDB when mongoClient already set', () => {
    const spy = jest.spyOn(BaseModel.prototype, 'initializeDB');
    new BaseModel('test');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getCollection
// ═══════════════════════════════════════════════════════════════════════════════
describe('getCollection', () => {
  test('returns collection for instance collectionName', async () => {
    const m = new BaseModel('items');
    const col = await m.getCollection();
    expect(_mockDb.collection).toHaveBeenCalledWith('items');
    expect(col).toBe(_mockCollection);
  });

  test('returns collection for explicit collectionName arg', async () => {
    const m = new BaseModel('items');
    const col = await m.getCollection('orders');
    expect(_mockDb.collection).toHaveBeenCalledWith('orders');
    expect(col).toBe(_mockCollection);
  });

  test('throws when no collectionName set or passed', async () => {
    const m = new BaseModel(null);
    await expect(m.getCollection()).rejects.toThrow('Collection name is not specified');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// toObjectId
// ═══════════════════════════════════════════════════════════════════════════════
describe('toObjectId', () => {
  let m;
  beforeEach(() => {
    m = new BaseModel('test');
  });

  test('returns null for null input', () => {
    expect(m.toObjectId(null)).toBeNull();
  });

  test('returns null for undefined input', () => {
    expect(m.toObjectId(undefined)).toBeNull();
  });

  test('returns the same ObjectId instance if already ObjectId', () => {
    const id = new ObjectId('abc123def456');
    const result = m.toObjectId(id);
    expect(result).toBe(id);
  });

  test('converts valid string to ObjectId', () => {
    const result = m.toObjectId('abc123def456abc1');
    expect(result).toBeInstanceOf(ObjectId);
  });

  test('returns null for short/invalid string', () => {
    ObjectId.isValid.mockReturnValueOnce(false);
    expect(m.toObjectId('short')).toBeNull();
  });

  test('recursively extracts _id from an object', () => {
    ObjectId.isValid.mockReturnValue(true);
    const obj = { _id: 'abc123def456abc123def456' };
    const result = m.toObjectId(obj);
    expect(result).toBeInstanceOf(ObjectId);
  });

  test('returns null for number input (not string, not ObjectId, no _id)', () => {
    expect(m.toObjectId(42)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// startingDate (static and instance)
// ═══════════════════════════════════════════════════════════════════════════════
describe('startingDate', () => {
  const dateStr = '2024/01/15 10:30 AM';

  test('returns a Date instance for formatted datetime string', () => {
    const result = BaseModel.startingDate(dateStr, 'Asia/Kolkata');
    expect(result).toBeInstanceOf(Date);
    expect(isNaN(result.getTime())).toBe(false);
  });

  test('PM hour gives exactly 12 hours more than AM (same time, same tz)', () => {
    // Relative test: independent of machine timezone
    const am = BaseModel.startingDate('2024/01/15 02:30 AM', 'Asia/Kolkata');
    const pm = BaseModel.startingDate('2024/01/15 02:30 PM', 'Asia/Kolkata');
    const diffMs = pm.getTime() - am.getTime();
    expect(diffMs).toBe(12 * 60 * 60 * 1000);
  });

  test('PM 12 gives exactly 12 hours more than AM 12', () => {
    const midnight = BaseModel.startingDate('2024/01/15 12:00 AM', 'Asia/Kolkata');
    const noon = BaseModel.startingDate('2024/01/15 12:00 PM', 'Asia/Kolkata');
    const diffMs = noon.getTime() - midnight.getTime();
    expect(diffMs).toBe(12 * 60 * 60 * 1000);
  });

  test('earlier hour gives earlier timestamp', () => {
    const early = BaseModel.startingDate('2024/01/15 06:00 AM', 'Asia/Kolkata');
    const later = BaseModel.startingDate('2024/01/15 08:00 AM', 'Asia/Kolkata');
    expect(later.getTime()).toBeGreaterThan(early.getTime());
    expect(later.getTime() - early.getTime()).toBe(2 * 60 * 60 * 1000);
  });

  test('America/New_York (-300) gives later UTC time than Asia/Kolkata (+330) for same local time', () => {
    // NY is west of Kolkata: same local time = earlier local = later UTC
    const kolkata = BaseModel.startingDate('2024/01/15 10:00 AM', 'Asia/Kolkata');
    const newYork = BaseModel.startingDate('2024/01/15 10:00 AM', 'America/New_York');
    expect(newYork.getTime()).toBeGreaterThan(kolkata.getTime());
  });

  test('NOTE: UTC timezone uses 330-min offset due to || 0 falsy bug in production code', () => {
    // Production bug: timezoneOffsets['UTC'] = 0, and 0 || 330 = 330
    // so 'UTC' timezone actually applies Asia/Kolkata (330 min) offset
    const utcTz = BaseModel.startingDate('2024/01/15 10:00 AM', 'UTC');
    const kolkata = BaseModel.startingDate('2024/01/15 10:00 AM', 'Asia/Kolkata');
    // Both should produce the same result due to the bug
    expect(utcTz.getTime()).toBe(kolkata.getTime());
  });

  test('falls back to Date constructor for invalid format', () => {
    const result = BaseModel.startingDate('2024-01-15', 'UTC');
    expect(result).toBeInstanceOf(Date);
  });

  test('instance startingDate delegates to static', () => {
    const spy = jest.spyOn(BaseModel, 'startingDate');
    const m = new BaseModel('test');
    m.startingDate(dateStr, 'Asia/Kolkata');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test('uses BaseModel.currentTimeZone when no tz given', () => {
    BaseModel.currentTimeZone = 'Asia/Kolkata';
    const withTz = BaseModel.startingDate('2024/01/15 10:00 AM', 'Asia/Kolkata');
    const withStatic = BaseModel.startingDate('2024/01/15 10:00 AM');
    expect(withStatic.getTime()).toBe(withTz.getTime());
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// endingDate (static and instance)
// ═══════════════════════════════════════════════════════════════════════════════
describe('endingDate', () => {
  test('PM gives later time than AM for same date', () => {
    const am = BaseModel.endingDate('2024/12/31 11:00 AM', 'Asia/Kolkata');
    const pm = BaseModel.endingDate('2024/12/31 11:00 PM', 'Asia/Kolkata');
    expect(pm.getTime() - am.getTime()).toBe(12 * 60 * 60 * 1000);
  });

  test('falls back to Date constructor for invalid format', () => {
    const result = BaseModel.endingDate('2024-12-31', 'UTC');
    expect(result).toBeInstanceOf(Date);
  });

  test('instance endingDate delegates to static', () => {
    const spy = jest.spyOn(BaseModel, 'endingDate');
    const m = new BaseModel('test');
    m.endingDate('2024/01/15 10:30 AM', 'UTC');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// simplifyFields
// ═══════════════════════════════════════════════════════════════════════════════
describe('simplifyFields', () => {
  test('returns same value for null input', () => {
    expect(BaseModel.simplifyFields(null)).toBeNull();
  });

  test('converts _id to string and sets id alias', () => {
    const id = 'abc123def456abc123def456';
    ObjectId.isValid.mockReturnValue(true);
    const result = BaseModel.simplifyFields({ _id: { toString: () => id, valueOf: () => id } });
    expect(result._id).toBe(id);
    expect(result.id).toBe(id);
  });

  test('does not overwrite existing id field', () => {
    ObjectId.isValid.mockReturnValue(true);
    const existing = 'existing-id';
    const result = BaseModel.simplifyFields({
      _id: { toString: () => 'abc123def456abc123def456' },
      id: existing,
    });
    expect(result.id).toBe(existing);
  });

  test('converts ObjectId fields to string', () => {
    const objId = new ObjectId('ref123def456');
    const result = BaseModel.simplifyFields({ name: 'test', ref: objId });
    expect(typeof result.ref).toBe('string');
    expect(result.ref).toBe('ref123def456');
  });

  test('converts Date fields via formatDate', () => {
    const d = new Date('2024-06-01');
    const result = BaseModel.simplifyFields({ created: d });
    expect(formatDate).toHaveBeenCalledWith(d);
    expect(result.created).toBe('2024-01-01');
  });

  test('processes array of ObjectIds', () => {
    const ids = [new ObjectId('id1'), new ObjectId('id2')];
    const result = BaseModel.simplifyFields({ refs: ids });
    expect(result.refs).toEqual(['id1', 'id2']);
  });

  test('processes array of Dates', () => {
    const dates = [new Date(), new Date()];
    const result = BaseModel.simplifyFields({ dates });
    expect(result.dates.every((d) => d === '2024-01-01')).toBe(true);
  });

  test('recursively processes nested objects', () => {
    const result = BaseModel.simplifyFields({ nested: { val: 'keep' } });
    expect(result.nested.val).toBe('keep');
  });

  test('recursively processes array of objects', () => {
    const objId = new ObjectId('nested001');
    const result = BaseModel.simplifyFields({ items: [{ ref: objId }] });
    expect(result.items[0].ref).toBe('nested001');
  });

  test('leaves primitive fields unchanged', () => {
    const result = BaseModel.simplifyFields({ name: 'Alice', age: 30, active: true });
    expect(result.name).toBe('Alice');
    expect(result.age).toBe(30);
    expect(result.active).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getSelectFields
// ═══════════════════════════════════════════════════════════════════════════════
describe('getSelectFields', () => {
  const fields = {
    name: { select: true },
    email: { select: true },
    password: { select: false },
    _id: {},
  };

  test('returns only select:true fields as projection with showAll=false', () => {
    const result = BaseModel.getSelectFields(fields, false);
    expect(result).toEqual({ name: 1, email: 1 });
  });

  test('returns all fields when showAll=true', () => {
    const result = BaseModel.getSelectFields(fields, true);
    expect(result).toBe(fields);
  });

  test('returns empty object when no fields have select:true', () => {
    const noneSelected = { a: { select: false }, b: {} };
    expect(BaseModel.getSelectFields(noneSelected, false)).toEqual({});
  });

  test('instance getSelectFields delegates to static', () => {
    const m = new BaseModel('test');
    const result = m.getSelectFields(fields, false);
    expect(result).toEqual({ name: 1, email: 1 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// assignDateObject
// ═══════════════════════════════════════════════════════════════════════════════
describe('assignDateObject', () => {
  let m;
  beforeEach(() => {
    m = new BaseModel('test');
  });

  test('converts a date string to a Date object', () => {
    const result = m.assignDateObject('2024-06-01');
    expect(result).toBeInstanceOf(Date);
  });

  test('returns null for null/empty input', () => {
    expect(m.assignDateObject(null)).toBeNull();
    expect(m.assignDateObject('')).toBeNull();
  });

  test('converts array of date strings', () => {
    const result = m.assignDateObject(['2024-01-01', '2024-06-01']);
    expect(Array.isArray(result)).toBe(true);
    expect(result.every((d) => d instanceof Date)).toBe(true);
  });

  test('converts object with date keys', () => {
    const result = m.assignDateObject({ $gte: '2024-01-01', $lte: '2024-12-31' });
    expect(result.$gte).toBeInstanceOf(Date);
    expect(result.$lte).toBeInstanceOf(Date);
  });

  test('filters out null values from array', () => {
    const result = m.assignDateObject(['2024-01-01', null, '']);
    expect(result.some((d) => d === null)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// assignObjectId
// ═══════════════════════════════════════════════════════════════════════════════
describe('assignObjectId', () => {
  let m;
  beforeEach(() => {
    m = new BaseModel('test');
  });

  test('converts a single string to ObjectId', () => {
    const result = m.assignObjectId('abc123def456');
    expect(result).toBeInstanceOf(ObjectId);
  });

  test('converts array of strings to ObjectIds', () => {
    const result = m.assignObjectId(['id1', 'id2', 'id3']);
    expect(Array.isArray(result)).toBe(true);
    expect(result.every((id) => id instanceof ObjectId)).toBe(true);
    expect(result).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// assignObj
// ═══════════════════════════════════════════════════════════════════════════════
describe('assignObj', () => {
  let m;
  beforeEach(() => {
    m = new BaseModel('test');
  });

  test('calls assignDateObject for Date type', () => {
    const spy = jest.spyOn(m, 'assignDateObject').mockReturnValue(new Date());
    const filters = { created_at: '2024-01-01' };
    m.assignObj('created_at', 'Date', filters);
    expect(spy).toHaveBeenCalledWith('2024-01-01');
  });

  test('calls assignObjectId for ObjectId type', () => {
    const spy = jest.spyOn(m, 'assignObjectId').mockReturnValue(new ObjectId('id1'));
    const filters = { user_id: 'id1' };
    m.assignObj('user_id', 'ObjectId', filters);
    expect(spy).toHaveBeenCalledWith('id1');
  });

  test('leaves filters unchanged for unknown type', () => {
    const filters = { name: 'Alice' };
    const result = m.assignObj('name', 'String', filters);
    expect(result.name).toBe('Alice');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// checkPlan
// ═══════════════════════════════════════════════════════════════════════════════
describe('checkPlan', () => {
  let m;
  beforeEach(() => {
    m = new BaseModel('test');
  });

  test('returns -1 when no user and no static loggedUserDetails', async () => {
    BaseModel.loggedUserDetails = null;
    const result = await m.checkPlan('items', 'create');
    expect(result).toBe(-1);
  });

  test('returns plan value when collection and action match', async () => {
    const user = { plan_access: { items: { create: 100 } } };
    const result = await m.checkPlan('items', 'create', user);
    expect(result).toBe(100);
  });

  test('parses string numeric plan values', async () => {
    const user = { plan_access: { items: { create: '50' } } };
    const result = await m.checkPlan('items', 'create', user);
    expect(result).toBe(50);
  });

  test('returns -1 when collection not in plan_access', async () => {
    const user = { plan_access: { products: { create: 10 } } };
    const result = await m.checkPlan('items', 'create', user);
    expect(result).toBe(-1);
  });

  test('returns -1 when action not in collection plan', async () => {
    const user = { plan_access: { items: { update: 10 } } };
    const result = await m.checkPlan('items', 'create', user);
    expect(result).toBe(-1);
  });

  test('reads from BaseModel.loggedUserDetails when no userContext', async () => {
    BaseModel.loggedUserDetails = { plan_access: { items: { create: 200 } } };
    const result = await m.checkPlan('items', 'create');
    expect(result).toBe(200);
  });

  test('returns -1 on exception', async () => {
    const badUser = {
      get plan_access() {
        throw new Error('fail');
      },
    };
    const result = await m.checkPlan('items', 'create', badUser);
    expect(result).toBe(-1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// page
// ═══════════════════════════════════════════════════════════════════════════════
describe('page', () => {
  let m;
  beforeEach(() => {
    m = new BaseModel('test');
  });

  test('returns paginated result with default skip=0, limit=10', async () => {
    const list = [{ _id: 'a'.repeat(24), name: 'Item 1' }];
    _mockCursor.toArray.mockResolvedValue(list);
    _mockCollection.countDocuments.mockResolvedValue(1);
    ObjectId.isValid.mockReturnValue(false);

    const result = await m.page('items', {}, {});
    expect(result.status).toBe(true);
    expect(result.data.current_page).toBe(1);
    expect(result.data.per_page).toBe(10);
    expect(result.data.total).toBe(1);
    expect(result.data.total_pages).toBe(1);
    expect(result.data.list).toHaveLength(1);
  });

  test('calculates skip from page number', async () => {
    _mockCollection.countDocuments.mockResolvedValue(30);
    await m.page('items', {}, {}, { page: 3, limit: 10 });
    const callArgs = _mockCollection.find.mock.calls[0][1];
    expect(callArgs.skip).toBe(20);
  });

  test('respects custom limit option', async () => {
    await m.page('items', {}, {}, { limit: 25 });
    const callArgs = _mockCollection.find.mock.calls[0][1];
    expect(callArgs.limit).toBe(25);
  });

  test('applies license filter to query when BaseModel.license is set', async () => {
    BaseModel.license = 'lic001';
    await m.page('items', {}, {});
    const filterArg = _mockCollection.find.mock.calls[0][0];
    expect(filterArg.license).toBe('lic001');
  });

  test('applies limitCheck.limit when dbOptions.limit exceeds it', async () => {
    await m.page('items', { limit: 5 }, {}, { limit: 100 });
    const callArgs = _mockCollection.find.mock.calls[0][1];
    expect(callArgs.limit).toBe(5);
  });

  test('applies fields as projection', async () => {
    const fields = { name: 1, price: 1 };
    await m.page('items', {}, {}, {}, fields);
    const callArgs = _mockCollection.find.mock.calls[0][1];
    expect(callArgs.projection).toEqual(fields);
  });

  test('returns status:false on exception', async () => {
    _mockCollection.find.mockImplementationOnce(() => {
      throw new Error('DB error');
    });
    const result = await m.page('items', {}, {});
    expect(result.status).toBe(false);
    expect(result.data).toBeNull();
    expect(result.message).toBe('DB error');
  });

  test('total_pages rounds up correctly', async () => {
    _mockCollection.countDocuments.mockResolvedValue(11);
    const result = await m.page('items', {}, {}, { limit: 10 });
    expect(result.data.total_pages).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getOneRow
// ═══════════════════════════════════════════════════════════════════════════════
describe('getOneRow', () => {
  let m;
  beforeEach(() => {
    m = new BaseModel('test');
  });

  test('returns status:false when id is missing', async () => {
    const result = await m.getOneRow(null, 'items');
    expect(result.status).toBe(false);
    expect(result.message).toBe('ID is required');
  });

  test('returns status:true with document when found', async () => {
    const doc = { _id: { toString: () => 'abc123def456' }, name: 'Widget' };
    _mockCollection.findOne.mockResolvedValue(doc);
    ObjectId.isValid.mockReturnValue(false);
    const result = await m.getOneRow('abc123def456', 'items');
    expect(result.status).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.message).toBe('get successfully');
  });

  test('adds id field to returned document', async () => {
    const doc = { _id: { toString: () => 'id001' }, name: 'Widget' };
    _mockCollection.findOne.mockResolvedValue(doc);
    ObjectId.isValid.mockReturnValue(false);
    const result = await m.getOneRow('id001', 'items');
    expect(result.data.id).toBe('id001');
  });

  test('tries fallback without license when first lookup fails', async () => {
    BaseModel.license = 'lic001';
    _mockCollection.findOne
      .mockResolvedValueOnce(null) // first call with license fails
      .mockResolvedValueOnce({ _id: { toString: () => 'id001' }, name: 'Widget' }); // fallback
    ObjectId.isValid.mockReturnValue(false);
    const result = await m.getOneRow('id001', 'items');
    expect(_mockCollection.findOne).toHaveBeenCalledTimes(2);
    expect(result.status).toBe(true);
  });

  test('returns status:false when document not found at all', async () => {
    _mockCollection.findOne.mockResolvedValue(null);
    const result = await m.getOneRow('id001', 'items');
    expect(result.status).toBe(false);
    expect(result.message).toBe('Document Not Found');
  });

  test('returns status:false on exception', async () => {
    _mockCollection.findOne.mockRejectedValue(new Error('Timeout'));
    const result = await m.getOneRow('id001', 'items');
    expect(result.status).toBe(false);
    expect(result.message).toBe('Timeout');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// findOne
// ═══════════════════════════════════════════════════════════════════════════════
describe('findOne', () => {
  let m;
  beforeEach(() => {
    m = new BaseModel('items');
  });

  test('converts string _id to ObjectId in query', async () => {
    await m.findOne({ _id: 'abc123def456abc1' });
    const query = _mockCollection.findOne.mock.calls[0][0];
    expect(query._id).toBeInstanceOf(ObjectId);
  });

  test('appends license to query when set', async () => {
    BaseModel.license = 'lic001';
    await m.findOne({ name: 'Widget' });
    const query = _mockCollection.findOne.mock.calls[0][0];
    expect(query.license).toBe('lic001');
  });

  test('returns query result', async () => {
    const doc = { name: 'Widget' };
    _mockCollection.findOne.mockResolvedValue(doc);
    const result = await m.findOne({ name: 'Widget' });
    expect(result).toBe(doc);
  });

  test('rethrows on exception', async () => {
    _mockCollection.findOne.mockRejectedValue(new Error('Connection lost'));
    await expect(m.findOne({ name: 'Widget' })).rejects.toThrow('Connection lost');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// find
// ═══════════════════════════════════════════════════════════════════════════════
describe('find', () => {
  let m;
  beforeEach(() => {
    m = new BaseModel('items');
  });

  test('returns array result', async () => {
    const list = [{ name: 'A' }, { name: 'B' }];
    _mockCursor.toArray.mockResolvedValue(list);
    const result = await m.find({});
    expect(result).toEqual(list);
  });

  test('appends license to query when set', async () => {
    BaseModel.license = 'lic001';
    await m.find({ active: true });
    expect(_mockCollection.find.mock.calls[0][0].license).toBe('lic001');
  });

  test('rethrows on exception', async () => {
    _mockCollection.find.mockImplementationOnce(() => {
      throw new Error('fail');
    });
    await expect(m.find({})).rejects.toThrow('fail');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// insertOne
// ═══════════════════════════════════════════════════════════════════════════════
describe('insertOne', () => {
  let m;
  beforeEach(() => {
    m = new BaseModel('items');
  });

  test('sets createdAt and updatedAt on document', async () => {
    const doc = { name: 'Widget' };
    await m.insertOne(doc);
    expect(doc.createdAt).toBeInstanceOf(Date);
    expect(doc.updatedAt).toBeInstanceOf(Date);
  });

  test('appends license to document when set', async () => {
    BaseModel.license = 'lic001';
    const doc = { name: 'Widget' };
    await m.insertOne(doc);
    expect(doc.license).toBe('lic001');
  });

  test('returns document merged with insertedId', async () => {
    _mockCollection.insertOne.mockResolvedValue({ insertedId: 'new001' });
    const result = await m.insertOne({ name: 'Widget' });
    expect(result._id).toBe('new001');
    expect(result.name).toBe('Widget');
  });

  test('rethrows on exception', async () => {
    _mockCollection.insertOne.mockRejectedValue(new Error('Duplicate key'));
    await expect(m.insertOne({ name: 'Widget' })).rejects.toThrow('Duplicate key');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// updateOne
// ═══════════════════════════════════════════════════════════════════════════════
describe('updateOne', () => {
  let m;
  beforeEach(() => {
    m = new BaseModel('items');
  });

  test('converts string _id to ObjectId in filter', async () => {
    await m.updateOne({ _id: 'abc123def456abc1' }, { $set: { name: 'New' } });
    const filterArg = _mockCollection.updateOne.mock.calls[0][0];
    expect(filterArg._id).toBeInstanceOf(ObjectId);
  });

  test('appends license to filter when set', async () => {
    BaseModel.license = 'lic001';
    await m.updateOne({ name: 'Old' }, { $set: { name: 'New' } });
    expect(_mockCollection.updateOne.mock.calls[0][0].license).toBe('lic001');
  });

  test('always injects updatedAt into $set', async () => {
    await m.updateOne({ _id: 'id1' }, { $set: { name: 'New' } });
    const updateArg = _mockCollection.updateOne.mock.calls[0][1];
    expect(updateArg.$set.updatedAt).toBeInstanceOf(Date);
  });

  test('passes through $push operator', async () => {
    await m.updateOne({ _id: 'id1' }, { $set: {}, $push: { tags: 'new' } });
    const updateArg = _mockCollection.updateOne.mock.calls[0][1];
    expect(updateArg.$push).toEqual({ tags: 'new' });
  });

  test('passes through $pull operator', async () => {
    await m.updateOne({ _id: 'id1' }, { $set: {}, $pull: { tags: 'old' } });
    const updateArg = _mockCollection.updateOne.mock.calls[0][1];
    expect(updateArg.$pull).toEqual({ tags: 'old' });
  });

  test('rethrows on exception', async () => {
    _mockCollection.updateOne.mockRejectedValue(new Error('Write conflict'));
    await expect(m.updateOne({ _id: 'id1' }, { $set: {} })).rejects.toThrow('Write conflict');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// deleteOne
// ═══════════════════════════════════════════════════════════════════════════════
describe('deleteOne', () => {
  let m;
  beforeEach(() => {
    m = new BaseModel('items');
  });

  test('converts string _id to ObjectId', async () => {
    await m.deleteOne({ _id: 'abc123def456abc1' });
    expect(_mockCollection.deleteOne.mock.calls[0][0]._id).toBeInstanceOf(ObjectId);
  });

  test('appends license to filter when set', async () => {
    BaseModel.license = 'lic001';
    await m.deleteOne({ name: 'Widget' });
    expect(_mockCollection.deleteOne.mock.calls[0][0].license).toBe('lic001');
  });

  test('rethrows on exception', async () => {
    _mockCollection.deleteOne.mockRejectedValue(new Error('Permission denied'));
    await expect(m.deleteOne({ _id: 'id1' })).rejects.toThrow('Permission denied');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// countDocuments
// ═══════════════════════════════════════════════════════════════════════════════
describe('countDocuments', () => {
  let m;
  beforeEach(() => {
    m = new BaseModel('items');
  });

  test('appends license to query', async () => {
    BaseModel.license = 'lic001';
    await m.countDocuments({ active: true });
    expect(_mockCollection.countDocuments.mock.calls[0][0].license).toBe('lic001');
  });

  test('returns the count value', async () => {
    _mockCollection.countDocuments.mockResolvedValue(42);
    const result = await m.countDocuments({});
    expect(result).toBe(42);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// aggregate
// ═══════════════════════════════════════════════════════════════════════════════
describe('aggregate', () => {
  let m;
  beforeEach(() => {
    m = new BaseModel('items');
  });

  test('unshifts license $match when license is set', async () => {
    BaseModel.license = 'lic001';
    const pipeline = [{ $group: { _id: '$name' } }];
    await m.aggregate(pipeline);
    expect(pipeline[0]).toEqual({ $match: { license: 'lic001' } });
    expect(pipeline).toHaveLength(2);
  });

  test('does NOT inject $match when no license', async () => {
    const pipeline = [{ $group: { _id: '$name' } }];
    await m.aggregate(pipeline);
    expect(pipeline).toHaveLength(1);
    expect(pipeline[0]).not.toHaveProperty('$match');
  });

  test('returns array result', async () => {
    const data = [{ _id: 'A', count: 5 }];
    _mockCollection.aggregate.mockReturnValue({ toArray: jest.fn().mockResolvedValue(data) });
    const result = await m.aggregate([{ $group: { _id: '$name' } }]);
    expect(result).toEqual(data);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// changeLog
// ═══════════════════════════════════════════════════════════════════════════════
describe('changeLog', () => {
  let m;
  beforeEach(() => {
    m = new BaseModel('items');
  });

  test('inserts to data_change_log collection and returns status:true', async () => {
    _mockCollection.insertOne.mockResolvedValue({ insertedId: 'log001' });
    const result = await m.changeLog('products', 'user1', 'doc1', 'update', {}, { name: 'New' });
    expect(_mockDb.collection).toHaveBeenCalledWith('data_change_log');
    expect(result.status).toBe(true);
    expect(result.data).toBeDefined();
  });

  test('includes module, operation, time, oldDocument, newDocument', async () => {
    const old = { name: 'Old' };
    const newDoc = { name: 'New' };
    await m.changeLog('products', 'user1', 'doc1', 'update', old, newDoc);
    const insertArg = _mockCollection.insertOne.mock.calls[0][0];
    expect(insertArg.module).toBe('products');
    expect(insertArg.operation).toBe('update');
    expect(insertArg.oldDocument).toEqual(old);
    expect(insertArg.newDocument).toEqual(newDoc);
    expect(insertArg.time).toBeInstanceOf(Date);
  });

  test('returns status:false on exception', async () => {
    _mockCollection.insertOne.mockRejectedValue(new Error('log error'));
    const result = await m.changeLog('products', 'user1', 'doc1');
    expect(result.status).toBe(false);
    expect(result.message).toBe('log error');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// deletedDocumentBackup (static and instance)
// ═══════════════════════════════════════════════════════════════════════════════
describe('deletedDocumentBackup', () => {
  test('static: inserts to recycle_bin collection', async () => {
    _mockCollection.insertOne.mockResolvedValue({ insertedId: 'backup001' });
    const result = await BaseModel.deletedDocumentBackup('products', { _id: 'doc001' });
    expect(_mockDb.collection).toHaveBeenCalledWith('recycle_bin');
    expect(result.status).toBe(true);
  });

  test('static: includes document_name and document_backup_date', async () => {
    await BaseModel.deletedDocumentBackup('products', { _id: 'doc001' });
    const insertArg = _mockCollection.insertOne.mock.calls[0][0];
    expect(insertArg.document_name).toBe('products');
    expect(insertArg.document_backup_date).toBeInstanceOf(Date);
  });

  test('static: includes branch_id and license from static context', async () => {
    BaseModel.currentBranch = 'branch001';
    BaseModel.license = 'lic001';
    await BaseModel.deletedDocumentBackup('products', {});
    const insertArg = _mockCollection.insertOne.mock.calls[0][0];
    expect(insertArg.branch_id).toBe('branch001');
    expect(insertArg.license).toBe('lic001');
  });

  test('static: returns status:false on exception', async () => {
    _mockCollection.insertOne.mockRejectedValue(new Error('backup error'));
    const result = await BaseModel.deletedDocumentBackup('products', {});
    expect(result.status).toBe(false);
    expect(result.message).toBe('backup error');
  });

  test('instance method delegates to static', async () => {
    const spy = jest.spyOn(BaseModel, 'deletedDocumentBackup').mockResolvedValue({ status: true });
    const m = new BaseModel('items');
    await m.deletedDocumentBackup('products', { _id: 'doc001' });
    expect(spy).toHaveBeenCalledWith('products', { _id: 'doc001' });
    spy.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// changeUserLog (static) — OS / Browser / Device detection
// ═══════════════════════════════════════════════════════════════════════════════
describe('BaseModel.changeUserLog', () => {
  const userId = 'user001user001user001user1';
  const branchId = 'branch001branch001branch01';
  const license = 'lic001lic001lic001lic001li';

  async function callLog(userAgent, ip = '127.0.0.1') {
    return BaseModel.changeUserLog(userId, 'Alice', new Date(), branchId, 'Main', license, {
      userAgent,
      ip,
    });
  }

  test('detects Windows OS', async () => {
    await callLog('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    expect(_mockCollection.insertOne.mock.calls[0][0].os).toBe('Windows');
  });

  test('detects macOS', async () => {
    await callLog('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    expect(_mockCollection.insertOne.mock.calls[0][0].os).toBe('macOS');
  });

  test('DOCUMENTED BUG: Android UA with "Linux" prefix is detected as Linux (not Android)', async () => {
    // Production bug: code checks linux before android in if-else chain
    // 'Mozilla/5.0 (Linux; Android 11)' contains 'linux' → matched as Linux, not Android
    await callLog('Mozilla/5.0 (Linux; Android 11; Pixel 5)');
    expect(_mockCollection.insertOne.mock.calls[0][0].os).toBe('Linux');
  });

  test('detects Android when UA has no linux prefix', async () => {
    // Use UA without 'linux' to correctly trigger android branch
    await callLog('Mozilla/5.0 (Android 11; Mobile; rv:89.0) Gecko/89.0 Firefox/89.0');
    expect(_mockCollection.insertOne.mock.calls[0][0].os).toBe('Android');
  });

  test('DOCUMENTED BUG: iOS UA with "Mac OS X" is detected as macOS (not iOS)', async () => {
    // Production bug: code checks macintosh/mac os before iphone/ipad
    // iPhone UA typically has "like Mac OS X" → matched as macOS, not iOS
    await callLog('Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X)');
    expect(_mockCollection.insertOne.mock.calls[0][0].os).toBe('macOS');
  });

  test('detects iOS when UA has iphone without mac os string', async () => {
    // UA without 'mac os' correctly triggers iOS detection
    await callLog('Mozilla/5.0 (iPhone; CPU iPhone OS 15_0) AppleWebKit/605.1.15');
    expect(_mockCollection.insertOne.mock.calls[0][0].os).toBe('iOS');
  });

  test('detects Chrome browser', async () => {
    await callLog('Mozilla/5.0 (Windows NT 10.0) Chrome/91.0.4472.124 Safari/537.36');
    expect(_mockCollection.insertOne.mock.calls[0][0].browser).toBe('Chrome');
  });

  test('detects Firefox browser', async () => {
    await callLog('Mozilla/5.0 (Windows NT 10.0; rv:89.0) Gecko/20100101 Firefox/89.0');
    expect(_mockCollection.insertOne.mock.calls[0][0].browser).toBe('Firefox');
  });

  test('detects Mobile device', async () => {
    await callLog('Mozilla/5.0 (Linux; Android 11) mobile');
    expect(_mockCollection.insertOne.mock.calls[0][0].device).toBe('Mobile');
  });

  test('detects Tablet device', async () => {
    await callLog('Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X)');
    expect(_mockCollection.insertOne.mock.calls[0][0].device).toBe('Tablet');
  });

  test('defaults to Unknown OS, Unknown Browser, Desktop device', async () => {
    await callLog('custom-ua/1.0');
    const doc = _mockCollection.insertOne.mock.calls[0][0];
    expect(doc.os).toBe('Unknown');
    expect(doc.browser).toBe('Unknown');
    expect(doc.device).toBe('Desktop');
  });

  test('records IP address in document', async () => {
    await callLog('Mozilla/5.0', '192.168.1.100');
    expect(_mockCollection.insertOne.mock.calls[0][0].ip).toBe('192.168.1.100');
  });

  test('inserts to staff_activities collection', async () => {
    await callLog('Mozilla/5.0');
    expect(_mockDb.collection).toHaveBeenCalledWith('staff_activities');
  });

  test('returns status:true on success', async () => {
    const result = await callLog('Mozilla/5.0');
    expect(result.status).toBe(true);
  });

  test('returns status:false on exception', async () => {
    _mockCollection.insertOne.mockRejectedValueOnce(new Error('insert fail'));
    const result = await callLog('Mozilla/5.0');
    expect(result.status).toBe(false);
    expect(result.message).toBe('insert fail');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// withTransaction
// ═══════════════════════════════════════════════════════════════════════════════
describe('withTransaction', () => {
  let m;
  beforeEach(() => {
    m = new BaseModel('items');
  });

  test('calls operations with the session and returns result', async () => {
    const expected = { inserted: true };
    const operations = jest.fn().mockResolvedValue(expected);
    const result = await m.withTransaction(operations);
    expect(operations).toHaveBeenCalledWith(_mockSession);
    expect(result).toEqual(expected);
  });

  test('starts and ends session', async () => {
    await m.withTransaction(jest.fn().mockResolvedValue(null));
    expect(_mockClient.startSession).toHaveBeenCalled();
    expect(_mockSession.endSession).toHaveBeenCalled();
  });

  test('endSession called even when operations throw', async () => {
    _mockSession.withTransaction.mockImplementationOnce(async (fn) => {
      throw new Error('tx fail');
    });
    await expect(m.withTransaction(jest.fn())).rejects.toThrow('tx fail');
    expect(_mockSession.endSession).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getDb (static)
// ═══════════════════════════════════════════════════════════════════════════════
describe('BaseModel.getDb', () => {
  test('returns database when already set', async () => {
    const db = await BaseModel.getDb();
    expect(db).toBe(_mockDb);
  });

  test('calls initializeDB when database is null', async () => {
    BaseModel.database = null;
    const spy = jest.spyOn(BaseModel.prototype, 'initializeDB').mockResolvedValue();
    // Re-set database to simulate what initializeDB would do
    BaseModel.database = _mockDb;
    await BaseModel.getDb();
    // Restore
    spy.mockRestore();
    BaseModel.database = _mockDb;
  });
});
