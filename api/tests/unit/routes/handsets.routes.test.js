'use strict';

const mockMiddleware = () => jest.fn((req, res, next) => next());

jest.mock('../../../src/middleware/auth', () => ({ protect: mockMiddleware() }));
jest.mock('../../../src/middleware/auth-rate-limit', () => ({ handsetLimiter: mockMiddleware() }));
jest.mock('../../../src/db/tenant-context', () => ({ currentConnection: jest.fn() }));
jest.mock('../../../src/utils/handsets', () => ({}));

const { protect } = require('../../../src/middleware/auth');
const { handsetLimiter } = require('../../../src/middleware/auth-rate-limit');
const router = require('../../../src/routes/handsets.routes');

describe('handsets.routes', () => {
  test('limits handset-management requests after authentication', () => {
    const middleware = router.stack.filter((layer) => !layer.route).map((layer) => layer.handle);

    expect(middleware).toEqual(expect.arrayContaining([protect, handsetLimiter]));
    expect(middleware.indexOf(protect)).toBeLessThan(middleware.indexOf(handsetLimiter));
  });
});
