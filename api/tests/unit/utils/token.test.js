'use strict';

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(),
  verify: jest.fn(),
}));

jest.mock('crypto', () => ({
  randomBytes: jest.fn(),
  createHash: jest.fn(),
}));

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const {
  generateToken,
  verifyToken,
  generateRandomToken,
  hashToken,
} = require('../../../src/utils/token');

describe('token utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret';
    process.env.JWT_EXPIRES_IN = '1d';
  });

  test('generateToken signs payload with configured secret and expiry', () => {
    jwt.sign.mockReturnValue('signed-token');

    const token = generateToken('user-123');

    expect(jwt.sign).toHaveBeenCalledWith({ id: 'user-123' }, 'test-secret', { expiresIn: '1d' });
    expect(token).toBe('signed-token');
  });

  test('verifyToken resolves decoded payload', async () => {
    jwt.verify.mockImplementation((token, secret, callback) => {
      callback(null, { id: 'user-123' });
    });

    await expect(verifyToken('signed-token')).resolves.toEqual({ id: 'user-123' });
    expect(jwt.verify).toHaveBeenCalledWith('signed-token', 'test-secret', expect.any(Function));
  });

  test('verifyToken rejects on verification error', async () => {
    const error = new Error('invalid token');
    jwt.verify.mockImplementation((token, secret, callback) => {
      callback(error);
    });

    await expect(verifyToken('bad-token')).rejects.toThrow('invalid token');
  });

  test('generateRandomToken returns 64-char hex string', () => {
    const buffer = Buffer.from('a'.repeat(32));
    crypto.randomBytes.mockReturnValue(buffer);

    const token = generateRandomToken();

    expect(crypto.randomBytes).toHaveBeenCalledWith(32);
    expect(token).toBe(buffer.toString('hex'));
    expect(token).toHaveLength(64);
  });

  test('hashToken returns sha256 hex digest', () => {
    const digest = 'hashed-token';
    const update = jest.fn().mockReturnThis();
    const digestFn = jest.fn().mockReturnValue(digest);
    crypto.createHash.mockReturnValue({ update, digest: digestFn });

    const token = hashToken('plain-token');

    expect(crypto.createHash).toHaveBeenCalledWith('sha256');
    expect(update).toHaveBeenCalledWith('plain-token');
    expect(digestFn).toHaveBeenCalledWith('hex');
    expect(token).toBe(digest);
  });
});
