'use strict';
const { allocate, split } = require('../../../src/utils/guest-bill-split');
const {
  snapshotFrom,
  createService,
  billForGuest,
} = require('../../../src/services/guest-bill.service');
const branch = '123456789012345678901234';
const sales = [
  {
    _id: 'sale1',
    sales_id: 'K1',
    sales_sub_total: 300,
    sales_total: 323,
    discount: 0,
    tax: 23,
    items: [
      { name: 'Soup', item_quantity: 1, unit_price: 100, item_tax: 5 },
      { name: 'Main', item_quantity: 1, unit_price: 200, item_tax: 18 },
    ],
  },
];
const sample = {
  table: 'T1',
  currency: '₹',
  revision: 'r1',
  totalMinor: 10001,
  labels: { base: 'Subtotal' },
  lines: [
    {
      id: 'a',
      name: 'Dish',
      quantity: 3,
      amountMinor: 10001,
      components: [{ key: 'base', minor: 10001 }],
    },
  ],
};
test('equal split preserves every cent and shares differ by at most one cent', () => {
  for (let amount = 1; amount < 400; amount++)
    for (let count = 2; count <= 20; count++) {
      const snap = {
        ...sample,
        totalMinor: amount,
        lines: [
          {
            ...sample.lines[0],
            components: [
              { key: 'base', minor: amount + 37 },
              { key: 'discount', minor: -37 },
            ],
          },
        ],
      };
      const out = split(snap, {
        mode: 'equal',
        guests: Array.from({ length: count }, (_, i) => 'Guest ' + i),
      });
      expect(out.reduce((n, g) => n + g.totalMinor, 0)).toBe(amount);
      expect(
        Math.max(...out.map((g) => g.totalMinor)) - Math.min(...out.map((g) => g.totalMinor))
      ).toBeLessThanOrEqual(1);
    }
});
test('individual and shared items keep related tax and discounts with the assigned guest', () => {
  const snapshot = {
    ...sample,
    totalMinor: 32400,
    lines: [
      {
        id: 'a',
        name: 'Soup',
        quantity: 2,
        components: [
          { key: 'base', minor: 10000 },
          { key: 'tax:Tax', minor: 500 },
          { key: 'discount', minor: -100 },
        ],
      },
      {
        id: 'b',
        name: 'Main',
        quantity: 1,
        components: [
          { key: 'base', minor: 20000 },
          { key: 'tax:Tax', minor: 2000 },
        ],
      },
    ],
  };
  const out = split(snapshot, {
    mode: 'items',
    guests: ['A', 'B'],
    allocations: { a: [1, 1], b: [0, 1] },
  });
  expect(out.map((g) => g.totalMinor)).toEqual([5200, 27200]);
  expect(out[0].components['tax:Tax']).toBe(250);
  expect(() =>
    split(snapshot, { mode: 'items', guests: ['A', 'B'], allocations: { a: [0, 0], b: [0, 1] } })
  ).toThrow(/Assign/);
});
test('invalid counts, amounts, and manipulated allocations are rejected', () => {
  expect(() => split(sample, { mode: 'equal', guests: ['A'] })).toThrow();
  expect(() =>
    split(sample, { mode: 'items', guests: ['A', 'B'], allocations: { a: [1, -1] } })
  ).toThrow();
  expect(() => allocate(NaN, [1, 1])).toThrow();
});
function fake() {
  const jobs = new Map(),
    printed = new Map();
  const chain = (value) => ({
    sort() {
      return this;
    },
    limit() {
      return this;
    },
    lean: async () => value,
  });
  const Sale = { find: jest.fn(() => chain(sales)) };
  const Jobs = {
    findOne: jest.fn((q) => chain(jobs.get(q.ticket_key) || null)),
    findOneAndUpdate: jest.fn((q, u) => {
      if (!jobs.has(q.ticket_key)) jobs.set(q.ticket_key, { _id: q.ticket_key, ...u.$setOnInsert });
      return chain(jobs.get(q.ticket_key));
    }),
    updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
  };
  let fail = false;
  const queue = jest.fn(async (job) => {
    if (fail) {
      fail = false;
      return { status: false };
    }
    printed.set(job.ticketKey, job);
    return { status: true };
  });
  const service = createService({
    Sale,
    Branch: { findById: () => chain({ currency: '₹' }) },
    Jobs,
    queue,
    notify: jest.fn(),
  });
  return { service, Sale, Jobs, queue, printed, jobs, setFail: () => (fail = true) };
}
test('printing and retry preserve the same guest bills without any payment update', async () => {
  const f = fake(),
    input = {
      branchId: branch,
      table_number: 'T1',
      request_id: '12345678-1234-1234-1234-123456789012',
      plan: { mode: 'equal', guests: ['A', 'B'] },
    };
  const { snapshot } = await f.service.read(input);
  input.revision = snapshot.revision;
  f.setFail();
  await expect(f.service.send(input)).rejects.toMatchObject({ status: 503 });
  const answer = await f.service.send(input);
  await f.service.send(input);
  expect(answer.queued).toBe(true);
  expect(f.printed.size).toBe(2);
  expect(
    f.Jobs.updateOne.mock.calls.every(([, u]) =>
      Object.keys(u.$set).every((k) => k === 'payload.queued')
    )
  ).toBe(true);
  expect(f.Sale).not.toHaveProperty('updateMany');
  const bill = [...f.printed.values()][0].payload;
  expect(bill.title).toBe('GUEST BILL');
  expect(bill.extras).toContainEqual({ label: 'Payment', value: 'Pay at counter' });
});
test('stale orders and reused request IDs with different plans cannot print', async () => {
  const f = fake(),
    input = {
      branchId: branch,
      table_number: 'T1',
      request_id: '12345678-1234-1234-1234-123456789012',
      plan: { mode: 'equal', guests: ['A', 'B'] },
      revision: 'old',
    };
  await expect(f.service.send(input)).rejects.toMatchObject({ status: 409 });
  expect(f.queue).not.toHaveBeenCalled();
  input.revision = (await f.service.read(input)).snapshot.revision;
  await f.service.send(input);
  input.plan.guests = ['X', 'Y'];
  await expect(f.service.send(input)).rejects.toMatchObject({ status: 409 });
});
test('server snapshot and printed guests reconcile subtotal, tax, discount and adjustments', () => {
  const snap = snapshotFrom(sales, { currency: '₹' }, 'T1');
  expect(snap.totalMinor).toBe(32300);
  expect(snap.lines.reduce((n, l) => n + l.amountMinor, 0)).toBe(32300);
  const guests = split(snap, { mode: 'equal', guests: ['A', 'B', 'C'] });
  const bills = guests.map((g) => billForGuest(snap, g, {}, sales[0], 'batch'));
  expect(Math.round(bills.reduce((n, b) => n + b.total, 0) * 100)).toBe(32300);
  for (const bill of bills)
    expect(
      Math.round(
        (bill.subTotal -
          bill.discount +
          bill.taxes.reduce((n, t) => n + t.amount, 0) +
          bill.roundOff) *
          100
      )
    ).toBe(Math.round(bill.total * 100));
});

test('translated names survive guest bill splitting without menu descriptions', () => {
  const data = JSON.parse(JSON.stringify(sales));
  data[0].items[0].default_language = 'en';
  data[0].items[0].translations = [{ locale: 'nl', name: 'Soep', description: 'Menu only' }];
  const snap = snapshotFrom(data, {}, 'T1');
  const guest = split(snap, { mode: 'equal', guests: ['A', 'B'] })[0];
  const bill = billForGuest(snap, guest, {}, data[0], 'batch');
  expect(bill.items[0].translations).toEqual([{ locale: 'nl', name: 'Soep' }]);
  expect(bill.items[0].name).toBe('Soup');
});
