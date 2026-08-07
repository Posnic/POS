'use strict';

jest.mock('../../../src/controllers/common-pdf.controller', () => ({
  generatePdf: jest.fn(),
}));

jest.mock('../../../src/middleware/auth', () => ({
  protect: jest.fn((req, res, next) => next()),
}));

const router = require('../../../src/routes/common-pdf.routes');

describe('common-pdf.routes', () => {
  test('exposes generate route', () => {
    const paths = router.stack
      .filter((layer) => layer.route)
      .map((layer) => `${Object.keys(layer.route.methods)[0]} ${layer.route.path}`);
    expect(paths).toContain('post /generate');
  });
});
