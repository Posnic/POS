'use strict';

jest.mock('express-validator', () => {
  const chain = () => ({
    trim: jest.fn().mockReturnThis(),
    notEmpty: jest.fn().mockReturnThis(),
    withMessage: jest.fn().mockReturnThis(),
    isLength: jest.fn().mockReturnThis(),
    isFloat: jest.fn().mockReturnThis(),
    isNumeric: jest.fn().mockReturnThis(),
    optional: jest.fn().mockReturnThis(),
    isString: jest.fn().mockReturnThis(),
    isMongoId: jest.fn().mockReturnThis(),
    isBoolean: jest.fn().mockReturnThis(),
    isArray: jest.fn().mockReturnThis(),
    isObject: jest.fn().mockReturnThis(),
    matches: jest.fn().mockReturnThis(),
    custom: jest.fn().mockReturnThis(),
    run: jest.fn(),
  });
  const validationResult = jest.fn();
  return {
    body: jest.fn(() => chain()),
    param: jest.fn(() => chain()),
    query: jest.fn(() => chain()),
    validationResult,
  };
});

const { validationResult } = require('express-validator');
const validation = require('../../../src/middleware/validation');

describe('middleware/validation', () => {
  test('exports validation arrays', () => {
    expect(validation.validateExpense).toHaveLength(5);
    expect(validation.validateId).toHaveLength(2);
  });

  test('handleValidationErrors formats 400 response', () => {
    validationResult.mockReturnValue({
      isEmpty: () => false,
      array: () => [{ msg: 'bad' }],
    });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    validation.handleValidationErrors({}, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
