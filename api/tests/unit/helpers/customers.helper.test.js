'use strict';

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

const helper = require('../../../src/helpers/customers.helper');

describe('customers.helper', () => {
  test('exports customer helper functions', () => {
    expect(helper.calculateLoyaltyTier(1200)).toBe('platinum');
    expect(helper.normalizeBoolean('true')).toBe(true);
  });
});
