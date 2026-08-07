'use strict';

jest.mock('../../../src/controllers/easy-tables.controller', () => ({
  getTableData: jest.fn(),
}));

jest.mock('../../../src/middleware/auth', () => ({
  protect: jest.fn((req, res, next) => next()),
}));

const router = require('../../../src/routes/easy-tables.routes');

describe('easy-tables.routes', () => {
  test('exposes data route', () => {
    const paths = router.stack
      .filter((layer) => layer.route)
      .map((layer) => `${Object.keys(layer.route.methods)[0]} ${layer.route.path}`);
    expect(paths).toContain('get /data');
  });

  test('applies authentication before table routes', () => {
    expect(router.stack.some((layer) => !layer.route && layer.name === 'mockConstructor')).toBe(
      true
    );
  });
});
