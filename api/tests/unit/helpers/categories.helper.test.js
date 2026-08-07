'use strict';

jest.mock('../../../src/constants/categories.constants', () => ({
  VALIDATION_PATTERNS: { NAME: /^[A-Za-z ]+$/ },
}));

const helper = require('../../../src/helpers/categories.helper');

describe('categories.helper', () => {
  test('exports category helper functions', () => {
    expect(helper.isValidCategoryName('Food')).toBe(true);
    expect(helper.calculateDiscount(100, 10, 10).discountedPrice).toBe(80);
  });
});
