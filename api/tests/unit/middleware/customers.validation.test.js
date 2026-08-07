'use strict';

jest.mock('../../../src/constants/customers.constants', () => ({
  FIELD_LIMITS: {
    NAME_MIN: 2,
    NAME_MAX: 50,
    EMAIL_MAX: 100,
    ADDRESS_MAX: 200,
    NOTES_MAX: 300,
  },
  VALIDATION_PATTERNS: {
    EMAIL: /^[^@]+@[^@]+$/,
    PHONE: /^[0-9]{10}$/,
    GST_NUMBER: /^[A-Z0-9]{15}$/,
    PINCODE: /^[0-9]{6}$/,
  },
}));

jest.mock('express-validator', () => {
  const chain = () => ({
    trim: jest.fn().mockReturnThis(),
    notEmpty: jest.fn().mockReturnThis(),
    withMessage: jest.fn().mockReturnThis(),
    isLength: jest.fn().mockReturnThis(),
    optional: jest.fn().mockReturnThis(),
    isMongoId: jest.fn().mockReturnThis(),
    isEmail: jest.fn().mockReturnThis(),
    matches: jest.fn().mockReturnThis(),
    custom: jest.fn().mockReturnThis(),
    isArray: jest.fn().mockReturnThis(),
    isFloat: jest.fn().mockReturnThis(),
    isInt: jest.fn().mockReturnThis(),
    isObject: jest.fn().mockReturnThis(),
    run: jest.fn(),
  });
  return {
    body: jest.fn(() => chain()),
    query: jest.fn(() => chain()),
    param: jest.fn(() => chain()),
  };
});

const customersValidation = require('../../../src/middleware/customers.validation');

describe('customers.validation', () => {
  test('exports expected validation arrays', () => {
    expect(customersValidation.validateCreateCustomer.length).toBeGreaterThan(0);
    expect(customersValidation.validateUpdateCustomer.length).toBeGreaterThan(0);
    expect(customersValidation.validateSearch.length).toBeGreaterThan(0);
    expect(customersValidation.validateImport.length).toBeGreaterThan(0);
  });
});
