'use strict';

/**
 * Unit tests for src/models/dashboard.model.js
 *
 * File confirmed: src/models/dashboard.model.js — only dashboard model, no duplicates.
 * Type: Aggregation / Query Model (NOT a schema model)
 *   - extends BaseModel with native MongoDB driver
 *   - provides dashboard data access via MongoDB aggregation pipelines
 *   - one synchronous method: getDashboardCurrentWish()
 *   - loads quotes from json/quotes.json at module level (file confirmed present)
 *
 * Strategy: Mocked database tests
 *   - BaseModel fully mocked (prevents real DB connections)
 *   - getCollection() spied per test to return mock collections
 *   - Mock collections have aggregate / find / findOne / countDocuments as Jest fns
 *   - console.log/warn suppressed globally (model has heavy debug logging)
 */

// ─── Suppress model debug output ─────────────────────────────────────────────
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

// ─── Mock BaseModel (hoisted) ─────────────────────────────────────────────────

jest.mock('../../../src/models/base.model', () => {
  class MockBaseModel {
    static mongoClient = {};
    static database = {};
    static currentBranch = null;
    static currentBranchName = null;
    static license = null;
    static loggedUser = null;
    static loggedUserName = null;

    static startingDate(d) {
      return d ? new Date(d) : new Date(0);
    }
    static endingDate(d) {
      return d ? new Date(d) : new Date();
    }
    static simplifyFields(doc) {
      return doc ? { ...doc } : doc;
    }

    constructor(collectionName) {
      this.collectionName = collectionName;
    }

    async getCollection() {
      return null;
    }
  }
  return MockBaseModel;
});

// ─── Imports ──────────────────────────────────────────────────────────────────

const { ObjectId } = require('mongodb');
const DashboardModel = require('../../../src/models/dashboard.model');
const MockBaseModel = require('../../../src/models/base.model');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const newId = () => new ObjectId();

function makeCursor(docs) {
  return { toArray: jest.fn().mockResolvedValue(docs) };
}

function makeAggregateMock(docs) {
  return jest.fn().mockReturnValue(makeCursor(docs));
}

function makeCollection(overrides = {}) {
  return {
    aggregate: makeAggregateMock([]),
    find: jest.fn().mockReturnValue(makeCursor([])),
    findOne: jest.fn().mockResolvedValue(null),
    countDocuments: jest.fn().mockResolvedValue(0),
    ...overrides,
  };
}

// ─── Shared state ─────────────────────────────────────────────────────────────

let dm;

beforeEach(() => {
  jest.restoreAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});

  MockBaseModel.currentBranch = newId();
  MockBaseModel.license = newId();

  dm = new DashboardModel();
  dm.branchId = MockBaseModel.currentBranch;
  dm.licenseId = MockBaseModel.license;
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Class structure
// ═══════════════════════════════════════════════════════════════════════════════
describe('DashboardModel — class structure', () => {
  test('module exports a class', () => {
    expect(typeof DashboardModel).toBe('function');
  });

  test('instance is a subclass of MockBaseModel', () => {
    expect(dm).toBeInstanceOf(MockBaseModel);
  });

  test('constructor sets branchId, licenseId, timeZone defaults', () => {
    const fresh = new DashboardModel();
    expect(fresh.branchId).toBeNull();
    expect(fresh.licenseId).toBeNull();
    expect(fresh.timeZone).toBe('Asia/Kolkata');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. getContextMatch()
// ═══════════════════════════════════════════════════════════════════════════════
describe('DashboardModel — getContextMatch()', () => {
  test('returns baseMatch unchanged when neither branchId nor licenseId is set', () => {
    const fresh = new DashboardModel();
    MockBaseModel.currentBranch = null;
    const match = fresh.getContextMatch({ sale_process: 'Add' });
    expect(match.branch_id).toBeUndefined();
    expect(match.license).toBeUndefined();
    expect(match.sale_process).toBe('Add');
  });

  test('adds branch_id.$in with ObjectId and string forms when branchId is ObjectId', () => {
    const id = newId();
    dm.branchId = id;
    const match = dm.getContextMatch({});
    expect(match.branch_id.$in).toContain(id);
    expect(match.branch_id.$in).toContainEqual(id.toString());
  });

  test('adds branch_id.$in with string and ObjectId when branchId is a string', () => {
    const id = newId();
    dm.branchId = id.toString();
    const match = dm.getContextMatch({});
    expect(match.branch_id.$in.some((v) => v instanceof ObjectId)).toBe(true);
    expect(match.branch_id.$in).toContain(id.toString());
  });

  test('falls back to BaseModel.currentBranch when this.branchId is null', () => {
    dm.branchId = null;
    MockBaseModel.currentBranch = newId();
    const match = dm.getContextMatch({});
    expect(match.branch_id).toBeDefined();
  });

  test('adds license to match when licenseId is set', () => {
    dm.licenseId = newId();
    const match = dm.getContextMatch({});
    expect(match.license).toBeDefined();
    expect(match.license.$in).toBeDefined();
  });

  test('merges extra baseMatch fields into result', () => {
    const match = dm.getContextMatch({ date: { $gte: new Date(0) } });
    expect(match.date).toBeDefined();
    expect(match.branch_id).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. getDashboardCurrentWish() — synchronous
// ═══════════════════════════════════════════════════════════════════════════════
describe('DashboardModel — getDashboardCurrentWish()', () => {
  afterEach(() => jest.restoreAllMocks());

  function withHour(h) {
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(h);
  }

  test('returns "Good Morning" for hour 8 (6–11)', () => {
    withHour(8);
    expect(dm.getDashboardCurrentWish().data.current_wish).toBe('Good Morning');
  });

  test('returns "Good Noon" for hour 14 (12–16)', () => {
    withHour(14);
    expect(dm.getDashboardCurrentWish().data.current_wish).toBe('Good Noon');
  });

  test('returns "Good Evening" for hour 18 (17–19)', () => {
    withHour(18);
    expect(dm.getDashboardCurrentWish().data.current_wish).toBe('Good Evening');
  });

  test('returns "Good Night" for hour 22 (20–23) and hour 3 (0–5)', () => {
    withHour(22);
    expect(dm.getDashboardCurrentWish().data.current_wish).toBe('Good Night');
    withHour(3);
    expect(dm.getDashboardCurrentWish().data.current_wish).toBe('Good Night');
  });

  test('returns status:true, quotes array, and numeric current_date', () => {
    withHour(9);
    const r = dm.getDashboardCurrentWish();
    expect(r.status).toBe(true);
    expect(Array.isArray(r.data.quotes)).toBe(true);
    expect(r.data.quotes.length).toBeGreaterThan(0);
    expect(typeof r.data.current_date).toBe('number');
  });

  test('each quote has id, quote, and tamilquote fields', () => {
    withHour(9);
    const { quotes } = dm.getDashboardCurrentWish().data;
    expect(quotes[0]).toHaveProperty('id');
    expect(quotes[0]).toHaveProperty('quote');
    expect(quotes[0]).toHaveProperty('tamilquote');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. sumCollectionField()
// ═══════════════════════════════════════════════════════════════════════════════
describe('DashboardModel — sumCollectionField()', () => {
  test('returns the total from aggregate result', async () => {
    const col = makeCollection({ aggregate: makeAggregateMock([{ _id: null, total: 5000 }]) });
    jest.spyOn(dm, 'getCollection').mockResolvedValue(col);
    const total = await dm.sumCollectionField('sales', {}, 'items_total');
    expect(total).toBe(5000);
  });

  test('returns 0 when aggregate returns empty array', async () => {
    const col = makeCollection({ aggregate: makeAggregateMock([]) });
    jest.spyOn(dm, 'getCollection').mockResolvedValue(col);
    const total = await dm.sumCollectionField('sales', {}, 'items_total');
    expect(total).toBe(0);
  });

  test('returns 0 when getCollection throws', async () => {
    jest.spyOn(dm, 'getCollection').mockRejectedValue(new Error('DB down'));
    const total = await dm.sumCollectionField('sales', {}, 'items_total');
    expect(total).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4b. getProfitSummaryModel()
// ═══════════════════════════════════════════════════════════════════════════════
describe('DashboardModel — getProfitSummaryModel()', () => {
  const range = { starting_date: '2026-01-01', ending_date: '2026-01-31', filter: 'month' };

  test('computes gross/net profit, margin and cash flow from the period totals', async () => {
    // revenue, COGS, returns, purchases, expenses - keyed by collection.field.
    const sums = {
      'sales.items_total': 1000,
      'sales.total_companyprice': 600,
      'sales.items_return_total': 50,
      'receivings.items_total': 400,
      'expenses.amount': 150,
    };
    jest
      .spyOn(dm, 'sumCollectionField')
      .mockImplementation((coll, _m, field) => Promise.resolve(sums[`${coll}.${field}`] || 0));
    // Two countDocuments calls: total sales, then sales with no recorded cost.
    jest.spyOn(dm, 'getCollection').mockResolvedValue({
      countDocuments: jest.fn().mockResolvedValueOnce(12).mockResolvedValueOnce(0),
    });

    const r = await dm.getProfitSummaryModel(range);

    expect(r.status).toBe(true);
    expect(r.data.revenue).toBe(1000);
    expect(r.data.cogs).toBe(600);
    expect(r.data.gross_profit).toBe(400); // revenue - COGS
    expect(r.data.expenses).toBe(150);
    expect(r.data.net_profit).toBe(250); // gross - expenses
    expect(r.data.purchases).toBe(400);
    expect(r.data.cash_flow).toBe(450); // revenue - purchases - expenses
    expect(r.data.margin_percent).toBe(25); // 250/1000
    expect(r.data.sales_count).toBe(12);
    // Every sale had a recorded cost and cost <= revenue: fully trustworthy.
    expect(r.data.cost_missing_sales).toBe(0);
    expect(r.data.cost_coverage).toBe(100);
    expect(r.data.cost_reliable).toBe(true);
  });

  test('margin is 0 with no revenue, and never divides by zero', async () => {
    jest.spyOn(dm, 'sumCollectionField').mockResolvedValue(0);
    jest
      .spyOn(dm, 'getCollection')
      .mockResolvedValue({ countDocuments: jest.fn().mockResolvedValue(0) });
    const r = await dm.getProfitSummaryModel(range);
    expect(r.data.margin_percent).toBe(0);
    expect(r.data.net_profit).toBe(0);
  });

  test('marks profit unreliable when some sales have no recorded cost', async () => {
    const sums = {
      'sales.items_total': 1000,
      'sales.total_companyprice': 300,
      'receivings.items_total': 0,
      'expenses.amount': 0,
    };
    jest
      .spyOn(dm, 'sumCollectionField')
      .mockImplementation((coll, _m, field) => Promise.resolve(sums[`${coll}.${field}`] || 0));
    jest.spyOn(dm, 'getCollection').mockResolvedValue({
      countDocuments: jest.fn().mockResolvedValueOnce(10).mockResolvedValueOnce(4), // 4 of 10 have no cost
    });
    const r = await dm.getProfitSummaryModel(range);
    expect(r.data.cost_missing_sales).toBe(4);
    expect(r.data.cost_coverage).toBe(60);
    expect(r.data.cost_reliable).toBe(false);
  });

  test('marks profit unreliable when recorded cost exceeds sales', async () => {
    const sums = {
      'sales.items_total': 5000,
      'sales.total_companyprice': 6000, // cost above sales - implausible, likely bad data
      'receivings.items_total': 0,
      'expenses.amount': 0,
    };
    jest
      .spyOn(dm, 'sumCollectionField')
      .mockImplementation((coll, _m, field) => Promise.resolve(sums[`${coll}.${field}`] || 0));
    jest.spyOn(dm, 'getCollection').mockResolvedValue({
      countDocuments: jest.fn().mockResolvedValueOnce(8).mockResolvedValueOnce(0), // none missing, but cost > sales
    });
    const r = await dm.getProfitSummaryModel(range);
    expect(r.data.cost_missing_sales).toBe(0);
    expect(r.data.cost_reliable).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. getDashboardPaymentModeDataModel()
// ═══════════════════════════════════════════════════════════════════════════════
describe('DashboardModel — getDashboardPaymentModeDataModel()', () => {
  const dateData = { starting_date: '2024-01-01 08:00 AM', ending_date: '2024-01-31 08:00 PM' };

  test('returns status:true with paymode_data array on success', async () => {
    const rawModes = [{ _id: 'Cash', count: 3, total_amount: 1500 }];
    const col = makeCollection({ aggregate: makeAggregateMock(rawModes) });
    jest.spyOn(dm, 'getCollection').mockResolvedValue(col);

    const r = await dm.getDashboardPaymentModeDataModel(dateData);
    expect(r.status).toBe(true);
    expect(r.data.paymode_data).toHaveLength(1);
    expect(r.data.paymode_data[0].payment_mode).toBe('Cash');
    expect(r.data.paymode_data[0].sales_count).toBe(3);
    expect(r.data.paymode_data[0].amount).toBe(1500);
  });

  test('calculates percentage correctly relative to total', async () => {
    const rawModes = [
      { _id: 'Cash', count: 1, total_amount: 750 },
      { _id: 'Card', count: 1, total_amount: 250 },
    ];
    const col = makeCollection({ aggregate: makeAggregateMock(rawModes) });
    jest.spyOn(dm, 'getCollection').mockResolvedValue(col);

    const r = await dm.getDashboardPaymentModeDataModel(dateData);
    const cashItem = r.data.paymode_data.find((i) => i.payment_mode === 'Cash');
    expect(cashItem.percentage).toBe(75);
    expect(r.data.total_amount).toBe(1000);
  });

  test('uses "Others" as payment_mode label when _id is null', async () => {
    const rawModes = [{ _id: null, count: 1, total_amount: 200 }];
    const col = makeCollection({ aggregate: makeAggregateMock(rawModes) });
    jest.spyOn(dm, 'getCollection').mockResolvedValue(col);

    const r = await dm.getDashboardPaymentModeDataModel(dateData);
    expect(r.data.paymode_data[0].payment_mode).toBe('Others');
  });

  test('returns percentage 0 and total_amount 0 when aggregate returns empty', async () => {
    const col = makeCollection({ aggregate: makeAggregateMock([]) });
    jest.spyOn(dm, 'getCollection').mockResolvedValue(col);

    const r = await dm.getDashboardPaymentModeDataModel(dateData);
    expect(r.status).toBe(true);
    expect(r.data.paymode_data).toHaveLength(0);
    expect(r.data.total_amount).toBe(0);
  });

  test('populates percentage_series and pay_mode_series arrays', async () => {
    const rawModes = [{ _id: 'UPI', count: 2, total_amount: 500 }];
    const col = makeCollection({ aggregate: makeAggregateMock(rawModes) });
    jest.spyOn(dm, 'getCollection').mockResolvedValue(col);

    const r = await dm.getDashboardPaymentModeDataModel(dateData);
    expect(r.data.percentage_series).toEqual([100]);
    expect(r.data.pay_mode_series).toEqual(['UPI']);
  });

  test('returns status:false on exception', async () => {
    jest.spyOn(dm, 'getCollection').mockRejectedValue(new Error('agg fail'));
    const r = await dm.getDashboardPaymentModeDataModel(dateData);
    expect(r.status).toBe(false);
    expect(r.message).toBe('agg fail');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. getDashboardTopPerformersModel()
// ═══════════════════════════════════════════════════════════════════════════════
describe('DashboardModel — getDashboardTopPerformersModel()', () => {
  const dateData = { starting_date: '2024-01-01 08:00 AM', ending_date: '2024-01-31 08:00 PM' };

  test('returns top performer from primary path (legacy sales)', async () => {
    const userId = newId();
    const salesAgg = [{ _id: { user_id: userId }, sales_amount: 8000, sales_count: 10 }];
    const userData = { _id: userId, username: 'alice', usertype: 'admin', email: 'alice@test.com' };

    const salesCol = makeCollection({ aggregate: makeAggregateMock(salesAgg) });
    const usersCol = makeCollection({ findOne: jest.fn().mockResolvedValue(userData) });

    jest.spyOn(dm, 'getCollection').mockImplementation(async (name) => {
      if (name === 'users') return usersCol;
      return salesCol;
    });

    const r = await dm.getDashboardTopPerformersModel(dateData);
    expect(r.status).toBe(true);
    expect(r.data.user_name).toBe('alice');
    expect(r.data.sales_amount).toBe(8000);
    expect(r.data.sales_count).toBe(10);
  });

  test('returns "Unknown" and defaults when user record not found', async () => {
    const userId = newId();
    const salesAgg = [{ _id: { user_id: userId }, sales_amount: 5000, sales_count: 5 }];

    const salesCol = makeCollection({ aggregate: makeAggregateMock(salesAgg) });
    const usersCol = makeCollection({ findOne: jest.fn().mockResolvedValue(null) });

    jest.spyOn(dm, 'getCollection').mockImplementation(async (name) => {
      if (name === 'users') return usersCol;
      return salesCol;
    });

    const r = await dm.getDashboardTopPerformersModel(dateData);
    expect(r.status).toBe(true);
    expect(r.data.user_name).toBe('Unknown');
    expect(r.data.user_type).toBe('Staff');
    expect(r.data.email).toBe('');
  });

  test('uses fallback alt aggregation when primary path returns empty', async () => {
    const salesAggEmpty = makeAggregateMock([]);
    const altAgg = [{ _id: { user_id: 'user1' }, sales_amount: 3000, sales_count: 4 }];
    let callCount = 0;
    const salesCol = {
      aggregate: jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) return makeCursor([]);
        return makeCursor(altAgg);
      }),
      findOne: jest.fn().mockResolvedValue(null),
      countDocuments: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockReturnValue(makeCursor([])),
    };
    const usersCol = makeCollection({ findOne: jest.fn().mockResolvedValue(null) });

    jest.spyOn(dm, 'getCollection').mockImplementation(async (name) => {
      if (name === 'users') return usersCol;
      return salesCol;
    });

    const r = await dm.getDashboardTopPerformersModel(dateData);
    expect(r.status).toBe(true);
    expect(r.data.sales_amount).toBe(3000);
  });

  test('returns status:true with empty data when both paths return no results', async () => {
    const salesCol = makeCollection({ aggregate: makeAggregateMock([]) });
    jest.spyOn(dm, 'getCollection').mockResolvedValue(salesCol);

    const r = await dm.getDashboardTopPerformersModel(dateData);
    expect(r.status).toBe(true);
    expect(r.data).toEqual({});
    expect(r.message).toMatch(/no sales/i);
  });

  test('returns status:false on exception', async () => {
    jest.spyOn(dm, 'getCollection').mockRejectedValue(new Error('top fail'));
    const r = await dm.getDashboardTopPerformersModel(dateData);
    expect(r.status).toBe(false);
    expect(r.message).toBe('top fail');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. getDashboardBestSellingProductsModel()
// ═══════════════════════════════════════════════════════════════════════════════
describe('DashboardModel — getDashboardBestSellingProductsModel()', () => {
  const dateData = { starting_date: '2024-01-01 08:00 AM', ending_date: '2024-01-31 08:00 PM' };

  test('returns best_selling_products array on success', async () => {
    const raw = [
      { _id: 'Product A', total_qty: 50, total_amount: 2500.555 },
      { _id: 'Product B', total_qty: 30, total_amount: 900 },
    ];
    const col = makeCollection({ aggregate: makeAggregateMock(raw) });
    jest.spyOn(dm, 'getCollection').mockResolvedValue(col);

    const r = await dm.getDashboardBestSellingProductsModel(dateData);
    expect(r.status).toBe(true);
    expect(r.data.best_selling_products).toHaveLength(2);
    expect(r.data.best_selling_products[0].item_name).toBe('Product A');
    expect(r.data.best_selling_products[0].total_qty).toBe(50);
  });

  test('rounds total_amount to 2 decimal places', async () => {
    const raw = [{ _id: 'Widget', total_qty: 10, total_amount: 1234.5678 }];
    const col = makeCollection({ aggregate: makeAggregateMock(raw) });
    jest.spyOn(dm, 'getCollection').mockResolvedValue(col);

    const r = await dm.getDashboardBestSellingProductsModel(dateData);
    expect(r.data.best_selling_products[0].total_amount).toBe(1234.57);
  });

  test('returns empty best_selling_products array when no sales', async () => {
    const col = makeCollection({ aggregate: makeAggregateMock([]) });
    jest.spyOn(dm, 'getCollection').mockResolvedValue(col);

    const r = await dm.getDashboardBestSellingProductsModel(dateData);
    expect(r.status).toBe(true);
    expect(r.data.best_selling_products).toHaveLength(0);
  });

  test('returns status:false on exception', async () => {
    jest.spyOn(dm, 'getCollection').mockRejectedValue(new Error('bsp fail'));
    const r = await dm.getDashboardBestSellingProductsModel(dateData);
    expect(r.status).toBe(false);
    expect(r.message).toBe('bsp fail');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. getDashboardSalesPurchaseModel()
// ═══════════════════════════════════════════════════════════════════════════════
describe('DashboardModel — getDashboardSalesPurchaseModel()', () => {
  const dateData = {
    starting_date: '2024-01-01 08:00 AM',
    ending_date: '2024-01-31 08:00 PM',
    filter: 'January',
  };

  test('returns dataSet with sales and purchase totals', async () => {
    const salesCol = makeCollection({
      aggregate: makeAggregateMock([{ _id: null, total: 12000 }]),
    });
    const purchaseCol = makeCollection({
      aggregate: makeAggregateMock([{ _id: null, total: 5000 }]),
    });

    jest.spyOn(dm, 'getCollection').mockImplementation(async (name) => {
      if (name === 'receivings') return purchaseCol;
      return salesCol;
    });

    const r = await dm.getDashboardSalesPurchaseModel(dateData);
    expect(r.status).toBe(true);
    expect(r.data).toHaveLength(1);
    expect(r.data[0].month).toBe('January');
    expect(r.data[0].sales).toBe(12000);
    expect(r.data[0].purchase).toBe(5000);
  });

  test('returns zeros when both collections are empty', async () => {
    const emptyCol = makeCollection({ aggregate: makeAggregateMock([]) });
    jest.spyOn(dm, 'getCollection').mockResolvedValue(emptyCol);

    const r = await dm.getDashboardSalesPurchaseModel(dateData);
    expect(r.status).toBe(true);
    expect(r.data[0].sales).toBe(0);
    expect(r.data[0].purchase).toBe(0);
  });

  test('uses data.filter as the month label in dataSet', async () => {
    const emptyCol = makeCollection({ aggregate: makeAggregateMock([]) });
    jest.spyOn(dm, 'getCollection').mockResolvedValue(emptyCol);

    const r = await dm.getDashboardSalesPurchaseModel({ ...dateData, filter: 'Q1' });
    expect(r.data[0].month).toBe('Q1');
  });

  test('returns status:false on exception', async () => {
    jest.spyOn(dm, 'getCollection').mockRejectedValue(new Error('sp fail'));
    const r = await dm.getDashboardSalesPurchaseModel(dateData);
    expect(r.status).toBe(false);
    expect(r.message).toBe('sp fail');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. getDashboardExpiredProducts()
// ═══════════════════════════════════════════════════════════════════════════════
describe('DashboardModel — getDashboardExpiredProducts()', () => {
  test('returns expired_stock_items array on success', async () => {
    const expDate = new Date('2023-12-31');
    const items = [{ name: 'Milk', available_quantity: 10, items_expiry_date: expDate }];
    const col = makeCollection({ find: jest.fn().mockReturnValue(makeCursor(items)) });
    jest.spyOn(dm, 'getCollection').mockResolvedValue(col);

    const r = await dm.getDashboardExpiredProducts({});
    expect(r.status).toBe(true);
    expect(r.data.expired_stock_items).toHaveLength(1);
    expect(r.data.expired_stock_items[0].item_name).toBe('Milk');
    expect(r.data.expired_stock_items[0].quantity).toBe(10);
  });

  test('formats expiry_date as YYYY-MM-DD string from a Date object', async () => {
    const items = [
      { name: 'Juice', available_quantity: 5, items_expiry_date: new Date('2023-06-15') },
    ];
    const col = makeCollection({ find: jest.fn().mockReturnValue(makeCursor(items)) });
    jest.spyOn(dm, 'getCollection').mockResolvedValue(col);

    const r = await dm.getDashboardExpiredProducts({});
    expect(r.data.expired_stock_items[0].expiry_date).toBe('2023-06-15');
  });

  test('formats expiry_date from a numeric timestamp', async () => {
    const ts = new Date('2023-08-01').getTime();
    const items = [{ name: 'Cheese', available_quantity: 3, items_expiry_date: ts }];
    const col = makeCollection({ find: jest.fn().mockReturnValue(makeCursor(items)) });
    jest.spyOn(dm, 'getCollection').mockResolvedValue(col);

    const r = await dm.getDashboardExpiredProducts({});
    expect(r.data.expired_stock_items[0].expiry_date).toBe('2023-08-01');
  });

  test('returns empty array when no expired items found', async () => {
    const col = makeCollection({ find: jest.fn().mockReturnValue(makeCursor([])) });
    jest.spyOn(dm, 'getCollection').mockResolvedValue(col);

    const r = await dm.getDashboardExpiredProducts({});
    expect(r.status).toBe(true);
    expect(r.data.expired_stock_items).toHaveLength(0);
  });

  test('returns status:false on exception', async () => {
    jest.spyOn(dm, 'getCollection').mockRejectedValue(new Error('exp fail'));
    const r = await dm.getDashboardExpiredProducts({});
    expect(r.status).toBe(false);
    expect(r.message).toBe('exp fail');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. getDashboardTotalAmountsModel()
// ═══════════════════════════════════════════════════════════════════════════════
describe('DashboardModel — getDashboardTotalAmountsModel()', () => {
  const dateData = {
    starting_date: '2024-01-01 08:00 AM',
    ending_date: '2024-01-31 08:00 PM',
    filter: 'month',
  };

  function makeFullMockedCollections() {
    const salesCol = {
      aggregate: jest.fn().mockReturnValue(makeCursor([])),
      countDocuments: jest.fn().mockResolvedValue(10),
      find: jest.fn().mockReturnValue(makeCursor([])),
      findOne: jest.fn().mockResolvedValue(null),
    };
    const purchaseCol = {
      aggregate: jest.fn().mockReturnValue(makeCursor([])),
      countDocuments: jest.fn().mockResolvedValue(5),
      find: jest.fn().mockReturnValue(makeCursor([])),
      findOne: jest.fn().mockResolvedValue(null),
    };
    return { salesCol, purchaseCol };
  }

  test('returns status:true with total_data and list_data on success', async () => {
    const { salesCol, purchaseCol } = makeFullMockedCollections();
    jest.spyOn(dm, 'getCollection').mockImplementation(async (name) => {
      if (name === 'receivings') return purchaseCol;
      return salesCol;
    });

    const r = await dm.getDashboardTotalAmountsModel(dateData);
    expect(r.status).toBe(true);
    expect(r.data).toHaveProperty('total_data');
    expect(r.data).toHaveProperty('list_data');
  });

  test('total_data reflects countDocuments results', async () => {
    const { salesCol, purchaseCol } = makeFullMockedCollections();
    salesCol.countDocuments.mockResolvedValue(20);
    purchaseCol.countDocuments.mockResolvedValue(8);

    jest.spyOn(dm, 'getCollection').mockImplementation(async (name) => {
      if (name === 'receivings') return purchaseCol;
      return salesCol;
    });

    const r = await dm.getDashboardTotalAmountsModel(dateData);
    expect(r.data.total_data.Total_Sales_Amount).toBe(20);
    expect(r.data.total_data.Total_Purchase_Amount).toBe(8);
  });

  test('list_data has all six axis arrays', async () => {
    const { salesCol, purchaseCol } = makeFullMockedCollections();
    jest.spyOn(dm, 'getCollection').mockImplementation(async (name) => {
      if (name === 'receivings') return purchaseCol;
      return salesCol;
    });

    const r = await dm.getDashboardTotalAmountsModel(dateData);
    const ld = r.data.list_data;
    for (const key of [
      'sales_x_axis',
      'sales_y_axis',
      'purchase_x_axis',
      'purchase_y_axis',
      'return_x_axis',
      'return_y_axis',
    ]) {
      expect(Array.isArray(ld[key])).toBe(true);
    }
  });

  test('returns status:false on exception', async () => {
    jest.spyOn(dm, 'getCollection').mockRejectedValue(new Error('ta fail'));
    const r = await dm.getDashboardTotalAmountsModel(dateData);
    expect(r.status).toBe(false);
    expect(r.message).toBe('ta fail');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. getPendingActivitiesModel()
// ═══════════════════════════════════════════════════════════════════════════════
describe('DashboardModel — getPendingActivitiesModel()', () => {
  const dateData = { starting_date: '2024-01-01 08:00 AM', ending_date: '2024-01-31 08:00 PM' };

  const pendingDoc = {
    _id: { customer_id: 'cust1', customer_name: 'Alice' },
    totalInAmount: 1000,
    totalOutAmount: 200,
    totalPendingAmount: 500,
    totalAmountDue: 800,
    due: 500,
  };

  function makeTransactionCollection(agg1Docs, agg2Docs) {
    let calls = 0;
    return {
      aggregate: jest.fn().mockImplementation(() => {
        calls++;
        return makeCursor(calls === 1 ? agg1Docs : agg2Docs);
      }),
      countDocuments: jest.fn().mockResolvedValue(10),
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockReturnValue(makeCursor([])),
    };
  }

  test('returns transactionData array on success', async () => {
    const col = makeTransactionCollection([pendingDoc], [pendingDoc]);
    jest.spyOn(dm, 'getCollection').mockResolvedValue(col);

    const r = await dm.getPendingActivitiesModel(dateData);
    expect(r.status).toBe(true);
    expect(Array.isArray(r.data)).toBe(true);
    expect(r.data).toHaveLength(1);
  });

  test('maps aggregate result to { id, name, wallet, pending, due }', async () => {
    const col = makeTransactionCollection([pendingDoc], [pendingDoc]);
    jest.spyOn(dm, 'getCollection').mockResolvedValue(col);

    const r = await dm.getPendingActivitiesModel(dateData);
    const row = r.data[0];
    expect(row.id).toBe('cust1');
    expect(row.name).toBe('Alice');
    expect(typeof row.wallet).toBe('number');
    expect(typeof row.pending).toBe('number');
    expect(typeof row.due).toBe('number');
    expect(row.outstandingCustomersModal).toBe(false);
  });

  test('returns empty array when aggregate returns no results', async () => {
    const col = makeTransactionCollection([], []);
    jest.spyOn(dm, 'getCollection').mockResolvedValue(col);

    const r = await dm.getPendingActivitiesModel(dateData);
    expect(r.status).toBe(true);
    expect(r.data).toHaveLength(0);
  });

  test('returns status:false on exception', async () => {
    jest.spyOn(dm, 'getCollection').mockRejectedValue(new Error('pa fail'));
    const r = await dm.getPendingActivitiesModel(dateData);
    expect(r.status).toBe(false);
    expect(r.message).toBe('pa fail');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getOverviewModel() — the one-call dashboard
// ═══════════════════════════════════════════════════════════════════════════════
describe('DashboardModel — getOverviewModel()', () => {
  const range = { starting_date: '2026-01-01', ending_date: '2026-01-31', filter: 'month' };

  test('assembles totals, payment mix, top items and low-stock in one call; profit for a financial user', async () => {
    jest.spyOn(dm, 'getDashboardTotalAmountsModel').mockResolvedValue({
      status: true,
      data: {
        total_data: { Total_Sales_Amount: 12 },
        list_data: { sales_x_axis: ['a', 'b'], sales_y_axis: [100, 200] },
      },
    });
    jest.spyOn(dm, 'getDashboardPaymentModeDataModel').mockResolvedValue({
      status: true,
      data: {
        pay_mode_series: ['Cash', 'Card'],
        percentage_series: [70, 30],
        paymode_data: [{ amount: 700 }, { amount: 300 }],
      },
    });
    jest.spyOn(dm, 'getDashboardBestSellingProductsModel').mockResolvedValue({
      status: true,
      data: { best_selling_products: [{ item_name: 'X' }] },
    });
    jest.spyOn(dm, 'getLowStockSummary').mockResolvedValue({ count: 3, items: [] });
    jest.spyOn(dm, 'getProfitSummaryModel').mockResolvedValue({
      status: true,
      data: { net_profit: 250, purchases: 400, expenses: 150 },
    });
    // The only real sumCollectionField call left is the KPI tax total.
    jest.spyOn(dm, 'sumCollectionField').mockResolvedValue(50);

    const r = await dm.getOverviewModel(range, { financials: true });
    expect(r.status).toBe(true);
    expect(r.data.totals.sales_count).toBe(12);
    expect(r.data.totals.sales_amount).toBe(300);
    expect(r.data.paymentMix[0]).toEqual({ mode: 'Cash', pct: 70, amount: 700 });
    expect(r.data.topItems).toHaveLength(1);
    expect(r.data.lowStock.count).toBe(3);
    expect(r.data.profit).toEqual({ net_profit: 250, purchases: 400, expenses: 150 });
    // The six KPI tiles: sales/purchase/expenses reused, tax summed, cash/UPI
    // split from the payment mix (Card counts as neither cash nor UPI).
    expect(r.data.kpis).toMatchObject({
      total_sales: 300,
      total_purchase: 400,
      total_expenses: 150,
      total_tax: 50,
      total_cash: 700,
      total_upi: 0,
    });
  });

  test('hides profit and rupee amounts from a non-financial user, and never runs the profit query', async () => {
    jest.spyOn(dm, 'getDashboardTotalAmountsModel').mockResolvedValue({ status: true, data: {} });
    jest.spyOn(dm, 'getDashboardPaymentModeDataModel').mockResolvedValue({
      status: true,
      data: {
        pay_mode_series: ['Cash'],
        percentage_series: [100],
        paymode_data: [{ amount: 700 }],
      },
    });
    jest.spyOn(dm, 'getDashboardBestSellingProductsModel').mockResolvedValue({
      status: true,
      data: { best_selling_products: [] },
    });
    jest.spyOn(dm, 'getLowStockSummary').mockResolvedValue({ count: 0, items: [] });
    const profitSpy = jest.spyOn(dm, 'getProfitSummaryModel');

    const r = await dm.getOverviewModel(range, { financials: false });
    expect(r.data.profit).toBeNull();
    expect(r.data.kpis).toBeNull(); // no money totals for a non-financial user
    expect(r.data.paymentMix[0].pct).toBe(100);
    expect(r.data.paymentMix[0].amount).toBeUndefined();
    expect(profitSpy).not.toHaveBeenCalled();
  });
});
