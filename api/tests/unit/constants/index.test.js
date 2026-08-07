'use strict';

const constants = require('../../../src/constants');

describe('constants index', () => {
  test('exports payment and sale statuses', () => {
    expect(constants.PAYMENT_STATUS).toEqual({
      PENDING: 'pending',
      COMPLETED: 'completed',
      FAILED: 'failed',
      REFUNDED: 'refunded',
      PARTIALLY_REFUNDED: 'partially_refunded',
      CANCELLED: 'cancelled',
    });

    expect(constants.SALE_STATUS).toEqual({
      DRAFT: 'draft',
      PENDING: 'pending',
      COMPLETED: 'completed',
      CANCELLED: 'cancelled',
      REFUNDED: 'refunded',
      PARTIALLY_REFUNDED: 'partially_refunded',
    });
  });
});
