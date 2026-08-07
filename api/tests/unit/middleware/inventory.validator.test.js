'use strict';

jest.mock('express-validator', () => {
  const chain = () => ({
    optional: jest.fn().mockReturnThis(),
    isInt: jest.fn().mockReturnThis(),
    withMessage: jest.fn().mockReturnThis(),
    isMongoId: jest.fn().mockReturnThis(),
    isIn: jest.fn().mockReturnThis(),
    isFloat: jest.fn().mockReturnThis(),
    trim: jest.fn().mockReturnThis(),
    notEmpty: jest.fn().mockReturnThis(),
  });
  return {
    body: jest.fn(() => chain()),
    param: jest.fn(() => chain()),
    query: jest.fn(() => chain()),
  };
});

const inventory = require('../../../src/middleware/inventory.validator');

describe('inventory.validator', () => {
  test('exports validation groups', () => {
    expect(inventory.list).toHaveLength(6);
    expect(inventory.create).toHaveLength(11);
    expect(inventory.update).toHaveLength(12);
    expect(inventory.updateStock).toHaveLength(4);
  });
});
