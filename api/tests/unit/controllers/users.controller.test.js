'use strict';

// ─── Inline-required mocks (must be defined BEFORE controller loads) ───────────
const mockMongoDb = {
  collection: jest.fn(),
};
const mockLoginCheckColl = {
  findOne: jest.fn(),
  insertOne: jest.fn(),
  updateOne: jest.fn(),
  updateMany: jest.fn(),
};
const mockSsoColl = {
  findOne: jest.fn(),
  insertOne: jest.fn(),
  updateOne: jest.fn(),
};
const mockUserSessionsColl = {
  findOne: jest.fn(),
  insertOne: jest.fn(),
  updateOne: jest.fn(),
  updateMany: jest.fn(),
};
const mockCashregisterColl = {
  findOne: jest.fn(),
};
const mockTransactionColl = {
  aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
};
const mockBranchDbColl = {
  find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
};

mockMongoDb.collection.mockImplementation((name) => {
  if (name === 'login_check') return mockLoginCheckColl;
  if (name === 'sso') return mockSsoColl;
  if (name === 'user_sessions') return mockUserSessionsColl;
  if (name === 'cashregister') return mockCashregisterColl;
  if (name === 'transaction') return mockTransactionColl;
  if (name === 'branches') return mockBranchDbColl;
  return {};
});

jest.mock('mongoose', () => ({
  connection: { db: mockMongoDb },
  Types: {
    ObjectId: Object.assign(
      jest.fn((id) => ({ toString: () => String(id), toHexString: () => String(id) })),
      { isValid: jest.fn(() => true) }
    ),
  },
}));

// Mock axios for ssoClientLogin
jest.mock('axios', () => ({
  post: jest.fn(),
}));

// ─── Core dependency mocks ────────────────────────────────────────────────────
const mockUserModel = {
  userInsertUpdate: jest.fn(),
  findOne: jest.fn(),
  findById: jest.fn(),
  find: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  updateOne: jest.fn(),
  deleteMany: jest.fn(),
  userPage: jest.fn(),
  userstatusReportPage: jest.fn(),
  exportUserOrder: jest.fn(),
  getDataChanges: jest.fn(),
};

const mockBranchModel = {
  findOne: jest.fn(),
  findById: jest.fn(),
};

const mockBcrypt = {
  compare: jest.fn(),
  hash: jest.fn(),
};

const mockCreateSendToken = jest.fn();
const mockSignToken = jest.fn();
const mockSignLegacyToken = jest.fn().mockReturnValue('mock-legacy-jwt-token');

const mockUsersService = {
  changeBranch: jest.fn(),
};

const mockSessionFilterUtil = {
  applySessionFilter: jest.fn(),
};

const mockBaseModelInstance = {
  changeLog: jest.fn(),
};

jest.mock('../../../src/models/user.model', () => mockUserModel);
jest.mock('../../../src/models/branch.model', () => mockBranchModel);
jest.mock('bcryptjs', () => mockBcrypt);
jest.mock('../../../src/middleware/auth', () => ({
  createSendToken: mockCreateSendToken,
  signToken: mockSignToken,
  signLegacyToken: mockSignLegacyToken,
}));
jest.mock('http-status', () => ({
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
}));
jest.mock('../../../src/utils/appError', () => ({
  AppError: class AppError extends Error {
    constructor(msg, code) {
      super(msg);
      this.statusCode = code;
    }
  },
}));
jest.mock('mongodb', () => {
  function ObjectId(id) {
    this._id = id;
    this.toString = () => String(id);
  }
  ObjectId.isValid = jest.fn(() => true);
  return { ObjectId };
});
jest.mock('../../../src/models/base.model', () => {
  const BM = jest.fn(() => mockBaseModelInstance);
  BM.currentBranch = null;
  BM.currentBranchName = null;
  BM.license = null;
  BM.loggedUser = null;
  BM.loggedUserName = null;
  BM.deletedDocumentBackup = jest.fn().mockResolvedValue(true);
  BM.changeUserLog = jest.fn().mockResolvedValue({ status: true });
  return BM;
});
jest.mock('../../../src/utils/session-filter.util', () => mockSessionFilterUtil);
jest.mock('../../../src/services/user.service', () => mockUsersService);

// ─── Load controller (singleton) ──────────────────────────────────────────────
const ctrl = require('../../../src/controllers/users.controller');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.cookie = jest.fn().mockReturnValue(res);
  res.clearCookie = jest.fn().mockReturnValue(res);
  return res;
};

const mockReq = (overrides = {}) => ({
  body: {},
  query: {},
  params: {},
  headers: {},
  user: {
    _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    usertype: 'admin',
    license: 'bbbbbbbbbbbbbbbbbbbbbbbb',
    branch_id: 'cccccccccccccccccccccccc',
    access: { user: { read: true, write: true, delete: true } },
  },
  session: { destroy: jest.fn((cb) => cb && cb()), userId: null, branch_id: null },
  sessionID: 'sess-123',
  app: { locals: { mongoClient: null } },
  ip: '127.0.0.1',
  connection: { remoteAddress: '127.0.0.1' },
  get: jest.fn((h) => (h === 'host' ? 'localhost:5000' : '')),
  protocol: 'http',
  ...overrides,
});

const mockNext = jest.fn();

// ─── Helpers to set up chainable Mongoose mock returns ────────────────────────
const chainable = (resolvedValue) => {
  const chain = {
    select: jest.fn(),
    lean: jest.fn().mockResolvedValue(resolvedValue),
  };
  chain.select.mockReturnValue(chain);
  return chain;
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  // Reset inline-require mocks
  mockLoginCheckColl.findOne.mockResolvedValue(null);
  mockLoginCheckColl.insertOne.mockResolvedValue({ insertedId: 'sid1' });
  mockLoginCheckColl.updateOne.mockResolvedValue({ modifiedCount: 1 });
  mockSsoColl.findOne.mockResolvedValue(null);
  mockSsoColl.insertOne.mockResolvedValue({});
  mockSsoColl.updateOne.mockResolvedValue({});
  mockUserSessionsColl.findOne.mockResolvedValue(null);
  mockUserSessionsColl.insertOne.mockResolvedValue({ insertedId: 'usid1' });
  mockUserSessionsColl.updateOne.mockResolvedValue({ modifiedCount: 0 });
  mockUserSessionsColl.updateMany.mockResolvedValue({ modifiedCount: 0 });
  mockCashregisterColl.findOne.mockResolvedValue(null);
  mockTransactionColl.aggregate.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });
  mockBranchDbColl.find.mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });
});

// ═══════════════════════════════════════════════════════════════════════════════
// extractObjectId
// ═══════════════════════════════════════════════════════════════════════════════
describe('extractObjectId', () => {
  test('returns null for falsy input', () => {
    expect(ctrl.extractObjectId(null)).toBeNull();
    expect(ctrl.extractObjectId('')).toBeNull();
    expect(ctrl.extractObjectId(undefined)).toBeNull();
  });

  test('returns null for "[object Object]" string', () => {
    expect(ctrl.extractObjectId('[object Object]')).toBeNull();
  });

  test('extracts $oid from object', () => {
    expect(ctrl.extractObjectId({ $oid: 'abc123' })).toBe('abc123');
  });

  test('extracts $oid from JSON string', () => {
    expect(ctrl.extractObjectId('{"$oid":"abc123"}')).toBe('abc123');
  });

  test('returns plain 24-char hex string unchanged', () => {
    const id = 'aabbccddeeff001122334455';
    expect(ctrl.extractObjectId(id)).toBe(id);
  });

  test('returns plain non-oid string unchanged', () => {
    expect(ctrl.extractObjectId('somestring')).toBe('somestring');
  });

  test('returns null for non-object, non-string', () => {
    expect(ctrl.extractObjectId(12345)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// add
// ═══════════════════════════════════════════════════════════════════════════════
describe('add', () => {
  const validUser = {
    _id: 'u1',
    usertype: 'admin',
    license: 'lic1',
    access: { user: { write: true } },
  };

  test('200 success when userInsertUpdate returns status true', async () => {
    mockUserModel.userInsertUpdate.mockResolvedValue({
      status: true,
      data: { id: 'u1' },
      message: 'Created',
    });
    const req = mockReq({ user: validUser });
    const res = mockRes();
    await ctrl.add(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  test('406 when userInsertUpdate returns status "exist"', async () => {
    mockUserModel.userInsertUpdate.mockResolvedValue({
      status: 'exist',
      message: 'User exists',
      data: null,
    });
    const req = mockReq({ user: validUser });
    const res = mockRes();
    await ctrl.add(req, res);
    expect(res.status).toHaveBeenCalledWith(406);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  test('404 when userInsertUpdate returns status false', async () => {
    mockUserModel.userInsertUpdate.mockResolvedValue({
      status: false,
      message: 'Failed',
      data: null,
    });
    const req = mockReq({ user: validUser });
    const res = mockRes();
    await ctrl.add(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  test('403 when user lacks write permission', async () => {
    const req = mockReq({
      user: { usertype: 'user', access: { user: { read: true, write: false } } },
    });
    const res = mockRes();
    await ctrl.add(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('500 on service exception', async () => {
    mockUserModel.userInsertUpdate.mockRejectedValue(new Error('DB error'));
    const req = mockReq({ user: validUser });
    const res = mockRes();
    await ctrl.add(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// login
// ═══════════════════════════════════════════════════════════════════════════════
describe('login', () => {
  const fakeUser = { _id: 'u1', email: 'a@b.com', password: 'hashed' };

  test('calls next(AppError) when email or password missing', async () => {
    const req = mockReq({ body: { email: 'a@b.com' } }); // no password
    await ctrl.login(req, mockRes(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  test('calls next(AppError) when user not found', async () => {
    const chain = chainable(null);
    mockUserModel.findOne.mockReturnValue(chain);
    mockBcrypt.compare.mockResolvedValue(false);
    const req = mockReq({ body: { email: 'x@x.com', password: 'pass' } });
    await ctrl.login(req, mockRes(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  test('calls next(AppError) when password incorrect', async () => {
    const chain = chainable(fakeUser);
    mockUserModel.findOne.mockReturnValue(chain);
    mockBcrypt.compare.mockResolvedValue(false);
    const req = mockReq({ body: { email: fakeUser.email, password: 'wrong' } });
    await ctrl.login(req, mockRes(), mockNext);
    expect(mockNext).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  test('calls createSendToken on success', async () => {
    mockUserModel.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(fakeUser) });
    mockBcrypt.compare.mockResolvedValue(true);
    const req = mockReq({
      body: { email: fakeUser.email, password: 'correct' },
      session: { userId: null, destroy: jest.fn() },
    });
    const res = mockRes();
    await ctrl.login(req, res, mockNext);
    expect(mockCreateSendToken).toHaveBeenCalledWith(fakeUser, 200, res);
  });

  test('sets session.userId on successful login', async () => {
    mockUserModel.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(fakeUser) });
    mockBcrypt.compare.mockResolvedValue(true);
    const req = mockReq({
      body: { email: fakeUser.email, password: 'correct' },
      session: { userId: null, destroy: jest.fn() },
    });
    await ctrl.login(req, mockRes(), mockNext);
    expect(req.session.userId).toBe(String(fakeUser._id));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// legacyVerifyLogin / verify
// ═══════════════════════════════════════════════════════════════════════════════
describe('legacyVerifyLogin', () => {
  const fakeUser = {
    _id: 'uid1',
    email: 'admin@test.com',
    username: 'admin',
    password: 'hashed',
    activate: true,
    branch_access: [{ branch_id: 'bid1' }],
    license: 'lic1',
    usertype: 'admin',
    firstname: 'John',
    lastname: 'Doe',
    image: 'user.svg',
    printing_design: 'standard',
    register_status: 'Closed',
    access: { plan: { read: true } },
    plan: { name: 'pro' },
  };
  const fakeBranch = {
    _id: 'bid1',
    branch_name: 'Main',
    logo: 'store.png',
    store_telephone: '123',
    store_email: 'b@b.com',
    store_address: 'Addr',
    time_zone: 'UTC',
    time_format: 'enable',
    currency_type: 'USD',
  };

  const buildUserChain = (resolvedUser) => {
    const chain = { select: jest.fn(), lean: jest.fn().mockResolvedValue(resolvedUser) };
    chain.select.mockReturnValue(chain);
    return chain;
  };

  test('400 when username too short', async () => {
    const req = mockReq({ body: { username: 'ab', password: 'pass' } });
    const res = mockRes();
    await ctrl.legacyVerifyLogin(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  test('400 when username missing', async () => {
    const req = mockReq({ body: { password: 'pass' } });
    const res = mockRes();
    await ctrl.legacyVerifyLogin(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('404 when user not found', async () => {
    const chain = buildUserChain(null);
    mockUserModel.findOne.mockReturnValue(chain);
    const req = mockReq({ body: { username: 'nonexistent', password: 'pass' } });
    const res = mockRes();
    await ctrl.legacyVerifyLogin(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('404 when password invalid', async () => {
    const chain = buildUserChain(fakeUser);
    mockUserModel.findOne.mockReturnValue(chain);
    mockBcrypt.compare.mockResolvedValue(false);
    const req = mockReq({ body: { username: 'admin', password: 'wrong' } });
    const res = mockRes();
    await ctrl.legacyVerifyLogin(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: 'incorrect' }));
  });

  test('403 when user is inactive', async () => {
    const inactiveUser = { ...fakeUser, activate: false };
    const chain = buildUserChain(inactiveUser);
    mockUserModel.findOne.mockReturnValue(chain);
    mockBcrypt.compare.mockResolvedValue(true);
    const req = mockReq({ body: { username: 'admin', password: 'pass' } });
    const res = mockRes();
    await ctrl.legacyVerifyLogin(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: 'inactive' }));
  });

  test('404 when user has no branch access', async () => {
    const noBranchUser = { ...fakeUser, branch_access: [] };
    const chain = buildUserChain(noBranchUser);
    mockUserModel.findOne.mockReturnValue(chain);
    mockBcrypt.compare.mockResolvedValue(true);
    const req = mockReq({ body: { username: 'admin', password: 'pass' } });
    const res = mockRes();
    await ctrl.legacyVerifyLogin(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'User Have not Any Branch' })
    );
  });

  test('404 when branch not found', async () => {
    const chain = buildUserChain(fakeUser);
    mockUserModel.findOne.mockReturnValue(chain);
    mockBcrypt.compare.mockResolvedValue(true);
    const branchChain = { lean: jest.fn().mockResolvedValue(null) };
    mockBranchModel.findOne.mockReturnValue(branchChain);
    const req = mockReq({ body: { username: 'admin', password: 'pass' } });
    const res = mockRes();
    await ctrl.legacyVerifyLogin(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('200 success with jwt_token and param payload', async () => {
    const chain = buildUserChain(fakeUser);
    mockUserModel.findOne.mockReturnValue(chain);
    mockBcrypt.compare.mockResolvedValue(true);
    const branchChain = { lean: jest.fn().mockResolvedValue(fakeBranch) };
    mockBranchModel.findOne.mockReturnValue(branchChain);
    const req = mockReq({
      body: { username: 'admin', password: 'pass' },
      session: { destroy: jest.fn() },
    });
    const res = mockRes();
    await ctrl.legacyVerifyLogin(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        message: 'Successfully login',
      })
    );
    expect(res.json.mock.calls[0][0].data).toHaveProperty('jwt_token');
    expect(res.json.mock.calls[0][0].data).toHaveProperty('sid');
  });

  test('verify() delegates to legacyVerifyLogin', async () => {
    jest.spyOn(ctrl, 'legacyVerifyLogin').mockResolvedValue();
    const req = mockReq({ body: { username: 'admin', password: 'pass' } });
    const res = mockRes();
    await ctrl.verify(req, res, mockNext);
    expect(ctrl.legacyVerifyLogin).toHaveBeenCalledWith(req, res, mockNext);
    ctrl.legacyVerifyLogin.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// logOut
// ═══════════════════════════════════════════════════════════════════════════════
describe('logOut', () => {
  test('200 and clears jwt cookie', async () => {
    const req = mockReq({ session: { destroy: jest.fn((cb) => cb()) } });
    const res = mockRes();
    await ctrl.logOut(req, res);
    expect(res.clearCookie).toHaveBeenCalledWith('jwt', expect.any(Object));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: 'User logout successfully' })
    );
  });

  test('500 on unexpected error', async () => {
    const req = mockReq({ session: { destroy: jest.fn((cb) => cb()) } });
    // Was an undeclared assignment, which quietly creates a global and leaks
    // this mock into whatever runs next.
    const res = mockRes();
    res.clearCookie.mockImplementation(() => {
      throw new Error('cookie err');
    });
    await ctrl.logOut(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// verifyToken
// ═══════════════════════════════════════════════════════════════════════════════
describe('verifyToken', () => {
  test('200 with user data', async () => {
    const req = mockReq({ user: { _id: 'u1', email: 'a@b.com' } });
    const res = mockRes();
    await ctrl.verifyToken(req, res, mockNext);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'success' }));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// userBranchSelection
// ═══════════════════════════════════════════════════════════════════════════════
describe('userBranchSelection', () => {
  const branchChain = (user) => {
    const c = { select: jest.fn(), lean: jest.fn().mockResolvedValue(user) };
    c.select.mockReturnValue(c);
    return c;
  };

  test('401 when req.user missing', async () => {
    const req = mockReq({ user: undefined });
    const res = mockRes();
    await ctrl.userBranchSelection(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('404 when user not found in DB', async () => {
    mockUserModel.findById.mockReturnValue(branchChain(null));
    const res = mockRes();
    await ctrl.userBranchSelection(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('200 with empty branch list', async () => {
    mockUserModel.findById.mockReturnValue(branchChain({ branch_access: [], printing_design: [] }));
    const res = mockRes();
    await ctrl.userBranchSelection(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { branch_id: [] },
      })
    );
  });

  test('200 with branch list populated', async () => {
    const user = {
      branch_access: [{ branch_id: 'b1', branch_name: 'Branch1', branch_image: 'img.png' }],
      printing_design: [{ branch_id: 'b1', printing_design: 'thermal', printing_max_char: '40' }],
    };
    mockUserModel.findById.mockReturnValue(branchChain(user));
    const res = mockRes();
    await ctrl.userBranchSelection(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const responseData = res.json.mock.calls[0][0].data.branch_id;
    expect(responseData).toHaveLength(1);
    expect(responseData[0]).toMatchObject({ branch_access: 'b1', printing_design: 'thermal' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getUserAccessDetails
// ═══════════════════════════════════════════════════════════════════════════════
describe('getUserAccessDetails', () => {
  const lean = (v) => ({ lean: jest.fn().mockResolvedValue(v) });

  test('401 when no user in request', async () => {
    const res = mockRes();
    await ctrl.getUserAccessDetails(mockReq({ user: undefined }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('404 when user not found in DB', async () => {
    mockUserModel.findById.mockReturnValue(lean(null));
    const res = mockRes();
    await ctrl.getUserAccessDetails(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('200 returns access object with plan defaults when missing', async () => {
    mockUserModel.findById.mockReturnValue(lean({ access: {} }));
    const res = mockRes();
    await ctrl.getUserAccessDetails(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.plan).toEqual({
      read: true,
      write: false,
      delete: false,
    });
  });

  test('200 returns existing access unchanged when plan.read is boolean', async () => {
    const access = { user: { read: true }, plan: { read: false } };
    mockUserModel.findById.mockReturnValue(lean({ access }));
    const res = mockRes();
    await ctrl.getUserAccessDetails(mockReq(), res);
    expect(res.json.mock.calls[0][0].data.plan.read).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getUserRegisterList
// ═══════════════════════════════════════════════════════════════════════════════
describe('getUserRegisterList', () => {
  const buildUserChain = (user) => {
    const c = { select: jest.fn(), lean: jest.fn().mockResolvedValue(user) };
    c.select.mockReturnValue(c);
    return c;
  };

  test('401 when no user', async () => {
    const res = mockRes();
    await ctrl.getUserRegisterList(mockReq({ user: undefined }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('200 with registers from branch', async () => {
    const user = { _id: 'u1', branch_access: [{ branch_id: 'b1' }], default_branch_id: 'b1' };
    mockUserModel.findById.mockReturnValue(buildUserChain(user));
    const fakeBranch = {
      register: [{ register_id: 'r1', register_name: 'Reg 1' }],
    };
    mockBranchModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(fakeBranch) });
    const res = mockRes();
    await ctrl.getUserRegisterList(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toHaveLength(1);
  });

  test('200 with empty registers when branch has none', async () => {
    const user = { _id: 'u1', branch_access: [{ branch_id: 'b1' }], default_branch_id: 'b1' };
    mockUserModel.findById.mockReturnValue(buildUserChain(user));
    mockBranchModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ register: [] }),
    });
    mockBranchModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    const res = mockRes();
    await ctrl.getUserRegisterList(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// userDefaultBranchSet
// ═══════════════════════════════════════════════════════════════════════════════
describe('userDefaultBranchSet', () => {
  test('400 when branch id missing', async () => {
    const res = mockRes();
    await ctrl.userDefaultBranchSet(mockReq({ query: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('200 on success and sets session', async () => {
    mockUsersService.changeBranch.mockResolvedValue({
      status: true,
      data: { branch_id: 'b1' },
    });
    const req = mockReq({
      query: { id: 'b1' },
      session: { destroy: jest.fn() },
      user: { ...mockReq().user, branch_access: [{ branch_id: 'b1' }] },
    });
    const res = mockRes();
    await ctrl.userDefaultBranchSet(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(req.session.selectedBranchId).toBe('b1');
  });

  test('404 when service returns failure', async () => {
    mockUsersService.changeBranch.mockResolvedValue({ status: false, message: 'Not found' });
    const req = mockReq({
      query: { id: 'b1' },
      user: { ...mockReq().user, branch_access: [{ branch_id: 'b1' }] },
    });
    const res = mockRes();
    await ctrl.userDefaultBranchSet(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getAll
// ═══════════════════════════════════════════════════════════════════════════════
describe('getAll', () => {
  test('200 with user list', async () => {
    const users = [{ _id: '111111111111111111111111', name: 'A' }];
    mockUserModel.userPage.mockResolvedValue({
      status: true,
      data: { list: users, total: 1 },
      message: 'ok',
    });
    const res = mockRes();
    await ctrl.getAll(mockReq({ query: { limit: '10', page: '1' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  test('404 when model returns status false', async () => {
    mockUserModel.userPage.mockResolvedValue({ status: false, data: null });
    const res = mockRes();
    await ctrl.getAll(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('403 when user lacks read permission', async () => {
    const req = mockReq({ user: { usertype: 'user', access: { user: { read: false } } } });
    const res = mockRes();
    await ctrl.getAll(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('404 on invalid filter JSON', async () => {
    const req = mockReq({ query: { filters: '{invalid-json}' } });
    const res = mockRes();
    await ctrl.getAll(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('passes context with x-branch-id header', async () => {
    mockUserModel.userPage.mockResolvedValue({ status: true, data: { list: [] }, message: 'ok' });
    const req = mockReq({ headers: { 'x-branch-id': 'branchXYZ' } });
    const res = mockRes();
    await ctrl.getAll(req, res);
    expect(mockUserModel.userPage).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({ currentBranch: 'branchXYZ' })
    );
  });

  test('scopes users to the currently selected branch and current license', async () => {
    mockUserModel.userPage.mockResolvedValue({ status: true, data: { list: [] }, message: 'ok' });
    const req = mockReq({
      headers: { 'x-branch-id': 'headerBranch' },
      session: {
        selectedBranchId: 'selectedBranch',
        branch_id: 'loginBranch',
        destroy: jest.fn(),
      },
    });
    const res = mockRes();

    await ctrl.getAll(req, res);

    expect(mockUserModel.userPage).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      expect.objectContaining({
        currentBranch: 'selectedBranch',
        license: 'bbbbbbbbbbbbbbbbbbbbbbbb',
      })
    );
  });

  test('500 on exception', async () => {
    mockUserModel.userPage.mockRejectedValue(new Error('DB error'));
    const res = mockRes();
    await ctrl.getAll(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getOne
// ═══════════════════════════════════════════════════════════════════════════════
describe('getOne', () => {
  const lean = (v) => ({ lean: jest.fn().mockResolvedValue(v) });

  test('400 when no id provided', async () => {
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: {}, query: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('400 when id is not valid 24-char hex', async () => {
    const res = mockRes();
    await ctrl.getOne(mockReq({ params: { id: 'invalid-id' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('403 when no read permission', async () => {
    const req = mockReq({
      params: { id: 'aabbccddeeff001122334455' },
      user: { usertype: 'user', access: { user: { read: false } } },
    });
    const res = mockRes();
    await ctrl.getOne(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('404 when user not found', async () => {
    mockUserModel.findById.mockReturnValue(lean(null));
    const req = mockReq({ params: { id: 'aabbccddeeff001122334455' } });
    const res = mockRes();
    await ctrl.getOne(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('200 with user data and defaults applied', async () => {
    const user = { _id: 'aabbccddeeff001122334455', name: 'Test' };
    mockUserModel.findById.mockReturnValue(lean(user));
    const req = mockReq({ params: { id: 'aabbccddeeff001122334455' } });
    const res = mockRes();
    await ctrl.getOne(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  test('500 on exception', async () => {
    mockUserModel.findById.mockReturnValue({
      lean: jest.fn().mockRejectedValue(new Error('DB error')),
    });
    const req = mockReq({ params: { id: 'aabbccddeeff001122334455' } });
    const res = mockRes();
    await ctrl.getOne(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// edit
// ═══════════════════════════════════════════════════════════════════════════════
describe('edit', () => {
  test('400 when no id provided', async () => {
    const res = mockRes();
    await ctrl.edit(mockReq({ params: {}, query: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('delegates to add with edit=true and id', async () => {
    mockUserModel.userInsertUpdate.mockResolvedValue({
      status: true,
      data: {},
      message: 'Updated',
    });
    const req = mockReq({ params: { id: 'u1' } });
    const res = mockRes();
    await ctrl.edit(req, res);
    expect(mockUserModel.userInsertUpdate).toHaveBeenCalledWith(
      expect.any(Object),
      'u1',
      expect.any(Object)
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// updatePassword
// ═══════════════════════════════════════════════════════════════════════════════
describe('updatePassword', () => {
  const fakeUser = { _id: 'u1', password: 'hashed', save: jest.fn().mockResolvedValue(true) };

  const buildFindByIdChain = (user) => {
    const c = { select: jest.fn().mockResolvedValue(user) };
    return c;
  };

  test('403 when current password is incorrect', async () => {
    mockUserModel.findById.mockReturnValue(buildFindByIdChain(fakeUser));
    mockBcrypt.compare.mockResolvedValue(false);
    const req = mockReq({
      body: { currentPassword: 'wrong', newPassword: 'new123', newPasswordConfirm: 'new123' },
    });
    const res = mockRes();
    await ctrl.updatePassword(req, res);
    // 403, not 401: the session itself is valid - a mistyped current password
    // must not sign the user out (the client signs out on any 401).
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('400 when new passwords do not match', async () => {
    mockUserModel.findById.mockReturnValue(buildFindByIdChain(fakeUser));
    mockBcrypt.compare.mockResolvedValue(true);
    const req = mockReq({
      body: { currentPassword: 'current', newPassword: 'new1', newPasswordConfirm: 'new2' },
    });
    const res = mockRes();
    await ctrl.updatePassword(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('calls createSendToken on success', async () => {
    const userWithSave = { ...fakeUser, save: jest.fn().mockResolvedValue(true) };
    mockUserModel.findById.mockReturnValue(buildFindByIdChain(userWithSave));
    mockBcrypt.compare.mockResolvedValue(true);
    const req = mockReq({
      body: { currentPassword: 'current', newPassword: 'same', newPasswordConfirm: 'same' },
    });
    const res = mockRes();
    await ctrl.updatePassword(req, res);
    expect(userWithSave.save).toHaveBeenCalled();
    expect(mockCreateSendToken).toHaveBeenCalledWith(userWithSave, 200, res);
  });

  test('500 on exception', async () => {
    mockUserModel.findById.mockReturnValue({
      select: jest.fn().mockRejectedValue(new Error('DB err')),
    });
    const req = mockReq({
      body: { currentPassword: 'x', newPassword: 'y', newPasswordConfirm: 'y' },
    });
    const res = mockRes();
    await ctrl.updatePassword(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// delete
// ═══════════════════════════════════════════════════════════════════════════════
describe('delete', () => {
  const BaseModel = require('../../../src/models/base.model');

  test('400 when no ids provided', async () => {
    const res = mockRes();
    await ctrl.delete(mockReq({ params: {}, body: {}, query: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('403 when user lacks delete permission', async () => {
    const req = mockReq({
      params: { id: 'uid1' },
      user: { _id: 'admin', usertype: 'user', license: 'l1', access: { user: { delete: false } } },
    });
    const res = mockRes();
    await ctrl.delete(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('400 when trying to delete own account', async () => {
    const userId = 'aabbccddeeff001122334455';
    const req = mockReq({
      params: { id: userId },
      user: { _id: userId, usertype: 'admin', license: 'l1', access: { user: { delete: true } } },
    });
    mockUserModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    const res = mockRes();
    await ctrl.delete(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'You cannot delete your own account' })
    );
  });

  test('200 when delete succeeds', async () => {
    const userId = 'aabbccddeeff001122334455';
    const targetId = 'ffffffffffffffffffffffff';
    const req = mockReq({
      params: { id: targetId },
      user: { _id: userId, usertype: 'admin', license: 'l1', access: { user: { delete: true } } },
    });
    mockUserModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: targetId }]) });
    mockUserModel.deleteMany.mockResolvedValue({ deletedCount: 1 });
    BaseModel.deletedDocumentBackup.mockResolvedValue(true);
    mockBaseModelInstance.changeLog.mockResolvedValue(true);
    const res = mockRes();
    await ctrl.delete(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'User deleted successfully' })
    );
  });

  test('404 when deleteMany returns 0 deleted', async () => {
    const targetId = 'ffffffffffffffffffffffff';
    const req = mockReq({
      params: { id: targetId },
      user: {
        _id: 'aabbccddeeff001122334455',
        usertype: 'admin',
        license: 'l1',
        access: { user: { delete: true } },
      },
    });
    mockUserModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
    mockUserModel.deleteMany.mockResolvedValue({ deletedCount: 0 });
    BaseModel.deletedDocumentBackup.mockResolvedValue(true);
    const res = mockRes();
    await ctrl.delete(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('accepts body.data array of ids', async () => {
    const targetId = 'ffffffffffffffffffffffff';
    const userId = 'aabbccddeeff001122334455';
    const req = mockReq({
      body: { data: [targetId] },
      user: { _id: userId, usertype: 'admin', license: 'l1', access: { user: { delete: true } } },
    });
    mockUserModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: targetId }]) });
    mockUserModel.deleteMany.mockResolvedValue({ deletedCount: 1 });
    BaseModel.deletedDocumentBackup.mockResolvedValue(true);
    mockBaseModelInstance.changeLog.mockResolvedValue(true);
    const res = mockRes();
    await ctrl.delete(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// userstatusReportTable
// ═══════════════════════════════════════════════════════════════════════════════
describe('userstatusReportTable', () => {
  const formatReportSpy = jest
    .spyOn(ctrl, 'formatReportResponse')
    .mockImplementation((res, result) => {
      res.status(200).json({ type: 'success', data: result });
    });

  afterAll(() => {
    formatReportSpy.mockRestore();
  });

  test('403 when user lacks report read permission', async () => {
    const req = mockReq({ user: { usertype: 'user', access: { report: { read: false } } } });
    const res = mockRes();
    await ctrl.userstatusReportTable(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('200 on success without dates', async () => {
    const report = { status: true, list: [], total: 0 };
    mockUserModel.userstatusReportPage.mockResolvedValue(report);
    const res = mockRes();
    await ctrl.userstatusReportTable(mockReq({ query: { limit: '5', page: '1' } }), res);
    expect(mockUserModel.userstatusReportPage).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('applies session filter when dates provided', async () => {
    mockSessionFilterUtil.applySessionFilter.mockResolvedValue({
      start_date: new Date('2024-01-01'),
      end_date: new Date('2024-01-31'),
    });
    mockUserModel.userstatusReportPage.mockResolvedValue({ status: true });
    const req = mockReq({ query: { starting_date: '2024-01-01', ending_date: '2024-01-31' } });
    const res = mockRes();
    await ctrl.userstatusReportTable(req, res);
    expect(mockSessionFilterUtil.applySessionFilter).toHaveBeenCalled();
  });

  test('500 on exception', async () => {
    mockUserModel.userstatusReportPage.mockRejectedValue(new Error('DB error'));
    const res = mockRes();
    await ctrl.userstatusReportTable(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getUserDetails
// ═══════════════════════════════════════════════════════════════════════════════
describe('getUserDetails', () => {
  const buildSelectChain = (user) => {
    const c = { select: jest.fn(), lean: jest.fn().mockResolvedValue(user) };
    c.select.mockReturnValue(c);
    return c;
  };

  test('400 when no id', async () => {
    const res = mockRes();
    await ctrl.getUserDetails(mockReq({ query: {}, params: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('400 when id is not valid hex', async () => {
    const res = mockRes();
    await ctrl.getUserDetails(mockReq({ query: { id: 'badid' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('404 when user not found', async () => {
    mockUserModel.findById.mockReturnValue(buildSelectChain(null));
    const res = mockRes();
    await ctrl.getUserDetails(mockReq({ query: { id: 'aabbccddeeff001122334455' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('200 returns user without sensitive fields', async () => {
    const user = {
      _id: 'aabbccddeeff001122334455',
      name: 'Test',
      registers: [],
      branch_access: [],
    };
    mockUserModel.findById.mockReturnValue(buildSelectChain(user));
    const res = mockRes();
    await ctrl.getUserDetails(mockReq({ query: { id: 'aabbccddeeff001122334455' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const [callArg] = res.json.mock.calls[0];
    expect(callArg.data).not.toHaveProperty('password');
    expect(callArg.data).not.toHaveProperty('license');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// exportUsers
// ═══════════════════════════════════════════════════════════════════════════════
describe('exportUsers', () => {
  test('403 when no read permission', async () => {
    const req = mockReq({ user: { usertype: 'user', access: { user: { read: false } } } });
    const res = mockRes();
    await ctrl.exportUsers(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('200 on success', async () => {
    mockUserModel.exportUserOrder.mockResolvedValue({ status: true, data: [], message: 'ok' });
    const res = mockRes();
    await ctrl.exportUsers(mockReq({ body: { ids: ['u1'] } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('404 when export returns false', async () => {
    mockUserModel.exportUserOrder.mockResolvedValue({ status: false, message: 'fail' });
    const res = mockRes();
    await ctrl.exportUsers(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('500 on exception', async () => {
    mockUserModel.exportUserOrder.mockRejectedValue(new Error('DB'));
    const res = mockRes();
    await ctrl.exportUsers(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// uploadUserImage
// ═══════════════════════════════════════════════════════════════════════════════
describe('uploadUserImage', () => {
  test('200 returns default image when no file uploaded', async () => {
    const req = mockReq({ file: null });
    const res = mockRes();
    await ctrl.uploadUserImage(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toBe('user.svg');
  });

  test('400 when invalid file extension', async () => {
    const req = mockReq({
      file: { originalname: 'virus.exe', size: 1000, path: '/tmp/virus.exe' },
    });
    const res = mockRes();
    await ctrl.uploadUserImage(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/valid images/i);
  });

  test('400 when file exceeds 5MB', async () => {
    const req = mockReq({
      file: { originalname: 'large.jpg', size: 6000000, path: '/tmp/large.jpg' },
    });
    const res = mockRes();
    await ctrl.uploadUserImage(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/5MB/);
  });

  test('200 on valid local image upload', async () => {
    const fs = require('fs');
    const origExistsSync = fs.existsSync;
    const origMkdirSync = fs.mkdirSync;
    const origRenameSync = fs.renameSync;

    fs.existsSync = jest.fn().mockReturnValue(true);
    fs.mkdirSync = jest.fn();
    fs.renameSync = jest.fn();

    const req = mockReq({
      file: { originalname: 'photo.jpg', size: 100000, path: '/tmp/photo.jpg' },
    });
    process.env.STORAGE_TYPE = 'local';
    const res = mockRes();
    await ctrl.uploadUserImage(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].message).toBe('Image uploaded successfully');

    fs.existsSync = origExistsSync;
    fs.mkdirSync = origMkdirSync;
    fs.renameSync = origRenameSync;
    delete process.env.STORAGE_TYPE;
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// userImageDelete
// ═══════════════════════════════════════════════════════════════════════════════
describe('userImageDelete', () => {
  test('200 when imageUrl is empty (idempotent)', async () => {
    const req = mockReq({ body: { data: '', id: 'u1' } });
    const res = mockRes();
    await ctrl.userImageDelete(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toBe('user.svg');
  });

  test('200 when imageUrl is default user.svg', async () => {
    const req = mockReq({ body: { data: 'user.svg', id: 'u1' } });
    const res = mockRes();
    await ctrl.userImageDelete(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('200 and updates user record when valid imageUrl and userId', async () => {
    mockUserModel.findByIdAndUpdate.mockResolvedValue(true);
    const req = mockReq({ body: { data: 'http://localhost/uploads/img.jpg', id: 'u1' } });
    const res = mockRes();
    await ctrl.userImageDelete(req, res);
    expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith('u1', { image: 'user.svg' });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('200 and uses req.user when no userId in body', async () => {
    mockUserModel.findByIdAndUpdate.mockResolvedValue(true);
    const req = mockReq({
      body: { data: 'http://localhost/uploads/img.jpg', id: '' },
      user: { _id: 'reqUser1' },
    });
    const res = mockRes();
    await ctrl.userImageDelete(req, res);
    expect(mockUserModel.findByIdAndUpdate).toHaveBeenCalledWith('reqUser1', { image: 'user.svg' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// updatePrintSetting
// ═══════════════════════════════════════════════════════════════════════════════
describe('updatePrintSetting', () => {
  test('404 when user not found', async () => {
    const chain = { select: jest.fn().mockResolvedValue(null) };
    mockUserModel.findByIdAndUpdate.mockReturnValue(chain);
    const req = mockReq({ body: { print_size: 'A4' } });
    const res = mockRes();
    await ctrl.updatePrintSetting(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('200 when settings updated', async () => {
    const chain = { select: jest.fn().mockResolvedValue({ print_settings: { size: 'A4' } }) };
    mockUserModel.findByIdAndUpdate.mockReturnValue(chain);
    const req = mockReq({ body: { size: 'A4' } });
    const res = mockRes();
    await ctrl.updatePrintSetting(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].message).toBe('Print settings updated successfully');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// printType
// ═══════════════════════════════════════════════════════════════════════════════
describe('printType', () => {
  test('200 with static list of print types', async () => {
    const res = mockRes();
    await ctrl.printType(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    const data = res.json.mock.calls[0][0].data;
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]).toHaveProperty('id');
    expect(data[0]).toHaveProperty('name');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// userProfile
// ═══════════════════════════════════════════════════════════════════════════════
describe('userProfile', () => {
  test('401 when no user', async () => {
    const res = mockRes();
    await ctrl.userProfile(mockReq({ user: undefined }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('200 updates firstname, lastname and image', async () => {
    mockUserModel.findByIdAndUpdate.mockResolvedValue({ _id: 'u1' });
    const req = mockReq({ body: { image: 'img.jpg', name: 'John', lastname: 'Doe' } });
    const res = mockRes();
    await ctrl.userProfile(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0]).toMatchObject({
      type: 'success',
      message: 'User details update successfully',
      data: { imagename: 'img.jpg', firstname: 'John', lastname: 'Doe' },
    });
  });

  test('500 on exception', async () => {
    mockUserModel.findByIdAndUpdate.mockRejectedValue(new Error('DB'));
    const req = mockReq({ body: { name: 'John' } });
    const res = mockRes();
    await ctrl.userProfile(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// changeBranch
// ═══════════════════════════════════════════════════════════════════════════════
describe('changeBranch', () => {
  test('400 when branch_no is missing', async () => {
    const res = mockRes();
    await ctrl.changeBranch(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('200 and sets session on success', async () => {
    const save = jest.fn((callback) => callback());
    mockUsersService.changeBranch.mockResolvedValue({
      status: true,
      data: { branch_id: 'b2', branch_name: 'Branch Two', license: 'lic2' },
    });
    const req = mockReq({
      body: { branch_no: 'b2' },
      session: { destroy: jest.fn(), save },
      user: { ...mockReq().user, branch_access: [{ branch_id: 'b2' }] },
    });
    const res = mockRes();
    await ctrl.changeBranch(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(req.session.selectedBranchId).toBe('b2');
    expect(req.session.branch_id).toBe('b2');
    expect(req.session.branch_name).toBe('Branch Two');
    expect(req.session.license).toBe('lic2');
    expect(req.tenantContext.branchId.toString()).toBe('b2');
    expect(req.tenantContext.branchName).toBe('Branch Two');
    expect(req.tenantContext.licenseId.toString()).toBe('lic2');
    expect(req.user.branch_id.toString()).toBe('b2');
    expect(save).toHaveBeenCalledTimes(1);
  });

  test('does not return success when the updated branch session cannot be saved', async () => {
    mockUsersService.changeBranch.mockResolvedValue({
      status: true,
      data: { branch_id: 'b2', branch_name: 'Branch Two', license: 'lic2' },
    });
    const req = mockReq({
      body: { branch_no: 'b2' },
      session: { save: jest.fn((callback) => callback(new Error('session store failed'))) },
      user: { ...mockReq().user, branch_access: [{ branch_id: 'b2' }] },
    });
    const res = mockRes();

    await ctrl.changeBranch(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.status).not.toHaveBeenCalledWith(200);
  });

  test('404 when service returns failure', async () => {
    mockUsersService.changeBranch.mockResolvedValue({ status: false, message: 'Branch not found' });
    const req = mockReq({
      body: { branch_no: 'b2' },
      user: { ...mockReq().user, branch_access: [{ branch_id: 'b2' }] },
    });
    const res = mockRes();
    await ctrl.changeBranch(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('403 when user tries to switch to a branch outside their access', async () => {
    const req = mockReq({ body: { branch_no: 'b2' } });
    const res = mockRes();
    await ctrl.changeBranch(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockUsersService.changeBranch).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// userVerify
// ═══════════════════════════════════════════════════════════════════════════════
describe('userVerify', () => {
  const buildSelectLean = (user) => {
    const c = { select: jest.fn(), lean: jest.fn().mockResolvedValue(user) };
    c.select.mockReturnValue(c);
    return c;
  };

  test('401 when no user in request', async () => {
    const res = mockRes();
    await ctrl.userVerify(mockReq({ user: undefined }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('400 when password too short (<5)', async () => {
    const res = mockRes();
    await ctrl.userVerify(mockReq({ query: { password: 'abc' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('400 when password too long (>20)', async () => {
    const res = mockRes();
    await ctrl.userVerify(mockReq({ query: { password: 'a'.repeat(21) } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('404 when user not found in DB', async () => {
    mockUserModel.findById.mockReturnValue(buildSelectLean(null));
    const res = mockRes();
    await ctrl.userVerify(mockReq({ query: { password: 'valid123' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('403 when user has no plan read access', async () => {
    const user = {
      _id: 'u1',
      password: 'hashed',
      usertype: 'admin',
      access: { plan: { read: false } },
    };
    mockUserModel.findById.mockReturnValue(buildSelectLean(user));
    const res = mockRes();
    await ctrl.userVerify(mockReq({ query: { password: 'valid123' } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('200 when super_admin with valid password', async () => {
    const user = {
      _id: 'u1',
      password: 'hashed',
      usertype: 'super_admin',
      access: { plan: { read: true } },
    };
    mockUserModel.findById.mockReturnValue(buildSelectLean(user));
    mockBcrypt.compare.mockResolvedValue(true);
    const res = mockRes();
    await ctrl.userVerify(mockReq({ query: { password: 'correct12' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Valid Admin' }));
  });

  test('404 when password is invalid', async () => {
    const user = {
      _id: 'u1',
      password: 'hashed',
      usertype: 'super_admin',
      access: { plan: { read: true } },
    };
    mockUserModel.findById.mockReturnValue(buildSelectLean(user));
    mockBcrypt.compare.mockResolvedValue(false);
    const res = mockRes();
    await ctrl.userVerify(mockReq({ query: { password: 'wrong123' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// updateNewPassword
// ═══════════════════════════════════════════════════════════════════════════════
describe('updateNewPassword', () => {
  const buildFindOneChain = (user) => {
    const c = { select: jest.fn(), lean: jest.fn().mockResolvedValue(user) };
    c.select.mockReturnValue(c);
    return c;
  };

  test('400 when forgot_key_value missing', async () => {
    const res = mockRes();
    await ctrl.updateNewPassword(mockReq({ body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('400 when passwords missing', async () => {
    const res = mockRes();
    await ctrl.updateNewPassword(mockReq({ body: { forgot_key_value: 'key123' } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('400 when passwords do not match', async () => {
    const req = mockReq({
      body: { forgot_key_value: 'key', update_new_password: 'abc', retype_new_password: 'xyz' },
    });
    const res = mockRes();
    await ctrl.updateNewPassword(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe('Password mismatch');
  });

  test('200 exist when key already used', async () => {
    mockUserModel.findOne.mockReturnValue(buildFindOneChain({ userkey: 'different-key' }));
    const req = mockReq({
      body: {
        forgot_key_value: 'key123',
        update_new_password: 'pass',
        retype_new_password: 'pass',
      },
    });
    const res = mockRes();
    await ctrl.updateNewPassword(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('exist');
  });

  test('200 success when key matches', async () => {
    const key = 'validkey123';
    mockUserModel.findOne.mockReturnValue(buildFindOneChain({ userkey: key }));
    mockBcrypt.hash.mockResolvedValue('newhashed');
    mockUserModel.updateOne.mockResolvedValue({ modifiedCount: 1 });
    const req = mockReq({
      body: {
        forgot_key_value: key,
        update_new_password: 'newpass',
        retype_new_password: 'newpass',
      },
    });
    const res = mockRes();
    await ctrl.updateNewPassword(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
    expect(mockBcrypt.hash).toHaveBeenCalled();
    expect(mockUserModel.updateOne).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getUserKeyDetails
// ═══════════════════════════════════════════════════════════════════════════════
describe('getUserKeyDetails', () => {
  const buildFindOneChain = (user) => {
    const c = { select: jest.fn(), lean: jest.fn().mockResolvedValue(user) };
    c.select.mockReturnValue(c);
    return c;
  };

  test('400 when user_key missing', async () => {
    const res = mockRes();
    await ctrl.getUserKeyDetails(mockReq({ query: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('200 error type when no user found', async () => {
    mockUserModel.findOne.mockReturnValue(buildFindOneChain(null));
    const res = mockRes();
    await ctrl.getUserKeyDetails(mockReq({ query: { user_key: 'key123' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('error');
  });

  test('200 error when key mismatch', async () => {
    mockUserModel.findOne.mockReturnValue(buildFindOneChain({ userkey: 'other-key' }));
    const res = mockRes();
    await ctrl.getUserKeyDetails(mockReq({ query: { user_key: 'key123' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('error');
  });

  test('200 error when key is expired', async () => {
    const pastDate = new Date(Date.now() - 1000 * 60 * 60); // 1 hour ago
    mockUserModel.findOne.mockReturnValue(
      buildFindOneChain({ userkey: 'key123', expire_date: pastDate })
    );
    const res = mockRes();
    await ctrl.getUserKeyDetails(mockReq({ query: { user_key: 'key123' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('error');
    expect(res.json.mock.calls[0][0].message).toMatch(/expired/i);
  });

  test('200 success when key is valid and not expired', async () => {
    const futureDate = new Date(Date.now() + 1000 * 60 * 60); // 1 hour ahead
    mockUserModel.findOne.mockReturnValue(
      buildFindOneChain({ userkey: 'key123', expire_date: futureDate })
    );
    const res = mockRes();
    await ctrl.getUserKeyDetails(mockReq({ query: { user_key: 'key123' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
    expect(res.json.mock.calls[0][0].data).toBe('key123');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ssoAuth
// ═══════════════════════════════════════════════════════════════════════════════
describe('ssoAuth', () => {
  const fakeUser = {
    _id: 'u1',
    email: 'sso@test.com',
    license: 'lic1',
    branch_access: [{ branch_id: 'bid1' }],
    usertype: 'admin',
    firstname: 'SSO',
    lastname: 'User',
    username: 'ssouser',
    image: 'user.svg',
    register_status: 'Closed',
    printing_design: 'standard',
    access: { plan: { read: true } },
    plan: { name: 'pro' },
  };

  const fakeBranch = {
    branch_name: 'SSO Branch',
    logo: 'store.png',
    store_telephone: '123',
    store_email: 'b@b.com',
    store_address: 'Addr',
    time_zone: 'UTC',
    time_format: 'enable',
    currency_type: 'USD',
  };

  test('400 when token missing', async () => {
    const res = mockRes();
    await ctrl.ssoAuth(mockReq({ query: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('404 when SSO record not found', async () => {
    mockSsoColl.findOne.mockResolvedValue(null);
    const res = mockRes();
    await ctrl.ssoAuth(mockReq({ query: { token: 'tok1' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('404 when SSO record is expired', async () => {
    mockSsoColl.findOne.mockResolvedValue({
      token: 'tok1',
      status: 'active',
      expire_date: new Date(Date.now() - 10000),
    });
    const res = mockRes();
    await ctrl.ssoAuth(mockReq({ query: { token: 'tok1' } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('200 on valid SSO login', async () => {
    const ssoRecord = {
      token: 'tok1',
      status: 'active',
      email: 'sso@test.com',
      license: 'lic1',
      expire_date: new Date(Date.now() + 60000),
    };
    mockSsoColl.findOne.mockResolvedValue(ssoRecord);
    mockSsoColl.updateOne.mockResolvedValue({});

    const userChain = {
      select: jest.fn(),
      lean: jest.fn().mockResolvedValue(fakeUser),
    };
    userChain.select.mockReturnValue(userChain);
    mockUserModel.findOne.mockReturnValue(userChain);

    const branchChain = { lean: jest.fn().mockResolvedValue(fakeBranch) };
    mockBranchModel.findOne.mockReturnValue(branchChain);

    process.env.JWT_SECRET = 'test-secret';
    process.env.JWT_EXPIRES_IN = '7d';

    const res = mockRes();
    await ctrl.ssoAuth(mockReq({ query: { token: 'tok1' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
    expect(res.json.mock.calls[0][0].data).toHaveProperty('jwt_token');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ssoToken
// ═══════════════════════════════════════════════════════════════════════════════
describe('ssoToken', () => {
  beforeEach(() => {
    process.env.POSNIC_KEY = 'mykey';
    process.env.POSNIC_SECRET = 'mysecret';
  });

  afterAll(() => {
    delete process.env.POSNIC_KEY;
    delete process.env.POSNIC_SECRET;
  });

  test('401 when posnickey/posnicsecret invalid', async () => {
    const req = mockReq({ headers: { posnickey: 'wrong', posnicsecret: 'wrong' } });
    const res = mockRes();
    await ctrl.ssoToken(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('400 when email missing', async () => {
    const req = mockReq({
      headers: { posnickey: 'mykey', posnicsecret: 'mysecret' },
      body: {},
    });
    const res = mockRes();
    await ctrl.ssoToken(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('404 when user not found', async () => {
    const userQuery = {
      select: jest.fn(),
      lean: jest.fn().mockResolvedValue(null),
    };
    userQuery.select.mockReturnValue(userQuery);
    mockUserModel.findOne.mockReturnValue(userQuery);
    const req = mockReq({
      headers: { posnickey: 'mykey', posnicsecret: 'mysecret' },
      body: { email: 'notfound@test.com' },
    });
    const res = mockRes();
    await ctrl.ssoToken(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('200 creates SSO token when user found', async () => {
    const userQuery = {
      select: jest.fn(),
      lean: jest.fn().mockResolvedValue({ _id: 'u1', license: 'lic1' }),
    };
    userQuery.select.mockReturnValue(userQuery);
    mockUserModel.findOne.mockReturnValue(userQuery);
    mockSsoColl.insertOne.mockResolvedValue({});
    const req = mockReq({
      headers: { posnickey: 'mykey', posnicsecret: 'mysecret' },
      body: { email: 'user@test.com', id: 'u1' },
    });
    const res = mockRes();
    await ctrl.ssoToken(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toHaveProperty('token');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ssoClientLogin
// ═══════════════════════════════════════════════════════════════════════════════
describe('ssoClientLogin', () => {
  const axios = require('axios');

  test('401 when no user in request', async () => {
    const res = mockRes();
    await ctrl.ssoClientLogin(mockReq({ user: undefined }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('404 when user not found in DB', async () => {
    mockUserModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    const res = mockRes();
    await ctrl.ssoClientLogin(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('200 with sso path when token returned', async () => {
    mockUserModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: 'u1', email: 'a@b.com' }),
    });
    axios.post.mockResolvedValue({ data: { data: { token: 'sso-tok' } } });
    const res = mockRes();
    await ctrl.ssoClientLogin(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
    expect(res.json.mock.calls[0][0].data).toMatch(/sso-tok/);
  });

  test('200 error type when no token in SSO response', async () => {
    mockUserModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: 'u1', email: 'a@b.com' }),
    });
    axios.post.mockResolvedValue({ data: {} });
    const res = mockRes();
    await ctrl.ssoClientLogin(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('error');
    expect(res.json.mock.calls[0][0].message).toBe('not valid');
  });

  test('200 error type on axios failure', async () => {
    mockUserModel.findById.mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: 'u1', email: 'a@b.com' }),
    });
    axios.post.mockRejectedValue(new Error('Network error'));
    const res = mockRes();
    await ctrl.ssoClientLogin(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('error');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// planUpdate
// ═══════════════════════════════════════════════════════════════════════════════
describe('planUpdate', () => {
  beforeEach(() => {
    process.env.POSNIC_KEY = 'mykey';
    process.env.POSNIC_SECRET = 'mysecret';
  });

  test('401 when posnic keys invalid', async () => {
    const req = mockReq({ headers: { posnickey: 'bad', posnicsecret: 'bad' }, body: {} });
    const res = mockRes();
    await ctrl.planUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('400 when license or email missing', async () => {
    const req = mockReq({ headers: { posnickey: 'mykey', posnicsecret: 'mysecret' }, body: {} });
    const res = mockRes();
    await ctrl.planUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test('200 on successful plan update', async () => {
    mockUserModel.updateOne.mockResolvedValue({ modifiedCount: 1 });
    const req = mockReq({
      headers: { posnickey: 'mykey', posnicsecret: 'mysecret' },
      body: {
        license: 'lic1',
        email: 'user@test.com',
        name: 'Pro',
        max_sales: 500,
        plan_expire: '2025-12-31',
        timezone: 'UTC',
        access: 'true',
        plan_access: '{"reports":true}',
      },
    });
    const res = mockRes();
    await ctrl.planUpdate(req, res);
    expect(mockUserModel.updateOne).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].message).toBe('Successfully updated');
  });

  test('500 on exception', async () => {
    mockUserModel.updateOne.mockRejectedValue(new Error('DB'));
    const req = mockReq({
      headers: { posnickey: 'mykey', posnicsecret: 'mysecret' },
      body: { license: 'l1', email: 'a@b.com', plan_access: '{}', plan_expire: '2025-01-01' },
    });
    const res = mockRes();
    await ctrl.planUpdate(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// mobileLogin
// ═══════════════════════════════════════════════════════════════════════════════
describe('mobileLogin', () => {
  const buildUserChain = (user) => {
    const c = { select: jest.fn(), lean: jest.fn().mockResolvedValue(user) };
    c.select.mockReturnValue(c);
    return c;
  };

  test('200 on successful login with correct credentials', async () => {
    const user = {
      _id: 'u1',
      username: 'testuser',
      email: 'test@test.com',
      activate: true,
      password: 'hashed',
      branch_access: [{ branch_id: 'b1' }],
    };
    mockLoginCheckColl.findOne.mockResolvedValue(null);
    mockLoginCheckColl.insertOne.mockResolvedValue({ insertedId: 'sid' });
    mockUserModel.findOne.mockReturnValue(buildUserChain(user));
    mockBcrypt.compare.mockResolvedValue(true);
    const req = mockReq({ body: { username: 'testuser', password: 'pass' }, ip: '127.0.0.1' });
    const res = mockRes();
    await ctrl.mobileLogin(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].type).toBe('success');
    expect(res.json.mock.calls[0][0].data).toEqual(user.branch_access);
  });

  test('404 on incorrect credentials', async () => {
    mockLoginCheckColl.findOne.mockResolvedValue({
      ip_address: '127.0.0.1',
      banned: 0,
      login_count: 0,
    });
    mockUserModel.findOne.mockReturnValue(buildUserChain(null));
    mockBcrypt.compare.mockResolvedValue(false);
    const req = mockReq({ body: { username: 'bad', password: 'bad' }, ip: '127.0.0.1' });
    const res = mockRes();
    await ctrl.mobileLogin(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('404 when login attempts >= 7 and not yet expired ban', async () => {
    const futureTime = Math.floor(Date.now() / 1000) + 3600;
    mockLoginCheckColl.findOne.mockResolvedValue({
      ip_address: '127.0.0.1',
      banned: futureTime,
      login_count: 7,
    });
    process.env.NODE_ENV = 'production';
    const req = mockReq({ body: { username: 'user', password: 'pass' }, ip: '127.0.0.1' });
    const res = mockRes();
    await ctrl.mobileLogin(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].data).toBe('incorrect');
    process.env.NODE_ENV = 'test';
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getDataChanges - note: controller references undefined `User` variable (bug)
// ═══════════════════════════════════════════════════════════════════════════════
describe('getDataChanges', () => {
  test('500 due to ReferenceError (User not defined in controller)', async () => {
    const res = mockRes();
    await ctrl.getDataChanges(mockReq({ query: { from: '2024-01-01' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getUserAjaxList - note: controller references undefined `User` variable (bug)
// ═══════════════════════════════════════════════════════════════════════════════
describe('getUserAjaxList', () => {
  test('200 with empty suggestions when query < 2 chars', async () => {
    const res = mockRes();
    await ctrl.getUserAjaxList(mockReq({ query: { query: 'a' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.suggestions).toHaveLength(0);
  });

  test('500 due to ReferenceError when query >= 2 chars (User not defined)', async () => {
    const res = mockRes();
    await ctrl.getUserAjaxList(mockReq({ query: { query: 'jo' } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
