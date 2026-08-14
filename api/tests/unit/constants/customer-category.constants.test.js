'use strict';

const {
  DEFAULTS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  HTTP_STATUS,
  RESPONSE_TYPES,
  FIELD_LIMITS,
  VALIDATION_PATTERNS,
} = require('../../../src/constants/customer-category.constants');

describe('customer-category.constants', () => {
  test('exports default values', () => {
    expect(DEFAULTS).toEqual({
      DESCRIPTION: '',
      IS_ACTIVE: true,
    });
  });

  test('exports response metadata', () => {
    expect(RESPONSE_TYPES).toEqual({
      SUCCESS: 'success',
      ERROR: 'error',
      EXIST: 'exist',
      NONE: 'none',
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
  });

  test('exports messages and validation rules', () => {
    expect(ERROR_MESSAGES).toMatchObject({
      CATEGORY_NOT_FOUND: 'Customer category not found',
      CATEGORY_NAME_REQUIRED: 'Customer category name is required',
      CATEGORY_EXISTS: 'This category details already exist in our system',
      VALIDATION_ERROR: 'Validation Error',
      BRANCH_REQUIRED: 'Branch ID is required',
      DELETE_FAILED: 'Failed to delete customer category',
      UPDATE_FAILED: 'Failed to update customer category',
      CREATE_FAILED: 'Failed to create customer category',
      IMPORT_FAILED: 'Failed to import customer categories',
      EXPORT_FAILED: 'Failed to export customer categories',
    });

    expect(SUCCESS_MESSAGES).toMatchObject({
      CATEGORY_CREATED: 'Customer category created',
      CATEGORY_UPDATED: 'Customer category updated',
      CATEGORY_DELETED: 'Customer category deleted',
      CATEGORIES_DELETED: 'Customer categories deleted',
      CATEGORIES_RETRIEVED: 'Customer categories retrieved',
      CATEGORY_RETRIEVED: 'Customer category retrieved',
      CATEGORIES_IMPORTED: 'Customer categories imported',
      CATEGORIES_EXPORTED: 'Customer categories exported',
    });

    expect(FIELD_LIMITS).toEqual({
      NAME_MIN: 1,
      NAME_MAX: 100,
      DESCRIPTION_MAX: 500,
    });

    expect(VALIDATION_PATTERNS.NAME).toBeInstanceOf(RegExp);
  });
});
