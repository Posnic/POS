// ─── Mocks (must be declared before requires) ─────────────────────────────────

const mockItemRepositoryInstance = {
  findItemById: jest.fn(),
  updateStock: jest.fn(),
  deductStockIfAvailable: jest.fn(),
};
jest.mock('../../../src/repositories/item.repository', () =>
  jest.fn(() => mockItemRepositoryInstance)
);

const mockCustomerRepositoryInstance = { findById: jest.fn() };
jest.mock('../../../src/repositories/customer.repository', () =>
  jest.fn(() => mockCustomerRepositoryInstance)
);

const mockRegisterRepositoryInstance = {
  addSaleRegisterEntry: jest.fn(),
  updateSaleRegisterEntry: jest.fn(),
  validateSessionOwner: jest.fn(),
};
jest.mock('../../../src/repositories/register.repository', () =>
  jest.fn(() => mockRegisterRepositoryInstance)
);

const mockStockLogsRepositoryInstance = { createStockLog: jest.fn() };
jest.mock('../../../src/repositories/stock-log.repository', () =>
  jest.fn(() => mockStockLogsRepositoryInstance)
);

jest.mock('../../../src/repositories/branch.repository', () => ({
  findById: jest.fn(),
}));

jest.mock('../../../src/repositories/sale.repository', () => ({
  create: jest.fn(),
  getById: jest.fn(),
  save: jest.fn(),
  aggregate: jest.fn(),
  paginate: jest.fn(),
  getLegacyDetails: jest.fn(),
  deleteSales: jest.fn(),
  getLastSaleForBranch: jest.fn(),
  nextSalesNumberForBranch: jest.fn(),
  updateWalletAmount: jest.fn(),
}));

jest.mock('../../../src/models/base.model', () => ({
  getDb: jest.fn(),
  currentBranch: null,
  license: null,
  loggedUser: null,
}));

jest.mock('../../../src/models/sale.model', () => function FakeSale() {});

// ─── Requires ─────────────────────────────────────────────────────────────────

const salesRepository = require('../../../src/repositories/sale.repository');
const branchesRepository = require('../../../src/repositories/branch.repository');
const BaseModel = require('../../../src/models/base.model');
const salesService = require('../../../src/services/sale.service');
const { ERROR_MESSAGES } = require('../../../src/constants/sales.constants');
const { NotFoundError, BadRequestError } = require('../../../src/utils/appError');
const { PAYMENT_STATUS, SALE_STATUS } = require('../../../src/constants');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BRANCH_ID = '64f8f2f4c2b9c0a1e4b12345';
const LICENSE_ID = '64f8f2f4c2b9c0a1e4b67890';
const USER_ID = '64f8f2f4c2b9c0a1e4b99999';
const ITEM_ID = '64f8f2f4c2b9c0a1e4b11111';

const makeContext = (overrides = {}) => ({
  branchId: BRANCH_ID,
  licenseId: LICENSE_ID,
  userId: USER_ID,
  userName: 'tester',
  salesPrefix: 'INV',
  stockManagement: true,
  branchSettings: {},
  ...overrides,
});

const makeItemDoc = (overrides = {}) => ({
  _id: { toString: () => ITEM_ID },
  name: 'Test Item',
  itemid: 'SKU001',
  selling_price: 100,
  available_quantity: 50,
  track_inventory: true,
  negative_stock: false,
  tax: 0,
  discount_amount: 0,
  discount_percentage: 0,
  ...overrides,
});

const makeItemPayload = (overrides = {}) => ({
  item_id: ITEM_ID,
  item_quantity: '2',
  item_price_total: '100',
  ...overrides,
});

const makeSaleData = (overrides = {}) => ({
  sales_total: '200',
  payment_mode: 'Cash',
  customer_id: '64f8f2f4c2b9c0a1e4b22222',
  customer_name: 'John Doe',
  customer_phone: '9999999999',
  items: [makeItemPayload()],
  ...overrides,
});

// ─── Test Suites ──────────────────────────────────────────────────────────────

describe('SalesService', () => {
  let consoleErrorSpy;
  let consoleLogSpy;
  let consoleWarnSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    salesRepository.getLastSaleForBranch.mockResolvedValue(null);
    salesRepository.nextSalesNumberForBranch.mockResolvedValue(1);
    salesRepository.create.mockResolvedValue({ _id: 'newSaleId' });
    salesRepository.save.mockResolvedValue({ _id: 'savedId' });
    mockCustomerRepositoryInstance.findById.mockResolvedValue(null);
    mockItemRepositoryInstance.updateStock.mockResolvedValue({});
    mockItemRepositoryInstance.deductStockIfAvailable.mockImplementation(
      async (itemId, quantity) => ({
        _id: itemId,
        available_quantity: 50 - Number(quantity),
      })
    );
    mockStockLogsRepositoryInstance.createStockLog.mockResolvedValue({ status: true });
    mockRegisterRepositoryInstance.addSaleRegisterEntry.mockResolvedValue({});
    mockRegisterRepositoryInstance.validateSessionOwner.mockResolvedValue({ status: true });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  // ── processSale – validation ──────────────────────────────────────────────

  describe('processSale – validation', () => {
    test('returns PAY_TOTAL_INVALID when sales_total is negative', async () => {
      const result = await salesService.processSale(
        { sales_total: '-1' },
        '',
        'Add',
        makeContext()
      );
      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.PAY_TOTAL_INVALID);
      expect(result.data).toBeNull();
    });

    test('returns BRANCH_LICENSE_REQUIRED when branchId is null', async () => {
      const result = await salesService.processSale(
        makeSaleData(),
        '',
        'Add',
        makeContext({ branchId: null })
      );
      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.BRANCH_LICENSE_REQUIRED);
    });

    test('returns BRANCH_LICENSE_REQUIRED when licenseId is null', async () => {
      const result = await salesService.processSale(
        makeSaleData(),
        '',
        'Add',
        makeContext({ licenseId: null })
      );
      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.BRANCH_LICENSE_REQUIRED);
    });

    test('returns ITEM_REMOVED when item not found in DB', async () => {
      mockItemRepositoryInstance.findItemById.mockResolvedValue(null);

      const result = await salesService.processSale(makeSaleData(), '', 'Add', makeContext());
      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.ITEM_REMOVED);
    });

    test('returns INVALID_ITEM_ID when document._id does not match item_id', async () => {
      mockItemRepositoryInstance.findItemById.mockResolvedValue({
        ...makeItemDoc(),
        _id: { toString: () => 'differentId' },
      });

      const result = await salesService.processSale(makeSaleData(), '', 'Add', makeContext());
      expect(result.status).toBe(false);
      expect(result.message).toBe(ERROR_MESSAGES.INVALID_ITEM_ID);
    });

    test('returns insufficient items error when tracked item has insufficient stock', async () => {
      mockItemRepositoryInstance.findItemById.mockResolvedValue(
        makeItemDoc({ available_quantity: 1, track_inventory: true, negative_stock: false })
      );

      const data = makeSaleData({ items: [makeItemPayload({ item_quantity: '5' })] });
      const result = await salesService.processSale(data, '', 'Add', makeContext());

      expect(result.status).toBe(false);
      expect(result.message).toMatch(/quantity is mismatched/i);
      expect(Array.isArray(result.data)).toBe(true);
    });

    test('allows sale when item has negative_stock enabled', async () => {
      mockItemRepositoryInstance.findItemById.mockResolvedValue(
        makeItemDoc({ available_quantity: 0, track_inventory: true, negative_stock: true })
      );

      const result = await salesService.processSale(
        makeSaleData({ items: [makeItemPayload({ item_quantity: '5' })] }),
        '',
        'Add',
        makeContext()
      );
      expect(result.status).toBe(true);
    });
  });

  // ── processSale – Add mode (success) ─────────────────────────────────────

  describe('processSale – Add mode', () => {
    beforeEach(() => {
      mockItemRepositoryInstance.findItemById.mockResolvedValue(makeItemDoc());
    });

    test('returns status true and sale data on successful create', async () => {
      const result = await salesService.processSale(makeSaleData(), '', 'Add', makeContext());
      expect(result.status).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.message).toBe('Sale saved successfully');
    });

    test('calls salesRepository.create with merged insert+update data', async () => {
      await salesService.processSale(makeSaleData(), '', 'Add', makeContext());
      expect(salesRepository.create).toHaveBeenCalledTimes(1);
    });

    test('generates INV-prefixed sales_id for new sale', async () => {
      salesRepository.nextSalesNumberForBranch.mockResolvedValue(1);
      await salesService.processSale(makeSaleData(), '', 'Add', makeContext());
      expect(salesRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ sales_id: 'INV000001' })
      );
    });

    test('takes its number from the atomic branch counter', async () => {
      // The counter allocated 6, so the bill is INV000006 - the service does
      // not read previous sales at all; that read-then-add-one is what used
      // to mint duplicate bill numbers under concurrency and after merges.
      salesRepository.nextSalesNumberForBranch.mockResolvedValue(6);
      await salesService.processSale(makeSaleData(), '', 'Add', makeContext());
      expect(salesRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ sales_id: 'INV000006' })
      );
      expect(salesRepository.getLastSaleForBranch).not.toHaveBeenCalled();
    });

    test('payment_status is Paid when payment_mode provided', async () => {
      await salesService.processSale(
        makeSaleData({ payment_mode: 'Cash' }),
        '',
        'Add',
        makeContext()
      );
      expect(salesRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ payment_status: 'Paid' })
      );
    });

    test('payment_status is Unpaid when payment_mode is empty', async () => {
      await salesService.processSale(makeSaleData({ payment_mode: '' }), '', 'Add', makeContext());
      expect(salesRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ payment_status: 'Unpaid' })
      );
    });

    test('payment_status is Unpaid when unpaid flag is true', async () => {
      await salesService.processSale(makeSaleData({ unpaid: 'true' }), '', 'Add', makeContext());
      expect(salesRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ payment_status: 'Unpaid' })
      );
    });

    test('sets Partialy Paid status for partial_check=true with lower balance', async () => {
      const data = makeSaleData({
        payment_mode: 'Cash',
        partial_check: 'true',
        partial_balance: '50',
      });
      await salesService.processSale(data, '', 'Add', makeContext());
      expect(salesRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ payment_status: 'Partialy Paid' })
      );
    });

    test('atomically deducts stock for tracked items', async () => {
      await salesService.processSale(makeSaleData(), '', 'Add', makeContext());
      expect(mockItemRepositoryInstance.deductStockIfAvailable).toHaveBeenCalledWith(
        expect.anything(),
        2
      );
      expect(mockItemRepositoryInstance.updateStock).not.toHaveBeenCalledWith(
        expect.anything(),
        -2
      );
    });

    test('rejects a concurrent stock conflict before creating the sale', async () => {
      mockItemRepositoryInstance.deductStockIfAvailable.mockResolvedValue(null);
      mockItemRepositoryInstance.findItemById
        .mockResolvedValueOnce(makeItemDoc())
        .mockResolvedValueOnce(makeItemDoc())
        .mockResolvedValueOnce(makeItemDoc({ available_quantity: 1 }));

      const result = await salesService.processSale(makeSaleData(), '', 'Add', makeContext());

      expect(result.status).toBe(false);
      expect(result.message).toContain('another billing counter');
      expect(salesRepository.create).not.toHaveBeenCalled();
    });

    test('skips stock update for non-tracked items', async () => {
      mockItemRepositoryInstance.findItemById.mockResolvedValue(
        makeItemDoc({ track_inventory: false })
      );
      await salesService.processSale(makeSaleData(), '', 'Add', makeContext());
      expect(mockItemRepositoryInstance.updateStock).not.toHaveBeenCalled();
    });

    test('creates stock log when stockManagement is enabled', async () => {
      await salesService.processSale(
        makeSaleData(),
        '',
        'Add',
        makeContext({ stockManagement: true })
      );
      expect(mockStockLogsRepositoryInstance.createStockLog).toHaveBeenCalledWith(
        expect.objectContaining({ process: 'Add Sale', action: 'subtract' })
      );
    });

    test('skips stock log when stockManagement is disabled', async () => {
      await salesService.processSale(
        makeSaleData(),
        '',
        'Add',
        makeContext({ stockManagement: false })
      );
      expect(mockStockLogsRepositoryInstance.createStockLog).not.toHaveBeenCalled();
    });

    test('adds register entry when register_id provided', async () => {
      await salesService.processSale(
        makeSaleData({ register_id: 'reg001' }),
        '',
        'Add',
        makeContext()
      );
      expect(mockRegisterRepositoryInstance.addSaleRegisterEntry).toHaveBeenCalledWith(
        expect.objectContaining({ registerId: 'reg001' })
      );
    });

    test('skips register update when register_id not provided', async () => {
      await salesService.processSale(
        makeSaleData({ register_id: undefined }),
        '',
        'Add',
        makeContext()
      );
      expect(mockRegisterRepositoryInstance.addSaleRegisterEntry).not.toHaveBeenCalled();
    });

    test('sale_process forced to KOT for Table-Order sale_method', async () => {
      await salesService.processSale(
        makeSaleData({ sale_method: 'Table-Order' }),
        '',
        'Add',
        makeContext()
      );
      expect(salesRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ sale_process: 'KOT', payment_status: 'Unpaid' })
      );
    });

    test('response data contains sms/whatsapp/print/mail flags', async () => {
      const ctx = makeContext({
        branchSettings: {
          sales_sms: true,
          whatsapp_receipt: false,
          printall: true,
          sales_mail: false,
        },
      });
      const result = await salesService.processSale(makeSaleData(), '', 'Add', ctx);
      expect(result.data.sms).toBe(true);
      expect(result.data.whatsapp).toBe(false);
      expect(result.data.print).toBe(true);
    });

    test('applies extra_discount (flat) to reduce items total', async () => {
      const data = makeSaleData({ extra_discount: '10', extra_discount_type: 'flat' });
      await salesService.processSale(data, '', 'Add', makeContext());
      expect(salesRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ extra_discount: 10 })
      );
    });
  });

  // ── processSale – Edit mode ───────────────────────────────────────────────

  describe('processSale – Edit mode', () => {
    const SALE_ID = '64f8f2f4c2b9c0a1e4b55555';

    beforeEach(() => {
      mockItemRepositoryInstance.findItemById.mockResolvedValue(makeItemDoc());
    });

    test('returns status false when sale not found for edit', async () => {
      salesRepository.getById.mockResolvedValue(null);

      const result = await salesService.processSale(makeSaleData(), SALE_ID, 'Edit', makeContext());
      expect(result.status).toBe(false);
      expect(result.message).toBe('Sale not found for update');
    });

    test('calls salesRepository.save for edit mode', async () => {
      const fakeSaleDoc = {
        items: [
          {
            item_id: ITEM_ID,
            item_quantity: 1,
            item_name: 'Test',
            item_sku: 'SKU001',
            item_status: '',
            item_unit: 'qty',
            item_price: 100,
          },
        ],
        changes: [],
        set: jest.fn(),
        sales_id: 'INV000001',
      };
      salesRepository.getById
        .mockResolvedValueOnce(fakeSaleDoc) // first call: fetch existing
        .mockResolvedValueOnce(fakeSaleDoc); // second call: fetch for update

      const result = await salesService.processSale(makeSaleData(), SALE_ID, 'Edit', makeContext());
      expect(salesRepository.save).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(true);
    });

    test('updates register entry for edit mode', async () => {
      const fakeSaleDoc = { items: [], changes: [], set: jest.fn(), sales_id: 'INV000001' };
      salesRepository.getById.mockResolvedValue(fakeSaleDoc);

      await salesService.processSale(
        makeSaleData({ register_id: 'reg001' }),
        SALE_ID,
        'Edit',
        makeContext()
      );
      expect(mockRegisterRepositoryInstance.updateSaleRegisterEntry).toHaveBeenCalled();
    });
  });

  // ── processSale – transaction/partial payment ─────────────────────────────

  describe('processSale – partial payment transaction', () => {
    beforeEach(() => {
      mockItemRepositoryInstance.findItemById.mockResolvedValue(makeItemDoc());

      const mockCollection = {
        insertOne: jest.fn().mockResolvedValue({}),
        findOne: jest.fn().mockResolvedValue(null),
        updateOne: jest.fn().mockResolvedValue({}),
      };
      BaseModel.getDb.mockResolvedValue({ collection: jest.fn(() => mockCollection) });
    });

    test('inserts transaction record when partial_check is true (Add mode)', async () => {
      const data = makeSaleData({
        partial_check: 'true',
        partial_balance: '100',
        payment_mode: 'Cash',
      });
      const result = await salesService.processSale(data, '', 'Add', makeContext());
      expect(result.status).toBe(true);
      expect(BaseModel.getDb).toHaveBeenCalled();
    });

    test('uses wallet when wallet_check=true and balance covers full amount', async () => {
      const data = makeSaleData({
        partial_check: 'true',
        partial_balance: '200',
        payment_mode: 'Cash',
        wallet_check: 'true',
        customer_current_balance: '300',
      });
      const result = await salesService.processSale(data, '', 'Add', makeContext());
      expect(result.status).toBe(true);
      expect(salesRepository.updateWalletAmount).toHaveBeenCalled();
    });
  });

  // ── getSaleById ───────────────────────────────────────────────────────────

  describe('getSaleById', () => {
    test('returns null when id is falsy', async () => {
      const result = await salesService.getSaleById(null);
      expect(result).toBeNull();
      expect(salesRepository.getById).not.toHaveBeenCalled();
    });

    test('delegates to salesRepository.getById', async () => {
      const mockSale = { _id: 'sale1', sales_id: 'INV000001' };
      salesRepository.getById.mockResolvedValue(mockSale);

      const result = await salesService.getSaleById('sale1');
      expect(salesRepository.getById).toHaveBeenCalledWith('sale1', expect.any(Object));
      expect(result).toBe(mockSale);
    });
  });

  // ── updateSaleStatus ──────────────────────────────────────────────────────

  describe('updateSaleStatus', () => {
    test('throws NotFoundError when sale not found', async () => {
      salesRepository.getById.mockResolvedValue(null);
      await expect(salesService.updateSaleStatus({ id: 'x', status: 'completed' })).rejects.toThrow(
        NotFoundError
      );
    });

    test('throws BadRequestError when sale is already cancelled', async () => {
      salesRepository.getById.mockResolvedValue({ status: SALE_STATUS.CANCELLED });
      await expect(salesService.updateSaleStatus({ id: 'x', status: 'completed' })).rejects.toThrow(
        BadRequestError
      );
    });

    test('updates sale status and calls save', async () => {
      const mockSale = { status: SALE_STATUS.PENDING };
      salesRepository.getById.mockResolvedValue(mockSale);
      salesRepository.save.mockResolvedValue(mockSale);

      const result = await salesService.updateSaleStatus({
        id: 'sale1',
        status: SALE_STATUS.COMPLETED,
      });
      expect(mockSale.status).toBe(SALE_STATUS.COMPLETED);
      expect(salesRepository.save).toHaveBeenCalledWith(mockSale);
      expect(result).toBe(mockSale);
    });
  });

  // ── processSalePayment ────────────────────────────────────────────────────

  describe('processSalePayment', () => {
    test('throws NotFoundError when sale not found', async () => {
      salesRepository.getById.mockResolvedValue(null);
      await expect(
        salesService.processSalePayment({ id: 'x', amount: 100, method: 'Cash' })
      ).rejects.toThrow(NotFoundError);
    });

    test('throws BadRequestError when sale is already paid', async () => {
      salesRepository.getById.mockResolvedValue({ payment_status: PAYMENT_STATUS.PAID });
      await expect(
        salesService.processSalePayment({ id: 'x', amount: 50, method: 'Cash' })
      ).rejects.toThrow(BadRequestError);
    });

    test('appends payment and marks Paid when balance cleared', async () => {
      const mockSale = {
        payment_status: 'Partialy Paid',
        payments: [],
        paid_amount: 50,
        total: 100,
        balance: 50,
      };
      salesRepository.getById.mockResolvedValue(mockSale);
      salesRepository.save.mockResolvedValue(mockSale);

      const result = await salesService.processSalePayment({
        id: 'sale1',
        amount: 50,
        method: 'Cash',
      });

      expect(result.payments).toHaveLength(1);
      expect(result.paid_amount).toBe(100);
      expect(result.payment_status).toBe(PAYMENT_STATUS.PAID);
    });

    test('sets PARTIAL status when balance not fully cleared', async () => {
      const mockSale = {
        payment_status: 'Unpaid',
        payments: [],
        paid_amount: 0,
        total: 200,
        balance: 200,
      };
      salesRepository.getById.mockResolvedValue(mockSale);
      salesRepository.save.mockResolvedValue(mockSale);

      const result = await salesService.processSalePayment({
        id: 'sale1',
        amount: 50,
        method: 'Cash',
      });

      expect(result.payment_status).toBe(PAYMENT_STATUS.PARTIAL);
      expect(result.balance).toBe(150);
    });
  });

  // ── getSalesSummary ───────────────────────────────────────────────────────

  describe('getSalesSummary', () => {
    test('returns default summary when aggregate returns empty array', async () => {
      salesRepository.aggregate.mockResolvedValue([]);

      const result = await salesService.getSalesSummary({ branchId: BRANCH_ID });
      expect(result.totalSales).toBe(0);
      expect(result.totalAmount).toBe(0);
    });

    test('returns first aggregate result when present', async () => {
      const summary = { totalSales: 5, totalAmount: 1000, totalPaid: 800, totalBalance: 200 };
      salesRepository.aggregate.mockResolvedValue([summary]);

      const result = await salesService.getSalesSummary({ branchId: BRANCH_ID });
      expect(result).toBe(summary);
    });

    test('filters by startDate and endDate when provided', async () => {
      salesRepository.aggregate.mockResolvedValue([{ totalSales: 2 }]);

      await salesService.getSalesSummary({
        branchId: BRANCH_ID,
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      const pipeline = salesRepository.aggregate.mock.calls[0][0];
      const matchStage = pipeline.find((s) => s.$match);
      expect(matchStage.$match.createdAt).toBeDefined();
    });
  });

  // ── getSalesByProduct ─────────────────────────────────────────────────────

  describe('getSalesByProduct', () => {
    test('returns aggregation result from repository', async () => {
      const products = [{ _id: 'item1', quantitySold: 5, totalRevenue: 500 }];
      salesRepository.aggregate.mockResolvedValue(products);

      const result = await salesService.getSalesByProduct({ branchId: BRANCH_ID });
      expect(result).toBe(products);
    });
  });

  // ── getLatestSales ────────────────────────────────────────────────────────

  describe('getLatestSales', () => {
    test('returns empty array when repository returns empty array', async () => {
      salesRepository.aggregate.mockResolvedValue([]);
      const result = await salesService.getLatestSales({ branchId: BRANCH_ID });
      expect(result).toEqual([]);
    });

    test('maps sale documents to simplified LatestSale shape', async () => {
      salesRepository.aggregate.mockResolvedValue([
        {
          _id: { toString: () => 'saleId1' },
          sales_id: 'INV000001',
          customer_name: 'Alice',
          sale_process: 'Add',
          number_of_items: 3,
          sales_total: 300,
          payment_status: 'Paid',
        },
      ]);

      const result = await salesService.getLatestSales({ branchId: BRANCH_ID });
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        sales_document_id: 'saleId1',
        sales_id: 'INV000001',
        customer_name: 'Alice',
        number_of_items: 3,
        total_amount: 300,
        payment_status: 'Paid',
      });
    });

    test('falls back to items.length when number_of_items is not a number', async () => {
      salesRepository.aggregate.mockResolvedValue([
        {
          _id: { toString: () => 'saleId2' },
          sales_id: 'INV000002',
          items: [{ name: 'A' }, { name: 'B' }],
          sales_total: 100,
        },
      ]);

      const result = await salesService.getLatestSales({ branchId: BRANCH_ID });
      expect(result[0].number_of_items).toBe(2);
    });

    test('limits to licenseId filter when provided', async () => {
      salesRepository.aggregate.mockResolvedValue([]);
      await salesService.getLatestSales({ branchId: BRANCH_ID, licenseId: LICENSE_ID });

      const pipeline = salesRepository.aggregate.mock.calls[0][0];
      const matchStage = pipeline.find((s) => s.$match);
      expect(matchStage.$match.license).toBe(LICENSE_ID);
    });
  });

  // ── getTablesWithActiveOrders ─────────────────────────────────────────────

  describe('getTablesWithActiveOrders', () => {
    test('returns error when branchId is missing', async () => {
      const result = await salesService.getTablesWithActiveOrders(null);
      expect(result.status).toBe(false);
      expect(result.message).toBe('Branch ID is required');
    });

    test('returns error for invalid branchId format', async () => {
      const result = await salesService.getTablesWithActiveOrders('invalid-id');
      expect(result.status).toBe(false);
      expect(result.message).toBe('Invalid Branch ID format');
    });

    test('returns tables and takeaway flag from aggregate results', async () => {
      salesRepository.aggregate.mockResolvedValue([
        { dine_type: 'Dine-in', table_number: '3' },
        { dine_type: 'Dine-in', table_number: '1' },
        { dine_type: 'Take away', table_number: '' },
      ]);

      const result = await salesService.getTablesWithActiveOrders(BRANCH_ID);

      expect(result.status).toBe(true);
      expect(result.data.has_takeaway).toBe(true);
      expect(result.data.tables).toEqual(['1', '3']);
    });

    test('returns unique sorted tables', async () => {
      salesRepository.aggregate.mockResolvedValue([
        { dine_type: 'Dine-in', table_number: '10' },
        { dine_type: 'Dine-in', table_number: '10' },
        { dine_type: 'Dine-in', table_number: '2' },
      ]);

      const result = await salesService.getTablesWithActiveOrders(BRANCH_ID);
      expect(result.data.tables).toEqual(['2', '10']);
    });
  });

  // ── enrichSaleContext ─────────────────────────────────────────────────────

  describe('enrichSaleContext', () => {
    test('returns context unchanged when no branchId', async () => {
      const ctx = { licenseId: LICENSE_ID };
      const result = await salesService.enrichSaleContext(ctx);
      expect(result).toEqual(ctx);
      expect(branchesRepository.findById).not.toHaveBeenCalled();
    });

    test('returns context unchanged when branch not found', async () => {
      branchesRepository.findById.mockResolvedValue(null);
      const ctx = { branchId: BRANCH_ID };
      const result = await salesService.enrichSaleContext(ctx);
      expect(result.branchId).toBe(BRANCH_ID);
    });

    test('enriches context with branch settings when branch found', async () => {
      branchesRepository.findById.mockResolvedValue({
        roundOff: true,
        stock_management: true,
        sales_prefix: 'SDS',
        branch_name: 'Main Branch',
        store_state: 'Tamil Nadu',
        printing_address: '123 Street',
      });

      const result = await salesService.enrichSaleContext({ branchId: BRANCH_ID });
      expect(result.roundOff).toBe(true);
      expect(result.stockManagement).toBe(true);
      expect(result.salesPrefix).toBe('SDS');
      expect(result.branchName).toBe('Main Branch');
      expect(result.branchState).toBe('Tamil Nadu');
    });

    test('falls back to INV prefix when branch has no sales_prefix', async () => {
      branchesRepository.findById.mockResolvedValue({
        stock_management: false,
        branch_name: 'Branch',
      });

      const result = await salesService.enrichSaleContext({
        branchId: BRANCH_ID,
        salesPrefix: 'INV',
      });
      expect(result.salesPrefix).toBe('INV');
    });

    test('returns original context when branch lookup throws', async () => {
      branchesRepository.findById.mockRejectedValue(new Error('DB error'));
      const ctx = { branchId: BRANCH_ID, salesPrefix: 'INV' };
      const result = await salesService.enrichSaleContext(ctx);
      expect(result.salesPrefix).toBe('INV');
    });
  });

  // ── getBranchById ─────────────────────────────────────────────────────────

  describe('getBranchById', () => {
    test('returns null when id is falsy', async () => {
      const result = await salesService.getBranchById(null);
      expect(result).toBeNull();
      expect(branchesRepository.findById).not.toHaveBeenCalled();
    });

    test('delegates to branchesRepository.findById', async () => {
      const branch = { _id: BRANCH_ID, branch_name: 'Main' };
      branchesRepository.findById.mockResolvedValue(branch);

      const result = await salesService.getBranchById(BRANCH_ID);
      expect(branchesRepository.findById).toHaveBeenCalledWith(BRANCH_ID, { lean: true });
      expect(result).toBe(branch);
    });

    test('returns null and does not throw when lookup fails', async () => {
      branchesRepository.findById.mockRejectedValue(new Error('Connection refused'));
      const result = await salesService.getBranchById(BRANCH_ID);
      expect(result).toBeNull();
    });
  });

  // ── pass-through delegations ──────────────────────────────────────────────

  describe('createSale', () => {
    test('delegates to repository.create', async () => {
      const data = { total: 100 };
      const SaleModel = function FakeSale() {};
      const created = { _id: '1' };
      salesRepository.create.mockResolvedValue(created);

      const result = await salesService.createSale(data, { SaleModel });
      expect(salesRepository.create).toHaveBeenCalledWith(data, { SaleModel });
      expect(result).toBe(created);
    });
  });

  describe('listSales', () => {
    test('delegates to repository.paginate', async () => {
      const filter = {};
      const options = { page: 1, limit: 10 };
      const SaleModel = function FakeSale() {};
      const paginated = { results: [], total: 0 };
      salesRepository.paginate.mockResolvedValue(paginated);

      const result = await salesService.listSales(filter, options, { SaleModel });
      expect(salesRepository.paginate).toHaveBeenCalledWith(filter, options, { SaleModel });
      expect(result).toBe(paginated);
    });
  });

  describe('getLegacySaleDetails', () => {
    test('delegates to repository.getLegacyDetails', async () => {
      const id = 'sale-id';
      const SaleModel = function FakeSale() {};
      const details = { status: true, data: {} };
      salesRepository.getLegacyDetails.mockResolvedValue(details);

      const result = await salesService.getLegacySaleDetails(id, { SaleModel });
      expect(salesRepository.getLegacyDetails).toHaveBeenCalledWith(id, { SaleModel });
      expect(result).toBe(details);
    });
  });

  describe('deleteSales', () => {
    test('delegates to repository.deleteSales', async () => {
      const ids = ['id1', 'id2'];
      const SaleModel = function FakeSale() {};
      const del = { status: true, data: { deletedCount: 2 } };
      salesRepository.deleteSales.mockResolvedValue(del);

      const result = await salesService.deleteSales(ids, { SaleModel });
      expect(salesRepository.deleteSales).toHaveBeenCalledWith(ids, { SaleModel });
      expect(result).toBe(del);
    });
  });
});
