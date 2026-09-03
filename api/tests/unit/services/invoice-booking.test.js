'use strict';

/*
 * Issuing an invoice books its sale through the sale engine. What is pinned
 * is the PAYLOAD: it must be the one the till would have built, so an
 * invoiced sale is indistinguishable from a counter sale in the books.
 *
 *   - catalog lines at the invoiced price, discount and tax;
 *   - custom lines and positive charges as instant items (counted, taxed,
 *     reported), deductions as the extra discount;
 *   - Unpaid, no register, the invoice's own customer or the shop default;
 *   - source_invoice_id on the sale, and the mirror run for the reply;
 *   - replay-safe: an issued invoice books nothing twice.
 */

const mockProcessSale = jest.fn();
const mockEnrich = jest.fn();
jest.mock('../../../src/services/sale.service', () => ({
  processSale: (...a) => mockProcessSale(...a),
  enrichSaleContext: (...a) => mockEnrich(...a),
}));

const mockCreateInstant = jest.fn();
jest.mock('../../../src/repositories/item.repository', () => {
  return class MockItemRepository {
    createInstantItem(...a) {
      return mockCreateInstant(...a);
    }
  };
});

const mockGetInvoice = jest.fn();
jest.mock('../../../src/repositories/invoice.repository', () => {
  return class MockInvoiceRepository {
    getInvoice(...a) {
      return mockGetInvoice(...a);
    }
  };
});

const mockSync = jest.fn();
jest.mock('../../../src/services/invoice-sync', () => ({
  syncSale: (...a) => mockSync(...a),
}));

const collections = {};
jest.mock('../../../src/models/base.model', () => ({
  getDb: async () => ({ collection: (name) => collections[name] }),
}));

const booking = require('../../../src/services/invoice-booking');
const { ObjectId } = require('mongodb');

const BRANCH = '64b000000000000000000001';
const LICENSE = '64b000000000000000000002';
const INVOICE = '64b000000000000000000003';
const ITEM = '64b000000000000000000004';
const SALE = '64b000000000000000000005';
const CUSTOMER = '64b000000000000000000008';
const DEFAULT_CUSTOMER = '64b000000000000000000009';
const INSTANT = '64b00000000000000000000a';
const ctx = {
  branchId: BRANCH,
  licenseId: LICENSE,
  userId: null,
  userName: 'owner',
  branchName: 'Main',
};

const invoice = (extra = {}) => ({
  _id: new ObjectId(INVOICE),
  invoice_id: 'INV-000003',
  status: 'draft',
  sale_id: null,
  customer_id: new ObjectId(CUSTOMER),
  customer_name: 'Acme Traders',
  reference: 'PO-77',
  items: [
    {
      kind: 'item',
      item_id: new ObjectId(ITEM),
      item_name: 'Rice',
      qty: 2,
      unit_price: 50,
      discount: { type: 'amount', value: 10, computed: 10 },
      tax_value: 5,
      tax_type: 'inclusive',
      line_total: 90,
    },
    {
      kind: 'custom',
      item_id: null,
      item_name: 'Installation',
      qty: 1,
      unit_price: 500,
      tax_value: 18,
      tax_type: 'exclusive',
      line_total: 590,
    },
  ],
  charges: [
    { name: 'Freight', type: 'amount', value: 40, sign: 1, computed: 40 },
    { name: 'Rebate', type: 'amount', value: 15, sign: -1, computed: 15 },
  ],
  discount: { type: 'amount', value: 5, computed: 5 },
  subtotal: 680,
  tax_total: 94.29,
  total: 700,
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  collections.customers = {
    findOne: jest.fn().mockImplementation(async (q) => ({
      _id: q._id,
      name: String(q._id) === DEFAULT_CUSTOMER ? 'Walk-in' : 'Acme Traders Pvt Ltd',
      phone: '9999',
      state: 'Tamil Nadu',
      country: 'India',
      gst_type: 'registered',
      gst_number: '33ABCDE1234F1Z5',
    })),
  };
  mockGetInvoice.mockResolvedValue({ status: true, data: invoice() });
  mockEnrich.mockImplementation(async (c) => ({
    ...c,
    roundOff: false,
    branchSettings: { default_customer: DEFAULT_CUSTOMER, indian_gst: 'gst_on' },
    salesPrefix: 'INV',
  }));
  let n = 0;
  mockCreateInstant.mockImplementation(async (data) => ({
    status: true,
    data: { _id: new ObjectId(INSTANT.slice(0, -1) + String(n++ % 10)), name: data.items_name },
  }));
  mockProcessSale.mockResolvedValue({
    status: true,
    data: { _id: new ObjectId(SALE), sales_id: new ObjectId(SALE), sale_number: 'S000042' },
  });
  mockSync.mockResolvedValue({
    synced: true,
    data: { status: 'unpaid', balance: 700 },
    message: 'Invoice unpaid',
  });
});

test('the payload is the one the till would have built', async () => {
  const r = await booking.issueInvoice(INVOICE, ctx);
  expect(r.status).toBe(true);
  expect(r.message).toMatch(/S000042/);
  const [payload, id, process, context] = mockProcessSale.mock.calls[0];
  expect(id).toBe('');
  expect(process).toBe('Add');
  expect(context).toMatchObject({ branchId: BRANCH, licenseId: LICENSE, userName: 'owner' });

  /* the catalog line: invoiced price, per-unit discount, the line's tax */
  expect(payload.items[0]).toMatchObject({
    item_id: ITEM,
    item_quantity: 2,
    sale_inline_item_price: 50,
    sale_inline_discount_value: 5,
    sale_inline_discount_pervalue: 0,
    tax: 5,
    tax_type: 'inclusive',
    item_status: '',
  });
  /* the custom line became an instant item, taxed as the line was */
  expect(mockCreateInstant.mock.calls[0][0]).toMatchObject({
    items_name: 'Installation',
    items_selling_price: 500,
    items_tax: 18,
    items_tax_type: 'exclusive',
  });
  expect(payload.items[1]).toMatchObject({
    item_quantity: 1,
    sale_inline_item_price: 500,
    item_status: 'instant',
    tax: 18,
  });
  /* the positive charge is a line too; the deduction joins the extra discount */
  expect(mockCreateInstant.mock.calls[1][0]).toMatchObject({
    items_name: 'Freight',
    items_selling_price: 40,
    items_tax: 0,
  });
  expect(payload.items[2]).toMatchObject({
    item_quantity: 1,
    sale_inline_item_price: 40,
    item_status: 'instant',
  });
  expect(payload.extra_discount).toBe(20);
  expect(payload.extra_discount_type).toBe('price');
  /* unpaid, no till, the invoice's customer with the record's tax facts */
  expect(payload).toMatchObject({
    unpaid: 'true',
    payment_mode: '',
    register_id: '',
    customer_id: CUSTOMER,
    customer_name: 'Acme Traders',
    customer_state: 'Tamil Nadu',
    customer_gst_number: '33ABCDE1234F1Z5',
    source_invoice_id: INVOICE,
    sales_total: 700,
  });
  expect(payload.sales_description).toMatch(/INV-000003 \/ PO-77/);
  /* and the mirror ran for the reply */
  expect(mockSync).toHaveBeenCalledWith(expect.anything(), { invoiceId: INVOICE });
  expect(r.data).toMatchObject({ sale_id: SALE, sale_number: 'S000042', status: 'unpaid' });
});

test('a walk-in invoice books against the shop default customer', async () => {
  mockGetInvoice.mockResolvedValue({
    status: true,
    data: invoice({ customer_id: null, customer_name: '' }),
  });
  const r = await booking.issueInvoice(INVOICE, ctx);
  expect(r.status).toBe(true);
  const payload = mockProcessSale.mock.calls[0][0];
  expect(payload.customer_id).toBe(DEFAULT_CUSTOMER);
  expect(payload.customer_name).toBe('Walk-in');
});

test('no customer anywhere is refused before the engine is touched', async () => {
  mockGetInvoice.mockResolvedValue({ status: true, data: invoice({ customer_id: null }) });
  mockEnrich.mockImplementation(async (c) => ({ ...c, branchSettings: {} }));
  const r = await booking.issueInvoice(INVOICE, ctx);
  expect(r.status).toBe(false);
  expect(r.message).toMatch(/default customer/);
  expect(mockProcessSale).not.toHaveBeenCalled();
});

test('an issued invoice books nothing twice', async () => {
  mockGetInvoice.mockResolvedValue({
    status: true,
    data: invoice({ status: 'unpaid', sale_id: new ObjectId(SALE), sale_number: 'S000042' }),
  });
  const r = await booking.issueInvoice(INVOICE, ctx);
  expect(r.status).toBe(true);
  expect(r.data.already).toBe(true);
  expect(mockProcessSale).not.toHaveBeenCalled();
  expect(mockSync).toHaveBeenCalled();
});

test('only a draft can be issued', async () => {
  mockGetInvoice.mockResolvedValue({ status: true, data: invoice({ status: 'cancelled' }) });
  const r = await booking.issueInvoice(INVOICE, ctx);
  expect(r.status).toBe(false);
  expect(mockProcessSale).not.toHaveBeenCalled();
});

test("the engine's refusal is the caller's answer - nothing is half booked", async () => {
  mockProcessSale.mockResolvedValue({ status: false, message: 'Item Removed' });
  const r = await booking.issueInvoice(INVOICE, ctx);
  expect(r.status).toBe(false);
  expect(r.message).toBe('Item Removed');
  expect(mockSync).not.toHaveBeenCalled();
});

test('discount fields: percent stays percent, an amount is spread per unit', () => {
  expect(booking.discountFields({ qty: 4, discount: { type: 'percent', value: 12.5 } })).toEqual({
    amount: 0,
    percent: 12.5,
  });
  expect(booking.discountFields({ qty: 4, discount: { type: 'amount', value: 10 } })).toEqual({
    amount: 2.5,
    percent: 0,
  });
  expect(booking.discountFields({ qty: 4 })).toEqual({ amount: 0, percent: 0 });
});
