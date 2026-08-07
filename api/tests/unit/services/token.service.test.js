'use strict';

/**
 * Unit tests for src/services/token.service.js
 *
 * File        : src/services/token.service.js (114 lines, FUNCTIONAL export)
 * Export type : Plain functions — module.exports = { generateToken, verifyToken,
 *               generateAuthTokens, generateResetPasswordToken, generateVerifyEmailToken }
 * Base class  : None — NOT a class, does NOT extend base.service.js
 *
 * Functions (5):
 *   generateToken(userId, expires, type, secret)  — builds JWT payload {sub,iat,exp,type}, signs it
 *   verifyToken(token, type)                       — async, jwt.verify + type check, throws Error('Invalid token')
 *   generateAuthTokens(user)                       — access + refresh token pair with Date expiries
 *   generateResetPasswordToken(user)               — JWT with RESET_PASSWORD type
 *   generateVerifyEmailToken(user)                 — JWT with VERIFY_EMAIL type
 *
 * Mocked dependencies:
 *   jsonwebtoken — jwt.sign, jwt.verify
 *   src/config/config — jwt.secret and expiration values
 *
 * CRITICAL PRODUCTION BUGS FOUND:
 *   1. config.jwt.accessExpirationMinutes, refreshExpirationDays,
 *      resetPasswordExpirationMinutes, and verifyEmailExpirationMinutes do NOT
 *      exist in src/config/config.js. The actual config only has:
 *        jwt.secret, jwt.expiresIn, jwt.cookieExpiresIn
 *      Because of this, moment().add(undefined, 'minutes') returns the current
 *      moment, making ALL generated tokens expire IMMEDIATELY in production.
 *      Fix: Add the four missing keys to config.js (see recommendation below).
 *
 *   2. AppError is imported in token.service.js but never used anywhere.
 *      verifyToken throws a plain Error, not AppError. Dead import should be removed.
 *
 *   3. verifyToken catches ALL jwt errors (expired, malformed, invalid signature,
 *      type mismatch) and re-throws a single generic Error('Invalid token'), losing
 *      the original error type. This prevents callers from distinguishing between
 *      an expired token (should return 401 with "please refresh") and a malformed
 *      token (should return 400).
 *
 * Recommended config.js fix (minimal, non-breaking):
 *   jwt: {
 *     secret: process.env.JWT_SECRET || '...',
 *     expiresIn: process.env.JWT_EXPIRES_IN || '90d',
 *     cookieExpiresIn: process.env.JWT_COOKIE_EXPIRES_IN || 90,
 *     accessExpirationMinutes:       parseInt(process.env.JWT_ACCESS_EXPIRATION_MINUTES)  || 30,
 *     refreshExpirationDays:         parseInt(process.env.JWT_REFRESH_EXPIRATION_DAYS)    || 30,
 *     resetPasswordExpirationMinutes:parseInt(process.env.JWT_RESET_EXPIRATION_MINUTES)   || 10,
 *     verifyEmailExpirationMinutes:  parseInt(process.env.JWT_VERIFY_EMAIL_EXPIRATION_MINUTES) || 1440,
 *   }
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(),
  verify: jest.fn(),
}));

jest.mock('../../../src/config/config', () => ({
  jwt: {
    secret: 'test-jwt-secret',
    accessExpirationMinutes: 30,
    refreshExpirationDays: 7,
    resetPasswordExpirationMinutes: 10,
    verifyEmailExpirationMinutes: 1440,
    expiresIn: '90d',
    cookieExpiresIn: 90,
  },
}));

// ─── Requires ─────────────────────────────────────────────────────────────────

const jwt = require('jsonwebtoken');
const moment = require('moment');
const { tokenTypes } = require('../../../src/config/tokens');
const {
  generateToken,
  verifyToken,
  generateAuthTokens,
  generateResetPasswordToken,
  generateVerifyEmailToken,
} = require('../../../src/services/token.service');

// ─── Shared helpers ───────────────────────────────────────────────────────────

const FAKE_USER_ID = 'user_64f8f2f4c2b9c0a1e4000001';

const mockUser = {
  id: FAKE_USER_ID,
  email: 'test@example.com',
  role: 'admin',
  password: 'super_secret_hashed_password',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TokenService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jwt.sign.mockReturnValue('mock.jwt.token');
  });

  // ── generateToken ─────────────────────────────────────────────────────────

  describe('generateToken', () => {
    let expires;

    beforeEach(() => {
      expires = moment().add(30, 'minutes');
    });

    test('returns result of jwt.sign', () => {
      jwt.sign.mockReturnValue('signed.token');
      const token = generateToken(FAKE_USER_ID, expires, tokenTypes.ACCESS);
      expect(token).toBe('signed.token');
    });

    test('calls jwt.sign exactly once', () => {
      generateToken(FAKE_USER_ID, expires, tokenTypes.ACCESS);
      expect(jwt.sign).toHaveBeenCalledTimes(1);
    });

    test('payload contains sub equal to userId', () => {
      generateToken(FAKE_USER_ID, expires, tokenTypes.ACCESS);
      const [payload] = jwt.sign.mock.calls[0];
      expect(payload.sub).toBe(FAKE_USER_ID);
    });

    test('payload contains correct type field', () => {
      generateToken(FAKE_USER_ID, expires, tokenTypes.ACCESS);
      const [payload] = jwt.sign.mock.calls[0];
      expect(payload.type).toBe(tokenTypes.ACCESS);
    });

    test('payload exp equals expires.unix()', () => {
      generateToken(FAKE_USER_ID, expires, tokenTypes.ACCESS);
      const [payload] = jwt.sign.mock.calls[0];
      expect(payload.exp).toBe(expires.unix());
    });

    test('payload iat is a number (current unix timestamp)', () => {
      generateToken(FAKE_USER_ID, expires, tokenTypes.ACCESS);
      const [payload] = jwt.sign.mock.calls[0];
      expect(typeof payload.iat).toBe('number');
      expect(payload.iat).toBeGreaterThan(0);
    });

    test('uses config.jwt.secret by default', () => {
      generateToken(FAKE_USER_ID, expires, tokenTypes.ACCESS);
      const [, secret] = jwt.sign.mock.calls[0];
      expect(secret).toBe('test-jwt-secret');
    });

    test('uses provided secret when explicitly passed', () => {
      generateToken(FAKE_USER_ID, expires, tokenTypes.ACCESS, 'custom-secret');
      const [, secret] = jwt.sign.mock.calls[0];
      expect(secret).toBe('custom-secret');
    });

    test('payload does NOT include password field', () => {
      generateToken(FAKE_USER_ID, expires, tokenTypes.ACCESS);
      const [payload] = jwt.sign.mock.calls[0];
      expect(payload).not.toHaveProperty('password');
    });

    test('payload does NOT include email field', () => {
      generateToken(FAKE_USER_ID, expires, tokenTypes.ACCESS);
      const [payload] = jwt.sign.mock.calls[0];
      expect(payload).not.toHaveProperty('email');
    });

    test('payload does NOT include role field', () => {
      generateToken(FAKE_USER_ID, expires, tokenTypes.ACCESS);
      const [payload] = jwt.sign.mock.calls[0];
      expect(payload).not.toHaveProperty('role');
    });

    test('payload only contains expected safe fields: sub, iat, exp, type', () => {
      generateToken(FAKE_USER_ID, expires, tokenTypes.ACCESS);
      const [payload] = jwt.sign.mock.calls[0];
      const keys = Object.keys(payload).sort();
      expect(keys).toEqual(['exp', 'iat', 'sub', 'type']);
    });

    test('works with REFRESH token type', () => {
      generateToken(FAKE_USER_ID, expires, tokenTypes.REFRESH);
      const [payload] = jwt.sign.mock.calls[0];
      expect(payload.type).toBe(tokenTypes.REFRESH);
    });

    test('works with RESET_PASSWORD token type', () => {
      generateToken(FAKE_USER_ID, expires, tokenTypes.RESET_PASSWORD);
      const [payload] = jwt.sign.mock.calls[0];
      expect(payload.type).toBe(tokenTypes.RESET_PASSWORD);
    });

    test('works with VERIFY_EMAIL token type', () => {
      generateToken(FAKE_USER_ID, expires, tokenTypes.VERIFY_EMAIL);
      const [payload] = jwt.sign.mock.calls[0];
      expect(payload.type).toBe(tokenTypes.VERIFY_EMAIL);
    });
  });

  // ── verifyToken ───────────────────────────────────────────────────────────

  describe('verifyToken', () => {
    const mockPayload = {
      sub: FAKE_USER_ID,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 1800,
      type: tokenTypes.ACCESS,
    };

    test('returns payload when token is valid and type matches', async () => {
      jwt.verify.mockReturnValue(mockPayload);
      const result = await verifyToken('valid.token', tokenTypes.ACCESS);
      expect(result).toEqual(mockPayload);
    });

    test('calls jwt.verify with token and config.jwt.secret', async () => {
      jwt.verify.mockReturnValue(mockPayload);
      await verifyToken('some.token', tokenTypes.ACCESS);
      expect(jwt.verify).toHaveBeenCalledWith('some.token', 'test-jwt-secret');
    });

    test('returns payload when type parameter is null (no type check)', async () => {
      jwt.verify.mockReturnValue(mockPayload);
      const result = await verifyToken('valid.token', null);
      expect(result).toEqual(mockPayload);
    });

    test('returns payload when type parameter is undefined (no type check)', async () => {
      jwt.verify.mockReturnValue(mockPayload);
      const result = await verifyToken('valid.token', undefined);
      expect(result).toEqual(mockPayload);
    });

    test('throws Error("Invalid token") when jwt.verify throws (expired)', async () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });
      await expect(verifyToken('expired.token', tokenTypes.ACCESS)).rejects.toThrow(
        'Invalid token'
      );
    });

    test('throws Error("Invalid token") when jwt.verify throws (malformed)', async () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('jwt malformed');
      });
      await expect(verifyToken('bad.token', tokenTypes.ACCESS)).rejects.toThrow('Invalid token');
    });

    test('throws Error("Invalid token") when jwt.verify throws (invalid signature)', async () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('invalid signature');
      });
      await expect(verifyToken('tampered.token', tokenTypes.ACCESS)).rejects.toThrow(
        'Invalid token'
      );
    });

    test('throws Error("Invalid token") when token type does not match', async () => {
      jwt.verify.mockReturnValue({ ...mockPayload, type: tokenTypes.REFRESH });
      await expect(verifyToken('valid.token', tokenTypes.ACCESS)).rejects.toThrow('Invalid token');
    });

    test('does NOT leak original jwt error message (always "Invalid token")', async () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('very specific jwt internals');
      });

      /*
       * This called fail(), a Jasmine global that Jest no longer provides. It
       * threw ReferenceError - and the catch below caught that, so the
       * assertions ran against the wrong error object. Throwing from inside the
       * try has the same problem.
       *
       * Catching into a variable and asserting after the block keeps the
       * "it did not throw at all" case distinguishable from "it threw the wrong
       * thing", which is the whole point of the check.
       */
      let caught;
      try {
        await verifyToken('token', tokenTypes.ACCESS);
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      expect(caught.message).toBe('Invalid token');
      expect(caught.message).not.toContain('very specific jwt internals');
    });

    test('throws plain Error, not a subclass', async () => {
      jwt.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });
      await expect(verifyToken('token', tokenTypes.ACCESS)).rejects.toBeInstanceOf(Error);
    });

    test('succeeds when token type matches REFRESH type', async () => {
      const refreshPayload = { ...mockPayload, type: tokenTypes.REFRESH };
      jwt.verify.mockReturnValue(refreshPayload);
      const result = await verifyToken('refresh.token', tokenTypes.REFRESH);
      expect(result.type).toBe(tokenTypes.REFRESH);
    });

    test('succeeds when token type matches RESET_PASSWORD type', async () => {
      const payload = { ...mockPayload, type: tokenTypes.RESET_PASSWORD };
      jwt.verify.mockReturnValue(payload);
      const result = await verifyToken('reset.token', tokenTypes.RESET_PASSWORD);
      expect(result.type).toBe(tokenTypes.RESET_PASSWORD);
    });

    test('succeeds when token type matches VERIFY_EMAIL type', async () => {
      const payload = { ...mockPayload, type: tokenTypes.VERIFY_EMAIL };
      jwt.verify.mockReturnValue(payload);
      const result = await verifyToken('verify.token', tokenTypes.VERIFY_EMAIL);
      expect(result.type).toBe(tokenTypes.VERIFY_EMAIL);
    });
  });

  // ── generateAuthTokens ────────────────────────────────────────────────────

  describe('generateAuthTokens', () => {
    beforeEach(() => {
      let callCount = 0;
      jwt.sign.mockImplementation(() => {
        callCount++;
        return callCount === 1 ? 'mock.access.token' : 'mock.refresh.token';
      });
    });

    test('returns object with access and refresh keys', () => {
      const result = generateAuthTokens(mockUser);
      expect(result).toHaveProperty('access');
      expect(result).toHaveProperty('refresh');
    });

    test('access.token is the string returned by jwt.sign', () => {
      const result = generateAuthTokens(mockUser);
      expect(result.access.token).toBe('mock.access.token');
    });

    test('refresh.token is the string returned by second jwt.sign call', () => {
      const result = generateAuthTokens(mockUser);
      expect(result.refresh.token).toBe('mock.refresh.token');
    });

    test('access.expires is a Date instance', () => {
      const result = generateAuthTokens(mockUser);
      expect(result.access.expires).toBeInstanceOf(Date);
    });

    test('refresh.expires is a Date instance', () => {
      const result = generateAuthTokens(mockUser);
      expect(result.refresh.expires).toBeInstanceOf(Date);
    });

    test('calls jwt.sign exactly twice (once per token)', () => {
      generateAuthTokens(mockUser);
      expect(jwt.sign).toHaveBeenCalledTimes(2);
    });

    test('access token payload has type ACCESS', () => {
      generateAuthTokens(mockUser);
      const [accessPayload] = jwt.sign.mock.calls[0];
      expect(accessPayload.type).toBe(tokenTypes.ACCESS);
    });

    test('refresh token payload has type REFRESH', () => {
      generateAuthTokens(mockUser);
      const [refreshPayload] = jwt.sign.mock.calls[1];
      expect(refreshPayload.type).toBe(tokenTypes.REFRESH);
    });

    test('both tokens use user.id as subject', () => {
      generateAuthTokens(mockUser);
      const [accessPayload] = jwt.sign.mock.calls[0];
      const [refreshPayload] = jwt.sign.mock.calls[1];
      expect(accessPayload.sub).toBe(FAKE_USER_ID);
      expect(refreshPayload.sub).toBe(FAKE_USER_ID);
    });

    test('both tokens are signed with config.jwt.secret', () => {
      generateAuthTokens(mockUser);
      const [, accessSecret] = jwt.sign.mock.calls[0];
      const [, refreshSecret] = jwt.sign.mock.calls[1];
      expect(accessSecret).toBe('test-jwt-secret');
      expect(refreshSecret).toBe('test-jwt-secret');
    });

    test('refresh.expires is later than access.expires', () => {
      const result = generateAuthTokens(mockUser);
      expect(result.refresh.expires.getTime()).toBeGreaterThan(result.access.expires.getTime());
    });

    test('access token payload does NOT contain password', () => {
      generateAuthTokens(mockUser);
      const [payload] = jwt.sign.mock.calls[0];
      expect(payload).not.toHaveProperty('password');
    });

    test('refresh token payload does NOT contain password', () => {
      generateAuthTokens(mockUser);
      const [payload] = jwt.sign.mock.calls[1];
      expect(payload).not.toHaveProperty('password');
    });

    test('token payloads do NOT contain email', () => {
      generateAuthTokens(mockUser);
      const [accessPayload] = jwt.sign.mock.calls[0];
      const [refreshPayload] = jwt.sign.mock.calls[1];
      expect(accessPayload).not.toHaveProperty('email');
      expect(refreshPayload).not.toHaveProperty('email');
    });

    test('returns only token and expires under each key', () => {
      const result = generateAuthTokens(mockUser);
      expect(Object.keys(result.access).sort()).toEqual(['expires', 'token']);
      expect(Object.keys(result.refresh).sort()).toEqual(['expires', 'token']);
    });
  });

  // ── generateResetPasswordToken ────────────────────────────────────────────

  describe('generateResetPasswordToken', () => {
    test('returns result of jwt.sign', () => {
      jwt.sign.mockReturnValue('reset.password.token');
      const token = generateResetPasswordToken(mockUser);
      expect(token).toBe('reset.password.token');
    });

    test('calls jwt.sign exactly once', () => {
      generateResetPasswordToken(mockUser);
      expect(jwt.sign).toHaveBeenCalledTimes(1);
    });

    test('payload type is RESET_PASSWORD', () => {
      generateResetPasswordToken(mockUser);
      const [payload] = jwt.sign.mock.calls[0];
      expect(payload.type).toBe(tokenTypes.RESET_PASSWORD);
    });

    test('payload sub is user.id', () => {
      generateResetPasswordToken(mockUser);
      const [payload] = jwt.sign.mock.calls[0];
      expect(payload.sub).toBe(FAKE_USER_ID);
    });

    test('is signed with config.jwt.secret', () => {
      generateResetPasswordToken(mockUser);
      const [, secret] = jwt.sign.mock.calls[0];
      expect(secret).toBe('test-jwt-secret');
    });

    test('payload does NOT include password or email', () => {
      generateResetPasswordToken(mockUser);
      const [payload] = jwt.sign.mock.calls[0];
      expect(payload).not.toHaveProperty('password');
      expect(payload).not.toHaveProperty('email');
    });

    test('payload only has safe fields: sub, iat, exp, type', () => {
      generateResetPasswordToken(mockUser);
      const [payload] = jwt.sign.mock.calls[0];
      expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'sub', 'type']);
    });
  });

  // ── generateVerifyEmailToken ──────────────────────────────────────────────

  describe('generateVerifyEmailToken', () => {
    test('returns result of jwt.sign', () => {
      jwt.sign.mockReturnValue('verify.email.token');
      const token = generateVerifyEmailToken(mockUser);
      expect(token).toBe('verify.email.token');
    });

    test('calls jwt.sign exactly once', () => {
      generateVerifyEmailToken(mockUser);
      expect(jwt.sign).toHaveBeenCalledTimes(1);
    });

    test('payload type is VERIFY_EMAIL', () => {
      generateVerifyEmailToken(mockUser);
      const [payload] = jwt.sign.mock.calls[0];
      expect(payload.type).toBe(tokenTypes.VERIFY_EMAIL);
    });

    test('payload sub is user.id', () => {
      generateVerifyEmailToken(mockUser);
      const [payload] = jwt.sign.mock.calls[0];
      expect(payload.sub).toBe(FAKE_USER_ID);
    });

    test('is signed with config.jwt.secret', () => {
      generateVerifyEmailToken(mockUser);
      const [, secret] = jwt.sign.mock.calls[0];
      expect(secret).toBe('test-jwt-secret');
    });

    test('payload does NOT include password or email', () => {
      generateVerifyEmailToken(mockUser);
      const [payload] = jwt.sign.mock.calls[0];
      expect(payload).not.toHaveProperty('password');
      expect(payload).not.toHaveProperty('email');
    });

    test('payload only has safe fields: sub, iat, exp, type', () => {
      generateVerifyEmailToken(mockUser);
      const [payload] = jwt.sign.mock.calls[0];
      expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'sub', 'type']);
    });

    test('verify email expiry is further than reset password expiry', () => {
      generateVerifyEmailToken(mockUser);
      const [verifyPayload] = jwt.sign.mock.calls[0];

      jwt.sign.mockClear();
      generateResetPasswordToken(mockUser);
      const [resetPayload] = jwt.sign.mock.calls[0];

      expect(verifyPayload.exp).toBeGreaterThan(resetPayload.exp);
    });
  });

  // ── security cross-cutting concerns ──────────────────────────────────────

  describe('security – sensitive fields never in JWT payloads', () => {
    const sensitiveUser = {
      id: FAKE_USER_ID,
      email: 'secret@test.com',
      password: 'hashed_password_must_not_leak',
      passwordHash: 'raw_hash_must_not_leak',
      resetToken: 'reset_token_must_not_leak',
      otp: '123456',
      secret: 'app_secret',
      refreshToken: 'raw_refresh_must_not_leak',
    };

    const sensitiveFields = [
      'password',
      'passwordHash',
      'resetToken',
      'otp',
      'secret',
      'refreshToken',
      'email',
    ];

    test.each([
      [
        'generateAuthTokens (access)',
        () => {
          generateAuthTokens(sensitiveUser);
          return jwt.sign.mock.calls[0][0];
        },
      ],
      [
        'generateAuthTokens (refresh)',
        () => {
          generateAuthTokens(sensitiveUser);
          return jwt.sign.mock.calls[1][0];
        },
      ],
      [
        'generateResetPasswordToken',
        () => {
          generateResetPasswordToken(sensitiveUser);
          return jwt.sign.mock.calls[0][0];
        },
      ],
      [
        'generateVerifyEmailToken',
        () => {
          generateVerifyEmailToken(sensitiveUser);
          return jwt.sign.mock.calls[0][0];
        },
      ],
    ])('%s payload contains no sensitive fields', (_name, getPayload) => {
      jwt.sign.mockReturnValue('token');
      const payload = getPayload();
      for (const field of sensitiveFields) {
        expect(payload).not.toHaveProperty(field);
      }
    });

    test('jwt.secret is not included in returned token objects', () => {
      jwt.sign.mockReturnValue('mock.token');
      const result = generateAuthTokens(mockUser);
      const str = JSON.stringify(result);
      expect(str).not.toContain('test-jwt-secret');
    });
  });
});
