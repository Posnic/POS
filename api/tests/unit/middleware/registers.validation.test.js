'use strict';

jest.mock('../../../src/constants/registers.constants', () => ({
  FIELD_LIMITS: {
    REGISTER_NAME_MIN: 2,
    REGISTER_NAME_MAX: 20,
  },
}));

jest.mock('express-validator', () => {
  const chain = () => ({
    notEmpty: jest.fn().mockReturnThis(),
    withMessage: jest.fn().mockReturnThis(),
    optional: jest.fn().mockReturnThis(),
    trim: jest.fn().mockReturnThis(),
    isLength: jest.fn().mockReturnThis(),
    isFloat: jest.fn().mockReturnThis(),
    isString: jest.fn().mockReturnThis(),
    isArray: jest.fn().mockReturnThis(),
    isInt: jest.fn().mockReturnThis(),
    bail: jest.fn().mockReturnThis(),
  });
  return { body: jest.fn(() => chain()), query: jest.fn(() => chain()) };
});

const registers = require('../../../src/middleware/registers.validation');

describe('registers.validation', () => {
  test('exports all register validators', () => {
    expect(registers.validateRegisterAdd).toHaveLength(3);
    expect(registers.validateRegisterSaleDetails).toHaveLength(3);
    expect(registers.validateRegisterReportFilters).toHaveLength(5);
  });
});
