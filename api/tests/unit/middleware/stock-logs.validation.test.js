'use strict';

jest.mock('../../../src/constants/stock-logs.constants', () => ({
  ERROR_MESSAGES: {},
}));

jest.mock('express-validator', () => {
  const chain = () => ({
    notEmpty: jest.fn().mockReturnThis(),
    withMessage: jest.fn().mockReturnThis(),
    isMongoId: jest.fn().mockReturnThis(),
    isString: jest.fn().mockReturnThis(),
    trim: jest.fn().mockReturnThis(),
    isLength: jest.fn().mockReturnThis(),
    isNumeric: jest.fn().mockReturnThis(),
    isIn: jest.fn().mockReturnThis(),
    optional: jest.fn().mockReturnThis(),
    isInt: jest.fn().mockReturnThis(),
    toInt: jest.fn().mockReturnThis(),
  });
  return { body: jest.fn(() => chain()), param: jest.fn(() => chain()) };
});

const stockLogs = require('../../../src/middleware/stock-logs.validation');

describe('stock-logs.validation', () => {
  test('exports stock log validation arrays', () => {
    expect(stockLogs.validateCreateStockLog).toHaveLength(10);
    expect(stockLogs.validateUpdateItemName).toHaveLength(2);
    expect(stockLogs.validateCleanupLogs).toHaveLength(1);
  });
});
