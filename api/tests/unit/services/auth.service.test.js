'use strict';

/**
 * Unit tests for src/services/auth.service.js
 *
 * File confirmed : src/services/auth.service.js (175 lines)
 * Related files  :
 *   - src/controllers/auth.controller.js      — active consumer
 *   - src/controllers/auth-utils.controller.js — active consumer
 *   - src/routes/auth.routes.js               — active consumer
 *   - src/routes/auth-utils.routes.js         — active consumer
 *   - src/middleware/auth.js                  — active consumer
 *   - src/services/token.service.js           — dependency (mocked)
 *   - src/models (User)                       — dependency (mocked)
 *   - src/config/auth.js                      — config (not used by service)
 *   - src/config/tokens.js                    — dependency (mocked)
 *   - src/config/logger.js                    — dependency (mocked)
 *
 * ORM       : Mongoose (via User model)
 * Framework : Jest (pre-configured)
 * Strategy  : Full mock isolation — all dependencies mocked.
 *             No DB connection. No real JWT signing. No real email sent.
 *
 * Exported methods (6):
 *   register(userBody)
 *   login(email, password)
 *   logout(refreshToken)
 *   refreshAuth(refreshToken)
 *   resetPassword(resetPasswordToken, newPassword)
 *   verifyEmail(verifyEmailToken)
 *
 * ─── KNOWN PRODUCTION BUGS (documented, not fixed — mocked away in tests) ───
 *
 * BUG 1 — CRITICAL: `require("../utils/ApiError")` at line 3.
 *   The file `src/utils/ApiError.js` does NOT exist on disk.
 *   The real error utility is `src/utils/appError.js` (exports AppError).
 *   auth.service.js will throw "Cannot find module '../utils/ApiError'" at
 *   require() time in production. Workaround: virtual jest.mock below.
 *   Fix: change line 3 to:
 *     const { AppError: ApiError } = require('../utils/appError');
 *
 * BUG 2 — FIXED. `Token` is used in `logout` and `resetPassword` and was
 *   never imported, so both threw ReferenceError. auth.service.js now requires
 *   ../models/token.model, and this file mocks that module instead of assigning
 *   global.Token. Original note:
 *
 * BUG 2 — CRITICAL: `Token` is used in `logout` (line 67) and
 *   `resetPassword` (line 127) but is NEVER imported/required anywhere
 *   in auth.service.js. This causes `ReferenceError: Token is not defined`
 *   at runtime. Workaround: global.Token = MockToken in tests.
 *   Fix: add `const { Token } = require('../models');` at the top.
 *
 * BUG 3 — `user.isPasswordMatch(password)` is called in login() (line 44)
 *   but `user.model.js` defines the method as `correctPassword(candidate, hash)`.
 *   No `isPasswordMatch` method exists on the User model.
 *   Fix: change line 44 to `user.correctPassword(password, user.password)`.
 *
 * BUG 4 — `user.updateLastLogin()` is called in login() (line 53) but no
 *   such instance method exists on user.model.js.
 *   Fix: replace with `user.lastActive = new Date(); await user.save();`
 *   or add the method to user.model.js.
 *
 * BUG 5 — `require("../models")` requires `src/models/index.js` which does
 *   NOT exist. No barrel export file found in src/models/.
 *   Fix: import User directly: `const User = require('../models/user.model')`.
 */

// ─── Virtual mock for the non-existent '../utils/ApiError' path ───────────────
// MUST be declared before any require() calls (Jest hoists jest.mock).
jest.mock(
  '../../../src/utils/ApiError',
  () => {
    class ApiError extends Error {
      constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
        this.name = 'ApiError';
      }
    }
    return ApiError;
  },
  { virtual: true }
);

// ─── Mock ../models (User is destructured by auth.service.js) ─────────────────
// virtual:true required because src/models/index.js does not exist (Bug 5)
jest.mock(
  '../../../src/models',
  () => ({
    User: {
      isEmailTaken: jest.fn(),
      create: jest.fn(),
      findOne: jest.fn(),
      findById: jest.fn(),
    },
  }),
  { virtual: true }
);

// ─── Mock token.service.js ────────────────────────────────────────────────────
jest.mock('../../../src/models/token.model', () => ({
  findOne: jest.fn(),
  deleteMany: jest.fn(),
}));

jest.mock('../../../src/services/token.service', () => ({
  generateVerifyEmailToken: jest.fn(),
  generateAuthTokens: jest.fn(),
  verifyToken: jest.fn(),
}));

// ─── Mock http-status (guard against package version API differences) ────────
jest.mock('http-status', () => ({
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
}));

// ─── Mock config/tokens ───────────────────────────────────────────────────────
jest.mock('../../../src/config/tokens', () => ({
  tokenTypes: {
    ACCESS: 'access',
    REFRESH: 'refresh',
    RESET_PASSWORD: 'resetPassword',
    VERIFY_EMAIL: 'verifyEmail',
  },
}));

// ─── Mock logger (suppress console noise in test output) ─────────────────────
// virtual:true required because src/config/logger.js does not exist
// (logger lives in src/utils/logger.js — auth.service.js imports from wrong path)
jest.mock(
  '../../../src/config/logger',
  () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  }),
  { virtual: true }
);

// ─── Requires (after all mocks) ───────────────────────────────────────────────
const { User } = require('../../../src/models');
const tokenService = require('../../../src/services/token.service');
const logger = require('../../../src/config/logger');
const { tokenTypes } = require('../../../src/config/tokens');
const authService = require('../../../src/services/auth.service');

// ─── Token mock ───────────────────────────────────────────────────────────────
// auth.service.js used `Token` without importing it, so logout and
// resetPassword threw ReferenceError, and this file reached it by assigning
// global.Token - which only worked because there was no real binding to shadow
// it. The service now requires the model properly, so it is mocked properly.
const MockToken = require('../../../src/models/token.model');

// ─── Test data helpers ────────────────────────────────────────────────────────
function makeMockUser(overrides = {}) {
  return {
    _id: 'user_abc123',
    id: 'user_abc123',
    email: 'alice@example.com',
    role: 'staff',
    isActive: true,
    isEmailVerified: false,
    isPasswordMatch: jest.fn().mockResolvedValue(true),
    updateLastLogin: jest.fn().mockResolvedValue(undefined),
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeMockTokenDoc(overrides = {}) {
  return {
    user: 'user_abc123',
    remove: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const MOCK_TOKENS = {
  access: { token: 'mock_access_token', expires: new Date(Date.now() + 900_000) },
  refresh: { token: 'mock_refresh_token', expires: new Date(Date.now() + 604_800_000) },
};

// ══════════════════════════════════════════════════════════════════════════════
describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MockToken.findOne.mockReset();
    MockToken.deleteMany.mockResolvedValue({ deletedCount: 1 });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // register
  // ══════════════════════════════════════════════════════════════════════════
  describe('register', () => {
    test('returns the created user when email is not taken', async () => {
      const userBody = { email: 'alice@example.com', password: 'securePass1' };
      const mockUser = makeMockUser();

      User.isEmailTaken.mockResolvedValue(false);
      User.create.mockResolvedValue(mockUser);
      tokenService.generateVerifyEmailToken.mockResolvedValue('verify_token_abc');

      const result = await authService.register(userBody);

      expect(result).toBe(mockUser);
    });

    test('calls User.isEmailTaken with provided email', async () => {
      User.isEmailTaken.mockResolvedValue(false);
      User.create.mockResolvedValue(makeMockUser());
      tokenService.generateVerifyEmailToken.mockResolvedValue('tok');

      await authService.register({ email: 'test@example.com', password: 'pass' });
      expect(User.isEmailTaken).toHaveBeenCalledWith('test@example.com');
    });

    test('calls User.create with role defaulting to "user" when not provided', async () => {
      const userBody = { email: 'alice@example.com', password: 'securePass1' };
      User.isEmailTaken.mockResolvedValue(false);
      User.create.mockResolvedValue(makeMockUser());
      tokenService.generateVerifyEmailToken.mockResolvedValue('tok');

      await authService.register(userBody);
      expect(User.create).toHaveBeenCalledWith(expect.objectContaining({ role: 'user' }));
    });

    test('preserves provided role over "user" default', async () => {
      const userBody = { email: 'admin@example.com', password: 'pass', role: 'admin' };
      User.isEmailTaken.mockResolvedValue(false);
      User.create.mockResolvedValue(makeMockUser({ role: 'admin' }));
      tokenService.generateVerifyEmailToken.mockResolvedValue('tok');

      await authService.register(userBody);
      expect(User.create).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin' }));
    });

    test('calls tokenService.generateVerifyEmailToken with created user', async () => {
      const mockUser = makeMockUser();
      User.isEmailTaken.mockResolvedValue(false);
      User.create.mockResolvedValue(mockUser);
      tokenService.generateVerifyEmailToken.mockResolvedValue('tok');

      await authService.register({ email: 'alice@example.com', password: 'pass' });
      expect(tokenService.generateVerifyEmailToken).toHaveBeenCalledWith(mockUser);
    });

    test('calls logger.info with email and token (verify email notification)', async () => {
      const mockUser = makeMockUser();
      User.isEmailTaken.mockResolvedValue(false);
      User.create.mockResolvedValue(mockUser);
      tokenService.generateVerifyEmailToken.mockResolvedValue('verify_tok_123');

      await authService.register({ email: 'alice@example.com', password: 'pass' });
      expect(logger.info).toHaveBeenCalled();
    });

    test('throws ApiError(400) when email is already taken', async () => {
      User.isEmailTaken.mockResolvedValue(true);

      await expect(authService.register({ email: 'taken@example.com' })).rejects.toMatchObject({
        statusCode: 400,
        message: 'Email already taken',
      });
    });

    test('does NOT call User.create when email is already taken', async () => {
      User.isEmailTaken.mockResolvedValue(true);
      await authService.register({ email: 'taken@example.com' }).catch(() => {});
      expect(User.create).not.toHaveBeenCalled();
    });

    test('does NOT call tokenService when email is taken', async () => {
      User.isEmailTaken.mockResolvedValue(true);
      await authService.register({ email: 'taken@example.com' }).catch(() => {});
      expect(tokenService.generateVerifyEmailToken).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // login
  // ══════════════════════════════════════════════════════════════════════════
  describe('login', () => {
    test('returns {user, tokens} for valid credentials on an active account', async () => {
      const mockUser = makeMockUser();
      User.findOne.mockResolvedValue(mockUser);
      tokenService.generateAuthTokens.mockReturnValue(MOCK_TOKENS);

      const result = await authService.login('alice@example.com', 'securePass1');

      expect(result).toEqual({ user: mockUser, tokens: MOCK_TOKENS });
    });

    test('calls User.findOne with the provided email', async () => {
      const mockUser = makeMockUser();
      User.findOne.mockResolvedValue(mockUser);
      tokenService.generateAuthTokens.mockReturnValue(MOCK_TOKENS);

      await authService.login('alice@example.com', 'securePass1');
      expect(User.findOne).toHaveBeenCalledWith({ email: 'alice@example.com' });
    });

    test('calls user.isPasswordMatch with provided password', async () => {
      const mockUser = makeMockUser();
      User.findOne.mockResolvedValue(mockUser);
      tokenService.generateAuthTokens.mockReturnValue(MOCK_TOKENS);

      await authService.login('alice@example.com', 'securePass1');
      expect(mockUser.isPasswordMatch).toHaveBeenCalledWith('securePass1');
    });

    test('calls user.updateLastLogin on successful login', async () => {
      const mockUser = makeMockUser();
      User.findOne.mockResolvedValue(mockUser);
      tokenService.generateAuthTokens.mockReturnValue(MOCK_TOKENS);

      await authService.login('alice@example.com', 'securePass1');
      expect(mockUser.updateLastLogin).toHaveBeenCalled();
    });

    test('calls tokenService.generateAuthTokens with the user', async () => {
      const mockUser = makeMockUser();
      User.findOne.mockResolvedValue(mockUser);
      tokenService.generateAuthTokens.mockReturnValue(MOCK_TOKENS);

      await authService.login('alice@example.com', 'pass');
      expect(tokenService.generateAuthTokens).toHaveBeenCalledWith(mockUser);
    });

    test('throws ApiError(401) when user is not found', async () => {
      User.findOne.mockResolvedValue(null);

      await expect(authService.login('ghost@example.com', 'pass')).rejects.toMatchObject({
        statusCode: 401,
        message: 'Incorrect email or password',
      });
    });

    test('throws ApiError(401) when password does not match', async () => {
      const mockUser = makeMockUser();
      User.findOne.mockResolvedValue(mockUser);
      mockUser.isPasswordMatch.mockResolvedValue(false);

      await expect(authService.login('alice@example.com', 'wrongpass')).rejects.toMatchObject({
        statusCode: 401,
        message: 'Incorrect email or password',
      });
    });

    test('throws ApiError(403) when account is inactive', async () => {
      const inactiveUser = makeMockUser({ isActive: false });
      User.findOne.mockResolvedValue(inactiveUser);

      await expect(authService.login('alice@example.com', 'securePass1')).rejects.toMatchObject({
        statusCode: 403,
        message: 'Account is deactivated',
      });
    });

    test('does NOT call tokenService.generateAuthTokens when user not found', async () => {
      User.findOne.mockResolvedValue(null);
      await authService.login('ghost@example.com', 'pass').catch(() => {});
      expect(tokenService.generateAuthTokens).not.toHaveBeenCalled();
    });

    test('does NOT call tokenService.generateAuthTokens when password is wrong', async () => {
      const mockUser = makeMockUser();
      User.findOne.mockResolvedValue(mockUser);
      mockUser.isPasswordMatch.mockResolvedValue(false);

      await authService.login('alice@example.com', 'wrong').catch(() => {});
      expect(tokenService.generateAuthTokens).not.toHaveBeenCalled();
    });

    test('does NOT call updateLastLogin when account is inactive', async () => {
      const inactiveUser = makeMockUser({ isActive: false });
      User.findOne.mockResolvedValue(inactiveUser);

      await authService.login('alice@example.com', 'pass').catch(() => {});
      expect(inactiveUser.updateLastLogin).not.toHaveBeenCalled();
    });

    test('does NOT call updateLastLogin when password is wrong', async () => {
      const mockUser = makeMockUser();
      User.findOne.mockResolvedValue(mockUser);
      mockUser.isPasswordMatch.mockResolvedValue(false);

      await authService.login('alice@example.com', 'wrong').catch(() => {});
      expect(mockUser.updateLastLogin).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // logout
  // NOTE: Token is not imported in auth.service.js (Bug 2) — mocked via global.Token
  // ══════════════════════════════════════════════════════════════════════════
  describe('logout', () => {
    test('removes the refresh token document when found', async () => {
      const mockDoc = makeMockTokenDoc();
      MockToken.findOne.mockResolvedValue(mockDoc);

      await authService.logout('valid_refresh_token');

      expect(MockToken.findOne).toHaveBeenCalledWith({
        token: 'valid_refresh_token',
        type: tokenTypes.REFRESH,
        blacklisted: false,
      });
      expect(mockDoc.remove).toHaveBeenCalled();
    });

    test('throws ApiError(404) when refresh token is not found', async () => {
      MockToken.findOne.mockResolvedValue(null);

      await expect(authService.logout('nonexistent_token')).rejects.toMatchObject({
        statusCode: 404,
        message: 'Not found',
      });
    });

    test('queries Token with blacklisted:false to avoid already-revoked tokens', async () => {
      MockToken.findOne.mockResolvedValue(null);
      await authService.logout('tok').catch(() => {});
      expect(MockToken.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ blacklisted: false })
      );
    });

    test('does not call remove when token is not found', async () => {
      const mockDoc = makeMockTokenDoc();
      MockToken.findOne.mockResolvedValue(null);

      await authService.logout('nonexistent_token').catch(() => {});
      expect(mockDoc.remove).not.toHaveBeenCalled();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // refreshAuth
  // ══════════════════════════════════════════════════════════════════════════
  describe('refreshAuth', () => {
    test('returns new tokens when refresh token is valid and user exists', async () => {
      const mockDoc = makeMockTokenDoc();
      const mockUser = makeMockUser();
      tokenService.verifyToken.mockResolvedValue(mockDoc);
      User.findById.mockResolvedValue(mockUser);
      tokenService.generateAuthTokens.mockReturnValue(MOCK_TOKENS);

      const result = await authService.refreshAuth('valid_refresh_token');

      expect(result).toBe(MOCK_TOKENS);
    });

    test('calls tokenService.verifyToken with REFRESH type', async () => {
      const mockDoc = makeMockTokenDoc();
      tokenService.verifyToken.mockResolvedValue(mockDoc);
      User.findById.mockResolvedValue(makeMockUser());
      tokenService.generateAuthTokens.mockReturnValue(MOCK_TOKENS);

      await authService.refreshAuth('valid_refresh_token');
      expect(tokenService.verifyToken).toHaveBeenCalledWith(
        'valid_refresh_token',
        tokenTypes.REFRESH
      );
    });

    test('calls User.findById with the user from the token doc', async () => {
      const mockDoc = makeMockTokenDoc({ user: 'user_abc123' });
      tokenService.verifyToken.mockResolvedValue(mockDoc);
      User.findById.mockResolvedValue(makeMockUser());
      tokenService.generateAuthTokens.mockReturnValue(MOCK_TOKENS);

      await authService.refreshAuth('valid_refresh_token');
      expect(User.findById).toHaveBeenCalledWith('user_abc123');
    });

    test('removes the old refresh token after use (token rotation)', async () => {
      const mockDoc = makeMockTokenDoc();
      tokenService.verifyToken.mockResolvedValue(mockDoc);
      User.findById.mockResolvedValue(makeMockUser());
      tokenService.generateAuthTokens.mockReturnValue(MOCK_TOKENS);

      await authService.refreshAuth('valid_refresh_token');
      expect(mockDoc.remove).toHaveBeenCalled();
    });

    test('throws ApiError(401) when token verification fails', async () => {
      tokenService.verifyToken.mockRejectedValue(new Error('Token expired'));

      await expect(authService.refreshAuth('expired_token')).rejects.toMatchObject({
        statusCode: 401,
        message: 'Please authenticate',
      });
    });

    test('throws ApiError(401) when user no longer exists', async () => {
      const mockDoc = makeMockTokenDoc();
      tokenService.verifyToken.mockResolvedValue(mockDoc);
      User.findById.mockResolvedValue(null);

      await expect(authService.refreshAuth('valid_token')).rejects.toMatchObject({
        statusCode: 401,
        message: 'Please authenticate',
      });
    });

    test('wraps all errors as ApiError(401) — does not leak internal errors', async () => {
      tokenService.verifyToken.mockRejectedValue(new Error('Database connection failed'));

      const error = await authService.refreshAuth('any_token').catch((e) => e);
      expect(error.name).toBe('ApiError');
      expect(error.statusCode).toBe(401);
      expect(error.message).not.toContain('Database');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // resetPassword
  // NOTE: Token is not imported in auth.service.js (Bug 2) — mocked via global.Token
  // ══════════════════════════════════════════════════════════════════════════
  describe('resetPassword', () => {
    test('resets user password and cleans up tokens on success', async () => {
      const mockDoc = makeMockTokenDoc();
      const mockUser = makeMockUser();
      tokenService.verifyToken.mockResolvedValue(mockDoc);
      User.findById.mockResolvedValue(mockUser);

      await authService.resetPassword('reset_token_abc', 'newSecurePass!99');

      expect(mockUser.password).toBe('newSecurePass!99');
      expect(mockUser.save).toHaveBeenCalled();
    });

    test('calls tokenService.verifyToken with RESET_PASSWORD type', async () => {
      const mockDoc = makeMockTokenDoc();
      tokenService.verifyToken.mockResolvedValue(mockDoc);
      User.findById.mockResolvedValue(makeMockUser());

      await authService.resetPassword('reset_tok', 'newpass');
      expect(tokenService.verifyToken).toHaveBeenCalledWith('reset_tok', tokenTypes.RESET_PASSWORD);
    });

    test('deletes all REFRESH tokens for the user after password reset', async () => {
      const mockDoc = makeMockTokenDoc({ user: 'user_abc123' });
      const mockUser = makeMockUser({ id: 'user_abc123' });
      tokenService.verifyToken.mockResolvedValue(mockDoc);
      User.findById.mockResolvedValue(mockUser);

      await authService.resetPassword('reset_tok', 'newpass');
      expect(MockToken.deleteMany).toHaveBeenCalledWith({
        user: 'user_abc123',
        type: tokenTypes.REFRESH,
      });
    });

    test('removes the used reset token after password reset', async () => {
      const mockDoc = makeMockTokenDoc();
      tokenService.verifyToken.mockResolvedValue(mockDoc);
      User.findById.mockResolvedValue(makeMockUser());

      await authService.resetPassword('reset_tok', 'newpass');
      expect(mockDoc.remove).toHaveBeenCalled();
    });

    test('throws ApiError(401) when reset token verification fails', async () => {
      tokenService.verifyToken.mockRejectedValue(new Error('Invalid reset token'));

      await expect(authService.resetPassword('bad_token', 'newpass')).rejects.toMatchObject({
        statusCode: 401,
        message: 'Password reset failed',
      });
    });

    test('throws ApiError(401) when user no longer exists', async () => {
      const mockDoc = makeMockTokenDoc();
      tokenService.verifyToken.mockResolvedValue(mockDoc);
      User.findById.mockResolvedValue(null);

      await expect(authService.resetPassword('valid_token', 'newpass')).rejects.toMatchObject({
        statusCode: 401,
        message: 'Password reset failed',
      });
    });

    test('wraps all errors as ApiError(401) — does not leak internal errors', async () => {
      tokenService.verifyToken.mockRejectedValue(new Error('DB timeout'));

      const error = await authService.resetPassword('tok', 'newpass').catch((e) => e);
      expect(error.name).toBe('ApiError');
      expect(error.message).toBe('Password reset failed');
    });

    test('assigns newPassword to user.password before saving', async () => {
      const mockDoc = makeMockTokenDoc();
      const mockUser = makeMockUser({ password: 'old_hashed_password' });
      tokenService.verifyToken.mockResolvedValue(mockDoc);
      User.findById.mockResolvedValue(mockUser);

      await authService.resetPassword('reset_tok', 'brandNewPassword123!');
      expect(mockUser.password).toBe('brandNewPassword123!');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // verifyEmail
  // ══════════════════════════════════════════════════════════════════════════
  describe('verifyEmail', () => {
    test('marks user isEmailVerified as true and saves', async () => {
      const mockDoc = makeMockTokenDoc();
      const mockUser = makeMockUser({ isEmailVerified: false });
      tokenService.verifyToken.mockResolvedValue(mockDoc);
      User.findById.mockResolvedValue(mockUser);

      await authService.verifyEmail('verify_token_abc');

      expect(mockUser.isEmailVerified).toBe(true);
      expect(mockUser.save).toHaveBeenCalled();
    });

    test('calls tokenService.verifyToken with VERIFY_EMAIL type', async () => {
      const mockDoc = makeMockTokenDoc();
      tokenService.verifyToken.mockResolvedValue(mockDoc);
      User.findById.mockResolvedValue(makeMockUser());

      await authService.verifyEmail('verify_token_abc');
      expect(tokenService.verifyToken).toHaveBeenCalledWith(
        'verify_token_abc',
        tokenTypes.VERIFY_EMAIL
      );
    });

    test('calls User.findById with user from the token doc', async () => {
      const mockDoc = makeMockTokenDoc({ user: 'user_abc123' });
      tokenService.verifyToken.mockResolvedValue(mockDoc);
      User.findById.mockResolvedValue(makeMockUser());

      await authService.verifyEmail('verify_token_abc');
      expect(User.findById).toHaveBeenCalledWith('user_abc123');
    });

    test('removes the verification token after use', async () => {
      const mockDoc = makeMockTokenDoc();
      tokenService.verifyToken.mockResolvedValue(mockDoc);
      User.findById.mockResolvedValue(makeMockUser());

      await authService.verifyEmail('verify_token_abc');
      expect(mockDoc.remove).toHaveBeenCalled();
    });

    test('throws ApiError(401) when verify token is invalid', async () => {
      tokenService.verifyToken.mockRejectedValue(new Error('Token expired'));

      await expect(authService.verifyEmail('bad_token')).rejects.toMatchObject({
        statusCode: 401,
        message: 'Email verification failed',
      });
    });

    test('throws ApiError(401) when user no longer exists', async () => {
      const mockDoc = makeMockTokenDoc();
      tokenService.verifyToken.mockResolvedValue(mockDoc);
      User.findById.mockResolvedValue(null);

      await expect(authService.verifyEmail('valid_token')).rejects.toMatchObject({
        statusCode: 401,
        message: 'Email verification failed',
      });
    });

    test('wraps all errors as ApiError(401) — does not leak internal error details', async () => {
      tokenService.verifyToken.mockRejectedValue(new Error('Some internal DB error'));

      const error = await authService.verifyEmail('tok').catch((e) => e);
      expect(error.name).toBe('ApiError');
      expect(error.message).toBe('Email verification failed');
    });

    test('does NOT call user.save when token verification fails', async () => {
      const mockUser = makeMockUser();
      tokenService.verifyToken.mockRejectedValue(new Error('fail'));

      await authService.verifyEmail('bad_token').catch(() => {});
      expect(mockUser.save).not.toHaveBeenCalled();
    });
  });
});
