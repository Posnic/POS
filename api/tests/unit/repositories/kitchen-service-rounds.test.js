'use strict';
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const BaseModel = require('../../../src/models/base.model');
const repository = require('../../../src/repositories/sale.repository');
let memory, collection, branch, id, spy;
beforeAll(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  collection = mongoose.connection.db.collection('sales');
  spy = jest.spyOn(BaseModel, 'getDb').mockResolvedValue(mongoose.connection.db);
}, 60000);
afterAll(async () => {
  spy.mockRestore();
  await mongoose.disconnect();
  await memory.stop();
});
beforeEach(async () => {
  await collection.deleteMany({});
  branch = new mongoose.Types.ObjectId();
  id = new mongoose.Types.ObjectId();
  await collection.insertOne({
    _id: id,
    branch_id: branch,
    sale_process: 'KOT',
    payment_status: 'Unpaid',
    created_date: new Date(),
    items: [{ item_id: 'rice', item_name: 'Rice', item_quantity: 2 }],
    changes: [
      {
        timestamp: new Date(),
        items: [{ item_id: 'rice', item_name: 'Rice', item_quantity: 2, process: 'add' }],
      },
    ],
  });
});
const request = () => ({
  saleId: String(id),
  branchId: String(branch),
  actor: 'staff',
  items: [{ id: 'c0i0', quantity: 1 }],
});
test('wall screen excludes ordinary counter sales before and after payment', async () => {
  const base = await collection.findOne({ _id: id });
  const counterId = new mongoose.Types.ObjectId();
  await collection.insertOne({ ...base, _id: counterId, sale_process: 'Add', table_number: '' });
  let result = await repository.kitchenScreenTickets(String(branch));
  expect(result.status).toBe(true);
  expect(result.data.map((t) => t.id)).toEqual([`${id}:c0`]);
  await collection.updateOne({ _id: counterId }, { $set: { payment_status: 'Paid' } });
  result = await repository.kitchenScreenTickets(String(branch));
  expect(result.data.map((t) => t.id)).toEqual([`${id}:c0`]);
});
test('service persists, retries are idempotent, and the kitchen shows only the remainder', async () => {
  const changed = jest.fn();
  process.on('posnic:kitchen-served', changed);
  try {
    expect((await repository.serveKitchenItems(request())).status).toBe(true);
    expect(changed).toHaveBeenCalledWith({ branchId: String(branch), saleId: String(id) });
    expect((await repository.serveKitchenItems(request())).status).toBe(true);
    const saved = await collection.findOne({ _id: id });
    expect(saved.kitchen_service.c0i0.quantity).toBe(1);
    expect(saved.items[0].item_quantity).toBe(2);
    expect(saved.changes).toHaveLength(1);
    const screen = await repository.kitchenScreenTickets(String(branch));
    expect(screen.status).toBe(true);
    expect(screen.data[0].items[0].qty).toBe(1);
  } finally {
    process.removeListener('posnic:kitchen-served', changed);
  }
});
test('another branch, closed orders, invalid lines and over-serving cannot mutate service', async () => {
  expect(
    (
      await repository.serveKitchenItems({
        ...request(),
        branchId: String(new mongoose.Types.ObjectId()),
      })
    ).status
  ).toBe(false);
  expect(
    (await repository.serveKitchenItems({ ...request(), items: [{ id: 'c0i0', quantity: 3 }] }))
      .status
  ).toBe(false);
  expect(
    (await repository.serveKitchenItems({ ...request(), items: [{ id: 'c99i0', quantity: 1 }] }))
      .status
  ).toBe(false);
  await collection.updateOne({ _id: id }, { $set: { payment_status: 'Paid' } });
  expect((await repository.serveKitchenItems(request())).status).toBe(false);
  expect((await collection.findOne({ _id: id })).kitchen_service).toBeUndefined();
});
test('simultaneous service cannot overwrite another staff update', async () => {
  const results = await Promise.all([
    repository.serveKitchenItems(request()),
    repository.serveKitchenItems({ ...request(), items: [{ id: 'c0i0', quantity: 2 }] }),
  ]);
  expect(results.some((r) => r.status)).toBe(true);
  const final = await repository.serveKitchenItems({
    ...request(),
    items: [{ id: 'c0i0', quantity: 2 }],
  });
  expect(final.status).toBe(true);
  expect((await repository.kitchenScreenTickets(String(branch))).data).toEqual([]);
});
