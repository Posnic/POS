'use strict';

const mockMiddleware = () => jest.fn((req, res, next) => next());

jest.mock('../../../src/controllers/invoices.controller', () => ({
  create: jest.fn(),
  list: jest.fn(),
  summary: jest.fn(),
  fromQuote: jest.fn(),
  getById: jest.fn(),
  update: jest.fn(),
  issue: jest.fn(),
  transition: jest.fn(),
  payment: jest.fn(),
  share: jest.fn(),
  remove: jest.fn(),
}));

jest.mock('../../../src/middleware/auth', () => ({ protect: mockMiddleware() }));
jest.mock('../../../src/middleware/auth-rate-limit', () => ({ invoiceLimiter: mockMiddleware() }));

const { protect } = require('../../../src/middleware/auth');
const { invoiceLimiter } = require('../../../src/middleware/auth-rate-limit');
const router = require('../../../src/routes/invoices.routes');

describe('invoices.routes', () => {
  test('limits both canonical and legacy invoice paths after authentication', () => {
    const middleware = router.stack.filter((layer) => !layer.route).map((layer) => layer.handle);

    expect(middleware).toEqual(expect.arrayContaining([protect, invoiceLimiter]));
    expect(middleware.indexOf(protect)).toBeLessThan(middleware.indexOf(invoiceLimiter));
  });
});
