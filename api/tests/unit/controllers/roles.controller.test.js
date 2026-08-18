'use strict';

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('mongodb', () => {
  function MockObjectId(id) {
    if (!(this instanceof MockObjectId)) return new MockObjectId(id);
    this._id = id;
  }
  return { MongoClient: { connect: jest.fn() }, ObjectId: MockObjectId };
});

const mockSvc = {
  listRoles: jest.fn(),
  getRoleById: jest.fn(),
  createRole: jest.fn(),
  updateRole: jest.fn(),
  deleteRole: jest.fn(),
  seedDefaultRoles: jest.fn(),
};
jest.mock('../../../src/services/role.service', () => jest.fn().mockImplementation(() => mockSvc));

const rolesController = require('../../../src/controllers/roles.controller');

// BaseController.success(res, data, message, code) → res.success(message, data, code)
// BaseController.error(res, message, code, errors)  → res.error(message, errors, code)
function makeRes() {
  return {
    success: jest.fn((message, data, code) => ({ message, data, code: code || 200 })),
    error: jest.fn((message, errors, code) => ({ message, code: code || 400 })),
  };
}

beforeEach(() => jest.clearAllMocks());

describe('RolesController', () => {
  test('list denies a user without user:read', async () => {
    const res = makeRes();
    const req = { user: { usertype: 'cashier', access: { user: { read: false } } } };
    await rolesController.list(req, res);
    expect(res.error).toHaveBeenCalledWith('You do not have permission to view roles', null, 403);
    expect(mockSvc.listRoles).not.toHaveBeenCalled();
  });

  test('list returns roles for an admin, seeding when empty', async () => {
    const res = makeRes();
    const req = { user: { usertype: 'admin' } };
    mockSvc.listRoles
      .mockResolvedValueOnce({ status: true, data: [] })
      .mockResolvedValueOnce({ status: true, data: [{ key: 'cashier' }] });
    mockSvc.seedDefaultRoles.mockResolvedValue({ status: true, data: { created: 8 } });
    await rolesController.list(req, res);
    expect(mockSvc.seedDefaultRoles).toHaveBeenCalledTimes(1);
    expect(res.success).toHaveBeenCalledWith('success', [{ key: 'cashier' }], 200);
  });

  test('create denies a user without user:write', async () => {
    const res = makeRes();
    const req = {
      user: { usertype: 'cashier', access: { user: { write: false } } },
      body: { name: 'X' },
    };
    await rolesController.create(req, res);
    expect(res.error).toHaveBeenCalledWith('You do not have permission to manage roles', null, 403);
    expect(mockSvc.createRole).not.toHaveBeenCalled();
  });

  test('delete of a system role surfaces the repository message', async () => {
    const res = makeRes();
    const req = { user: { usertype: 'admin' }, params: { id: 'id1' } };
    mockSvc.deleteRole.mockResolvedValue({
      status: false,
      message: 'System roles cannot be deleted',
    });
    await rolesController.remove(req, res);
    expect(res.error).toHaveBeenCalledWith('System roles cannot be deleted', null, 400);
  });
});
