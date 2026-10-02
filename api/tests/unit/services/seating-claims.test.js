'use strict';
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
const seating = require('../../../src/services/seating-claims');
// Load the repository before timed race tests: coverage instrumentation of its
// dependency graph must not consume the five-second database assertion budget.
const saleRepository = require('../../../src/repositories/sale.repository');
let server, db, scope, ids;
beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri('seating-claims'));
  db = mongoose.connection.db;
}, 60000);
afterAll(async () => {
  try {
    await mongoose.disconnect();
  } finally {
    await server?.stop();
  }
  // Database process shutdown can exceed Jest's five-second default under
  // coverage load. Keep the same bounded allowance as database startup.
}, 60000);
beforeEach(async () => {
  await db.dropDatabase();
  scope = { branchId: new ObjectId(), license: new ObjectId() };
  ids = [new ObjectId(), new ObjectId(), new ObjectId()].map(String);
  await db.collection('tableorder').insertMany(
    ids.map((id, index) => ({
      _id: new ObjectId(id),
      branch_id: scope.branchId,
      license: scope.license,
      tableorder_value: `T${index + 1}`,
      capacity: 2,
      max_capacity: 3,
      adjacent_table_ids: ids[index + 1] ? [ids[index + 1]] : [],
    }))
  );
});
const request = (overrides = {}) => ({
  request_id: 'seating-request-0001',
  table_ids: ids.slice(0, 2),
  primary_id: ids[0],
  actor: 'staff-1',
  guests: 4,
  ...overrides,
});
test('connected neighbouring chains combine capacities regardless of configuration direction', async () => {
  const result = await seating.reserve(
    db,
    scope,
    request({ table_ids: ids, primary_id: ids[2], guests: 8 })
  );
  expect(result.capacity).toBe(6);
  expect(result.max_capacity).toBe(9);
  expect(result.tables).toEqual([...ids].sort());
});
test('overlapping multi-table claims have exactly one winner under concurrency', async () => {
  const results = await Promise.allSettled([
    seating.reserve(db, scope, request()),
    seating.reserve(
      db,
      scope,
      request({ request_id: 'seating-request-0002', table_ids: ids.slice(1), primary_id: ids[1] })
    ),
  ]);
  expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
  expect(await seating.read(db, scope)).toHaveLength(1);
});
test('lost-response retry is idempotent but cannot change party or ownership', async () => {
  const first = await seating.reserve(db, scope, request());
  expect(await seating.reserve(db, scope, request())).toEqual(first);
  await expect(seating.reserve(db, scope, request({ guests: 3 }))).rejects.toThrow(
    'already been used'
  );
  await expect(seating.reserve(db, scope, request({ actor: 'staff-2' }))).rejects.toThrow(
    'already been used'
  );
});
test('cancel releases the whole group but its old request cannot resurrect it', async () => {
  await seating.reserve(db, scope, request());
  await seating.cancel(db, scope, request().request_id, 'staff-1');
  await seating.cancel(db, scope, request().request_id, 'staff-1');
  await expect(seating.reserve(db, scope, request())).rejects.toThrow('already been used');
  await expect(
    seating.reserve(db, scope, request({ request_id: 'seating-request-0002' }))
  ).resolves.toMatchObject({ state: 'reserved' });
});
test('binding a sale survives retry and cannot be cancelled or rebound', async () => {
  await seating.reserve(db, scope, request());
  const sale = String(new ObjectId());
  await seating.bind(db, scope, request().request_id, 'staff-1', sale);
  await seating.bind(db, scope, request().request_id, 'staff-1', sale);
  await expect(seating.cancel(db, scope, request().request_id, 'staff-1')).rejects.toThrow(
    'Reconcile'
  );
  await expect(
    seating.bind(db, scope, request().request_id, 'staff-1', String(new ObjectId()))
  ).rejects.toThrow('Table changed');
  expect((await seating.read(db, scope))[0].order_id).toBe(sale);
});
test('different branches cannot reserve or release these tables', async () => {
  await expect(
    seating.reserve(db, { ...scope, branchId: new ObjectId() }, request())
  ).rejects.toThrow('this branch');
  await seating.reserve(db, scope, request());
  await expect(seating.cancel(db, scope, request().request_id, 'staff-2')).rejects.toThrow(
    'Permission'
  );
  expect((await seating.read(db, scope))[0].state).toBe('reserved');
});
test('disconnected, undersized, unknown-capacity and occupied groups are rejected', async () => {
  await expect(
    seating.reserve(db, scope, request({ table_ids: [ids[0], ids[2]] }))
  ).rejects.toThrow('neighbouring');
  await expect(seating.reserve(db, scope, request({ guests: 7 }))).rejects.toThrow('enough seats');
  await db
    .collection('tableorder')
    .updateOne({ _id: new ObjectId(ids[0]) }, { $set: { capacity: 0, max_capacity: 0 } });
  await expect(seating.reserve(db, scope, request())).rejects.toThrow('capacity');
  await db
    .collection('tableorder')
    .updateOne({ _id: new ObjectId(ids[0]) }, { $set: { capacity: 2, max_capacity: 3 } });
  await db.collection('sales').insertOne({
    branch_id: scope.branchId,
    license: scope.license,
    table_number: 'T2',
    sale_process: 'KOT',
    payment_status: 'Unpaid',
  });
  await expect(seating.reserve(db, scope, request())).rejects.toThrow('open order');
  expect(await seating.read(db, scope)).toEqual([]);
});
test('single-table and combined requests compete for the same seating claim', async () => {
  await seating.reserve(db, scope, request({ table_ids: [ids[1]], primary_id: ids[1], guests: 2 }));
  await expect(
    seating.reserve(db, scope, request({ request_id: 'seating-request-0002' }))
  ).rejects.toThrow('Table changed');
});
test('a simultaneous cancellation cannot release a claim bound to a sale', async () => {
  await seating.reserve(db, scope, request());
  const results = await Promise.allSettled([
    seating.bind(db, scope, request().request_id, 'staff-1', String(new ObjectId())),
    seating.cancel(db, scope, request().request_id, 'staff-1'),
  ]);
  expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
  const claim = await seating.find(db, scope, request().request_id);
  expect(['submitting', 'cancelled']).toContain(claim.state);
  if (claim.state === 'submitting') expect(claim.order_id).toBeTruthy();
});
test('held and cleaning tables cannot enter a seating group', async () => {
  for (const state of ['held', 'cleaning']) {
    await db
      .collection('tableorder')
      .updateOne({ _id: new ObjectId(ids[1]) }, { $set: { service_state: state } });
    await expect(seating.reserve(db, scope, request())).rejects.toThrow('not available');
  }
  expect(await seating.read(db, scope)).toEqual([]);
});

test('closed sale releases every member for cleaning and archives the retry record', async () => {
  const claim = await seating.reserve(db, scope, request());
  const saleId = new ObjectId();
  await seating.bind(db, scope, claim.id, 'staff-1', String(saleId));
  await db.collection('sales').insertOne({
    _id: saleId,
    branch_id: scope.branchId,
    license: scope.license,
    payment_status: 'Paid',
    floor_closed_at: new Date(),
    items: [{ name: 'Dish', qty: 2 }],
  });
  await seating.release(db, scope, claim.id);
  expect(await seating.read(db, scope)).toEqual([]);
  expect((await seating.find(db, scope, claim.id)).state).toBe('released');
  const tables = await db
    .collection('tableorder')
    .find({ _id: { $in: claim.tables.map((id) => new ObjectId(id)) } })
    .toArray();
  expect(tables.every((table) => table.service_state === 'cleaning')).toBe(true);
  await db.collection('tableorder').updateMany({}, { $set: { service_state: 'available' } });
  await seating.release(db, scope, claim.id);
  expect(await db.collection('tableorder').countDocuments({ service_state: 'cleaning' })).toBe(0);
  await expect(seating.reserve(db, scope, request())).rejects.toThrow('already been used');
  expect((await db.collection('sales').findOne({ _id: saleId })).items).toEqual([
    { name: 'Dish', qty: 2 },
  ]);
});
test('paid alone, missing sale and other-branch sale cannot release the claim', async () => {
  const claim = await seating.reserve(db, scope, request());
  const saleId = new ObjectId();
  await seating.bind(db, scope, claim.id, 'staff-1', String(saleId));
  await expect(seating.release(db, scope, claim.id)).rejects.toThrow('Close the order');
  await db.collection('sales').insertOne({
    _id: saleId,
    branch_id: scope.branchId,
    license: scope.license,
    payment_status: 'Paid',
  });
  await expect(seating.release(db, scope, claim.id)).rejects.toThrow('Close the order');
  await db
    .collection('sales')
    .updateOne(
      { _id: saleId },
      { $set: { branch_id: new ObjectId(), floor_closed_at: new Date() } }
    );
  await expect(seating.release(db, scope, claim.id)).rejects.toThrow('Close the order');
  expect((await seating.read(db, scope))[0].state).toBe('submitting');
});
test('interrupted archival keeps a terminal claim recoverable without accumulating branch history', async () => {
  const claim = await seating.reserve(db, scope, request());
  const collection = db.collection('table_seating_history');
  const original = db.collection.bind(db);
  const spy = jest
    .spyOn(db, 'collection')
    .mockImplementation((name) => (name === 'table_seating_history' ? collection : original(name)));
  const write = jest
    .spyOn(collection, 'updateOne')
    .mockRejectedValueOnce(new Error('disk unavailable'));
  await expect(seating.cancel(db, scope, claim.id, 'staff-1')).rejects.toThrow('disk unavailable');
  expect((await seating.read(db, scope))[0].state).toBe('cancelled');
  write.mockRestore();
  spy.mockRestore();
  await seating.cancel(db, scope, claim.id, 'staff-1');
  expect(await seating.read(db, scope)).toEqual([]);
  expect((await seating.find(db, scope, claim.id)).state).toBe('cancelled');
});
test('a delayed concurrent release cannot dirty tables already cleaned after closure', async () => {
  const claim = await seating.reserve(db, scope, request());
  const saleId = new ObjectId();
  await seating.bind(db, scope, claim.id, 'staff-1', String(saleId));
  await db.collection('sales').insertOne({
    _id: saleId,
    branch_id: scope.branchId,
    license: scope.license,
    floor_closed_at: new Date(),
  });
  const tables = db.collection('tableorder'),
    originalCollection = db.collection.bind(db),
    originalUpdate = tables.updateMany.bind(tables);
  let unblock, entered;
  const paused = new Promise((resolve) => {
    entered = resolve;
  });
  const gate = new Promise((resolve) => {
    unblock = resolve;
  });
  const collectionSpy = jest
    .spyOn(db, 'collection')
    .mockImplementation((name) => (name === 'tableorder' ? tables : originalCollection(name)));
  const updateSpy = jest.spyOn(tables, 'updateMany').mockImplementationOnce(async (...args) => {
    entered();
    await gate;
    return originalUpdate(...args);
  });
  const slow = seating.release(db, scope, claim.id);
  await paused;
  await seating.release(db, scope, claim.id);
  await originalUpdate({}, { $set: { service_state: 'available' } });
  unblock();
  await slow;
  updateSpy.mockRestore();
  collectionSpy.mockRestore();
  expect(await tables.countDocuments({ service_state: 'cleaning' })).toBe(0);
  expect((await seating.find(db, scope, claim.id)).state).toBe('released');
});
test('single-table seating honours a branch limit and counts a bound sale only once', async () => {
  await db.collection('tableorder').updateMany({}, { $set: { max_capacity: 6 } });
  await db
    .collection('branches')
    .insertOne({ _id: scope.branchId, license: scope.license, table_order_limit: 2 });
  const first = await seating.reserve(db, scope, request({ table_ids: [ids[0]], guests: 2 }));
  const saleId = new ObjectId();
  await seating.bind(db, scope, first.id, 'staff-1', String(saleId));
  await db.collection('sales').insertOne({
    _id: saleId,
    branch_id: scope.branchId,
    license: scope.license,
    table_number: 'T1',
    sale_process: 'KOT',
    payment_status: 'Unpaid',
  });
  await seating.reserve(
    db,
    scope,
    request({ request_id: 'seating-request-0002', table_ids: [ids[0]], guests: 2 })
  );
  await expect(
    seating.reserve(
      db,
      scope,
      request({ request_id: 'seating-request-0003', table_ids: [ids[0]], guests: 2 })
    )
  ).rejects.toThrow('open order limit');
});

test('unlimited order count does not bypass shared seating capacity, including pending claims', async () => {
  await db
    .collection('branches')
    .insertOne({ _id: scope.branchId, license: scope.license, table_order_limit: 0 });
  await seating.reserve(db, scope, request({ table_ids: [ids[0]], guests: 2 }));
  const second = request({ request_id: 'capacity-second-request', table_ids: [ids[0]], guests: 2 });
  await expect(seating.reserve(db, scope, second)).rejects.toThrow('enough seats');
  const saleId = new ObjectId();
  await seating.bind(db, scope, request().request_id, 'staff-1', String(saleId));
  await db.collection('sales').insertOne({
    _id: saleId,
    branch_id: scope.branchId,
    license: scope.license,
    table_number: 'T1',
    sale_process: 'KOT',
    payment_status: 'Unpaid',
  });
  await expect(seating.reserve(db, scope, second)).rejects.toThrow('enough seats');
  await db.collection('sales').updateOne({ _id: saleId }, { $set: { person_count: 1 } });
  await expect(seating.reserve(db, scope, second)).resolves.toMatchObject({ guests: 2 });
});

test('concurrent reservations cannot both consume the last seats with an unlimited order count', async () => {
  await db
    .collection('branches')
    .insertOne({ _id: scope.branchId, license: scope.license, table_order_limit: 0 });
  await seating.reserve(db, scope, request({ table_ids: [ids[0]], guests: 1 }));
  const results = await Promise.allSettled(
    [1, 2].map((index) =>
      seating.reserve(
        db,
        scope,
        request({
          request_id: `concurrent-covers-${index}`,
          table_ids: [ids[0]],
          guests: 2,
        })
      )
    )
  );
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect((await seating.read(db, scope)).reduce((sum, claim) => sum + claim.guests, 0)).toBe(3);
});
test('unlimited single-table orders still cannot take a member of a combined group', async () => {
  await db.collection('tableorder').updateMany({}, { $set: { max_capacity: 6 } });
  await db
    .collection('branches')
    .insertOne({ _id: scope.branchId, license: scope.license, table_order_limit: 0 });
  for (let index = 0; index < 3; index++)
    await seating.reserve(
      db,
      scope,
      request({
        request_id: `seating-request-000${index}`,
        table_ids: [ids[2]],
        primary_id: ids[2],
        guests: 2,
      })
    );
  await seating.reserve(db, scope, request({ request_id: 'combined-request-0001' }));
  await expect(
    seating.reserve(
      db,
      scope,
      request({ request_id: 'single-request-0004', table_ids: [ids[0]], guests: 2 })
    )
  ).rejects.toThrow('Table changed');
});
test('two concurrent requests cannot take the final permitted single-table slot', async () => {
  await db.collection('tableorder').updateMany({}, { $set: { max_capacity: 6 } });
  await db
    .collection('branches')
    .insertOne({ _id: scope.branchId, license: scope.license, table_order_limit: 2 });
  await seating.reserve(db, scope, request({ table_ids: [ids[0]], guests: 2 }));
  const result = await Promise.allSettled(
    [2, 3].map((index) =>
      seating.reserve(
        db,
        scope,
        request({ request_id: `seating-request-000${index}`, table_ids: [ids[0]], guests: 2 })
      )
    )
  );
  expect(result.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
  expect(await seating.read(db, scope)).toHaveLength(2);
});
test('closing one of multiple orders cannot mark the shared table for cleaning', async () => {
  await db.collection('tableorder').updateMany({}, { $set: { max_capacity: 6 } });
  await db
    .collection('branches')
    .insertOne({ _id: scope.branchId, license: scope.license, table_order_limit: 2 });
  const first = await seating.reserve(db, scope, request({ table_ids: [ids[0]], guests: 2 }));
  const second = await seating.reserve(
    db,
    scope,
    request({ request_id: 'seating-request-0002', table_ids: [ids[0]], guests: 2 })
  );
  const firstSale = new ObjectId(),
    secondSale = new ObjectId();
  await seating.bind(db, scope, first.id, 'staff-1', String(firstSale));
  await seating.bind(db, scope, second.id, 'staff-1', String(secondSale));
  await db.collection('sales').insertMany([
    {
      _id: firstSale,
      branch_id: scope.branchId,
      license: scope.license,
      table_number: 'T1',
      floor_closed_at: new Date(),
    },
    {
      _id: secondSale,
      branch_id: scope.branchId,
      license: scope.license,
      table_number: 'T1',
      sale_process: 'KOT',
      payment_status: 'Unpaid',
    },
  ]);
  await expect(seating.release(db, scope, first.id)).rejects.toThrow('remaining orders');
  expect(await db.collection('tableorder').countDocuments({ service_state: 'cleaning' })).toBe(0);
});
test('cancelling one ticket releases only its claim and does not dirty a shared table', async () => {
  await db.collection('tableorder').updateMany({}, { $set: { max_capacity: 6 } });
  await db
    .collection('branches')
    .insertOne({ _id: scope.branchId, license: scope.license, table_order_limit: 2 });
  const first = await seating.reserve(db, scope, request({ table_ids: [ids[0]], guests: 2 }));
  const second = await seating.reserve(
    db,
    scope,
    request({ request_id: 'seating-request-0002', table_ids: [ids[0]], guests: 2 })
  );
  const saleId = new ObjectId();
  await seating.bind(db, scope, first.id, 'staff-1', String(saleId));
  await db.collection('sales').insertOne({
    _id: saleId,
    branch_id: scope.branchId,
    license: scope.license,
    table_number: 'T1',
    sale_process: 'cancelled',
    floor_closed_at: new Date(),
  });
  await seating.release(db, scope, first.id);
  expect((await seating.find(db, scope, first.id)).state).toBe('released');
  expect((await seating.find(db, scope, second.id)).state).toBe('reserved');
  expect(await db.collection('tableorder').countDocuments({ service_state: 'cleaning' })).toBe(0);
});
test('desktop adapter shares Captain reservations and stable sale identities', async () => {
  const desktop = require('../../../src/services/desktop-seating');
  const input = { actor: 'cashier-1', request_id: 'desktop-retry-0001' };
  const document = {
    branch_id: scope.branchId,
    license: scope.license,
    table_number: 'T1',
    person_count: 2,
    sales_id: 'INV-1',
  };
  const prepared = await desktop.prepare(db, scope, input, document);
  expect(document.seating_table_ids).toEqual([ids[0]]);
  expect(document.floor_lifecycle).toBe(true);
  await expect(seating.reserve(db, scope, request())).rejects.toThrow('Table changed');
  await db.collection('sales').insertOne(document);
  const retry = await desktop.lookup(db, scope, input);
  expect(String(retry._id)).toBe(String(document._id));
  await expect(desktop.lookup(db, scope, { ...input, actor: 'cashier-2' })).rejects.toThrow(
    'Permission'
  );
  expect(prepared.claim.id).toMatch(/^desktop-/);
});
test('desktop retries with changed items cannot return the old sale or replace a bound draft', async () => {
  const desktop = require('../../../src/services/desktop-seating');
  const input = {
    actor: 'cashier-1',
    request_id: 'desktop-payload-0001',
    payload: { items: [{ id: 'dish', quantity: 1, note: 'no salt' }], payment_mode: 'Cash' },
  };
  const document = {
    branch_id: scope.branchId,
    license: scope.license,
    table_number: 'T1',
    person_count: 2,
    sales_id: 'INV-1',
  };
  await desktop.prepare(db, scope, input, document);
  const changed = {
    ...input,
    payload: { ...input.payload, items: [{ id: 'dish', quantity: 2, note: 'no salt' }] },
  };
  await expect(desktop.lookup(db, scope, changed)).rejects.toThrow('different order');
  await expect(desktop.prepare(db, scope, changed, { ...document })).rejects.toThrow(
    'already been used'
  );
  await db.collection('sales').insertOne(document);
  await expect(desktop.lookup(db, scope, changed)).rejects.toThrow('different order');
  expect(String((await desktop.lookup(db, scope, input))._id)).toBe(String(document._id));
  expect(await db.collection('sales').countDocuments({})).toBe(1);
});

async function movableOrder() {
  const claim = await seating.reserve(db, scope, request());
  const id = new ObjectId();
  await seating.bind(db, scope, claim.id, 'staff-1', String(id));
  const order = {
    _id: id,
    branch_id: scope.branchId,
    license: scope.license,
    seating_request_id: claim.id,
    table_number: 'T1',
    person_count: 4,
    payment_status: 'Unpaid',
    sale_process: 'KOT',
  };
  await db.collection('sales').insertOne(order);
  return order;
}

async function transferredSource() {
  const order = await movableOrder(),
    transferId = 'restructure:full-source-transfer';
  await db.collection('captain_payment_plans').insertOne({
    _id: transferId,
    branch_id: scope.branchId,
    license: scope.license,
    purpose: 'order-restructure',
    stage: 'applying',
    orderIds: [String(order._id)],
    intent: { kind: 'transfer', orderId: String(order._id) },
  });
  await db.collection('sales').updateOne(
    { _id: order._id },
    {
      $set: {
        floor_closed_at: new Date(),
        sales_total: 0,
        items: [],
        captain_payment_plan: transferId,
        captain_transfer_allocation: { totalMinor: 0, lines: [] },
        captain_transfer_operations: [{ id: transferId, side: 'source' }],
      },
    }
  );
  return { order, transferId };
}
test.each([true, false])(
  'full transfer releases only its seating claim (other check present: %s)',
  async (occupied) => {
    const { order, transferId } = await transferredSource();
    let neighbour;
    if (occupied) {
      neighbour = { ...order, _id: new ObjectId(), seating_request_id: undefined, person_count: 1 };
      await db.collection('sales').insertOne(neighbour);
    }
    await seating.release(db, scope, order.seating_request_id, { transferId });
    await seating.release(db, scope, order.seating_request_id, { transferId });
    expect((await seating.find(db, scope, order.seating_request_id)).state).toBe('released');
    const table = await db.collection('tableorder').findOne({ _id: new ObjectId(ids[0]) });
    expect(table.service_state).toBe(occupied ? undefined : 'cleaning');
    if (neighbour)
      expect(
        (await db.collection('sales').findOne({ _id: neighbour._id })).floor_closed_at
      ).toBeUndefined();
  }
);
test.each([
  { sales_total: 1 },
  { items: [{ item_quantity: 1 }] },
  { captain_payment_plan: 'wrong-transfer' },
])('transfer release refuses an unverified empty source %j', async (patch) => {
  const { order, transferId } = await transferredSource();
  await db.collection('sales').updateOne({ _id: order._id }, { $set: patch });
  await expect(
    seating.release(db, scope, order.seating_request_id, { transferId })
  ).rejects.toMatchObject({ status: 409 });
  expect((await seating.find(db, scope, order.seating_request_id)).state).toBe('submitting');
});
test('a check arriving during release preflight is not marked for cleaning', async () => {
  const { order, transferId } = await transferredSource();
  let arrived = false;
  const racing = {
    collection(name) {
      const collection = db.collection(name);
      if (name !== 'sales') return collection;
      return new Proxy(collection, {
        get(target, property) {
          if (property === 'countDocuments')
            return async (...args) => {
              const count = await target.countDocuments(...args);
              if (!arrived) {
                arrived = true;
                await target.insertOne({
                  ...order,
                  _id: new ObjectId(),
                  seating_request_id: undefined,
                  person_count: 1,
                });
              }
              return count;
            };
          const value = target[property];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
  await seating.release(racing, scope, order.seating_request_id, { transferId });
  expect(
    (await db.collection('tableorder').findOne({ _id: new ObjectId(ids[0]) })).service_state
  ).toBeUndefined();
});
test('preparing an overlapping group move reserves both old and new seats atomically', async () => {
  const order = await movableOrder();
  const input = request({
    request_id: 'moving-request-0001',
    table_ids: ids.slice(1),
    primary_id: ids[1],
  });
  const move = await seating.prepareMove(db, scope, String(order._id), input);
  expect(move.move_from).toBe(order.seating_request_id);
  expect(await seating.prepareMove(db, scope, String(order._id), input)).toEqual(move);
  expect((await seating.find(db, scope, order.seating_request_id)).moving_to).toBe(move.id);
  await expect(
    seating.reserve(
      db,
      scope,
      request({
        request_id: 'another-request-0001',
        table_ids: [ids[0]],
        primary_id: ids[0],
        guests: 1,
      })
    )
  ).rejects.toMatchObject({ status: 409 });
  await expect(seating.forEdit(db, scope, order, {})).rejects.toMatchObject({ status: 409 });
  await expect(seating.cancel(db, scope, move.id, 'staff-1')).rejects.toMatchObject({
    status: 409,
  });
});
test('two simultaneous moves cannot replace the same group twice', async () => {
  const order = await movableOrder();
  const results = await Promise.allSettled(
    [1, 2].map((n) =>
      seating.prepareMove(
        db,
        scope,
        String(order._id),
        request({
          request_id: 'moving-request-000' + n,
          table_ids: ids.slice(1),
          primary_id: ids[1],
        })
      )
    )
  );
  expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
  expect(await seating.read(db, scope)).toHaveLength(2);
});

async function movingGroup() {
  const order = await movableOrder();
  const move = await seating.prepareMove(
    db,
    scope,
    String(order._id),
    request({ request_id: 'moving-request-0001', table_ids: ids.slice(1), primary_id: ids[1] })
  );
  return { order, move };
}
test('cancelling a prepared group move keeps original order and releases only destination reservation', async () => {
  const { order, move } = await movingGroup();
  await seating.cancelMove(db, scope, move.id, 'staff-1');
  await seating.cancelMove(db, scope, move.id, 'staff-1');
  expect((await db.collection('sales').findOne({ _id: order._id })).seating_request_id).toBe(
    order.seating_request_id
  );
  expect((await seating.find(db, scope, order.seating_request_id)).moving_to).toBeUndefined();
  expect((await seating.find(db, scope, move.id)).state).toBe('cancelled');
  await expect(seating.completeMove(db, scope, move.id, 'staff-1')).rejects.toMatchObject({
    status: 409,
  });
});
test('completing a group move updates the same order once and cleans only vacated tables', async () => {
  const { order, move } = await movingGroup();
  await db
    .collection('sales')
    .updateOne({ _id: order._id }, { $set: { items: [{ name: 'Soup', quantity: 2 }] } });
  await seating.completeMove(db, scope, move.id, 'staff-1');
  await seating.completeMove(db, scope, move.id, 'staff-1');
  const sale = await db.collection('sales').findOne({ _id: order._id });
  expect(sale.table_number).toBe('T2');
  expect(sale.items).toEqual([{ name: 'Soup', quantity: 2 }]);
  expect(sale.captain_audit).toHaveLength(1);
  expect((await seating.find(db, scope, order.seating_request_id)).state).toBe('released');
  expect(
    (await db.collection('tableorder').findOne({ _id: new ObjectId(ids[0]) })).service_state
  ).toBe('cleaning');
  expect(
    (await db.collection('tableorder').findOne({ _id: new ObjectId(ids[1]) })).service_state
  ).toBeUndefined();
});
test('interrupted move after sale update resumes without repeating the order change', async () => {
  const { order, move } = await movingGroup();
  const tables = db.collection('tableorder');
  const failing = {
    collection(name) {
      return name === 'tableorder'
        ? {
            updateMany: async () => {
              throw new Error('interrupted');
            },
          }
        : db.collection(name);
    },
  };
  await expect(seating.completeMove(failing, scope, move.id, 'staff-1')).rejects.toThrow(
    'interrupted'
  );
  await expect(seating.cancelMove(db, scope, move.id, 'staff-1')).rejects.toMatchObject({
    status: 409,
  });
  await seating.completeMove(db, scope, move.id, 'staff-1');
  expect((await db.collection('sales').findOne({ _id: order._id })).captain_audit).toHaveLength(1);
  expect((await tables.findOne({ _id: new ObjectId(ids[0]) })).captain_table_version).toBe(1);
});

test('cancel and complete race reaches one consistent seating result', async () => {
  const { order, move } = await movingGroup();
  await Promise.allSettled([
    seating.cancelMove(db, scope, move.id, 'staff-1'),
    seating.completeMove(db, scope, move.id, 'staff-1'),
  ]);
  const claim = await seating.find(db, scope, move.id);
  const sale = await db.collection('sales').findOne({ _id: order._id });
  if (claim.state === 'cancelled') expect(sale.seating_request_id).toBe(order.seating_request_id);
  else {
    await seating.completeMove(db, scope, move.id, 'staff-1');
    expect((await db.collection('sales').findOne({ _id: order._id })).seating_request_id).toBe(
      move.id
    );
  }
});

test('prepare retry after completion returns its receipt but changed payload or another order cannot replay it', async () => {
  const { order, move } = await movingGroup();
  const input = request({ request_id: move.id, table_ids: ids.slice(1), primary_id: ids[1] });
  await seating.completeMove(db, scope, move.id, 'staff-1');
  const replay = await seating.prepareMove(db, scope, String(order._id), input);
  expect(replay.state).toBe('submitting');
  expect(replay.id).toBe(move.id);
  for (const patch of [
    { guests: 5 },
    { actor: 'staff-2' },
    { primary_id: ids[2] },
    { table_ids: ids },
  ])
    await expect(
      seating.prepareMove(db, scope, String(order._id), { ...input, ...patch })
    ).rejects.toMatchObject({ status: 409 });
  const other = { ...order, _id: new ObjectId() };
  await db.collection('sales').insertOne(other);
  await expect(seating.prepareMove(db, scope, String(other._id), input)).rejects.toMatchObject({
    status: 409,
  });
  expect((await db.collection('sales').findOne({ _id: order._id })).captain_audit).toHaveLength(1);
});

test('prepare retry recovers an applying move after order projection', async () => {
  const { order, move } = await movingGroup();
  const failing = {
    collection(name) {
      return name === 'tableorder'
        ? {
            updateMany: async () => {
              throw new Error('interrupted');
            },
          }
        : db.collection(name);
    },
  };
  await expect(seating.completeMove(failing, scope, move.id, 'staff-1')).rejects.toThrow(
    'interrupted'
  );
  const recovered = await seating.prepareMove(
    db,
    scope,
    String(order._id),
    request({ request_id: move.id, table_ids: ids.slice(1), primary_id: ids[1] })
  );
  expect(recovered.state).toBe('applying');
  await seating.completeMove(db, scope, recovered.id, 'staff-1');
  expect((await db.collection('sales').findOne({ _id: order._id })).captain_audit).toHaveLength(1);
});

test('interrupted floor release retains a lock and retries cleaning once', async () => {
  const order = await movableOrder();
  await db
    .collection('sales')
    .updateOne({ _id: order._id }, { $set: { floor_closed_at: new Date() } });
  const failing = {
    collection(name) {
      return name === 'tableorder'
        ? {
            updateMany: async () => {
              throw new Error('interrupted');
            },
          }
        : db.collection(name);
    },
  };
  await expect(seating.release(failing, scope, order.seating_request_id)).rejects.toThrow(
    'interrupted'
  );
  expect((await seating.find(db, scope, order.seating_request_id)).state).toBe('releasing');
  await seating.release(db, scope, order.seating_request_id);
  await seating.release(db, scope, order.seating_request_id);
  expect(
    (await db.collection('tableorder').findOne({ _id: new ObjectId(ids[0]) })).captain_table_version
  ).toBe(1);
});

test('close intent blocks a group move and accepts only the same close retry', async () => {
  const order = await movableOrder();
  const closeId = 'closing-request-0001';
  await seating.beginClose(db, scope, [String(order._id)], closeId);
  await seating.beginClose(db, scope, [String(order._id)], closeId);
  await expect(
    seating.beginClose(db, scope, [String(order._id)], 'closing-request-0002')
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    seating.prepareMove(
      db,
      scope,
      String(order._id),
      request({ request_id: 'moving-request-0001', table_ids: ids.slice(1), primary_id: ids[1] })
    )
  ).rejects.toMatchObject({ status: 409 });
  await expect(seating.forEdit(db, scope, order, {})).rejects.toMatchObject({ status: 409 });
});
test('close and prepare move cannot both acquire the source group', async () => {
  const order = await movableOrder();
  const results = await Promise.allSettled([
    seating.beginClose(db, scope, [String(order._id)], 'closing-request-0001'),
    seating.prepareMove(
      db,
      scope,
      String(order._id),
      request({ request_id: 'moving-request-0001', table_ids: ids.slice(1), primary_id: ids[1] })
    ),
  ]);
  expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
  const source = await seating.find(db, scope, order.seating_request_id);
  expect(Boolean(source.closing) !== Boolean(source.moving_to)).toBe(true);
});

test('cancel before prepare records a tombstone and prevents a delayed move', async () => {
  const order = await movableOrder();
  const id = 'moving-request-0001';
  await seating.cancelMove(db, scope, id, 'staff-1', String(order._id));
  await seating.cancelMove(db, scope, id, 'staff-1', String(order._id));
  expect((await seating.find(db, scope, id)).state).toBe('cancelled');
  await expect(
    seating.prepareMove(db, scope, String(order._id), request({ request_id: id }))
  ).rejects.toMatchObject({ status: 409 });
  expect((await seating.find(db, scope, order.seating_request_id)).moving_to).toBeUndefined();
});
test('another staff cannot preempt an unprepared move', async () => {
  const order = await movableOrder();
  await expect(
    seating.cancelMove(db, scope, 'moving-request-0001', 'staff-2', String(order._id))
  ).rejects.toMatchObject({ status: 403 });
  expect(await seating.find(db, scope, 'moving-request-0001')).toBeNull();
});
test('concurrent cancellation and preparation cannot resurrect a cancelled request', async () => {
  const order = await movableOrder();
  const id = 'moving-request-0001';
  await Promise.allSettled([
    seating.cancelMove(db, scope, id, 'staff-1', String(order._id)),
    seating.prepareMove(
      db,
      scope,
      String(order._id),
      request({ request_id: id, table_ids: ids.slice(1), primary_id: ids[1] })
    ),
  ]);
  await seating.cancelMove(db, scope, id, 'staff-1', String(order._id));
  expect((await seating.find(db, scope, id)).state).toBe('cancelled');
  expect((await seating.find(db, scope, order.seating_request_id)).moving_to).toBeUndefined();
});

test('desktop save cannot restore seating after a concurrent completed move', async () => {
  const order = await movableOrder();
  const Model =
    mongoose.models.SeatingEditProof ||
    mongoose.model(
      'SeatingEditProof',
      new mongoose.Schema({}, { strict: false, collection: 'sales', versionKey: false })
    );
  const doc = await Model.findById(order._id);
  const desktop = require('../../../src/services/desktop-seating');
  await desktop.guardEdit(db, scope, doc, { table_number: 'T1', person_count: 4 });
  const move = await seating.prepareMove(
    db,
    scope,
    String(order._id),
    request({
      request_id: 'moving-request-0001',
      table_ids: ids.slice(1),
      primary_id: ids[1],
    })
  );
  await seating.completeMove(db, scope, move.id, 'staff-1');
  doc.set({ table_number: 'T1', total_amount: 999 });
  await expect(saleRepository.save(doc)).rejects.toMatchObject({ name: 'DocumentNotFoundError' });
  const saved = await db.collection('sales').findOne({ _id: order._id });
  expect(saved.table_number).toBe('T2');
  expect(saved.total_amount).not.toBe(999);
  expect(saved.seating_request_id).toBe(move.id);
});
test('desktop guarded edit saves normally when seating is unchanged', async () => {
  const order = await movableOrder();
  const Model =
    mongoose.models.SeatingEditProof ||
    mongoose.model(
      'SeatingEditProof',
      new mongoose.Schema({}, { strict: false, collection: 'sales', versionKey: false })
    );
  const doc = await Model.findById(order._id);
  await require('../../../src/services/desktop-seating').guardEdit(db, scope, doc, {
    table_number: 'T1',
    person_count: 4,
  });
  doc.set({ total_amount: 999 });
  await saleRepository.save(doc);
  expect((await db.collection('sales').findOne({ _id: order._id })).total_amount).toBe(999);
});

test('authorized staff handover keeps the new move request owned by its initiating staff', async () => {
  const order = await movableOrder();
  const input = request({
    request_id: 'handover-move-0001',
    actor: 'staff-2',
    table_ids: ids.slice(1),
    primary_id: ids[1],
  });
  await expect(seating.prepareMove(db, scope, String(order._id), input)).rejects.toMatchObject({
    status: 403,
  });
  const move = await seating.prepareMove(db, scope, String(order._id), input, {
    staffHandover: true,
  });
  expect(move.actor).toBe('staff-2');
  await expect(
    seating.cancelMove(db, scope, move.id, 'staff-1', String(order._id), { staffHandover: true })
  ).rejects.toMatchObject({ status: 403 });
  await expect(seating.completeMove(db, scope, move.id, 'staff-1')).rejects.toMatchObject({
    status: 403,
  });
  await seating.completeMove(db, scope, move.id, 'staff-2');
  expect((await db.collection('sales').findOne({ _id: order._id })).table_number).toBe('T2');
});
test('staff can abandon their unprepared move of an order owned by another staff member', async () => {
  const order = await movableOrder();
  await seating.cancelMove(db, scope, 'handover-move-0001', 'staff-2', String(order._id), {
    staffHandover: true,
  });
  expect((await seating.find(db, scope, 'handover-move-0001')).actor).toBe('staff-2');
  expect((await seating.find(db, scope, order.seating_request_id)).moving_to).toBeUndefined();
});

test('desktop submission identity prevents duplicates across concurrent inserts and preserves retry payload', async () => {
  const submission = require('../../../src/services/desktop-submission');
  const payload = {
    idempotencyKey: 'desktop-request-1',
    items: [{ id: 'dish', quantity: 2 }],
    sales_total: 20,
  };
  const first = {},
    second = {};
  await submission.prepare(db, scope, 'staff-1', payload, first);
  await submission.prepare(db, scope, 'staff-1', payload, second);
  const documents = [first, second].map((doc) => ({
    ...doc,
    branch_id: scope.branchId,
    license: scope.license,
    sales_id: 'INV1',
  }));
  const results = await Promise.allSettled(
    documents.map((doc) => db.collection('sales').insertOne(doc))
  );
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const saved = await submission.prepare(
    db,
    scope,
    'staff-1',
    { ...payload, approval_token: 'renewed' },
    {}
  );
  expect(saved.sales_id).toBe('INV1');
  await expect(
    submission.lookup(db, scope, 'staff-1', { ...payload, sales_total: 21 })
  ).rejects.toMatchObject({ status: 409 });
  expect(await submission.lookup(db, scope, 'staff-2', payload)).toBeNull();
});

test('guest edits use the reserved group capacity without changing the original reservation request', async () => {
  const order = await movableOrder();
  const before = await seating.find(db, scope, order.seating_request_id);
  const checked = await seating.forEdit(db, scope, order, { guests: 5 });
  expect(checked.id).toBe(before.id);
  for (const guests of [undefined, null, ''])
    await expect(seating.forEdit(db, scope, order, { guests })).resolves.toMatchObject({
      id: before.id,
    });
  expect(await seating.find(db, scope, before.id)).toEqual(before);
  await expect(seating.forEdit(db, scope, order, { guests: 7 })).rejects.toThrow('enough seats');
  for (const guests of [0, -1, 1.5, 'abc', 1001])
    await expect(seating.forEdit(db, scope, order, { guests })).rejects.toThrow('number of guests');
  await expect(seating.forEdit(db, scope, order, { guests: 3, table: 'T3' })).rejects.toMatchObject(
    { status: 409 }
  );
  await expect(
    seating.forEdit(db, scope, order, { guests: 3, dine_type: 'Take away' })
  ).rejects.toMatchObject({ status: 409 });
});

test('a claimed party can become takeaway and return to a suitable table without new kitchen or money effects', async () => {
  const order = await movableOrder();
  const items = [
    { item_name: 'Soup', item_quantity: 2, item_note: 'Less salt', line_id: 'line-1' },
  ];
  const changes = [
    { timestamp: new Date('2026-09-30T10:00:00Z'), items: [{ ...items[0], process: 'add' }] },
  ];
  await db
    .collection('sales')
    .updateOne({ _id: order._id }, { $set: { items, changes, sales_total: 120 } });
  const input = request({
    request_id: 'takeaway-request-0001',
    table_ids: [],
    primary_id: '',
    guests: 0,
    dine_type: 'Take away',
  });
  const pending = await seating.prepareMove(db, scope, String(order._id), input);
  expect(pending.tables).toEqual([]);
  expect((await db.collection('sales').findOne({ _id: order._id })).table_number).toBe('T1');
  await seating.completeMove(db, scope, pending.id, 'staff-1');
  const takeaway = await db.collection('sales').findOne({ _id: order._id });
  expect(takeaway).toMatchObject({
    table_number: '',
    dine_type: 'Take away',
    person_count: 0,
    items,
    changes,
    sales_total: 120,
  });
  await expect(
    seating.forEdit(db, scope, takeaway, { guests: 0, dine_type: 'Take away' })
  ).resolves.toMatchObject({ id: pending.id });
  await expect(seating.forEdit(db, scope, takeaway, { guests: 1 })).rejects.toThrow(
    'number of guests'
  );
  expect((await seating.prepareMove(db, scope, String(order._id), input)).state).toBe('submitting');
  await seating.completeMove(db, scope, pending.id, 'staff-1');
  expect((await db.collection('sales').findOne({ _id: order._id })).captain_audit).toHaveLength(1);
  expect(await db.collection('tableorder').countDocuments({ service_state: 'cleaning' })).toBe(2);
  const seated = await seating.prepareMove(
    db,
    scope,
    String(order._id),
    request({
      request_id: 'return-table-request-1',
      table_ids: [ids[2]],
      primary_id: ids[2],
      guests: 2,
    })
  );
  await seating.completeMove(db, scope, seated.id, 'staff-1');
  const returned = await db.collection('sales').findOne({ _id: order._id });
  expect(returned).toMatchObject({
    table_number: 'T3',
    dine_type: 'Dine-in',
    person_count: 2,
    items,
    changes,
    sales_total: 120,
  });
  expect(returned.captain_audit).toHaveLength(2);
});
test('takeaway conversion rejects table-bearing, guest-bearing and changed-type retries', async () => {
  const order = await movableOrder();
  const input = request({
    request_id: 'takeaway-request-0002',
    table_ids: [],
    primary_id: '',
    guests: 0,
    dine_type: 'Take away',
  });
  await expect(
    seating.prepareMove(db, scope, String(order._id), { ...input, table_ids: [ids[0]] })
  ).rejects.toThrow('tables');
  await expect(
    seating.prepareMove(db, scope, String(order._id), { ...input, guests: 2 })
  ).rejects.toThrow('guests');
  await seating.prepareMove(db, scope, String(order._id), input);
  await expect(
    seating.prepareMove(db, scope, String(order._id), request({ request_id: input.request_id }))
  ).rejects.toThrow('already been used');
  await seating.cancelMove(db, scope, input.request_id, 'staff-1', String(order._id));
  expect((await db.collection('sales').findOne({ _id: order._id })).table_number).toBe('T1');
});

test('moving one check preserves an occupied source and blocks new seating during the transition even with no order limit', async () => {
  await db
    .collection('branches')
    .insertOne({ _id: scope.branchId, license: scope.license, table_order_limit: 0 });
  const orders = [];
  for (const n of [1, 2]) {
    const claim = await seating.reserve(
      db,
      scope,
      request({
        request_id: 'shared-source-seat-' + n,
        table_ids: [ids[0]],
        primary_id: ids[0],
        guests: 1,
      })
    );
    const _id = new ObjectId();
    await seating.bind(db, scope, claim.id, 'staff-1', String(_id));
    const order = {
      _id,
      branch_id: scope.branchId,
      license: scope.license,
      seating_request_id: claim.id,
      table_number: 'T1',
      person_count: 1,
      sale_process: 'KOT',
      payment_status: 'Unpaid',
    };
    await db.collection('sales').insertOne(order);
    orders.push(order);
  }
  const move = await seating.prepareMove(
    db,
    scope,
    String(orders[0]._id),
    request({
      request_id: 'shared-source-move-1',
      table_ids: [ids[1]],
      primary_id: ids[1],
      guests: 1,
    })
  );
  for (const target of [ids[0], ids[1]])
    await expect(
      seating.reserve(
        db,
        scope,
        request({
          request_id: 'concurrent-seat-' + target,
          table_ids: [target],
          primary_id: target,
          guests: 1,
        })
      )
    ).rejects.toMatchObject({ status: 409 });
  await seating.completeMove(db, scope, move.id, 'staff-1');
  expect(
    (await db.collection('tableorder').findOne({ _id: new ObjectId(ids[0]) })).service_state
  ).not.toBe('cleaning');
  expect((await db.collection('sales').findOne({ _id: orders[1]._id })).table_number).toBe('T1');
});

test('prepared moves fence payment and release that fence on cancellation or completion', async () => {
  const { order, move } = await movingGroup();
  const guard = require('../../../src/services/captain-payment-guard');
  let sale = await db.collection('sales').findOne({ _id: order._id });
  expect(sale.captain_payment_plan).toBe(move.operation_lock);
  await expect(guard.mutable(db, sale)).rejects.toMatchObject({ status: 409 });
  await seating.cancelMove(db, scope, move.id, 'staff-1');
  sale = await db.collection('sales').findOne({ _id: order._id });
  expect(sale.captain_payment_plan).toBeUndefined();
  const next = await seating.prepareMove(
    db,
    scope,
    String(order._id),
    request({ request_id: 'after-cancel-move-1', table_ids: ids.slice(1), primary_id: ids[1] })
  );
  await seating.completeMove(db, scope, next.id, 'staff-1');
  await seating.completeMove(db, scope, next.id, 'staff-1');
  sale = await db.collection('sales').findOne({ _id: order._id });
  expect(sale.captain_payment_plan).toBeUndefined();
  expect(sale.captain_audit).toHaveLength(1);
});

test('a payment reservation prevents a move without reserving destination seats', async () => {
  const order = await movableOrder();
  await db
    .collection('sales')
    .updateOne({ _id: order._id }, { $set: { captain_payment_plan: 'cashier-payment' } });
  await expect(
    seating.prepareMove(
      db,
      scope,
      String(order._id),
      request({ request_id: 'payment-race-move-1', table_ids: ids.slice(1), primary_id: ids[1] })
    )
  ).rejects.toMatchObject({ status: 409 });
  expect((await seating.find(db, scope, order.seating_request_id)).moving_to).toBeUndefined();
  expect((await db.collection('sales').findOne({ _id: order._id })).captain_payment_plan).toBe(
    'cashier-payment'
  );
});

test('simultaneous cancellation and completion cannot leave a moved order with cancelled seats', async () => {
  const { order, move } = await movingGroup();
  const results = await Promise.allSettled([
    seating.cancelMove(db, scope, move.id, 'staff-1', String(order._id)),
    seating.completeMove(db, scope, move.id, 'staff-1'),
  ]);
  expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
  const current = await seating.find(db, scope, move.id);
  const sale = await db.collection('sales').findOne({ _id: order._id });
  expect(sale.captain_payment_plan).toBeUndefined();
  expect(sale.seating_request_id).toBe(
    current.state === 'cancelled' ? order.seating_request_id : move.id
  );
});

test('an interrupted completion retains its payment fence until retry finishes the floor', async () => {
  const { order, move } = await movingGroup();
  const locks = require('../../../src/services/captain-restructure-lock');
  await locks.applying(db, scope, move.id, 'staff-1');
  await expect(seating.cancelMove(db, scope, move.id, 'staff-1')).rejects.toMatchObject({
    status: 409,
  });
  expect((await seating.find(db, scope, move.id)).state).toBe('reserved');
  await seating.completeMove(db, scope, move.id, 'staff-1');
  expect(
    (await db.collection('sales').findOne({ _id: order._id })).captain_payment_plan
  ).toBeUndefined();
});

test('retry after cancellation was interrupted releases reserved seats instead of reviving the move', async () => {
  const { order, move } = await movingGroup();
  await require('../../../src/services/captain-restructure-lock').cancel(
    db,
    scope,
    move.id,
    'staff-1'
  );
  await expect(
    seating.prepareMove(
      db,
      scope,
      String(order._id),
      request({ request_id: move.id, table_ids: ids.slice(1), primary_id: ids[1] })
    )
  ).rejects.toMatchObject({ status: 409 });
  expect((await seating.find(db, scope, move.id)).state).toBe('cancelled');
  expect((await seating.find(db, scope, order.seating_request_id)).moving_to).toBeUndefined();
});

test('legacy unpaid orders without a payment status can still move without changing their payment data', async () => {
  const order = await movableOrder();
  await db.collection('sales').updateOne({ _id: order._id }, { $unset: { payment_status: '' } });
  const move = await seating.prepareMove(
    db,
    scope,
    String(order._id),
    request({ request_id: 'legacy-unpaid-move-1', table_ids: ids.slice(1), primary_id: ids[1] })
  );
  await seating.completeMove(db, scope, move.id, 'staff-1');
  const sale = await db.collection('sales').findOne({ _id: order._id });
  expect(sale.payment_status).toBeUndefined();
  expect(sale.captain_payment_plan).toBeUndefined();
  expect(sale.seating_request_id).toBe(move.id);
});

async function mergeOrders() {
  const orders = [];
  for (const [index, guests] of [
    [0, 1],
    [2, 2],
  ]) {
    const claim = await seating.reserve(
      db,
      scope,
      request({
        request_id: 'merge-existing-seat-' + index,
        table_ids: [ids[index]],
        primary_id: ids[index],
        guests,
      })
    );
    const order = {
      _id: new ObjectId(),
      branch_id: scope.branchId,
      license: scope.license,
      seating_request_id: claim.id,
      table_number: 'T' + (index + 1),
      person_count: guests,
      sale_process: 'KOT',
      payment_status: 'Unpaid',
      items: [
        {
          item_id: 'dish-' + index,
          item_name: 'Soup',
          item_quantity: 1,
          item_price: 10 + index,
          item_note: 'Note ' + index,
        },
      ],
      sales_sub_total: 10 + index,
      sales_total: 10 + index,
      changes: [{ timestamp: new Date(), items: [] }],
    };
    await seating.bind(db, scope, claim.id, 'staff-1', String(order._id));
    await db.collection('sales').insertOne(order);
    orders.push(order);
  }
  return {
    source: orders[0],
    target: orders[1],
    input: request({
      request_id: 'merge-orders-request-1',
      table_ids: [ids[2]],
      primary_id: ids[2],
      guests: 1,
    }),
  };
}

test('authorized merge groups existing checks for one table bill without recooking or changing their totals', async () => {
  const { source, target, input } = await mergeOrders();
  await expect(
    seating.prepareMove(db, scope, String(source._id), {
      ...input,
      request_id: 'ordinary-move-target-1',
    })
  ).rejects.toThrow('open order limit');
  const options = { mergeTargetId: String(target._id) };
  const prepared = await seating.prepareMove(db, scope, String(source._id), input, options);
  expect(prepared.merge_target).toBe(String(target._id));
  expect(
    await db.collection('sales').countDocuments({ captain_payment_plan: prepared.operation_lock })
  ).toBe(2);
  await seating.completeMove(db, scope, prepared.id, 'staff-1');
  await seating.completeMove(db, scope, prepared.id, 'staff-1');
  expect(await db.collection('sales').countDocuments({ table_number: 'T3' })).toBe(2);
  expect(
    await db.collection('sales').countDocuments({ captain_payment_plan: { $exists: true } })
  ).toBe(0);
  const moved = await db.collection('sales').findOne({ _id: source._id });
  expect(moved).toMatchObject({
    items: source.items,
    changes: source.changes,
    sales_total: source.sales_total,
  });
  expect(moved.captain_audit).toHaveLength(1);
  expect(moved.captain_audit[0].action).toBe('merge');
  expect(await db.collection('sales').findOne({ _id: target._id })).toEqual(target);
  expect(
    (await db.collection('tableorder').findOne({ _id: new ObjectId(ids[0]) })).service_state
  ).toBe('cleaning');
  expect((await seating.prepareMove(db, scope, String(source._id), input, options)).state).toBe(
    'submitting'
  );
  await db
    .collection('branches')
    .insertOne({ _id: scope.branchId, license: scope.license, currencyCode: 'INR' });
  const req = {
    db,
    user: { _id: 'staff-1', role: 'manager' },
    tenantContext: { branchId: String(scope.branchId), licenseId: String(scope.license) },
    query: { table: 'T3' },
  };
  const bill = await require('../../../src/services/captain-bill').read(req);
  expect(bill.totalMinor).toBe(2200);
  expect(bill.dueMinor).toBe(2200);
  expect(bill.orderIds).toHaveLength(2);
  expect(bill.guests).toBe(3);
  const floor = await require('../../../src/services/captain-tables').list(req);
  expect(floor.tables.find((row) => row.tableorder_value === 'T3').seating.guests).toBe(3);
});

test('guest edits after a merge count the other check once using its current covers', async () => {
  const { source, target, input } = await mergeOrders();
  const prepared = await seating.prepareMove(db, scope, String(source._id), input, {
    mergeTargetId: String(target._id),
  });
  await seating.completeMove(db, scope, prepared.id, 'staff-1');
  const moved = await db.collection('sales').findOne({ _id: source._id });
  await expect(seating.forEdit(db, scope, moved, { guests: 1 })).resolves.toMatchObject({
    id: prepared.id,
  });
  await expect(seating.forEdit(db, scope, moved, { guests: 2 })).rejects.toThrow('enough seats');
  await db.collection('sales').updateOne({ _id: target._id }, { $set: { person_count: 1 } });
  await expect(seating.forEdit(db, scope, moved, { guests: 2 })).resolves.toMatchObject({
    id: prepared.id,
  });
  expect((await seating.find(db, scope, prepared.id)).guests).toBe(1);
});

test('guest edits count unclaimed checks at the table and ignore another branch', async () => {
  const order = await movableOrder();
  await db.collection('sales').insertMany([
    {
      _id: new ObjectId(),
      branch_id: scope.branchId,
      license: scope.license,
      table_number: 'T1',
      person_count: 2,
      sale_process: 'KOT',
      payment_status: 'Unpaid',
    },
    {
      _id: new ObjectId(),
      branch_id: new ObjectId(),
      license: scope.license,
      table_number: 'T1',
      person_count: 100,
      sale_process: 'KOT',
      payment_status: 'Unpaid',
    },
  ]);
  await expect(seating.forEdit(db, scope, order, { guests: 4 })).resolves.toBeTruthy();
  await expect(seating.forEdit(db, scope, order, { guests: 5 })).rejects.toThrow('enough seats');
});

test('legacy over-capacity parties can edit dishes and reduce covers without bypassing a pending move', async () => {
  const order = await movableOrder();
  order.person_count = 9;
  await db.collection('sales').updateOne({ _id: order._id }, { $set: { person_count: 9 } });
  await expect(seating.forEdit(db, scope, order, { guests: 9 })).resolves.toBeTruthy();
  await expect(seating.forEdit(db, scope, order, { guests: 8 })).resolves.toBeTruthy();
  await expect(seating.forEdit(db, scope, order, { guests: 10 })).rejects.toThrow('enough seats');
  await db
    .collection('table_seating')
    .updateOne(
      { 'claims.id': order.seating_request_id },
      { $set: { 'claims.$.moving_to': 'pending-table-move' } }
    );
  await expect(seating.forEdit(db, scope, order, { guests: 9 })).rejects.toThrow('Reconcile');
});

test('merge capacity accounts for both parties and cannot be understated by the caller', async () => {
  const { source, target, input } = await mergeOrders(),
    options = { mergeTargetId: String(target._id) };
  await expect(
    seating.prepareMove(db, scope, String(source._id), { ...input, guests: 2 }, options)
  ).rejects.toMatchObject({ status: 409 });
  await db
    .collection('tableorder')
    .updateOne({ _id: new ObjectId(ids[2]) }, { $set: { max_capacity: 2 } });
  await expect(seating.prepareMove(db, scope, String(source._id), input, options)).rejects.toThrow(
    'enough seats'
  );
  expect(
    await db.collection('sales').countDocuments({ captain_payment_plan: { $exists: true } })
  ).toBe(0);
});

test('cancelled merge preserves both tables and releases both payment fences', async () => {
  const { source, target, input } = await mergeOrders();
  const prepared = await seating.prepareMove(db, scope, String(source._id), input, {
    mergeTargetId: String(target._id),
  });
  await seating.cancelMove(db, scope, prepared.id, 'staff-1', String(source._id));
  expect(await db.collection('sales').findOne({ _id: source._id })).toEqual(source);
  expect(await db.collection('sales').findOne({ _id: target._id })).toEqual(target);
});

test('merge API requires separate permission and rechecks it before completion', async () => {
  const { source, target, input } = await mergeOrders();
  await db.collection('branches').insertOne({ _id: scope.branchId, license: scope.license });
  const service = require('../../../src/services/captain-seating');
  const req = {
    db,
    user: { _id: 'staff-1', role: 'staff', access: { sales: { write: true } } },
    tenantContext: { branchId: String(scope.branchId), licenseId: String(scope.license) },
    body: {
      request_id: input.request_id,
      orderId: String(source._id),
      targetOrderId: String(target._id),
      tableIds: input.table_ids,
      primaryId: input.primary_id,
      guests: 1,
    },
  };
  await expect(service.merge(req)).rejects.toMatchObject({ status: 403 });
  req.user.role = 'manager';
  const result = await service.merge(req);
  expect(result.mergeTargetId).toBe(String(target._id));
  req.user.role = 'staff';
  await expect(service.complete(req)).rejects.toMatchObject({ status: 403 });
  await service.cancel(req);
  expect(
    await db.collection('sales').countDocuments({ captain_payment_plan: { $exists: true } })
  ).toBe(0);
});

test('durable cover changes preserve items and reservation identity and replay only once', async () => {
  const order = await movableOrder();
  const input = { request_id: 'durable-covers-request-1', actor: 'staff-1', guests: 5 };
  await seating.changeGuests(db, scope, String(order._id), input);
  await seating.changeGuests(db, scope, String(order._id), input);
  const saved = await db.collection('sales').findOne({ _id: order._id });
  expect(saved.person_count).toBe(5);
  expect(saved.captain_audit).toHaveLength(1);
  expect(saved.seating_request_id).toBe(order.seating_request_id);
  expect(saved.captain_payment_plan).toBeUndefined();
  expect((await seating.find(db, scope, order.seating_request_id)).guest_update).toBeUndefined();
  await expect(
    seating.changeGuests(db, scope, String(order._id), { ...input, guests: 4 })
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    seating.changeGuests(db, scope, String(order._id), { ...input, actor: 'staff-2' })
  ).rejects.toMatchObject({ status: 409 });
});

test('concurrent durable cover increases cannot exceed a shared table capacity', async () => {
  const { source, target, input } = await mergeOrders();
  const move = await seating.prepareMove(db, scope, String(source._id), input, {
    mergeTargetId: String(target._id),
  });
  await seating.completeMove(db, scope, move.id, 'staff-1');
  // Both claims must see the same four-seat group capacity.
  await db.collection('table_seating').updateOne({}, { $set: { 'claims.$[].max_capacity': 4 } });
  const results = await Promise.allSettled(
    [source, target].map((order, index) =>
      seating.changeGuests(db, scope, String(order._id), {
        request_id: `concurrent-guest-edit-${index}`,
        actor: 'staff-1',
        guests: index + 2,
      })
    )
  );
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const rows = await db.collection('sales').find({ table_number: 'T3' }).toArray();
  expect(rows.reduce((sum, row) => sum + row.person_count, 0)).toBe(4);
  expect(rows.every((row) => !row.captain_payment_plan)).toBe(true);
});

test('interrupted durable cover projection keeps the reservation and completes on retry', async () => {
  const order = await movableOrder(),
    input = { request_id: 'interrupted-guest-edit', actor: 'staff-1', guests: 5 };
  const interrupted = {
    collection(name) {
      const collection = db.collection(name);
      return new Proxy(collection, {
        get(target, key) {
          if (name === 'sales' && key === 'updateOne')
            return async (filter, update, ...rest) => {
              if (update.$set?.person_count === 5) throw new Error('connection lost');
              return target.updateOne(filter, update, ...rest);
            };
          const value = target[key];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
  await expect(seating.changeGuests(interrupted, scope, String(order._id), input)).rejects.toThrow(
    'connection lost'
  );
  expect((await seating.find(db, scope, order.seating_request_id)).guest_update).toBe(
    input.request_id
  );
  await expect(seating.forEdit(db, scope, order, { guests: 4 })).rejects.toMatchObject({
    status: 409,
  });
  await expect(
    seating.beginClose(db, scope, [String(order._id)], 'close-during-guest-edit')
  ).rejects.toMatchObject({ status: 409 });
  await seating.changeGuests(db, scope, String(order._id), input);
  const saved = await db.collection('sales').findOne({ _id: order._id });
  expect(saved.person_count).toBe(5);
  expect(saved.captain_payment_plan).toBeUndefined();
  expect(saved.captain_audit).toHaveLength(1);
});

test('a lost cover-save acknowledgement replays without a duplicate audit or kitchen change', async () => {
  const order = await movableOrder(),
    input = { request_id: 'lost-cover-ack-request', actor: 'staff-1', guests: 5 };
  const kitchen = { rounds: [{ id: 'original-round', items: [{ id: 'corn', quantity: 1 }] }] };
  await db.collection('sales').updateOne(
    { _id: order._id },
    {
      $set: {
        kitchen_service: kitchen,
        items: [{ item_name: 'Corn', item_quantity: 1, item_note: 'Less salt' }],
      },
    }
  );
  const original = await db.collection('sales').findOne({ _id: order._id });
  const lost = {
    collection(name) {
      const collection = db.collection(name);
      return new Proxy(collection, {
        get(target, key) {
          if (name === 'sales' && key === 'updateOne')
            return async (filter, update, ...rest) => {
              const result = await target.updateOne(filter, update, ...rest);
              if (update.$set?.person_count === 5) throw new Error('acknowledgement lost');
              return result;
            };
          const value = target[key];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
  await expect(seating.changeGuests(lost, scope, String(order._id), input)).rejects.toThrow(
    'acknowledgement lost'
  );
  await seating.changeGuests(db, scope, String(order._id), input);
  const saved = await db.collection('sales').findOne({ _id: order._id });
  expect(saved.items).toEqual(original.items);
  expect(saved.kitchen_service).toEqual(kitchen);
  expect(saved.captain_audit).toHaveLength(1);
  expect(saved.captain_payment_plan).toBeUndefined();
});

test('cover updates reject foreign scope and failed capacity without retaining a payment fence', async () => {
  const order = await movableOrder(),
    input = { request_id: 'invalid-cover-request', actor: 'staff-1', guests: 7 };
  await expect(
    seating.changeGuests(db, { ...scope, branchId: new ObjectId() }, String(order._id), input)
  ).rejects.toMatchObject({ status: 409 });
  await expect(seating.changeGuests(db, scope, String(order._id), input)).rejects.toThrow(
    'enough seats'
  );
  expect(
    (await db.collection('sales').findOne({ _id: order._id })).captain_payment_plan
  ).toBeUndefined();
  expect((await seating.find(db, scope, order.seating_request_id)).guest_update).toBeUndefined();
});

test('guest API enforces write permission and uses session identity instead of a supplied actor', async () => {
  const order = await movableOrder();
  await db.collection('branches').insertOne({ _id: scope.branchId, license: scope.license });
  const service = require('../../../src/services/captain-seating');
  const req = {
    db,
    user: { _id: 'staff-1', role: 'staff', access: { sales: { read: true } } },
    tenantContext: { branchId: String(scope.branchId), licenseId: String(scope.license) },
    body: {
      request_id: 'guest-api-request-001',
      orderId: String(order._id),
      guests: 5,
      actor: 'someone-else',
    },
  };
  await expect(service.guests(req)).rejects.toMatchObject({ status: 403 });
  req.user.access.sales.write = true;
  await expect(service.guests(req)).resolves.toMatchObject({
    request_id: req.body.request_id,
    orderId: String(order._id),
    guests: 5,
    state: 'completed',
  });
  await service.guests(req);
  const saved = await db.collection('sales').findOne({ _id: order._id });
  expect(saved.captain_audit).toHaveLength(1);
  expect(saved.captain_audit[0].actor.id).toBe('staff-1');
  req.user._id = 'someone-else';
  await expect(service.guests(req)).rejects.toMatchObject({ status: 409 });
});

test('guest API refuses missing branch context and invalid guest counts', async () => {
  const order = await movableOrder();
  await db.collection('branches').insertOne({ _id: scope.branchId, license: scope.license });
  const service = require('../../../src/services/captain-seating');
  const req = {
    db,
    user: { _id: 'staff-1', role: 'manager' },
    body: { request_id: 'guest-api-invalid-01', orderId: String(order._id), guests: 2 },
  };
  await expect(service.guests(req)).rejects.toMatchObject({ status: 403 });
  req.tenantContext = { branchId: String(scope.branchId), licenseId: String(scope.license) };
  for (const guests of [0, -1, 1.5, 1001, '2'])
    await expect(service.guests({ ...req, body: { ...req.body, guests } })).rejects.toMatchObject({
      status: 422,
    });
  expect(
    (await db.collection('sales').findOne({ _id: order._id })).captain_payment_plan
  ).toBeUndefined();
});

test('guest status distinguishes unknown, completed and cancelled requests without exposing another staff journal', async () => {
  const order = await movableOrder();
  await db.collection('branches').insertOne({ _id: scope.branchId, license: scope.license });
  const service = require('../../../src/services/captain-seating');
  const req = {
    db,
    user: { _id: 'staff-1', role: 'manager' },
    tenantContext: { branchId: String(scope.branchId), licenseId: String(scope.license) },
    body: { request_id: 'guest-status-request-1', orderId: String(order._id), guests: 5 },
  };
  expect((await service.guestsStatus(req)).state).toBe('unknown');
  await service.guests(req);
  expect(await service.guestsStatus(req)).toMatchObject({
    state: 'completed',
    orderId: String(order._id),
    guests: 5,
  });
  req.body = { ...req.body, request_id: 'guest-status-request-2', guests: 7 };
  await expect(service.guests(req)).rejects.toThrow('enough seats');
  expect((await service.guestsStatus(req)).state).toBe('cancelled');
  req.user._id = 'staff-2';
  await expect(service.guestsStatus(req)).rejects.toMatchObject({ status: 409 });
});

test('cover updates fence neighbouring checks from desktop writes until interrupted work is reconciled', async () => {
  const { source, target, input } = await mergeOrders();
  const move = await seating.prepareMove(db, scope, String(source._id), input, {
    mergeTargetId: String(target._id),
  });
  await seating.completeMove(db, scope, move.id, 'staff-1');
  await db.collection('table_seating').updateOne({}, { $set: { 'claims.$[].max_capacity': 4 } });
  const change = { request_id: 'shared-covers-fence-1', actor: 'staff-1', guests: 2 };
  const interrupted = {
    collection(name) {
      const collection = db.collection(name);
      return new Proxy(collection, {
        get(target, key) {
          if (name === 'sales' && key === 'updateOne')
            return async (filter, update, ...rest) => {
              if (update.$push?.captain_audit?.action === 'guests') throw new Error('interrupted');
              return target.updateOne(filter, update, ...rest);
            };
          const value = target[key];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
  await expect(
    seating.changeGuests(interrupted, scope, String(source._id), change)
  ).rejects.toThrow('interrupted');
  expect(
    await db.collection('sales').countDocuments({ captain_payment_plan: { $exists: true } })
  ).toBe(2);
  const neighbour = await db.collection('sales').findOne({ _id: target._id });
  await expect(
    require('../../../src/services/captain-payment-guard').mutable(db, neighbour)
  ).rejects.toMatchObject({ status: 409 });
  // This is the same final-write fence used by desktop save and order edits.
  const stale = await db
    .collection('sales')
    .updateOne(
      { _id: target._id, captain_payment_plan: { $exists: false } },
      { $set: { person_count: 3 } }
    );
  expect(stale.matchedCount).toBe(0);
  await seating.changeGuests(db, scope, String(source._id), change);
  expect(
    await db.collection('sales').countDocuments({ captain_payment_plan: { $exists: true } })
  ).toBe(0);
  expect((await db.collection('sales').findOne({ _id: target._id })).person_count).toBe(2);
  const delayed = await db.collection('sales').updateOne(
    {
      _id: target._id,
      captain_payment_plan: { $exists: false },
      seating_capacity_revision: { $exists: false },
    },
    { $set: { person_count: 3 } }
  );
  expect(delayed.matchedCount).toBe(0);
  expect(
    (await db.collection('sales').findOne({ _id: target._id })).seating_capacity_revision
  ).toBe(change.request_id);
});

test('cover updates protect more than two checks sharing a table', async () => {
  await db
    .collection('branches')
    .insertOne({ _id: scope.branchId, license: scope.license, table_order_limit: 0 });
  await db
    .collection('tableorder')
    .updateOne({ _id: new ObjectId(ids[0]) }, { $set: { max_capacity: 8 } });
  const orders = [];
  for (let index = 0; index < 3; index++) {
    const claim = await seating.reserve(
      db,
      scope,
      request({ request_id: `three-check-seating-${index}`, table_ids: [ids[0]], guests: 2 })
    );
    const sale = {
      _id: new ObjectId(),
      branch_id: scope.branchId,
      license: scope.license,
      seating_request_id: claim.id,
      table_number: 'T1',
      person_count: 2,
      sale_process: 'KOT',
      payment_status: 'Unpaid',
    };
    await seating.bind(db, scope, claim.id, 'staff-1', String(sale._id));
    await db.collection('sales').insertOne(sale);
    orders.push(sale);
  }
  await seating.changeGuests(db, scope, String(orders[0]._id), {
    request_id: 'three-check-guest-edit',
    actor: 'staff-1',
    guests: 3,
  });
  const journal = await require('../../../src/services/captain-restructure-lock').read(
    db,
    scope,
    'three-check-guest-edit',
    'staff-1'
  );
  expect(journal.orderIds).toHaveLength(3);
  expect(journal.stage).toBe('completed');
  expect(
    await db.collection('sales').countDocuments({ captain_payment_plan: { $exists: true } })
  ).toBe(0);
  expect(
    (await db.collection('sales').find().toArray()).reduce((sum, row) => sum + row.person_count, 0)
  ).toBe(7);
});

test('a stale guest screen after takeaway conversion receives a cancellation tombstone for safe client recovery', async () => {
  const order = await movableOrder();
  const move = await seating.prepareMove(
    db,
    scope,
    String(order._id),
    request({
      request_id: 'takeaway-before-covers',
      table_ids: [],
      primary_id: '',
      guests: 0,
      dine_type: 'Take away',
    })
  );
  await seating.completeMove(db, scope, move.id, 'staff-1');
  const input = { request_id: 'stale-guest-after-type', actor: 'staff-1', guests: 5 };
  await expect(seating.changeGuests(db, scope, String(order._id), input)).rejects.toThrow(
    'seating group'
  );
  const journal = await require('../../../src/services/captain-restructure-lock').read(
    db,
    scope,
    input.request_id,
    'staff-1'
  );
  expect(journal.stage).toBe('cancelled');
  const current = await db.collection('sales').findOne({ _id: order._id });
  expect(current.person_count).toBe(0);
  expect(current.dine_type).toBe('Take away');
  expect(current.captain_payment_plan).toBeUndefined();
});

test.each([undefined, null, ''])(
  'legacy unpaid cover changes preserve the original payment field: %s',
  async (payment) => {
    const order = await movableOrder();
    await db
      .collection('sales')
      .updateOne(
        { _id: order._id },
        payment === undefined
          ? { $unset: { payment_status: '' } }
          : { $set: { payment_status: payment } }
      );
    await seating.changeGuests(db, scope, String(order._id), {
      request_id: 'legacy-covers-request',
      actor: 'staff-1',
      guests: 5,
    });
    const saved = await db.collection('sales').findOne({ _id: order._id });
    expect(saved.person_count).toBe(5);
    expect(saved.payment_status).toBe(payment);
    expect(saved.captain_payment_plan).toBeUndefined();
  }
);

test.each(['Paid', 'Cancelled', 'Partial'])(
  'cover compatibility never reopens %s checks',
  async (payment) => {
    const order = await movableOrder();
    await db
      .collection('sales')
      .updateOne({ _id: order._id }, { $set: { payment_status: payment } });
    const before = await db.collection('sales').findOne({ _id: order._id });
    await expect(
      seating.changeGuests(db, scope, String(order._id), {
        request_id: 'paid-covers-request-1',
        actor: 'staff-1',
        guests: 5,
      })
    ).rejects.toMatchObject({ status: 409 });
    expect(await db.collection('sales').findOne({ _id: order._id })).toEqual(before);
  }
);

async function legacySale(guests = 2) {
  const sale = {
    _id: new ObjectId(),
    branch_id: scope.branchId,
    license: scope.license,
    table_number: 'T1',
    person_count: guests,
    sale_process: 'KOT',
    items: [{ item_id: 'corn', item_quantity: 2, item_note: 'Less salt' }],
    sales_total: 120,
    changes: [{ timestamp: new Date('2026-09-30T08:00:00Z'), items: [] }],
    kitchen_service: { c0i0: { quantity: 1 } },
    kitchen_work: { c0: { state: 'ready' } },
  };
  await db.collection('sales').insertOne(sale);
  return sale;
}

test('existing zero-cover desktop orders can update dishes without inventing guests', async () => {
  const order = await legacySale(0);
  await expect(seating.forEdit(db, scope, order, { guests: 0 })).resolves.toBeNull();
  await expect(seating.reserveEditCapacity(db, scope, order, { guests: 0 })).resolves.toBeNull();
  await expect(seating.reserveEditCapacity(db, scope, order, { guests: 0, table: 'T2' })).rejects.toThrow('number of guests');
  await expect(seating.reserveEditCapacity(db, scope, { ...order, sale_process: 'Hold' }, { guests: 0, sale_process: 'KOT' })).rejects.toThrow('number of guests');
  await expect(seating.forEdit(db, scope, { ...order, person_count: 2 }, { guests: 0 })).rejects.toThrow('number of guests');
});

test('claimed zero-cover orders remain editable but retain move protections', async () => {
  const order = await movableOrder();
  order.person_count = 0;
  await db.collection('sales').updateOne({ _id: order._id }, { $set: { person_count: 0 } });
  await expect(seating.forEdit(db, scope, order, { guests: 0 })).resolves.toBeTruthy();
  await db.collection('table_seating').updateOne({ 'claims.id': order.seating_request_id }, { $set: { 'claims.$.moving_to': 'pending-move' } });
  await expect(seating.forEdit(db, scope, order, { guests: 0 })).rejects.toThrow('Reconcile');
});

test.each([
  ['person_count', 3],
  ['table_number', 'T3'],
  ['table_id', 'different'],
  ['dine_type', 'Take away'],
  ['seating_primary_id', 'different'],
  ['seating_table_ids', ['different']],
])(
  'desktop edit rejects a concurrent %s change even without a timestamp update',
  async (field, value) => {
    const sale = await legacySale();
    const snapshot = { ...sale };
    await require('../../../src/services/desktop-seating').guardEdit(db, scope, snapshot, {
      table_number: sale.table_number,
      person_count: sale.person_count,
      dine_type: sale.dine_type,
    });
    await db.collection('sales').updateOne({ _id: sale._id }, { $set: { [field]: value } });
    const result = await db
      .collection('sales')
      .updateOne({ _id: sale._id, ...snapshot.$where }, { $set: { person_count: 1 } });
    expect(result.matchedCount).toBe(0);
    expect((await db.collection('sales').findOne({ _id: sale._id }))[field]).toEqual(value);
  }
);

async function legacyMergePair() {
  const source = await legacySale(1),
    target = await legacySale(2);
  await db.collection('sales').updateMany({}, { $set: { payment_status: 'Unpaid' } });
  await db.collection('sales').updateOne({ _id: target._id }, { $set: { table_number: 'T3' } });
  return {
    source,
    target,
    input: request({
      request_id: 'legacy-pair-merge-001',
      table_ids: [ids[2]],
      primary_id: ids[2],
      guests: 1,
    }),
    options: { staffHandover: true, mergeTargetId: String(target._id) },
  };
}

test('merge enrolls both older checks while preserving their original dishes and totals', async () => {
  const { source, target, input, options } = await legacyMergePair();
  const move = await seating.prepareMove(db, scope, String(source._id), input, options);
  await seating.completeMove(db, scope, move.id, 'staff-1');
  await seating.prepareMove(db, scope, String(source._id), input, options);
  const rows = await db.collection('sales').find().toArray();
  expect(rows).toHaveLength(2);
  for (const original of [source, target]) {
    const saved = rows.find((row) => String(row._id) === String(original._id));
    expect(saved.table_number).toBe('T3');
    expect(saved.items).toEqual(original.items);
    expect(saved.changes).toEqual(original.changes);
    expect(saved.sales_total).toBe(original.sales_total);
    expect(saved.kitchen_service).toEqual(original.kitchen_service);
    expect(saved.captain_payment_plan).toBeUndefined();
  }
});

test('cancel recovers interrupted destination enrollment without moving either check', async () => {
  const { source, target, input, options } = await legacyMergePair();
  const interrupted = {
    collection(name) {
      const collection = db.collection(name);
      return new Proxy(collection, {
        get(targetCollection, key) {
          if (name === 'sales' && key === 'updateOne')
            return async (filter, update, ...rest) => {
              if (String(filter._id) === String(target._id) && update.$set?.seating_request_id)
                throw new Error('interrupted destination');
              return targetCollection.updateOne(filter, update, ...rest);
            };
          const value = targetCollection[key];
          return typeof value === 'function' ? value.bind(targetCollection) : value;
        },
      });
    },
  };
  await expect(
    seating.prepareMove(interrupted, scope, String(source._id), input, options)
  ).rejects.toThrow('interrupted destination');
  const other = await legacySale();
  await db
    .collection('sales')
    .updateOne({ _id: other._id }, { $set: { payment_status: 'Unpaid' } });
  await expect(
    seating.prepareMove(db, scope, String(source._id), input, {
      ...options,
      mergeTargetId: String(other._id),
    })
  ).rejects.toMatchObject({ status: 409 });
  await seating.cancelMove(db, scope, input.request_id, 'staff-1', String(source._id), {
    staffHandover: true,
  });
  await seating.cancelMove(db, scope, input.request_id, 'staff-1', String(source._id), {
    staffHandover: true,
  });
  expect((await db.collection('sales').findOne({ _id: source._id })).table_number).toBe('T1');
  expect((await db.collection('sales').findOne({ _id: target._id })).table_number).toBe('T3');
  expect(
    await db.collection('sales').countDocuments({ captain_payment_plan: { $exists: true } })
  ).toBe(0);
  await expect(
    seating.prepareMove(db, scope, String(source._id), input, options)
  ).rejects.toMatchObject({ status: 409 });
});

test.each(['source', 'target'])(
  'cancellation before the %s enrollment journal arrives prevents a late seating fence',
  async (which) => {
    const pair = await legacyMergePair(),
      { source, target, input, options } = pair;
    let release, started;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const reached = new Promise((resolve) => {
      started = resolve;
    });
    const delayed = {
      collection(name) {
        const collection = db.collection(name);
        return new Proxy(collection, {
          get(targetCollection, key) {
            if (name === 'captain_payment_plans' && key === 'insertOne')
              return async (entry, ...rest) => {
                if (
                  entry.intent?.kind === 'enroll' &&
                  entry.intent.orderId === String(pair[which]._id)
                ) {
                  started();
                  await gate;
                }
                return targetCollection.insertOne(entry, ...rest);
              };
            const value = targetCollection[key];
            return typeof value === 'function' ? value.bind(targetCollection) : value;
          },
        });
      },
    };
    const attempt = seating
      .prepareMove(delayed, scope, String(source._id), input, options)
      .catch((error) => error);
    await reached;
    await seating.cancelMove(db, scope, input.request_id, 'staff-1', String(source._id), {
      staffHandover: true,
    });
    release();
    expect(await attempt).toMatchObject({ status: 409 });
    expect(
      await db.collection('sales').countDocuments({ captain_payment_plan: { $exists: true } })
    ).toBe(0);
    expect((await db.collection('sales').findOne({ _id: source._id })).table_number).toBe('T1');
    expect((await db.collection('sales').findOne({ _id: target._id })).table_number).toBe('T3');
    expect((await seating.read(db, scope)).some((row) => row.state === 'reserved')).toBe(false);
  }
);

test('legacy guest changes enroll once and preserve dishes and kitchen history', async () => {
  const sale = await legacySale(),
    input = { request_id: 'legacy-cover-change-01', actor: 'staff-1', guests: 3 };
  await seating.changeGuests(db, scope, String(sale._id), input);
  await seating.changeGuests(db, scope, String(sale._id), input);
  const saved = await db.collection('sales').findOne({ _id: sale._id });
  expect(saved.person_count).toBe(3);
  expect(saved.captain_audit).toHaveLength(1);
  for (const key of [
    'items',
    'changes',
    'sales_total',
    'payment_status',
    'kitchen_service',
    'kitchen_work',
  ])
    expect(saved[key]).toEqual(sale[key]);
  expect(saved.captain_payment_plan).toBeUndefined();
});

test.each(['missing-table', 'paid', 'capacity'])(
  'legacy guest rejection has a recoverable parent status: %s',
  async (reason) => {
    const sale = await legacySale(),
      input = { request_id: 'legacy-cover-reject-01', actor: 'staff-1', guests: 4 };
    if (reason === 'missing-table') await db.collection('tableorder').deleteMany({});
    if (reason === 'paid')
      await db
        .collection('sales')
        .updateOne({ _id: sale._id }, { $set: { payment_status: 'Paid' } });
    await expect(seating.changeGuests(db, scope, String(sale._id), input)).rejects.toMatchObject({
      status: 409,
    });
    const journal = await require('../../../src/services/captain-restructure-lock').read(
      db,
      scope,
      input.request_id,
      'staff-1'
    );
    expect(journal.stage).toBe('cancelled');
    expect(journal.intent.guests).toBe(4);
    const saved = await db.collection('sales').findOne({ _id: sale._id });
    expect(saved.person_count).toBe(2);
    expect(saved.captain_payment_plan).toBeUndefined();
    if (reason !== 'capacity') expect(saved.seating_request_id).toBeUndefined();
  }
);

test('guest retry finishes interrupted legacy enrollment without losing its original request', async () => {
  const sale = await legacySale(),
    input = { request_id: 'legacy-cover-recover-1', actor: 'staff-1', guests: 3 };
  const interrupted = {
    collection(name) {
      const collection = db.collection(name);
      return new Proxy(collection, {
        get(target, key) {
          if (name === 'sales' && key === 'updateOne')
            return async (filter, update, ...rest) => {
              if (update.$set?.seating_request_id)
                throw Object.assign(new Error('interrupted enrollment'), { status: 409 });
              return target.updateOne(filter, update, ...rest);
            };
          const value = target[key];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
  await expect(seating.changeGuests(interrupted, scope, String(sale._id), input)).rejects.toThrow(
    'interrupted enrollment'
  );
  expect(
    await require('../../../src/services/captain-restructure-lock').read(
      db,
      scope,
      input.request_id,
      'staff-1',
      { optional: true }
    )
  ).toBeNull();
  await expect(
    seating.changeGuests(db, scope, String(sale._id), { ...input, guests: 1 })
  ).rejects.toMatchObject({ status: 409 });
  await seating.changeGuests(db, scope, String(sale._id), input);
  const saved = await db.collection('sales').findOne({ _id: sale._id });
  expect(saved.person_count).toBe(3);
  expect(saved.captain_audit).toHaveLength(1);
  expect(saved.captain_payment_plan).toBeUndefined();
});
test('legacy enrollment preserves the existing sale and kitchen data even when already over capacity', async () => {
  const sale = await legacySale(9),
    input = { request_id: 'legacy-enrollment-001', actor: 'staff-1' };
  const claim = await seating.enrollExisting(db, scope, String(sale._id), input);
  expect(claim).toMatchObject({
    state: 'submitting',
    adopt_order: String(sale._id),
    order_id: String(sale._id),
    guests: 9,
  });
  await seating.enrollExisting(db, scope, String(sale._id), input);
  const saved = await db.collection('sales').findOne({ _id: sale._id });
  expect(saved).toMatchObject(sale);
  expect(saved.payment_status).toBeUndefined();
  expect(saved.seating_request_id).toBe(input.request_id);
  expect(saved.captain_payment_plan).toBeUndefined();
  expect(await db.collection('sales').countDocuments({})).toBe(1);
  expect(await db.collection('tableorder').countDocuments({ service_state: 'cleaning' })).toBe(0);
});
test('enrolled legacy orders can use the normal durable move flow', async () => {
  const sale = await legacySale();
  await seating.enrollExisting(db, scope, String(sale._id), {
    request_id: 'legacy-enrollment-002',
    actor: 'staff-1',
  });
  const move = await seating.prepareMove(
    db,
    scope,
    String(sale._id),
    request({
      request_id: 'move-after-enrollment',
      table_ids: [ids[2]],
      primary_id: ids[2],
      guests: 2,
    })
  );
  await seating.completeMove(db, scope, move.id, 'staff-1');
  const saved = await db.collection('sales').findOne({ _id: sale._id });
  expect(saved.table_number).toBe('T3');
  expect(saved.items).toEqual(sale.items);
  expect(saved.changes).toEqual(sale.changes);
  expect(saved.sales_total).toBe(120);
});
test('interrupted enrollment resumes its existing claim without duplicating the sale', async () => {
  const sale = await legacySale(),
    input = { request_id: 'legacy-enrollment-003', actor: 'staff-1' };
  const interrupted = {
    collection(name) {
      const collection = db.collection(name);
      return new Proxy(collection, {
        get(target, key) {
          if (name === 'sales' && key === 'updateOne')
            return async (filter, update, ...rest) => {
              if (update.$set?.seating_request_id) throw new Error('interrupted enrollment');
              return target.updateOne(filter, update, ...rest);
            };
          const value = target[key];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
  await expect(seating.enrollExisting(interrupted, scope, String(sale._id), input)).rejects.toThrow(
    'interrupted enrollment'
  );
  expect((await seating.find(db, scope, input.request_id)).state).toBe('reserved');
  await expect(
    seating.bind(db, scope, input.request_id, 'staff-1', String(sale._id))
  ).rejects.toMatchObject({ status: 409 });
  await expect(seating.cancel(db, scope, input.request_id, 'staff-1')).rejects.toMatchObject({
    status: 409,
  });
  await expect(
    seating.forOrder(db, scope, {
      request_id: input.request_id,
      actor: 'staff-1',
      table: 'T1',
      guests: 2,
    })
  ).rejects.toMatchObject({ status: 409 });
  await expect(seating.forEdit(db, scope, sale, { guests: 2 })).rejects.toMatchObject({
    status: 409,
  });
  await seating.enrollExisting(db, scope, String(sale._id), input);
  expect(
    (await seating.read(db, scope)).filter((row) => row.adopt_order === String(sale._id))
  ).toHaveLength(1);
  expect(
    (await db.collection('sales').findOne({ _id: sale._id })).captain_payment_plan
  ).toBeUndefined();
});
test('legacy enrollment rejects foreign scope and cannot reuse another staff request', async () => {
  const sale = await legacySale(),
    input = { request_id: 'legacy-enrollment-004', actor: 'staff-1' };
  await expect(
    seating.enrollExisting(db, { ...scope, branchId: new ObjectId() }, String(sale._id), input)
  ).rejects.toMatchObject({ status: 409 });
  await seating.enrollExisting(db, scope, String(sale._id), input);
  await expect(
    seating.enrollExisting(db, scope, String(sale._id), { ...input, actor: 'staff-2' })
  ).rejects.toMatchObject({ status: 409 });
});

test('staff table move enrolls an older sale without resubmitting its dishes', async () => {
  const sale = await legacySale();
  const input = request({
    request_id: 'legacy-auto-move-001',
    table_ids: [ids[2]],
    primary_id: ids[2],
    guests: 2,
  });
  const move = await seating.prepareMove(db, scope, String(sale._id), input, {
    staffHandover: true,
  });
  await seating.completeMove(db, scope, move.id, 'staff-1');
  expect(
    (await seating.prepareMove(db, scope, String(sale._id), input, { staffHandover: true })).id
  ).toBe(move.id);
  await seating.completeMove(db, scope, move.id, 'staff-1');
  const saved = await db.collection('sales').findOne({ _id: sale._id });
  expect(saved.table_number).toBe('T3');
  for (const key of [
    'items',
    'changes',
    'sales_total',
    'payment_status',
    'kitchen_service',
    'kitchen_work',
  ])
    expect(saved[key]).toEqual(sale[key]);
  expect(saved.captain_payment_plan).toBeUndefined();
  expect(await db.collection('sales').countDocuments()).toBe(1);
});

test('cancelling an older order move before preparation prevents late enrollment', async () => {
  const sale = await legacySale(),
    id = 'legacy-auto-cancel-001';
  await seating.cancelMove(db, scope, id, 'staff-1', String(sale._id), { staffHandover: true });
  await seating.cancelMove(db, scope, id, 'staff-1', String(sale._id), { staffHandover: true });
  await expect(
    seating.prepareMove(
      db,
      scope,
      String(sale._id),
      request({ request_id: id, table_ids: [ids[2]], primary_id: ids[2], guests: 2 }),
      { staffHandover: true }
    )
  ).rejects.toMatchObject({ status: 409 });
  expect(await db.collection('sales').findOne({ _id: sale._id })).toEqual(sale);
});

test('legacy auto-enrollment requires authorized staff handover and the original branch', async () => {
  const sale = await legacySale();
  const input = request({
    request_id: 'legacy-auto-scope-001',
    table_ids: [ids[2]],
    primary_id: ids[2],
    guests: 2,
  });
  await expect(seating.prepareMove(db, scope, String(sale._id), input)).rejects.toMatchObject({
    status: 409,
  });
  await expect(
    seating.prepareMove(db, { ...scope, branchId: new ObjectId() }, String(sale._id), input, {
      staffHandover: true,
    })
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    seating.cancelMove(db, scope, input.request_id, 'staff-1', String(sale._id))
  ).rejects.toMatchObject({ status: 403 });
  expect(await db.collection('sales').findOne({ _id: sale._id })).toEqual(sale);
});

test('cancelling an interrupted legacy move recovers enrollment and releases the sale', async () => {
  const sale = await legacySale(),
    id = 'legacy-auto-recover-001';
  const interrupted = {
    collection(name) {
      const collection = db.collection(name);
      return new Proxy(collection, {
        get(target, key) {
          if (name === 'sales' && key === 'updateOne')
            return async (filter, update, ...rest) => {
              if (update.$set?.seating_request_id) throw new Error('interrupted enrollment');
              return target.updateOne(filter, update, ...rest);
            };
          const value = target[key];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
  await expect(
    seating.prepareMove(
      interrupted,
      scope,
      String(sale._id),
      request({ request_id: id, table_ids: [ids[2]], primary_id: ids[2], guests: 2 }),
      { staffHandover: true }
    )
  ).rejects.toThrow('interrupted enrollment');
  await seating.cancelMove(db, scope, id, 'staff-1', String(sale._id), { staffHandover: true });
  await seating.cancelMove(db, scope, id, 'staff-1', String(sale._id), { staffHandover: true });
  const saved = await db.collection('sales').findOne({ _id: sale._id });
  expect(saved.table_number).toBe('T1');
  expect(saved.items).toEqual(sale.items);
  expect(saved.captain_payment_plan).toBeUndefined();
  expect((await seating.find(db, scope, id)).state).toBe('cancelled');
  expect(
    (await seating.read(db, scope)).filter((row) => row.adopt_order === String(sale._id))
  ).toHaveLength(1);
});

test.each([
  'capacity-reserved',
  'applying',
  'revision-written',
  'capacity-released',
  'completed',
  'fence-released',
])(
  'guest change recovers a lost acknowledgement after %s without leaving blocked seating',
  async (point) => {
    const order = await movableOrder(),
      input = { request_id: 'cover-recovery-check-1', actor: 'staff-1', guests: 5 };
    let injected = false;
    const interrupted = {
      collection(name) {
        const collection = db.collection(name);
        return new Proxy(collection, {
          get(target, key) {
            if (['updateOne', 'updateMany'].includes(key))
              return async (filter, update, ...rest) => {
                const result = await target[key](filter, update, ...rest);
                const matches = {
                  'capacity-reserved':
                    name === 'table_seating' && update.$set?.['claims.$.guest_update'],
                  applying: name === 'captain_payment_plans' && update.$set?.stage === 'applying',
                  'revision-written': name === 'sales' && update.$set?.seating_capacity_revision,
                  'capacity-released':
                    name === 'table_seating' && update.$unset?.['claims.$.guest_update'] === '',
                  completed: name === 'captain_payment_plans' && update.$set?.stage === 'completed',
                  'fence-released': name === 'sales' && update.$unset?.captain_payment_plan === '',
                };
                if (!injected && matches[point]) {
                  injected = true;
                  throw new Error('lost database acknowledgement');
                }
                return result;
              };
            const value = target[key];
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      },
    };
    await expect(
      seating.changeGuests(interrupted, scope, String(order._id), input)
    ).rejects.toThrow('lost database acknowledgement');
    expect(injected).toBe(true);
    await seating.changeGuests(db, scope, String(order._id), input);
    await seating.changeGuests(db, scope, String(order._id), input);
    const saved = await db.collection('sales').findOne({ _id: order._id });
    expect(saved.person_count).toBe(5);
    expect(saved.captain_audit).toHaveLength(1);
    expect(saved.captain_payment_plan).toBeUndefined();
    expect(saved.seating_capacity_revision).toBe(input.request_id);
    expect((await seating.find(db, scope, order.seating_request_id)).guest_update).toBeUndefined();
    expect(
      (
        await require('../../../src/services/captain-restructure-lock').read(
          db,
          scope,
          input.request_id,
          'staff-1'
        )
      ).stage
    ).toBe('completed');
  }
);

test('unclaimed guest edits include other checks and pending seats without double counting', async () => {
  await db
    .collection('tableorder')
    .updateOne({ _id: new ObjectId(ids[0]) }, { $set: { max_capacity: 8 } });
  const bound = await seating.reserve(
    db,
    scope,
    request({ table_ids: [ids[0]], primary_id: ids[0], guests: 2 })
  );
  const otherId = new ObjectId();
  await seating.bind(db, scope, bound.id, 'staff-1', String(otherId));
  const order = {
    _id: new ObjectId(),
    branch_id: scope.branchId,
    license: scope.license,
    table_number: 'T1',
    person_count: 1,
    sale_process: 'KOT',
    payment_status: 'Unpaid',
    dine_type: 'Dine-in',
  };
  await db
    .collection('sales')
    .insertMany([
      order,
      { ...order, _id: otherId, person_count: 3, seating_request_id: bound.id },
      { ...order, _id: new ObjectId(), branch_id: new ObjectId(), person_count: 100 },
      { ...order, _id: new ObjectId(), license: new ObjectId(), person_count: 100 },
      { ...order, _id: new ObjectId(), person_count: 100, floor_closed_at: new Date() },
    ]);
  await expect(seating.forEdit(db, scope, order, { guests: 5 })).resolves.toBeNull();
  await expect(seating.forEdit(db, scope, order, { guests: 6 })).rejects.toThrow('enough seats');
  // A pending reservation consumes seats before it has a sale. Add it to the
  // branch snapshot to isolate edit validation from reservation policy.
  await db.collection('table_seating').updateOne(
    { 'claims.id': bound.id },
    {
      $push: {
        claims: {
          id: 'pending-shared-seats',
          state: 'reserved',
          tables: [ids[0]],
          labels: ['T1'],
          guests: 1,
        },
      },
    }
  );
  await expect(seating.forEdit(db, scope, order, { guests: 4 })).resolves.toBeNull();
  await expect(seating.forEdit(db, scope, order, { guests: 5 })).rejects.toThrow('enough seats');
  await db
    .collection('table_seating')
    .updateOne({ 'claims.id': bound.id }, { $set: { 'claims.$.guest_update': 'another-update' } });
  await expect(seating.forEdit(db, scope, order, { guests: 2 })).rejects.toMatchObject({
    status: 409,
  });
  await expect(seating.forEdit(db, scope, order, { guests: 1 })).resolves.toBeNull();
  await expect(
    seating.forEdit(db, scope, { ...order, person_count: 12 }, { guests: 11 })
  ).resolves.toBeNull();
  for (const guests of [0, -1, 1.5, 'bad', 1001])
    await expect(seating.forEdit(db, scope, order, { guests })).rejects.toThrow('number of guests');
});

describe.each([true, false])('cover preflight with claimed order %s', (claimed) => {
  test.each([
    { guest_update: 'pending-guests' },
    { moving_to: 'pending-move' },
    { closing: true },
    { state: 'applying' },
    { state: 'releasing' },
    { state: 'reserved', move_from: 'old-seat' },
    { state: 'reserved', adopt_order: 'legacy-order' },
  ])('does not increase covers during an overlapping transition %j', async (transition) => {
    const order = await movableOrder();
    if (!claimed) {
      await db.collection('table_seating').updateOne({}, { $set: { claims: [] } });
      await db
        .collection('sales')
        .updateOne({ _id: order._id }, { $unset: { seating_request_id: '' } });
      delete order.seating_request_id;
    }
    await db.collection('table_seating').updateOne(
      {},
      {
        $push: {
          claims: {
            id: 'overlapping-transition',
            state: 'submitting',
            tables: [ids[0]],
            labels: ['T1'],
            guests: 0,
            ...transition,
          },
        },
      }
    );
    const before = await db.collection('sales').findOne({ _id: order._id });
    await expect(seating.forEdit(db, scope, order, { guests: 5 })).rejects.toMatchObject({
      status: 409,
    });
    // Item-only corrections and reducing an existing party consume no new seats.
    await expect(seating.forEdit(db, scope, order, { guests: 4 })).resolves.toBeDefined();
    await expect(seating.forEdit(db, scope, order, { guests: 3 })).resolves.toBeDefined();
    expect(await db.collection('sales').findOne({ _id: order._id })).toEqual(before);
  });
});

test.each(['KOT', 'Add', 'Edit'])(
  'cover changes count a paid %s neighbour without modifying its bill',
  async (process) => {
    const { source, target, input } = await mergeOrders();
    const move = await seating.prepareMove(db, scope, String(source._id), input, {
      mergeTargetId: String(target._id),
    });
    await seating.completeMove(db, scope, move.id, 'staff-1');
    await db.collection('table_seating').updateOne({}, { $set: { 'claims.$[].max_capacity': 4 } });
    await db.collection('sales').updateOne(
      { _id: target._id },
      {
        $set: {
          floor_lifecycle: true,
          payment_status: 'Paid',
          sale_process: process,
          paid_amount: 12,
        },
      }
    );
    const before = await db.collection('sales').findOne({ _id: target._id });
    await expect(
      seating.changeGuests(db, scope, String(source._id), {
        request_id: 'paid-neighbour-over-capacity',
        actor: 'staff-1',
        guests: 3,
      })
    ).rejects.toThrow('enough seats');
    expect(await db.collection('sales').findOne({ _id: target._id })).toEqual(before);
    const change = { request_id: 'paid-neighbour-valid-covers', actor: 'staff-1', guests: 2 };
    await seating.changeGuests(db, scope, String(source._id), change);
    await seating.changeGuests(db, scope, String(source._id), change);
    const after = await db.collection('sales').findOne({ _id: target._id });
    expect(after).toEqual({ ...before, seating_capacity_revision: change.request_id });
    const edited = await db.collection('sales').findOne({ _id: source._id });
    expect(edited.person_count).toBe(2);
    expect(edited.captain_audit.filter((entry) => entry.action === 'guests')).toHaveLength(1);
    expect(
      await db.collection('sales').countDocuments({ captain_payment_plan: { $exists: true } })
    ).toBe(0);
  }
);

async function legacyCapacityPair() {
  const orders = [1, 2].map(() => ({
    _id: new ObjectId(),
    branch_id: scope.branchId,
    license: scope.license,
    table_number: 'T1',
    person_count: 1,
    sale_process: 'KOT',
    payment_status: 'Unpaid',
  }));
  await db.collection('sales').insertMany(orders);
  return orders;
}
function commitCapacityEdit(order, permit, guests) {
  return db.collection('sales').updateOne(
    {
      _id: order._id,
      person_count: order.person_count,
      seating_capacity_revision: order.seating_capacity_revision ?? { $exists: false },
    },
    { $set: { person_count: guests, seating_capacity_revision: permit.id } }
  );
}

test('legacy capacity permits reserve the last seat atomically across two different checks', async () => {
  const orders = await legacyCapacityPair();
  const attempts = await Promise.allSettled(
    orders.map((order) => seating.reserveEditCapacity(db, scope, order, { guests: 2 }))
  );
  expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const index = attempts.findIndex((result) => result.status === 'fulfilled');
  const permit = attempts[index].value;
  expect(permit.guests).toBe(1);
  expect((await commitCapacityEdit(orders[index], permit, 2)).modifiedCount).toBe(1);
  await seating.reconcileEditCapacity(db, scope, permit.id);
  await expect(
    seating.reserveEditCapacity(db, scope, orders[1 - index], { guests: 2 })
  ).rejects.toThrow('enough seats');
  expect(
    (await db.collection('sales').find({}).toArray()).reduce((n, row) => n + row.person_count, 0)
  ).toBe(3);
});

test('expired legacy capacity permits fence delayed writes before releasing the seat', async () => {
  const [order, other] = await legacyCapacityPair();
  const now = new Date('2026-10-01T06:00:00Z');
  const permit = await seating.reserveEditCapacity(db, scope, order, { guests: 2 }, { now });
  await seating.reconcileExpiredEditCapacity(db, scope, new Date(now.getTime() + 300001));
  expect((await commitCapacityEdit(order, permit, 2)).matchedCount).toBe(0);
  const next = await seating.reserveEditCapacity(db, scope, other, { guests: 2 });
  expect((await commitCapacityEdit(other, next, 2)).modifiedCount).toBe(1);
  await seating.reconcileEditCapacity(db, scope, next.id);
  expect(await seating.read(db, scope)).toEqual([]);
});

test('an unexpired permit remains counted and a committed permit reconciles without changing the order', async () => {
  const [order, other] = await legacyCapacityPair();
  const now = new Date('2026-10-01T06:00:00Z');
  const permit = await seating.reserveEditCapacity(db, scope, order, { guests: 2 }, { now });
  await seating.reconcileExpiredEditCapacity(db, scope, new Date(now.getTime() + 299999));
  await expect(seating.reserveEditCapacity(db, scope, other, { guests: 2 })).rejects.toThrow(
    'enough seats'
  );
  await commitCapacityEdit(order, permit, 2);
  const before = await db.collection('sales').findOne({ _id: order._id });
  await seating.reconcileEditCapacity(db, scope, permit.id);
  await seating.reconcileEditCapacity(db, scope, permit.id);
  expect(await db.collection('sales').findOne({ _id: order._id })).toEqual(before);
});

test('lost acknowledgement while fencing an abandoned edit retains capacity until safe retry', async () => {
  const [order] = await legacyCapacityPair();
  const permit = await seating.reserveEditCapacity(db, scope, order, { guests: 2 });
  const interrupted = {
    collection(name) {
      const collection = db.collection(name);
      return new Proxy(collection, {
        get(target, property) {
          if (name === 'sales' && property === 'updateOne')
            return async (...args) => {
              await collection.updateOne(...args);
              throw new Error('lost fence acknowledgement');
            };
          const value = target[property];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
  await expect(seating.reconcileEditCapacity(interrupted, scope, permit.id)).rejects.toThrow(
    'lost fence'
  );
  expect((await seating.read(db, scope)).some((row) => row.id === permit.id)).toBe(true);
  expect((await commitCapacityEdit(order, permit, 2)).matchedCount).toBe(0);
  await seating.reconcileEditCapacity(db, scope, permit.id);
  expect(await seating.read(db, scope)).toEqual([]);
});

test('reductions need no extra capacity and a different branch cannot reconcile a permit', async () => {
  const [order] = await legacyCapacityPair();
  expect(await seating.reserveEditCapacity(db, scope, order, { guests: 1 })).toBeNull();
  const permit = await seating.reserveEditCapacity(db, scope, order, { guests: 2 });
  await seating.reconcileEditCapacity(db, { ...scope, branchId: new ObjectId() }, permit.id);
  expect((await seating.read(db, scope)).some((row) => row.id === permit.id)).toBe(true);
  expect((await commitCapacityEdit(order, permit, 2)).matchedCount).toBe(1);
});

test('capacity reconciliation waits for another durable operation instead of altering its fenced snapshot', async () => {
  const [order] = await legacyCapacityPair();
  const permit = await seating.reserveEditCapacity(db, scope, order, { guests: 2 });
  await db
    .collection('sales')
    .updateOne(
      { _id: order._id },
      { $set: { captain_payment_plan: 'restructure:other-operation' } }
    );
  const before = await db.collection('sales').findOne({ _id: order._id });
  await expect(seating.reconcileEditCapacity(db, scope, permit.id)).rejects.toMatchObject({
    status: 409,
  });
  expect(await db.collection('sales').findOne({ _id: order._id })).toEqual(before);
  await expect(
    seating.reconcileExpiredEditCapacity(db, scope, new Date(Date.now() + 600000))
  ).resolves.toBeUndefined();
  expect(await db.collection('sales').findOne({ _id: order._id })).toEqual(before);
  expect((await seating.read(db, scope)).some((row) => row.id === permit.id)).toBe(true);
  await db
    .collection('sales')
    .updateOne({ _id: order._id }, { $unset: { captain_payment_plan: '' } });
  await seating.reconcileEditCapacity(db, scope, permit.id);
  expect((await commitCapacityEdit(order, permit, 2)).matchedCount).toBe(0);
});

// A table/type change reserves the full party at its destination, not merely
// the increase relative to the old party size.
test.each(['other table', 'takeaway'])(
  'legacy %s conversion reserves all destination seats',
  async (source) => {
    const [order] = await legacyCapacityPair();
    const original =
      source === 'takeaway'
        ? { ...order, table_number: '', dine_type: 'Take away', person_count: 2 }
        : { ...order, table_number: 'T2', person_count: 2 };
    await db.collection('sales').replaceOne({ _id: order._id }, original);
    const permit = await seating.reserveEditCapacity(db, scope, original, {
      table: 'T1',
      dine_type: 'Dine-in',
      guests: 2,
    });
    expect(permit.guests).toBe(2);
    await expect(
      seating.reserveEditCapacity(db, scope, original, {
        table: 'T1',
        dine_type: 'Dine-in',
        guests: 2,
      })
    ).rejects.toThrow('enough seats');
    await seating.reconcileEditCapacity(db, scope, permit.id);
  }
);

test('activating a parked sale reserves its entire party even when its table and guest count stay unchanged', async () => {
  const [order] = await legacyCapacityPair();
  const held = { ...order, sale_process: 'Hold', person_count: 2 };
  await db.collection('sales').replaceOne({ _id: order._id }, held);
  const permit = await seating.reserveEditCapacity(db, scope, held, {
    guests: 2,
    table: 'T1',
    sale_process: 'KOT',
  });
  expect(permit.guests).toBe(2);
  await expect(
    seating.reserveEditCapacity(db, scope, held, {
      guests: 2,
      table: 'T1',
      sale_process: 'KOT',
    })
  ).rejects.toThrow('enough seats');
  await seating.reconcileEditCapacity(db, scope, permit.id);
  expect((await commitCapacityEdit(held, permit, 2)).matchedCount).toBe(0);
});
