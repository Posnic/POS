const { MongoMemoryServer } = require('mongodb-memory-server');
const { ObjectId } = require('mongodb');
const mongoose = require('mongoose');
const { allocate, reserve } = require('../../../src/services/takeaway-number');
let server, db, scope;
beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri('takeaway-number'));
  db = mongoose.connection.db;
}, 60000);
afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});
beforeEach(async () => {
  await db.dropDatabase();
  scope = { branchId: new ObjectId(), license: new ObjectId() };
});
test('starts at one and increases across devices, retaining numbers on retries', async () => {
  expect(await allocate(db, scope, 'phone-one')).toBe(1);
  expect(await allocate(db, scope, 'phone-two')).toBe(2);
  expect(await allocate(db, scope, 'phone-one')).toBe(1);
  expect(await allocate(db, scope, 'phone-three')).toBe(3);
});
test('concurrent phones cannot share a number and concurrent retries do not consume numbers', async () => {
  const numbers = await Promise.all(
    Array.from({ length: 20 }, (_, i) => allocate(db, scope, 'draft-' + i))
  );
  expect(numbers.sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  expect(
    await Promise.all(Array.from({ length: 10 }, () => allocate(db, scope, 'same-draft')))
  ).toEqual(Array(10).fill(21));
  expect(await allocate(db, scope, 'next')).toBe(22);
});
test('branch sequences are independent and a reservation cannot be reused for a different order', async () => {
  expect(await allocate(db, scope, 'draft', 'order-1')).toBe(1);
  expect(await allocate(db, scope, 'draft', 'order-1')).toBe(1);
  await expect(allocate(db, scope, 'draft', 'order-2')).rejects.toMatchObject({ status: 409 });
  expect(await allocate(db, { ...scope, branchId: new ObjectId() }, 'draft')).toBe(1);
});
test('requires sales permission', async () => {
  await expect(reserve({ db, user: {}, body: { request_id: 'draft' } })).rejects.toMatchObject({
    status: 403,
  });
});

test('reserved numbers persist on actual sales, old clients also receive sequential numbers', async () => {
  const BaseModel = require('../../../src/models/base.model');
  const repo = require('../../../src/repositories/sale.repository');
  const item = new ObjectId();
  await db.collection('branches').insertOne({
    _id: scope.branchId,
    license: scope.license,
    name: 'Test shop',
    online_ordering: { store_id: 'SEQUENCE', mode: 'order' },
  });
  await db.collection('items').insertOne({
    _id: item,
    branch_id: scope.branchId,
    license: scope.license,
    name: 'Rice',
    selling_price: 100,
    tax: 0,
    tax_type: 'exclusive',
  });
  const dbSpy = jest.spyOn(BaseModel, 'getDb').mockResolvedValue(db);
  let receipt = 0;
  const numberSpy = jest
    .spyOn(repo, 'generateSalesIdForBranch')
    .mockImplementation(async () => `TEST-${++receipt}`);
  try {
    expect(await allocate(db, scope, 'reserved-draft')).toBe(1);
    const body = {
      branch: String(scope.branchId),
      dine_type: 'Take away',
      order: 'Take away',
      items: [{ item_id: String(item), item_quantity: 1 }],
      idempotencyKey: 'first-order',
      takeaway_request_id: 'reserved-draft',
      tokenId: 'W938',
    };
    const first = await repo.createOnlineOrder(body, { staffOrder: true });
    if (!first.status) throw new Error(first.message);
    expect(first.data.tokenId).toBe('1');
    const again = await repo.createOnlineOrder(body, { staffOrder: true });
    expect(again.data.sale_id).toBe(first.data.sale_id);
    const next = await repo.createOnlineOrder(
      { ...body, idempotencyKey: 'next-order', takeaway_request_id: undefined },
      { staffOrder: true }
    );
    if (!next.status) throw new Error(next.message);
    expect(next.data.tokenId).toBe('2');
    const sales = await db.collection('sales').find({}).sort({ takeaway_number: 1 }).toArray();
    expect(sales.map((s) => [s.takeaway_number, s.token_id])).toEqual([
      [1, '1'],
      [2, '2'],
    ]);
  } finally {
    dbSpy.mockRestore();
    numberSpy.mockRestore();
  }
});
