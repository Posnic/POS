'use strict';

jest.mock('../../../src/controllers/dashboard.controller', () => ({
  getDashboardCurrentWish: jest.fn(),
  getDashboardPaymentModeData: jest.fn(),
  getPendingActivities: jest.fn(),
  getDashboardTopPerformers: jest.fn(),
  getDashboardBestSellingProducts: jest.fn(),
  getDashboardTotalAmounts: jest.fn(),
  getDashboardSalesPurchase: jest.fn(),
  getProfitSummary: jest.fn(),
  getOverview: jest.fn(),
  getDashboardExpiredProducts: jest.fn(),
  debugSessionFilter: jest.fn(),
}));

jest.mock('../../../src/middleware/auth', () => ({ protect: jest.fn((req, res, next) => next()) }));
jest.mock('../../../src/middleware/dashboard.validation', () => ({
  validateDashboardFilter: [],
  handleValidationErrors: jest.fn((req, res, next) => next()),
}));

const router = require('../../../src/routes/dashboard.routes');

describe('dashboard.routes', () => {
  test('exposes dashboard endpoints', () => {
    const paths = router.stack
      .filter((layer) => layer.route)
      .map((layer) => `${Object.keys(layer.route.methods)[0]} ${layer.route.path}`);
    expect(paths).toEqual(
      expect.arrayContaining([
        'get /welcome',
        'get /getDashboardCurrentWish',
        'get /getDashboardPaymentModeData',
        'get /getPendingActivities',
        'get /debug-session-filter',
      ])
    );
  });
});
