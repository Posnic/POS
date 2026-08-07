'use strict';

jest.mock('../../../src/constants/suppliers.constants', () => ({
  VALIDATION_PATTERNS: {
    EMAIL: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    PHONE: /^[0-9]{10}$/,
    GST_NUMBER: /^[0-9A-Z]{15}$/,
    PINCODE: /^[0-9]{6}$/,
  },
}));

const helper = require('../../../src/helpers/suppliers.helper');

describe('suppliers.helper', () => {
  test('exports supplier helper functions', () => {
    expect(helper.isValidEmail('a@b.com')).toBe(true);
    expect(helper.calculateOutstandingBalance(100, 30)).toBe(70);
  });
});
