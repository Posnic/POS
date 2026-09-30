const BaseModel = require('../../../src/models/base.model');
const outlets = require('../../../src/services/billing-outlets');
const { summarize } = require('../../../src/services/outlet-summary');
const { calculateSaleHeader } = require('../../../src/services/sale-header');
const id = (n) => String(n).padStart(24, '0');
const branch = {
  id: id(1),
  license: id(2),
  currency: 'INR',
  currencyDigits: 2,
  timezone: 'Asia/Kolkata',
};
const sale = (n, extras = {}) => ({
  _id: id(n),
  license: id(2),
  branch_id: id(1),
  outlet_id: id(n),
  outlet_snapshot: { name: ['Restaurant', 'Bar', 'Room service'][n - 3] },
  date: new Date('2026-09-30T05:00:00Z'),
  sale_process: 'Add',
  payment_status: 'Paid',
  sales_total: 100,
  paid_amount: 100,
  payment_pending: 0,
  payment_mode: 'Cash',
  ...extras,
});
test('three outlets consolidate once, splitting tenders and keeping unpaid balances out of cash', () => {
  const result = summarize(
    [
      sale(3),
      sale(4, { multi_payment: { Cash: 40, Card: 60 } }),
      sale(5, { payment_status: 'Unpaid', paid_amount: 0, payment_pending: 100 }),
      sale(6, { sale_process: 'Hold' }),
      sale(7, { sale_process: 'Cancel' }),
      sale(8, { date: new Date('2026-09-29T18:00:00Z') }),
    ],
    branch,
    '2026-09-30'
  );
  expect(result).toMatchObject({ bills: 3, sales: 30000, outstanding: 10000, received: 20000 });
  expect(result.payments).toEqual([
    { name: 'Cash', amount: 14000 },
    { name: 'Card', amount: 6000 },
  ]);
  expect(result.outlets).toHaveLength(3);
});
test('unknown split amounts are reported for reconciliation rather than guessed as cash', () => {
  const result = summarize(
    [sale(3, { payment_mode: 'Cash,Card', multi_payment: {} })],
    branch,
    '2026-09-30'
  );
  expect(result.received).toBe(0);
  expect(result.unresolved).toEqual([id(3)]);
});
test('refunds use their own business date and original outlet', () => {
  const result = summarize(
    [
      sale(3, {
        date: new Date('2026-09-29T05:00:00Z'),
        items_return_total: 20,
        items_return: [
          {
            returnArray: {
              returnObjId: id(20),
              itemsTotalAmount: 20,
              returnDate: new Date('2026-09-30T05:00:00Z'),
            },
          },
        ],
      }),
    ],
    branch,
    '2026-09-30'
  );
  expect(result).toMatchObject({ bills: 0, sales: 0, refunds: 2000, received: 0 });
});
test('prices, service charges and optional charge tax remain separate', () => {
  const config = outlets.validate({
    name: 'Bar',
    markup_percent: 25,
    service_percent: 10,
    service_tax_percent: 5,
  });
  expect(outlets.price(config, { _id: id(3), selling_price: 200 }, 200)).toBe(250);
  expect(outlets.price(config, { _id: id(3), selling_price: 0 }, 500)).toBe(500);
  expect(
    outlets.price(
      { ...config, prices: [{ item_id: id(3), price: 275 }] },
      { _id: id(3), selling_price: 200 },
      200
    )
  ).toBe(275);
  const charge = outlets.charge(config, 250);
  expect(charge).toMatchObject({ amount: 25, tax_amount: 1.25, source: 'outlet' });
  expect(calculateSaleHeader({}, 250, { outletCharge: 26.25 }).salesTotalForDoc).toBe(276.25);
});
test('the printable report combines each register closing once and marks missing cash counts', async () => {
  const { read } = require('../../../src/services/outlet-summary');
  const { ObjectId } = require('mongodb');
  const sessions = [
    {
      _id: id(20),
      register_name: 'Reception',
      register_closedate: new Date('2026-09-30T05:00:00Z'),
      closing_expected: 100,
      closing_counted: 100,
      countedAmount: [{ paymenttype: 'Card', value: '300' }],
    },
    {
      _id: id(21),
      register_name: 'Bar',
      register_closedate: new Date('2026-09-30T05:00:00Z'),
      closing_expected: 200,
      closing_counted: null,
      countedAmount: [{ paymenttype: 'Card', value: 200 }],
    },
    {
      _id: id(22),
      register_name: 'Yesterday',
      register_closedate: new Date('2026-09-29T05:00:00Z'),
      closing_expected: 900,
      closing_counted: 900,
    },
  ];
  const db = {
    collection: (name) => ({
      find: () => ({
        limit() {
          return this;
        },
        maxTimeMS() {
          return this;
        },
        toArray: async () => (name === 'sales' ? [] : sessions),
      }),
    }),
  };
  const result = await read(
    db,
    { branch_id: new ObjectId(id(1)), license: new ObjectId(id(2)) },
    { _id: id(1), currency: 'INR', time_zone: 'Asia/Kolkata', branch_name: 'Hotel' },
    '2026-09-30'
  );
  expect(result.closings).toHaveLength(2);
  expect(result.cashExpected).toBe(30000);
  expect(result.cashCounted).toBeNull();
  expect(result.countedPayments).toEqual([{ name: 'Card', amount: 50000 }]);
  await expect(read(db, {}, {}, '2026-99-99')).rejects.toThrow('valid report date');
});
test.each([
  { name: '' },
  { name: 'Bar', service_percent: -1 },
  { name: 'Bar', markup_percent: Infinity },
  { name: 'Bar', prices: [{ item_id: id(3), price: 'garbage' }] },
])('invalid configuration cannot silently become zero', (input) => {
  expect(() => outlets.validate(input)).toThrow();
});
test('resolve verifies branch/license/staff and retains a bill snapshot across changes', async () => {
  const updated_at = new Date('2026-09-30T00:00:00Z');
  const findOne = jest.fn(async () => ({
    name: 'Bar',
    members: [id(6)],
    markup_percent: 25,
    updated_at,
  }));
  const spy = jest.spyOn(BaseModel, 'getDb').mockResolvedValue({ collection: () => ({ findOne }) });
  const context = { branchId: id(1), licenseId: id(2), userId: id(6) };
  try {
    await expect(
      outlets.resolve(context, id(3), null, updated_at.toISOString())
    ).resolves.toMatchObject({ name: 'Bar' });
    expect(String(findOne.mock.calls[0][0].branch_id)).toBe(id(1));
    expect(String(findOne.mock.calls[0][0].license)).toBe(id(2));
    await expect(
      outlets.resolve({ ...context, userId: id(7) }, id(3), null, updated_at.toISOString())
    ).rejects.toThrow('access');
    await expect(outlets.resolve(context, id(3), null, 'old')).rejects.toThrow('changed');
    await expect(outlets.resolve(context, id(4), { outlet_id: id(3) })).rejects.toThrow('original');
    await expect(
      outlets.resolve(context, id(3), {
        outlet_id: id(3),
        outlet_snapshot: { name: 'Old bar', markup_percent: 10 },
      })
    ).resolves.toMatchObject({ name: 'Old bar', markup_percent: 10 });
  } finally {
    spy.mockRestore();
  }
});
