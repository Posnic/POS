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
    /* Every link the real chain offers. A fake that is missing one does not
       fail where it is missing - it fails at require time, and takes the whole
       suite down with "is not a function" and zero tests run. isBoolean
       arrived with the sold-out validator. */
    isBoolean: jest.fn().mockReturnThis(),
    isInt: jest.fn().mockReturnThis(),
    isString: jest.fn().mockReturnThis(),
    isIn: jest.fn().mockReturnThis(),
    toBoolean: jest.fn().mockReturnThis(),
    toInt: jest.fn().mockReturnThis(),
    bail: jest.fn().mockReturnThis(),
    custom: jest.fn().mockReturnThis(),
    exists: jest.fn().mockReturnThis(),
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
