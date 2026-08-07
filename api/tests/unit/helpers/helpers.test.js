'use strict';

jest.mock('../../../src/constants/users.constants', () => ({
  HTTP_STATUS: {
    OK: 200,
    INTERNAL_ERROR: 500,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    NOT_FOUND: 404,
    NOT_ACCEPTABLE: 406,
  },
  RESPONSE_TYPES: {
    SUCCESS: 'success',
    ERROR: 'error',
  },
}));

jest.mock('../../../src/constants/customers.constants', () => ({
  LOYALTY_TIERS: { PLATINUM: 'platinum', GOLD: 'gold', SILVER: 'silver', BRONZE: 'bronze' },
  LOYALTY_THRESHOLDS: { PLATINUM: 1000, GOLD: 500, SILVER: 100 },
  VALIDATION_PATTERNS: {
    EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    PHONE: /^[0-9]{10}$/,
    GST_NUMBER: /^[0-9A-Z]{15}$/,
    PINCODE: /^[0-9]{6}$/,
  },
}));

jest.mock('../../../src/constants/categories.constants', () => ({
  VALIDATION_PATTERNS: { NAME: /^[A-Za-z ]+$/ },
}));

jest.mock('../../../src/constants/suppliers.constants', () => ({
  VALIDATION_PATTERNS: {
    EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    PHONE: /^[0-9]{10}$/,
    GST_NUMBER: /^[0-9A-Z]{15}$/,
    PINCODE: /^[0-9]{6}$/,
  },
}));

jest.mock('../../../src/constants/items.constants', () => ({
  FIELD_LIMITS: { NAME_MAX: 20 },
  ERROR_MESSAGES: { ITEM_NAME_REQUIRED: 'Item name is required' },
}));

jest.mock('../../../src/utils/helpers', () => ({
  formatDate: jest.fn(() => 'formatted-date'),
  safeJsonParse: jest.fn((value) => JSON.parse(value)),
  toObjectId: jest.fn((value) => value),
}));

jest.mock('../../../src/models/user.model', () => ({
  findById: jest.fn(() => ({
    select: jest.fn(() => ({
      lean: jest.fn(async () => ({ _id: 'u1', name: 'User One', email: 'u1@example.com' })),
    })),
  })),
}));

jest.mock('../../../src/models/base.model', () => ({}));
jest.mock('mongoose', () => ({
  Types: {
    ObjectId: function ObjectId(value) {
      this.value = value;
    },
  },
}));
jest.mock('mongodb', () => ({
  ObjectId: { isValid: jest.fn((value) => typeof value === 'string' && value.length === 24) },
}));

const responseHelper = require('../../../src/helpers/response.helper');
const customerHelper = require('../../../src/helpers/customers.helper');
const categoryHelper = require('../../../src/helpers/categories.helper');
const customerCategoryHelper = require('../../../src/helpers/customer-category.helper');
const installHelper = require('../../../src/helpers/install.helper');
const itemHelper = require('../../../src/helpers/items.helper');
const registerHelper = require('../../../src/helpers/registers.helper');
const stockLogsHelper = require('../../../src/helpers/stock-logs.helper');
const supplierHelper = require('../../../src/helpers/suppliers.helper');
const salesHelper = require('../../../src/helpers/sales.helper');

const createRes = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
});

describe('helpers', () => {
  test('response helper formats success and errors', () => {
    const res = createRes();
    responseHelper.sendSuccess(res, { a: 1 }, 'ok');
    expect(res.status).toHaveBeenCalledWith(200);

    responseHelper.handleServiceResponse(res, { status: 'none', message: 'missing' });
    expect(res.status).toHaveBeenCalledWith(404);
  });

  test('customer helpers work', () => {
    expect(customerHelper.calculateLoyaltyTier(1200)).toBe('platinum');
    expect(customerHelper.isValidEmail('a@b.com')).toBe(true);
    expect(
      customerHelper.sanitizeCustomerData({ _id: 'x', name: '  A ', email: 'A@B.com ' }).name
    ).toBe('A');
  });

  test('category helpers work', () => {
    expect(categoryHelper.isValidCategoryName('Food')).toBe(true);
    expect(categoryHelper.calculateDiscount(100, 10, 10).discountedPrice).toBe(80);
    expect(
      customerCategoryHelper.prepareCategoryImportData([{ name: '  Cat ' }], { branch_id: 'b1' })[0]
        .name
    ).toBe('Cat');
  });

  test('install and item helpers work', () => {
    expect(installHelper.isValidObjectId('a'.repeat(24))).toBe(true);
    expect(
      installHelper.sanitizeInstallData({ register_companyname: ' ACME ' }).register_companyname
    ).toBe('ACME');
    expect(itemHelper.validateItemData({ name: 'Item' }, { requireName: true }).valid).toBe(true);
  });

  test('register, stock log and supplier helpers work', () => {
    expect(registerHelper.formatRegisterDate('2024-01-01')).toBe('formatted-date');
    expect(
      stockLogsHelper.applyCreatedDateRangeFilter({}, { created_date: { $gte: '2024-01-01' } })
        .created_date.$gte
    ).toBeInstanceOf(Date);
    expect(supplierHelper.isCreditLimitExceeded(50, 0, 100)).toBe(false);
  });

  test('sales helper exports and pure helpers', () => {
    expect(salesHelper.normalizeReportType('weekly')).toBe('Weekly');
    expect(salesHelper.roundToTwo('12.345')).toBe(12.35);
    expect(salesHelper.normalizePaymentMode('card')).toBe('CreditCard');
  });
});
