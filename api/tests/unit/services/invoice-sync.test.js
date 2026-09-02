'use strict';

/*
 * The seam between a sale and its invoice. What is pinned:
 *
 *   - the sale's PHP-era payment words become the invoice's paid/balance,
 *     and a parked cart yields nothing;
 *   - a sync writes the invoice from the SALE and closes the quote chain;
 *   - recording a payment - full or part - pays the SALE down, writing the
 *     two ledger rows the customer page expects and recomputing the
 *     customer's balance, and never writes money onto the invoice itself.
 */

const mockApply = jest.fn();
const mockGetInvoice = jest.fn();
const mockRecordPayment = jest.fn();
const mockQuoteTransition = jest.fn();

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
    updateOne: jest.fn().mockResolvedValue({}),
    aggregate: jest
      .fn()
      .mockReturnValue({ toArray: async () => [{ totalIn: 200, totalOut: 200 }] }),
  };
  collections.customers = { updateOne: jest.fn().mockResolvedValue({}) };
  mockApply.mockResolvedValue({ status: true, data: { status: 'paid' }, message: 'Invoice paid' });
  mockGetInvoice.mockResolvedValue({ status: true, data: { _id: new ObjectId(INVOICE) } });
  mockRecordPayment.mockResolvedValue({ status: true });
  mockQuoteTransition.mockResolvedValue({ status: true });
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
    ).toMatchObject({ paid_amount: 140, balance: 60, sale_number: 'S000042', total: 200 });
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
    expect(snapshot).toMatchObject({ sale_id: SALE, total: 200, paid_amount: 200, balance: 0 });
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

describe('recordPayment', () => {
  const invoice = () => ({
    _id: new ObjectId(INVOICE),
    invoice_id: 'INV-000009',
    status: 'unpaid',
    sale_id: new ObjectId(SALE),
  });

  test('full payment with a customer: the money-in row, the sale row, the sale itself, the balance', async () => {
    collections.sales.findOne.mockResolvedValue(
      sale({ customer_id: new ObjectId(CUSTOMER), customer_name: 'Acme' })
    );
    const r = await sync.recordPayment(
      invoice(),
      { method: 'Bank transfer', reference: 'UTR123' },
      { userName: 'owner' }
    );
    expect(r.status).toBe(true);
    expect(r.data).toMatchObject({ amount: 200, balance: 0 });
    const inserted = collections.transaction.insertOne.mock.calls.map((c) => c[0]);
    /* the money received, in the customer page's own shape */
    expect(inserted[0]).toMatchObject({ type: 'in', amount: 200, pending: 0, sale_id: '' });
    expect(inserted[0].description).toMatch(/INV-000009 paid - Bank transfer \(UTR123\)/);
    /* the sale's own row did not exist (an unpaid sale never writes one) so
       it is created, then paid down */
    expect(inserted[1]).toMatchObject({ type: 'out', amount: 0, pending: 200 });
    expect(String(inserted[1].sale_id)).toBe(SALE);
    const rowUpdate = collections.transaction.updateOne.mock.calls[0][1];
    expect(rowUpdate.$inc).toEqual({ amount: 200 });
    expect(rowUpdate.$set.pending).toBe(0);
    /* the sale's PHP-era fields move exactly as the customer page moves them */
    const saleUpdate = collections.sales.updateOne.mock.calls[0][1];
    expect(saleUpdate.$set).toMatchObject({
      payment_status: 'Paid',
      payment_pending: 0,
      partial_balance: 200,
    });
    expect(saleUpdate.$inc).toEqual({ wallet_amount: 200 });
    /* customer balance recomputed from the ledger */
    expect(collections.customers.updateOne).toHaveBeenCalled();
    expect(collections.customers.updateOne.mock.calls[0][1].$set.balance).toBe(0);
    /* the invoice gets a note, and then the mirror - never a balance of its own */
    expect(mockRecordPayment.mock.calls[0][1]).toMatchObject({
      amount: 200,
      method: 'Bank transfer',
    });
    expect(mockApply).toHaveBeenCalled();
  });

  test('a part payment leaves the rest pending, on the sale and on the ledger row', async () => {
    collections.sales.findOne.mockResolvedValue(sale({ customer_id: new ObjectId(CUSTOMER) }));
    collections.transaction.findOne.mockResolvedValue({ _id: 'existing' });
    const r = await sync.recordPayment(invoice(), { amount: 75, method: 'Cash' }, {});
    expect(r.status).toBe(true);
    expect(r.data).toMatchObject({ amount: 75, balance: 125 });
    expect(r.message).toMatch(/125\.00 still due/);
    /* the sale row already existed: not duplicated, paid down */
    expect(collections.transaction.insertOne).toHaveBeenCalledTimes(1);
    expect(collections.transaction.insertOne.mock.calls[0][0].type).toBe('in');
    const rowUpdate = collections.transaction.updateOne.mock.calls[0][1];
    expect(rowUpdate.$inc).toEqual({ amount: 75 });
    expect(rowUpdate.$set.pending).toBe(125);
    const saleUpdate = collections.sales.updateOne.mock.calls[0][1];
    expect(saleUpdate.$set).toMatchObject({
      payment_status: 'Partialy Paid',
      payment_pending: 125,
      partial_balance: 75,
    });
  });

  test('a second part payment builds on the first', async () => {
    collections.sales.findOne.mockResolvedValue(
      sale({
        customer_id: new ObjectId(CUSTOMER),
        payment_status: 'Partialy Paid',
        payment_pending: 125,
        partial_balance: 75,
      })
    );
    const r = await sync.recordPayment(invoice(), { amount: 125 }, {});
    expect(r.status).toBe(true);
    const saleUpdate = collections.sales.updateOne.mock.calls[0][1];
    expect(saleUpdate.$set).toMatchObject({
      payment_status: 'Paid',
      payment_pending: 0,
      partial_balance: 200,
    });
  });

  test('without a customer the sale alone is written - there is no ledger to keep', async () => {
    collections.sales.findOne.mockResolvedValue(sale({ customer_id: null }));
    const r = await sync.recordPayment(invoice(), { method: 'Cash' }, { userName: 'owner' });
    expect(r.status).toBe(true);
    expect(collections.transaction.insertOne).not.toHaveBeenCalled();
    expect(collections.customers.updateOne).not.toHaveBeenCalled();
    const set = collections.sales.updateOne.mock.calls[0][1].$set;
    expect(set).toMatchObject({ payment_status: 'Paid', payment_pending: 0, partial_balance: 200 });
  });

  test('more than the balance, or nothing at all, is refused before anything is written', async () => {
    collections.sales.findOne.mockResolvedValue(sale({ customer_id: new ObjectId(CUSTOMER) }));
    const over = await sync.recordPayment(invoice(), { amount: 250 }, {});
    expect(over.status).toBe(false);
    expect(over.message).toMatch(/more than the 200\.00 still owed/);
    const zero = await sync.recordPayment(invoice(), { amount: 0 }, {});
    expect(zero.status).toBe(false);
    expect(collections.transaction.insertOne).not.toHaveBeenCalled();
    expect(collections.sales.updateOne).not.toHaveBeenCalled();
  });

  test('an already-paid sale just refreshes the mirror', async () => {
    collections.sales.findOne.mockResolvedValue(
      sale({ payment_status: 'Paid', payment_pending: 0 })
    );
    const r = await sync.recordPayment(invoice(), {}, {});
    expect(r.status).toBe(true);
    expect(r.data.already).toBe(true);
    expect(mockApply).toHaveBeenCalled();
    expect(collections.transaction.insertOne).not.toHaveBeenCalled();
  });

  test('an invoice with no sale cannot be paid here - issuing comes first', async () => {
    const r = await sync.recordPayment({ _id: new ObjectId(INVOICE), sale_id: null }, {}, {});
    expect(r.status).toBe(false);
    expect(r.message).toMatch(/Issue the invoice first/);
  });
});
