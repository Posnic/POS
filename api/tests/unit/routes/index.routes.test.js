'use strict';

const mockRouteStub = () => {
  const middleware = jest.fn((req, res, next) => next && next());
  middleware.stack = [];
  return middleware;
};

jest.mock('../../../src/routes/activity-logs.routes', () => mockRouteStub());
jest.mock('../../../src/routes/auth.routes', () => mockRouteStub());
jest.mock('../../../src/routes/auth-utils.routes', () => mockRouteStub());
jest.mock('../../../src/routes/base.routes', () => mockRouteStub());
jest.mock('../../../src/routes/branches.routes', () => mockRouteStub());
jest.mock('../../../src/routes/categories.routes', () => mockRouteStub());
jest.mock('../../../src/routes/customer-categories.routes', () => mockRouteStub());
jest.mock('../../../src/routes/common-pdf.routes', () => mockRouteStub());
jest.mock('../../../src/routes/customers.routes', () => mockRouteStub());
jest.mock('../../../src/routes/dashboard.routes', () => mockRouteStub());
jest.mock('../../../src/routes/easy-tables.routes', () => mockRouteStub());
jest.mock('../../../src/routes/expenses.routes', () => mockRouteStub());
jest.mock('../../../src/routes/install.routes', () => mockRouteStub());
jest.mock('../../../src/routes/items.routes', () => mockRouteStub());
jest.mock('../../../src/routes/receivings.routes', () => mockRouteStub());
jest.mock('../../../src/routes/registers.routes', () => mockRouteStub());
jest.mock('../../../src/routes/sales.routes', () => mockRouteStub());
jest.mock('../../../src/routes/settings.routes', () => mockRouteStub());
jest.mock('../../../src/routes/stock-logs.routes', () => mockRouteStub());
jest.mock('../../../src/routes/suppliers.routes', () => mockRouteStub());
jest.mock('../../../src/routes/users.routes', () => mockRouteStub());
jest.mock('../../../src/routes/variants.routes', () => mockRouteStub());
jest.mock('../../../src/routes/whatsapp.routes', () => mockRouteStub());

const router = require('../../../src/routes/index');

describe('routes/index', () => {
  test('exposes top-level mounts', () => {
    expect(router).toBeDefined();
    expect(typeof router.use).toBe('function');
  });
});
