/**
 * Unit tests for auth-utils.controller.js
 *
 * Functions covered:
 *   signToken, createSendToken, verifyToken,
 *   getTokenFromRequest, createAndSendToken
 *
 * Mocked dependencies:
 *   jsonwebtoken  (jwt.sign / jwt.verify)
 *   mongodb       (ObjectId — dynamic require inside createAndSendToken)
 *
 * Notes:
 *   - These are pure utility functions, NOT Express middleware.
 *     None of them take a `next` parameter (except indirectly).
 *   - createSendToken does NOT set a cookie.  createAndSendToken does.
 *   - createAndSendToken swallows session-creation errors so the HTTP
 *     response is always sent regardless.
 *   - process.env values (JWT_SECRET, etc.) are set in beforeAll so they
 *     are available when each function is called.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'mock.jwt.token'),
  verify: jest.fn(),
}));

jest.mock('mongodb', () => ({
  ObjectId: jest.fn((id) => ({ id, toString: () => String(id) })),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

const jwt = require('jsonwebtoken');
const {
  signToken,
  createSendToken,
  verifyToken,
  getTokenFromRequest,
  createAndSendToken,
} = require('../../../src/controllers/auth-utils.controller');

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_ID = '64f8f2f4c2b9c0a1e4b12345';
const VALID_LICENSE_ID = '64f8f2f4c2b9c0a1e4baaaaa';
const MOCK_TOKEN = 'mock.jwt.token';
const TEST_SECRET = 'test-jwt-secret-key';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.send = jest.fn().mockReturnValue(res);
  res.cookie = jest.fn().mockReturnValue(res);
  res.clearCookie = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn().mockReturnValue(res);
  return res;
};

const mockReq = (overrides = {}) => ({
  headers: {},
  cookies: {},
  ip: '127.0.0.1',
  sessionID: 'session_test_123',
  session: {},
  db: null,
  app: { locals: {} },
  ...overrides,
});

const baseUser = (overrides = {}) => ({
  _id: VALID_ID,
  email: 'user@example.com',
  firstname: 'John',
  lastname: 'Doe',
  role: 'admin',
  image: 'avatar.jpg',
  register_status: 'Open',
  branch_image: 'branch.jpg',
  branch_name: 'Main Branch',
  branch_phone: '1234567890',
  branch_email: 'branch@example.com',
  branch_address: '123 Main St',
  branch_timezone: 'Asia/Kolkata',
  branch_timeformat: '12h',
  currency_type: 'INR',
  branch_access: [{ id: 'b1' }, { id: 'b2' }],
  default_branch_id: 'branch_001',
  printing_design: [{ printing_design: 'modern' }],
  plan: { name: 'premium' },
  license: VALID_LICENSE_ID,
  ...overrides,
});

const userWithSessionPermission = (overrides = {}) =>
  baseUser({
    access: { sales: { session_filter: true } },
    ...overrides,
  });

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(() => {
  process.env.JWT_SECRET = TEST_SECRET;
  process.env.JWT_EXPIRES_IN = '1h';
  process.env.JWT_COOKIE_EXPIRES_IN = '1';
  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = 'mongodb://localhost:27017/testdb';
  // Suppress the verbose debug console.logs in createAndSendToken
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

beforeEach(() => {
  jest.clearAllMocks();
  // Restore default jwt implementations after each clear
  jwt.sign.mockReturnValue(MOCK_TOKEN);
  jwt.verify.mockImplementation((token, secret, callback) => {
    callback(null, { id: VALID_ID, iat: Math.floor(Date.now() / 1000) });
  });
});

// =============================================================================
// signToken
// =============================================================================

describe('signToken', () => {
  test('returns the value produced by jwt.sign', () => {
    const token = signToken(VALID_ID);
    expect(token).toBe(MOCK_TOKEN);
  });

  test('calls jwt.sign with payload { id }', () => {
    signToken(VALID_ID);
    expect(jwt.sign).toHaveBeenCalledTimes(1);
    expect(jwt.sign).toHaveBeenCalledWith({ id: VALID_ID }, expect.any(String), expect.any(Object));
  });

  test('calls jwt.sign with JWT_SECRET from process.env', () => {
    signToken(VALID_ID);
    const [, secret] = jwt.sign.mock.calls[0];
    expect(secret).toBe(TEST_SECRET);
  });

  test('calls jwt.sign with expiresIn from JWT_EXPIRES_IN env var', () => {
    signToken(VALID_ID);
    const [, , options] = jwt.sign.mock.calls[0];
    expect(options.expiresIn).toBe('1h');
  });

  test('passes the id argument as-is into the payload', () => {
    const specificId = 'custom_user_999';
    signToken(specificId);
    const [payload] = jwt.sign.mock.calls[0];
    expect(payload.id).toBe(specificId);
  });

  test('does not include extra fields in the jwt payload', () => {
    signToken(VALID_ID);
    const [payload] = jwt.sign.mock.calls[0];
    expect(Object.keys(payload)).toEqual(['id']);
  });
});

// =============================================================================
// createSendToken
// =============================================================================

describe('createSendToken', () => {
  test('calls res.status with the provided statusCode', () => {
    const user = { _id: VALID_ID, name: 'Test' };
    const res = mockRes();

    createSendToken(user, 200, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('calls res.json with status:success, token, and data.user', () => {
    const user = { _id: VALID_ID, name: 'Test' };
    const res = mockRes();

    createSendToken(user, 200, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        token: MOCK_TOKEN,
        data: expect.objectContaining({ user }),
      })
    );
  });

  test('removes password from the user object before responding', () => {
    const user = { _id: VALID_ID, name: 'Test', password: 'secret123' };
    const res = mockRes();

    createSendToken(user, 200, res);

    expect(user.password).toBeUndefined();
    const [jsonArg] = res.json.mock.calls[0];
    expect(jsonArg.data.user.password).toBeUndefined();
  });

  test('works with status 201 for registration', () => {
    const user = { _id: VALID_ID };
    const res = mockRes();

    createSendToken(user, 201, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledTimes(1);
  });

  test('does NOT call res.cookie (cookie is not set by createSendToken)', () => {
    const user = { _id: VALID_ID };
    const res = mockRes();

    createSendToken(user, 200, res);

    expect(res.cookie).not.toHaveBeenCalled();
  });

  test('calls jwt.sign to generate the token', () => {
    const user = { _id: VALID_ID };
    const res = mockRes();

    createSendToken(user, 200, res);

    expect(jwt.sign).toHaveBeenCalledWith(
      { id: VALID_ID },
      TEST_SECRET,
      expect.objectContaining({ expiresIn: '1h' })
    );
  });
});

// =============================================================================
// verifyToken
// =============================================================================

describe('verifyToken', () => {
  test('resolves with decoded payload for a valid token', async () => {
    const decoded = { id: VALID_ID, iat: 1000000 };
    jwt.verify.mockImplementation((token, secret, cb) => cb(null, decoded));

    const result = await verifyToken(MOCK_TOKEN);

    expect(result).toEqual(decoded);
  });

  test('calls jwt.verify with the token and JWT_SECRET', async () => {
    await verifyToken(MOCK_TOKEN);

    expect(jwt.verify).toHaveBeenCalledWith(MOCK_TOKEN, TEST_SECRET, expect.any(Function));
  });

  test('rejects with JsonWebTokenError for an invalid token', async () => {
    const err = new Error('invalid signature');
    err.name = 'JsonWebTokenError';
    jwt.verify.mockImplementation((token, secret, cb) => cb(err));

    await expect(verifyToken('bad.token.here')).rejects.toMatchObject({
      name: 'JsonWebTokenError',
    });
  });

  test('rejects with TokenExpiredError for an expired token', async () => {
    const err = new Error('jwt expired');
    err.name = 'TokenExpiredError';
    err.expiredAt = new Date();
    jwt.verify.mockImplementation((token, secret, cb) => cb(err));

    await expect(verifyToken('expired.token')).rejects.toMatchObject({
      name: 'TokenExpiredError',
    });
  });

  test('uses JWT_SECRET from process.env at call time', async () => {
    const originalSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'different-secret';

    await verifyToken(MOCK_TOKEN);

    const [, secretArg] = jwt.verify.mock.calls[0];
    expect(secretArg).toBe('different-secret');

    process.env.JWT_SECRET = originalSecret;
  });
});

// =============================================================================
// getTokenFromRequest
// =============================================================================

describe('getTokenFromRequest', () => {
  test('extracts token from a valid Bearer Authorization header', () => {
    const req = mockReq({
      headers: { authorization: 'Bearer my.test.token' },
    });

    const token = getTokenFromRequest(req);

    expect(token).toBe('my.test.token');
  });

  test('extracts token from req.cookies.jwt when no Authorization header', () => {
    const req = mockReq({ cookies: { jwt: 'cookie.jwt.token' } });

    const token = getTokenFromRequest(req);

    expect(token).toBe('cookie.jwt.token');
  });

  test('returns undefined when no Authorization header and no cookie', () => {
    const req = mockReq();

    const token = getTokenFromRequest(req);

    expect(token).toBeUndefined();
  });

  test('returns undefined when Authorization header is present but does not start with Bearer', () => {
    const req = mockReq({
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });

    const token = getTokenFromRequest(req);

    expect(token).toBeUndefined();
  });

  test('returns undefined when Authorization header is an empty string', () => {
    const req = mockReq({ headers: { authorization: '' } });

    const token = getTokenFromRequest(req);

    expect(token).toBeUndefined();
  });

  test('prioritizes Authorization header over cookie when both are present', () => {
    const req = mockReq({
      headers: { authorization: 'Bearer header.token' },
      cookies: { jwt: 'cookie.token' },
    });

    const token = getTokenFromRequest(req);

    expect(token).toBe('header.token');
  });

  test('extracts the second space-delimited segment from the Bearer header', () => {
    const req = mockReq({
      headers: { authorization: 'Bearer segment.one.token' },
    });

    const token = getTokenFromRequest(req);

    expect(token).toBe('segment.one.token');
  });

  test('returns undefined when headers object is absent', () => {
    const req = { cookies: {}, headers: {} };

    const token = getTokenFromRequest(req);

    expect(token).toBeUndefined();
  });

  test('returns undefined when cookies object is absent and no header', () => {
    const req = { headers: {}, cookies: {} };

    const token = getTokenFromRequest(req);

    expect(token).toBeUndefined();
  });
});

// =============================================================================
// createAndSendToken — response and cookie
// =============================================================================

describe('createAndSendToken — response and cookie', () => {
  test("calls res.cookie with name 'jwt' and the generated token", async () => {
    const user = baseUser();
    const res = mockRes();
    const req = mockReq();

    await createAndSendToken(user, 200, res, req);

    expect(res.cookie).toHaveBeenCalledWith('jwt', MOCK_TOKEN, expect.any(Object));
  });

  test('responds with type:success and message Successfully logged in', async () => {
    const user = baseUser();
    const res = mockRes();
    const req = mockReq();

    await createAndSendToken(user, 200, res, req);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'success',
        message: 'Successfully logged in',
      })
    );
  });

  test('sends correct statusCode via res.status', async () => {
    const user = baseUser();
    const res = mockRes();

    await createAndSendToken(user, 201, res, mockReq());

    expect(res.status).toHaveBeenCalledWith(201);
  });

  test('response data contains mapped user fields (sid, usertype, user_name, etc.)', async () => {
    const user = baseUser();
    const res = mockRes();

    await createAndSendToken(user, 200, res, mockReq());

    const [jsonArg] = res.json.mock.calls[0];
    expect(jsonArg.data).toMatchObject({
      sid: VALID_ID,
      usertype: 'admin',
      firstname: 'John',
      lastname: 'Doe',
      user_name: 'user@example.com',
      user_image: 'avatar.jpg',
      register_status: 'Open',
      branch_name: 'Main Branch',
      branch_timezone: 'Asia/Kolkata',
      currency_type: 'INR',
      branchId: 'branch_001',
      plan: 'premium',
      userACLPlan: true,
    });
  });

  test('uses default values for optional user fields when missing', async () => {
    const minimalUser = { _id: VALID_ID, email: 'min@example.com' };
    const res = mockRes();

    await createAndSendToken(minimalUser, 200, res, mockReq());

    const [jsonArg] = res.json.mock.calls[0];
    expect(jsonArg.data).toMatchObject({
      usertype: 'user',
      firstname: '',
      lastname: '',
      user_image: '',
      register_status: 'Open',
      branch_image: '',
      branch_name: '',
      branch_phone: '',
      branch_email: '',
      branch_address: '',
      branch_timezone: 'UTC',
      branch_timeformat: '12h',
      currency_type: 'USD',
      branchId: '',
      plan: 'free',
      userACLPlan: true,
    });
  });

  test('branchCount is 0 when user.branch_access is undefined', async () => {
    const user = baseUser({ branch_access: undefined });
    const res = mockRes();

    await createAndSendToken(user, 200, res, mockReq());

    const [jsonArg] = res.json.mock.calls[0];
    expect(jsonArg.data.branchCount).toBe(0);
  });

  test('branchCount equals user.branch_access array length', async () => {
    const user = baseUser({ branch_access: [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }] });
    const res = mockRes();

    await createAndSendToken(user, 200, res, mockReq());

    const [jsonArg] = res.json.mock.calls[0];
    expect(jsonArg.data.branchCount).toBe(3);
  });

  test('plan is taken from user.plan.name', async () => {
    const user = baseUser({ plan: { name: 'enterprise' } });
    const res = mockRes();

    await createAndSendToken(user, 200, res, mockReq());

    const [jsonArg] = res.json.mock.calls[0];
    expect(jsonArg.data.plan).toBe('enterprise');
  });

  test("plan falls back to 'free' when user.plan is undefined", async () => {
    const user = baseUser({ plan: undefined });
    const res = mockRes();

    await createAndSendToken(user, 200, res, mockReq());

    const [jsonArg] = res.json.mock.calls[0];
    expect(jsonArg.data.plan).toBe('free');
  });

  test('userACLPlan is always true', async () => {
    const user = baseUser();
    const res = mockRes();

    await createAndSendToken(user, 200, res, mockReq());

    const [jsonArg] = res.json.mock.calls[0];
    expect(jsonArg.data.userACLPlan).toBe(true);
  });

  test('calls jwt.sign to generate the token for the cookie', async () => {
    const user = baseUser();
    const res = mockRes();

    await createAndSendToken(user, 200, res, mockReq());

    expect(jwt.sign).toHaveBeenCalledWith({ id: VALID_ID }, TEST_SECRET, expect.any(Object));
  });
});

// =============================================================================
// createAndSendToken — cookie security options
// =============================================================================

describe('createAndSendToken — cookie security options', () => {
  test('cookie options include httpOnly: true', async () => {
    const user = baseUser();
    const res = mockRes();

    await createAndSendToken(user, 200, res, mockReq());

    const [, , cookieOptions] = res.cookie.mock.calls[0];
    expect(cookieOptions.httpOnly).toBe(true);
  });

  test('cookie options include cross-site SameSite=None', async () => {
    const user = baseUser();
    const res = mockRes();

    await createAndSendToken(user, 200, res, mockReq());

    const [, , cookieOptions] = res.cookie.mock.calls[0];
    expect(cookieOptions.sameSite).toBe('none');
  });

  test('cookie secure is true when NODE_ENV is not production', async () => {
    process.env.NODE_ENV = 'test';
    const user = baseUser();
    const res = mockRes();

    await createAndSendToken(user, 200, res, mockReq());

    const [, , cookieOptions] = res.cookie.mock.calls[0];
    expect(cookieOptions.secure).toBe(true);
  });

  test('cookie secure is true when NODE_ENV is production', async () => {
    process.env.NODE_ENV = 'production';
    const user = baseUser();
    const res = mockRes();

    await createAndSendToken(user, 200, res, mockReq());

    const [, , cookieOptions] = res.cookie.mock.calls[0];
    expect(cookieOptions.secure).toBe(true);
    expect(cookieOptions.sameSite).toBe('none');

    process.env.NODE_ENV = 'test'; // restore
  });

  test('cookie has an expires Date based on JWT_COOKIE_EXPIRES_IN env var', async () => {
    const user = baseUser();
    const res = mockRes();

    await createAndSendToken(user, 200, res, mockReq());

    const [, , cookieOptions] = res.cookie.mock.calls[0];
    expect(cookieOptions.expires).toBeInstanceOf(Date);
    expect(cookieOptions.expires.getTime()).toBeGreaterThan(Date.now());
  });
});

// =============================================================================
// createAndSendToken — session creation skipped
// =============================================================================

describe('createAndSendToken — session creation skipped', () => {
  test('skips session creation when user has no access object', async () => {
    const user = baseUser({ access: undefined });
    const res = mockRes();
    const req = mockReq({ db: { collection: jest.fn() } });

    await createAndSendToken(user, 200, res, req);

    expect(req.db.collection).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('skips session creation when user.access.sales is missing', async () => {
    const user = baseUser({ access: {} });
    const res = mockRes();
    const req = mockReq({ db: { collection: jest.fn() } });

    await createAndSendToken(user, 200, res, req);

    expect(req.db.collection).not.toHaveBeenCalled();
  });

  test('skips session creation when session_filter permission is false', async () => {
    const user = baseUser({ access: { sales: { session_filter: false } } });
    const res = mockRes();
    const req = mockReq({ db: { collection: jest.fn() } });

    await createAndSendToken(user, 200, res, req);

    expect(req.db.collection).not.toHaveBeenCalled();
  });

  test('skips session creation when req.db is null and no mongoClient', async () => {
    const user = userWithSessionPermission();
    const res = mockRes();
    const req = mockReq({ db: null, app: { locals: {} } });

    await createAndSendToken(user, 200, res, req);

    // Response is still sent normally
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// createAndSendToken — session creation with req.db
// =============================================================================

describe('createAndSendToken — session creation with req.db', () => {
  let mockCollection;
  let mockDb;

  beforeEach(() => {
    mockCollection = {
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      findOne: jest.fn().mockResolvedValue(null),
      insertOne: jest.fn().mockResolvedValue({ insertedId: 'new_session_id' }),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    mockDb = { collection: jest.fn(() => mockCollection) };
  });

  test("calls db.collection('user_sessions')", async () => {
    const user = userWithSessionPermission();
    const res = mockRes();
    const req = mockReq({ db: mockDb });

    // Second findOne call (verify record) also returns null — safe
    mockCollection.findOne
      .mockResolvedValueOnce(null) // existingSession check
      .mockResolvedValueOnce(null); // verification

    await createAndSendToken(user, 200, res, req);

    expect(mockDb.collection).toHaveBeenCalledWith('user_sessions');
  });

  test('marks previous active sessions inactive via updateMany', async () => {
    const user = userWithSessionPermission();
    const res = mockRes();
    const req = mockReq({ db: mockDb });

    mockCollection.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    await createAndSendToken(user, 200, res, req);

    expect(mockCollection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ is_active: true }),
      expect.objectContaining({ $set: { is_active: false } })
    );
  });

  test('creates a new session via insertOne when no existing session is found', async () => {
    const user = userWithSessionPermission();
    const res = mockRes();
    const req = mockReq({ db: mockDb, sessionID: 'req_session_abc' });

    mockCollection.findOne
      .mockResolvedValueOnce(null) // no existing session
      .mockResolvedValueOnce({ _id: 'new_session_id' }); // verify

    await createAndSendToken(user, 200, res, req);

    expect(mockCollection.insertOne).toHaveBeenCalledTimes(1);
    expect(mockCollection.updateOne).not.toHaveBeenCalled();
  });

  test('stores new session ID in req.session.PosnicPro after insertOne', async () => {
    const user = userWithSessionPermission();
    const res = mockRes();
    const session = {};
    const req = mockReq({ db: mockDb, session });

    mockCollection.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ _id: 'new_session_id' });
    mockCollection.insertOne.mockResolvedValue({ insertedId: 'new_session_id' });

    await createAndSendToken(user, 200, res, req);

    expect(session.PosnicPro).toBeDefined();
    expect(session.PosnicPro.current_session_id).toBe('new_session_id');
  });

  test('reactivates an existing session via updateOne instead of insertOne', async () => {
    const existingSession = {
      _id: 'existing_session_id',
      login_time: new Date('2025-01-01'),
    };
    const user = userWithSessionPermission();
    const res = mockRes();
    const req = mockReq({ db: mockDb });

    mockCollection.findOne
      .mockResolvedValueOnce(existingSession) // existing session found
      .mockResolvedValueOnce(existingSession); // verification

    await createAndSendToken(user, 200, res, req);

    expect(mockCollection.updateOne).toHaveBeenCalledTimes(1);
    expect(mockCollection.insertOne).not.toHaveBeenCalled();
  });

  test('stores reactivated session ID in req.session.PosnicPro', async () => {
    const existingSession = {
      _id: 'reactivated_id',
      login_time: new Date('2025-06-01'),
    };
    const user = userWithSessionPermission();
    const res = mockRes();
    const session = {};
    const req = mockReq({ db: mockDb, session });

    mockCollection.findOne
      .mockResolvedValueOnce(existingSession)
      .mockResolvedValueOnce(existingSession);

    await createAndSendToken(user, 200, res, req);

    expect(session.PosnicPro.current_session_id).toBe('reactivated_id');
  });

  test('still sends HTTP response even when session creation throws', async () => {
    const user = userWithSessionPermission();
    const res = mockRes();
    const req = mockReq({ db: mockDb });

    mockCollection.updateMany.mockRejectedValue(new Error('DB write failed'));

    await createAndSendToken(user, 200, res, req);

    // Error is swallowed — response must still be sent
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  test('uses req.app.locals.mongoClient as db fallback when req.db is null', async () => {
    const user = userWithSessionPermission();
    const res = mockRes();
    const mongoClient = { db: jest.fn(() => mockDb) };
    const req = mockReq({
      db: null,
      app: { locals: { mongoClient } },
    });

    mockCollection.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    await createAndSendToken(user, 200, res, req);

    expect(mongoClient.db).toHaveBeenCalledWith('testdb');
    expect(mockDb.collection).toHaveBeenCalled();
  });
});

// =============================================================================
// createAndSendToken — session skipped when req.session is absent
// =============================================================================

describe('createAndSendToken — req.session handling', () => {
  test('does not throw when req.session is undefined during session update', async () => {
    const mockCol = {
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      findOne: jest.fn().mockResolvedValue(null),
      insertOne: jest.fn().mockResolvedValue({ insertedId: 'sid' }),
    };
    const db = { collection: jest.fn(() => mockCol) };
    const user = userWithSessionPermission();
    const res = mockRes();
    const req = mockReq({ db, session: undefined }); // no session object

    mockCol.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    await expect(createAndSendToken(user, 200, res, req)).resolves.not.toThrow();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
