'use strict';

const {
  DEFAULTS,
  CATEGORY_STATUS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  HTTP_STATUS,
  RESPONSE_TYPES,
  FIELD_LIMITS,
  VALIDATION_PATTERNS,
} = require('../../../src/constants/categories.constants');

describe('categories.constants', () => {
  test('exports the expected default values', () => {
    expect(DEFAULTS).toEqual({
      IMAGE: 'category.svg',
      DISCOUNT_AMOUNT: 0,
      DISCOUNT_PERCENTAGE: 0,
      IS_ACTIVE: true,
      DESCRIPTION: '',
      SORT_ORDER: 0,
    });
  });

  test('exports the expected category statuses', () => {
    expect(CATEGORY_STATUS).toEqual({
      ACTIVE: 'active',
      INACTIVE: 'inactive',
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
      CATEGORY_NOT_FOUND: 'Category not found',
      CATEGORY_NAME_REQUIRED: 'Category name is required',
      NAME_EXISTS: 'Category with this name already exists',
      INVALID_DISCOUNT: 'Invalid discount value',
      VALIDATION_ERROR: 'Validation Error',
      BRANCH_REQUIRED: 'Branch ID is required',
      DELETE_FAILED: 'Failed to delete category',
      UPDATE_FAILED: 'Failed to update category',
      CREATE_FAILED: 'Failed to create category',
      CANNOT_DELETE_WITH_ITEMS: 'You cannot delete a category that still has items',
    });

    expect(SUCCESS_MESSAGES).toMatchObject({
      CATEGORY_CREATED: 'Category created',
      CATEGORY_UPDATED: 'Category updated',
      CATEGORY_DELETED: 'Category deleted',
      CATEGORIES_DELETED: 'Categories deleted',
      CATEGORIES_RETRIEVED: 'Categories retrieved',
      CATEGORY_RETRIEVED: 'Category retrieved',
      CATEGORIES_IMPORTED: 'Categories imported',
      CATEGORIES_EXPORTED: 'Categories exported',
    });

    expect(FIELD_LIMITS).toEqual({
      NAME_MIN: 1,
      NAME_MAX: 100,
      DESCRIPTION_MAX: 500,
      IMAGE_MAX: 255,
      DISCOUNT_MIN: 0,
      DISCOUNT_MAX: 100,
    });

    expect(VALIDATION_PATTERNS.NAME).toBeInstanceOf(RegExp);
    expect(VALIDATION_PATTERNS.IMAGE_URL).toBeInstanceOf(RegExp);
  });
});
