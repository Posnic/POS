'use strict';
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
const seating = require('../../../src/services/seating-claims');
let server, db, scope, ids;
beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri('seating-claims'));
  db = mongoose.connection.db;
}, 60000);
afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});
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
test('unlimited single-table orders still cannot take a member of a combined group', async () => {
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
  await expect(
    require('../../../src/repositories/sale.repository').save(doc)
  ).rejects.toMatchObject({ name: 'DocumentNotFoundError' });
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
  await require('../../../src/repositories/sale.repository').save(doc);
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
  expect(await seating.find(db, scope, before.id)).toEqual(before);
  await expect(seating.forEdit(db, scope, order, { guests: 7 })).rejects.toThrow('enough seats');
  for (const guests of [0, -1, 1.5, 'abc', 1001])
    await expect(seating.forEdit(db, scope, order, { guests })).rejects.toThrow('number of guests');
  await expect(seating.forEdit(db, scope, order, { guests: 3, table: 'T3' })).rejects.toMatchObject({status:409});
  await expect(seating.forEdit(db, scope, order, { guests: 3, dine_type: 'Take away' })).rejects.toMatchObject({status:409});
});

test('a claimed party can become takeaway and return to a suitable table without new kitchen or money effects', async () => {
  const order = await movableOrder();
  const items = [{item_name:'Soup', item_quantity:2, item_note:'Less salt', line_id:'line-1'}];
  const changes = [{timestamp:new Date('2026-09-30T10:00:00Z'),items:[{...items[0],process:'add'}]}];
  await db.collection('sales').updateOne({_id:order._id},{$set:{items,changes,sales_total:120}});
  const input=request({request_id:'takeaway-request-0001',table_ids:[],primary_id:'',guests:0,dine_type:'Take away'});
  const pending=await seating.prepareMove(db,scope,String(order._id),input);
  expect(pending.tables).toEqual([]);
  expect((await db.collection('sales').findOne({_id:order._id})).table_number).toBe('T1');
  await seating.completeMove(db,scope,pending.id,'staff-1');
  const takeaway=await db.collection('sales').findOne({_id:order._id});
  expect(takeaway).toMatchObject({table_number:'',dine_type:'Take away',person_count:0,items,changes,sales_total:120});
  expect((await seating.prepareMove(db,scope,String(order._id),input)).state).toBe('submitting');
  await seating.completeMove(db,scope,pending.id,'staff-1');
  expect((await db.collection('sales').findOne({_id:order._id})).captain_audit).toHaveLength(1);
  expect(await db.collection('tableorder').countDocuments({service_state:'cleaning'})).toBe(2);
  const seated=await seating.prepareMove(db,scope,String(order._id),request({request_id:'return-table-request-1',table_ids:[ids[2]],primary_id:ids[2],guests:2}));
  await seating.completeMove(db,scope,seated.id,'staff-1');
  const returned=await db.collection('sales').findOne({_id:order._id});
  expect(returned).toMatchObject({table_number:'T3',dine_type:'Dine-in',person_count:2,items,changes,sales_total:120});
  expect(returned.captain_audit).toHaveLength(2);
});
test('takeaway conversion rejects table-bearing, guest-bearing and changed-type retries', async()=>{
  const order=await movableOrder();
  const input=request({request_id:'takeaway-request-0002',table_ids:[],primary_id:'',guests:0,dine_type:'Take away'});
  await expect(seating.prepareMove(db,scope,String(order._id),{...input,table_ids:[ids[0]]})).rejects.toThrow('tables');
  await expect(seating.prepareMove(db,scope,String(order._id),{...input,guests:2})).rejects.toThrow('guests');
  await seating.prepareMove(db,scope,String(order._id),input);
  await expect(seating.prepareMove(db,scope,String(order._id),request({request_id:input.request_id}))).rejects.toThrow('already been used');
  await seating.cancelMove(db,scope,input.request_id,'staff-1',String(order._id));
  expect((await db.collection('sales').findOne({_id:order._id})).table_number).toBe('T1');
});

test('moving one check preserves an occupied source and blocks new seating during the transition even with no order limit', async () => {
  await db.collection('branches').insertOne({_id:scope.branchId,license:scope.license,table_order_limit:0});
  const orders=[];
  for(const n of [1,2]){
    const claim=await seating.reserve(db,scope,request({request_id:'shared-source-seat-'+n,table_ids:[ids[0]],primary_id:ids[0],guests:1}));
    const _id=new ObjectId();await seating.bind(db,scope,claim.id,'staff-1',String(_id));
    const order={_id,branch_id:scope.branchId,license:scope.license,seating_request_id:claim.id,table_number:'T1',person_count:1,sale_process:'KOT',payment_status:'Unpaid'};
    await db.collection('sales').insertOne(order);orders.push(order);
  }
  const move=await seating.prepareMove(db,scope,String(orders[0]._id),request({request_id:'shared-source-move-1',table_ids:[ids[1]],primary_id:ids[1],guests:1}));
  for(const target of [ids[0],ids[1]]) await expect(seating.reserve(db,scope,request({request_id:'concurrent-seat-'+target,table_ids:[target],primary_id:target,guests:1}))).rejects.toMatchObject({status:409});
  await seating.completeMove(db,scope,move.id,'staff-1');
  expect((await db.collection('tableorder').findOne({_id:new ObjectId(ids[0])})).service_state).not.toBe('cleaning');
  expect((await db.collection('sales').findOne({_id:orders[1]._id})).table_number).toBe('T1');
});


test('prepared moves fence payment and release that fence on cancellation or completion', async () => {
  const { order, move } = await movingGroup();
  const guard = require('../../../src/services/captain-payment-guard');
  let sale = await db.collection('sales').findOne({_id:order._id});
  expect(sale.captain_payment_plan).toBe(move.operation_lock);
  await expect(guard.mutable(db, sale)).rejects.toMatchObject({status:409});
  await seating.cancelMove(db,scope,move.id,'staff-1');
  sale=await db.collection('sales').findOne({_id:order._id});
  expect(sale.captain_payment_plan).toBeUndefined();
  const next=await seating.prepareMove(db,scope,String(order._id),request({request_id:'after-cancel-move-1',table_ids:ids.slice(1),primary_id:ids[1]}));
  await seating.completeMove(db,scope,next.id,'staff-1');
  await seating.completeMove(db,scope,next.id,'staff-1');
  sale=await db.collection('sales').findOne({_id:order._id});
  expect(sale.captain_payment_plan).toBeUndefined();
  expect(sale.captain_audit).toHaveLength(1);
});

test('a payment reservation prevents a move without reserving destination seats', async () => {
  const order=await movableOrder();
  await db.collection('sales').updateOne({_id:order._id},{$set:{captain_payment_plan:'cashier-payment'}});
  await expect(seating.prepareMove(db,scope,String(order._id),request({request_id:'payment-race-move-1',table_ids:ids.slice(1),primary_id:ids[1]}))).rejects.toMatchObject({status:409});
  expect((await seating.find(db,scope,order.seating_request_id)).moving_to).toBeUndefined();
  expect((await db.collection('sales').findOne({_id:order._id})).captain_payment_plan).toBe('cashier-payment');
});

test('simultaneous cancellation and completion cannot leave a moved order with cancelled seats', async () => {
  const {order,move}=await movingGroup();
  const results=await Promise.allSettled([
    seating.cancelMove(db,scope,move.id,'staff-1',String(order._id)),
    seating.completeMove(db,scope,move.id,'staff-1'),
  ]);
  expect(results.filter(row=>row.status==='fulfilled')).toHaveLength(1);
  const current=await seating.find(db,scope,move.id);
  const sale=await db.collection('sales').findOne({_id:order._id});
  expect(sale.captain_payment_plan).toBeUndefined();
  expect(sale.seating_request_id).toBe(current.state==='cancelled'?order.seating_request_id:move.id);
});

test('an interrupted completion retains its payment fence until retry finishes the floor', async () => {
  const {order,move}=await movingGroup();
  const locks=require('../../../src/services/captain-restructure-lock');
  await locks.applying(db,scope,move.id,'staff-1');
  await expect(seating.cancelMove(db,scope,move.id,'staff-1')).rejects.toMatchObject({status:409});
  expect((await seating.find(db,scope,move.id)).state).toBe('reserved');
  await seating.completeMove(db,scope,move.id,'staff-1');
  expect((await db.collection('sales').findOne({_id:order._id})).captain_payment_plan).toBeUndefined();
});


test('retry after cancellation was interrupted releases reserved seats instead of reviving the move', async () => {
  const {order,move}=await movingGroup();
  await require('../../../src/services/captain-restructure-lock').cancel(db,scope,move.id,'staff-1');
  await expect(seating.prepareMove(db,scope,String(order._id),request({request_id:move.id,table_ids:ids.slice(1),primary_id:ids[1]}))).rejects.toMatchObject({status:409});
  expect((await seating.find(db,scope,move.id)).state).toBe('cancelled');
  expect((await seating.find(db,scope,order.seating_request_id)).moving_to).toBeUndefined();
});

test('legacy unpaid orders without a payment status can still move without changing their payment data', async () => {
  const order=await movableOrder();
  await db.collection('sales').updateOne({_id:order._id},{$unset:{payment_status:''}});
  const move=await seating.prepareMove(db,scope,String(order._id),request({request_id:'legacy-unpaid-move-1',table_ids:ids.slice(1),primary_id:ids[1]}));
  await seating.completeMove(db,scope,move.id,'staff-1');
  const sale=await db.collection('sales').findOne({_id:order._id});
  expect(sale.payment_status).toBeUndefined();
  expect(sale.captain_payment_plan).toBeUndefined();
  expect(sale.seating_request_id).toBe(move.id);
});


async function mergeOrders() {
  const orders=[];
  for(const [index,guests] of [[0,1],[2,2]]) {
    const claim=await seating.reserve(db,scope,request({request_id:'merge-existing-seat-'+index,table_ids:[ids[index]],primary_id:ids[index],guests}));
    const order={_id:new ObjectId(),branch_id:scope.branchId,license:scope.license,seating_request_id:claim.id,table_number:'T'+(index+1),person_count:guests,sale_process:'KOT',payment_status:'Unpaid',items:[{item_id:'dish-'+index,item_name:'Soup',item_quantity:1,item_price:10+index,item_note:'Note '+index}],sales_sub_total:10+index,sales_total:10+index,changes:[{timestamp:new Date(),items:[]}]};
    await seating.bind(db,scope,claim.id,'staff-1',String(order._id));await db.collection('sales').insertOne(order);orders.push(order);
  }
  return {source:orders[0],target:orders[1],input:request({request_id:'merge-orders-request-1',table_ids:[ids[2]],primary_id:ids[2],guests:1})};
}

test('authorized merge groups existing checks for one table bill without recooking or changing their totals',async()=>{
  const {source,target,input}=await mergeOrders();
  await expect(seating.prepareMove(db,scope,String(source._id),{...input,request_id:'ordinary-move-target-1'})).rejects.toThrow('open order limit');
  const options={mergeTargetId:String(target._id)};
  const prepared=await seating.prepareMove(db,scope,String(source._id),input,options);
  expect(prepared.merge_target).toBe(String(target._id));
  expect(await db.collection('sales').countDocuments({captain_payment_plan:prepared.operation_lock})).toBe(2);
  await seating.completeMove(db,scope,prepared.id,'staff-1');
  await seating.completeMove(db,scope,prepared.id,'staff-1');
  expect(await db.collection('sales').countDocuments({table_number:'T3'})).toBe(2);
  expect(await db.collection('sales').countDocuments({captain_payment_plan:{$exists:true}})).toBe(0);
  const moved=await db.collection('sales').findOne({_id:source._id});
  expect(moved).toMatchObject({items:source.items,changes:source.changes,sales_total:source.sales_total});
  expect(moved.captain_audit).toHaveLength(1);expect(moved.captain_audit[0].action).toBe('merge');
  expect(await db.collection('sales').findOne({_id:target._id})).toEqual(target);
  expect((await db.collection('tableorder').findOne({_id:new ObjectId(ids[0])})).service_state).toBe('cleaning');
  expect((await seating.prepareMove(db,scope,String(source._id),input,options)).state).toBe('submitting');
  await db.collection('branches').insertOne({_id:scope.branchId,license:scope.license,currencyCode:'INR'});
  const req={db,user:{_id:'staff-1',role:'manager'},tenantContext:{branchId:String(scope.branchId),licenseId:String(scope.license)},query:{table:'T3'}};
  const bill=await require('../../../src/services/captain-bill').read(req);
  expect(bill.totalMinor).toBe(2200);expect(bill.dueMinor).toBe(2200);expect(bill.orderIds).toHaveLength(2);expect(bill.guests).toBe(3);
  const floor=await require('../../../src/services/captain-tables').list(req);
  expect(floor.tables.find(row=>row.tableorder_value==='T3').seating.guests).toBe(3);
});

test('merge capacity accounts for both parties and cannot be understated by the caller',async()=>{
  const {source,target,input}=await mergeOrders(), options={mergeTargetId:String(target._id)};
  await expect(seating.prepareMove(db,scope,String(source._id),{...input,guests:2},options)).rejects.toMatchObject({status:409});
  await db.collection('tableorder').updateOne({_id:new ObjectId(ids[2])},{$set:{max_capacity:2}});
  await expect(seating.prepareMove(db,scope,String(source._id),input,options)).rejects.toThrow('enough seats');
  expect(await db.collection('sales').countDocuments({captain_payment_plan:{$exists:true}})).toBe(0);
});

test('cancelled merge preserves both tables and releases both payment fences',async()=>{
  const {source,target,input}=await mergeOrders();
  const prepared=await seating.prepareMove(db,scope,String(source._id),input,{mergeTargetId:String(target._id)});
  await seating.cancelMove(db,scope,prepared.id,'staff-1',String(source._id));
  expect(await db.collection('sales').findOne({_id:source._id})).toEqual(source);
  expect(await db.collection('sales').findOne({_id:target._id})).toEqual(target);
});

test('merge API requires separate permission and rechecks it before completion',async()=>{
  const {source,target,input}=await mergeOrders();
  await db.collection('branches').insertOne({_id:scope.branchId,license:scope.license});
  const service=require('../../../src/services/captain-seating');
  const req={db,user:{_id:'staff-1',role:'staff',access:{sales:{write:true}}},tenantContext:{branchId:String(scope.branchId),licenseId:String(scope.license)},body:{request_id:input.request_id,orderId:String(source._id),targetOrderId:String(target._id),tableIds:input.table_ids,primaryId:input.primary_id,guests:1}};
  await expect(service.merge(req)).rejects.toMatchObject({status:403});
  req.user.role='manager';const result=await service.merge(req);expect(result.mergeTargetId).toBe(String(target._id));
  req.user.role='staff';await expect(service.complete(req)).rejects.toMatchObject({status:403});
  await service.cancel(req);
  expect(await db.collection('sales').countDocuments({captain_payment_plan:{$exists:true}})).toBe(0);
});
