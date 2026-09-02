'use strict';

/*
 * The seam between a sale and its invoice. What is pinned:
 *
 *   - the sale's PHP-era payment words become the invoice's paid/balance,
 *     and a parked cart yields nothing;
 *   - a sync writes the invoice from the SALE and closes the quote chain;
 *   - marking an invoice paid settles the sale through the customer page's
 *     own door, writing the two ledger rows that door expects, and never
 *     writes money onto the invoice itself.
 */

const mockApply = jest.fn();
const mockGetInvoice = jest.fn();
const mockRecordPayment = jest.fn();
const mockQuoteTransition = jest.fn();
const mockClose = jest.fn();

jest.mock('../../../src/repositories/invoice.repository', () => {
  return class MockInvoiceRepository {
    applySaleSnapshot(...a) {
      return mockApply(...a);
    }

    getInvoice(...a) {
      return mockGetInvoice(...a);
    }

    recordPayment(...a) {
      return mockRecordPayment(...a);
    }
  };
});
jest.mock('../../../src/repositories/quote.repository', () => {
  return class MockQuoteRepository {
    transition(...a) {
      return mockQuoteTransition(...a);
    }
  };
});
jest.mock('../../../src/repositories/sale.repository', () => ({
  salesPaymentCloseModel: (...a) => mockClose(...a),
}));

const collections = {};
jest.mock('../../../src/models/base.model', () => ({
  getDb: async () => ({ collection: (name) => collections[name] }),
}));

const sync = require('../../../src/services/invoice-sync');
const { ObjectId } = require('mongodb');

const SALE = '64b000000000000000000005';
const INVOICE = '64b000000000000000000003';
const QUOTE = '64b000000000000000000007';
const CUSTOMER = '64b000000000000000000008';
const BRANCH = '64b000000000000000000001';
const LICENSE = '64b000000000000000000002';

const sale = (extra = {}) => ({
  _id: new ObjectId(SALE),
  sales_id: 'S000042',
  sales_total: 200,
  payment_status: 'Unpaid',
  payment_pending: 200,
  partial_balance: 0,
  branch_id: new ObjectId(BRANCH),
  license: new ObjectId(LICENSE),
  source_invoice_id: new ObjectId(INVOICE),
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  collections.sales = { findOne: jest.fn(), updateOne: jest.fn().mockResolvedValue({}) };
  collections.transaction = {
    findOne: jest.fn().mockResolvedValue(null),
    insertOne: jest.fn().mockResolvedValue({}),
  };
  mockApply.mockResolvedValue({ status: true, data: { status: 'paid' }, message: 'Invoice paid' });
  mockGetInvoice.mockResolvedValue({ status: true, data: { _id: new ObjectId(INVOICE) } });
  mockRecordPayment.mockResolvedValue({ status: true });
  mockQuoteTransition.mockResolvedValue({ status: true });
  mockClose.mockResolvedValue({ status: true, data: 0, message: 'Sales settled successfully' });
});

describe('snapshotFromSale', () => {
  test("reads the sale's payment words into paid and balance", () => {
    expect(sync.snapshotFromSale(sale({ payment_status: 'Paid' }))).toMatchObject({
      paid_amount: 200,
      balance: 0,
    });
    expect(sync.snapshotFromSale(sale({ payment_status: 'Unpaid' }))).toMatchObject({
      paid_amount: 0,
      balance: 200,
    });
    expect(
      sync.snapshotFromSale(sale({ payment_status: 'Partialy Paid', payment_pending: 60 }))
    ).toMatchObject({ paid_amount: 140, balance: 60, sale_number: 'S000042' });
  });

  test('a parked cart is not a sale', () => {
    expect(sync.snapshotFromSale(sale({ sale_process: 'Hold' }))).toBeNull();
  });

  test('paid never exceeds the total, never drops below zero', () => {
    expect(
      sync.snapshotFromSale(sale({ payment_status: 'Partialy Paid', payment_pending: -5 }))
        .paid_amount
    ).toBe(200);
    expect(
      sync.snapshotFromSale(sale({ payment_status: 'Partialy Paid', payment_pending: 900 }))
        .paid_amount
    ).toBe(0);
  });
});

describe('syncSale', () => {
  test('writes the invoice FROM the sale, walled by the sale, and closes the quote chain', async () => {
    collections.sales.findOne.mockResolvedValue(sale({ payment_status: 'Paid' }));
    mockGetInvoice.mockResolvedValue({
      status: true,
      data: { _id: new ObjectId(INVOICE), source_quote_id: new ObjectId(QUOTE) },
    });
    const r = await sync.syncSale(SALE);
    expect(r.synced).toBe(true);
    const [id, snapshot, ctx] = mockApply.mock.calls[0];
    expect(id).toBe(INVOICE);
    expect(snapshot).toMatchObject({ sale_id: SALE, paid_amount: 200, balance: 0 });
    expect(ctx).toMatchObject({ branchId: BRANCH, licenseId: LICENSE });
    expect(mockQuoteTransition).toHaveBeenCalledWith(
      QUOTE,
      'convert',
      { sale_id: SALE },
      expect.any(Object)
    );
  });

  test('a sale with no invoice, or a parked cart, syncs nothing', async () => {
    collections.sales.findOne.mockResolvedValue(sale({ source_invoice_id: null }));
    expect((await sync.syncSale(SALE)).synced).toBe(false);
    collections.sales.findOne.mockResolvedValue(sale({ sale_process: 'Hold' }));
    expect((await sync.syncSale(SALE)).synced).toBe(false);
    expect(mockApply).not.toHaveBeenCalled();
  });

  test('the fire-safe entry points never throw', async () => {
    collections.sales.findOne.mockRejectedValue(new Error('db down'));
    await expect(sync.afterSaleSaved(SALE)).resolves.toMatchObject({ synced: false });
    await expect(sync.afterSaleSettled(SALE)).resolves.toMatchObject({ synced: false });
  });
});

describe('settleForInvoice', () => {
  const invoice = () => ({
    _id: new ObjectId(INVOICE),
    invoice_id: 'INV-000009',
    status: 'unpaid',
    sale_id: new ObjectId(SALE),
  });

  test('with a customer: a payment received row, the missing sale row, then the settlement door', async () => {
    collections.sales.findOne.mockResolvedValue(
      sale({ customer_id: new ObjectId(CUSTOMER), customer_name: 'Acme' })
    );
    const r = await sync.settleForInvoice(
      invoice(),
      { method: 'Bank transfer', reference: 'UTR123' },
      { userName: 'owner', userId: BRANCH }
    );
    expect(r.status).toBe(true);
    const inserted = collections.transaction.insertOne.mock.calls.map((c) => c[0]);
    /* the money received, in the customer page's own shape */
    expect(inserted[0]).toMatchObject({ type: 'in', amount: 200, pending: 0, sale_id: '' });
    expect(inserted[0].description).toMatch(/INV-000009 paid - Bank transfer \(UTR123\)/);
    /* the sale's own row did not exist (an unpaid-toggle sale never writes
       one) so it is created for the settlement to land on */
    expect(inserted[1]).toMatchObject({ type: 'out', amount: 0, pending: 200 });
    expect(String(inserted[1].sale_id)).toBe(SALE);
    expect(mockClose).toHaveBeenCalledWith(
      expect.objectContaining({
        sales: [{ id: SALE, amount: 200, paidamount: 0 }],
        id: CUSTOMER,
        loggedUserName: 'owner',
      })
    );
    /* the invoice gets a note, and then the mirror - never a balance */
    expect(mockRecordPayment.mock.calls[0][1]).toMatchObject({
      amount: 200,
      method: 'Bank transfer',
    });
    expect(mockApply).toHaveBeenCalled();
    expect(collections.sales.updateOne).not.toHaveBeenCalled();
  });

  test('the sale row is not duplicated when it already exists', async () => {
    collections.sales.findOne.mockResolvedValue(sale({ customer_id: new ObjectId(CUSTOMER) }));
    collections.transaction.findOne.mockResolvedValue({ _id: 'existing' });
    await sync.settleForInvoice(invoice(), {}, {});
    expect(collections.transaction.insertOne).toHaveBeenCalledTimes(1);
    expect(collections.transaction.insertOne.mock.calls[0][0].type).toBe('in');
  });

  test('without a customer the sale is marked paid directly - there is no ledger to keep', async () => {
    collections.sales.findOne.mockResolvedValue(sale({ customer_id: null }));
    const r = await sync.settleForInvoice(invoice(), { method: 'Cash' }, { userName: 'owner' });
    expect(r.status).toBe(true);
    expect(collections.transaction.insertOne).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
    const set = collections.sales.updateOne.mock.calls[0][1].$set;
    expect(set).toMatchObject({ payment_status: 'Paid', payment_pending: 0, partial_balance: 200 });
  });

  test('a part payment is refused - v1 settles the balance', async () => {
    collections.sales.findOne.mockResolvedValue(sale({ customer_id: new ObjectId(CUSTOMER) }));
    const r = await sync.settleForInvoice(invoice(), { amount: 50 }, {});
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/whole balance/);
    expect(collections.transaction.insertOne).not.toHaveBeenCalled();
  });

  test('an already-paid sale just refreshes the mirror', async () => {
    collections.sales.findOne.mockResolvedValue(
      sale({ payment_status: 'Paid', payment_pending: 0 })
    );
    const r = await sync.settleForInvoice(invoice(), {}, {});
    expect(r.status).toBe(true);
    expect(r.data.already).toBe(true);
    expect(mockApply).toHaveBeenCalled();
    expect(collections.transaction.insertOne).not.toHaveBeenCalled();
  });

  test('an invoice with no sale cannot be paid - the sale is the money', async () => {
    const r = await sync.settleForInvoice({ _id: new ObjectId(INVOICE), sale_id: null }, {}, {});
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/Convert to sale/);
  });
});
