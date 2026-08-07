/**
 * Unit tests for auth.controller.js
 *
 * Methods covered: register, login, protect, restrictTo, forgotPassword,
 *   resetPassword, updatePassword, getMe, getUser, getAllUsers,
 *   updateMe, deleteMe, updateUser, deleteUser, verifyToken
 *
 * All external dependencies mocked; no real DB/email/JWT connections used.
 *
 * Error handling: controller uses try/catch + next(err), NOT catchAsync.
 * Therefore NO microtask flush needed — next(err) is called synchronously
 * within the awaited async function.
 *
 * Note: forgotPassword calls user.createPasswordResetToken() as an instance
 * method, but it is only defined in middleware/auth.js as a standalone
 * function (not on the User schema). It is mocked on the mock user object.
 */

// ─── Mocks (before imports) ───────────────────────────────────────────────────

jest.mock('../../../src/models/user.model');
jest.mock('../../../src/utils/email', () => ({ Email: jest.fn() }));
jest.mock('../../../src/controllers/auth-utils.controller', () => ({
  createAndSendToken: jest.fn(),
}));
jest.mock('../../../src/utils/findUserByIdentifier', () => ({
  findUserByIdentifier: jest.fn(),
}));
jest.mock('jsonwebtoken', () => ({ sign: jest.fn(), verify: jest.fn() }));

// Dynamic require('./users.controller') inside verifyToken
jest.mock('../../../src/controllers/users.controller', () => ({
  legacyVerifyLogin: jest.fn(),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'error').mockImplementation(() => {});

const jwt = require('jsonwebtoken');
const User = require('../../../src/models/user.model');
const { Email } = require('../../../src/utils/email');
const { createAndSendToken } = require('../../../src/controllers/auth-utils.controller');
const usersController = require('../../../src/controllers/users.controller');
const authController = require('../../../src/controllers/auth.controller');

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_ID = '64f8f2f4c2b9c0a1e4b12345';
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
  res.locals = {};
  return res;
};

const mockNext = () => jest.fn();

const mockReq = (overrides = {}) => ({
  body: {},
  params: {},
  query: {},
  headers: {},
  cookies: {},
  user: { id: VALID_ID, role: 'admin' },
  protocol: 'http',
  get: jest.fn((h) => (h === 'host' ? 'localhost:3000' : null)),
  ...overrides,
});

const makeUser = (overrides = {}) => ({
  _id: VALID_ID,
  name: 'Test User',
  email: 'test@example.com',
  role: 'admin',
  active: true,
  correctPassword: jest.fn().mockResolvedValue(true),
  changedPasswordAfter: jest.fn().mockReturnValue(false),
  createPasswordResetToken: jest.fn().mockReturnValue('rawResetToken'),
  save: jest.fn().mockResolvedValue(true),
  ...overrides,
});

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(() => {
  process.env.JWT_SECRET = TEST_SECRET;
  process.env.NODE_ENV = 'test';
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => jest.restoreAllMocks());

beforeEach(() => {
  jest.clearAllMocks();
  jwt.verify.mockImplementation((token, secret, cb) => {
    cb(null, { id: VALID_ID, iat: Math.floor(Date.now() / 1000) - 100 });
  });
  Email.mockImplementation(() => ({
    sendWelcome: jest.fn().mockResolvedValue(undefined),
    sendPasswordReset: jest.fn().mockResolvedValue(undefined),
  }));
});

// =============================================================================
// register
// =============================================================================

describe('register', () => {
  test('creates user, sends welcome email, calls createAndSendToken with 201', async () => {
    const user = makeUser();
    User.create.mockResolvedValue(user);
    const req = mockReq({ body: { name: 'John', email: 'j@e.com', password: 'Pass123!' } });
    const res = mockRes();
    const next = mockNext();

    await authController.register(req, res, next);

    expect(User.create).toHaveBeenCalledTimes(1);
    expect(createAndSendToken).toHaveBeenCalledWith(user, 201, res, req);
    expect(next).not.toHaveBeenCalled();
  });

  test('calls next(err) when User.create throws', async () => {
    const dbErr = new Error('Duplicate key');
    User.create.mockRejectedValue(dbErr);
    const next = mockNext();

    await authController.register(mockReq(), mockRes(), next);

    expect(next).toHaveBeenCalledWith(dbErr);
  });

  test('calls next(err) when Email.sendWelcome throws', async () => {
    const user = makeUser();
    User.create.mockResolvedValue(user);
    const emailErr = new Error('SMTP failure');
    Email.mockImplementation(() => ({
      sendWelcome: jest.fn().mockRejectedValue(emailErr),
    }));
    const next = mockNext();

    await authController.register(mockReq(), mockRes(), next);

    expect(next).toHaveBeenCalledWith(emailErr);
  });

  test('password is NOT returned in the response body', async () => {
    const user = makeUser();
    User.create.mockResolvedValue(user);

    await authController.register(mockReq(), mockRes(), mockNext());

    const [userArg] = createAndSendToken.mock.calls[0];
    expect(userArg.password).toBeUndefined();
  });
});

// =============================================================================
// login
// =============================================================================

describe('login', () => {
  test('calls next(AppError 400) when email is missing', async () => {
    const next = mockNext();
    await authController.login(mockReq({ body: { password: 'Pass123!' } }), mockRes(), next);
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(400);
  });

  test('calls next(AppError 400) when password is missing', async () => {
    const next = mockNext();
    await authController.login(mockReq({ body: { email: 'a@b.com' } }), mockRes(), next);
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(400);
  });

  test('calls next(AppError 401) when user not found', async () => {
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
    const next = mockNext();
    await authController.login(
      mockReq({ body: { email: 'a@b.com', password: 'pw' } }),
      mockRes(),
      next
    );
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
  });

  test('calls next(AppError 401) when password is incorrect', async () => {
    const user = makeUser({ correctPassword: jest.fn().mockResolvedValue(false) });
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });
    const next = mockNext();
    await authController.login(
      mockReq({ body: { email: 'a@b.com', password: 'wrong' } }),
      mockRes(),
      next
    );
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
  });

  test('calls createAndSendToken with 200 on successful login', async () => {
    const user = makeUser();
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });
    const res = mockRes();
    const req = mockReq({ body: { email: user.email, password: 'correctPass' } });

    await authController.login(req, res, mockNext());

    expect(createAndSendToken).toHaveBeenCalledWith(user, 200, res, req);
  });

  test('calls next(err) when User.findOne throws', async () => {
    const dbErr = new Error('DB failure');
    User.findOne.mockReturnValue({ select: jest.fn().mockRejectedValue(dbErr) });
    const next = mockNext();
    await authController.login(
      mockReq({ body: { email: 'a@b.com', password: 'pw' } }),
      mockRes(),
      next
    );
    expect(next).toHaveBeenCalledWith(dbErr);
  });

  test('does not call createAndSendToken when credentials are wrong', async () => {
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });
    await authController.login(
      mockReq({ body: { email: 'a@b.com', password: 'pw' } }),
      mockRes(),
      mockNext()
    );
    expect(createAndSendToken).not.toHaveBeenCalled();
  });
});

// =============================================================================
// protect
// =============================================================================

describe('protect', () => {
  test('calls next(AppError 401) when no token is provided', async () => {
    const next = mockNext();
    await authController.protect(mockReq({ headers: {}, cookies: {} }), mockRes(), next);
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
  });

  test('extracts token from Authorization Bearer header', async () => {
    const user = makeUser();
    User.findById.mockResolvedValue(user);
    const req = mockReq({ headers: { authorization: 'Bearer valid.jwt.token' }, cookies: {} });
    const next = mockNext();

    await authController.protect(req, mockRes(), next);

    expect(jwt.verify).toHaveBeenCalledWith('valid.jwt.token', TEST_SECRET, expect.any(Function));
    expect(next).toHaveBeenCalledWith(); // no error
  });

  test('extracts token from cookie when no Authorization header', async () => {
    const user = makeUser();
    User.findById.mockResolvedValue(user);
    const req = mockReq({ headers: {}, cookies: { jwt: 'cookie.jwt.token' } });
    const next = mockNext();

    await authController.protect(req, mockRes(), next);

    expect(jwt.verify).toHaveBeenCalledWith('cookie.jwt.token', TEST_SECRET, expect.any(Function));
    expect(next).toHaveBeenCalledWith();
  });

  test('calls next(err) when jwt.verify throws JsonWebTokenError', async () => {
    const jwtErr = new Error('invalid signature');
    jwtErr.name = 'JsonWebTokenError';
    jwt.verify.mockImplementation((t, s, cb) => cb(jwtErr));
    const req = mockReq({ headers: { authorization: 'Bearer bad.token' }, cookies: {} });
    const next = mockNext();

    await authController.protect(req, mockRes(), next);

    expect(next).toHaveBeenCalledWith(jwtErr);
  });

  test('calls next(AppError 401) when user no longer exists', async () => {
    User.findById.mockResolvedValue(null);
    const req = mockReq({ headers: { authorization: 'Bearer valid.token' }, cookies: {} });
    const next = mockNext();

    await authController.protect(req, mockRes(), next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.message).toMatch(/no longer exists/);
  });

  test('calls next(AppError 401) when password changed after token was issued', async () => {
    const user = makeUser({ changedPasswordAfter: jest.fn().mockReturnValue(true) });
    User.findById.mockResolvedValue(user);
    const req = mockReq({ headers: { authorization: 'Bearer valid.token' }, cookies: {} });
    const next = mockNext();

    await authController.protect(req, mockRes(), next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.message).toMatch(/changed password/i);
  });

  test('grants access by setting req.user and calling next() with no args', async () => {
    const user = makeUser();
    User.findById.mockResolvedValue(user);
    const req = mockReq({ headers: { authorization: 'Bearer valid.token' }, cookies: {} });
    const res = mockRes();
    const next = mockNext();

    await authController.protect(req, res, next);

    expect(req.user).toBe(user);
    expect(res.locals.user).toBe(user);
    expect(next).toHaveBeenCalledWith();
  });

  test('calls next(err) when Authorization header has non-Bearer scheme', async () => {
    const next = mockNext();
    const req = mockReq({ headers: { authorization: 'Basic dXNlcjpwYXNz' }, cookies: {} });

    await authController.protect(req, mockRes(), next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
  });
});

// =============================================================================
// restrictTo
// =============================================================================

describe('restrictTo', () => {
  test('calls next() with no args when role is included', () => {
    const middleware = authController.restrictTo('admin', 'manager');
    const req = mockReq({ user: { role: 'admin' } });
    const next = mockNext();

    middleware(req, mockRes(), next);

    expect(next).toHaveBeenCalledWith();
  });

  test('calls next(AppError 403) when role is not included', () => {
    const middleware = authController.restrictTo('admin');
    const req = mockReq({ user: { role: 'cashier' } });
    const next = mockNext();

    middleware(req, mockRes(), next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(403);
  });

  test('accepts multiple roles and allows any of them', () => {
    const middleware = authController.restrictTo('admin', 'manager', 'staff');
    ['admin', 'manager', 'staff'].forEach((role) => {
      const next = mockNext();
      middleware(mockReq({ user: { role } }), mockRes(), next);
      expect(next).toHaveBeenCalledWith();
    });
  });
});

// =============================================================================
// forgotPassword
// =============================================================================

describe('forgotPassword', () => {
  test('calls next(AppError 404) when user not found', async () => {
    User.findOne.mockResolvedValue(null);
    const next = mockNext();

    await authController.forgotPassword(mockReq({ body: { email: 'x@x.com' } }), mockRes(), next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(404);
  });

  test('generates reset token, saves user, sends email, responds 200', async () => {
    const user = makeUser();
    User.findOne.mockResolvedValue(user);
    const res = mockRes();
    const next = mockNext();

    await authController.forgotPassword(mockReq({ body: { email: user.email } }), res, next);

    expect(user.createPasswordResetToken).toHaveBeenCalledTimes(1);
    expect(user.save).toHaveBeenCalledWith({ validateBeforeSave: false });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success', message: 'Token sent to email!' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  test('clears reset fields and calls next(AppError 500) when email send fails', async () => {
    const user = makeUser();
    User.findOne.mockResolvedValue(user);
    Email.mockImplementation(() => ({
      sendPasswordReset: jest.fn().mockRejectedValue(new Error('SMTP error')),
    }));
    const next = mockNext();

    await authController.forgotPassword(mockReq({ body: { email: user.email } }), mockRes(), next);

    expect(user.passwordResetToken).toBeUndefined();
    expect(user.passwordResetExpires).toBeUndefined();
    expect(user.save).toHaveBeenCalledTimes(2); // once before, once after clearing
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(500);
  });

  test('calls next(err) when User.findOne throws', async () => {
    const dbErr = new Error('DB error');
    User.findOne.mockRejectedValue(dbErr);
    const next = mockNext();

    await authController.forgotPassword(mockReq({ body: { email: 'a@b.com' } }), mockRes(), next);

    expect(next).toHaveBeenCalledWith(dbErr);
  });
});

// =============================================================================
// resetPassword
// =============================================================================

describe('resetPassword', () => {
  test('calls next(AppError 400) when token is invalid or expired', async () => {
    User.findOne.mockResolvedValue(null);
    const next = mockNext();

    await authController.resetPassword(
      mockReq({
        params: { token: 'badtoken' },
        body: { password: 'New123!', passwordConfirm: 'New123!' },
      }),
      mockRes(),
      next
    );

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(400);
  });

  test('sets new password, saves, calls createAndSendToken with 200', async () => {
    const user = makeUser();
    User.findOne.mockResolvedValue(user);
    const res = mockRes();
    const req = mockReq({
      params: { token: 'validResetToken' },
      body: { password: 'NewPass123!', passwordConfirm: 'NewPass123!' },
    });

    await authController.resetPassword(req, res, mockNext());

    expect(user.password).toBe('NewPass123!');
    expect(user.passwordResetToken).toBeUndefined();
    expect(user.passwordResetExpires).toBeUndefined();
    expect(user.save).toHaveBeenCalledTimes(1);
    expect(createAndSendToken).toHaveBeenCalledWith(user, 200, res);
  });

  test('calls next(err) when User.findOne throws', async () => {
    User.findOne.mockRejectedValue(new Error('DB error'));
    const next = mockNext();

    await authController.resetPassword(
      mockReq({ params: { token: 't' }, body: {} }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  test('hashes the token before querying (does not query with raw token)', async () => {
    User.findOne.mockResolvedValue(null);
    const req = mockReq({ params: { token: 'rawToken123' }, body: {} });

    await authController.resetPassword(req, mockRes(), mockNext());

    const [query] = User.findOne.mock.calls[0];
    // The query should NOT contain the raw token
    expect(JSON.stringify(query)).not.toContain('rawToken123');
    // It should contain a 64-char hex hash
    expect(query.passwordResetToken).toMatch(/^[a-f0-9]{64}$/);
  });
});

// =============================================================================
// updatePassword
// =============================================================================

describe('updatePassword', () => {
  test('calls next(AppError 401) when current password is wrong', async () => {
    const user = makeUser({ correctPassword: jest.fn().mockResolvedValue(false) });
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });
    const next = mockNext();

    await authController.updatePassword(
      mockReq({
        user: { id: VALID_ID },
        body: { passwordCurrent: 'wrong', password: 'New123!', passwordConfirm: 'New123!' },
      }),
      mockRes(),
      next
    );

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
  });

  test('saves new password and calls createAndSendToken with 200', async () => {
    const user = makeUser();
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(user) });
    const res = mockRes();
    const req = mockReq({
      user: { id: VALID_ID },
      body: {
        passwordCurrent: 'OldPass!',
        password: 'NewPass123!',
        passwordConfirm: 'NewPass123!',
      },
    });

    await authController.updatePassword(req, res, mockNext());

    expect(user.password).toBe('NewPass123!');
    expect(user.save).toHaveBeenCalledTimes(1);
    expect(createAndSendToken).toHaveBeenCalledWith(user, 200, res);
  });

  test('calls next(err) when User.findById throws', async () => {
    User.findById.mockReturnValue({ select: jest.fn().mockRejectedValue(new Error('DB err')) });
    const next = mockNext();

    await authController.updatePassword(
      mockReq({ user: { id: VALID_ID }, body: { passwordCurrent: 'pw' } }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});

// =============================================================================
// getMe
// =============================================================================

describe('getMe', () => {
  test('sets req.params.id to req.user.id and calls next()', () => {
    const req = mockReq({ user: { id: VALID_ID }, params: {} });
    const next = mockNext();

    authController.getMe(req, mockRes(), next);

    expect(req.params.id).toBe(VALID_ID);
    expect(next).toHaveBeenCalledWith();
  });

  test('does not call res.status or res.json directly', () => {
    const req = mockReq({ user: { id: VALID_ID }, params: {} });
    const res = mockRes();

    authController.getMe(req, res, mockNext());

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});

// =============================================================================
// getUser
// =============================================================================

describe('getUser', () => {
  test('returns 200 with user data for existing user', async () => {
    const user = makeUser();
    User.findById.mockResolvedValue(user);
    const res = mockRes();

    await authController.getUser(mockReq({ params: { id: VALID_ID } }), res, mockNext());

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        data: expect.objectContaining({ user: expect.any(Object) }),
      })
    );
  });

  test('calls next(AppError 404) when user not found', async () => {
    User.findById.mockResolvedValue(null);
    const next = mockNext();

    await authController.getUser(mockReq({ params: { id: VALID_ID } }), mockRes(), next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(404);
  });

  test('calls next(err) when User.findById throws', async () => {
    User.findById.mockRejectedValue(new Error('DB error'));
    const next = mockNext();

    await authController.getUser(mockReq({ params: { id: VALID_ID } }), mockRes(), next);

    expect(next).toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  test('response user object does not expose password', async () => {
    const user = makeUser({ password: 'hashedPassword' });
    User.findById.mockResolvedValue(user);
    const res = mockRes();

    await authController.getUser(mockReq({ params: { id: VALID_ID } }), res, mockNext());

    const jsonArg = res.json.mock.calls[0][0];
    expect(jsonArg.data.user.password).toBeUndefined();
  });
});

// =============================================================================
// getAllUsers
// =============================================================================

describe('getAllUsers', () => {
  test('returns 200 with users array', async () => {
    const users = [makeUser(), makeUser({ _id: 'other-id', email: 'b@b.com' })];
    User.find.mockResolvedValue(users);
    const res = mockRes();

    await authController.getAllUsers(mockReq(), res, mockNext());

    expect(res.status).toHaveBeenCalledWith(200);
    const json = res.json.mock.calls[0][0];
    expect(json.status).toBe('success');
    expect(json.results).toBe(2);
    expect(json.data.users).toHaveLength(2);
  });

  test('returns results: 0 for empty list', async () => {
    User.find.mockResolvedValue([]);
    const res = mockRes();

    await authController.getAllUsers(mockReq(), res, mockNext());

    const json = res.json.mock.calls[0][0];
    expect(json.results).toBe(0);
  });

  test('calls next(err) when User.find throws', async () => {
    User.find.mockRejectedValue(new Error('DB error'));
    const next = mockNext();

    await authController.getAllUsers(mockReq(), mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// =============================================================================
// updateMe
// =============================================================================

describe('updateMe', () => {
  test('calls next(AppError 400) when password is in body', async () => {
    const next = mockNext();
    await authController.updateMe(mockReq({ body: { password: 'newpass' } }), mockRes(), next);
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(400);
  });

  test('calls next(AppError 400) when passwordConfirm is in body', async () => {
    const next = mockNext();
    await authController.updateMe(
      mockReq({ body: { passwordConfirm: 'newpass' } }),
      mockRes(),
      next
    );
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(400);
  });

  test('only allows name and email to be updated', async () => {
    const updatedUser = makeUser();
    User.findByIdAndUpdate.mockResolvedValue(updatedUser);

    await authController.updateMe(
      mockReq({ body: { name: 'New Name', email: 'new@e.com', role: 'admin', active: false } }),
      mockRes(),
      mockNext()
    );

    const [, updateBody] = User.findByIdAndUpdate.mock.calls[0];
    expect(updateBody).toEqual({ name: 'New Name', email: 'new@e.com' });
    expect(updateBody.role).toBeUndefined();
    expect(updateBody.active).toBeUndefined();
  });

  test('returns 200 with updated user data', async () => {
    const updatedUser = makeUser({ name: 'Updated' });
    User.findByIdAndUpdate.mockResolvedValue(updatedUser);
    const res = mockRes();

    await authController.updateMe(
      mockReq({ body: { name: 'Updated', email: 'u@u.com' } }),
      res,
      mockNext()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        data: expect.objectContaining({ user: expect.any(Object) }),
      })
    );
  });

  test('calls next(err) when User.findByIdAndUpdate throws', async () => {
    User.findByIdAndUpdate.mockRejectedValue(new Error('DB error'));
    const next = mockNext();

    await authController.updateMe(mockReq({ body: { name: 'A' } }), mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// =============================================================================
// deleteMe
// =============================================================================

describe('deleteMe', () => {
  test('sets active:false and responds 204', async () => {
    User.findByIdAndUpdate.mockResolvedValue({});
    const res = mockRes();

    await authController.deleteMe(mockReq(), res, mockNext());

    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(VALID_ID, { active: false });
    expect(res.status).toHaveBeenCalledWith(204);
  });

  test('calls next(err) when User.findByIdAndUpdate throws', async () => {
    User.findByIdAndUpdate.mockRejectedValue(new Error('DB error'));
    const next = mockNext();

    await authController.deleteMe(mockReq(), mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// =============================================================================
// updateUser
// =============================================================================

describe('updateUser', () => {
  test('returns 200 with updated user', async () => {
    const user = makeUser();
    User.findByIdAndUpdate.mockResolvedValue(user);
    const res = mockRes();

    await authController.updateUser(
      mockReq({ params: { id: VALID_ID }, body: { name: 'Changed' } }),
      res,
      mockNext()
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success', data: expect.any(Object) })
    );
  });

  test('calls next(AppError 404) when user not found', async () => {
    User.findByIdAndUpdate.mockResolvedValue(null);
    const next = mockNext();

    await authController.updateUser(
      mockReq({ params: { id: VALID_ID }, body: {} }),
      mockRes(),
      next
    );

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(404);
  });

  test('calls next(err) when DB throws', async () => {
    User.findByIdAndUpdate.mockRejectedValue(new Error('DB error'));
    const next = mockNext();

    await authController.updateUser(
      mockReq({ params: { id: VALID_ID }, body: {} }),
      mockRes(),
      next
    );

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// =============================================================================
// deleteUser
// =============================================================================

describe('deleteUser', () => {
  test('deletes user and responds 204', async () => {
    User.findByIdAndDelete.mockResolvedValue(makeUser());
    const res = mockRes();

    await authController.deleteUser(mockReq({ params: { id: VALID_ID } }), res, mockNext());

    expect(User.findByIdAndDelete).toHaveBeenCalledWith(VALID_ID);
    expect(res.status).toHaveBeenCalledWith(204);
  });

  test('calls next(AppError 404) when user not found', async () => {
    User.findByIdAndDelete.mockResolvedValue(null);
    const next = mockNext();

    await authController.deleteUser(mockReq({ params: { id: VALID_ID } }), mockRes(), next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(404);
  });

  test('calls next(err) when DB throws', async () => {
    User.findByIdAndDelete.mockRejectedValue(new Error('DB error'));
    const next = mockNext();

    await authController.deleteUser(mockReq({ params: { id: VALID_ID } }), mockRes(), next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });
});

// =============================================================================
// verifyToken
// =============================================================================

describe('verifyToken', () => {
  test('delegates to usersController.legacyVerifyLogin when username+password provided', async () => {
    const req = mockReq({ body: { username: 'john', password: 'pw' }, cookies: {} });
    const res = mockRes();

    await authController.verifyToken(req, res, mockNext());

    expect(usersController.legacyVerifyLogin).toHaveBeenCalledWith(req, res);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('returns 401 JSON when no token found (no cookie, no header, no body.token)', async () => {
    const req = mockReq({ headers: {}, cookies: {}, body: {} });
    const res = mockRes();

    await authController.verifyToken(req, res, mockNext());

    expect(res.status).toHaveBeenCalledWith(401);
    const json = res.json.mock.calls[0][0];
    expect(json.status).toBe('error');
  });

  test('extracts token from cookie', async () => {
    const user = makeUser();
    User.findById.mockResolvedValue(user);
    const req = mockReq({ cookies: { jwt: 'cookie.token' }, headers: {}, body: {} });

    await authController.verifyToken(req, mockRes(), mockNext());

    expect(jwt.verify).toHaveBeenCalledWith('cookie.token', TEST_SECRET, expect.any(Function));
  });

  test('extracts token from Authorization header', async () => {
    const user = makeUser();
    User.findById.mockResolvedValue(user);
    const req = mockReq({
      cookies: {},
      headers: { authorization: 'Bearer header.token' },
      body: {},
    });

    await authController.verifyToken(req, mockRes(), mockNext());

    expect(jwt.verify).toHaveBeenCalledWith('header.token', TEST_SECRET, expect.any(Function));
  });

  test('extracts token from body.token', async () => {
    const user = makeUser();
    User.findById.mockResolvedValue(user);
    const req = mockReq({ cookies: {}, headers: {}, body: { token: 'body.token' } });

    await authController.verifyToken(req, mockRes(), mockNext());

    expect(jwt.verify).toHaveBeenCalledWith('body.token', TEST_SECRET, expect.any(Function));
  });

  test('returns 401 JSON with status:error for JsonWebTokenError', async () => {
    const err = new Error('invalid sig');
    err.name = 'JsonWebTokenError';
    jwt.verify.mockImplementation((t, s, cb) => cb(err));
    const req = mockReq({ cookies: {}, headers: {}, body: { token: 'bad.token' } });
    const res = mockRes();

    await authController.verifyToken(req, res, mockNext());

    expect(res.status).toHaveBeenCalledWith(401);
    const json = res.json.mock.calls[0][0];
    expect(json.status).toBe('error');
    expect(json.message).toMatch(/invalid token/i);
  });

  test('returns 401 JSON for TokenExpiredError', async () => {
    const err = new Error('jwt expired');
    err.name = 'TokenExpiredError';
    jwt.verify.mockImplementation((t, s, cb) => cb(err));
    const req = mockReq({ cookies: {}, headers: {}, body: { token: 'expired.token' } });
    const res = mockRes();

    await authController.verifyToken(req, res, mockNext());

    expect(res.status).toHaveBeenCalledWith(401);
    const json = res.json.mock.calls[0][0];
    expect(json.message).toMatch(/expired/i);
  });

  test('returns 401 when decoded user no longer exists', async () => {
    User.findById.mockResolvedValue(null);
    const req = mockReq({ cookies: {}, headers: {}, body: { token: 'valid.token' } });
    const res = mockRes();

    await authController.verifyToken(req, res, mockNext());

    expect(res.status).toHaveBeenCalledWith(401);
    const json = res.json.mock.calls[0][0];
    expect(json.status).toBe('error');
  });

  test('returns 401 when password changed after token issued', async () => {
    const user = makeUser({ changedPasswordAfter: jest.fn().mockReturnValue(true) });
    User.findById.mockResolvedValue(user);
    const req = mockReq({ cookies: {}, headers: {}, body: { token: 'valid.token' } });
    const res = mockRes();

    await authController.verifyToken(req, res, mockNext());

    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('returns 200 with user data on valid token', async () => {
    const user = makeUser();
    User.findById.mockResolvedValue(user);
    const req = mockReq({ cookies: {}, headers: {}, body: { token: 'valid.token' } });
    const res = mockRes();

    await authController.verifyToken(req, res, mockNext());

    expect(res.status).toHaveBeenCalledWith(200);
    const json = res.json.mock.calls[0][0];
    expect(json.status).toBe('success');
    expect(json.data.user).toBeDefined();
  });

  test('returns 500 JSON for unexpected errors', async () => {
    jwt.verify.mockImplementation((t, s, cb) => cb(new Error('unexpected')));
    const req = mockReq({ cookies: {}, headers: {}, body: { token: 'some.token' } });
    const res = mockRes();

    await authController.verifyToken(req, res, mockNext());

    expect(res.status).toHaveBeenCalledWith(500);
    const json = res.json.mock.calls[0][0];
    expect(json.status).toBe('error');
  });
});
