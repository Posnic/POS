'use strict';

/**
 * Unit tests for src/models/role.model.js
 * Native-driver data-access class extending BaseModel. Collection: "roles".
 */

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
    insertOne: jest.fn().mockResolvedValue({ insertedId: 'r1' }),
  };
  const mockDb = { collection: jest.fn().mockReturnValue(mockCollection) };
  const mockClient = { db: jest.fn().mockReturnValue(mockDb), startSession: jest.fn() };
  return { MongoClient: { connect: jest.fn().mockResolvedValue(mockClient) }, ObjectId: MockObjectId };
});

const BaseModel = require('../../../src/models/base.model');
const RoleModel = require('../../../src/models/role.model');

beforeEach(() => jest.clearAllMocks());

describe('RoleModel', () => {
  test('is an instance of BaseModel', () => {
    expect(new RoleModel()).toBeInstanceOf(BaseModel);
  });

  test('collectionName is set to "roles"', () => {
    expect(new RoleModel().collectionName).toBe('roles');
  });

  test('declares all expected fields (12)', () => {
    const f = new RoleModel().fields;
    const expected = [
      '_id', 'license', 'name', 'key', 'is_system', 'description',
      'branch_scope', 'access', 'pos', 'requires_manager_approval', 'created_date', 'updated_date',
    ];
    expected.forEach((n) => expect(f[n]).toBeDefined());
    expect(Object.keys(f)).toHaveLength(12);
  });

  test('license is select:false; name/key/access are select:true', () => {
    const f = new RoleModel().fields;
    expect(f.license.select).toBe(false);
    expect(f.name.select).toBe(true);
    expect(f.key.select).toBe(true);
    expect(f.access.select).toBe(true);
  });
});
