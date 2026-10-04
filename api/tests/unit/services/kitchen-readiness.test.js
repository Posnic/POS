'use strict';
const { readiness } = require('../../../src/services/kitchen-board');

test('readiness counts preparing rounds and excludes served quantities', () => {
  const item = (total, ready, served) => ({ name: 'Fish', total, ready, served });
  expect(
    readiness([
      { table: '4', saleId: 'a', roundId: 'c0', items: [item(3, 2, 1)] },
      { table: '4', saleId: 'b', roundId: 'c1', items: [item(3, 0, 0)] },
    ])
  ).toEqual([
    {
      table: '4',
      saleId: null,
      ready: 1,
      remaining: 5,
      items: [{ name: 'Fish', quantity: 1, roundId: 'c0' }],
    },
  ]);
});

test('separate takeaway sales never share readiness or item counts', () => {
  const result = readiness(
    ['a', 'b'].map((saleId, index) => ({
      table: '',
      saleId,
      roundId: 'c0',
      items: [{ name: 'Rice', total: 2, ready: index ? 0 : 2, served: 0 }],
    }))
  );
  expect(result.map(({ saleId, ready, remaining }) => ({ saleId, ready, remaining }))).toEqual([
    { saleId: 'a', ready: 2, remaining: 2 },
    { saleId: 'b', ready: 0, remaining: 2 },
  ]);
});
