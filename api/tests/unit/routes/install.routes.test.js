'use strict';

jest.mock('../../../src/controllers/install.controller', () => ({
  add: jest.fn(),
  cleanup: jest.fn(),
}));

jest.mock('../../../src/middleware/install.validation', () => ({
  validateInstallation: [],
  validateCleanup: [],
  verifyInstallationCredentials: jest.fn((req, res, next) => next()),
}));

const router = require('../../../src/routes/install.routes');

describe('install.routes', () => {
  test('exposes install routes', () => {
    const paths = router.stack
      .filter((layer) => layer.route)
      .map((layer) => `${Object.keys(layer.route.methods)[0]} ${layer.route.path}`);
    expect(paths).toEqual(expect.arrayContaining(['post /add', 'post /', 'post /cleanup']));
  });
});
