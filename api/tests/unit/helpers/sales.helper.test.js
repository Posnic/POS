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
test('the desktop KOT list keeps distinct Captain preparation IDs', () => {
  const { formatSaleListEntry } = require('../../../src/helpers/sales.helper');
  const result = formatSaleListEntry({
    _id: 'order',
    items: [
      { item_id: 'water', line_id: 'first', item_quantity: 1 },
      { item_id: 'water', line_id: 'second', item_quantity: 2 },
    ],
  });
  expect(result.items.map((line) => line.line_id)).toEqual(['first', 'second']);
});

test('order list preserves its opening time and takeaway number after later updates', () => {
  const { formatSaleListEntry } = require('../../../src/helpers/sales.helper');
  const created = new Date('2026-10-05T10:00:00Z');
  const updated = new Date('2026-10-05T10:45:00Z');
  const result = formatSaleListEntry({
    created_date: created,
    updated_date: updated,
    token_id: '7',
    takeaway_number: 7,
    sales_id: 'S-ABC-00123',
  });
  expect(result.created_date).toEqual(created);
  expect(result.updated_date).toEqual(updated);
  expect(result.token_id).toBe('7');
  expect(result.takeaway_number).toBe(7);
});
