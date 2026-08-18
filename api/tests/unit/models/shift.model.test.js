'use strict';

/**
 * Unit tests for src/models/shift.model.js
 * Native-driver data-access class extending BaseModel. Collection: "shifts".
 */

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('../../../src/utils/helpers', () => ({
  formatDate: jest.fn((d) => (d instanceof Date ? '2024-01-01' : String(d))),
}));
jest.mock('mongodb', () => {
  function MockObjectId(id) {
    if (!(this instanceof MockObjectId)) return new MockObjectId(id);
    this._mockId = id;
  }
  MockObjectId.isValid = jest.fn((val) => (typeof val === 'string' ? val.length >= 12 : !!val));
  const mockCollection = {
    find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
    findOne: jest.fn().mockResolvedValue(null),
    insertOne: jest.fn().mockResolvedValue({ insertedId: 's1' }),
  };
  const mockDb = { collection: jest.fn().mockReturnValue(mockCollection) };
  const mockClient = { db: jest.fn().mockReturnValue(mockDb), startSession: jest.fn() };
  return {
    MongoClient: { connect: jest.fn().mockResolvedValue(mockClient) },
    ObjectId: MockObjectId,
  };
});

const BaseModel = require('../../../src/models/base.model');
const ShiftModel = require('../../../src/models/shift.model');

beforeEach(() => jest.clearAllMocks());

describe('ShiftModel', () => {
  test('is an instance of BaseModel', () => {
    expect(new ShiftModel()).toBeInstanceOf(BaseModel);
  });

  test('collectionName is "shifts"', () => {
    expect(new ShiftModel().collectionName).toBe('shifts');
  });

  test('declares all expected fields (15)', () => {
    const f = new ShiftModel().fields;
    const expected = [
      '_id',
      'license',
      'branch_id',
      'user_id',
      'user_name',
      'status',
      'clock_in',
      'clock_out',
      'break_minutes',
      'worked_minutes',
      'register_id',
      'device_id',
      'note',
      'created_date',
      'updated_date',
    ];
    expected.forEach((n) => expect(f[n]).toBeDefined());
    expect(Object.keys(f)).toHaveLength(15);
  });

  test('license + branch_id are select:false; user/status/times are select:true', () => {
    const f = new ShiftModel().fields;
    expect(f.license.select).toBe(false);
    expect(f.branch_id.select).toBe(false);
    expect(f.user_id.select).toBe(true);
    expect(f.status.select).toBe(true);
    expect(f.clock_in.select).toBe(true);
    expect(f.worked_minutes.select).toBe(true);
  });
});
