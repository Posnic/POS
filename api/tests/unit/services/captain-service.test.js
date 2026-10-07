'use strict';
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
const service = require('../../../src/services/captain-service');
const policy = require('../../../src/services/captain-edit-policy');
const { signApproval } = require('../../../src/utils/approval-token.util');
let mem, db, branch, license, actor, sale, other;
beforeAll(async () => {
  mem = await MongoMemoryServer.create();
  await mongoose.connect(mem.getUri('captain-service'));
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
  actor = new ObjectId();
  other = new ObjectId();
  await db.collection('branches').insertOne({ _id: branch, license });
  await db.collection('users').insertMany(
    [actor, other].map((id, index) => ({
      _id: id,
      license,
      branch_id: branch,
      activate: true,
      name: 'Staff ' + index,
      access: { sales: { write: true } },
    }))
  );
  const line = {
    item_id: new ObjectId().toString(),
    line_id: 'dessert',
    item_name: 'Pudding',
    item_quantity: 2,
    item_price: 50,
    held: true,
    seat: 2,
    course: 'Dessert',
    allergies: ['milk'],
  };
  sale = {
    _id: new ObjectId(),
    license,
    branch_id: branch,
    sale_process: 'KOT',
    payment_status: 'Unpaid',
    client: { staff_id: String(actor) },
    items: [line],
    changes: [{ timestamp: new Date(), items: [{ ...line, process: 'add' }] }],
  };
  await db.collection('sales').insertOne(sale);
});
const req = (body) => ({
  db,
  tenantContext: { branchId: branch, licenseId: license },
  user: {
    _id: actor,
    name: 'Staff 0',
    access: { sales: { write: true }, pos: { void_sale: false, discount_apply: false } },
  },
  body: { saleId: String(sale._id), branchId: String(branch), ...body },
});

test('legacy desktop additions retain Captain identity and do not request void approval', async () => {
  sale.items[0].line_id = 'phone-line-1';
  await db.collection('sales').updateOne({ _id: sale._id }, { $set: { items: sale.items } });
  const input = req({
    order_id: String(sale._id),
    items: [
      { product_id: sale.items[0].item_id, quantity: 3 },
      { product_id: String(new ObjectId()), quantity: 1 },
    ],
  });
  await expect(policy.authorize(input)).resolves.toMatchObject({ reason: '' });
  expect(input.body.items[0].line_id).toBe('phone-line-1');
});

test('legacy desktop quantity reductions require permission even without an optional reason', async () => {
  sale.items[0].line_id = 'phone-line-1';
  await db.collection('sales').updateOne({ _id: sale._id }, { $set: { items: sale.items } });
  const input = req({
    order_id: String(sale._id),
    items: [{ product_id: sale.items[0].item_id, quantity: 1 }],
  });
  await expect(policy.authorize(input)).rejects.toThrow('Manager approval required');
  input.body.change_reason = 'Customer changed the order';
  await expect(policy.authorize(input)).rejects.toThrow('Manager approval required');
});
test('fire is idempotent under retries and preserves bill quantity and service identity', async () => {
  const input = req({ requestId: require('crypto').randomUUID(), items: ['c0i0'] });
  const first = await service.fire(input);
  const second = await service.fire(input);
  expect(first).toEqual(second);
  expect(first[0].items[0]).toMatchObject({
    id: 'c0i0',
    quantity: 2,
    held: false,
    allergies: ['milk'],
  });
  const saved = await db.collection('sales').findOne({ _id: sale._id });
  expect(saved.items).toHaveLength(1);
  expect(saved.items[0].item_quantity).toBe(2);
  expect(saved.changes).toHaveLength(2);
});
test('a request cannot fire another branch or an unknown line', async () => {
  await expect(
    service.fire(
      req({
        branchId: String(new ObjectId()),
        items: ['c0i0'],
        requestId: require('crypto').randomUUID(),
      })
    )
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    service.fire(req({ items: ['c99i0'], requestId: require('crypto').randomUUID() }))
  ).rejects.toMatchObject({ status: 409 });
});
test('handover validates branch and permission and retains original author', async () => {
  const input = req({ staffId: String(other), requestId: require('crypto').randomUUID() });
  await service.handover(input);
  await service.handover(input);
  const saved = await db.collection('sales').findOne({ _id: sale._id });
  expect(saved.assigned_staff.id).toBe(String(other));
  expect(saved.client.staff_id).toBe(String(actor));
  expect(saved.captain_audit).toHaveLength(1);
  const unauthorized = req({ staffId: String(actor), requestId: require('crypto').randomUUID() });
  await expect(service.handover(unauthorized)).rejects.toMatchObject({ status: 403 });
});
test('cancellation accepts an optional reason but requires a manager proof bound to this order and actor', async () => {
  const input = req({
    order_id: String(sale._id),
    items: [{ ...sale.items[0], item_quantity: 1 }],
  });
  await expect(policy.authorize(input)).rejects.toThrow('Manager approval required');
  input.body.change_reason = 'Guest changed their mind';
  await expect(policy.authorize(input)).rejects.toThrow('Manager approval required: cancellation');
  input.body.approval_token = signApproval({
    action: 'void_sale',
    cashier_user_id: String(actor),
    entity_id: String(new ObjectId()),
    approved_by_user_id: String(other),
  });
  await expect(policy.authorize(input)).rejects.toThrow('Manager approval required');
  input.body.approval_token = signApproval({
    action: 'void_sale',
    cashier_user_id: String(actor),
    entity_id: String(sale._id),
    approved_by_user_id: String(other),
  });
  expect(await policy.authorize(input)).toMatchObject({
    actor: { id: String(actor) },
    reason: 'Guest changed their mind',
    approvedBy: [String(other)],
  });
});
const delivery = require('../../../src/services/kitchen-delivery');
test('delivery status distinguishes printer acceptance from display rendering and isolates branches', async () => {
  const input = req({
    key: 'ticket-1',
    printers: [{ name: 'Kitchen', copy: 1, state: 'accepted' }],
    at: new Date().toISOString(),
    till: 'Till 1',
  });
  await delivery.report(input);
  await delivery.displayReport(
    req({ saleIds: [String(sale._id)], screens: ['screen-1'], till: 'Till 1' })
  );
  const read = req({});
  read.query = { saleId: String(sale._id) };
  const state = await delivery.status(read);
  expect(state.reports[0].printers[0].state).toBe('accepted');
  expect(state.displays[0]).toMatchObject({ recent: true, till: 'Till 1' });
  await delivery.displayReport(req({ saleIds: [], screens: ['screen-1'], till: 'Till 1' }));
  expect((await delivery.status(read)).displays).toEqual([]);
  read.query.saleId = String(new ObjectId());
  await expect(delivery.status(read)).rejects.toMatchObject({ status: 404 });
});

test('kitchen board hides held food and carries seat and allergy details after firing', async () => {
  const board = require('../../../src/services/kitchen-board');
  expect(board.project(sale)).toEqual([]);
  await service.fire(req({ requestId: require('crypto').randomUUID(), items: ['c0i0'] }));
  const after = await db.collection('sales').findOne({ _id: sale._id });
  expect(after.kitchen_closed).toBe(false);
  expect(board.project(after)[0].items[0]).toMatchObject({
    seat: 2,
    course: 'Dessert',
    allergies: ['milk'],
  });
  expect(board.project(after)[0].placedAt).toBe(after.changes[1].timestamp.toISOString());
});

test('simultaneous handover retries create one assignment and one audit entry', async () => {
  const input = req({ staffId: String(other), requestId: require('crypto').randomUUID() });
  const results = await Promise.all([service.handover(input), service.handover(input)]);
  expect(results[0]).toEqual(results[1]);
  const saved = await db.collection('sales').findOne({ _id: sale._id });
  expect(saved.captain_audit).toHaveLength(1);
});

test('a handover request ID cannot be reused with a different recipient or actor', async () => {
  const input = req({ staffId: String(other), requestId: require('crypto').randomUUID() });
  await service.handover(input);
  await expect(
    service.handover(req({ ...input.body, staffId: String(actor) }))
  ).rejects.toMatchObject({ status: 409 });
  const differentActor = req(input.body);
  differentActor.user._id = other;
  await expect(service.handover(differentActor)).rejects.toMatchObject({ status: 409 });
  const saved = await db.collection('sales').findOne({ _id: sale._id });
  expect(saved.assigned_staff.id).toBe(String(other));
  expect(saved.captain_audit).toHaveLength(1);
});

test('a delayed retry cannot report success for an assignment superseded by a later handover', async () => {
  const input = req({ staffId: String(other), requestId: require('crypto').randomUUID() });
  await service.handover(input);
  const returnToOriginal = req({
    staffId: String(actor),
    requestId: require('crypto').randomUUID(),
  });
  returnToOriginal.user._id = other;
  await service.handover(returnToOriginal);
  await expect(service.handover(input)).rejects.toMatchObject({ status: 409 });
  const saved = await db.collection('sales').findOne({ _id: sale._id });
  expect(saved.assigned_staff.id).toBe(String(actor));
  expect(saved.captain_audit).toHaveLength(2);
});

test('staff search data includes email without exposing user permissions', async () => {
  await db
    .collection('users')
    .updateOne({ _id: other }, { $set: { username: 'captain@example.com' } });
  const results = await service.staff(req({}));
  expect(results.find((user) => user.id === String(other))).toEqual({
    id: String(other),
    name: 'Staff 1',
    username: 'captain@example.com',
  });
});
