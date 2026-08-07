'use strict';

jest.mock('../../../src/controllers/auth-utils.controller', () => ({
  signToken: jest.fn(() => 'token'),
  getTokenFromRequest: jest.fn(() => 'token'),
  verifyToken: jest.fn(() => ({ id: 'u1' })),
}));

jest.mock('../../../src/middleware/auth', () => ({
  protect: jest.fn((req, res, next) => next()),
}));

const router = require('../../../src/routes/auth-utils.routes');

describe('auth-utils.routes', () => {
  test('exposes utility routes', () => {
    const paths = router.stack
      .filter((layer) => layer.route)
      .map((layer) => `${Object.keys(layer.route.methods)[0]} ${layer.route.path}`);
    expect(paths).toEqual(
      expect.arrayContaining(['post /sign-token', 'post /verify-token', 'post /refresh-token'])
    );
  });
});
