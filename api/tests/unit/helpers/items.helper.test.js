'use strict';

jest.mock('../../../src/constants/items.constants', () => ({
  FIELD_LIMITS: { NAME_MAX: 20 },
  ERROR_MESSAGES: { ITEM_NAME_REQUIRED: 'Item name is required' },
}));

const helper = require('../../../src/helpers/items.helper');

describe('items.helper', () => {
  test('exports item helper functions', () => {
    expect(helper.sanitizeItemData({ name: '  Item ' }).name).toBe('Item');
    expect(helper.validateItemData({ name: 'Item' }, { requireName: true }).valid).toBe(true);
  });
});
