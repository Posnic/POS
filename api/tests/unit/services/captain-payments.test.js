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
  await db
    .collection('branches')
    .updateOne({ _id: branch }, { $set: { 'captain_payments.printReceipt': true } });
  const queue = require('../../../src/repositories/print-job.repository').queuePrintJob;
  queue.mockClear();
  queue.mockResolvedValueOnce({ status: false });
  const plan = await service.prepare(req()),
    input = pay(plan);
  await expect(service.record(input)).rejects.toThrow('receipt is pending');
  expect((await service.record(input)).payments).toHaveLength(1);
  expect(queue.mock.calls[0][0].ticketKey).toBe(queue.mock.calls[1][0].ticketKey);
  expect(queue.mock.calls[1][0].payload.title).toBe('PAYMENT RECEIPT');
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
