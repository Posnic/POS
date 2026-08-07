'use strict';

jest.mock('express-validator', () => {
  const chain = () => ({
    trim: jest.fn().mockReturnThis(),
    notEmpty: jest.fn().mockReturnThis(),
    withMessage: jest.fn().mockReturnThis(),
    isEmail: jest.fn().mockReturnThis(),
    isLength: jest.fn().mockReturnThis(),
    matches: jest.fn().mockReturnThis(),
    exists: jest.fn().mockReturnThis(),
    optional: jest.fn().mockReturnThis(),
    if: jest.fn().mockReturnThis(),
    custom: jest.fn().mockReturnThis(),
    run: jest.fn(),
  });

  const validationResult = jest.fn();
  const factory = jest.fn(() => chain());

  return {
    validationResult,
    body: factory,
    param: factory,
    query: factory,
    header: factory,
    cookie: factory,
    check: factory,
    checkSchema: jest.fn(),
    oneOf: jest.fn(),
  };
});

jest.mock('../../../src/utils/appError', () => ({
  AppError: jest.fn().mockImplementation((message, statusCode, errors) => ({
    message,
    statusCode,
    errors,
  })),
}));

const { validationResult } = require('express-validator');
const validateModule = require('../../../src/middleware/validate');

describe('middleware/validate', () => {
  const createRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

  test('validate passes when there are no errors', async () => {
    validationResult.mockReturnValue({ isEmpty: () => true });
    const next = jest.fn();
    const middleware = validateModule.validate([]);
    await middleware({}, createRes(), next);
    expect(next).toHaveBeenCalledWith();
  });

  test('validate forwards AppError on validation failure', async () => {
    const validation = {
      run: jest.fn(),
    };
    validationResult.mockReturnValue({
      isEmpty: () => false,
      array: () => [{ param: 'name', msg: 'Name is required' }],
    });

    const next = jest.fn();
    const middleware = validateModule.validate([validation]);
    await middleware({}, createRes(), next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Validation failed',
        statusCode: 400,
        errors: [{ field: 'name', message: 'Name is required' }],
      })
    );
  });
});
