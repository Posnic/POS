'use strict';

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'signed-token'),
  verify: jest.fn(),
}));

jest.mock('util', () => ({
  promisify: jest.fn((fn) => fn),
}));

jest.mock('crypto', () => ({
  createHash: jest.fn(() => ({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn(() => Buffer.alloc(32)),
  })),
  createCipheriv: jest.fn(() => ({
    update: jest.fn(() => 'enc'),
    final: jest.fn(() => 'done'),
  })),
  randomBytes: jest.fn(() => Buffer.from('a')),
}));

jest.mock('../../../src/utils/findUserByIdentifier', () => ({
  findUserByIdentifier: jest.fn(),
}));

jest.mock('../../../src/utils/appError', () => ({
  AppError: jest.fn().mockImplementation((message, statusCode) => ({ message, statusCode })),
}));

jest.mock('../../../src/services/token.service', () => ({}));

const jwt = require('jsonwebtoken');
const { findUserByIdentifier } = require('../../../src/utils/findUserByIdentifier');
const auth = require('../../../src/middleware/auth');

describe('middleware/auth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = 'secret';
    process.env.JWT_EXPIRES_IN = '24h';
    process.env.JWT_COOKIE_EXPIRES_IN = '1';
  });

  test('createSendToken sets cookie and response', () => {
    const res = { cookie: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn() };
    auth.createSendToken({ _id: 'u1', password: 'x' }, 200, res);
    expect(jwt.sign).toHaveBeenCalled();
    expect(res.cookie).toHaveBeenCalledWith('jwt', 'signed-token', expect.any(Object));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'success' }));
  });

  test('auth attaches user on success', async () => {
    jwt.verify.mockResolvedValue({ id: 'u1', iat: 1 });
    findUserByIdentifier.mockResolvedValue({ changedPasswordAfter: jest.fn(() => false) });
    const next = jest.fn();

    await auth.auth({ headers: { authorization: 'Bearer token' }, cookies: {} }, {}, next);

    expect(findUserByIdentifier).toHaveBeenCalledWith('u1');
    expect(next).toHaveBeenCalled();
  });

  /*
   * Only a BAD TOKEN may 401 here. This middleware guards users/verify - the
   * session heartbeat - and its catch used to stamp EVERY failure "Invalid
   * token": the owner's demo-data install loaded the database enough that one
   * heartbeat's user lookup threw, the client saw 401, and it did the only
   * correct thing with a 401 - signed him out, mid-install.
   */
  test('a database failure is NOT a 401 - an outage must never sign people out', async () => {
    jwt.verify.mockResolvedValue({ id: 'u1', iat: 1 });
    const dbDown = new Error('pool timed out');
    findUserByIdentifier.mockRejectedValue(dbDown);
    const next = jest.fn();

    await auth.auth({ headers: { authorization: 'Bearer token' }, cookies: {} }, {}, next);

    expect(next).toHaveBeenCalledWith(dbDown);
    const forwarded = next.mock.calls[0][0];
    expect(forwarded.statusCode).toBeUndefined();
    expect(String(forwarded.message)).not.toMatch(/invalid token/i);
  });

  test('a genuinely bad token IS a 401', async () => {
    const bad = new Error('jwt malformed');
    bad.name = 'JsonWebTokenError';
    jwt.verify.mockRejectedValue(bad);
    const next = jest.fn();

    await auth.auth({ headers: { authorization: 'Bearer nonsense' }, cookies: {} }, {}, next);

    const forwarded = next.mock.calls[0][0];
    expect(String(forwarded.message)).toMatch(/invalid token or user not found/i);
  });

  test('an expired token IS a 401 too', async () => {
    const expired = new Error('jwt expired');
    expired.name = 'TokenExpiredError';
    jwt.verify.mockRejectedValue(expired);
    const next = jest.fn();

    await auth.auth({ headers: { authorization: 'Bearer old' }, cookies: {} }, {}, next);

    const forwarded = next.mock.calls[0][0];
    expect(String(forwarded.message)).toMatch(/invalid token or user not found/i);
  });
});
