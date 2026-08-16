'use strict';

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('mongodb', () => {
  function MockObjectId(id) {
    if (!(this instanceof MockObjectId)) return new MockObjectId(id);
    this._id = id;
  }
  return { MongoClient: { connect: jest.fn() }, ObjectId: MockObjectId };
});

const RoleService = require('../../../src/services/role.service');

function makeModel(col) {
  return {
    getCollection: jest.fn().mockResolvedValue(col),
    toObjectId: jest.fn((v) => (v === null || v === undefined ? null : { oid: v })),
    licenseId: 'lic1',
  };
}

beforeEach(() => jest.clearAllMocks());

describe('RoleService', () => {
  test('delegates listRoles through the repository/model', async () => {
    const col = {
      find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnThis(), toArray: jest.fn().mockResolvedValue([{ key: 'owner' }]) }),
    };
    const svc = new RoleService(makeModel(col));
    const r = await svc.listRoles();
    expect(r.status).toBe(true);
    expect(r.data[0].key).toBe('owner');
  });

  test('seedDefaultRoles delegates and reports a created count', async () => {
    const col = {
      find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
      insertMany: jest.fn().mockResolvedValue({}),
    };
    const svc = new RoleService(makeModel(col));
    const r = await svc.seedDefaultRoles();
    expect(r.status).toBe(true);
    expect(r.data.created).toBeGreaterThan(0);
  });
});
