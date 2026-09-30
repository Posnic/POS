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
