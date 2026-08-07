'use strict';

const {
  DEFAULTS,
  CUSTOMER_STATUS,
  GST_TYPES,
  GST_STATUS,
  LOYALTY_TIERS,
  LOYALTY_THRESHOLDS,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  HTTP_STATUS,
  RESPONSE_TYPES,
  FIELD_LIMITS,
  VALIDATION_PATTERNS,
} = require('../../../src/constants/customers.constants');

describe('customers.constants', () => {
  test('exports default values and status enums', () => {
    expect(DEFAULTS).toEqual({
      COUNTRY: 'India',
      GST: 'disable',
      GST_TYPE: 'consumer',
      BALANCE: 0,
      PARTIAL_BALANCE: false,
      LOYALTY_TIER: 'bronze',
      LOYALTY_POINTS: 0,
    });

    expect(CUSTOMER_STATUS).toEqual({
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

    expect(LOYALTY_TIERS).toEqual({
      BRONZE: 'bronze',
      SILVER: 'silver',
      GOLD: 'gold',
      PLATINUM: 'platinum',
    });

    expect(LOYALTY_THRESHOLDS).toEqual({
      BRONZE: 0,
      SILVER: 1000,
      GOLD: 5000,
      PLATINUM: 10000,
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
      CUSTOMER_NOT_FOUND: 'Customer not found',
      CUSTOMER_NAME_REQUIRED: 'Customer name is required',
      EMAIL_EXISTS: 'Customer with this email already exists',
      PHONE_EXISTS: 'Customer with this phone number already exists',
      INVALID_EMAIL: 'Invalid email address',
      INVALID_PHONE: 'Invalid phone number',
      INVALID_GST_NUMBER: 'Invalid GST number',
      VALIDATION_ERROR: 'Validation Error',
      BRANCH_REQUIRED: 'Branch ID is required',
      INSUFFICIENT_POINTS: 'Insufficient loyalty points',
      INVALID_POINTS: 'Points must be greater than 0',
      DELETE_FAILED: 'Failed to delete customer',
      UPDATE_FAILED: 'Failed to update customer',
      CREATE_FAILED: 'Failed to create customer',
      PARTIAL_BALANCE_DISABLED: 'Partial balance is not enabled for this customer',
    });

    expect(SUCCESS_MESSAGES).toMatchObject({
      CUSTOMER_CREATED: 'Customer added successfully',
      CUSTOMER_UPDATED: 'Customer updated successfully',
      CUSTOMER_DELETED: 'Customer deleted successfully',
      CUSTOMERS_DELETED: 'Customers deleted successfully',
      CUSTOMERS_RETRIEVED: 'Customers retrieved successfully',
      CUSTOMER_RETRIEVED: 'Customer retrieved successfully',
      POINTS_ADDED: 'Loyalty points added successfully',
      POINTS_REDEEMED: 'Loyalty points redeemed successfully',
      PREFERENCES_UPDATED: 'Customer preferences updated successfully',
      CUSTOMERS_IMPORTED: 'Customers imported successfully',
      CUSTOMERS_EXPORTED: 'Customers exported successfully',
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
    });

    expect(VALIDATION_PATTERNS.EMAIL).toBeInstanceOf(RegExp);
    expect(VALIDATION_PATTERNS.PHONE).toBeInstanceOf(RegExp);
    expect(VALIDATION_PATTERNS.GST_NUMBER).toBeInstanceOf(RegExp);
    expect(VALIDATION_PATTERNS.PINCODE).toBeInstanceOf(RegExp);
  });
});
