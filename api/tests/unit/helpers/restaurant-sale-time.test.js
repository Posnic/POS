'use strict';
const time = require('../../../src/helpers/restaurant-sale-time');
const opened = new Date('2026-10-06T18:20:00Z');
const paid = new Date('2026-10-06T19:10:00Z');
const sale = { sale_process: 'KOT', payment_status: 'Unpaid', date: opened, created_date: opened };

test('final settlement changes the sale day while preserving the order clock', () => {
  expect(time(sale, 'Paid', paid)).toEqual({ date: paid, settled_at: paid, order_date: opened });
  expect(sale.date).toEqual(opened);
});
test('partial payments and ordinary retail sales do not move the sale clock', () => {
  expect(time(sale, 'Partialy Paid', paid)).toEqual({ date: opened });
  expect(time({ ...sale, sale_process: 'Normal' }, 'Paid', paid)).toEqual({});
});
test('edits and retries preserve a settled bill time, including legacy paid bills', () => {
  expect(time({ ...sale, settled_at: paid, payment_status: 'Paid' }, 'Paid', new Date())).toEqual({
    date: paid,
    settled_at: paid,
  });
  expect(time({ ...sale, payment_status: 'Paid' }, 'Paid', new Date())).toEqual({ date: opened });
});
