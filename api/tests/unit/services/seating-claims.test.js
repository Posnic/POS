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
  const claim = (await seating.read(db, scope))[0];
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
