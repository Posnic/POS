'use strict';

jest.mock('../../../src/controllers/auth.controller', () => ({
  register: jest.fn(),
  login: jest.fn(),
  verifyToken: jest.fn(),
  forgotPassword: jest.fn(),
  resetPassword: jest.fn(),
  updatePassword: jest.fn(),
  getMe: jest.fn(),
  updateMe: jest.fn(),
  deleteMe: jest.fn(),
  getAllUsers: jest.fn(),
  getUser: jest.fn(),
  updateUser: jest.fn(),
  deleteUser: jest.fn(),
}));

jest.mock('../../../src/middleware/auth', () => ({
  protect: jest.fn((req, res, next) => next()),
  restrictTo: jest.fn(() => (req, res, next) => next()),
  auth: jest.fn((req, res, next) => next()),
}));

const router = require('../../../src/routes/auth.routes');

describe('auth.routes', () => {
  test('exposes public auth routes', () => {
    const paths = router.stack
      .filter((layer) => layer.route)
      .map((layer) => `${Object.keys(layer.route.methods)[0]} ${layer.route.path}`);
    expect(paths).toEqual(
      expect.arrayContaining([
        'post /register',
        'post /login',
        'post /verify',
        'post /forgot-password',
        'patch /reset-password/:token',
      ])
    );
  });
});
