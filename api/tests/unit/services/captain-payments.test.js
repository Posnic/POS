'use strict';
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
jest.mock('../../../src/sync/outbox', () => ({ enqueue: jest.fn() }));
jest.mock('../../../src/sync/nudge', () => ({ nudgeSyncAgent: jest.fn() }));
jest.mock('../../../src/helpers/bill-notify', () => ({ notifyBillRequested: jest.fn() }));
jest.mock('../../../src/repositories/print-job.repository', () => ({
  queuePrintJob: jest.fn(async () => ({ status: true })),
}));
const service = require('../../../src/services/captain-payments');
const guard = require('../../../src/services/captain-payment-guard');
let mem, db, branch, license, user, sale;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri('captain-payments'));
  db = mongoose.connection.db;
}, 60000);
afterAll(async () => {
  await mongoose.disconnect();
  await mem?.stop();
});
beforeEach(async () => {
  await db.dropDatabase();
  branch = new ObjectId();
  license = new ObjectId();
  user = new ObjectId();
  await db.collection('branches').insertOne({
    _id: branch,
    license,
    currency: '₹',
    captain_payments: { enabled: true, methods: ['Cash', 'Card', 'Upi'], printReceipt: false },
  });
  sale = {
    _id: new ObjectId(),
    branch_id: branch,
    license,
    table_number: 'T1',
    sale_process: 'KOT',
    payment_status: 'Unpaid',
    sales_sub_total: 100,
    sales_total: 105,
    tax: 5,
    items: [{ item_name: 'Soup', item_quantity: 2, item_base_price: 50, item_tax: 5 }],
  };
  await db.collection('sales').insertOne(sale);
});
const req = (body = {}) => ({
  db,
  tenantContext: { branchId: branch, licenseId: license },
  user: { _id: user, name: 'Staff', role: 'manager' },
  body: { branchId: String(branch), table_number: 'T1', ...body },
});
const pay = (plan, overrides = {}) =>
  req({
    planId: plan.id,
    version: plan.version,
    guest: null,
    amountMinor: plan.dueMinor,
    receivedMinor: plan.dueMinor,
    method: 'Cash',
    request_id: require('crypto').randomUUID(),
    ...overrides,
  });

test('unset collection defaults to all methods and reserves edits against payment preparation', async () => {
  await db.collection('branches').updateOne({ _id: branch }, { $unset: { captain_payments: '' } });
  expect((await service.scope(req())).options).toMatchObject({
    enabled: true,
    methods: ['Cash', 'Card', 'Upi'],
  });
  const finishEdit = await guard.beginEdit(db, sale);
  expect(typeof finishEdit).toBe('function');
  await expect(service.prepare(req())).rejects.toMatchObject({ status: 409 });
  await finishEdit();
  expect((await service.prepare(req())).dueMinor).toBe(10500);
});

test('saved payment preferences override defaults', () => {
  expect(
    service.settings({ captain_payments: { enabled: false, methods: ['Cash'] } })
  ).toMatchObject({ enabled: false, methods: ['Cash'] });
  expect(
    service.settings({ captain_payments: { enabled: true, methods: ['Card'] } })
  ).toMatchObject({ enabled: true, methods: ['Card'] });
});

test('desktop can prepare and settle a table when phone collection is disabled', async () => {
  await db.collection('branches').updateOne(
    { _id: branch },
    {
      $set: { module_captain_enable: false, 'captain_payments.enabled': false },
    }
  );
  await expect(service.prepare(req())).rejects.toMatchObject({ status: 403 });
  const plan = await service.prepare({ ...req(), captainPaymentDesktop: true });
  expect(plan.enabled).toBe(true);
  expect(plan.methods).toEqual(['Cash', 'Card', 'Upi']);
  const paid = await service.record({ ...pay(plan), captainPaymentDesktop: true });
  expect(paid.dueMinor).toBe(0);
  expect((await db.collection('sales').findOne({ _id: sale._id })).payment_status).toBe('Paid');
});

test.each([false, 0, '0', 'false'])('disabled Captain module %s blocks the default', (disabled) => {
  expect(service.settings({ module_captain_enable: disabled }).enabled).toBe(false);
});

test('individual takeaway payment targets only the selected sale and keeps preparation open', async () => {
  const other = {
    ...sale,
    _id: new ObjectId(),
    table_number: '',
    dine_type: 'Take away',
    sales_id: 'TA-2',
  };
  await db.collection('sales').insertOne(other);
  await db
    .collection('sales')
    .updateOne(
      { _id: sale._id },
      { $set: { table_number: '', dine_type: 'Take away', sales_id: 'TA-1' } }
    );
  const input = req({ saleId: String(sale._id) });
  const bill = await require('../../../src/services/captain-bill').read({
    ...req(),
    query: { saleId: String(sale._id) },
  });
  expect(bill.orderIds).toEqual([String(sale._id)]);
  expect(bill.dueMinor).toBe(10500);
  const plan = await service.prepare(input);
  expect(plan.table).toBe('Take Away TA-1');
  expect(plan.dueMinor).toBe(10500);
  expect(plan.guests[0].name).toBe('Take Away TA-1');
  expect((await service.prepare(input)).id).toBe(plan.id);
  await service.record(pay(plan));
  const stored = await db.collection('sales').findOne({ _id: sale._id });
  expect(stored.payment_status).toBe('Paid');
  expect(stored.floor_closed_at).toBeUndefined();
  expect((await db.collection('sales').findOne({ _id: other._id })).payment_status).toBe('Unpaid');
});

test('takeaway target rejects dine-in and foreign-branch sale IDs', async () => {
  await expect(service.prepare(req({ saleId: String(sale._id) }))).rejects.toMatchObject({
    status: 409,
  });
  await db
    .collection('sales')
    .updateOne({ _id: sale._id }, { $set: { dine_type: 'Take away', branch_id: new ObjectId() } });
  await expect(service.prepare(req({ saleId: String(sale._id) }))).rejects.toMatchObject({
    status: 409,
  });
});
test('mixed cash and card commits once and projects exact tender amounts', async () => {
  const plan = await service.prepare(req());
  const payment = pay(plan, {
    method: 'Mixed',
    receivedMinor: 11000,
    tenders: [
      { method: 'Cash', amountMinor: 10000, receivedMinor: 10500 },
      {
        method: 'Card',
        amountMinor: 500,
        receivedMinor: 500,
        verified: true,
        reference: 'terminal-1',
      },
    ],
  });
  const first = await service.record(payment);
  const retry = await service.record(payment);
  expect(first.dueMinor).toBe(0);
  expect(retry.payments).toHaveLength(1);
  expect(retry.payments[0].changeMinor).toBe(500);
  const stored = await db.collection('sales').findOne({ _id: sale._id });
  expect(stored.multi_payment).toEqual({ Cash: 100, Card: 5 });
  expect(stored.payment_status).toBe('Paid');
  expect(stored.items).toEqual(sale.items);
  payment.body.tenders[1].reference = 'changed';
  await expect(service.record(payment)).rejects.toMatchObject({ status: 409 });
});

test('invalid mixed totals or unverified card leave the payment journal untouched', async () => {
  const plan = await service.prepare(req());
  for (const tenders of [
    [
      { method: 'Cash', amountMinor: 10000, receivedMinor: 10000 },
      { method: 'Card', amountMinor: 400, receivedMinor: 400, verified: true },
    ],
    [
      { method: 'Cash', amountMinor: 10000, receivedMinor: 10000 },
      { method: 'Card', amountMinor: 500, receivedMinor: 500 },
    ],
  ])
    await expect(service.record(pay(plan, { method: 'Mixed', tenders }))).rejects.toThrow();
  const stored = await db.collection('captain_payment_plans').findOne({ _id: plan.id });
  expect(stored.payments).toEqual([]);
});

test.each([false, true])(
  'mixed payment across sales preserves totals and follows auto-print=%s',
  async (enabled) => {
    const second = { ...sale, _id: new ObjectId() };
    await db.collection('sales').insertOne(second);
    const design = { thermal: { blocks: [] } };
    await db
      .collection('branches')
      .updateOne({ _id: branch }, { $set: { printall: enabled, receipt_designs: design } });
    const queue = require('../../../src/repositories/print-job.repository').queuePrintJob;
    queue.mockClear();
    const plan = await service.prepare(req());
    expect(plan.dueMinor).toBe(21000);
    const input = pay(plan, {
      method: 'Mixed',
      tenders: [
        { method: 'Cash', amountMinor: 10000, receivedMinor: 10000 },
        {
          method: 'Card',
          amountMinor: 11000,
          receivedMinor: 11000,
          verified: true,
          reference: 'terminal-2',
        },
      ],
    });
    await service.record(input);
    await service.record(input);
    const sales = await db.collection('sales').find({}).toArray();
    const totals = { Cash: 0, Card: 0 };
    for (const saved of sales) {
      expect(saved.payment_status).toBe('Paid');
      expect(saved.paid_amount).toBe(105);
      expect(saved.items).toEqual(sale.items);
      expect(Object.values(saved.multi_payment).reduce((a, b) => a + b, 0)).toBe(105);
      for (const [method, amount] of Object.entries(saved.multi_payment)) totals[method] += amount;
      expect(saved.captain_payments).toHaveLength(1);
      expect(saved.captain_payments[0].tenders.reduce((sum, t) => sum + t.amount, 0)).toBe(105);
    }
    expect(totals).toEqual({ Cash: 100, Card: 110 });
    expect(queue).toHaveBeenCalledTimes(enabled ? 2 : 0);
    if (enabled) {
      expect(queue.mock.calls[1][0].ticketKey).toBe(queue.mock.calls[0][0].ticketKey);
      expect(queue.mock.calls[0][0].payload.receiptDocument).toMatchObject({
        receipt_designs: design,
        multi_payment: { Cash: 100, Card: 110 },
        items_total: 210,
      });
    }
  }
);

test('records once across duplicate and concurrent retries without changing items', async () => {
  const plan = await service.prepare(req());
  expect(plan.dueMinor).toBe(10500);
  const input = pay(plan, { receivedMinor: 11000 });
  const results = await Promise.all([
    service.record(input),
    service.record(input),
    service.record(input),
  ]);
  expect(results.every((r) => r.dueMinor === 0 && r.payments.length === 1)).toBe(true);
  const saved = await db.collection('sales').findOne({ _id: sale._id });
  expect(saved.paid_amount).toBe(105);
  expect(saved.payment_status).toBe('Paid');
  expect(saved.items).toEqual(sale.items);
  expect(results[0].payments[0].changeMinor).toBe(500);
  await db
    .collection('branches')
    .updateOne({ _id: branch }, { $set: { 'captain_payments.enabled': false } });
  expect((await service.record(input)).confirmed).toBe(input.body.request_id);
});

test('a mixed settlement retry creates one real receipt job with the configured template', async () => {
  const queue = require('../../../src/repositories/print-job.repository').queuePrintJob;
  const actualQueue = jest.requireActual(
    '../../../src/repositories/print-job.repository'
  ).queuePrintJob;
  const design = { thermal: { blocks: [{ type: 'text', text: 'Test shop receipt' }] } };
  await db
    .collection('branches')
    .updateOne({ _id: branch }, { $set: { printall: true, receipt_designs: design } });
  queue.mockImplementation(actualQueue);
  try {
    const plan = await service.prepare(req());
    const input = pay(plan, {
      method: 'Mixed',
      tenders: [
        { method: 'Cash', amountMinor: 10000, receivedMinor: 10000 },
        { method: 'Card', amountMinor: 500, receivedMinor: 500, verified: true },
      ],
    });
    await service.record(input);
    await service.record(input);
    const jobs = await db.collection('printjobs').find({ branch_id: branch }).toArray();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].ticket_key).toBe('captain-payment:' + input.body.request_id + ':1');
    expect(jobs[0].payload.receiptDocument).toMatchObject({
      receipt_designs: design,
      multi_payment: { Cash: 100, Card: 5 },
      items_total: 105,
    });
  } finally {
    queue.mockImplementation(async () => ({ status: true }));
  }
});
test('split guest payments retain the exact remainder and reject competing stale payments', async () => {
  const snapshot = require('../../../src/services/guest-bill.service').snapshotFrom(
    [sale],
    { currency: '₹' },
    'T1'
  );
  const plan = await service.prepare(
    req({ revision: snapshot.revision, plan: { mode: 'equal', guests: ['A', 'B', 'C'] } })
  );
  expect(plan.guests.map((g) => g.totalMinor)).toEqual([3500, 3500, 3500]);
  const first = await service.record(
    pay(plan, { guest: 0, amountMinor: 3500, receivedMinor: 3500 })
  );
  expect(first.dueMinor).toBe(7000);
  await expect(
    service.record(pay(plan, { guest: 1, amountMinor: 3500, receivedMinor: 3500 }))
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    guard.mutable(db, await db.collection('sales').findOne({ _id: sale._id }))
  ).rejects.toMatchObject({ status: 409 });
  const rest = await service.record(pay(first, { method: 'Card' }));
  expect(rest.dueMinor).toBe(0);
  const saved = await db.collection('sales').findOne({ _id: sale._id });
  expect(saved.multi_payment).toEqual({ Cash: 35, Card: 70 });
});
test('cancel releases an untouched bill and interrupted preparation recovers', async () => {
  const plan = await service.prepare(req());
  await service.release(req({ planId: plan.id }));
  expect(
    (await db.collection('sales').findOne({ _id: sale._id })).captain_payment_plan
  ).toBeUndefined();
  const next = await service.prepare(req());
  await db
    .collection('captain_payment_plans')
    .updateOne(
      { _id: next.id },
      { $set: { state: 'preparing', createdAt: new Date(Date.now() - 120000) } }
    );
  expect((await service.prepare(req())).dueMinor).toBe(10500);
});
test('permissions, branch scope, disabled methods and tampered totals fail closed', async () => {
  const denied = req();
  denied.user.role = 'staff';
  await expect(service.prepare(denied)).rejects.toMatchObject({ status: 403 });
  await expect(service.prepare(req({ branchId: String(new ObjectId()) }))).rejects.toMatchObject({
    status: 403,
  });
  const plan = await service.prepare(req());
  await expect(service.record(pay(plan, { amountMinor: 1 }))).rejects.toMatchObject({
    status: 409,
  });
  await expect(service.record(pay(plan, { method: 'Crypto' }))).rejects.toMatchObject({
    status: 403,
  });
  await db
    .collection('branches')
    .updateOne({ _id: branch }, { $set: { 'captain_payments.enabled': false } });
  await expect(service.record(pay(plan))).rejects.toMatchObject({ status: 403 });
});
test('a journal committed before a lost response repairs the sale on retry', async () => {
  const plan = await service.prepare(req()),
    input = pay(plan);
  const original = db.collection.bind(db);
  let failed = false;
  const collection = original('sales');
  const update = collection.updateOne.bind(collection);
  collection.updateOne = async (filter, change, ...args) => {
    if (change.$set?.captain_payment_version && !failed) {
      failed = true;
      throw new Error('Disconnected');
    }
    return update(filter, change, ...args);
  };
  db.collection = (name, ...args) => (name === 'sales' ? collection : original(name, ...args));
  await expect(service.record(input)).rejects.toThrow('Disconnected');
  db.collection = original;
  expect((await service.record(input)).payments).toHaveLength(1);
  expect((await original('sales').findOne({ _id: sale._id })).paid_amount).toBe(105);
});
test('a receipt queue failure retains one payment and retries the same receipt ticket', async () => {
  await db.collection('branches').updateOne({ _id: branch }, { $set: { printall: true } });
  const queue = require('../../../src/repositories/print-job.repository').queuePrintJob;
  queue.mockClear();
  queue.mockResolvedValueOnce({ status: false });
  const plan = await service.prepare(req()),
    input = pay(plan);
  await expect(service.record(input)).rejects.toThrow('receipt is pending');
  expect((await service.record(input)).payments).toHaveLength(1);
  expect(queue.mock.calls[0][0].ticketKey).toBe(queue.mock.calls[1][0].ticketKey);
  expect(queue.mock.calls[1][0].payload.title).not.toBe('PAYMENT RECEIPT');
  expect(queue.mock.calls[1][0].payload.receiptDocument).toMatchObject({
    receipt_settled: true,
    items_total: 105,
    payment_mode: 'Cash',
  });
});
test('a live edit prevents collecting against the old totals', async () => {
  const finish = await guard.beginEdit(db, sale);
  await expect(service.prepare(req())).rejects.toMatchObject({ status: 409 });
  await finish();
  expect((await service.prepare(req())).dueMinor).toBe(10500);
});
test('releasing and recreating a bill invalidates stale confirmations', async () => {
  const original = await service.prepare(req());
  await service.release(req({ planId: original.id }));
  const next = await service.prepare(req());
  expect(next.id).not.toBe(original.id);
  await expect(service.record(pay(original))).rejects.toMatchObject({ status: 409 });
});
test('desktop can finish a partial Captain bill after collection is disabled', async () => {
  const snapshot = require('../../../src/services/guest-bill.service').snapshotFrom(
    [sale],
    { currency: '₹' },
    'T1'
  );
  const plan = await service.prepare(
    req({ revision: snapshot.revision, plan: { mode: 'equal', guests: ['A', 'B'] } })
  );
  const first = await service.record(
    pay(plan, { guest: 0, amountMinor: 5250, receivedMinor: 5250 })
  );
  await db
    .collection('branches')
    .updateOne({ _id: branch }, { $set: { 'captain_payments.enabled': false } });
  const desk = req();
  desk.captainPaymentDesktop = true;
  expect((await service.prepare(desk)).dueMinor).toBe(5250);
  const input = pay(first);
  input.captainPaymentDesktop = true;
  expect((await service.record(input)).dueMinor).toBe(0);
});
test('linked drawer totals follow guest tenders without duplicate register entries', async () => {
  await db.collection('cashregister').insertOne({
    branch_id: branch,
    license,
    register_sales: [{ sales_id: sale._id, register_amount: 105 }],
  });
  const plan = await service.prepare(req());
  const input = pay(plan);
  await service.record(input);
  await service.record(input);
  const register = await db.collection('cashregister').findOne({ branch_id: branch });
  expect(register.register_sales).toHaveLength(1);
  expect(register.register_sales[0].multi_payment).toEqual({ Cash: 105 });
});
test('version and request ID operators cannot bypass duplicate-payment protection', async () => {
  const plan = await service.prepare(req());
  for (const version of [1, { $gte: 0 }, '0', -1])
    await expect(service.record(pay(plan, { version }))).rejects.toMatchObject({ status: 409 });
  await expect(
    service.record(pay(plan, { request_id: [require('crypto').randomUUID()] }))
  ).rejects.toMatchObject({ status: 422 });
  expect(
    (await db.collection('captain_payment_plans').findOne({ _id: plan.id })).payments
  ).toHaveLength(0);
});

test.each([
  ['JPY', 0, 105],
  ['KWD', 3, 105000],
])(
  'payment journal uses %s precision and survives changed shop settings',
  async (currencyCode, currencyDigits, totalMinor) => {
    await db
      .collection('branches')
      .updateOne(
        { _id: branch },
        { $set: { currency_code: currencyCode, currency: currencyCode } }
      );
    const plan = await service.prepare(req());
    expect(plan).toMatchObject({ currencyCode, currencyDigits, dueMinor: totalMinor });
    await db
      .collection('branches')
      .updateOne({ _id: branch }, { $set: { currency_code: 'USD', currency: 'USD' } });
    const paid = await service.record(pay(plan));
    expect(paid.dueMinor).toBe(0);
    const saved = await db.collection('sales').findOne({ _id: sale._id });
    expect(saved.paid_amount).toBe(105);
  }
);

test('UPI QR requires manual verification, captures payee and retries after settings change', async () => {
  const upiPayee = { id: 'captain-test@invalid', name: 'Test Branch' };
  await db.collection('branches').updateOne(
    { _id: branch },
    {
      $set: {
        branch_upi_id: upiPayee.id,
        branch_upi_name: upiPayee.name,
      },
    }
  );
  const plan = await service.prepare(req());
  expect(plan.upiPayee).toEqual(upiPayee);
  const input = pay(plan, {
    method: 'Upi',
    upi: { ...upiPayee, verified: false },
    reference: 'test-utr',
  });
  await expect(service.record(input)).rejects.toThrow('Verify the received');
  input.body.upi.verified = true;
  const result = await service.record(input);
  expect(result.dueMinor).toBe(0);
  expect(result.payments[0].upi).toEqual({ ...upiPayee, verified: true });
  expect(result.payments[0].staff).toBe('Staff');
  expect(result.payments[0].reference).toBe('test-utr');
  await db
    .collection('branches')
    .updateOne({ _id: branch }, { $set: { branch_upi_id: 'changed@invalid' } });
  const retry = await service.record(input);
  expect(retry.payments).toHaveLength(1);
  input.body.upi.id = 'changed@invalid';
  await expect(service.record(input)).rejects.toThrow('already used');
});

test('UPI QR rejects stale receiving account and non-INR bills', async () => {
  await db.collection('branches').updateOne(
    { _id: branch },
    {
      $set: {
        branch_upi_id: 'captain-test@invalid',
        branch_upi_name: 'Test Branch',
      },
    }
  );
  const plan = await service.prepare(req());
  await expect(
    service.record(
      pay(plan, {
        method: 'Upi',
        upi: {
          id: 'other@invalid',
          name: 'Other Branch',
          verified: true,
        },
      })
    )
  ).rejects.toThrow('UPI details changed');
  await db
    .collection('captain_payment_plans')
    .updateOne({ _id: plan.id }, { $set: { 'snapshot.currencyCode': 'USD' } });
  await expect(
    service.record(pay(plan, { method: 'Upi', upi: { ...plan.upiPayee, verified: true } }))
  ).rejects.toThrow('Verify the received');
});

test('a restructure reservation cannot become a payment or be released as an empty bill', async () => {
  const locks = require('../../../src/services/captain-restructure-lock');
  const operation = await locks.reserve(
    db,
    { branchId: branch, license },
    {
      requestId: 'transfer-request-0001',
      actor: String(user),
      intent: { kind: 'transfer' },
      sales: [sale],
    }
  );
  await expect(service.prepare(req())).rejects.toMatchObject({ status: 409 });
  await expect(
    service.record(
      req({
        planId: operation._id,
        version: 0,
        request_id: 'payment-request-0001',
        guest: null,
        amountMinor: 10500,
        receivedMinor: 10500,
        method: 'Cash',
      })
    )
  ).rejects.toMatchObject({ status: 409, message: 'This order is being updated. Please retry.' });
  await expect(
    guard.mutable(db, await db.collection('sales').findOne({ _id: sale._id }))
  ).rejects.toMatchObject({ status: 409, message: 'This order is being updated. Please retry.' });
  const retained = await db.collection('captain_payment_plans').findOne({ _id: operation._id });
  expect(retained.payments).toEqual([]);
  expect(retained.stage).toBe('reserved');
  await locks.cancel(db, { branchId: branch, license }, 'transfer-request-0001', String(user));
  expect((await service.prepare(req())).dueMinor).toBe(10500);
});

test('closed transfer sources do not block collecting the next table bill', async () => {
  const closed = {
    ...sale,
    _id: new ObjectId(),
    items: [],
    sales_total: 0,
    sales_sub_total: 0,
    tax: 0,
    floor_closed_at: new Date(),
  };
  await db.collection('sales').insertOne(closed);
  const plan = await service.prepare(req());
  expect(plan.dueMinor).toBe(10500);
  await service.record(pay(plan));
  expect(await db.collection('sales').findOne({ _id: closed._id })).toEqual(closed);
  expect((await db.collection('sales').findOne({ _id: sale._id })).payment_status).toBe('Paid');
});

test('a table containing only a closed check cannot start collection', async () => {
  await db
    .collection('sales')
    .updateOne({ _id: sale._id }, { $set: { floor_closed_at: new Date() } });
  await expect(service.prepare(req())).rejects.toMatchObject({ status: 409 });
  expect(await db.collection('captain_payment_plans').countDocuments({})).toBe(0);
});

test('closure after payment snapshot cannot acquire a collection fence', async () => {
  const original = db.collection.bind(db);
  const plans = original('captain_payment_plans');
  const insert = plans.insertOne.bind(plans);
  plans.insertOne = async (...args) => {
    await original('sales').updateOne({ _id: sale._id }, { $set: { floor_closed_at: new Date() } });
    return insert(...args);
  };
  const input = req();
  input.db = { collection: (name) => (name === 'captain_payment_plans' ? plans : original(name)) };
  await expect(service.prepare(input)).rejects.toMatchObject({ status: 409 });
  expect((await original('sales').findOne({ _id: sale._id })).captain_payment_plan).toBeUndefined();
});

test.each([false, true])(
  'settlement follows POS auto-print=%s rather than the old Captain switch',
  async (enabled) => {
    const queue = require('../../../src/repositories/print-job.repository').queuePrintJob;
    queue.mockClear();
    const design = { thermal: { blocks: [] } };
    await db.collection('branches').updateOne(
      { _id: branch },
      {
        $set: {
          printall: enabled,
          'captain_payments.printReceipt': !enabled,
          receipt_designs: design,
        },
      }
    );
    const plan = await service.prepare(req());
    await service.record(pay(plan));
    expect(queue).toHaveBeenCalledTimes(enabled ? 1 : 0);
    if (enabled)
      expect(queue.mock.calls[0][0].payload.receiptDocument.receipt_designs).toEqual(design);
  }
);

test('auto-print choice is read at settlement, not when the payment screen opened', async () => {
  const queue = require('../../../src/repositories/print-job.repository').queuePrintJob;
  queue.mockClear();
  const plan = await service.prepare(req());
  await db.collection('branches').updateOne({ _id: branch }, { $set: { printall: true } });
  await service.record(pay(plan));
  expect(queue).toHaveBeenCalledTimes(1);
});

test('split settlement renders only the paid share through the branch template', async () => {
  const queue = require('../../../src/repositories/print-job.repository').queuePrintJob;
  queue.mockClear();
  await db.collection('branches').updateOne({ _id: branch }, { $set: { printall: true } });
  const snapshot = require('../../../src/services/guest-bill.service').snapshotFrom(
    [sale],
    { currency: '\u20b9' },
    'T1'
  );
  const plan = await service.prepare(
    req({ revision: snapshot.revision, plan: { mode: 'equal', guests: ['A', 'B', 'C'] } })
  );
  await service.record(pay(plan, { guest: 0, amountMinor: 3500, receivedMinor: 4000 }));
  const payload = queue.mock.calls[0][0].payload;
  expect(payload.total).toBe(35);
  expect(payload.items[0].qty).toBeCloseTo(2 / 3);
  expect(Number.isFinite(payload.items[0].rate)).toBe(true);
  expect(payload.receiptDocument.items_total).toBe(35);
  expect(payload.receiptDocument.receipt_line_rows).toEqual(payload.items);
  expect(payload.receiptDocument.receipt_tax_rows).toEqual(payload.taxes);
  expect(payload.receiptDocument).toMatchObject({ received_amount: 40, change_amount: 5 });
});

test.each([undefined, 0])(
  'legacy unpaid desktop tender does not block collection (paid_amount %s)',
  async (paid) => {
    await db.collection('sales').updateOne(
      { _id: sale._id },
      {
        $set: {
          partial_check: false,
          partial_balance: 105,
          payment_pending: 105,
          payment_mode: 'Cash',
          multi_payment: { Cash: 105 },
          ...(paid === undefined ? {} : { paid_amount: paid }),
        },
      }
    );
    const bill = await require('../../../src/services/captain-bill').read({
      ...req(),
      query: { table: 'T1' },
    });
    expect(bill.paidMinor).toBe(0);
    expect(bill.dueMinor).toBe(10500);
    const plan = await service.prepare(req());
    expect(plan.dueMinor).toBe(10500);
    const result = await service.record(pay(plan, { method: 'Card' }));
    expect(result.dueMinor).toBe(0);
    const saved = await db.collection('sales').findOne({ _id: sale._id });
    expect(saved.multi_payment).toEqual({ Card: 105 });
    expect(saved.items).toEqual(sale.items);
  }
);

test.each([
  { paid_amount: 10, partial_check: false, partial_balance: 105, payment_pending: 105 },
  { partial_check: true, partial_balance: 10, payment_pending: 95 },
  { partial_check: false, partial_balance: 10, payment_pending: 95 },
])('existing payment evidence still blocks a new full collection: %j', async (fields) => {
  await db.collection('sales').updateOne({ _id: sale._id }, { $set: fields });
  await expect(service.prepare(req())).rejects.toMatchObject({ status: 409 });
  expect(await db.collection('captain_payment_plans').countDocuments()).toBe(0);
});

test('desktop and captain both honor the master disabled methods', async () => {
  await db
    .collection('branches')
    .updateOne({ _id: branch }, { $set: { payment_methods_initialized: true } });
  await db.collection('payment_method').insertMany([
    { branch_id: branch, license, payment_field: 'Cash', enabled: false },
    { branch_id: branch, license, payment_field: 'Card', enabled: true },
    { branch_id: branch, license, payment_field: 'Upi', enabled: false },
  ]);
  expect((await service.scope(req())).options.methods).toEqual(['Card']);
  expect((await service.scope({ ...req(), captainPaymentDesktop: true })).options.methods).toEqual([
    'Card',
  ]);
  const plan = await service.prepare(req());
  await expect(service.record(pay(plan))).rejects.toThrow();
});
