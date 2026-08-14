'use strict';

const {
  DEFAULTS,
  BRANCH_STATUS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  HTTP_STATUS,
  RESPONSE_TYPES,
  VALIDATION,
  PAGINATION,
} = require('../../../src/constants/branches.constants');

describe('branches.constants', () => {
  test('exports the expected default values', () => {
    expect(DEFAULTS).toEqual({
      LOGO: 'store.png',
      TIME_ZONE: 'Asia/Calcutta',
      TIME_FORMAT: 'enable',
      LANGUAGE: 'english',
      CURRENCY: 'INR',
      CURRENCY_TEXT: '₹',
      THEME: 'default',
      PRINT_TYPE: 'standard',
    });
  });

  test('exports the expected branch statuses', () => {
    expect(BRANCH_STATUS).toEqual({
      ACTIVE: 'active',
      INACTIVE: 'inactive',
      SUSPENDED: 'suspended',
    });
  });

  test('exports the expected response metadata', () => {
    expect(RESPONSE_TYPES).toEqual({
      SUCCESS: 'success',
      ERROR: 'error',
      EXIST: 'exist',
    });

    expect(HTTP_STATUS).toMatchObject({
      OK: 200,
      CREATED: 201,
      BAD_REQUEST: 400,
      UNAUTHORIZED: 401,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      NOT_ACCEPTABLE: 406,
      INTERNAL_ERROR: 500,
    });
  });

  test('exports the expected messages and validation values', () => {
    expect(ERROR_MESSAGES).toMatchObject({
      NOT_FOUND: 'Branch not found',
      ID_REQUIRED: 'Branch ID is required',
      ID_INVALID: 'Invalid branch ID format',
      UNAUTHORIZED: 'Unauthorized',
      CREATE_FAILED: 'Failed to create branch',
      UPDATE_FAILED: 'Failed to update branch',
      DELETE_FAILED: 'Failed to delete branch',
      EXPORT_FAILED: 'Failed to export branches',
      DETAILS_NOT_FOUND: 'Branch details not found',
      DUPLICATE_BRANCH: 'Branch already exists',
      NO_PERMISSION: 'You do not have permission to perform this action',
    });

    expect(SUCCESS_MESSAGES).toMatchObject({
      CREATED: 'Branch created',
      UPDATED: 'Branch updated',
      DELETED: 'Branch deleted',
      RETRIEVED: 'Branch retrieved',
      LIST_RETRIEVED: 'Branch list retrieved',
      EXPORTED: 'Branches exported',
      STATUS_TOGGLED: 'Branch status updated',
      PAYMENT_GATEWAY_RESET: 'Payment gateway settings reset',
      PHONEPE_GATEWAY_RESET: 'PhonePe payment gateway settings reset',
      EMAIL_SETTINGS_RESET: 'Email settings reset',
    });

    expect(VALIDATION).toEqual({
      NAME_MIN: 3,
      NAME_MAX: 250,
      PHONE_MIN: 3,
      PHONE_MAX: 20,
      EMAIL_MAX: 250,
      ADDRESS_MIN: 3,
      ADDRESS_MAX: 500,
      SEARCH_QUERY_MIN: 2,
    });

    expect(PAGINATION).toEqual({
      DEFAULT_LIMIT: 5,
      DEFAULT_PAGE: 1,
      MAX_LIMIT: 100,
    });
  });
});
