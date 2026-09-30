const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
const service = require('../../../src/services/captain-tables');
let server, db, branch, license, user;
beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri('captain-tables'));
  db = mongoose.connection.db;
}, 60000);
afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});
beforeEach(async () => {
  await db.dropDatabase();
  branch = new ObjectId();
  license = new ObjectId();
  user = new ObjectId();
  await db.collection('branches').insertOne({ _id: branch, license });
});
const req = (body = {}, role = 'manager') => ({
  db,
  body,
  user: { _id: user, role, access: { sales: { write: true } } },
  tenantContext: { branchId: branch, licenseId: license },
});
test('manager creates and updates table metadata with optimistic conflict checks', async () => {
  const row = await service.update(
    req({ tableorder_value: 'T1', capacity: 4, max_capacity: 6, shape: 'round', area: 'Garden' })
  );
  expect(row.capacity).toBe(4);
  expect(row.version).toBe(0);
  await service.update(req({ ...row, capacity: 5 }));
  await expect(service.update(req({ ...row, capacity: 6 }))).rejects.toThrow('Table changed');
  expect((await service.list(req())).tables[0].capacity).toBe(5);
});
test('staff cannot alter table settings but can mark a free table ready after cleaning', async () => {
  await expect(service.update(req({ tableorder_value: 'T1' }, 'staff'))).rejects.toThrow(
    'Permission'
  );
  const row = await service.update(req({ tableorder_value: 'T1' }));
  const cleaning = await service.state(
    req({ id: row.id, version: 0, status: 'cleaning' }, 'staff')
  );
  expect(cleaning.status).toBe('cleaning');
  const ready = await service.state(req({ id: row.id, version: 1, status: 'available' }, 'staff'));
  expect(ready.status).toBe('available');
});
test('open orders prevent renaming and marking occupied tables available', async () => {
  const row = await service.update(req({ tableorder_value: 'T1' }));
  await db.collection('sales').insertOne({
    branch_id: branch,
    license,
    table_number: 'T1',
    sale_process: 'KOT',
    payment_status: 'Unpaid',
  });
  await expect(service.state(req({ id: row.id, version: 0, status: 'available' }))).rejects.toThrow(
    'open order'
  );
  await expect(service.update(req({ ...row, tableorder_value: 'T2' }))).rejects.toThrow('renaming');
  expect((await service.list(req())).tables[0].status).toBe('occupied');
});

test('concurrent creation never creates two tables with the same identity', async () => {
  const results = await Promise.allSettled([
    service.update(req({ tableorder_value: 'T1' })),
    service.update(req({ tableorder_value: 't1' })),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.find((result) => result.status === 'rejected').reason.message).toContain(
    'already exists'
  );
  expect(await db.collection('tableorder').countDocuments({})).toBe(1);
});
test('occupied table capacity cannot be reduced below its seated party', async () => {
  const row = await service.update(req({ tableorder_value: 'T1', capacity: 6, max_capacity: 6 }));
  await db.collection('sales').insertOne({
    branch_id: branch,
    license,
    table_number: 'T1',
    sale_process: 'KOT',
    payment_status: 'Unpaid',
    person_count: 5,
  });
  await expect(service.update(req({ ...row, capacity: 2, max_capacity: 2 }))).rejects.toThrow(
    'enough seats'
  );
  expect((await service.list(req())).tables[0].max_capacity).toBe(6);
});

async function paidTable() {
  const table = await service.update(req({ tableorder_value: 'T1', capacity: 4, max_capacity: 4 }));
  const orderId = new ObjectId();
  await db.collection('sales').insertOne({
    _id: orderId,
    branch_id: branch,
    license,
    table_number: 'T1',
    sale_process: 'KOT',
    payment_status: 'Paid',
    paid_amount: 200,
    sales_total: 200,
    balance: 0,
    payment_pending: 0,
    items: [{ item_id: 'dish', item_quantity: 2 }],
    kitchen_required: true,
    floor_lifecycle: true,
  });
  return {
    table,
    orderId,
    body: {
      id: table.id,
      version: 0,
      request_id: 'close-request-0001',
      orderIds: [String(orderId)],
    },
  };
}
test('closing paid orders preserves payment and stock data and leaves the table for cleaning', async () => {
  const { orderId, body } = await paidTable();
  const result = await service.close(req(body));
  expect(result.status).toBe('cleaning');
  expect(result.orders).toEqual([]);
  const sale = await db.collection('sales').findOne({ _id: orderId });
  expect(sale.payment_status).toBe('Paid');
  expect(sale.paid_amount).toBe(200);
  expect(sale.items).toEqual([{ item_id: 'dish', item_quantity: 2 }]);
  expect(sale.kitchen_closed).toBe(true);
  expect(sale.floor_closed_at).toBeInstanceOf(Date);
  const replay = await service.close(req(body));
  expect(replay.version).toBe(result.version);
  const ready = await service.state(
    req({ id: body.id, version: result.version, status: 'available' })
  );
  expect(ready.status).toBe('available');
});
test('printing or a partially paid bill cannot close an order', async () => {
  const { orderId, body } = await paidTable();
  await db
    .collection('sales')
    .updateOne(
      { _id: orderId },
      { $set: { payment_status: 'Unpaid', bill_printed_at: new Date(), balance: 50 } }
    );
  await expect(service.close(req(body))).rejects.toThrow('remaining payment');
  expect((await db.collection('sales').findOne({ _id: orderId })).floor_closed_at).toBeUndefined();
  expect((await service.list(req())).tables[0].status).toBe('occupied');
});
test('a lost close reply can be replayed without another closure or freeing a newly seated order', async () => {
  const { body } = await paidTable();
  await service.close(req(body));
  await db.collection('sales').insertOne({
    branch_id: branch,
    license,
    table_number: 'T1',
    sale_process: 'KOT',
    payment_status: 'Unpaid',
  });
  const replay = await service.close(req(body));
  expect(replay.status).toBe('occupied');
  expect(replay.orders).toHaveLength(1);
  expect(replay.orders[0].paid).toBe(false);
});
test('a newly added order invalidates the close preview before any order changes', async () => {
  const { body, orderId } = await paidTable();
  await db.collection('sales').insertOne({
    branch_id: branch,
    license,
    table_number: 'T1',
    sale_process: 'KOT',
    payment_status: 'Unpaid',
  });
  await expect(service.close(req(body))).rejects.toThrow('Table changed');
  expect((await db.collection('sales').findOne({ _id: orderId })).floor_closed_at).toBeUndefined();
});

test('closure resumes its durable intent after interruption', async () => {
  const { body } = await paidTable();
  const collection = db.collection.bind(db);
  let interrupted = false;
  const input = req(body);
  input.db = {
    collection(name) {
      const original = collection(name);
      if (name !== 'sales') return original;
      return new Proxy(original, {
        get(target, key) {
          if (key === 'updateMany')
            return async (...args) => {
              if (!interrupted) {
                interrupted = true;
                throw new Error('connection interrupted');
              }
              return target.updateMany(...args);
            };
          const value = target[key];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
  await expect(service.close(input)).rejects.toThrow('interrupted');
  const pending = (await service.list(req())).tables[0];
  expect(pending.closing.request_id).toBe(body.request_id);
  await expect(
    service.state(req({ id: body.id, version: pending.version, status: 'available' }))
  ).rejects.toThrow('Table changed');
  const recovered = await service.close(req({ ...body, version: pending.version }));
  expect(recovered.status).toBe('cleaning');
  expect(recovered.closing).toBeNull();
});

test('paid legacy receipts stay closed on upgrade while newly paid floor orders remain for cleaning', async () => {
  const table = await service.update(req({ tableorder_value: 'T1' }));
  await db.collection('sales').insertOne({
    branch_id: branch,
    license,
    table_number: 'T1',
    sale_process: 'KOT',
    payment_status: 'Paid',
  });
  expect((await service.list(req())).tables[0].status).toBe('available');
  await db.collection('sales').insertOne({
    branch_id: branch,
    license,
    table_number: 'T1',
    sale_process: 'Add',
    payment_status: 'Paid',
    floor_lifecycle: true,
  });
  expect((await service.list(req())).tables[0].status).toBe('occupied');
});
