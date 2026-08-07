'use strict';

jest.mock('../../../src/constants/categories.constants', () => ({
  FIELD_LIMITS: {
    NAME_MIN: 2,
    NAME_MAX: 50,
    DESCRIPTION_MAX: 100,
    IMAGE_MAX: 200,
    DISCOUNT_MIN: 0,
    DISCOUNT_MAX: 100,
  },
  VALIDATION_PATTERNS: {
    NAME: /^[A-Za-z ]+$/,
  },
}));

jest.mock('express-validator', () => {
  const chain = () => ({
    trim: jest.fn().mockReturnThis(),
    notEmpty: jest.fn().mockReturnThis(),
    withMessage: jest.fn().mockReturnThis(),
    isLength: jest.fn().mockReturnThis(),
    matches: jest.fn().mockReturnThis(),
    optional: jest.fn().mockReturnThis(),
    isFloat: jest.fn().mockReturnThis(),
    isBoolean: jest.fn().mockReturnThis(),
    isInt: jest.fn().mockReturnThis(),
    isMongoId: jest.fn().mockReturnThis(),
    isArray: jest.fn().mockReturnThis(),
    isIn: jest.fn().mockReturnThis(),
    custom: jest.fn().mockReturnThis(),
    run: jest.fn(),
  });
  return {
    body: jest.fn(() => chain()),
    query: jest.fn(() => chain()),
    param: jest.fn(() => chain()),
  };
});

const categoriesValidation = require('../../../src/middleware/categories.validation');

describe('categories.validation', () => {
  test('exports category validation arrays', () => {
    expect(categoriesValidation.validateCreateCategory.length).toBeGreaterThan(0);
    expect(categoriesValidation.validateUpdateCategory.length).toBeGreaterThan(0);
    expect(categoriesValidation.validateSearch.length).toBeGreaterThan(0);
    expect(categoriesValidation.validateImport.length).toBeGreaterThan(0);
  });
});
