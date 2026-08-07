'use strict';

jest.mock('express-validator', () => {
  const chain = () => ({
    trim: jest.fn().mockReturnThis(),
    notEmpty: jest.fn().mockReturnThis(),
    withMessage: jest.fn().mockReturnThis(),
    isLength: jest.fn().mockReturnThis(),
    isNumeric: jest.fn().mockReturnThis(),
    isFloat: jest.fn().mockReturnThis(),
    optional: jest.fn().mockReturnThis(),
    isString: jest.fn().mockReturnThis(),
    isMongoId: jest.fn().mockReturnThis(),
    isBoolean: jest.fn().mockReturnThis(),
    isArray: jest.fn().mockReturnThis(),
    isObject: jest.fn().mockReturnThis(),
    isIn: jest.fn().mockReturnThis(),
    matches: jest.fn().mockReturnThis(),
    custom: jest.fn().mockReturnThis(),
    run: jest.fn(),
  });

  const validationResult = jest.fn();
  return {
    body: jest.fn(() => chain()),
    param: jest.fn(() => chain()),
    validationResult,
  };
});

const { validationResult } = require('express-validator');
const validation = require('../../../src/middleware/validation/index');

describe('middleware/validation/index', () => {
  test('exports category validation arrays', () => {
    expect(validation.validateCategory).toHaveLength(5);
    expect(validation.validateCategoryId).toHaveLength(2);
  });

  test('validation middleware returns 400 on errors', () => {
    validationResult.mockReturnValue({
      isEmpty: () => false,
      array: () => [{ param: 'name', msg: 'required' }],
    });

    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();

    validation.validateCategory[4]({}, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});
