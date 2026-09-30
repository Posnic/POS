'use strict';
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
const BaseModel = require('../../../src/models/base.model');
const repo = require('../../../src/repositories/sale.repository');
const seating = require('../../../src/services/seating-claims');
const { runWithRequestContext } = require('../../../src/utils/request-context');
jest.mock('../../../src/helpers/kot-notify', () => ({ notifyKotReady: jest.fn() }));
jest.mock('../../../src/helpers/order-attention', () => ({
  notifyOrderAttention: jest.fn(),
  notifyOrderResolved: jest.fn(),
}));
let server,
  db,
  branch,
  license,
  actor,
  item,
  tables,
  claim,
  number = 0;
beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri('combined-order'));
  db = mongoose.connection.db;
}, 60000);
afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});
afterEach(() => jest.restoreAllMocks());
beforeEach(async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  await db.dropDatabase();
  branch = new ObjectId();
  license = new ObjectId();
  actor = String(new ObjectId());
  item = new ObjectId();
  tables = [new ObjectId(), new ObjectId()];
  jest.spyOn(BaseModel, 'getDb').mockResolvedValue(db);
  jest.spyOn(repo, 'generateSalesIdForBranch').mockImplementation(async () => `TEST-${++number}`);
  await db.collection('branches').insertOne({
    _id: branch,
    license,
    name: 'Restaurant',
    table_options: true,
    table_order_limit: 1,
    online_ordering: { store_id: 'SHOP1', mode: 'order' },
  });
  await db.collection('tableorder').insertMany(
    tables.map((id, i) => ({
      _id: id,
      branch_id: branch,
      license,
      tableorder_value: `T${i + 1}`,
      capacity: 2,
      max_capacity: 2,
      adjacent_table_ids: i === 0 ? [String(tables[1])] : [],
    }))
  );
  await db.collection('items').insertOne({
    _id: item,
    branch_id: branch,
    license,
    name: 'Mushroom',
    selling_price: 100,
    tax: 0,
    tax_type: 'exclusive',
  });
  claim = await seating.reserve(
    db,
    { branchId: branch, license },
    {
      request_id: 'combined-request-0001',
      actor,
      table_ids: tables.map(String),
      primary_id: String(tables[0]),
      guests: 4,
    }
  );
});
function submit(extra = {}, who = actor, staff = true) {
  return runWithRequestContext({ loggedUser: who }, () =>
    repo.createOnlineOrder(
      {
        branch: String(branch),
        kiosk_table_no: 'T1',
        kiosk_table_id: String(tables[0]),
        person_count: 4,
        seating_request_id: claim.id,
        items: [{ item_id: String(item), item_quantity: 1, item_note: 'less salt' }],
        ...extra,
      },
      { staffOrder: staff }
    )
  );
}
test('combined seating uses its total capacity and creates one sale on concurrent retries', async () => {
  const results = await Promise.all([submit(), submit()]);
  expect(results.map((result) => ({ status: result.status, message: result.message }))).toEqual(
    expect.arrayContaining([expect.objectContaining({ status: true })])
  );
  expect(results.every((result) => result.status)).toBe(true);
  expect(results[0].data.sale_id).toBe(results[1].data.sale_id);
  const sales = await db.collection('sales').find({}).toArray();
  expect(sales).toHaveLength(1);
  expect(sales[0].seating_table_ids).toEqual(claim.tables);
  expect(sales[0].table_number).toBe('T1');
  expect(sales[0].person_count).toBe(4);
  expect(sales[0].items[0].item_description).toBe('less salt');
  const again = await submit();
  if (!again.status) throw new Error(again.message);
  expect(again.data.sale_id).toBe(String(sales[0]._id));
});
test('a foreign actor, changed party, different table or anonymous client cannot use a claim', async () => {
  for (const result of [
    await submit({}, String(new ObjectId())),
    await submit({ person_count: 2 }),
    await submit({ kiosk_table_no: 'T2' }),
    await submit({}, actor, false),
  ])
    expect(result.status).toBe(false);
  expect(await db.collection('sales').countDocuments({})).toBe(0);
});

test('retry after an interrupted insert uses the already-bound sale identity', async () => {
  const insert = jest
    .spyOn(repo, 'insertSaleWithFreshNumber')
    .mockRejectedValueOnce(new Error('connection interrupted'));
  const first = await submit();
  expect(first.status).toBe(false);
  const bound = await seating.find(db, { branchId: branch, license }, claim.id);
  expect(bound.state).toBe('submitting');
  expect(bound.order_id).toBeTruthy();
  insert.mockRestore();
  const retry = await submit();
  if (!retry.status) throw new Error(retry.message);
  expect(retry.data.sale_id).toBe(bound.order_id);
  expect(await db.collection('sales').countDocuments({})).toBe(1);
});
