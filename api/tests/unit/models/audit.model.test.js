'use strict';

/**
 * Unit tests for src/models/audit.model.js
 * Native-driver data-access class extending BaseModel. Collection: "audit_log".
 * Follows the base.model.test.js / register.model.test.js mock pattern.
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
  MockObjectId.isValid = jest.fn((val) => (typeof val === 'string' ? val.length >= 12 : !!val));
  const mockCollection = {
    find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    findOne: jest.fn().mockResolvedValue(null),
    insertOne: jest.fn().mockResolvedValue({ insertedId: 'ins001' }),
  };
  const mockDb = { collection: jest.fn().mockReturnValue(mockCollection) };
  const mockClient = { db: jest.fn().mockReturnValue(mockDb), startSession: jest.fn() };
  return {
    MongoClient: { connect: jest.fn().mockResolvedValue(mockClient) },
    ObjectId: MockObjectId,
  };
});

// ─── Requires ────────────────────────────────────────────────────────────────
const BaseModel = require('../../../src/models/base.model');
const AuditModel = require('../../../src/models/audit.model');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AuditModel', () => {
  test('is an instance of BaseModel', () => {
    expect(new AuditModel()).toBeInstanceOf(BaseModel);
  });

  test('collectionName is set to "audit_log"', () => {
    expect(new AuditModel().collectionName).toBe('audit_log');
  });

  test('declares all expected fields (15)', () => {
    const f = new AuditModel().fields;
    const expected = [
      '_id',
      'license',
      'branch_id',
      'at',
      'event',
      'actor_user_id',
      'actor_name',
      'approved_by_user_id',
      'approved_by_name',
      'entity',
      'entity_id',
      'device_id',
      'amount',
      'reason',
      'details',
    ];
    expected.forEach((n) => expect(f[n]).toBeDefined());
    expect(Object.keys(f)).toHaveLength(15);
  });

  test('license + branch_id are select:false; event + at are select:true', () => {
    const f = new AuditModel().fields;
    expect(f.license.select).toBe(false);
    expect(f.branch_id.select).toBe(false);
    expect(f.event.select).toBe(true);
    expect(f.at.select).toBe(true);
  });
});
