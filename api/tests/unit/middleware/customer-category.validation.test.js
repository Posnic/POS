'use strict';

jest.mock('express-validator', () => {
  const chain = () => ({
    trim: jest.fn().mockReturnThis(),
    notEmpty: jest.fn().mockReturnThis(),
    withMessage: jest.fn().mockReturnThis(),
    isLength: jest.fn().mockReturnThis(),
    optional: jest.fn().mockReturnThis(),
    isMongoId: jest.fn().mockReturnThis(),
    isArray: jest.fn().mockReturnThis(),
    isInt: jest.fn().mockReturnThis(),
    custom: jest.fn().mockReturnThis(),
    run: jest.fn(),
  });

  return {
    body: jest.fn(() => chain()),
    query: jest.fn(() => chain()),
    param: jest.fn(() => chain()),
  };
});

jest.mock('../../../src/constants/customer-category.constants', () => ({
  FIELD_LIMITS: {
    NAME_MIN: 2,
    NAME_MAX: 100,
    DESCRIPTION_MAX: 250,
  },
}));

const customerCategoryValidation = require('../../../src/middleware/customer-category.validation');

describe('customer-category.validation', () => {
  test('exports validation arrays', () => {
    expect(customerCategoryValidation.validateCreateCustomerCategory).toHaveLength(2);
    expect(customerCategoryValidation.validateUpdateCustomerCategory).toHaveLength(3);
    expect(customerCategoryValidation.validateCustomerCategoryId).toHaveLength(1);
    expect(customerCategoryValidation.validateBulkDelete).toHaveLength(1);
    expect(customerCategoryValidation.validateSearch).toHaveLength(3);
    expect(customerCategoryValidation.validateImport).toHaveLength(2);
  });
});
