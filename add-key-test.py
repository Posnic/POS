import io

p = 'D:/Claude/Claude6/POS/api/tests/unit/middleware/rate-limit-key.test.js'
s = io.open(p, encoding='utf-8', newline='').read()

# the module under test has to export the new key
old_req = "const { perShopKey"
assert old_req in s, 'import line not found'
head = s[: s.index('\n', s.index(old_req))]
if 'perPlacedOrderKey' not in head:
    s = s.replace(head, head.replace('perShopKey', 'perShopKey, perPlacedOrderKey', 1), 1)

TESTS = '''

/*
 * A RESTAURANT IS ONE ADDRESS.
 *
 * Every diner is behind the shop's own wifi, so keying the placed-order
 * routes by the client address hands the whole room a single budget: one
 * table correcting a quantity spends the minute and the next table is refused
 * for traffic it had no part in. Owner: "still sometimes broken." It was, and
 * this was one of the reasons.
 */
describe('the placed-order routes are counted per order, not per restaurant', () => {
  const at = (orderId, ip, body) => ({
    params: orderId ? { orderId } : {},
    body: body || {},
    ip,
    headers: {},
    socket: {},
  });

  test('two diners on the same wifi do not share a budget', () => {
    const one = perPlacedOrderKey(at('order-a', '203.0.113.7'));
    const two = perPlacedOrderKey(at('order-b', '203.0.113.7'));
    expect(one).not.toEqual(two);
  });

  test('the same order from another address is still another bucket', () => {
    /* So nobody can spend a customer's allowance by naming their order. */
    expect(perPlacedOrderKey(at('order-a', '203.0.113.7'))).not.toEqual(
      perPlacedOrderKey(at('order-a', '198.51.100.4'))
    );
  });

  test('the same diner on the same order keeps one budget', () => {
    expect(perPlacedOrderKey(at('order-a', '203.0.113.7'))).toEqual(
      perPlacedOrderKey(at('order-a', '203.0.113.7'))
    );
  });

  test('a request naming no order falls back to the address, which is right for it', () => {
    /* The history page asks about several orders at once; that one really is
       per device. */
    expect(perPlacedOrderKey(at('', '203.0.113.7'))).toEqual(perShopKey(at('', '203.0.113.7')));
  });

  test('an order named in the body counts the same as one in the path', () => {
    expect(perPlacedOrderKey(at('', '203.0.113.7', { orderId: 'order-a' }))).toEqual(
      perPlacedOrderKey(at('order-a', '203.0.113.7'))
    );
  });

  test('an absurdly long order id cannot grow the key without limit', () => {
    const key = perPlacedOrderKey(at('x'.repeat(5000), '203.0.113.7'));
    expect(key.length).toBeLessThan(200);
  });
});
'''
io.open(p, 'w', encoding='utf-8', newline='').write(s.rstrip() + '\n' + TESTS)
print('tests appended')
