'use strict';

jest.mock('../../../src/models/base.model', () => ({}));
jest.mock('../../../src/utils/helpers', () => ({
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
jest.mock('mongoose', () => ({
  Types: {
    ObjectId: function ObjectId(value) {
      this.value = value;
    },
  },
}));

const helper = require('../../../src/helpers/sales.helper');

describe('sales.helper', () => {
  test('exports sales helper functions', () => {
    expect(helper.normalizeReportType('weekly')).toBe('Weekly');
    expect(helper.roundToTwo('12.345')).toBe(12.35);
  });
});
