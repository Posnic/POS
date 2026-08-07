jest.mock('mongoose', () => {
  return {
    connection: { db: null },
  };
});

const mongoose = require('mongoose');
const {
  attachTenantContext,
  idString,
  TenantContextError,
} = require('../../../src/utils/tenant-context');

const USER = '507f1f77bcf86cd799439011';
const BRANCH = '507f1f77bcf86cd799439012';
const OTHER_BRANCH = '507f1f77bcf86cd799439013';
const LICENSE = '507f1f77bcf86cd799439014';

const makeDb = ({ branch = true, user = true } = {}) => ({
  collection: jest.fn((name) => ({
    findOne: jest
      .fn()
      .mockResolvedValue(
        name === 'branches'
          ? branch
            ? { _id: BRANCH, branch_name: 'Main Branch' }
            : null
          : user
            ? { _id: USER }
            : null
      ),
  })),
});

describe('tenant context', () => {
  beforeEach(() => {
    mongoose.connection.db = makeDb();
  });

  test('converts a BSON ObjectId without recursing through its id accessor', () => {
    const objectId = { toHexString: () => BRANCH };
    Object.defineProperty(objectId, '_id', { get: () => objectId });
    expect(idString(objectId)).toBe(BRANCH);
  });

  test('uses an explicit query branch and the authenticated license', async () => {
    const req = {
      session: { selectedBranchId: BRANCH },
      body: { license_id: OTHER_BRANCH },
      query: { branch_id: OTHER_BRANCH, branch: BRANCH, license: OTHER_BRANCH },
      headers: {},
    };
    const user = { _id: USER, license: LICENSE, branch_id: OTHER_BRANCH };

    const context = await attachTenantContext(req, user);

    expect(context.branchId.toString()).toBe(OTHER_BRANCH);
    expect(context.branchName).toBe('Main Branch');
    expect(context.licenseId.toString()).toBe(LICENSE);
    expect(req.body.license_id).toBe(LICENSE);
    expect(req.query.branch_id).toBe(OTHER_BRANCH);
    expect(req.query.branch).toBe(OTHER_BRANCH);
    expect(req.query.license).toBe(LICENSE);
  });

  test('uses the selected session branch when the request has no branch override', async () => {
    const req = {
      session: { selectedBranchId: BRANCH },
      body: {},
      query: {},
      headers: {},
    };
    const user = { _id: USER, license: LICENSE, branch_id: OTHER_BRANCH };

    const context = await attachTenantContext(req, user);

    expect(context.branchId.toString()).toBe(BRANCH);
    expect(context.licenseId.toString()).toBe(LICENSE);
  });

  test('prefers the X-Branch-Id header over query and session branches', async () => {
    const req = {
      session: { selectedBranchId: OTHER_BRANCH },
      body: {},
      query: { branch_id: OTHER_BRANCH },
      headers: { 'x-branch-id': BRANCH },
    };
    const user = { _id: USER, license: LICENSE };

    const context = await attachTenantContext(req, user);

    expect(context.branchId.toString()).toBe(BRANCH);
  });

  test('rejects a branch outside the current user or license', async () => {
    mongoose.connection.db = makeDb({ branch: false });
    const req = { session: { selectedBranchId: BRANCH }, body: {}, query: {} };
    const user = { _id: USER, license: LICENSE };

    await expect(attachTenantContext(req, user)).rejects.toBeInstanceOf(TenantContextError);
  });

  test('rejects a branch not present in the user branch access', async () => {
    mongoose.connection.db = makeDb({ user: false });
    const req = { session: { selectedBranchId: BRANCH }, body: {}, query: {} };
    const user = { _id: USER, license: LICENSE };

    await expect(attachTenantContext(req, user)).rejects.toBeInstanceOf(TenantContextError);
  });
});
