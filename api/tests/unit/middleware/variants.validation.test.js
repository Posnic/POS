'use strict';

jest.mock('../../../src/constants/variants.constants', () => ({
  VALIDATION_RULES: {
    NAME: { MIN_LENGTH: 1, MAX_LENGTH: 20 },
    SEARCH_QUERY: { MIN_LENGTH: 1 },
  },
  ERROR_MESSAGES: {
    VARIANT_NAME_REQUIRED: 'name required',
    VARIANT_ID_REQUIRED: 'id required',
    INVALID_VARIANT_ID: 'invalid id',
    UID_MISSING: 'uid missing',
    NO_VARIANT_IDS_PROVIDED: 'no ids',
    NO_VARIANTS_SELECTED: 'no variants',
    SEARCH_QUERY_TOO_SHORT: 'too short',
    INCORRECT_FILTER_FORMAT: 'bad filter',
  },
}));

jest.mock('express-validator', () => {
  const chain = () => ({
    trim: jest.fn().mockReturnThis(),
    notEmpty: jest.fn().mockReturnThis(),
    withMessage: jest.fn().mockReturnThis(),
    isLength: jest.fn().mockReturnThis(),
    optional: jest.fn().mockReturnThis(),
    isArray: jest.fn().mockReturnThis(),
    isMongoId: jest.fn().mockReturnThis(),
    isInt: jest.fn().mockReturnThis(),
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

const variants = require('../../../src/middleware/variants.validation');

describe('variants.validation', () => {
  test('exports variant validators', () => {
    expect(variants.createVariantValidation.length).toBeGreaterThan(0);
    expect(variants.getPaginatedVariantsValidation.length).toBeGreaterThan(0);
    expect(variants.getByFieldValidation.length).toBeGreaterThan(0);
  });
});
