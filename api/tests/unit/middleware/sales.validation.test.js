'use strict';

jest.mock('../../../src/constants/sales.constants', () => ({
  ERROR_MESSAGES: {
    VALIDATION_ERROR: 'validation',
    INVALID_SALE_PAYLOAD: 'invalid payload',
    AT_LEAST_ONE_VALID_SALE_ITEM_REQUIRED: 'need item',
    A_VALID_INSTANT_SALE_ID_REQUIRED: 'need sale id',
    MISSING_BRANCH_AND_DATE_PARAMS: 'missing branch/date',
    INVALID_BRANCH_ID_FORMAT: 'invalid branch',
    AT_LEAST_ONE_BRANCH_ID_REQUIRED: 'need branch',
    NO_VALID_BRANCH_IDS_PROVIDED: 'no valid branch',
  },
}));

jest.mock('../../../src/utils/helpers', () => ({
  safeJsonParse: jest.fn((value, fallback) => fallback),
}));

jest.mock('../../../src/helpers/sales.helper', () => ({
  parseBranchIdsFromRequest: jest.fn(() => ({ uniqueBranchIds: ['b1'], validBranchIds: ['b1'] })),
  parseSaleDate: jest.fn(() => new Date('2025-01-01T00:00:00.000Z')),
  normalizeSaleItems: jest.fn(() => [{ item: 'x' }]),
}));

jest.mock('../../../src/services/sale.service', () => ({}));

jest.mock('mongodb', () => ({
  ObjectId: { isValid: jest.fn(() => true) },
}));

jest.mock('express-validator', () => {
  const chain = () => ({
    optional: jest.fn().mockReturnThis(),
    isArray: jest.fn().mockReturnThis(),
    withMessage: jest.fn().mockReturnThis(),
    isNumeric: jest.fn().mockReturnThis(),
    isMongoId: jest.fn().mockReturnThis(),
    isIn: jest.fn().mockReturnThis(),
    notEmpty: jest.fn().mockReturnThis(),
  });
  return { body: jest.fn(() => chain()), param: jest.fn(() => chain()) };
});

const sales = require('../../../src/middleware/sales.validation');

describe('sales.validation', () => {
  test('exports validators and helpers', () => {
    expect(sales.validateCreateSale).toHaveLength(2);
    expect(sales.validateUpdateSale).toHaveLength(2);
    expect(typeof sales.ensureValidSaleIdParam).toBe('function');
    expect(typeof sales.prepareCreateSalePayload).toBe('function');
  });
});
