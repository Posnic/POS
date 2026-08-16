'use strict';

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('mongodb', () => {
  function MockObjectId(id) {
    if (!(this instanceof MockObjectId)) return new MockObjectId(id);
    this._id = id;
  }
  return { MongoClient: { connect: jest.fn() }, ObjectId: MockObjectId };
});

const RoleRepository = require('../../../src/repositories/role.repository');
const { DEFAULT_ROLES } = require('../../../src/constants/roles.constants');

function makeCollection(overrides = {}) {
  return {
    find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnThis(), toArray: jest.fn().mockResolvedValue([]) }),
    findOne: jest.fn().mockResolvedValue(null),
    insertOne: jest.fn().mockResolvedValue({ insertedId: 'r1' }),
    insertMany: jest.fn().mockResolvedValue({ insertedCount: 0 }),
    updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    ...overrides,
  };
}

function makeModel(collection) {
  return {
    getCollection: jest.fn().mockResolvedValue(collection),
    toObjectId: jest.fn((v) => (v === null || v === undefined ? null : { oid: v })),
    licenseId: 'lic1',
  };
}

beforeEach(() => jest.clearAllMocks());

describe('RoleRepository', () => {
  test('listRoles returns roles scoped by license', async () => {
    const roles = [{ key: 'cashier' }];
    const col = makeCollection({
      find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnThis(), toArray: jest.fn().mockResolvedValue(roles) }),
    });
    const repo = new RoleRepository(makeModel(col));
    const r = await repo.listRoles();
    expect(r.status).toBe(true);
    expect(r.data).toBe(roles);
    expect(col.find).toHaveBeenCalledWith({ license: { oid: 'lic1' } });
  });

  test('getRoleById returns the role when found, not-found otherwise', async () => {
    const found = new RoleRepository(makeModel(makeCollection({ findOne: jest.fn().mockResolvedValue({ key: 'cashier' }) })));
    expect((await found.getRoleById('id1')).status).toBe(true);
    const missing = new RoleRepository(makeModel(makeCollection({ findOne: jest.fn().mockResolvedValue(null) })));
    const r = await missing.getRoleById('id1');
    expect(r.status).toBe(false);
    expect(r.message).toBe('Role not found');
  });

  test('createRole inserts a non-system role, trimming name', async () => {
    const col = makeCollection();
    const repo = new RoleRepository(makeModel(col));
    const r = await repo.createRole({ name: ' My Role ', description: 'x', access: { sales: { read: true } } });
    expect(r.status).toBe(true);
    const doc = col.insertOne.mock.calls[0][0];
    expect(doc.name).toBe('My Role');
    expect(doc.is_system).toBe(false);
    expect(doc.access).toEqual({ sales: { read: true } });
  });

  test('deleteRole refuses a system role but deletes a custom role', async () => {
    const sys = new RoleRepository(makeModel(makeCollection({ findOne: jest.fn().mockResolvedValue({ is_system: true }) })));
    const rs = await sys.deleteRole('id1');
    expect(rs.status).toBe(false);
    expect(rs.message).toMatch(/System roles/);

    const custCol = makeCollection({ findOne: jest.fn().mockResolvedValue({ is_system: false }) });
    const cust = new RoleRepository(makeModel(custCol));
    const rc = await cust.deleteRole('id1');
    expect(rc.status).toBe(true);
    expect(custCol.deleteOne).toHaveBeenCalled();
  });

  test('updateRole never changes key or is_system', async () => {
    const col = makeCollection();
    const repo = new RoleRepository(makeModel(col));
    await repo.updateRole('id1', { name: 'New', key: 'hacked', is_system: true, access: { x: {} } });
    const set = col.updateOne.mock.calls[0][1].$set;
    expect(set.name).toBe('New');
    expect(set.access).toEqual({ x: {} });
    expect('key' in set).toBe(false);
    expect('is_system' in set).toBe(false);
  });

  test('seedDefaultRoles inserts all defaults when none exist', async () => {
    const col = makeCollection({ find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }) });
    const repo = new RoleRepository(makeModel(col));
    const r = await repo.seedDefaultRoles();
    expect(r.status).toBe(true);
    expect(r.data.created).toBe(DEFAULT_ROLES.length);
    expect(col.insertMany).toHaveBeenCalledTimes(1);
    expect(col.insertMany.mock.calls[0][0]).toHaveLength(DEFAULT_ROLES.length);
  });

  test('seedDefaultRoles is idempotent (skips existing keys, no insert)', async () => {
    const col = makeCollection({
      find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue(DEFAULT_ROLES.map((d) => ({ key: d.key }))) }),
    });
    const repo = new RoleRepository(makeModel(col));
    const r = await repo.seedDefaultRoles();
    expect(r.status).toBe(true);
    expect(r.data.created).toBe(0);
    expect(col.insertMany).not.toHaveBeenCalled();
  });
});
