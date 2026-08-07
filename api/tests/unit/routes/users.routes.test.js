'use strict';

jest.mock('../../../src/controllers/users.controller', () => {
  const createHandler = () => jest.fn(function handler() {});
  const controller = new Proxy(
    {},
    {
      get: (target, property) => {
        if (!(property in target)) {
          target[property] = createHandler();
        }
        return target[property];
      },
    }
  );

  return controller;
});

jest.mock('../../../src/middleware/auth', () => ({
  protect: jest.fn((req, res, next) => next()),
  checkPermission: jest.fn(() => (req, res, next) => next()),
}));
jest.mock('../../../src/middleware/upload', () => ({
  single: jest.fn(() => (req, res, next) => next()),
}));
jest.mock('../../../src/middleware/users.validation', () => ({
  validateUser: [],
  validateLogin: [],
  validatePasswordUpdate: [],
  validateUserVerify: [],
  validateChangeBranch: [],
  validateUserProfile: [],
  handleValidationErrors: jest.fn((req, res, next) => next()),
}));

const router = require('../../../src/routes/users.routes');

describe('users.routes', () => {
  test('exposes user routes', () => {
    expect(router.stack.filter((layer) => layer.route).length).toBeGreaterThan(0);
  });
});
