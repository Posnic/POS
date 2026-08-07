'use strict';

const helper = require('../../../src/helpers/stock-logs.helper');

describe('stock-logs.helper', () => {
  test('exports stock logs helper functions', () => {
    const result = helper.applyCreatedDateRangeFilter(
      {},
      { created_date: { $gte: '2024-01-01', $lte: '2024-01-02' } }
    );
    expect(result.created_date.$gte).toBeInstanceOf(Date);
    expect(result.created_date.$lte).toBeInstanceOf(Date);
  });
});
