'use strict';

jest.mock('../../../src/constants/receivings.constants', () => ({
  FIELD_LIMITS: {
    SUPPLIER_NAME_MIN: 2,
    SUPPLIER_NAME_MAX: 50,
    MAX_ITEMS: 10,
    NOTES_MAX: 100,
    MAX_IMAGES: 5,
    MAX_IMAGE_SIZE: 1024,
  },
  VALIDATION_PATTERNS: {},
}));

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
    isFloat: jest.fn().mockReturnThis(),
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

const receivingValidation = require('../../../src/middleware/receivings.validation');

describe('receivings.validation', () => {
  test('exports validation arrays', () => {
    expect(receivingValidation.validateCreateReceiving.length).toBeGreaterThan(0);
    expect(receivingValidation.validateUpdateReceiving.length).toBeGreaterThan(0);
    expect(receivingValidation.validateReceivingFilters.length).toBeGreaterThan(0);
    expect(receivingValidation.validateUploadImage.length).toBeGreaterThan(0);
  });
});
