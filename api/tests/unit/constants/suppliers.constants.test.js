'use strict';

const {
  DEFAULTS,
  SUPPLIER_STATUS,
  GST_TYPES,
  GST_STATUS,
  PAYMENT_TERMS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  HTTP_STATUS,
  RESPONSE_TYPES,
  FIELD_LIMITS,
  VALIDATION_PATTERNS,
} = require('../../../src/constants/suppliers.constants');

describe('suppliers.constants', () => {
  test('exports default values and enums', () => {
    expect(DEFAULTS).toEqual({
      COUNTRY: 'India',
      GST: 'disable',
      GST_TYPE: 'consumer',
      BALANCE: 0,
      PAYMENT_TERMS: 'immediate',
      CREDIT_LIMIT: 0,
    });

    expect(SUPPLIER_STATUS).toEqual({
      ACTIVE: 'active',
      INACTIVE: 'inactive',
      BLOCKED: 'blocked',
    });

    expect(GST_TYPES).toEqual({
      CONSUMER: 'consumer',
      REGULAR: 'regular',
      COMPOSITE: 'composite',
      UNREGISTERED: 'unregistered',
    });

    expect(GST_STATUS).toEqual({
      ENABLE: 'enable',
      DISABLE: 'disable',
    });

    expect(PAYMENT_TERMS).toEqual({
      IMMEDIATE: 'immediate',
      NET_7: 'net_7',
      NET_15: 'net_15',
      NET_30: 'net_30',
      NET_45: 'net_45',
      NET_60: 'net_60',
      NET_90: 'net_90',
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
      SUPPLIER_NOT_FOUND: 'Supplier not found',
      SUPPLIER_NAME_REQUIRED: 'Supplier name is required',
      EMAIL_EXISTS: 'Supplier with this email already exists',
      PHONE_EXISTS: 'Supplier with this phone number already exists',
      INVALID_EMAIL: 'Invalid email address',
      INVALID_PHONE: 'Invalid phone number',
      INVALID_GST_NUMBER: 'Invalid GST number',
      VALIDATION_ERROR: 'Validation Error',
      BRANCH_REQUIRED: 'Branch ID is required',
      DELETE_FAILED: 'Failed to delete supplier',
      UPDATE_FAILED: 'Failed to update supplier',
      CREATE_FAILED: 'Failed to create supplier',
      CREDIT_LIMIT_EXCEEDED: 'Credit limit exceeded for this supplier',
    });

    expect(SUCCESS_MESSAGES).toMatchObject({
      SUPPLIER_CREATED: 'Supplier added successfully',
      SUPPLIER_UPDATED: 'Supplier updated successfully',
      SUPPLIER_DELETED: 'Supplier deleted successfully',
      SUPPLIERS_DELETED: 'Suppliers deleted successfully',
      SUPPLIERS_RETRIEVED: 'Suppliers retrieved successfully',
      SUPPLIER_RETRIEVED: 'Supplier retrieved successfully',
      PREFERENCES_UPDATED: 'Supplier preferences updated successfully',
      SUPPLIERS_IMPORTED: 'Suppliers imported successfully',
      SUPPLIERS_EXPORTED: 'Suppliers exported successfully',
    });

    expect(FIELD_LIMITS).toEqual({
      NAME_MIN: 1,
      NAME_MAX: 100,
      EMAIL_MAX: 250,
      PHONE_MIN: 10,
      PHONE_MAX: 15,
      ADDRESS_MAX: 500,
      NOTES_MAX: 1000,
      GST_NUMBER_LENGTH: 15,
      PINCODE_LENGTH: 6,
      COMPANY_NAME_MAX: 200,
    });

    expect(VALIDATION_PATTERNS.EMAIL).toBeInstanceOf(RegExp);
    expect(VALIDATION_PATTERNS.PHONE).toBeInstanceOf(RegExp);
    expect(VALIDATION_PATTERNS.GST_NUMBER).toBeInstanceOf(RegExp);
    expect(VALIDATION_PATTERNS.PINCODE).toBeInstanceOf(RegExp);
  });
});
