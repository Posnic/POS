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

describe('scoped token branch authority', () => {
  test('uses the active token grant and never a users row with the token ID', async () => {
    const branchRead=jest.fn().mockResolvedValue({branch_name:'Branch'}),tokenRead=jest.fn().mockResolvedValue({_id:USER});
    mongoose.connection.db={collection:jest.fn(name=>{if(name==='branches')return {findOne:branchRead};if(name==='api_tokens')return {findOne:tokenRead};throw Error('Must not authenticate the token as a user');})};
    const req={isScopedApiToken:true,headers:{'x-branch-id':BRANCH}},user={_id:USER,license:LICENSE,api_token:true};
    expect((await attachTenantContext(req,user)).validated).toBe(true);
    const query=tokenRead.mock.calls[0][0];expect(query.active).toBe(true);expect(String(query._id)).toBe(USER);
    expect(query.license.$in.map(String)).toEqual([LICENSE,LICENSE]);
    expect(query.$or[0]).toEqual({branch_access:{$size:0}});
    expect(query.$or[1]['branch_access.branch_id'].$in.map(String)).toEqual([BRANCH,BRANCH]);
  });
  test('a revoked or out-of-scope token cannot borrow a valid user row', async () => {
    mongoose.connection.db={collection:name=>({findOne:jest.fn().mockResolvedValue(name==='api_tokens'?null:{_id:USER,branch_name:'Branch'})})};
    await expect(attachTenantContext({isScopedApiToken:true,headers:{'x-branch-id':BRANCH}},{_id:USER,license:LICENSE,api_token:true})).rejects.toBeInstanceOf(TenantContextError);
  });
  test('the principal marker alone never changes normal user validation', async () => {
    const called=[];mongoose.connection.db={collection:name=>{called.push(name);return {findOne:jest.fn().mockResolvedValue(name==='users'?null:{_id:USER,branch_name:'Branch'})};}};
    await expect(attachTenantContext({headers:{'x-branch-id':BRANCH}},{_id:USER,license:LICENSE,api_token:true})).rejects.toBeInstanceOf(TenantContextError);
    expect(called).toContain('users');expect(called).not.toContain('api_tokens');
  });
});
