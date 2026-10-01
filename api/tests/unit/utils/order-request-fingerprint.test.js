const fingerprint = require('../../../src/utils/order-request-fingerprint');
test('object property order and renewed approval proof do not change the request identity', () => {
  expect(
    fingerprint({
      items: [{ qty: 2, note: 'no salt' }],
      approval_token: 'one',
      idempotencyKey: 'a',
    })
  ).toBe(
    fingerprint({
      approval_token: 'two',
      items: [{ note: 'no salt', qty: 2 }],
      idempotencyKey: 'a',
    })
  );
});
test.each([
  { items: [{ qty: 3, note: 'no salt' }], payment_mode: 'Cash' },
  { items: [{ qty: 2, note: 'extra salt' }], payment_mode: 'Cash' },
  { items: [{ qty: 2, note: 'no salt' }], payment_mode: 'UPI' },
])('changed sale details cannot reuse a fingerprint', (changed) => {
  expect(fingerprint(changed)).not.toBe(
    fingerprint({ items: [{ qty: 2, note: 'no salt' }], payment_mode: 'Cash' })
  );
});
