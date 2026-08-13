/**
 * Unit tests for DashboardController
 *
 * Methods covered:
 *   getDashboardCurrentWish, getDashboardPaymentModeData,
 *   getPendingActivities, getDashboardTopPerformers,
 *   getDashboardTotalAmounts, getDashboardSalesPurchase,
 *   getDashboardBestSellingProducts, getDashboardExpiredProducts,
 *   debugSessionFilter, getDatesBasedOnFilter
 *
 * Mocked dependencies:
 *   DashboardModel, Branch, sessionFilterUtil, BaseModel, base.service
 */

jest.mock('../../../src/models/dashboard.model', () =>
  jest.fn().mockImplementation(() => ({
    getDashboardCurrentWish: jest.fn(),
    getDashboardPaymentModeDataModel: jest.fn(),
    getPendingActivitiesModel: jest.fn(),
    getDashboardTopPerformersModel: jest.fn(),
    getDashboardTotalAmountsModel: jest.fn(),
    getDashboardSalesPurchaseModel: jest.fn(),
    getProfitSummaryModel: jest.fn(),
    getOverviewModel: jest.fn(),
    getLowStockSummary: jest.fn(),
    getDashboardBestSellingProductsModel: jest.fn(),
    getDashboardExpiredProducts: jest.fn(),
    branchId: null,
    licenseId: null,
    timeZone: 'Asia/Kolkata',
  }))
);

jest.mock('../../../src/models/branch.model', () => ({
  findOne: jest.fn(),
}));

jest.mock('../../../src/utils/session-filter.util', () => ({
  applySessionFilter: jest.fn(),
  hasSessionFilterPermission: jest.fn(),
  getUserSessionData: jest.fn(),
}));

jest.mock('../../../src/models/base.model', () => {
  class BaseModelMock {
    constructor(collectionName) {
      this.collectionName = collectionName;
    }
  }
  BaseModelMock.currentBranch = null;
  BaseModelMock.license = null;
  BaseModelMock.loggedUser = null;
  BaseModelMock.loggedUserName = null;
  BaseModelMock.currentBranchName = null;
  return BaseModelMock;
});

jest.mock('../../../src/services/base.service', () => ({
  getReportAutoSuggestions: jest.fn(),
  getAutoSuggestions: jest.fn(),
  getDefaultSuggestions: jest.fn(),
}));

const sessionFilterUtil = require('../../../src/utils/session-filter.util');
const Branch = require('../../../src/models/branch.model');
const controller = require('../../../src/controllers/dashboard.controller');

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_ID = '507f1f77bcf86cd799439011';

const DEFAULT_DATE_RANGE = {
  start_date: new Date('2026-01-01T00:00:00.000Z'),
  end_date: new Date('2026-01-31T23:59:59.999Z'),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const adminUser = () => ({
  _id: VALID_ID,
  username: 'admin',
  usertype: 'admin',
  branch_id: VALID_ID,
  license: VALID_ID,
  settings: { time_zone: 'Asia/Kolkata' },
  access: {},
});

const userWithoutBranch = () => ({
  _id: VALID_ID,
  username: 'admin',
  usertype: 'admin',
  license: VALID_ID,
  settings: { time_zone: 'Asia/Kolkata' },
  access: {},
});

const mockReq = (overrides = {}) => ({
  user: adminUser(),
  query: {},
  params: {},
  body: {},
  session: {},
  headers: {},
  app: { locals: {} },
  ...overrides,
});

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

// ─── Setup ────────────────────────────────────────────────────────────────────

let mdl;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});

  mdl = {
    getDashboardCurrentWish: jest.fn(),
    getDashboardPaymentModeDataModel: jest.fn(),
    getPendingActivitiesModel: jest.fn(),
    getDashboardTopPerformersModel: jest.fn(),
    getDashboardTotalAmountsModel: jest.fn(),
    getDashboardSalesPurchaseModel: jest.fn(),
    getProfitSummaryModel: jest.fn(),
    getOverviewModel: jest.fn(),
    getLowStockSummary: jest.fn(),
    getDashboardBestSellingProductsModel: jest.fn(),
    getDashboardExpiredProducts: jest.fn(),
    branchId: null,
    licenseId: null,
    timeZone: 'Asia/Kolkata',
  };
  controller.model = mdl;

  sessionFilterUtil.applySessionFilter.mockResolvedValue(DEFAULT_DATE_RANGE);
  sessionFilterUtil.hasSessionFilterPermission.mockReturnValue(false);
  sessionFilterUtil.getUserSessionData.mockResolvedValue(null);

  Branch.findOne.mockReturnValue({
    lean: jest.fn().mockResolvedValue(null),
  });
});

// ─── getDashboardCurrentWish ──────────────────────────────────────────────────

describe('getDashboardCurrentWish', () => {
  test('returns 200 with wish and quotes when model succeeds', async () => {
    const wishData = { current_wish: 'Good Morning', current_date: 1, quotes: [] };
    mdl.getDashboardCurrentWish.mockReturnValue({
      status: true,
      message: 'Wish and quotes retrieved successfully',
      data: wishData,
    });

    const res = mockRes();
    await controller.getDashboardCurrentWish(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      type: 'success',
      message: 'Wish and quotes retrieved successfully',
      data: wishData,
    });
  });

  test('returns 500 when model returns status false', async () => {
    mdl.getDashboardCurrentWish.mockReturnValue({
      status: false,
      message: 'Something went wrong',
      data: null,
    });

    const res = mockRes();
    await controller.getDashboardCurrentWish(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Something went wrong' })
    );
  });

  test('returns 500 with fallback message when model returns null', async () => {
    mdl.getDashboardCurrentWish.mockReturnValue(null);

    const res = mockRes();
    await controller.getDashboardCurrentWish(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      type: 'error',
      message: 'Failed to retrieve dashboard wish',
      data: null,
    });
  });

  test('returns 500 with generic message when model throws', async () => {
    mdl.getDashboardCurrentWish.mockImplementation(() => {
      throw new Error('Unexpected crash');
    });

    const res = mockRes();
    await controller.getDashboardCurrentWish(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      type: 'error',
      message: 'An error occurred while fetching dashboard welcome message',
      data: null,
    });
  });
});

// ─── getDashboardPaymentModeData ──────────────────────────────────────────────

describe('getDashboardPaymentModeData', () => {
  test('returns 200 with payment mode data when model succeeds', async () => {
    const paymentData = {
      paymode_data: [],
      percentage_series: [],
      pay_mode_series: [],
      total_amount: 1000,
    };
    mdl.getDashboardPaymentModeDataModel.mockResolvedValue({
      status: true,
      data: paymentData,
      message: 'success',
    });

    const res = mockRes();
    await controller.getDashboardPaymentModeData(mockReq({ query: { filter: 'today' } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      type: 'success',
      message: 'Payment mode data retrieved successfully',
      data: paymentData,
    });
  });

  test("defaults to filter 'today' when query.filter is omitted", async () => {
    mdl.getDashboardPaymentModeDataModel.mockResolvedValue({
      status: true,
      data: {},
      message: 'success',
    });

    const res = mockRes();
    await controller.getDashboardPaymentModeData(mockReq({ query: {} }), res);

    expect(mdl.getDashboardPaymentModeDataModel).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('passes filtered date range from sessionFilterUtil to model', async () => {
    const customRange = {
      start_date: new Date('2026-03-01T00:00:00.000Z'),
      end_date: new Date('2026-03-31T23:59:59.999Z'),
    };
    sessionFilterUtil.applySessionFilter.mockResolvedValue(customRange);
    mdl.getDashboardPaymentModeDataModel.mockResolvedValue({
      status: true,
      data: {},
      message: 'success',
    });

    const res = mockRes();
    await controller.getDashboardPaymentModeData(mockReq({ query: { filter: 'month' } }), res);

    expect(mdl.getDashboardPaymentModeDataModel).toHaveBeenCalledWith({
      starting_date: customRange.start_date,
      ending_date: customRange.end_date,
    });
  });

  test('returns 400 when model returns status false with message', async () => {
    mdl.getDashboardPaymentModeDataModel.mockResolvedValue({
      status: false,
      message: 'No sales data',
      data: null,
    });

    const res = mockRes();
    await controller.getDashboardPaymentModeData(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'No sales data' })
    );
  });

  test('returns 400 with fallback message when model status false and no message', async () => {
    mdl.getDashboardPaymentModeDataModel.mockResolvedValue({ status: false });

    const res = mockRes();
    await controller.getDashboardPaymentModeData(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Failed to retrieve payment mode data' })
    );
  });

  test('returns 500 when model throws', async () => {
    mdl.getDashboardPaymentModeDataModel.mockRejectedValue(new Error('DB error'));

    const res = mockRes();
    await controller.getDashboardPaymentModeData(mockReq({ query: { filter: 'month' } }), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      type: 'error',
      message: 'An error occurred while fetching payment mode data',
      data: null,
    });
  });

  test('returns 500 when sessionFilterUtil throws', async () => {
    sessionFilterUtil.applySessionFilter.mockRejectedValue(new Error('Session DB error'));

    const res = mockRes();
    await controller.getDashboardPaymentModeData(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  test('returns 200 with zero total_amount when no sales match filter', async () => {
    mdl.getDashboardPaymentModeDataModel.mockResolvedValue({
      status: true,
      data: { paymode_data: [], total_amount: 0 },
      message: 'success',
    });

    const res = mockRes();
    await controller.getDashboardPaymentModeData(mockReq({ query: { filter: 'year' } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: { paymode_data: [], total_amount: 0 } })
    );
  });
});

// ─── getPendingActivities ──────────────────────────────────────────────────────

describe('getPendingActivities', () => {
  test('returns 200 with pending activities list when model succeeds', async () => {
    const activities = [{ id: 'c1', name: 'Customer A', due: 500, pending: 200 }];
    mdl.getPendingActivitiesModel.mockResolvedValue({
      status: true,
      data: activities,
      message: 'Success',
    });

    const res = mockRes();
    await controller.getPendingActivities(mockReq({ query: { filter: 'today' } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      type: 'success',
      message: 'Pending activities retrieved successfully',
      data: activities,
    });
  });

  test('returns 200 with empty array when no pending activities exist', async () => {
    mdl.getPendingActivitiesModel.mockResolvedValue({ status: true, data: [], message: 'Success' });

    const res = mockRes();
    await controller.getPendingActivities(mockReq({ query: {} }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: [] }));
  });

  test("defaults to filter 'today' when query.filter is omitted", async () => {
    mdl.getPendingActivitiesModel.mockResolvedValue({ status: true, data: [], message: 'Success' });

    const res = mockRes();
    await controller.getPendingActivities(mockReq({ query: {} }), res);

    expect(mdl.getPendingActivitiesModel).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 400 when model returns status false', async () => {
    mdl.getPendingActivitiesModel.mockResolvedValue({
      status: false,
      message: 'Aggregation failed',
      data: null,
    });

    const res = mockRes();
    await controller.getPendingActivities(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Aggregation failed' })
    );
  });

  test('returns 400 with fallback message when status false and no message', async () => {
    mdl.getPendingActivitiesModel.mockResolvedValue({ status: false });

    const res = mockRes();
    await controller.getPendingActivities(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Failed to retrieve pending activities' })
    );
  });

  test('returns 500 when model throws', async () => {
    mdl.getPendingActivitiesModel.mockRejectedValue(new Error('crash'));

    const res = mockRes();
    await controller.getPendingActivities(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      type: 'error',
      message: 'An error occurred while fetching pending activities',
      data: null,
    });
  });

  test('passes filtered date range to model', async () => {
    const sessionRange = {
      start_date: new Date('2026-01-01T09:00:00.000Z'),
      end_date: new Date('2026-01-31T23:59:59.999Z'),
      session_applied: true,
    };
    sessionFilterUtil.applySessionFilter.mockResolvedValue(sessionRange);
    mdl.getPendingActivitiesModel.mockResolvedValue({ status: true, data: [], message: 'Success' });

    const res = mockRes();
    await controller.getPendingActivities(mockReq({ query: { filter: 'today' } }), res);

    expect(mdl.getPendingActivitiesModel).toHaveBeenCalledWith({
      starting_date: sessionRange.start_date,
      ending_date: sessionRange.end_date,
    });
  });
});

// ─── getDashboardTopPerformers ─────────────────────────────────────────────────

describe('getDashboardTopPerformers', () => {
  test('returns 200 with top performer data when model succeeds', async () => {
    const performerData = {
      user_name: 'Alice',
      user_type: 'admin',
      sales_amount: 50000,
      sales_count: 100,
    };
    mdl.getDashboardTopPerformersModel.mockResolvedValue({
      status: true,
      data: performerData,
      message: 'Top performer data retrieved successfully',
    });

    const res = mockRes();
    await controller.getDashboardTopPerformers(mockReq({ query: { filter: 'month' } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      type: 'success',
      message: 'Top performers retrieved successfully',
      data: performerData,
    });
  });

  test('returns 200 with empty object when no sales data in period', async () => {
    mdl.getDashboardTopPerformersModel.mockResolvedValue({
      status: true,
      data: {},
      message: 'No sales data found for the period',
    });

    const res = mockRes();
    await controller.getDashboardTopPerformers(mockReq({ query: {} }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: {} }));
  });

  test("defaults to filter 'month' when query.filter is omitted", async () => {
    mdl.getDashboardTopPerformersModel.mockResolvedValue({
      status: true,
      data: {},
      message: 'success',
    });

    const res = mockRes();
    await controller.getDashboardTopPerformers(mockReq({ query: {} }), res);

    expect(sessionFilterUtil.applySessionFilter).toHaveBeenCalledTimes(1);
    expect(mdl.getDashboardTopPerformersModel).toHaveBeenCalledTimes(1);
  });

  test('returns 400 when model returns status false', async () => {
    mdl.getDashboardTopPerformersModel.mockResolvedValue({
      status: false,
      message: 'Query error',
    });

    const res = mockRes();
    await controller.getDashboardTopPerformers(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Query error' })
    );
  });

  test('returns 400 with fallback message when status false and no message', async () => {
    mdl.getDashboardTopPerformersModel.mockResolvedValue({ status: false });

    const res = mockRes();
    await controller.getDashboardTopPerformers(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Failed to retrieve top performers' })
    );
  });

  test('returns 500 when model throws', async () => {
    mdl.getDashboardTopPerformersModel.mockRejectedValue(new Error('DB fail'));

    const res = mockRes();
    await controller.getDashboardTopPerformers(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      type: 'error',
      message: 'An error occurred while fetching top performers',
      data: null,
    });
  });
});

// ─── getDashboardTotalAmounts ──────────────────────────────────────────────────

describe('getDashboardTotalAmounts', () => {
  test('returns 401 when req.user is missing', async () => {
    const res = mockRes();
    await controller.getDashboardTotalAmounts(mockReq({ user: null }), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      type: 'error',
      message: 'Authentication required',
      data: null,
    });
    expect(mdl.getDashboardTotalAmountsModel).not.toHaveBeenCalled();
  });

  test('returns 200 with total amounts data when model succeeds', async () => {
    const totalsData = {
      total_data: { Total_Sales_Amount: 10, Total_Purchase_Amount: 5 },
      list_data: { sales_x_axis: [], sales_y_axis: [] },
    };
    mdl.getDashboardTotalAmountsModel.mockResolvedValue({
      status: true,
      data: totalsData,
      message: 'dashboard report successfully',
    });

    const res = mockRes();
    await controller.getDashboardTotalAmounts(mockReq({ query: { filter: 'month' } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      type: 'success',
      message: 'dashboard report successfully',
      data: totalsData,
    });
  });

  test("uses fallback message 'Totals retrieved successfully' when model returns no message", async () => {
    mdl.getDashboardTotalAmountsModel.mockResolvedValue({ status: true, data: {}, message: null });

    const res = mockRes();
    await controller.getDashboardTotalAmounts(mockReq({ query: {} }), res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Totals retrieved successfully' })
    );
  });

  test('returns 400 when model returns status false', async () => {
    mdl.getDashboardTotalAmountsModel.mockResolvedValue({ status: false, message: 'Query failed' });

    const res = mockRes();
    await controller.getDashboardTotalAmounts(mockReq({ query: {} }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Query failed' })
    );
  });

  test('returns 400 with fallback message when status false and no message', async () => {
    mdl.getDashboardTotalAmountsModel.mockResolvedValue({ status: false });

    const res = mockRes();
    await controller.getDashboardTotalAmounts(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Failed to retrieve totals' })
    );
  });

  test('returns 500 when model throws', async () => {
    mdl.getDashboardTotalAmountsModel.mockRejectedValue(new Error('crash'));

    const res = mockRes();
    await controller.getDashboardTotalAmounts(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      type: 'error',
      message: 'An error occurred while fetching dashboard totals',
      data: null,
    });
  });

  test('returns 200 with zero totals when no data in period', async () => {
    const emptyTotals = {
      total_data: { Total_Sales_Amount: 0, Total_Purchase_Amount: 0 },
      list_data: {},
    };
    mdl.getDashboardTotalAmountsModel.mockResolvedValue({
      status: true,
      data: emptyTotals,
      message: 'ok',
    });

    const res = mockRes();
    await controller.getDashboardTotalAmounts(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: emptyTotals }));
  });
});

// ─── getDashboardSalesPurchase ─────────────────────────────────────────────────

describe('getDashboardSalesPurchase', () => {
  test('returns 401 when req.user is missing', async () => {
    const res = mockRes();
    await controller.getDashboardSalesPurchase(mockReq({ user: null }), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      type: 'error',
      message: 'Authentication required',
      data: null,
    });
    expect(mdl.getDashboardSalesPurchaseModel).not.toHaveBeenCalled();
  });

  test('returns 200 with sales and purchase data when model succeeds', async () => {
    const salesData = [{ month: 'month', sales: 5000, purchase: 3000 }];
    mdl.getDashboardSalesPurchaseModel.mockResolvedValue({
      status: true,
      data: salesData,
      message: 'dashboard report successfully',
    });

    const res = mockRes();
    await controller.getDashboardSalesPurchase(mockReq({ query: { filter: 'month' } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      type: 'success',
      message: 'dashboard report successfully',
      data: salesData,
    });
  });

  test('passes filter value to model', async () => {
    mdl.getDashboardSalesPurchaseModel.mockResolvedValue({ status: true, data: [], message: 'ok' });

    const res = mockRes();
    await controller.getDashboardSalesPurchase(mockReq({ query: { filter: 'year' } }), res);

    expect(mdl.getDashboardSalesPurchaseModel).toHaveBeenCalledWith(
      expect.objectContaining({ filter: 'year' })
    );
  });

  test('uses fallback message when model returns no message', async () => {
    mdl.getDashboardSalesPurchaseModel.mockResolvedValue({ status: true, data: [], message: null });

    const res = mockRes();
    await controller.getDashboardSalesPurchase(mockReq(), res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Sales/purchase data retrieved successfully' })
    );
  });

  test('returns 400 when model returns status false', async () => {
    mdl.getDashboardSalesPurchaseModel.mockResolvedValue({ status: false, message: 'No data' });

    const res = mockRes();
    await controller.getDashboardSalesPurchase(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'No data' })
    );
  });

  test('returns 400 with fallback message when status false and no message', async () => {
    mdl.getDashboardSalesPurchaseModel.mockResolvedValue({ status: false });

    const res = mockRes();
    await controller.getDashboardSalesPurchase(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Failed to retrieve sales/purchase data' })
    );
  });

  test('returns 500 when model throws', async () => {
    mdl.getDashboardSalesPurchaseModel.mockRejectedValue(new Error('crash'));

    const res = mockRes();
    await controller.getDashboardSalesPurchase(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      type: 'error',
      message: 'An error occurred while fetching sales/purchase data',
      data: null,
    });
  });
});

// ─── getDashboardBestSellingProducts ──────────────────────────────────────────

describe('getDashboardBestSellingProducts', () => {
  test('returns 401 when req.user is missing', async () => {
    const res = mockRes();
    await controller.getDashboardBestSellingProducts(mockReq({ user: null }), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      type: 'error',
      message: 'Authentication required',
      data: null,
    });
    expect(mdl.getDashboardBestSellingProductsModel).not.toHaveBeenCalled();
  });

  test('returns 200 with best selling products when model succeeds', async () => {
    const products = {
      best_selling_products: [{ item_name: 'Widget', total_qty: 100, total_amount: 5000 }],
    };
    mdl.getDashboardBestSellingProductsModel.mockResolvedValue({
      status: true,
      data: products,
      message: 'dashboard report successfully',
    });

    const res = mockRes();
    await controller.getDashboardBestSellingProducts(mockReq({ query: { filter: 'month' } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      type: 'success',
      message: 'dashboard report successfully',
      data: products,
    });
  });

  test('returns 200 with empty product list when no sales in period', async () => {
    mdl.getDashboardBestSellingProductsModel.mockResolvedValue({
      status: true,
      data: { best_selling_products: [] },
      message: 'ok',
    });

    const res = mockRes();
    await controller.getDashboardBestSellingProducts(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: { best_selling_products: [] } })
    );
  });

  test('uses fallback message when model returns no message', async () => {
    mdl.getDashboardBestSellingProductsModel.mockResolvedValue({
      status: true,
      data: {},
      message: null,
    });

    const res = mockRes();
    await controller.getDashboardBestSellingProducts(mockReq(), res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Best selling products retrieved successfully' })
    );
  });

  test('returns 400 when model returns status false', async () => {
    mdl.getDashboardBestSellingProductsModel.mockResolvedValue({
      status: false,
      message: 'No products found',
    });

    const res = mockRes();
    await controller.getDashboardBestSellingProducts(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'No products found' })
    );
  });

  test('returns 400 with fallback message when status false and no message', async () => {
    mdl.getDashboardBestSellingProductsModel.mockResolvedValue({ status: false });

    const res = mockRes();
    await controller.getDashboardBestSellingProducts(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Failed to retrieve best selling products' })
    );
  });

  test('returns 500 when model throws', async () => {
    mdl.getDashboardBestSellingProductsModel.mockRejectedValue(new Error('DB crash'));

    const res = mockRes();
    await controller.getDashboardBestSellingProducts(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      type: 'error',
      message: 'An error occurred while fetching best selling products',
      data: null,
    });
  });
});

// ─── getDashboardExpiredProducts ───────────────────────────────────────────────

describe('getDashboardExpiredProducts', () => {
  test('returns 200 with expired products when model succeeds', async () => {
    const expiredData = {
      expired_stock_items: [{ item_name: 'Milk', quantity: 5, expiry_date: '2025-12-31' }],
    };
    mdl.getDashboardExpiredProducts.mockResolvedValue({
      status: true,
      data: expiredData,
      message: 'Expired stock items retrieved successfully',
    });

    const res = mockRes();
    await controller.getDashboardExpiredProducts(mockReq({ query: { filter: 'day' } }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      type: 'success',
      message: 'Expired stock items retrieved successfully',
      data: expiredData,
    });
  });

  test('returns 200 with empty expired items list', async () => {
    mdl.getDashboardExpiredProducts.mockResolvedValue({
      status: true,
      data: { expired_stock_items: [] },
      message: 'Expired stock items retrieved successfully',
    });

    const res = mockRes();
    await controller.getDashboardExpiredProducts(mockReq({ query: {} }), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ data: { expired_stock_items: [] } })
    );
  });

  test("defaults to filter 'day' when query.filter is omitted", async () => {
    mdl.getDashboardExpiredProducts.mockResolvedValue({
      status: true,
      data: { expired_stock_items: [] },
      message: 'success',
    });

    const res = mockRes();
    await controller.getDashboardExpiredProducts(mockReq({ query: {} }), res);

    expect(mdl.getDashboardExpiredProducts).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('returns 500 (not 400) when model returns status false with message', async () => {
    mdl.getDashboardExpiredProducts.mockResolvedValue({
      status: false,
      message: 'Query failed',
      data: null,
    });

    const res = mockRes();
    await controller.getDashboardExpiredProducts(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Query failed' })
    );
  });

  test('returns 500 with fallback message when model returns null', async () => {
    mdl.getDashboardExpiredProducts.mockResolvedValue(null);

    const res = mockRes();
    await controller.getDashboardExpiredProducts(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      type: 'error',
      message: 'Failed to retrieve expired products',
      data: null,
    });
  });

  test('returns 500 when model throws', async () => {
    mdl.getDashboardExpiredProducts.mockRejectedValue(new Error('crash'));

    const res = mockRes();
    await controller.getDashboardExpiredProducts(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      type: 'error',
      message: 'An error occurred while fetching expired products data',
      data: null,
    });
  });
});

// ─── debugSessionFilter ────────────────────────────────────────────────────────

describe('debugSessionFilter', () => {
  test('returns 200 with debug data including user, permission, sessionData and filteredDateRange', async () => {
    const sessionData = { login_time: new Date('2026-01-01T08:00:00.000Z'), _id: 'sess1' };
    const filteredRange = {
      start_date: new Date('2026-03-01T00:00:00.000Z'),
      end_date: new Date('2026-04-30T23:59:59.999Z'),
      session_applied: false,
    };
    sessionFilterUtil.hasSessionFilterPermission.mockReturnValue(false);
    sessionFilterUtil.getUserSessionData.mockResolvedValue(sessionData);
    sessionFilterUtil.applySessionFilter.mockResolvedValue(filteredRange);

    const res = mockRes();
    await controller.debugSessionFilter(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.type).toBe('success');
    expect(body.message).toBe('Session filter debug completed');
    expect(body.data).toHaveProperty('hasPermission', false);
    expect(body.data).toHaveProperty('sessionData', sessionData);
    expect(body.data).toHaveProperty('filteredDateRange', filteredRange);
    expect(body.data.user).toHaveProperty('username', 'admin');
  });

  test('returns 200 with hasPermission true when user has session filter access', async () => {
    sessionFilterUtil.hasSessionFilterPermission.mockReturnValue(true);
    sessionFilterUtil.getUserSessionData.mockResolvedValue(null);
    sessionFilterUtil.applySessionFilter.mockResolvedValue(DEFAULT_DATE_RANGE);

    const res = mockRes();
    await controller.debugSessionFilter(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data.hasPermission).toBe(true);
  });

  test('returns 500 when sessionFilterUtil.hasSessionFilterPermission throws', async () => {
    sessionFilterUtil.hasSessionFilterPermission.mockImplementation(() => {
      throw new Error('Utility crash');
    });

    const res = mockRes();
    await controller.debugSessionFilter(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      type: 'error',
      message: 'Debug session filter failed',
      data: { error: 'Utility crash' },
    });
  });

  test('returns 500 when getUserSessionData throws', async () => {
    sessionFilterUtil.hasSessionFilterPermission.mockReturnValue(false);
    sessionFilterUtil.getUserSessionData.mockRejectedValue(new Error('Session lookup error'));

    const res = mockRes();
    await controller.debugSessionFilter(mockReq(), res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', message: 'Debug session filter failed' })
    );
  });
});

// ─── ensureContext — Branch.findOne fallback ───────────────────────────────────

describe('ensureContext — Branch.findOne fallback', () => {
  test('calls Branch.findOne when user has no branch_id and continues successfully', async () => {
    const branchDoc = { _id: 'branch123', license: 'lic123' };
    Branch.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(branchDoc) });
    mdl.getDashboardPaymentModeDataModel.mockResolvedValue({
      status: true,
      data: {},
      message: 'success',
    });

    const res = mockRes();
    await controller.getDashboardPaymentModeData(mockReq({ user: userWithoutBranch() }), res);

    expect(Branch.findOne).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('continues successfully when Branch.findOne returns null (no branch in DB)', async () => {
    Branch.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    mdl.getDashboardPaymentModeDataModel.mockResolvedValue({
      status: true,
      data: {},
      message: 'success',
    });

    const res = mockRes();
    await controller.getDashboardPaymentModeData(mockReq({ user: userWithoutBranch() }), res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('skips Branch.findOne when user already has branch_id', async () => {
    mdl.getDashboardPaymentModeDataModel.mockResolvedValue({
      status: true,
      data: {},
      message: 'success',
    });

    const res = mockRes();
    await controller.getDashboardPaymentModeData(mockReq(), res);

    expect(Branch.findOne).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

// ─── getDatesBasedOnFilter ─────────────────────────────────────────────────────

describe('getDatesBasedOnFilter', () => {
  const getRange = (filter) => controller.getDatesBasedOnFilter(filter, 'Asia/Kolkata');

  test("returns today at 00:00:00 to 23:59:59 for filter 'today'", () => {
    const { start_date, end_date } = getRange('today');
    const now = new Date();
    expect(start_date.toDateString()).toBe(now.toDateString());
    expect(start_date.getHours()).toBe(0);
    expect(start_date.getMinutes()).toBe(0);
    expect(start_date.getSeconds()).toBe(0);
    expect(end_date.getHours()).toBe(23);
    expect(end_date.getMinutes()).toBe(59);
    expect(end_date.getSeconds()).toBe(59);
  });

  test("returns same range as 'today' for filter 'day'", () => {
    const { start_date, end_date } = getRange('day');
    expect(start_date.getHours()).toBe(0);
    expect(end_date.getHours()).toBe(23);
    expect(start_date.toDateString()).toBe(new Date().toDateString());
  });

  test("returns yesterday 00:00:00–23:59:59 for filter 'yesterday'", () => {
    const { start_date, end_date } = getRange('yesterday');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(start_date.toDateString()).toBe(yesterday.toDateString());
    expect(end_date.toDateString()).toBe(yesterday.toDateString());
    expect(start_date.getHours()).toBe(0);
    expect(end_date.getHours()).toBe(23);
    expect(end_date.getMinutes()).toBe(59);
  });

  test("returns range starting on Sunday for filter 'week'", () => {
    const { start_date } = getRange('week');
    expect(start_date.getDay()).toBe(0);
    expect(start_date.getHours()).toBe(0);
  });

  test("returns range starting on 1st of current month for filter 'month'", () => {
    const { start_date } = getRange('month');
    expect(start_date.getDate()).toBe(1);
    expect(start_date.getHours()).toBe(0);
  });

  test("returns range starting on January 1st for filter 'year'", () => {
    const { start_date } = getRange('year');
    expect(start_date.getMonth()).toBe(0);
    expect(start_date.getDate()).toBe(1);
    expect(start_date.getHours()).toBe(0);
  });

  test("defaults to today's range for an unknown/invalid filter", () => {
    const { start_date, end_date } = getRange('quarterly');
    expect(start_date.toDateString()).toBe(new Date().toDateString());
    expect(start_date.getHours()).toBe(0);
    expect(end_date.getHours()).toBe(23);
  });

  test("is case-insensitive — 'MONTH' behaves as 'month'", () => {
    const { start_date } = getRange('MONTH');
    expect(start_date.getDate()).toBe(1);
    expect(start_date.getHours()).toBe(0);
  });

  test("is case-insensitive — 'YEAR' behaves as 'year'", () => {
    const { start_date } = getRange('YEAR');
    expect(start_date.getMonth()).toBe(0);
    expect(start_date.getDate()).toBe(1);
  });

  test('start_date is always before end_date for every known filter', () => {
    const filters = ['today', 'day', 'yesterday', 'week', 'month', 'year'];
    filters.forEach((filter) => {
      const { start_date, end_date } = getRange(filter);
      expect(start_date.getTime()).toBeLessThanOrEqual(end_date.getTime());
    });
  });
});

// ─── getProfitSummary — financial ACL gate ──────────────────────────────────
describe('getProfitSummary — financial ACL gate', () => {
  beforeEach(() => {
    mdl.getProfitSummaryModel.mockResolvedValue({
      status: true,
      data: { net_profit: 250 },
      message: 'ok',
    });
  });

  test('owner (usertype admin) gets the profit summary', async () => {
    const res = mockRes();
    await controller.getProfitSummary(mockReq({ query: { filter: 'month' } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mdl.getProfitSummaryModel).toHaveBeenCalled();
  });

  test('owner (usertype super_admin) gets the profit summary', async () => {
    const owner = {
      _id: VALID_ID,
      usertype: 'super_admin',
      role: 'super_admin',
      license: VALID_ID,
      settings: {},
      access: {},
    };
    const res = mockRes();
    await controller.getProfitSummary(mockReq({ user: owner }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mdl.getProfitSummaryModel).toHaveBeenCalled();
  });

  test('a salesperson without the flag is refused (403) and the model is never called', async () => {
    const staff = {
      _id: VALID_ID,
      usertype: 'staff',
      role: 'staff',
      license: VALID_ID,
      settings: {},
      access: {},
    };
    const res = mockRes();
    await controller.getProfitSummary(mockReq({ user: staff }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mdl.getProfitSummaryModel).not.toHaveBeenCalled();
  });

  test('a manager granted access.dashboard.financials gets it', async () => {
    const manager = {
      _id: VALID_ID,
      usertype: 'staff',
      role: 'staff',
      license: VALID_ID,
      settings: {},
      access: { dashboard: { financials: true } },
    };
    const res = mockRes();
    await controller.getProfitSummary(mockReq({ user: manager }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test('unauthenticated request is 401', async () => {
    const res = mockRes();
    await controller.getProfitSummary(mockReq({ user: null }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
