'use strict';

jest.mock('express-validator', () => {
  const chain = () => ({
    if: jest.fn().mockReturnThis(),
    trim: jest.fn().mockReturnThis(),
    notEmpty: jest.fn().mockReturnThis(),
    withMessage: jest.fn().mockReturnThis(),
    isLength: jest.fn().mockReturnThis(),
    matches: jest.fn().mockReturnThis(),
    optional: jest.fn().mockReturnThis(),
    isEmail: jest.fn().mockReturnThis(),
    isMongoId: jest.fn().mockReturnThis(),
    isArray: jest.fn().mockReturnThis(),
    isString: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
    equals: jest.fn().mockReturnThis(),
    custom: jest.fn().mockReturnThis(),
  });
  const validationResult = jest.fn();
  return { body: jest.fn(() => chain()), query: jest.fn(() => chain()), validationResult };
});

const usersValidation = require('../../../src/middleware/users.validation');

describe('users.validation', () => {
  test('exports validation arrays', () => {
    expect(usersValidation.validateUser.length).toBeGreaterThan(0);
    expect(usersValidation.validateLogin.length).toBeGreaterThan(0);
    expect(usersValidation.validateUserProfile.length).toBeGreaterThan(0);
  });
});
