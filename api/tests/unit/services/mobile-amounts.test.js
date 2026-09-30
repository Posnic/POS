const { lineAmounts } = require('../../../src/services/mobile-amounts');
describe('mobile fixed quantity amounts', () => {
  const line = {
    price: 1235,
    quantity: 0.125,
    quantityScale: 1000,
    taxBps: 500,
    taxInclusive: false,
  };
  test.each([
    [{}, 162, 8],
    [{ taxInclusive: true }, 154, 7],
    [{ price: 3500, taxBps: 0 }, 438, 0],
    [{ price: 10000, quantity: 1.001, taxBps: 1800 }, 11812, 1802],
    [{ price: 11800, quantity: 1.001, taxBps: 1800, taxInclusive: true }, 11812, 1802],
  ])('rounds the line once in minor units (%j)', (change, amount, tax) => {
    expect(lineAmounts({ ...line, ...change })).toEqual({ amount, tax });
  });
  test.each([0, -1, 0.0001, NaN, Infinity])('rejects invalid quantity %s', (quantity) => {
    expect(() => lineAmounts({ ...line, quantity })).toThrow();
  });
  test('ordinary quantities remain integral', () => {
    expect(() => lineAmounts({ ...line, quantityScale: undefined })).toThrow();
  });
});
