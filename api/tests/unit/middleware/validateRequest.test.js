'use strict';

jest.mock('express-validator', () => {
  const chain = () => ({
    trim: jest.fn().mockReturnThis(),
    notEmpty: jest.fn().mockReturnThis(),
    withMessage: jest.fn().mockReturnThis(),
    isEmail: jest.fn().mockReturnThis(),
    isInt: jest.fn().mockReturnThis(),
    isString: jest.fn().mockReturnThis(),
    isMongoId: jest.fn().mockReturnThis(),
    isLength: jest.fn().mockReturnThis(),
    optional: jest.fn().mockReturnThis(),
    normalizeEmail: jest.fn().mockReturnThis(),
    matches: jest.fn().mockReturnThis(),
    toInt: jest.fn().mockReturnThis(),
    customSanitizer: jest.fn().mockReturnThis(),
    run: jest.fn(),
  });

  const validationResult = jest.fn();
  const factory = jest.fn(() => chain());

  return {
    validationResult,
    body: factory,
    param: factory,
    query: factory,
  };
});

jest.mock('mongodb', () => ({
  ObjectId: jest.fn().mockImplementation((value) => ({ value })),
}));

const { validationResult } = require('express-validator');
const validateRequestModule = require('../../../src/middleware/validateRequest');

describe('middleware/validateRequest', () => {
  const createRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

  test('sanitizeInput strips html recursively', () => {
    const input = { a: '<b>text</b>', nested: { b: ' <i>x</i> ' }, arr: ['<p>y</p>'] };
    expect(validateRequestModule.sanitizeInput(input)).toEqual({
      a: 'text',
      nested: { b: 'x' },
      arr: ['y'],
    });
  });

  test('validateRequest returns 422 formatted errors', async () => {
    const middleware = validateRequestModule.validateRequest([]);
    const res = createRes();
    const next = jest.fn();

    validationResult.mockReturnValue({
      isEmpty: () => false,
      array: () => [{ param: 'user.name', msg: 'required' }],
    });

    await middleware({ body: {}, query: {}, params: {} }, res, next);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      status: 'error',
      message: 'Validation failed',
      errors: { user: { name: 'required' } },
      code: 422,
    });
  });

  test('commonValidators mongoId produces ObjectId sanitizer', () => {
    const chain = validateRequestModule.commonValidators.mongoId('id', 'params');
    expect(chain).toBeTruthy();
    expect(chain).toHaveProperty('customSanitizer');
  });
});
