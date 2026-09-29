'use strict';
const { forSaleItem, snapshot } = require('../../../src/utils/kitchen-amount');
const { tickets, rounds } = require('../../../src/helpers/kitchen-rounds');
test.each([
  [{ item_status: 'instant', selling_price: 200 }, {}, 200],
  [{ open_price: true, selling_price: 100 }, {}, 500],
  [{ selling_price: 0 }, {}, 500],
  [{ selling_price: 200 }, { item_status: 'instant' }, 200],
])('marks the entered preparation amount for eligible products', (product, line, amount) => {
  expect(forSaleItem(product, line, amount)).toEqual({ priced_at_table: amount });
});
test('normal product prices stay hidden even with a caller-supplied flag', () => {
  expect(forSaleItem({ selling_price: 200 }, { priced_at_table: 1 }, 100)).toEqual({});
});
test.each([null, undefined, '', 0, -1, Infinity, 'bad'])('invalid amount %s is omitted', value => {
  expect(snapshot({ priced_at_table: value })).toEqual({});
});
test('screen and service rounds retain amounts for both logged and legacy items', () => {
  const cake = { item_id: 'cake', item_name: 'Cake', item_quantity: 2, priced_at_table: 200 };
  const regular = { item_id: 'tea', item_name: 'Tea', item_quantity: 1, item_price: 20 };
  for (const changes of [[], [{ timestamp: new Date(), items: [{ ...cake, process: 'add' }, { ...regular, process: 'add' }] }]]) {
    const sale = { _id: 'sale', items: [cake, regular], changes, created_date: new Date() };
    expect(rounds(sale)[0].items[0].priced_at_table).toBe(200);
    const items = tickets(sale)[0].items;
    expect(items[0]).toMatchObject({ name: 'Cake', qty: 2, priced_at_table: 200 });
    expect(items[1].priced_at_table).toBeUndefined();
    expect(items[1].item_price).toBeUndefined();
  }
});
