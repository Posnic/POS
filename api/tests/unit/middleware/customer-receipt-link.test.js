const guard = require('../../../src/middleware/customer-receipt-link');
const encryption = require('../../../src/utils/encryption');

describe('customer receipt links', () => {
  const id = '6ad71bebe22b7445de52026f';
  function check(token) {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    guard({ query: { id: token }, params: {} }, res, next);
    return { res, next };
  }
  test('allows a valid receipt link without a login', () => {
    expect(check(encryption.generateEncryptedId(id)).next).toHaveBeenCalledTimes(1);
  });
  test.each([id, 'bad', null, ['bad']])('rejects a plain or malformed identifier: %p', (token) => {
    const { res, next } = check(token);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
  test('rejects encrypted values that are not receipt identifiers', () => {
    expect(check(encryption.generateEncryptedId('wrong')).res.status).toHaveBeenCalledWith(400);
  });
});
