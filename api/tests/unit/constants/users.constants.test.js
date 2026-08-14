'use strict';

const {
  DEFAULTS,
  USER_STATUS,
  USER_TYPES,
  AUTH,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  HTTP_STATUS,
  LANGUAGES,
  THEMES,
  RESPONSE_TYPES,
  ACL_MODULES,
  PERMISSIONS,
} = require('../../../src/constants/users.constants');

describe('users.constants', () => {
  test('exports default values and enums', () => {
    expect(DEFAULTS).toEqual({
      BRANCH_IMAGE: 'store.png',
      PRINTING_DESIGN: 'standard',
      PRINTING_MAX_CHAR: 'default',
      CUSTOMER_NAME: '',
      CUSTOMER_PHONE: '',
      CUSTOMER_EMAIL: '',
      CUSTOMER_ADDRESS: '',
    });

    expect(USER_STATUS).toEqual({
      ACTIVE: 'active',
      INACTIVE: 'inactive',
      SUSPENDED: 'suspended',
      PENDING: 'pending',
    });

    expect(USER_TYPES).toEqual({
      SUPER_ADMIN: 'super_admin',
      ADMIN: 'admin',
      MANAGER: 'manager',
      USER: 'user',
      API: 'api',
    });

    expect(AUTH).toEqual({
      JWT_COOKIE_EXPIRES_DAYS: 7,
      PASSWORD_RESET_EXPIRE_MINUTES: 10,
      SSO_TOKEN_EXPIRE_MINUTES: 10,
      ACCOUNT_LOCK_MINUTES: 30,
      MAX_LOGIN_ATTEMPTS: 5,
      MIN_PASSWORD_LENGTH: 5,
      MAX_PASSWORD_LENGTH: 20,
      MIN_USERNAME_LENGTH: 3,
      MAX_USERNAME_LENGTH: 250,
    });
  });

  test('exports response metadata and app enums', () => {
    expect(RESPONSE_TYPES).toEqual({
      SUCCESS: 'success',
      ERROR: 'error',
      EXIST: 'exist',
      NONE: 'none',
      INCORRECT: 'incorrect',
    });

    expect(HTTP_STATUS).toMatchObject({
      OK: 200,
      CREATED: 201,
      BAD_REQUEST: 400,
      UNAUTHORIZED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      NOT_ACCEPTABLE: 406,
      CONFLICT: 409,
      INTERNAL_ERROR: 500,
    });

    expect(LANGUAGES).toEqual({
      ENGLISH: 'en',
      SPANISH: 'es',
      FRENCH: 'fr',
      GERMAN: 'de',
      HINDI: 'hi',
      TAMIL: 'ta',
      TELUGU: 'te',
      KANNADA: 'kn',
      MALAYALAM: 'ml',
    });

    expect(THEMES).toEqual({
      LIGHT: 'light',
      DARK: 'dark',
      SYSTEM: 'system',
    });

    expect(ACL_MODULES).toEqual([
      'dashboard',
      'sales',
      'receiving',
      'customer',
      'supplier',
      'category',
      'item',
      'expense',
      'branch',
      'report',
      'user',
    ]);

    expect(PERMISSIONS).toEqual({
      READ: 'read',
      WRITE: 'write',
      DELETE: 'delete',
    });
  });

  test('exports message catalogs', () => {
    expect(ERROR_MESSAGES).toMatchObject({
      AUTH_REQUIRED: 'Authentication required',
      USER_NOT_FOUND: 'User not found',
      INVALID_CREDENTIALS: 'Incorrect username or password',
      NO_BRANCHES: 'No branch is assigned to this user',
      INVALID_BRANCH: 'No valid branch is assigned. Please contact your administrator.',
      UNAUTHORIZED: 'Unauthorized',
      VALIDATION_ERROR: 'Validation Error',
      INVALID_BRANCH_ID: 'Invalid branch ID',
      BRANCH_NOT_FOUND: 'Branch not found',
      INVALID_PASSWORD: 'Invalid password',
      PASSWORD_MISMATCH: 'Password mismatch',
      USER_EXISTS: 'User already exists',
      INVALID_USER_KEY: 'Invalid or expired reset link',
      PLAN_LIMIT_REACHED: 'User limit reached for your plan',
      ACCOUNT_LOCKED: 'Account is locked due to multiple failed login attempts',
      INVALID_SSO_TOKEN: 'Invalid or expired SSO token',
    });

    expect(SUCCESS_MESSAGES).toMatchObject({
      LOGIN_SUCCESS: 'Signed in',
      LOGOUT_SUCCESS: 'Signed out',
      BRANCH_CHANGED: 'Branch changed',
      BRANCH_SET: 'Branch set',
      PROFILE_UPDATED: 'Profile updated',
      PASSWORD_UPDATED: 'Password updated',
      USER_CREATED: 'User created',
      USER_UPDATED: 'User updated',
      USER_DELETED: 'User deleted',
      VALID_ADMIN: 'Valid Admin',
      DATA_LOADED: 'Loaded',
    });
  });
});
