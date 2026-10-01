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
function submit(extra = {}, who = actor, staff = true, protocol = false) {
  const writer = protocol ? require('../../../src/services/sale.service') : repo;
  return runWithRequestContext({ loggedUser: who }, () =>
    writer.createOnlineOrder(
      {
        branch: String(branch),
        kiosk_table_no: 'T1',
        kiosk_table_id: String(tables[0]),
        person_count: 4,
        seating_request_id: claim.id,
        items: [{ item_id: String(item), item_quantity: 1, item_note: 'less salt' }],
        ...extra,
      },
      { staffOrder: staff, seatingProtocol: protocol }
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
test('item edits retain the group capacity and cannot detach its table metadata', async () => {
  const created = await submit();
  if (!created.status) throw new Error(created.message);
  const sale = await db.collection('sales').findOne({ _id: new ObjectId(created.data.sale_id) });
  const edit = async (table = 'T1', guests = 4) =>
    repo.updateOrderModel(
      String(sale._id),
      sale.items,
      sale.sales_total,
      null,
      null,
      null,
      null,
      table,
      'Dine-in',
      guests,
      {}
    );
  const saved = await edit();
  if (!saved.status) throw new Error(saved.message);
  const moved = await edit('T2');
  expect(moved.status).toBe(false);
  expect(moved.message).toContain('seating group');
  const changedParty = await edit('T1', 2);
  expect(changedParty.status).toBe(true);
  const overCapacity = await edit('T1', 5);
  expect(overCapacity.status).toBe(false);
  expect(overCapacity.message).toContain('enough seats');
  const stored = await db.collection('sales').findOne({ _id: sale._id });
  expect(stored.table_number).toBe('T1');
  expect(stored.person_count).toBe(2);
  expect(stored.seating_table_ids).toEqual(claim.tables);
  expect((await seating.find(db, {branchId:branch,license}, claim.id)).guests).toBe(4);
});
test('another existing order cannot move into a reserved group', async () => {
  const otherId = new ObjectId();
  await db.collection('sales').insertOne({
    _id: otherId,
    branch_id: branch,
    license,
    table_number: 'T3',
    table_id: '',
    dine_type: 'Dine-in',
    person_count: 2,
    sale_process: 'KOT',
    items: [],
  });
  const result = await repo.updateOrderModel(
    String(otherId),
    [],
    0,
    null,
    null,
    null,
    null,
    'T2',
    'Dine-in',
    2,
    {}
  );
  expect(result.status).toBe(false);
  expect(result.message).toContain('reserved');
  expect((await db.collection('sales').findOne({ _id: otherId })).table_number).toBe('T3');
});
test('group cancellation releases the tables and retries do not repeat the kitchen change', async () => {
  const created = await submit();
  if (!created.status) throw new Error(created.message);
  const cancel = () =>
    repo.updateOrderModel(
      created.data.sale_id,
      [],
      0,
      'cancelled',
      null,
      null,
      null,
      null,
      null,
      null,
      {}
    );
  const first = await cancel();
  if (!first.status) throw new Error(first.message);
  const stored = await db.collection('sales').findOne({ _id: new ObjectId(created.data.sale_id) });
  expect(stored.sale_process).toBe('cancelled');
  expect(stored.floor_closed_at).toBeInstanceOf(Date);
  expect((await seating.find(db, { branchId: branch, license }, claim.id)).state).toBe('released');
  expect(await db.collection('tableorder').countDocuments({ service_state: 'cleaning' })).toBe(2);
  await db.collection('tableorder').updateMany({}, { $set: { service_state: 'available' } });
  const count = stored.changes.length;
  expect((await cancel()).status).toBe(true);
  expect((await db.collection('sales').findOne({ _id: stored._id })).changes).toHaveLength(count);
  expect(await db.collection('tableorder').countDocuments({ service_state: 'cleaning' })).toBe(0);
});
test('an interrupted cancellation release retries without writing another kitchen cancellation', async () => {
  const created = await submit();
  if (!created.status) throw new Error(created.message);
  const cancel = () =>
    repo.updateOrderModel(
      created.data.sale_id,
      [],
      0,
      'cancelled',
      null,
      null,
      null,
      null,
      null,
      null,
      {}
    );
  const release = jest
    .spyOn(seating, 'release')
    .mockRejectedValueOnce(new Error('lost connection'));
  expect((await cancel()).status).toBe(false);
  release.mockRestore();
  const saved = await db.collection('sales').findOne({ _id: new ObjectId(created.data.sale_id) });
  expect((await cancel()).status).toBe(true);
  expect((await db.collection('sales').findOne({ _id: saved._id })).changes).toHaveLength(
    saved.changes.length
  );
  expect(await db.collection('tableorder').countDocuments({ service_state: 'cleaning' })).toBe(2);
});

test('protocol-enrolled old Captain requests cannot bypass a combined reservation', async () => {
  const result = await submit(
    { seating_request_id: undefined, person_count: 2, idempotencyKey: 'old-captain-1' },
    actor,
    true,
    true
  );
  expect(result.status).toBe(false);
  expect(result.message).toContain('Table changed');
  expect(await db.collection('sales').countDocuments({})).toBe(0);
});
test('old Captain requests atomically compete for one table and retry the winning order', async () => {
  await seating.cancel(db, { branchId: branch, license }, claim.id, actor);
  const send = (key) =>
    submit(
      { seating_request_id: undefined, person_count: 2, idempotencyKey: key },
      actor,
      true,
      true
    );
  const results = await Promise.all([send('old-one'), send('old-two')]);
  expect(results.filter((result) => result.status)).toHaveLength(1);
  const sales = await db.collection('sales').find({}).toArray();
  expect(sales).toHaveLength(1);
  expect(sales[0].seating_request_id).toMatch(/^order-/);
  const retry = await send(sales[0].idempotency_key);
  expect(retry.status).toBe(true);
  expect(retry.data.sale_id).toBe(String(sales[0]._id));
});
test('concurrent old Captain retries share one claim and sale', async () => {
  await seating.cancel(db, { branchId: branch, license }, claim.id, actor);
  const send = () =>
    submit(
      { seating_request_id: undefined, person_count: 2, idempotencyKey: 'same-old-tap' },
      actor,
      true,
      true
    );
  const results = await Promise.all([send(), send()]);
  expect(results.every((result) => result.status)).toBe(true);
  expect(results[0].data.sale_id).toBe(results[1].data.sale_id);
  expect(await seating.read(db, { branchId: branch, license })).toHaveLength(1);
  expect(await db.collection('sales').countDocuments({})).toBe(1);
});

test('customer table requests respect combined reservations without adopting staff identity', async () => {
  const result = await submit(
    { seating_request_id: undefined, person_count: 2, idempotencyKey: 'customer-held' },
    null,
    false,
    true
  );
  expect(result.status).toBe(false);
  expect(await db.collection('sales').countDocuments({})).toBe(0);
});
test('customer and Captain requests compete atomically for the same table', async () => {
  await seating.cancel(db, { branchId: branch, license }, claim.id, actor);
  const customer = () =>
    submit(
      { seating_request_id: undefined, person_count: 2, idempotencyKey: 'customer-one' },
      null,
      false,
      true
    );
  const staff = () =>
    submit(
      { seating_request_id: undefined, person_count: 2, idempotencyKey: 'captain-one' },
      actor,
      true,
      true
    );
  const results = await Promise.all([customer(), staff()]);
  expect(results.filter((result) => result.status)).toHaveLength(1);
  expect(await db.collection('sales').countDocuments({})).toBe(1);
});
test('customer retry after interrupted insert recovers the same bound order', async () => {
  await seating.cancel(db, { branchId: branch, license }, claim.id, actor);
  const send = () =>
    submit(
      { seating_request_id: undefined, person_count: 2, idempotencyKey: 'customer-retry' },
      null,
      false,
      true
    );
  const insert = jest
    .spyOn(repo, 'insertSaleWithFreshNumber')
    .mockRejectedValueOnce(new Error('lost connection'));
  expect((await send()).status).toBe(false);
  insert.mockRestore();
  const claims = await seating.read(db, { branchId: branch, license });
  expect(claims).toHaveLength(1);
  expect(claims[0].actor).toMatch(/^customer-/);
  const result = await send();
  expect(result.status).toBe(true);
  expect(result.data.sale_id).toBe(claims[0].order_id);
});

describe.each(['modified', 'cancelled'])('concurrent settlement during %s', (action) => {
  test.each([
    ['payment_status', 'Paid'],
    ['paid_amount', 50],
    ['partial_balance', 50],
    ['partial_amounts', 50],
    ['payment_pending', 0],
    ['sale_process', 'Add'],
    ['floor_closed_at', new Date('2026-10-01T06:00:00Z')],
    ['order_state', 'cancelled'],
  ])('rejects a stale write after %s changes', async (field, value) => {
    const created = await submit();
    expect(created.status).toBe(true);
    const id = new ObjectId(created.data.sale_id);
    const before = await db.collection('sales').findOne({ _id: id });
    expect(before[field]).not.toEqual(value);
    const notify = require('../../../src/helpers/kot-notify').notifyKotReady;
    notify.mockClear();
    let injected = false;
    BaseModel.getDb.mockResolvedValue({ collection(name) {
      const collection = db.collection(name);
      return new Proxy(collection, { get(target, property) {
        if (name === 'sales' && property === 'updateOne') return async (filter, update, options) => {
          if (!injected && update.$push?.captain_audit) {
            injected = true;
            await collection.updateOne({ _id: id }, { $set: { [field]: value } });
          }
          return collection.updateOne(filter, update, options);
        };
        const method = target[property];
        return typeof method === 'function' ? method.bind(target) : method;
      } });
    } });
    const result = await repo.updateOrderModel(String(id), [
      { product_id: String(item), quantity: 2, price: 100 },
    ], 200, action, null, null, null, null, null, null);
    expect(injected).toBe(true);
    expect(result).toMatchObject({ status: false, message: 'order_changed' });
    expect(await db.collection('sales').findOne({ _id: id })).toEqual({ ...before, [field]: value });
    expect(notify).not.toHaveBeenCalled();
    expect((await seating.find(db, { branchId: branch, license }, claim.id)).state).toBe('submitting');
  });
});

test('two legacy full-order edits cannot both take the last seat on a shared table', async () => {
  await seating.cancel(db, { branchId: branch, license }, claim.id, actor);
  await db.collection('branches').updateOne({ _id: branch }, { $set: { table_order_limit: 0 } });
  await db.collection('tableorder').updateOne({ _id: tables[0] }, { $set: { max_capacity: 3 } });
  const orders = [];
  for (const key of ['shared-legacy-a', 'shared-legacy-b']) {
    const result = await submit({ seating_request_id: undefined, person_count: 1, idempotencyKey: key }, actor, true, true);
    expect(result.status).toBe(true);
    orders.push(result.data.sale_id);
  }
  const results = await Promise.all(orders.map(id => repo.updateOrderModel(id,
    [{ product_id: String(item), quantity: 1, price: 100 }], 100,
    'modified', null, null, null, null, null, 2)));
  expect(results.filter(result => result.status)).toHaveLength(1);
  const saved = await db.collection('sales').find({}).toArray();
  expect(saved.reduce((count, row) => count + row.person_count, 0)).toBe(3);
  expect((await seating.read(db, { branchId: branch, license })).filter(row => row.kind === 'legacy-edit')).toEqual([]);
});

test('repository save keeps the expected capacity revision when the document publishes its new permit', async () => {
  const Model = mongoose.models.CapacityFenceSale || mongoose.model('CapacityFenceSale',
    new mongoose.Schema({ seating_capacity_revision: String, person_count: Number }, { strict: false }), 'sales');
  const original = await Model.create({ branch_id: branch, license, person_count: 1 });
  const doc = await Model.findById(original._id);
  doc.$where = { seating_capacity_revision: { $exists: false } };
  doc.set({ seating_capacity_revision: 'cover-edit-test-permit', person_count: 2 });
  await repo.save(doc);
  expect(await db.collection('sales').findOne({ _id: doc._id })).toMatchObject({
    person_count: 2, seating_capacity_revision: 'cover-edit-test-permit',
  });
});
