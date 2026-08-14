'use strict';

const {
  DEFAULTS,
  INSTALL_STATUS,
  USER_TYPES,
  REGISTER_STATUS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  HTTP_STATUS,
  RESPONSE_TYPES,
  FIELD_LIMITS,
  DEFAULT_ACCESS,
  CLEANUP_COLLECTIONS,
} = require('../../../src/constants/install.constants');

describe('install.constants', () => {
  test('exports default values and enums', () => {
    expect(DEFAULTS).toEqual({
      USER_TYPE: 'super_admin',
      IMAGE: 'user.svg',
      LOGO: 'store.png',
      PLAN_NAME: 'free',
      MAX_SALES: 100,
      PLAN_DURATION_YEARS: 1,
      CURRENCY: '₹',
      CURRENCY_TEXT: 'India Rupee / INR or ₹',
      CURRENCY_TYPE: '₹',
      TIME_ZONE: 'Asia/Kolkata',
      SALES_PREFIX: 'SID',
      RECEIVING_PREFIX: 'RID',
      PRINT_TYPE: 'standard',
      PRINTING_SIZE: 'receipt_medium',
      PRINT_CHARACTER: 'default',
      HEADER_PRINT: 'default',
      FOOTER_PRINT: 'Thank you for shopping...!',
      CLIENT_DATEFORMAT: 'dd/mm/yyyy',
      SERVER_DATEFORMAT: 'd/m/Y',
      DATEFORMAT_TEXT: '01/01/2018 -- dd/mm/yyyy',
      NOTIFICATION_RANGE: '10',
      SMS_TYPE: 'way2sms',
      SMS_AUTO_SEND_TIME: '10:00 am',
      SMS_RETRY_PERIOD: '24',
      SMS_MAX_RETRIES: '2',
      INDIAN_GST: 'gst_off',
      THEME: 'blue',
    });

    expect(INSTALL_STATUS).toEqual({
      SUCCESS: 'success',
      FAILED: 'failed',
      PENDING: 'pending',
    });

    expect(USER_TYPES).toEqual({
      SUPER_ADMIN: 'super_admin',
      ADMIN: 'admin',
      USER: 'user',
    });

    expect(REGISTER_STATUS).toEqual({
      OPEN: 'Open',
      CLOSED: 'Closed',
    });
  });

  test('exports messages, status codes, and limits', () => {
    expect(ERROR_MESSAGES).toMatchObject({
      UNAUTHORIZED: 'Unauthorized',
      VALIDATION_ERROR: 'Validation Error',
      COMPANY_NAME_REQUIRED: 'Company name is required',
      COMPANY_NAME_LENGTH: 'Company name must be between 3 and 160 characters',
      USERNAME_REQUIRED: 'Username is required',
      EMAIL_REQUIRED: 'Email is required',
      VALID_EMAIL_REQUIRED: 'Valid email is required',
      PHONE_LENGTH: 'Phone number must be less than 20 characters',
      LICENSE_ID_REQUIRED: 'License ID is required',
      DUPLICATE_USERNAME: 'This username already exists in our system',
      DUPLICATE_EMAIL: 'This email already exists in our system',
      DUPLICATE_LICENSE: 'This license already exists in our system',
      INSTALLATION_FAILED: 'An error occurred during installation',
      CLEANUP_FAILED: 'An error occurred during cleanup',
      INVALID_KEY_SECRET: 'Invalid installation key or secret',
      BRANCH_LICENSE_REQUIRED: 'Branch and license context required',
      DEMO_DATA_LOAD_FAILED: 'Failed to load demo data',
      DEFAULT_DATA_LOAD_FAILED: 'Failed to load default data',
    });

    expect(SUCCESS_MESSAGES).toEqual({
      ACCOUNT_CREATED: 'Account created',
      CLEANUP_SUCCESS: 'Deleted records across all collections',
      INSTALLATION_COMPLETE: 'Installation completed',
      DEMO_DATA_LOADED: 'Demo data loaded',
      DEFAULT_DATA_LOADED: 'Default data loaded',
    });

    expect(HTTP_STATUS).toMatchObject({
      OK: 200,
      CREATED: 201,
      BAD_REQUEST: 400,
      UNAUTHORIZED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      INTERNAL_ERROR: 500,
    });

    expect(RESPONSE_TYPES).toEqual({
      SUCCESS: 'success',
      ERROR: 'error',
      EXIST: 'exist',
    });

    expect(FIELD_LIMITS).toEqual({
      COMPANY_NAME_MIN: 3,
      COMPANY_NAME_MAX: 160,
      PHONE_MAX: 20,
      USERNAME_MIN: 3,
      USERNAME_MAX: 50,
      EMAIL_MAX: 100,
    });
  });

  test('exports access and cleanup structures', () => {
    expect(DEFAULT_ACCESS).toHaveProperty('dashboard.read', true);
    expect(DEFAULT_ACCESS).toHaveProperty('sales.write', true);
    expect(DEFAULT_ACCESS).toHaveProperty('plan.read', true);
    expect(CLEANUP_COLLECTIONS).toEqual([
      'users',
      'branches',
      'customers',
      'suppliers',
      'categories',
      'items',
      'grouptax',
      'unit',
      'sales',
      'receivings',
      'expenses',
      'stocklogs',
      'payments',
      'reports',
      'notifications',
      'settings',
    ]);
  });
});
