'use strict';

jest.mock('../../../src/utils/helpers', () => ({
  formatDate: jest.fn(() => 'formatted-date'),
}));

const helper = require('../../../src/helpers/registers.helper');

describe('registers.helper', () => {
  test('exports register helper functions', () => {
    expect(helper.formatRegisterDate('2024-01-01')).toBe('formatted-date');
    expect(helper.mongoRegisterDateFilter([{ updated_date: '2024-01-01' }])[0].string_date).toBe(
      'formatted-date'
    );
  });
});
