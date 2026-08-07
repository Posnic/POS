jest.mock('../../../src/models/base.model', () => {
  class MockBaseModel {}
  MockBaseModel.getDb = jest.fn();
  MockBaseModel.currentTimeZone = null;
  MockBaseModel.startingDate = jest.fn();
  MockBaseModel.endingDate = jest.fn();
  MockBaseModel.license = null;
  MockBaseModel.currentBranch = null;
  MockBaseModel.loggedUser = null;
  MockBaseModel.loggedUserName = null;
  return MockBaseModel;
});

const mongoose = require('mongoose');
const BaseModel = require('../../../src/models/base.model');
const salesService = require('../../../src/services/sale.service');

describe('salesService.pendingSalesReportPage', () => {
  const originalGetDb = BaseModel.getDb;
  const originalStartingDate = BaseModel.startingDate;
  const originalEndingDate = BaseModel.endingDate;
  const originalTimeZone = BaseModel.currentTimeZone;
  const originalLicense = BaseModel.license;

  afterEach(() => {
    BaseModel.getDb = originalGetDb;
    BaseModel.startingDate = originalStartingDate;
    BaseModel.endingDate = originalEndingDate;
    BaseModel.currentTimeZone = originalTimeZone;
    BaseModel.license = originalLicense;
    jest.clearAllMocks();
  });

  test('returns mapped pending sales rows with correct totals and pagination', async () => {
    const branchId = new mongoose.Types.ObjectId().toString();

    const aggResults = [
      {
        _id: {
          date: new Date('2025-01-01T00:00:00Z'),
          id: new mongoose.Types.ObjectId(),
          sales_id: 'S-001',
          user_name: 'Cashier 1',
          customer_name: 'John Doe',
          customer_phone: '1234567890',
          number_of_items: 3,
        },
        pending_amount: 150,
        partial_amount: 50,
        due_amount: 100,
      },
    ];

    const aggregateMock = jest.fn().mockReturnValue({
      toArray: jest.fn().mockResolvedValue(aggResults),
    });

    const countDocumentsMock = jest.fn().mockResolvedValue(1);

    BaseModel.getDb = jest.fn().mockResolvedValue({
      collection: () => ({
        aggregate: aggregateMock,
        countDocuments: countDocumentsMock,
      }),
    });

    BaseModel.currentTimeZone = 'Asia/Kolkata';
    BaseModel.startingDate = (date) => new Date(date || '2025-01-01').getTime();
    BaseModel.endingDate = (date) => new Date(date || '2025-01-01').getTime();
    BaseModel.license = null;

    const result = await salesService.pendingSalesReportPage(
      {
        branchid: [branchId],
        starting_date: '2025-01-01',
        ending_date: '2025-01-01',
      },
      { limit: 5, page: 1 }
    );

    expect(result.status).toBe(true);
    expect(Array.isArray(result.list)).toBe(true);
    expect(result.list).toHaveLength(1);

    const row = result.list[0];
    expect(row.sale_id).toBe('S-001');
    expect(row.customer_name).toBe('John Doe');
    expect(row.customer_phone).toBe('1234567890');
    expect(row.pending_amount).toBe(150);
    expect(row.partial_amount).toBe(50);
    expect(row.due_amount).toBe(100);
    expect(row.number_of_items).toBe(3);

    expect(result.pagination).toBeDefined();
    expect(result.pagination.total).toBe(1);
    expect(result.pagination.page).toBe(1);
    expect(result.pagination.limit).toBe(5);
  });
});
