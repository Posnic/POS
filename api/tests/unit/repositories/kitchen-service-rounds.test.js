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

test('partial and whole cancellations remain visible without showing served food as cancelled', async () => {
  const at = new Date();
  await collection.updateOne(
    { _id: id },
    {
      $set: { kitchen_required: true, 'items.0.item_quantity': 1 },
      $push: {
        changes: {
          timestamp: at,
          items: [{ item_id: 'rice', item_name: 'Rice', item_quantity: 1, process: 'cancel' }],
        },
      },
    }
  );
  let result = await repository.kitchenScreenTickets(String(branch));
  expect(result.data.find((t) => !t.cancelled).items[0].qty).toBe(1);
  expect(result.data.find((t) => t.cancelled)).toMatchObject({
    id: `${id}:cancel1`,
    items: [{ name: 'Rice', qty: 1 }],
  });
  await collection.updateOne(
    { _id: id },
    {
      $set: { sale_process: 'cancelled', payment_status: 'Cancelled' },
      $push: {
        changes: {
          timestamp: new Date(),
          items: [{ item_id: 'rice', item_name: 'Rice', item_quantity: 1, process: 'cancel' }],
        },
      },
    }
  );
  result = await repository.kitchenScreenTickets(String(branch));
  expect(result.data.filter((t) => !t.cancelled)).toHaveLength(0);
  expect(result.data.filter((t) => t.cancelled)).toHaveLength(2);
  expect(
    (await repository.kitchenScreenTickets(String(new mongoose.Types.ObjectId()))).data
  ).toEqual([]);
  await collection.updateOne(
    { _id: id },
    {
      $set: {
        'changes.1.timestamp': new Date(Date.now() - 301000),
        'changes.2.timestamp': new Date(Date.now() - 301000),
      },
    }
  );
  expect((await repository.kitchenScreenTickets(String(branch))).data).toEqual([]);
});

test('wall display carries partial ready, picked-up and served quantities from the touch workflow', async () => {
  await collection.updateOne(
    { _id: id },
    {
      $set: {
        'items.0.item_quantity': 4,
        'changes.0.items.0.item_quantity': 4,
        kitchen_work: { c0: { state: 'preparing', lines: { c0i0: { ready: 3, collected: 2 } } } },
        kitchen_service: { c0i0: { quantity: 1, at: new Date() } },
      },
    }
  );
  let result = await repository.kitchenScreenTickets(String(branch));
  expect(result.data[0].items[0]).toMatchObject({
    qty: 3,
    preparing: 1,
    readyToCollect: 1,
    pickedUp: 1,
    served: 1,
    started: true,
  });
  await collection.updateOne(
    { _id: id },
    { $set: { kitchen_service: { c0i0: { quantity: 4, at: new Date() } } } }
  );
  result = await repository.kitchenScreenTickets(String(branch));
  expect(result.data).toEqual([]);
});

test('mark served waits for order restructuring but remains available during normal payment', async () => {
  await collection.updateOne(
    { _id: id },
    { $set: { captain_payment_plan: 'restructure:test-reservation' } }
  );
  expect((await repository.serveKitchenItems(request())).status).toBe(false);
  expect((await collection.findOne({ _id: id })).kitchen_service).toBeUndefined();
  await collection.updateOne({ _id: id }, { $set: { captain_payment_plan: 'normal-payment' } });
  expect((await repository.serveKitchenItems(request())).status).toBe(true);
});
