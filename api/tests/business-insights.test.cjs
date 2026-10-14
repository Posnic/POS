const { test } = require('@jest/globals');
const assert = require('node:assert/strict');
const { ObjectId } = require('mongodb');
const { summarizeInsights, readBusinessInsights } = require('../src/services/business-insights');
const branch = {
  id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
  currency: 'INR',
  currencyDigits: 2,
  timezone: 'Asia/Kolkata',
};
const context = {
  businessId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  branches: [branch],
  capabilities: ['overview.read', 'items.read', 'reporting.manage', 'tenders.read'],
};
const range = { from: '2026-10-05', to: '2026-10-11' },
  checked = '2026-10-14T10:00:00.000Z';
const sale = (extra = {}) => ({
  _id: new ObjectId(),
  license: context.businessId,
  branch_id: branch.id,
  sale_process: 'Add',
  payment_status: 'Paid',
  date: new Date('2026-10-05T06:00:00Z'),
  sales_total: 500,
  items_return_total: 0,
  created_by: 'Priya',
  payment_mode: 'UPI',
  discount: 10,
  sale_extra_discount: 5,
  items: [
    {
      item_id: 'cccccccccccccccccccccccc',
      item_name: 'Fish',
      item_unit: 'plate',
      item_quantity: 1,
      total_amount: 500,
    },
  ],
  ...extra,
});
test('range sales reconcile invoices, returns, staff and hours; drafts are excluded', () => {
  const r = summarizeInsights(
    [
      sale(),
      sale({ sale_process: 'Draft' }),
      sale({
        date: new Date('2026-10-01T06:00:00Z'),
        items_return_total: 50,
        items_return: [
          {
            returnArray: {
              returnObjId: new ObjectId(),
              returnDate: new Date('2026-10-06T06:00:00Z'),
              itemsTotalAmount: 50,
            },
          },
        ],
      }),
    ],
    context,
    branch,
    range,
    checked
  );
  assert.equal(r.billedSalesMinor, 50000);
  assert.equal(r.refundsMinor, 5000);
  assert.equal(r.salesAfterReturnsMinor, 45000);
  assert.equal(r.bills, 1);
  assert.equal(r.staff[0].salesAfterReturnsMinor, 45000);
  assert.equal(r.hours[11].billedSalesMinor, 50000);
  assert.equal(r.discounts.amountMinor, 1500);
  assert.equal(r.payments.receivedMinor, 50000);
  assert.equal(r.payments.basis, 'invoice-date');
  assert.equal(r.items, null);
});
test('a broken payment split suppresses payments rather than returning a partial total', () => {
  const r = summarizeInsights(
    [sale(), sale({ multi_payment: { Cash: 100 } })],
    context,
    branch,
    range,
    checked
  );
  assert.equal(r.payments, null);
  assert.equal(r.billedSalesMinor, 100000);
});
test('item rankings use all period facts and never mix quantity units', () => {
  const r = summarizeInsights(
    [
      sale(),
      sale({
        sales_total: 200,
        items: [
          {
            item_id: 'dddddddddddddddddddddddd',
            item_name: 'Rice',
            item_unit: 'kg',
            item_quantity: 5,
            total_amount: 200,
          },
        ],
      }),
    ],
    context,
    branch,
    range,
    checked
  );
  assert.ok(r.items);
  assert.equal(r.items.bySales[0].name, 'Fish');
  assert.deepEqual(
    r.items.byQuantity.map((g) => g.unit),
    ['kg', 'plate']
  );
  assert.equal(r.items.byQuantity[0].items[0].name, 'Rice');
});
test('restricted roles cannot obtain staff, item or tender data', () => {
  const c = { ...context, capabilities: ['overview.read'] };
  const r = summarizeInsights([sale()], c, branch, range, checked);
  assert.equal(r.staff, null);
  assert.equal(r.items, null);
  assert.equal(r.payments, null);
});
test('all time derives first actual date and empty results do not invent it', () => {
  assert.equal(
    summarizeInsights([sale()], context, branch, { from: null, to: range.to }, checked).from,
    '2026-10-05'
  );
  assert.equal(
    summarizeInsights([], context, branch, { from: null, to: range.to }, checked).from,
    null
  );
});
test('scope and invalid or future dates are rejected before any DB call', async () => {
  for (const query of [
    { branchId: 'other', from: range.from, to: range.to },
    { branchId: branch.id, from: '2026-02-30', to: range.to },
    { branchId: branch.id, from: range.to, to: range.from },
    { branchId: branch.id, from: range.from, to: '2027-01-01' },
  ])
    await assert.rejects(
      readBusinessInsights({}, context, query, { now: () => Date.parse(checked) })
    );
});
