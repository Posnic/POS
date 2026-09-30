'use strict';
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
const { check } = require('../../../src/services/table-move-check');
let server, db, order, table;
beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri('move-check'));
  db = mongoose.connection.db;
}, 60000);
afterAll(async () => {
  await mongoose.disconnect();
  await server.stop();
});
beforeEach(async () => {
  await db.dropDatabase();
  order = {
    _id: new ObjectId(),
    branch_id: new ObjectId(),
    license: new ObjectId(),
    person_count: 2,
  };
  table = { _id: new ObjectId(), tableorder_value: '12', capacity: 4, max_capacity: 4 };
});
test('missing, replaced, held, cleaning and closing destinations are rejected', async () => {
  for (const [row, id] of [
    [null, null],
    [table, String(new ObjectId())],
    [{ ...table, service_state: 'held' }, null],
    [{ ...table, service_state: 'cleaning' }, null],
    [{ ...table, floor_close: { completed: false } }, null],
  ])
    await expect(check(db, order, row, { id })).rejects.toMatchObject({ status: 409 });
});
test('current occupants consume seats while closed orders and other branches do not', async () => {
  await db.collection('sales').insertMany([
    { ...order, _id: new ObjectId(), table_number: '12', sale_process: 'KOT', person_count: 3 },
    {
      ...order,
      _id: new ObjectId(),
      table_number: '12',
      sale_process: 'KOT',
      person_count: 50,
      floor_closed_at: new Date(),
    },
    {
      ...order,
      _id: new ObjectId(),
      branch_id: new ObjectId(),
      table_number: '12',
      sale_process: 'KOT',
      person_count: 50,
    },
  ]);
  await expect(check(db, order, table, {})).rejects.toMatchObject({ status: 409 });
  await expect(check(db, order, { ...table, max_capacity: 5 }, {})).resolves.toBeUndefined();
});
test('paid orders still on the floor use seats; the moving order does not count twice', async () => {
  await db.collection('sales').insertMany([
    { ...order, table_number: '12', sale_process: 'KOT' },
    {
      ...order,
      _id: new ObjectId(),
      table_number: '12',
      sale_process: 'Add',
      payment_status: 'Paid',
      floor_lifecycle: true,
      person_count: 3,
    },
  ]);
  await expect(check(db, order, table, {})).rejects.toMatchObject({ status: 409 });
  await expect(check(db, order, { ...table, max_capacity: 5 }, {})).resolves.toBeUndefined();
});
