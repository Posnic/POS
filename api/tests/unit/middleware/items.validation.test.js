'use strict';

jest.mock('../../../src/constants/items.constants', () => ({
  FIELD_LIMITS: {
    NAME_MIN: 2,
    NAME_MAX: 50,
    BARCODE_MAX: 30,
    DESCRIPTION_MAX: 200,
  },
  ERROR_MESSAGES: {
    ITEM_NAME_REQUIRED: 'name required',
    ITEM_ID_REQUIRED: 'id required',
  },
}));

jest.mock('mongodb', () => ({
  ObjectId: {
    isValid: jest.fn(),
  },
}));

jest.mock('express-validator', () => {
  const chain = () => ({
    trim: jest.fn().mockReturnThis(),
    notEmpty: jest.fn().mockReturnThis(),
    withMessage: jest.fn().mockReturnThis(),
    isLength: jest.fn().mockReturnThis(),
    isFloat: jest.fn().mockReturnThis(),
    optional: jest.fn().mockReturnThis(),
    isMongoId: jest.fn().mockReturnThis(),
  });
  return { body: jest.fn(() => chain()), param: jest.fn(() => chain()) };
});

const { ensureValidItemIdParam } = require('../../../src/middleware/items.validation');

describe('items.validation', () => {
  test('exports create/update validators', () => {
    const validations = require('../../../src/middleware/items.validation');
    expect(validations.validateCreateItem.length).toBeGreaterThan(0);
    expect(validations.validateUpdateItem.length).toBeGreaterThan(0);
  });

  test('ensureValidItemIdParam skips invalid ids', () => {
    const next = jest.fn();
    ensureValidItemIdParam({ params: { id: 'bad' } }, {}, next);
    expect(next).toHaveBeenCalledWith('route');
  });
});
