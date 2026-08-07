'use strict';

jest.mock('../../../src/constants/suppliers.constants', () => ({
  FIELD_LIMITS: {
    NAME_MIN: 2,
    NAME_MAX: 20,
    COMPANY_NAME_MAX: 50,
    EMAIL_MAX: 50,
    ADDRESS_MAX: 100,
    NOTES_MAX: 100,
  },
  VALIDATION_PATTERNS: {
    EMAIL: /^[^@]+@[^@]+$/,
    PHONE: /^[0-9]+$/,
    GST_NUMBER: /^[A-Z0-9]+$/,
    PINCODE: /^[0-9]+$/,
  },
}));

jest.mock('express-validator', () => {
  const chain = () => ({
    trim: jest.fn().mockReturnThis(),
    notEmpty: jest.fn().mockReturnThis(),
    withMessage: jest.fn().mockReturnThis(),
    isLength: jest.fn().mockReturnThis(),
    optional: jest.fn().mockReturnThis(),
    isEmail: jest.fn().mockReturnThis(),
    matches: jest.fn().mockReturnThis(),
    custom: jest.fn().mockReturnThis(),
    isFloat: jest.fn().mockReturnThis(),
    isMongoId: jest.fn().mockReturnThis(),
    isArray: jest.fn().mockReturnThis(),
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

const suppliers = require('../../../src/middleware/suppliers.validation');

describe('suppliers.validation', () => {
  test('exports supplier validators', () => {
    expect(suppliers.validateCreateSupplier.length).toBeGreaterThan(0);
    expect(suppliers.validateImport.length).toBeGreaterThan(0);
  });
});
