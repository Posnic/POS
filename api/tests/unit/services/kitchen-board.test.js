'use strict';
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
const service = require('../../../src/services/kitchen-board');
const { rounds } = require('../../../src/helpers/kitchen-rounds');
function lineAction(operation, quantity, revision, actor, actionId = 'line-action-123456') {
  const req = action({ operation, quantity, revision, itemId: 'c0i0', actionId });
  if (actor) req.user._id = actor;
  return req;
}
test('partial readiness, collection ownership, serving and retries coordinate quantities', async () => {
  const picker = new ObjectId(),
    other = new ObjectId();
  let out = await service.transition(lineAction('ready', 1, 0));
  expect(out.ticket).toMatchObject({ state: 'preparing', revision: 1 });
  expect(out.ticket.items[0]).toMatchObject({ ready: 1, collected: 0, served: 0, readyVersion: 1 });
  expect((await service.captainList(request())).tickets).toHaveLength(1);
  const pickup = lineAction('collect', 1, 1, picker, 'pickup-action-12345');
  out = await service.captainAction(pickup);
  expect(out.ticket.items[0].collector).toBe(String(picker));
  expect((await service.captainAction(pickup)).ticket.revision).toBe(2);
  await expect(service.captainAction(lineAction('serve', 1, 2, other))).rejects.toMatchObject({
    status: 409,
  });
  await expect(service.transition(lineAction('ready', 0, 2))).rejects.toMatchObject({
    status: 409,
  });
  out = await service.captainAction(lineAction('serve', 1, 2, picker, 'served-action-12345'));
  expect(out.ticket.items[0]).toMatchObject({ qty: 1, served: 1, collected: 1 });
  expect((await service.captainList(request())).tickets).toEqual([]);
  out = await service.transition(lineAction('ready', 2, 3));
  expect(out.ticket.items[0].readyVersion).toBe(2);
  await service.captainAction(lineAction('collect', 2, 4, other, 'pickup-second-12345'));
  const served = lineAction('serve', 2, 5, other, 'served-second-12345');
  expect((await service.captainAction(served)).ticket).toBeNull();
  expect((await service.captainAction(served)).ticket).toBeNull();
  expect((await service.list(request())).tickets).toEqual([]);
});
test('concurrent Captains cannot collect the same quantity', async () => {
  await service.transition(lineAction('ready', 2, 0));
  const results = await Promise.allSettled([
    service.captainAction(lineAction('collect', 1, 1, new ObjectId(), 'collect-first-12345')),
    service.captainAction(lineAction('collect', 1, 1, new ObjectId(), 'collect-other-12345')),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  await expect(
    service.captainAction(lineAction('collect', 2, 2, new ObjectId()))
  ).rejects.toMatchObject({ status: 409 });
});
test('round ownership follows each ordering Captain, with shared fallback for legacy rounds', async () => {
  const sale = await db.collection('sales').findOne({ _id: saleId });
  expect(service.project(sale)[0].owner).toBe('');
  sale.changes[0].kitchen_actor = { id: 'captain-a', name: 'Arun' };
  sale.items[0].item_quantity = 3;
  sale.changes.push({
    timestamp: new Date(),
    kitchen_actor: { id: 'captain-b', name: 'Bala' },
    items: [{ item_id: 'rice', item_name: 'Rice', item_quantity: 1, process: 'add' }],
  });
  expect(service.project(sale).map((t) => t.owner)).toEqual(['captain-a', 'captain-b']);
});
test('Captain cannot mark kitchen readiness or collect more than is ready', async () => {
  await expect(service.captainAction(lineAction('ready', 1, 0))).rejects.toMatchObject({
    status: 400,
  });
  await expect(service.captainAction(lineAction('collect', 1, 0))).rejects.toMatchObject({
    status: 409,
  });
  await service.transition(lineAction('ready', 1, 0));
  await expect(service.captainAction(lineAction('collect', 2, 1))).rejects.toMatchObject({
    status: 409,
  });
  await db
    .collection('branches')
    .updateOne({ _id: branch }, { $set: { module_captain_enable: false } });
  await expect(service.captainList(request())).rejects.toMatchObject({ status: 403 });
});
let memory, db, branch, license, saleId, userId;
beforeAll(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  db = mongoose.connection.db;
}, 60000);
afterAll(async () => {
  await mongoose.disconnect();
  await memory?.stop();
});
beforeEach(async () => {
  await db.dropDatabase();
  branch = new ObjectId();
  license = new ObjectId();
  saleId = new ObjectId();
  userId = new ObjectId();
  await db.collection('branches').insertOne({ _id: branch, license, branch_name: 'Kitchen test' });
  await db.collection('sales').insertOne({
    _id: saleId,
    branch_id: branch,
    license,
    sale_process: 'KOT',
    payment_status: 'Unpaid',
    created_date: new Date(),
    table_number: '6',
    items: [
      {
        item_id: 'rice',
        item_name: 'Rice',
        item_quantity: 2,
        item_description: 'Marketing only',
      },
    ],
    changes: [
      {
        timestamp: new Date(),
        items: [
          {
            item_id: 'rice',
            item_name: 'Rice',
            item_quantity: 2,
            process: 'add',
            item_note: 'No chilli',
            item_description: 'Marketing only',
          },
        ],
      },
    ],
  });
});
function request(body = {}) {
  return {
    db,
    user: { _id: userId, role: 'manager' },
    tenantContext: { branchId: String(branch), licenseId: String(license) },
    body,
  };
}
function action(extra = {}) {
  return request({
    saleId: String(saleId),
    roundId: 'c0',
    state: 'preparing',
    revision: 0,
    actionId: 'first-action-123456',
    ...extra,
  });
}
test('counter sales never appear, even before payment; explicit walk-in KOTs still appear', async () => {
  const sales = db.collection('sales');
  const base = await sales.findOne({ _id: saleId });
  const counterId = new ObjectId();
  await sales.insertOne({
    ...base,
    _id: counterId,
    table_number: '',
    sale_process: 'Add',
    payment_status: 'Unpaid',
    changes: [],
    items: [{ item_id: 'coke', item_name: 'Coke', item_quantity: 1 }],
  });
  expect((await service.list(request())).tickets.map((t) => t.saleId)).toEqual([String(saleId)]);
  await expect(
    service.transition(action({ saleId: String(counterId), roundId: 'legacy' }))
  ).rejects.toMatchObject({ status: 409 });
  await sales.updateOne({ _id: counterId }, { $set: { payment_status: 'Paid' } });
  expect((await service.list(request())).tickets.map((t) => t.saleId)).toEqual([String(saleId)]);
  await sales.updateOne({ _id: saleId }, { $set: { table_number: '' } });
  expect((await service.list(request())).tickets[0]).toMatchObject({
    saleId: String(saleId),
    table: '',
  });
});
test('scopes reads and writes to branch/license and requires sales authority', async () => {
  expect((await service.list(request())).tickets).toHaveLength(1);
  const denied = request();
  denied.user.role = 'viewer';
  await expect(service.list(denied)).rejects.toMatchObject({ status: 403 });
  const other = new ObjectId();
  await db.collection('branches').insertOne({ _id: other, license });
  const foreign = action();
  foreign.tenantContext.branchId = String(other);
  expect((await service.list(foreign)).tickets).toEqual([]);
  await expect(service.transition(foreign)).rejects.toMatchObject({ status: 409 });
  foreign.tenantContext.licenseId = String(new ObjectId());
  await expect(service.list(foreign)).rejects.toMatchObject({ status: 403 });
});
test('persists stages, idempotent retry, undo and revision conflicts', async () => {
  const started = await service.transition(action());
  expect(started.ticket.state).toBe('preparing');
  expect((await service.transition(action())).ticket.revision).toBe(1);
  await expect(
    service.transition(action({ actionId: 'different-action-123' }))
  ).rejects.toMatchObject({ status: 409 });
  expect(
    (
      await service.transition(
        action({ state: 'ready', revision: 1, actionId: 'ready-action-12345' })
      )
    ).ticket.state
  ).toBe('ready');
  expect((await service.list(request())).tickets[0].state).toBe('ready');
  expect(
    (
      await service.transition(
        action({ state: 'preparing', revision: 2, actionId: 'undo-action-123456' })
      )
    ).ticket.revision
  ).toBe(3);
});
test('simultaneous screens cannot both advance the same revision', async () => {
  const results = await Promise.allSettled([
    service.transition(action()),
    service.transition(action({ actionId: 'second-action-12345' })),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect((await service.list(request())).tickets[0].revision).toBe(1);
});
test('serving, cancellation, new rounds and billing reconcile without merging rounds', async () => {
  await service.transition(action());
  await db
    .collection('sales')
    .updateOne(
      { _id: saleId },
      { $set: { 'kitchen_service.c0i0': { quantity: 1 }, bill_requested_at: new Date() } }
    );
  expect((await service.list(request())).tickets).toEqual([]);
  await db.collection('sales').updateOne(
    { _id: saleId },
    {
      $set: { 'kitchen_service.c0i0.quantity': 2 },
      $push: {
        items: { item_id: 'tea', item_name: 'Tea', item_quantity: 1 },
        changes: {
          timestamp: new Date(Date.now() + 1000),
          items: [{ item_id: 'tea', item_name: 'Tea', item_quantity: 1, process: 'add' }],
        },
      },
    }
  );
  const tickets = (await service.list(request())).tickets;
  expect(tickets).toHaveLength(1);
  expect(tickets[0]).toMatchObject({ roundId: 'c1', state: 'new' });
  await expect(service.transition(action({ revision: 1, state: 'ready' }))).rejects.toMatchObject({
    status: 409,
  });
  await db.collection('sales').updateOne({ _id: saleId }, { $set: { order_state: 'cancelled' } });
  expect((await service.list(request())).tickets).toEqual([]);
});
test('marketing descriptions stay hidden without changing legacy served identities', async () => {
  await db.collection('sales').updateOne({ _id: saleId }, { $unset: { changes: '' } });
  const sale = await db.collection('sales').findOne({ _id: saleId }),
    id = rounds(sale)[0].items[0].id;
  const ticket = service.project(sale)[0];
  expect(ticket.items[0]).toMatchObject({ id, note: '' });
  expect(JSON.stringify(ticket)).not.toContain('Marketing only');
  expect(service.project({ ...sale, kitchen_service: { [id]: { quantity: 2 } } })).toEqual([]);
});
test('invalid and skipped transitions do not change an order', async () => {
  await expect(service.transition(action({ saleId: {} }))).rejects.toMatchObject({ status: 400 });
  await expect(service.transition(action({ state: 'ready' }))).rejects.toMatchObject({
    status: 409,
  });
  expect((await service.list(request())).tickets[0].state).toBe('new');
});

test('settlement removes tracked and legacy kitchen tickets without marking items served', async () => {
  await db
    .collection('sales')
    .updateOne({ _id: saleId }, { $set: { payment_status: 'Paid', kitchen_required: true } });
  expect((await service.list(request())).tickets).toHaveLength(0);
  expect((await db.collection('sales').findOne({ _id: saleId })).kitchen_service).toBeUndefined();
});

test('bill request removes a tracked order from the touch board', async () => {
  await db
    .collection('sales')
    .updateOne(
      { _id: saleId },
      { $set: { kitchen_required: true, bill_requested_at: new Date(Date.now() + 1000) } }
    );
  expect((await service.list(request())).tickets).toHaveLength(0);
});

test('reloaded service recovers partial work and rejects another shop without changing it', async () => {
  await service.transition(lineAction('ready', 1, 0));
  const pickup = lineAction('collect', 1, 1, undefined, 'restart-pickup-12345');
  await service.captainAction(pickup);
  jest.resetModules();
  const recovered = require('../../../src/services/kitchen-board');
  expect((await recovered.captainList(request())).tickets[0].items[0]).toMatchObject({
    ready: 1,
    collected: 1,
    served: 0,
  });
  expect((await recovered.captainAction(pickup)).ticket.revision).toBe(2);
  const foreign = request();
  foreign.tenantContext.licenseId = String(new ObjectId());
  await expect(recovered.captainList(foreign)).rejects.toMatchObject({ status: 403 });
});

async function managerRequest() {
  await db
    .collection('users')
    .insertOne({ _id: userId, license, activate: true, role: 'manager', branch_id: branch });
  return { ...request(), headers: {}, body: { name: 'Kitchen pass' } };
}
test('manager pairing is single-use, restricted to its branch and immediately revocable', async () => {
  const devices = require('../../../src/services/kitchen-devices');
  const manager = await managerRequest();
  const code = await devices.create(manager);
  const paired = await devices.pair({ ...manager, body: { code: code.code } });
  await expect(devices.pair({ ...manager, body: { code: code.code } })).rejects.toMatchObject({
    status: 401,
  });
  const screen = { db, headers: { 'x-kitchen-device': paired.token } };
  await devices.authenticate(screen);
  expect(screen.kitchenDevice).toBe(true);
  expect(screen.user.access).toEqual({ sales: { write: true } });
  expect(String(screen.tenantContext.branchId)).toBe(String(branch));
  expect((await service.list(screen)).tickets).toHaveLength(1);
  expect((await service.transition({ ...screen, body: action().body })).ticket.state).toBe(
    'preparing'
  );
  await expect(devices.create({ ...screen, body: { name: 'another' } })).rejects.toMatchObject({
    status: 403,
  });
  const list = await devices.list(manager);
  expect(JSON.stringify(list)).not.toContain(paired.token);
  await devices.revoke({ ...manager, body: { id: list.devices[0].id } });
  await expect(devices.authenticate(screen)).rejects.toMatchObject({ status: 401 });
});
test('expired codes, disabled authorizers and foreign managers cannot keep a device connected', async () => {
  const devices = require('../../../src/services/kitchen-devices');
  const manager = await managerRequest();
  const expired = await devices.create(manager);
  await db.collection('kitchen_device_codes').updateMany({}, { $set: { expires: new Date(0) } });
  await expect(devices.pair({ ...manager, body: { code: expired.code } })).rejects.toMatchObject({
    status: 401,
  });
  const code = await devices.create(manager);
  const paired = await devices.pair({ ...manager, body: { code: code.code } });
  await db.collection('users').updateOne({ _id: userId }, { $set: { activate: false } });
  await expect(
    devices.authenticate({ db, headers: { 'x-kitchen-device': paired.token } })
  ).rejects.toMatchObject({ status: 401 });
});

test('branch delay settings validate thresholds and require manager access', async () => {
  const req = { ...request(), body: { orangeMinutes: 7, redMinutes: 15, pulse: false } };
  await service.saveSettings(req);
  expect((await service.list(request())).settings).toEqual(req.body);
  await expect(
    service.saveSettings({ ...req, body: { orangeMinutes: 10, redMinutes: 5, pulse: true } })
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    service.saveSettings({ ...req, user: { _id: userId, access: { sales: { write: true } } } })
  ).rejects.toMatchObject({ status: 403 });
});

test('paid takeaway remains actionable on touch board until served', async () => {
  await db.collection('sales').updateOne(
    { _id: saleId },
    {
      $set: {
        fulfilment: 'takeaway',
        kitchen_required: true,
        payment_status: 'Paid',
        bill_requested_at: new Date(Date.now() + 1000),
      },
    }
  );
  expect((await service.list(request())).tickets).toHaveLength(1);
  await service.transition(action());
  await service.transition(lineAction('ready', 2, 1));
  await service.captainAction(lineAction('collect', 2, 2, undefined, 'takeaway-collect-12345'));
  await service.captainAction(lineAction('serve', 2, 3, undefined, 'takeaway-serve-12345'));
  expect((await service.list(request())).tickets).toHaveLength(0);
});

test('restructuring blocks kitchen updates until cancellation, while ordinary billing permits service', async () => {
  const locks = require('../../../src/services/captain-restructure-lock');
  const scope = { branchId: branch, license };
  const sale = await db.collection('sales').findOne({ _id: saleId });
  const requestId = 'kitchen-restructure-1';
  await locks.reserve(db, scope, {
    requestId,
    actor: String(userId),
    intent: { kind: 'transfer' },
    sales: [sale],
  });
  await expect(service.transition(lineAction('ready', 1, 0))).rejects.toMatchObject({
    status: 409,
  });
  expect((await db.collection('sales').findOne({ _id: saleId })).kitchen_work).toBeUndefined();
  await locks.cancel(db, scope, requestId, String(userId));
  await db
    .collection('sales')
    .updateOne({ _id: saleId }, { $set: { captain_payment_plan: 'ordinary-payment-plan' } });
  expect((await service.transition(lineAction('ready', 1, 0))).ticket.items[0].ready).toBe(1);
});

test('a kitchen update between transfer preview and reservation invalidates that reservation', async () => {
  const locks = require('../../../src/services/captain-restructure-lock');
  const sale = await db.collection('sales').findOne({ _id: saleId });
  await service.transition(lineAction('ready', 1, 0));
  await expect(
    locks.reserve(
      db,
      { branchId: branch, license },
      {
        requestId: 'kitchen-stale-preview',
        actor: String(userId),
        intent: { kind: 'transfer' },
        sales: [sale],
      }
    )
  ).rejects.toMatchObject({ status: 409 });
  const current = await db.collection('sales').findOne({ _id: saleId });
  expect(current.captain_payment_plan).toBeUndefined();
  expect(current.kitchen_work.c0.lines.c0i0.ready).toBe(1);
});
