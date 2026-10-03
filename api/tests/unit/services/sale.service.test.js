jest.mock('../../../src/services/desktop-submission', () => ({
  prepare: jest.fn(async () => null),
  lookup: jest.fn(async () => null),
}));
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

// Billing outlets imports this repository even for ordinary counter sales.
// Keep it isolated from the BaseModel stub used by this service suite.
jest.mock('../../../src/repositories/settings.repository', () => jest.fn());

jest.mock('../../../src/repositories/sale.repository', () => ({
  create: jest.fn(),
  createSaleUnique: jest.fn(),
  buildSalesId: jest.fn(),
  buildDocNumber: jest.fn(),
  generateSalesIdForBranch: jest.fn(),
  deviceTag: jest.fn(),
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
const { KOT_EVENT } = require('../../../src/helpers/kot-notify');

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
  let kotNotifications;
  let onKotReady;

  beforeEach(() => {
    jest.clearAllMocks();
    kotNotifications = [];
    onKotReady = (event) => kotNotifications.push(event);
    process.on(KOT_EVENT, onKotReady);
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    salesRepository.getLastSaleForBranch.mockResolvedValue(null);
    salesRepository.nextSalesNumberForBranch.mockResolvedValue(1);
    salesRepository.create.mockResolvedValue({ _id: 'newSaleId' });
    // Each till stamps its own code into the bill number; here that code is
    // "TEST". createSaleUnique delegates to create so create-call assertions
    // still hold.
    salesRepository.deviceTag.mockResolvedValue('TEST');
    salesRepository.buildSalesId.mockImplementation(
      async (prefix, n) => `${prefix}-TEST-${String(n).padStart(6, '0')}`
    );
    // No branch/device codes in the unit context, so buildDocNumber returns the
    // till-tagged fallback - the same shape the assertions already expect.
    salesRepository.buildDocNumber.mockImplementation(
      async (type, branchId, n, opts) =>
        `${(opts && opts.fallbackPrefix) || 'INV'}-TEST-${String(n).padStart(6, '0')}`
    );
    /*
     * The service asks for the WHOLE number now, not for a count it then
     * formats itself. The counter and the format have to move together: they
     * are shared with the customer's own ordering page, and a shop numbering
     * by financial year would otherwise have had the year on one and not the
     * other while both drew on one counter. The number still comes from the
     * counter mock, so the assertions below still say what they said.
     */
    salesRepository.generateSalesIdForBranch.mockImplementation(async (branchId, opts) => {
      const n = await salesRepository.nextSalesNumberForBranch(branchId);
      return `${(opts && opts.fallbackPrefix) || 'INV'}-TEST-${String(n).padStart(6, '0')}`;
    });
    salesRepository.createSaleUnique.mockImplementation((data) => salesRepository.create(data));
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
    process.removeListener(KOT_EVENT, onKotReady);
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  describe('fixed-price admission', () => {
    test.each(['undefined', 'null', '', '  ', null, undefined])(
      'desktop missing inline override %j uses and validates the selling-price field',
      async (inline) => {
        mockItemRepositoryInstance.findItemById.mockResolvedValue(makeItemDoc());
        const result = await salesService.processSale(
          makeSaleData({ items: [makeItemPayload({ sale_inline_item_price: inline })] }),
          '',
          'Add',
          makeContext()
        );
        expect(result.status).toBe(true);
        expect(salesRepository.create.mock.calls[0][0]).toMatchObject({ sales_total: 200 });
        salesRepository.create.mockClear();
        const invalid = await salesService.processSale(
          makeSaleData({
            items: [makeItemPayload({ sale_inline_item_price: inline, item_price_total: '105' })],
          }),
          '',
          'Add',
          makeContext()
        );
        expect(invalid).toMatchObject({ status: false, data: { state: 'item_price_mismatch' } });
        expect(salesRepository.create).not.toHaveBeenCalled();
      }
    );
    test('the four-item inclusive retail checkout accepts the original legacy retry payload', async () => {
      const prices = [65, 85, 35, 38];
      prices.forEach((selling_price) =>
        mockItemRepositoryInstance.findItemById.mockResolvedValueOnce(
          makeItemDoc({ selling_price, tax: 0.25, tax_type: 'inclusive' })
        )
      );
      const result = await salesService.processSale(
        makeSaleData({
          sales_total: '223',
          multi_payment: { Cash: 223 },
          items: prices.map((price) =>
            makeItemPayload({
              item_quantity: '1',
              sale_inline_item_price: 'undefined',
              item_price_total: String(price),
            })
          ),
        }),
        '',
        'Add',
        makeContext()
      );
      expect(result.status).toBe(true);
      const saved = salesRepository.create.mock.calls[0][0];
      expect(saved.sales_total).toBe(223);
      expect(saved.total).toBe(saved.sales_total);
      expect(saved.subtotal).toBe(saved.sales_sub_total);
      expect(saved.items_total).toBe(saved.sales_total);
      expect(saved.items.map((line) => line.pricing.selling_price)).toEqual(prices);
    });
    test.each([
      [{ item_price_total: '47.25' }, 'item_price_mismatch'],
      [{ item_price_total: '45', tax: 18 }, 'item_tax_mismatch'],
      [{ item_price_total: '45', tax: 5, tax_type: 'inclusive' }, 'item_tax_mismatch'],
    ])('rejects a forged price or tax before sale and stock writes: %j', async (payload, state) => {
      mockItemRepositoryInstance.findItemById.mockResolvedValue(
        makeItemDoc({ selling_price: 45, tax: 5, tax_type: 'exclusive' })
      );
      const result = await salesService.processSale(
        makeSaleData({ items: [makeItemPayload(payload)] }),
        '',
        'Add',
        makeContext()
      );
      expect(result).toMatchObject({ status: false, data: { state } });
      expect(salesRepository.create).not.toHaveBeenCalled();
      expect(salesRepository.save).not.toHaveBeenCalled();
      expect(mockItemRepositoryInstance.deductStockIfAvailable).not.toHaveBeenCalled();
      expect(mockItemRepositoryInstance.updateStock).not.toHaveBeenCalled();
    });
  });

  describe('tax-inclusive full-payment integrity', () => {
    const taxableSale = (multi_payment, overrides = {}) =>
      makeSaleData({
        sales_total: '262.50',
        payment_mode: 'Upi',
        multi_payment,
        items: [makeItemPayload({ item_quantity: '1', item_price_total: '250', tax: 5 })],
        ...overrides,
      });
    beforeEach(() => {
      mockItemRepositoryInstance.findItemById.mockResolvedValue(
        makeItemDoc({ selling_price: 250, tax: 5, tax_type: 'exclusive' })
      );
    });
    test.each([250, 260, 262, 263])(
      'refuses %s against a 262.50 bill before any stock or sale write',
      async (amount) => {
        const result = await salesService.processSale(
          taxableSale({ Upi: amount }, { idempotencyKey: 'rejected-payment-request' }),
          '',
          'Add',
          makeContext()
        );
        expect(result.status).toBe(false);
        expect(result.message).toMatch(/Payment total.*262.50/);
        expect(result.data).toEqual({
          submission_outcome: 'not_saved',
          request_id: 'rejected-payment-request',
        });
        expect(salesRepository.create).not.toHaveBeenCalled();
        expect(mockItemRepositoryInstance.deductStockIfAvailable).not.toHaveBeenCalled();
        expect(mockRegisterRepositoryInstance.addSaleRegisterEntry).not.toHaveBeenCalled();
      }
    );
    test.each([{ Upi: 262.5 }, { Cash: 100, Upi: 162.5 }, [{ method: 'Upi', amount: 262.5 }]])(
      'accepts the exact full tender %j',
      async (payments) => {
        const result = await salesService.processSale(
          taxableSale(payments),
          '',
          'Add',
          makeContext()
        );
        expect(result.status).toBe(true);
        expect(salesRepository.create.mock.calls[0][0]).toMatchObject({
          sales_total: 262.5,
          payment_status: 'Paid',
          multi_payment: payments,
        });
      }
    );
    test('does not convert an explicit partial payment into a full payment', async () => {
      BaseModel.getDb.mockResolvedValue({
        collection: () => ({ insertOne: jest.fn().mockResolvedValue({}) }),
      });
      const result = await salesService.processSale(
        taxableSale({ Upi: 100 }, { partial_check: 'true', partial_balance: '100' }),
        '',
        'Add',
        makeContext()
      );
      expect(result.status).toBe(true);
      expect(salesRepository.create.mock.calls[0][0]).toMatchObject({
        payment_status: 'Partialy Paid',
        payment_pending: 162.5,
      });
    });
    test('a partial flag cannot hide an incorrect full tender', async () => {
      const result = await salesService.processSale(
        taxableSale({ Upi: 250 }, { partial_check: 'true', partial_balance: '262.50' }),
        '',
        'Add',
        makeContext()
      );
      expect(result.status).toBe(false);
      expect(salesRepository.create).not.toHaveBeenCalled();
    });
    test('rejects a mismatched settlement of an existing table without saving it', async () => {
      const doc = {
        _id: ITEM_ID,
        sale_method: 'Table-Order',
        sale_process: 'KOT',
        payment_status: 'Unpaid',
        items: [],
        set: jest.fn(),
      };
      salesRepository.getById.mockResolvedValue(doc);
      const result = await salesService.processSale(
        taxableSale({ Upi: 260 }),
        ITEM_ID,
        'Edit',
        makeContext()
      );
      expect(result.status).toBe(false);
      expect(result.message).toMatch(/Payment total/);
      expect(doc.set).not.toHaveBeenCalled();
      expect(salesRepository.save).not.toHaveBeenCalled();
      expect(mockItemRepositoryInstance.updateStock).not.toHaveBeenCalled();
    });
    test.each([{ Upi: -1, Cash: 263.5 }, { Upi: 'bad' }, [{ amount: null }]])(
      'rejects malformed full tender %j',
      async (payments) => {
        const result = await salesService.processSale(
          taxableSale(payments),
          '',
          'Add',
          makeContext()
        );
        expect(result.status).toBe(false);
        expect(salesRepository.create).not.toHaveBeenCalled();
      }
    );
    test('includes an add-to-bill tip in the expected tender', async () => {
      const result = await salesService.processSale(
        taxableSale({ Upi: 262.5 }, { tip_amount: 10, tip_in_total: true }),
        '',
        'Add',
        makeContext()
      );
      expect(result.status).toBe(false);
      expect(result.message).toMatch(/272.50/);
    });
    test('an unpaid order can carry a provisional payment method', async () => {
      const result = await salesService.processSale(
        taxableSale({ Upi: 250 }, { unpaid: 'true' }),
        '',
        'Add',
        makeContext()
      );
      expect(result.status).toBe(true);
      expect(salesRepository.create.mock.calls[0][0].payment_status).toBe('Unpaid');
    });
  });

  test('seating retry returns a saved sale before rechecking or deducting stock', async () => {
    mockItemRepositoryInstance.findItemById.mockResolvedValue(
      makeItemDoc({ available_quantity: 0 })
    );
    const lookup = jest
      .spyOn(require('../../../src/services/desktop-seating'), 'lookup')
      .mockResolvedValue({ _id: 'saved-seat-sale', sales_id: 'INV-SAVED' });
    try {
      const result = await salesService.processSale(
        makeSaleData({ table_number: 'T1', person_count: 2, idempotencyKey: 'desktop-retry' }),
        '',
        'KOT',
        makeContext({ seatingProtocol: true, branchSettings: { table_options: true } })
      );
      expect(result).toMatchObject({
        status: true,
        data: { _id: 'saved-seat-sale', duplicate: true, sale_number: 'INV-SAVED' },
      });
      expect(mockItemRepositoryInstance.deductStockIfAvailable).not.toHaveBeenCalled();
      expect(salesRepository.createSaleUnique).not.toHaveBeenCalled();
      expect(mockRegisterRepositoryInstance.addSaleRegisterEntry).not.toHaveBeenCalled();
    } finally {
      lookup.mockRestore();
    }
  });
  test('seating conflict restores reserved stock and prevents a desktop sale', async () => {
    mockItemRepositoryInstance.findItemById.mockResolvedValue(makeItemDoc());
    const adapter = require('../../../src/services/desktop-seating');
    const lookup = jest.spyOn(adapter, 'lookup').mockResolvedValue(null);
    const prepare = jest.spyOn(adapter, 'prepare').mockRejectedValue(new Error('Table changed'));
    try {
      const result = await salesService.processSale(
        makeSaleData({ table_number: 'T1', person_count: 2, idempotencyKey: 'desktop-new' }),
        '',
        'KOT',
        makeContext({ seatingProtocol: true, branchSettings: { table_options: true } })
      );
      expect(result).toMatchObject({ status: false, message: 'Table changed' });
      expect(mockItemRepositoryInstance.deductStockIfAvailable).toHaveBeenCalledTimes(1);
      expect(mockItemRepositoryInstance.updateStock).toHaveBeenCalledWith(expect.anything(), 2);
      expect(salesRepository.createSaleUnique).not.toHaveBeenCalled();
    } finally {
      lookup.mockRestore();
      prepare.mockRestore();
    }
  });

  test.each(['stock', 'approval'])(
    'failed %s validation leaves no bound desktop table',
    async (failure) => {
      mockItemRepositoryInstance.findItemById.mockResolvedValue(makeItemDoc());
      const adapter = require('../../../src/services/desktop-seating');
      const lookup = jest.spyOn(adapter, 'lookup').mockResolvedValue(null);
      const prepare = jest.spyOn(adapter, 'prepare');
      if (failure === 'stock')
        mockItemRepositoryInstance.deductStockIfAvailable.mockResolvedValue(null);
      try {
        const result = await salesService.processSale(
          makeSaleData({ table_number: 'T1', person_count: 2, idempotencyKey: 'desktop-rejected' }),
          '',
          'Add',
          makeContext({ seatingProtocol: true, branchSettings: { table_options: true } }),
          failure === 'approval'
            ? {
                beforeCommit: async () => {
                  throw new Error('Approval changed');
                },
              }
            : {}
        );
        expect(result.status).toBe(false);
        expect(prepare).not.toHaveBeenCalled();
        expect(salesRepository.createSaleUnique).not.toHaveBeenCalled();
        if (failure === 'approval')
          expect(mockItemRepositoryInstance.updateStock).toHaveBeenCalledWith(expect.anything(), 2);
      } finally {
        lookup.mockRestore();
        prepare.mockRestore();
      }
    }
  );

  test('a concurrent desktop seating retry restores its temporary stock reservation', async () => {
    mockItemRepositoryInstance.findItemById.mockResolvedValue(makeItemDoc());
    const adapter = require('../../../src/services/desktop-seating');
    const lookup = jest.spyOn(adapter, 'lookup').mockResolvedValue(null);
    const prepare = jest
      .spyOn(adapter, 'prepare')
      .mockImplementation(async (db, scope, input, document) => {
        document._id = 'same-sale';
        return { claim: { id: 'same-claim' }, existing: null };
      });
    BaseModel.getDb.mockResolvedValue({
      collection: () => ({ findOne: async () => ({ _id: 'same-sale', sales_id: 'INV-EXISTS' }) }),
    });
    salesRepository.createSaleUnique.mockRejectedValueOnce(
      Object.assign(new Error('duplicate'), { code: 11000 })
    );
    try {
      const result = await salesService.processSale(
        makeSaleData({ table_number: 'T1', person_count: 2, idempotencyKey: 'desktop-race' }),
        '',
        'KOT',
        makeContext({ seatingProtocol: true, branchSettings: { table_options: true } })
      );
      expect(result).toMatchObject({ status: true, data: { _id: 'same-sale', duplicate: true } });
      expect(mockItemRepositoryInstance.deductStockIfAvailable).toHaveBeenCalledTimes(1);
      expect(mockItemRepositoryInstance.updateStock).toHaveBeenCalledWith(expect.anything(), 2);
      expect(mockRegisterRepositoryInstance.addSaleRegisterEntry).not.toHaveBeenCalled();
      expect(mockStockLogsRepositoryInstance.createStockLog).not.toHaveBeenCalled();
    } finally {
      lookup.mockRestore();
      prepare.mockRestore();
      BaseModel.getDb.mockReset();
    }
  });

  test.each([
    { sale_inline_discount_value: 101 },
    { sale_inline_discount_pervalue: 101 },
    { sale_inline_discount_value: -1 },
  ])('invalid item discount fails before writes: %j', async (discount) => {
    mockItemRepositoryInstance.findItemById.mockResolvedValue(makeItemDoc());
    const result = await salesService.processSale(
      makeSaleData({ items: [makeItemPayload(discount)] }),
      '',
      'Add',
      makeContext()
    );
    expect(result.status).toBe(false);
    expect(salesRepository.create).not.toHaveBeenCalled();
    expect(mockItemRepositoryInstance.deductStockIfAvailable).not.toHaveBeenCalled();
  });
  test('retry fingerprints use the original request before charge normalization', async () => {
    mockItemRepositoryInstance.findItemById.mockResolvedValue(makeItemDoc());
    mockCustomerRepositoryInstance.findById.mockResolvedValue({ balance: 0 });
    const data = makeSaleData({
      idempotencyKey: 'charge-retry',
      charges: [{ name: 'Parcel', amount: '20', taxed: false }],
      sales_total: '220',
      multi_payment: { Cash: 220 },
    });
    const original = structuredClone(data);
    await salesService.processSale(data, '', 'Add', makeContext());
    const submission = require('../../../src/services/desktop-submission');
    expect(submission.lookup.mock.calls[0][3]).toEqual(original);
    expect(submission.prepare.mock.calls[0][3]).toEqual(original);
    expect(salesRepository.create.mock.calls[0][0].charges[0]).toMatchObject({
      amount: 20,
      tax_amount: 0,
      source: 'manual',
    });
  });
  describe('Additional charges in ordinary checkout', () => {
    test.each([
      [0, 'price', [{ name: 'Parcel', amount: 20, taxed: false }], 220],
      [10, 'price', [{ name: 'Parcel', amount: 20, taxed: false }], 210],
      [
        10,
        'percent',
        [
          { name: 'Parcel', amount: 20, taxed: false },
          { name: 'Delivery', amount: 10, taxed: false },
        ],
        210,
      ],
    ])(
      'discount %s %s and charges reach preview, tender and saved sale',
      async (extra, type, charges, total) => {
        mockItemRepositoryInstance.findItemById.mockResolvedValue(makeItemDoc());
        mockCustomerRepositoryInstance.findById.mockResolvedValue({ balance: 0 });
        const data = makeSaleData({
          extra_discount: extra,
          extra_discount_type: type,
          charges,
          sales_total: String(total),
          multi_payment: { Cash: 20, Card: total - 20 },
        });
        const preview = await salesService.previewSale(data, makeContext());
        expect(preview.status).toBe(true);
        expect(preview.data.header.salesTotalForDoc).toBe(total);
        await salesService.processSale(data, '', 'Add', makeContext());
        const written = salesRepository.create.mock.calls[0][0];
        expect(written.sales_total).toBe(total);
        expect(written.charges.map((c) => c.amount)).toEqual(charges.map((c) => c.amount));
      }
    );
  });

  describe('Business decision pricing preview', () => {
    test('a rejected pre-commit decision restores reserved stock and never writes the sale', async () => {
      mockItemRepositoryInstance.findItemById.mockResolvedValue(makeItemDoc());
      const beforeCommit = jest.fn(async () => {
        throw new Error('bill_changed');
      });
      const result = await salesService.processSale(makeSaleData(), '', 'Add', makeContext(), {
        beforeCommit,
      });
      expect(result.status).toBe(false);
      expect(beforeCommit).toHaveBeenCalledTimes(1);
      expect(mockItemRepositoryInstance.deductStockIfAvailable).toHaveBeenCalled();
      expect(mockItemRepositoryInstance.updateStock).toHaveBeenCalledWith(expect.anything(), 2);
      expect(salesRepository.create).not.toHaveBeenCalled();
      expect(kotNotifications).toHaveLength(0);
    });

    test('a bill-level decision binds the actual checkout preview and explains rounding in exact minor units', async () => {
      const { prepareDiscountIntent } = require('../../../src/services/business-discount-intent');
      mockItemRepositoryInstance.findItemById.mockResolvedValue(
        makeItemDoc({ selling_price: 100.27 })
      );
      const context = makeContext({
        roundOff: true,
        branchSettings: {
          _id: BRANCH_ID,
          branch_name: 'Central',
          currency: 'INR',
          time_zone: 'Asia/Kolkata',
        },
      });
      const data = makeSaleData({
        billing_transaction_id: 'billing-operation-001',
        items: [makeItemPayload({ item_price_total: '100.27' })],
        extra_discount: 10,
        extra_discount_type: 'percent',
        approval_token: 'old-local-proof',
      });
      const prepared = await prepareDiscountIntent(data, context, 'Regular customer');
      expect(prepared.summary).toEqual({
        currency: 'INR',
        currencyDigits: 2,
        beforeDiscountMinor: 20054,
        discountMinor: 2005,
        payableMinor: 18000,
        roundingMinor: -49,
        itemCount: 1,
        reason: 'Regular customer',
      });
      expect(
        (
          await prepareDiscountIntent(
            { ...data, approval_token: 'another-proof' },
            context,
            'Regular customer'
          )
        ).revisionHash
      ).toBe(prepared.revisionHash);
      expect(
        (
          await prepareDiscountIntent(
            { ...data, customer_id: 'different-customer' },
            context,
            'Regular customer'
          )
        ).revisionHash
      ).not.toBe(prepared.revisionHash);
      mockItemRepositoryInstance.findItemById.mockResolvedValue(
        makeItemDoc({ selling_price: 100.27, tax: 10, tax_type: 'exclusive' })
      );
      expect(
        (await prepareDiscountIntent(data, context, 'Regular customer')).revisionHash
      ).not.toBe(prepared.revisionHash);
      expect(salesRepository.create).not.toHaveBeenCalled();
      for (const change of [
        { coupon_code: 'WELCOME' },
        { tip_amount: 1 },
        { partial_check: 'true' },
        { unpaid: 'true' },
        { items: [makeItemPayload({ item_discount: 1 })] },
      ])
        await expect(
          prepareDiscountIntent({ ...data, ...change }, context, 'Reason')
        ).rejects.toMatchObject({ code: 'unsupported_discount_combination' });
      await expect(
        prepareDiscountIntent(
          data,
          { ...context, branchSettings: { ...context.branchSettings, currency: 'JPY' } },
          'Reason'
        )
      ).rejects.toMatchObject({ code: 'unsupported_discount_currency' });
    });

    test('uses checkout prices without allocating a bill, locking a register, writing stock or notifying the kitchen', async () => {
      mockItemRepositoryInstance.findItemById.mockResolvedValue(makeItemDoc());
      const data = makeSaleData({
        register_id: '64f8f2f4c2b9c0a1e4b33333',
        extra_discount: 10,
        extra_discount_type: 'percent',
      });
      const preview = await salesService.previewSale(data, makeContext());
      expect(preview.status).toBe(true);
      expect(preview.data.items).toHaveLength(1);
      expect(preview.data).not.toHaveProperty('customer_phone');
      expect(mockRegisterRepositoryInstance.validateSessionOwner).toHaveBeenCalledWith(
        data.register_id,
        makeContext().userId,
        makeContext().deviceId,
        { acquire: false }
      );
      expect(salesRepository.generateSalesIdForBranch).not.toHaveBeenCalled();
      expect(salesRepository.create).not.toHaveBeenCalled();
      expect(salesRepository.save).not.toHaveBeenCalled();
      expect(mockItemRepositoryInstance.deductStockIfAvailable).not.toHaveBeenCalled();
      expect(mockRegisterRepositoryInstance.addSaleRegisterEntry).not.toHaveBeenCalled();
      expect(kotNotifications).toHaveLength(0);
      await salesService.processSale(data, '', 'Add', makeContext());
      const written = salesRepository.create.mock.calls[0][0];
      expect(written.sales_total).toBe(preview.data.header.salesTotalForDoc);
      expect(written.sale_extra_discount).toBe(preview.data.header.salesExtraDiscount);
      expect(written.tax).toBe(preview.data.tax);
    });
    test('rejects an unbounded preview before item queries', async () => {
      const result = await salesService.previewSale(
        makeSaleData({ items: Array.from({ length: 101 }, () => makeItemPayload()) }),
        makeContext()
      );
      expect(result.status).toBe(false);
      expect(mockItemRepositoryInstance.findItemById).not.toHaveBeenCalled();
    });
  });

  describe('desktop KOT printing starts when the order is saved', () => {
    beforeEach(() => {
      mockItemRepositoryInstance.findItemById.mockResolvedValue(makeItemDoc());
    });

    test.each([{ sale_method: 'Table-Order' }, { sale_process: 'KOT' }])(
      'notifies the kitchen once after committing %j',
      async (options) => {
        let commit;
        let started;
        const saving = new Promise((resolve) => {
          commit = resolve;
        });
        const saveStarted = new Promise((resolve) => {
          started = resolve;
        });
        salesRepository.create.mockImplementationOnce(() => {
          started();
          return saving;
        });

        const pending = salesService.processSale(makeSaleData(options), '', 'Add', makeContext());
        await saveStarted;
        expect(kotNotifications).toEqual([]);
        commit({ _id: 'savedKotId' });
        const result = await pending;

        expect(result.status).toBe(true);
        expect(kotNotifications).toEqual([
          { branchId: BRANCH_ID, saleId: 'savedKotId', reason: 'created', at: expect.any(Number) },
        ]);
      }
    );

    test('a rejected order write does not wake the printer', async () => {
      salesRepository.create.mockRejectedValueOnce(new Error('write failed'));
      const result = await salesService.processSale(
        makeSaleData({ sale_method: 'Table-Order' }),
        '',
        'Add',
        makeContext()
      );
      expect(result.status).toBe(false);
      expect(kotNotifications).toEqual([]);
    });

    test.each([
      ['Add', {}],
      ['Hold', {}],
      ['Hold', { sale_method: 'Table-Order' }],
    ])('does not notify for %s without a submitted kitchen order (%j)', async (mode, options) => {
      const result = await salesService.processSale(makeSaleData(options), '', mode, makeContext());
      expect(result.status).toBe(true);
      expect(kotNotifications).toEqual([]);
    });

    test('changes saved through the till wake the same kitchen queue', async () => {
      const saleId = '64f8f2f4c2b9c0a1e4b55555';
      salesRepository.getById.mockResolvedValue({
        items: [],
        changes: [],
        set: jest.fn(),
        sales_id: 'INV000001',
        sale_method: 'Table-Order',
        sale_process: 'KOT',
        payment_status: 'Unpaid',
      });
      const result = await salesService.processSale(
        makeSaleData({ sale_method: 'Table-Order', payment_mode: '', payment_status: 'Unpaid' }),
        saleId,
        'Edit',
        makeContext()
      );
      expect(result.status).toBe(true);
      expect(kotNotifications).toEqual([
        { branchId: BRANCH_ID, saleId, reason: 'updated', at: expect.any(Number) },
      ]);
    });
  });

  describe('Business billed-sales reconciliation uses the actual sale writer', () => {
    test.each([
      {
        name: 'coupon, loyalty and extra discount',
        data: { extra_discount: '10', coupon_discount_value: '15', loyalty_redeem_value: '5' },
        expected: 17000,
      },
      {
        name: 'part-paid bill',
        data: { partial_check: 'true', partial_balance: '50' },
        expected: 20000,
      },
      {
        name: 'tip stays outside sales',
        data: { tip_amount: '30', tip_in_total: 'true' },
        expected: 20000,
      },
      {
        name: 'exclusive tax is included once',
        item: { tax: 18, tax_type: 'exclusive' },
        expected: 23600,
      },
      {
        name: 'bill rounding is already applied',
        item: { selling_price: 100.24 },
        data: { items: [makeItemPayload({ item_price_total: '100.24' })] },
        context: { roundOff: true },
        expected: 20000,
      },
    ])('$name', async ({ data, item, context, expected }) => {
      mockItemRepositoryInstance.findItemById.mockResolvedValue(makeItemDoc(item));
      await salesService.processSale(
        makeSaleData({ ...data, date: '2026-09-28T01:00:00.000Z' }),
        '',
        'Add',
        makeContext(context)
      );
      const written = salesRepository.create.mock.calls[0][0];
      const { saleContribution } = require('../../../src/services/business-metrics');
      const result = saleContribution(
        { ...written, _id: 'c'.repeat(24) },
        {
          id: BRANCH_ID,
          license: LICENSE_ID,
          currency: 'INR',
          currencyDigits: 2,
          timezone: 'Asia/Kolkata',
        }
      );
      expect(result.entries).toEqual([
        {
          businessDate: '2026-09-28',
          billedSalesMinor: expected,
          refundsMinor: 0,
          completedSales: 1,
        },
      ]);
    });
  });

  // ── processSale – validation ──────────────────────────────────────────────

  test('a recovered desktop submission returns its sale before stock is deducted again', async () => {
    mockItemRepositoryInstance.findItemById.mockResolvedValue(makeItemDoc());
    require('../../../src/services/desktop-submission').lookup.mockResolvedValueOnce({
      _id: 'saved-sale',
      sales_id: 'INV-SAVED',
    });
    const result = await salesService.processSale(
      makeSaleData({ idempotencyKey: 'saved-request' }),
      '',
      'Add',
      makeContext()
    );
    expect(result.status).toBe(true);
    expect(result.data._id).toBe('saved-sale');
    expect(result.data.duplicate).toBe(true);
    expect(mockItemRepositoryInstance.deductStockIfAvailable).not.toHaveBeenCalled();
    expect(salesRepository.createSaleUnique).not.toHaveBeenCalled();
  });

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

    test('outlet checkout persists prices, service charge, tax and actual payable together', async () => {
      const outlet = {
        id: '000000000000000000000003',
        name: 'Bar',
        markup_percent: 25,
        service_percent: 10,
        service_tax_percent: 5,
        prices: [],
      };
      const spy = jest
        .spyOn(require('../../../src/services/billing-outlets'), 'resolve')
        .mockResolvedValue(outlet);
      try {
        const result = await salesService.processSale(
          makeSaleData({
            outlet_id: outlet.id,
            items: [makeItemPayload({ item_price_total: '125' })],
          }),
          '',
          'Add',
          makeContext()
        );
        expect(result.status).toBe(true);
        expect(salesRepository.create).toHaveBeenCalledWith(
          expect.objectContaining({
            outlet_id: outlet.id,
            sales_total: 276.25,
            items_total: 276.25,
            partial_balance: 276.25,
            charges: [expect.objectContaining({ source: 'outlet', amount: 25, tax_amount: 1.25 })],
            items: [expect.objectContaining({ item_price: 125, item_quantity: 2 })],
          })
        );
      } finally {
        spy.mockRestore();
      }
    });

    test('a denied outlet cannot create a bill, allocate stock or submit a kitchen print', async () => {
      const spy = jest
        .spyOn(require('../../../src/services/billing-outlets'), 'resolve')
        .mockRejectedValue(new Error('Outlet access denied'));
      try {
        const result = await salesService.processSale(makeSaleData(), '', 'Add', makeContext());
        expect(result).toMatchObject({ status: false, message: 'Outlet access denied' });
        expect(salesRepository.create).not.toHaveBeenCalled();
        expect(mockItemRepositoryInstance.deductStockIfAvailable).not.toHaveBeenCalled();
        expect(kotNotifications).toHaveLength(0);
      } finally {
        spy.mockRestore();
      }
    });

    test('a mismatch with the displayed outlet total stops before saving or deducting stock', async () => {
      const spy = jest
        .spyOn(require('../../../src/services/billing-outlets'), 'resolve')
        .mockResolvedValue({
          id: '000000000000000000000003',
          name: 'Bar',
          markup_percent: 25,
          service_percent: 10,
          service_tax_percent: 0,
        });
      try {
        const result = await salesService.processSale(
          makeSaleData({
            outlet_expected_total: 200,
            items: [makeItemPayload({ item_price_total: '125' })],
          }),
          '',
          'Add',
          makeContext()
        );
        expect(result.status).toBe(false);
        expect(result.message).toMatch(/differs from the displayed bill/);
        expect(salesRepository.create).not.toHaveBeenCalled();
        expect(mockItemRepositoryInstance.deductStockIfAvailable).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
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

    test('a taxed charge keeps its tax figures; an untaxed one is scrubbed', async () => {
      // Tax on a charge (queue #5): tax_name/tax_amount persist ONLY while
      // taxed is true - a flag flipped off can never leave a stale figure.
      const data = makeSaleData({
        charges: [
          { name: 'Parcel', amount: '50', taxed: 'true', tax_name: 'GST 9%', tax_amount: '4.5' },
          { name: 'Service', amount: '20', taxed: false, tax_name: 'GST 9%', tax_amount: '1.8' },
        ],
      });
      BaseModel.getDb.mockResolvedValue({
        collection: () => ({ findOne: async () => ({ rate: 9, name: 'GST 9%' }) }),
      });
      await salesService.processSale(
        data,
        '',
        'Add',
        makeContext({ branchSettings: { default_tax: ITEM_ID } })
      );
      expect(salesRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          charges: [
            {
              name: 'Parcel',
              amount: 50,
              taxed: true,
              tax_name: 'GST 9%',
              tax_amount: 4.5,
              source: 'manual',
            },
            {
              name: 'Service',
              amount: 20,
              taxed: false,
              tax_name: '',
              tax_amount: 0,
              source: 'manual',
            },
          ],
        })
      );
    });

    test('generates a till-tagged INV sales_id for new sale', async () => {
      salesRepository.nextSalesNumberForBranch.mockResolvedValue(1);
      await salesService.processSale(makeSaleData(), '', 'Add', makeContext());
      // The bill number now carries this till's code so two tills in one branch
      // can never mint the same one. Format: <prefix>-<tag>-<number>.
      expect(salesRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ sales_id: 'INV-TEST-000001' })
      );
    });

    test('takes its number from the atomic branch counter', async () => {
      // The counter allocated 6, so the bill is INV-TEST-000006 - the service
      // does not read previous sales at all; that read-then-add-one is what
      // used to mint duplicate bill numbers under concurrency and after merges.
      salesRepository.nextSalesNumberForBranch.mockResolvedValue(6);
      await salesService.processSale(makeSaleData(), '', 'Add', makeContext());
      expect(salesRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ sales_id: 'INV-TEST-000006' })
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

    describe('a payment changed while the edit was repriced', () => {
      let server, connection, Model;
      beforeAll(async () => {
        const { MongoMemoryServer } = require('mongodb-memory-server');
        const mongoose = require('mongoose');
        server = await MongoMemoryServer.create();
        connection = await mongoose
          .createConnection(server.getUri('desktop-edit-fence'))
          .asPromise();
        Model = connection.model(
          'EditFenceSale',
          new mongoose.Schema(
            {
              partial_balance: { type: Number, default: 0 },
            },
            { strict: false }
          ),
          'sales'
        );
      }, 60000);
      afterAll(async () => {
        await connection?.close();
        await server?.stop();
      });

      test.each(['KOT', 'Hold'])(
        'two full desktop %s edits compete for capacity without losing either order',
        async (initialProcess) => {
          await connection.db.dropDatabase();
          const { ObjectId } = require('mongodb');
          const branchId = new ObjectId(BRANCH_ID),
            license = new ObjectId(LICENSE_ID);
          await connection.db
            .collection('branches')
            .insertOne({ _id: branchId, license, table_options: true, table_order_limit: 0 });
          await connection.db.collection('tableorder').insertOne({
            _id: new ObjectId(),
            branch_id: branchId,
            license,
            tableorder_value: 'T1',
            capacity: 3,
            max_capacity: 3,
          });
          const ids = [SALE_ID, '64f8f2f4c2b9c0a1e4b55556'];
          for (const id of ids)
            await Model.create({
              _id: id,
              branch_id: branchId,
              license,
              sales_id: 'INV-' + id,
              payment_status: 'Unpaid',
              payment_pending: 100,
              sale_process: initialProcess,
              table_number: 'T1',
              person_count: initialProcess === 'Hold' ? 2 : 1,
              dine_type: 'Dine-in',
              items: [],
              changes: [],
            });
          BaseModel.getDb.mockResolvedValue(connection.db);
          salesRepository.getById.mockImplementation((id) => Model.findById(id));
          salesRepository.save.mockImplementation((doc) => doc.save());
          const results = await Promise.all(
            ids.map((id) =>
              salesService.processSale(
                makeSaleData({
                  person_count: 2,
                  table_number: 'T1',
                  dine_type: 'Dine-in',
                  sale_process: 'KOT',
                  partial_balance: 0,
                  payment_mode: '',
                }),
                id,
                'Edit',
                makeContext({ branchSettings: { table_options: true } })
              )
            )
          );
          expect(results.filter((result) => result.status)).toHaveLength(1);
          const rows = await Model.collection.find({}).toArray();
          expect(rows).toHaveLength(2);
          expect(
            rows
              .filter((row) => row.sale_process === 'KOT')
              .reduce((sum, row) => sum + row.person_count, 0)
          ).toBe(initialProcess === 'Hold' ? 2 : 3);
          const claims = await connection.db.collection('table_seating').findOne({});
          expect(claims.claims.filter((row) => row.kind === 'legacy-edit')).toEqual([]);
        }
      );

      test.each([false, true])(
        'Captain raw order state survives hydration; concurrent cancellation=%s',
        async (cancel) => {
          const mongoose = require('mongoose');
          const RawState =
            connection.models.RawState ||
            connection.model(
              'RawState',
              new mongoose.Schema({
                payment_status: String,
                sale_process: String,
                partial_balance: { type: Number, default: 0 },
              }),
              'raw_state_sales'
            );
          await RawState.collection.deleteMany({});
          await RawState.collection.insertOne({
            _id: new mongoose.Types.ObjectId(SALE_ID),
            payment_status: 'Unpaid',
            sale_process: 'KOT',
            order_state: 'accepted',
            items: [],
            changes: [],
          });
          const original = await RawState.findById(SALE_ID);
          expect(original.order_state).toBeUndefined();
          expect(original.get('order_state')).toBe('accepted');
          salesRepository.getById
            .mockResolvedValueOnce(original)
            .mockImplementationOnce(() => RawState.findById(SALE_ID));
          salesRepository.save.mockImplementation(async (doc) => {
            if (cancel)
              await RawState.collection.updateOne(
                { _id: original._id },
                { $set: { order_state: 'cancelled' } }
              );
            return doc.save();
          });
          const result = await salesService.processSale(
            makeSaleData(),
            SALE_ID,
            'Edit',
            makeContext()
          );
          expect(result.status).toBe(!cancel);
          const stored = await RawState.collection.findOne({ _id: original._id });
          expect(stored.order_state).toBe(cancel ? 'cancelled' : 'accepted');
        }
      );

      test('legacy missing payment fields remain editable after Mongoose supplies defaults', async () => {
        await Model.deleteMany({});
        const { ObjectId } = require('mongodb');
        await Model.collection.insertOne({
          _id: new ObjectId(SALE_ID),
          branch_id: BRANCH_ID,
          license: LICENSE_ID,
          sales_id: 'INV-LEGACY',
          payment_status: 'Unpaid',
          payment_pending: 100,
          sale_process: 'KOT',
          items: [],
          changes: [],
        });
        const original = await Model.findById(SALE_ID);
        expect(original.partial_balance).toBe(0);
        expect(original.$isDefault('partial_balance')).toBe(true);
        salesRepository.getById
          .mockResolvedValueOnce(original)
          .mockImplementationOnce(() => Model.findById(SALE_ID));
        salesRepository.save.mockImplementation((doc) => doc.save());
        const result = await salesService.processSale(
          makeSaleData(),
          SALE_ID,
          'Edit',
          makeContext()
        );
        expect(result.status).toBe(true);
        expect(salesRepository.save).toHaveBeenCalledTimes(1);
      });

      test.each(
        [
          ['payment_status', 'Paid'],
          ['paid_amount', 50],
          ['partial_balance', 50],
          ['partial_amounts', 50],
          ['payment_pending', 0],
          ['sale_process', 'Add'],
          ['floor_closed_at', new Date('2026-10-01T06:00:00Z')],
          ['order_state', 'cancelled'],
        ].flatMap(([field, value]) => ['reload', 'save'].map((stage) => [stage, field, value]))
      )('does not overwrite newer state at %s: %s or move stock', async (stage, field, value) => {
        await Model.deleteMany({});
        const original = await Model.create({
          _id: SALE_ID,
          branch_id: BRANCH_ID,
          license: LICENSE_ID,
          sales_id: 'INV-FENCE',
          payment_status: 'Unpaid',
          payment_pending: 100,
          sale_process: 'KOT',
          items: [],
          changes: [],
        });
        salesRepository.getById.mockResolvedValueOnce(original).mockImplementationOnce(async () => {
          if (stage === 'reload')
            await Model.collection.updateOne({ _id: original._id }, { $set: { [field]: value } });
          return Model.findById(original._id);
        });
        salesRepository.save.mockImplementation(async (doc) => {
          if (stage === 'save')
            await Model.collection.updateOne({ _id: original._id }, { $set: { [field]: value } });
          return doc.save();
        });
        const result = await salesService.processSale(
          makeSaleData(),
          SALE_ID,
          'Edit',
          makeContext()
        );
        expect(result.status).toBe(false);
        expect(salesRepository.save).toHaveBeenCalledTimes(1);
        expect(await Model.collection.findOne({ _id: original._id })).toEqual({
          ...original.toObject(),
          [field]: value,
        });
        expect(mockItemRepositoryInstance.updateStock).not.toHaveBeenCalled();
        expect(mockStockLogsRepositoryInstance.createStockLog).not.toHaveBeenCalled();
        expect(mockRegisterRepositoryInstance.updateSaleRegisterEntry).not.toHaveBeenCalled();
      });
    });

    beforeEach(() => {
      mockItemRepositoryInstance.findItemById.mockResolvedValue(makeItemDoc());
    });

    test('returns status false when sale not found for edit', async () => {
      salesRepository.getById.mockResolvedValue(null);

      const result = await salesService.processSale(makeSaleData(), SALE_ID, 'Edit', makeContext());
      expect(result.status).toBe(false);
      expect(result.message).toBe('Sale not found for update');
    });

    test('desktop payment preserves served quantities stored outside the Mongoose schema', async () => {
      const mongoose = require('mongoose');
      const Model =
        mongoose.models.TakeawayPaymentSnapshot ||
        mongoose.model(
          'TakeawayPaymentSnapshot',
          new mongoose.Schema(
            {
              items: Array,
              changes: Array,
              kitchen_required: Boolean,
              floor_lifecycle: Boolean,
              payment_status: String,
              sale_process: String,
              sales_id: String,
              dine_type: String,
            },
            { strict: true }
          )
        );
      const doc = Model.hydrate({
        _id: SALE_ID,
        sales_id: 'TA-PAID',
        sale_process: 'KOT',
        payment_status: 'Unpaid',
        dine_type: 'Take away',
        kitchen_required: true,
        floor_lifecycle: true,
        items: [{ item_id: ITEM_ID, item_quantity: 2, item_price: 100 }],
        changes: [{ items: [{ item_id: ITEM_ID, item_quantity: 2, process: 'add' }] }],
        kitchen_service: { c0i0: { quantity: 2, by: 'staff' } },
      });
      expect(doc.kitchen_service).toBeUndefined();
      expect(doc.toObject().kitchen_service.c0i0.quantity).toBe(2);
      const set = jest.spyOn(doc, 'set');
      salesRepository.getById.mockResolvedValue(doc);
      const result = await salesService.processSale(
        makeSaleData({ dine_type: 'Take away' }),
        SALE_ID,
        'Edit',
        makeContext()
      );
      expect(result.status).toBe(true);
      expect(set.mock.calls[0][0].kitchen_closed).toBe(true);
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

    test('desktop Modify retains a Captain line and its agreed price after catalogue changes', async () => {
      const pricing = require('../../../src/services/pricing-authority');
      const doc = {
        items: [
          {
            item_id: ITEM_ID,
            line_id: 'phone-line-1',
            item_quantity: 1,
            item_price: 100,
            held: true,
            seat: 2,
            course: 'Main',
            allergies: ['milk'],
            pricing: pricing.resolve({ product: makeItemDoc(), submitted: 100 }),
          },
        ],
        changes: [],
        set: jest.fn(),
        sales_id: 'INV-EDIT',
      };
      salesRepository.getById.mockResolvedValue(doc);
      mockItemRepositoryInstance.findItemById.mockResolvedValue(
        makeItemDoc({ selling_price: 150 })
      );
      const result = await salesService.processSale(makeSaleData(), SALE_ID, 'Edit', makeContext());
      expect(result.status).toBe(true);
      const saved = doc.set.mock.calls[0][0];
      expect(saved.items[0]).toMatchObject({
        line_id: 'phone-line-1',
        held: true,
        seat: 2,
        course: 'Main',
        allergies: ['milk'],
        pricing: { selling_price: 100 },
      });
    });

    test('desktop edit cannot bypass the seating move protocol', async () => {
      const doc = {
        _id: SALE_ID,
        items: [],
        changes: [],
        set: jest.fn(),
        sales_id: 'INV1',
        seating_request_id: 'claim-1',
        table_number: 'T1',
        person_count: 2,
        dine_type: 'Dine-in',
      };
      salesRepository.getById.mockResolvedValue(doc);
      BaseModel.getDb.mockResolvedValue({
        collection: () => ({
          findOne: async () => ({
            claims: [
              {
                id: 'claim-1',
                order_id: SALE_ID,
                state: 'submitting',
                tables: ['t1'],
                labels: ['T1'],
              },
            ],
          }),
        }),
      });
      const result = await salesService.processSale(
        makeSaleData({ table_number: 'T2' }),
        SALE_ID,
        'Edit',
        makeContext()
      );
      expect(result.status).toBe(false);
      expect(result.message).toContain('Change the seating group');
      expect(doc.set).not.toHaveBeenCalled();
      expect(salesRepository.save).not.toHaveBeenCalled();
    });
    test('ordinary desktop item edits retain an atomic seating identity condition', async () => {
      const at = new Date('2026-09-30T10:00:00Z');
      const doc = {
        _id: SALE_ID,
        items: [],
        changes: [],
        set: jest.fn(),
        sales_id: 'INV1',
        updated_date: at,
        seating_request_id: 'claim-1',
        table_number: 'T1',
        person_count: 2,
        dine_type: 'Dine-in',
      };
      salesRepository.getById.mockResolvedValue(doc);
      BaseModel.getDb.mockResolvedValue({
        collection: () => ({
          findOne: async () => ({
            claims: [
              {
                id: 'claim-1',
                order_id: SALE_ID,
                state: 'submitting',
                tables: ['t1'],
                labels: ['T1'],
              },
            ],
          }),
        }),
      });
      const result = await salesService.processSale(makeSaleData(), SALE_ID, 'Edit', makeContext());
      expect(result.status).toBe(true);
      expect(doc.$where).toMatchObject({ seating_request_id: 'claim-1', updated_date: at });
      expect(salesRepository.save).toHaveBeenCalledWith(doc);
    });

    test('settling an open table records the payment instead of erasing it', async () => {
      /*
       * Owner, twice: "when payment done table not cleared from active order
       * ( KOT page )" and "after taking payment its not going rom screen."
       *
       * It was never the screen. getTablesWithActiveOrders asks for
       * sale_process 'KOT' AND payment_status 'Unpaid', so a table leaves the
       * floor by being PAID. The Table-Order override in processSale ran on
       * every write, including the one the till sends to settle the bill, and
       * put the sale back to Unpaid with paid_amount 0 and the whole total
       * outstanding. The table could never clear, and the payment was thrown
       * away on the way in - which is the worse half.
       *
       * The override still has to exist: a captain order arrives with
       * `payment_status: "cash"` and a QR order with "Upi", both METHODS, and
       * reading those as a status let a bill close before anybody paid. The
       * Add-mode test pins that a NEW table order is Unpaid whatever method
       * is on it. The line is drawn at an EXISTING order being given a status
       * this service derived from a real payment.
       */
      const openOnTheFloor = {
        items: [],
        changes: [],
        set: jest.fn(),
        sales_id: 'SB1D2-000032',
        sale_method: 'Table-Order',
        sale_process: 'KOT',
        payment_status: 'Unpaid',
        table_number: 'T2',
      };
      salesRepository.getById.mockResolvedValue(openOnTheFloor);

      await salesService.processSale(
        makeSaleData({ sale_method: 'Table-Order', payment_status: 'Paid' }),
        SALE_ID,
        'Edit',
        makeContext()
      );

      expect(openOnTheFloor.set).toHaveBeenCalled();
      const saved = Object.assign({}, ...openOnTheFloor.set.mock.calls.map((c) => c[0] || {}));
      expect(saved.payment_status).toBe('Paid');
      /* Nothing outstanding. Before the fix this was the whole bill again,
         because the override rewrote it from the total every time. */
      expect(Number(saved.payment_pending)).toBe(0);
      /* Still a table order in history; the STATUS is what clears the floor. */
      expect(saved.sale_process).toBe('KOT');
      expect(saved.floor_lifecycle).toBe(true);
      expect(kotNotifications).toEqual([]);
    });

    test.each(['Cash', 'Upi', 'Card', 'Cash,Upi'])(
      'desktop settles a synchronized order without local seating claims using %s',
      async (payment_mode) => {
        const doc = {
          _id: SALE_ID,
          items: [],
          changes: [],
          set: jest.fn(),
          sales_id: 'SYNC-1',
          sale_method: 'Table-Order',
          sale_process: 'KOT',
          payment_status: 'Unpaid',
          seating_request_id: 'remote-claim',
          table_number: 'T2',
          person_count: 2,
          dine_type: 'Dine-in',
          updated_date: new Date('2026-10-02T10:00:00Z'),
        };
        salesRepository.getById.mockResolvedValue(doc);
        const findOne = jest.fn().mockResolvedValue(null);
        const updateOne = jest.fn();
        BaseModel.getDb.mockResolvedValue({ collection: () => ({ findOne, updateOne }) });
        const result = await salesService.processSale(
          makeSaleData({
            sale_method: 'Table-Order',
            payment_mode,
            table_number: 'T2',
            person_count: 2,
            ...(payment_mode === 'Cash,Upi' ? { multi_payment: { Cash: 100, Upi: 100 } } : {}),
          }),
          SALE_ID,
          'Edit',
          makeContext()
        );
        expect(result.status).toBe(true);
        expect(doc.set).toHaveBeenCalledWith(
          expect.objectContaining({
            payment_status: 'Paid',
            partial_balance: 200,
            table_number: 'T2',
          })
        );
        expect(doc.$where).toMatchObject({
          payment_status: 'Unpaid',
          seating_request_id: 'remote-claim',
          table_number: 'T2',
        });
        expect(salesRepository.save).toHaveBeenCalledWith(doc);
      }
    );

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

    test('fully paid floor groups carry a close action but mixed groups do not', async () => {
      salesRepository.aggregate.mockResolvedValue([
        { dine_type: 'Dine-in', table_number: '1', orders: 2, paidOrders: 2 },
        { dine_type: 'Dine-in', table_number: '2', orders: 2, paidOrders: 1 },
      ]);
      const result = await salesService.getTablesWithActiveOrders(BRANCH_ID);
      expect(result.data.table_details.map((table) => table.awaiting_close)).toEqual([true, false]);
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

  test('online dispatch requires the shared seating protocol without trusting a client override', async () => {
    const payload = { branch: BRANCH_ID, seatingProtocol: false };
    salesRepository.createOnlineOrder = jest.fn().mockResolvedValue({ status: true });
    await salesService.createOnlineOrder(payload, { staffOrder: true, seatingProtocol: false });
    expect(salesRepository.createOnlineOrder).toHaveBeenCalledWith(
      payload,
      expect.objectContaining({ staffOrder: true, seatingProtocol: true })
    );
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
