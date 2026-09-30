'use strict';
const { MongoMemoryServer } = require('mongodb-memory-server');
const { ObjectId } = require('mongodb');
const mongoose = require('mongoose');
const service = require('../../../src/services/captain-transfer');
const restructure = require('../../../src/services/captain-restructure-lock');
const seating = require('../../../src/services/seating-claims');
const sales = require('../../../src/repositories/sale.repository');
const { snapshotFrom } = require('../../../src/services/guest-bill.service');
const BaseModel = require('../../../src/models/base.model');
const { runWithRequestContext } = require('../../../src/utils/request-context');
let server, db, branch, license, sale;
beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri('captain-transfer'));
  db = mongoose.connection.db;
}, 60000);
afterAll(async () => { await mongoose.disconnect(); await server?.stop(); });
afterEach(() => jest.restoreAllMocks());
beforeEach(async () => {
  await db.dropDatabase();
  branch = new ObjectId(); license = new ObjectId();
  const product = new ObjectId();
  sale = { _id: new ObjectId(), branch_id: branch, license, sale_process: 'KOT', payment_status: 'Unpaid',
    table_number: '1', sales_sub_total: 100, sales_total: 105, tax: 5,
    items: [{ item_id: product, item_name: 'Corn', item_quantity: 2, item_base_price: 50, item_tax: 5 }],
    changes: [{ timestamp: new Date(), items: [{ item_id: product, item_name: 'Corn', item_quantity: 2, process: 'add' }] }] };
  await db.collection('branches').insertOne({ _id: branch, license, currencyCode: 'INR' });
  await db.collection('sales').insertOne(sale);
});
const req = () => ({ db, user: { _id: new ObjectId(), role: 'staff', access: { sales: { write: true, merge: true } } },
  tenantContext: { branchId: branch, licenseId: license }, body: { orderId: String(sale._id), items: [{ id: 'c0i0', quantity: 1 }] } });
test('preview conserves money and makes no sale, kitchen, stock or journal writes', async () => {
  const before = await db.collection('sales').findOne({ _id: sale._id });
  const result = await service.preview(req());
  expect(result.source.totalMinor + result.destination.totalMinor).toBe(10500);
  expect(result.sourceId).toBe(String(sale._id));
  expect(result.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(await db.collection('sales').findOne({ _id: sale._id })).toEqual(before);
  expect((await db.listCollections().toArray()).map(row => row.name).sort()).toEqual(['branches', 'sales']);
});
test.each(['write', 'merge'])('preview requires sales %s permission', async permission => {
  const input = req(); input.user.access.sales[permission] = false;
  await expect(service.preview(input)).rejects.toMatchObject({ status: 403 });
});
test.each(['branch_id', 'license'])('preview never reads another %s even if the body claims its scope', async field => {
  await db.collection('sales').updateOne({ _id: sale._id }, { $set: { [field]: new ObjectId() } });
  const input = req(); input.body[field] = sale[field];
  await expect(service.preview(input)).rejects.toMatchObject({ status: 409 });
});
test.each([{ payment_status: 'Paid' }, { payment_status: 'Partial' }, { captain_payment_plan: 'reserved' },
  { captain_payment_plan: null }, { floor_closed_at: new Date() }, { order_state: 'pending' },
  { sale_process: 'cancelled' }, { captain_edit_until: new Date(Date.now() + 60000) }])(
  'preview rejects unavailable order state %j', async changed => {
    await db.collection('sales').updateOne({ _id: sale._id }, { $set: changed });
    await expect(service.preview(req())).rejects.toMatchObject({ status: 409 });
  });

async function confirmation() {
  const input = req();
  const table = new ObjectId();
  await db.collection('tableorder').insertOne({ _id: table, branch_id: branch, license,
    tableorder_value: String(table), capacity: 4, max_capacity: 4 });
  input.body.destination = { tableIds: [String(table)], primaryId: String(table), guests: 2 };
  input.body.revision = (await service.preview(input)).revision;
  input.body.requestId = 'transfer-confirmation-0001';
  return input;
}
test('ordinary order editor saves a transferred dish note without using current catalogue tax', async () => {
  const input = await confirmation(), completed = await service.complete(input);
  const id = new ObjectId(completed.destinationId);
  const before = await db.collection('sales').findOne({ _id: id });
  await db.collection('items').insertOne({ _id: sale.items[0].item_id, license, name: 'Corn', tax: 99, tax_type: 'exclusive' });
  jest.spyOn(BaseModel, 'getDb').mockResolvedValue(db);
  const answer = await runWithRequestContext({ license, currentBranch: branch, loggedUser: String(input.user._id) }, () =>
    sales.updateOrderModel(String(id), [{ product_id: String(sale.items[0].item_id), quantity: 1,
      price: 50, item_description: 'Less salt' }], 52.5, 'modified', null, null, null, null, null, null));
  expect(answer).toMatchObject({ status: true });
  const after = await db.collection('sales').findOne({ _id: id });
  expect(after.items[0].item_description).toBe('Less salt');
  expect(after.sales_total).toBe(before.sales_total);
  expect(after.tax).toBe(before.tax);
  expect(snapshotFrom([after], { currencyCode: 'INR' }, after.table_number).totalMinor).toBe(5250);
});
test.each([1, 0])('ordinary editor reduces transferred quantity to %s without catalogue repricing', async quantity => {
  const input = await confirmation(); input.body.items[0].quantity = 2;
  const completed = await service.complete(input), id = new ObjectId(completed.destinationId);
  await db.collection('items').insertOne({ _id: sale.items[0].item_id, license, name: 'Corn', tax: 99, tax_type: 'exclusive' });
  jest.spyOn(BaseModel, 'getDb').mockResolvedValue(db);
  const answer = await runWithRequestContext({ license, currentBranch: branch, loggedUser: String(input.user._id) }, () =>
    sales.updateOrderModel(String(id), quantity ? [{ product_id: String(sale.items[0].item_id), quantity,
      price: 50 }] : [], 52.5 * quantity, 'modified', null, null, null, null, null, null));
  expect(answer).toMatchObject({ status: true });
  const after = await db.collection('sales').findOne({ _id: id });
  expect(after.items).toHaveLength(quantity);
  if(quantity)expect(after.items[0].item_quantity).toBe(quantity);
  expect(after.tax).toBe(2.5 * quantity);
  expect(after.captain_transfer_allocation.totalMinor).toBe(5250 * quantity);
  expect(after.sales_total).toBe(52.5 * quantity);
  const cancellation = after.changes.flatMap(change => change.items).filter(item => item.process === 'cancel');
  expect(cancellation).toHaveLength(1);
  expect(cancellation[0].item_quantity).toBe(2 - quantity);
});

test('ordinary editor adds a new dish while preserving transferred tax and only adding its kitchen quantity', async () => {
  const input = await confirmation(), completed = await service.complete(input), id = new ObjectId(completed.destinationId);
  const product = new ObjectId();
  await db.collection('items').insertMany([
    { _id: sale.items[0].item_id, license, name: 'Corn', tax: 99, tax_type: 'exclusive' },
    { _id: product, license, name: 'Soup', tax: 10, tax_type: 'exclusive' }
  ]);
  jest.spyOn(BaseModel, 'getDb').mockResolvedValue(db);
  const answer = await runWithRequestContext({ license, currentBranch: branch, loggedUser: String(input.user._id) }, () =>
    sales.updateOrderModel(String(id), [
      { product_id: String(sale.items[0].item_id), quantity: 1, price: 50 },
      { product_id: String(product), quantity: 2, price: 20 }
    ], 96.5, 'modified', null, null, null, null, null, null));
  expect(answer).toMatchObject({ status: true });
  const after = await db.collection('sales').findOne({ _id: id });
  expect(after.sales_total).toBe(96.5);
  expect(after.tax).toBe(6.5);
  expect(snapshotFrom([after], { currencyCode: 'INR' }, after.table_number).totalMinor).toBe(9650);
  const added = after.changes.flatMap(change => change.items).filter(item => item.process === 'add');
  expect(added).toHaveLength(1);
  expect(String(added[0].item_id)).toBe(String(product));
  expect(added[0].item_quantity).toBe(2);
});

test.each([1, 2])('complete transfer of %s items releases both sale fences and closes only an empty source', async quantity => {
  const input = await confirmation(); input.body.items[0].quantity = quantity;
  const result = await service.complete(input);
  expect(result).toMatchObject({ state: 'completed', sourceClosed: quantity === 2 });
  const source = await db.collection('sales').findOne({ _id: sale._id });
  const destination = await db.collection('sales').findOne({ _id: new ObjectId(result.destinationId) });
  expect(source.captain_payment_plan).toBeUndefined();
  expect(destination.captain_payment_plan).toBeUndefined();
  expect(!!source.floor_closed_at).toBe(quantity === 2);
  expect(destination.floor_closed_at).toBeUndefined();
  expect(destination.items[0].item_quantity).toBe(quantity);
  await db.collection('sales').updateOne({ _id: destination._id }, { $set: { notes: 'Later staff edit' } });
  expect(await service.complete(input)).toEqual(result);
  expect((await db.collection('sales').findOne({ _id: destination._id })).notes).toBe('Later staff edit');
  expect(await db.collection('sales').countDocuments()).toBe(2);
});
test('completed journal retries fence cleanup after its acknowledgement is lost', async () => {
  const input = await confirmation(), original = restructure.complete;
  let interrupted = false;
  jest.spyOn(restructure, 'complete').mockImplementation(async (...args) => {
    const answer = await original(...args);
    if (!interrupted) { interrupted = true; throw new Error('Completion acknowledgement lost'); }
    return answer;
  });
  await expect(service.complete(input)).rejects.toThrow('Completion acknowledgement lost');
  const result = await service.complete(input);
  expect(result.state).toBe('completed');
  expect(await db.collection('sales').countDocuments({ captain_payment_plan: { $exists: true } })).toBe(0);
  expect(await db.collection('sales').countDocuments()).toBe(2);
});
test('a completed journal with interrupted lock cleanup clears its locks on retry', async () => {
  const input = await confirmation(), original = db.collection.bind(db);
  let interrupted = false;
  jest.spyOn(db, 'collection').mockImplementation((name, ...rest) => {
    const collection = original(name, ...rest);
    if (name !== 'sales') return collection;
    return new Proxy(collection, { get(target, property) {
      if (property === 'updateMany') return async (...args) => {
        if (args[1].$unset?.captain_payment_plan !== undefined && !interrupted) {
          interrupted = true;
          throw new Error('Lock cleanup interrupted');
        }
        return target.updateMany(...args);
      };
      const value = target[property]; return typeof value === 'function' ? value.bind(target) : value;
    } });
  });
  await expect(service.complete(input)).rejects.toThrow('Lock cleanup interrupted');
  expect((await original('captain_payment_plans').findOne({})).stage).toBe('completed');
  expect(await original('sales').countDocuments({ captain_payment_plan: { $exists: true } })).toBe(2);
  expect((await service.complete(input)).state).toBe('completed');
  expect(await original('sales').countDocuments({ captain_payment_plan: { $exists: true } })).toBe(0);
});
test('full transfer releases a claimed source without marking an occupied shared table for cleaning', async () => {
  const sourceTable = new ObjectId();
  await db.collection('branches').updateOne({ _id: branch }, { $set: { table_order_limit: 0 } });
  await db.collection('tableorder').insertOne({ _id: sourceTable, branch_id: branch, license,
    tableorder_value: '1', capacity: 6, max_capacity: 6 });
  const claim = await seating.reserve(db, { branchId: branch, license }, { request_id: 'source-seating-0001',
    actor: 'source-staff', table_ids: [String(sourceTable)], primary_id: String(sourceTable), guests: 2 });
  await seating.bind(db, { branchId: branch, license }, claim.id, claim.actor, String(sale._id));
  await db.collection('sales').updateOne({ _id: sale._id }, { $set: { seating_request_id: claim.id, person_count: 2 } });
  const neighbour = { ...sale, _id: new ObjectId(), person_count: 1 };
  await db.collection('sales').insertOne(neighbour);
  const input = await confirmation(); input.body.items[0].quantity = 2;
  const result = await service.complete(input);
  expect(result.sourceClosed).toBe(true);
  expect((await seating.find(db, { branchId: branch, license }, claim.id)).state).toBe('released');
  expect((await db.collection('tableorder').findOne({ _id: sourceTable })).service_state).toBeUndefined();
  expect((await db.collection('sales').findOne({ _id: neighbour._id })).floor_closed_at).toBeUndefined();
  expect(await service.complete(input)).toEqual(result);
});
test('two-sale projection conserves money and items and remains fenced for finalization', async () => {
  const input = await confirmation();
  await db.collection('sales').updateOne({ _id: sale._id }, { $set: {
    transaction_id: 'original-payment', idempotency_key: 'original-order', invoice_number: 'OLD',
  } });
  const result = await service.applySales(input), repeated = await service.applySales(input);
  expect(await db.collection('sales').countDocuments()).toBe(2);
  expect(result.source.items[0].item_quantity).toBe(1);
  expect(result.destination.items[0].item_quantity).toBe(1);
  expect(repeated.source).toEqual(result.source);
  expect(repeated.destination).toEqual(result.destination);
  expect(result.destination.transaction_id).toBeUndefined();
  expect(result.destination.idempotency_key).toBeUndefined();
  expect(result.destination.invoice_number).not.toBe('OLD');
  expect(result.destination.payment_status).toBe('Unpaid');
  const policy = { currencyCode: 'INR' };
  expect(snapshotFrom([result.source], policy, '1').totalMinor +
    snapshotFrom([result.destination], policy, result.destination.table_number).totalMinor).toBe(10500);
  for (const order of [result.source, result.destination]) {
    expect(order.captain_payment_plan).toBe(result.journal._id);
    expect(order.captain_transfer_operations).toHaveLength(1);
  }
  expect(result.journal.stage).toBe('applying');
});
test.each(['destination', 'source'])('interruption after %s write retries without duplicate food or subtraction', async side => {
  const input = await confirmation(), original = db.collection.bind(db);
  let interrupted = false;
  jest.spyOn(db, 'collection').mockImplementation((name, ...rest) => {
    const collection = original(name, ...rest);
    if (name !== 'sales') return collection;
    return new Proxy(collection, { get(target, property) {
      if (property === 'updateOne') return async (...args) => {
        const result = await target.updateOne(...args);
        const transferWrite = side === 'destination' ? args[1].$setOnInsert?.captain_transfer_operations : args[1].$push?.captain_transfer_operations;
        if (transferWrite && !interrupted) {
          interrupted = true;
          throw new Error('Transfer acknowledgement lost');
        }
        return result;
      };
      const value = target[property]; return typeof value === 'function' ? value.bind(target) : value;
    } });
  });
  await expect(service.applySales(input)).rejects.toThrow('Transfer acknowledgement lost');
  expect((await original('sales').findOne({ _id: sale._id })).items[0].item_quantity).toBe(side === 'destination' ? 2 : 1);
  const recovered = await service.applySales(input);
  expect(await original('sales').countDocuments()).toBe(2);
  expect(recovered.source.items[0].item_quantity).toBe(1);
  expect(recovered.destination.items[0].item_quantity).toBe(1);
});
test('a changed source behind its fence is not overwritten by transfer projection', async () => {
  const input = await confirmation();
  await service.beginCommit(input);
  await db.collection('sales').updateOne({ _id: sale._id }, { $set: { 'items.0.item_note': 'Concurrent note' } });
  await expect(service.applySales(input)).rejects.toMatchObject({ status: 409 });
  const retained = await db.collection('sales').findOne({ _id: sale._id });
  expect(retained.items[0].item_note).toBe('Concurrent note');
  expect(retained.items[0].item_quantity).toBe(2);
});
test('commit preparation keeps one destination identity and bill number across retries', async () => {
  const input = await confirmation();
  const first = await service.beginCommit(input), next = await service.beginCommit(input);
  expect(first.journal.stage).toBe('applying');
  expect(next.identity).toEqual(first.identity);
  expect(first.identity._id).not.toEqual(sale._id);
  expect(first.identity.sales_id).toBe(first.identity.invoice_number);
  expect(first.identity.sales_id).toBe(first.identity.sale_no);
  expect(first.existing).toBeNull();
  expect(await db.collection('sales').countDocuments()).toBe(1);
  expect((await seating.read(db, { branchId: branch, license }))[0].order_id).toBe(String(first.identity._id));
  expect((await db.collection('counters').findOne({ kind: 'sales_id' })).seq).toBe(1);
  await expect(service.cancel(input)).rejects.toMatchObject({ status: 409 });
});
test('lost destination binding acknowledgement does not allocate another bill on retry', async () => {
  const input = await confirmation(), original = seating.prepareOrder;
  let bound;
  jest.spyOn(seating, 'prepareOrder').mockImplementationOnce(async (...args) => {
    await original(...args); bound = { ...args[3] };
    throw new Error('Lost binding acknowledgement');
  });
  await expect(service.beginCommit(input)).rejects.toThrow('Lost binding acknowledgement');
  const retried = await service.beginCommit(input);
  expect(retried.identity).toEqual(bound);
  expect((await db.collection('counters').findOne({ kind: 'sales_id' })).seq).toBe(1);
});
test('number allocation failure keeps the applying transfer recoverable', async () => {
  const input = await confirmation();
  jest.spyOn(sales, 'generateSalesIdForBranch').mockRejectedValueOnce(new Error('Counter unavailable'));
  await expect(service.beginCommit(input)).rejects.toThrow('Counter unavailable');
  await expect(service.cancel(input)).rejects.toMatchObject({ status: 409 });
  const recovered = await service.beginCommit(input);
  expect(recovered.journal.stage).toBe('applying');
  expect(recovered.identity.sales_id).toBeTruthy();
  expect(await db.collection('sales').countDocuments()).toBe(1);
});
test('concurrent commit retries agree on the stored number and destination identity', async () => {
  const input = await confirmation(), prepared = await service.prepareDestination(input);
  await restructure.applying(db, { branchId: branch, license }, input.body.requestId, input.user._id);
  const [first, second] = await Promise.all([service.beginCommit(input), service.beginCommit(input)]);
  expect(first.identity).toEqual(second.identity);
  expect(first.journal._id).toBe(prepared.journal._id);
  expect((await seating.read(db, { branchId: branch, license })).length).toBe(1);
  expect(await db.collection('sales').countDocuments()).toBe(1);
});
test('interruption after saving the bill number reuses it without allocating again', async () => {
  const input = await confirmation(), original = restructure.read;
  let interrupted = false;
  jest.spyOn(restructure, 'read').mockImplementation(async (...args) => {
    const journal = await original(...args);
    if (journal?.destination_number && !interrupted) {
      interrupted = true;
      throw new Error('Interrupted after number persisted');
    }
    return journal;
  });
  await expect(service.beginCommit(input)).rejects.toThrow('Interrupted after number persisted');
  const recovered = await service.beginCommit(input);
  expect(recovered.identity.sales_id).toBe((await db.collection('captain_payment_plans').findOne({})).destination_number);
  expect((await db.collection('counters').findOne({ kind: 'sales_id' })).seq).toBe(1);
});
test('an unexpected sale at the bound identity is never adopted as a transfer destination', async () => {
  const input = await confirmation(), prepared = await service.beginCommit(input);
  await db.collection('sales').insertOne({ ...prepared.identity, branch_id: branch, license,
    captain_payment_plan: 'another-operation' });
  await expect(service.beginCommit(input)).rejects.toMatchObject({ status: 409 });
  expect((await db.collection('sales').findOne({ _id: prepared.identity._id })).captain_payment_plan).toBe('another-operation');
});
test('destination preparation reserves capacity once without creating an order', async () => {
  const input = await confirmation();
  const first = await service.prepareDestination(input), repeated = await service.prepareDestination(input);
  expect(first.claim.state).toBe('reserved');
  expect(first.claim.tables).toEqual(input.body.destination.tableIds);
  expect(repeated.claim.id).toBe(first.claim.id);
  expect((await seating.read(db, { branchId: branch, license })).length).toBe(1);
  expect(await db.collection('sales').countDocuments()).toBe(1);
  await service.cancel(input);
  await service.cancel(input);
  expect(await seating.read(db, { branchId: branch, license })).toEqual([]);
  expect((await db.collection('sales').findOne({ _id: sale._id })).captain_payment_plan).toBeUndefined();
});
test.each(['guests', 'tableIds'])('a prepared transfer cannot change destination %s on retry', async field => {
  const input = await confirmation();
  const first = await service.prepareDestination(input);
  if (field === 'guests') input.body.destination.guests = 3;
  else {
    const id = String(new ObjectId());
    input.body.destination.tableIds = [id]; input.body.destination.primaryId = id;
  }
  await expect(service.prepareDestination(input)).rejects.toMatchObject({ status: 409 });
  expect((await seating.read(db, { branchId: branch, license }))[0].id).toBe(first.claim.id);
});
test('lost destination acknowledgement recovers the same capacity claim', async () => {
  const input = await confirmation(), original = seating.reserve;
  let accepted;
  jest.spyOn(seating, 'reserve').mockImplementationOnce(async (...args) => {
    accepted = await original(...args);
    throw new Error('Lost seating acknowledgement');
  });
  await expect(service.prepareDestination(input)).rejects.toThrow('Lost seating acknowledgement');
  const retried = await service.prepareDestination(input);
  expect(retried.claim.id).toBe(accepted.id);
  expect((await seating.read(db, { branchId: branch, license })).length).toBe(1);
});
test('cancellation rejects and cleans a destination claim published after cancellation', async () => {
  const input = await confirmation(), original = seating.reserve;
  jest.spyOn(seating, 'reserve').mockImplementationOnce(async (...args) => {
    await service.cancel(input);
    return original(...args);
  });
  await expect(service.prepareDestination(input)).rejects.toMatchObject({ status: 409 });
  expect(await seating.read(db, { branchId: branch, license })).toEqual([]);
  expect((await db.collection('sales').findOne({ _id: sale._id })).captain_payment_plan).toBeUndefined();
  await expect(service.prepareDestination(input)).rejects.toMatchObject({ status: 409 });
});
test('cancel retry cleans a late claim after interruption before post-reservation reconciliation', async () => {
  const input = await confirmation(), original = seating.reserve;
  jest.spyOn(seating, 'reserve').mockImplementationOnce(async (...args) => {
    await service.cancel(input);
    await original(...args);
    throw new Error('Interrupted after seating write');
  });
  await expect(service.prepareDestination(input)).rejects.toThrow('Interrupted after seating write');
  expect((await seating.read(db, { branchId: branch, license })).length).toBe(1);
  await service.cancel(input);
  expect(await seating.read(db, { branchId: branch, license })).toEqual([]);
});
test.each(['capacity', 'scope', 'cleaning'])('unavailable destination (%s) leaves a cancellable source reservation', async reason => {
  const input = await confirmation(), table = new ObjectId(input.body.destination.primaryId);
  const change = reason === 'capacity' ? { capacity: 1, max_capacity: 1 } : reason === 'scope' ? { branch_id: new ObjectId() } : { service_state: 'cleaning' };
  await db.collection('tableorder').updateOne({ _id: table }, { $set: change });
  await expect(service.prepareDestination(input)).rejects.toHaveProperty('status');
  expect(await seating.read(db, { branchId: branch, license })).toEqual([]);
  await service.cancel(input);
  expect((await db.collection('sales').findOne({ _id: sale._id })).captain_payment_plan).toBeUndefined();
});
test('reservation fences the source without moving food, charging, stock or KOT effects', async () => {
  const input = await confirmation();
  const before = await db.collection('sales').findOne({ _id: sale._id });
  const result = await service.reserve(input);
  expect(result.journal.stage).toBe('reserved');
  expect(result.projection.preview.revision).toBe(input.body.revision);
  const stored = await db.collection('sales').findOne({ _id: sale._id });
  expect(stored.captain_payment_plan).toBe(result.journal._id);
  delete stored.captain_payment_plan;
  expect(stored).toEqual(before);
  expect(await db.collection('sales').countDocuments()).toBe(1);
  expect((await db.listCollections().toArray()).map(row => row.name).sort()).toEqual(['branches', 'captain_payment_plans', 'sales', 'tableorder']);
});
test('lost reservation acknowledgement retries the same snapshot, currency and history timestamp', async () => {
  const input = await confirmation(), original = restructure.reserve;
  let accepted;
  jest.spyOn(restructure, 'reserve').mockImplementationOnce(async (...args) => {
    accepted = await original(...args);
    throw new Error('Lost acknowledgement');
  });
  await expect(service.reserve(input)).rejects.toThrow('Lost acknowledgement');
  await db.collection('branches').updateOne({ _id: branch }, { $set: { currencyCode: 'JPY', currencyDigits: 0 } });
  const result = await service.reserve(input), repeat = await service.reserve(input);
  expect(result.journal._id).toBe(accepted._id);
  expect(result.projection.preview.currencyCode).toBe('INR');
  expect(result.projection.preview.totalMinor).toBe(10500);
  expect(repeat.projection).toEqual(result.projection);
  expect(result.projection.source.changes.at(-1).timestamp).toBe(accepted.createdAt.toISOString());
  expect(await db.collection('captain_payment_plans').countDocuments()).toBe(1);
});
test.each(['items', 'revision', 'orderId'])('retry cannot replace the original transfer %s', async field => {
  const input = await confirmation();
  const first = await service.reserve(input);
  input.body[field] = field === 'items' ? [{ id: 'c0i0', quantity: 2 }] : field === 'revision' ? 'a'.repeat(64) : String(new ObjectId());
  await expect(service.reserve(input)).rejects.toMatchObject({ status: 409 });
  expect((await db.collection('sales').findOne({ _id: sale._id })).captain_payment_plan).toBe(first.journal._id);
});
test('another staff member cannot resume a reserved transfer', async () => {
  const input = await confirmation();
  await service.reserve(input);
  input.user._id = new ObjectId();
  await expect(service.reserve(input)).rejects.toMatchObject({ status: 409 });
});
test('a competing transfer cannot reserve the same source until the first is cancelled', async () => {
  const input = await confirmation(), competitor = await confirmation();
  competitor.body.requestId = 'transfer-confirmation-0002';
  const first = await service.reserve(input);
  await expect(service.reserve(competitor)).rejects.toMatchObject({ status: 409 });
  expect(await db.collection('captain_payment_plans').countDocuments()).toBe(1);
  await restructure.cancel(db, { branchId: branch, license }, input.body.requestId, input.user._id);
  const second = await service.reserve(competitor);
  expect(second.journal._id).not.toBe(first.journal._id);
  expect(second.projection.preview.revision).toBe(input.body.revision);
});
test('resuming a reservation still requires current sales permission', async () => {
  const input = await confirmation();
  await service.reserve(input);
  input.user.access.sales.merge = false;
  await expect(service.reserve(input)).rejects.toMatchObject({ status: 403 });
});
test('cancelled reservation releases the source and cannot be resurrected', async () => {
  const input = await confirmation();
  await service.reserve(input);
  await restructure.cancel(db, { branchId: branch, license }, input.body.requestId, input.user._id);
  await expect(service.reserve(input)).rejects.toMatchObject({ status: 409 });
  expect((await db.collection('sales').findOne({ _id: sale._id })).captain_payment_plan).toBeUndefined();
});
test('changed preview is rejected before acquiring a reservation', async () => {
  const input = await confirmation();
  await db.collection('sales').updateOne({ _id: sale._id }, { $set: { person_count: 4 } });
  await expect(service.reserve(input)).rejects.toMatchObject({ status: 409 });
  expect(await db.collection('captain_payment_plans').countDocuments()).toBe(0);
  expect((await db.collection('sales').findOne({ _id: sale._id })).captain_payment_plan).toBeUndefined();
});
test('a source changed between validation and reservation is rejected by the atomic fence', async () => {
  const input = await confirmation(), original = restructure.reserve;
  jest.spyOn(restructure, 'reserve').mockImplementationOnce(async (...args) => {
    await db.collection('sales').updateOne({ _id: sale._id }, { $set: { person_count: 7 } });
    return original(...args);
  });
  await expect(service.reserve(input)).rejects.toMatchObject({ status: 409 });
  const stored = await db.collection('sales').findOne({ _id: sale._id });
  expect(stored.person_count).toBe(7);
  expect(stored.captain_payment_plan).toBeUndefined();
  expect((await db.collection('captain_payment_plans').findOne({})).stage).toBe('cancelled');
});
test('preview revision changes when another staff member serves an item', async () => {
  const first = await service.preview(req());
  await db.collection('sales').updateOne({ _id: sale._id }, { $set: { kitchen_service: { c0i0: { quantity: 1 } } } });
  const input = req(); input.body.items[0].servedQuantity = 1;
  const next = await service.preview(input);
  expect(next.revision).not.toBe(first.revision);
  expect(next.destination.rounds[0].served).toBe(1);
});

test.each([['table_number','2'],['table_id','new-table'],['person_count',4],['dine_type','Take away'],
  ['seating_request_id','changed-request'],['seating_primary_id','new-primary'],
  ['seating_table_ids',['new-primary']],['seating_capacity_revision','changed-capacity']])(
  'preview revision detects a changed %s without relying on updated_date', async (field,value) => {
    const first = await service.preview(req());
    await db.collection('sales').updateOne({ _id:sale._id }, { $set:{ [field]:value } });
    const next = await service.preview(req());
    expect(next.revision).not.toBe(first.revision);
    expect(next.totalMinor).toBe(first.totalMinor);
    expect(next.destination.lines).toEqual(first.destination.lines);
  });


test('a conflicting bill number is replaced without changing destination identity or repeating the transfer', async () => {
  const input = await confirmation(), prepared = await service.beginCommit(input);
  await db.collection('sales').createIndex({license:1,sales_id:1},{unique:true,
    partialFilterExpression:{sales_id:{$type:'string'}},name:'unique_sales_id_per_license'});
  const conflicting = { _id:new ObjectId(), license, branch_id:branch, sales_id:prepared.identity.sales_id, items:[] };
  await db.collection('sales').insertOne(conflicting);
  const result = await service.applySales(input);
  expect(result.destination._id).toEqual(prepared.identity._id);
  expect(result.destination.sales_id).not.toBe(conflicting.sales_id);
  expect(result.destination.invoice_number).toBe(result.destination.sales_id);
  expect(result.destination.sale_no).toBe(result.destination.sales_id);
  expect((await db.collection('captain_payment_plans').findOne({})).destination_number).toBe(result.destination.sales_id);
  expect(await db.collection('sales').findOne({_id:conflicting._id})).toEqual(conflicting);
  const retried = await service.applySales(input);
  expect(retried.destination.sales_id).toBe(result.destination.sales_id);
  expect(retried.source.items[0].item_quantity).toBe(1);
  expect(await db.collection('sales').countDocuments()).toBe(3);
});

test('non-number insertion errors preserve the reserved number and the source order', async () => {
  const input = await confirmation(), prepared = await service.beginCommit(input);
  const original = db.collection.bind(db);
  jest.spyOn(db,'collection').mockImplementation((name,...rest)=>{
    const collection=original(name,...rest);
    if(name!=='sales')return collection;
    return new Proxy(collection,{get(target,property){
      if(property==='updateOne')return async (...args)=>{
        if(args[1].$setOnInsert?.captain_transfer_operations)
          throw Object.assign(new Error('duplicate idempotency_key'),{code:11000,keyPattern:{idempotency_key:1}});
        return target.updateOne(...args);
      };
      const value=target[property];return typeof value==='function'?value.bind(target):value;
    }});
  });
  await expect(service.applySales(input)).rejects.toThrow('duplicate idempotency_key');
  expect((await original('captain_payment_plans').findOne({})).destination_number).toBe(prepared.identity.sales_id);
  expect((await original('sales').findOne({_id:sale._id})).items[0].item_quantity).toBe(2);
});

test.each(['interrupted','concurrent'])('bill-number collision recovery handles %s retries', async mode => {
  const input=await confirmation(), prepared=await service.beginCommit(input);
  await db.collection('sales').createIndex({license:1,sales_id:1},{unique:true,
    partialFilterExpression:{sales_id:{$type:'string'}},name:'unique_sales_id_per_license'});
  await db.collection('sales').insertOne({_id:new ObjectId(),license,branch_id:branch,sales_id:prepared.identity.sales_id});
  const original=db.collection.bind(db);
  let interrupted=false;
  if(mode==='interrupted'){
    jest.spyOn(db,'collection').mockImplementation((name,...rest)=>{
      const collection=original(name,...rest);
      if(name!=='captain_payment_plans')return collection;
      return new Proxy(collection,{get(target,property){
        if(property==='updateOne')return async (...args)=>{
          const result=await target.updateOne(...args);
          if(args[1].$set?.destination_number && !interrupted){
            interrupted=true;throw new Error('Replacement acknowledgement lost');
          }
          return result;
        };
        const value=target[property];return typeof value==='function'?value.bind(target):value;
      }});
    });
    await expect(service.applySales(input)).rejects.toThrow('Replacement acknowledgement lost');
    expect((await original('sales').findOne({_id:sale._id})).items[0].item_quantity).toBe(2);
    expect(await original('sales').findOne({_id:prepared.identity._id})).toBeNull();
  }
  const answers=await Promise.all([service.applySales(input),service.applySales(input)]);
  expect(answers[0].destination).toEqual(answers[1].destination);
  expect(answers[0].destination._id).toEqual(prepared.identity._id);
  expect(answers[0].destination.sales_id).not.toBe(prepared.identity.sales_id);
  expect(answers[0].source.items[0].item_quantity).toBe(1);
  expect(await original('sales').countDocuments()).toBe(3);
  expect((await original('captain_payment_plans').findOne({})).destination_number).toBe(answers[0].destination.sales_id);
});

test('ordinary editor increases transferred portions and sends only the extra quantity to kitchen', async () => {
  const input=await confirmation(), completed=await service.complete(input),id=new ObjectId(completed.destinationId);
  await db.collection('items').insertOne({_id:sale.items[0].item_id,license,name:'Corn',tax:5,tax_type:'exclusive'});
  jest.spyOn(BaseModel,'getDb').mockResolvedValue(db);
  const answer=await runWithRequestContext({license,currentBranch:branch,loggedUser:String(input.user._id)},()=>
    sales.updateOrderModel(String(id),[{product_id:String(sale.items[0].item_id),quantity:3,price:50}],157.5,'modified',null,null,null,null,null,null));
  expect(answer).toMatchObject({status:true});
  const after=await db.collection('sales').findOne({_id:id});
  expect(after.sales_total).toBe(157.5);
  expect(after.items[0].item_quantity).toBe(3);
  expect(snapshotFrom([after],{currencyCode:'INR'},after.table_number).totalMinor).toBe(15750);
  const added=after.changes.flatMap(change=>change.items).filter(item=>item.process==='add');
  expect(added).toHaveLength(1);
  expect(added[0].item_quantity).toBe(2);
});

test('persisted transfer of a separately discounted bill retains the discount once on both checks', async () => {
  await db.collection('sales').updateOne({_id:sale._id},{$set:{discount:0,extra_discount:10,sale_extra_discount:10,
    extra_discount_type:'amount',sales_total:95,'items.0.item_discount':0}});
  const input=await confirmation(),result=await service.complete(input);
  const source=await db.collection('sales').findOne({_id:sale._id});
  const destination=await db.collection('sales').findOne({_id:new ObjectId(result.destinationId)});
  for(const check of [source,destination]){
    expect(check.sales_total).toBe(47.5);
    expect(check.discount).toBe(5);
    expect(check.sale_extra_discount).toBe(0);
    expect(check.round_off).toBe(0);
    expect(snapshotFrom([check],{currencyCode:'INR'},check.table_number).totalMinor).toBe(4750);
  }
  expect(await service.complete(input)).toEqual(result);
});


test('ordinary editor replaces, retries and clears an allocated bill discount without extra kitchen tickets',async()=>{
  const input=await confirmation(),completed=await service.complete(input),id=new ObjectId(completed.destinationId);
  await db.collection('items').insertOne({_id:sale.items[0].item_id,license,name:'Corn',tax:99,tax_type:'exclusive'});
  jest.spyOn(BaseModel,'getDb').mockResolvedValue(db);
  const apply=async(value,type='amount')=>{
    const answer=await runWithRequestContext({license,currentBranch:branch,loggedUser:String(input.user._id)},()=>
      sales.updateOrderModel(String(id),[{product_id:String(sale.items[0].item_id),quantity:1,price:50}],52.5,'modified',type,value,null,null,null,null));
    expect(answer).toMatchObject({status:true});
    return db.collection('sales').findOne({_id:id});
  };
  const before=await db.collection('sales').findOne({_id:id});
  for(const [value,type,total] of [[10,'amount',42.5],[10,'amount',42.5],[20,'percent',42.5],[5,'amount',47.5],[0,'amount',52.5]]){
    const result=await apply(value,type);
    expect(result.sales_total).toBe(total);
    expect(result.tax).toBe(2.5);
    expect(result.sale_extra_discount).toBe(0);
    expect(require('../../../src/services/captain-transfer-discount').editorValue(result)).toMatchObject({extra_discount:52.5-total,extra_discount_type:'amount',discount_basis:50});
    const policyRequest={...input,body:{order_id:String(id),items:[{product_id:String(sale.items[0].item_id),quantity:1}],
      extra_discount:52.5-total,extra_discount_type:'amount'}};
    await expect(require('../../../src/services/captain-edit-policy').authorize(policyRequest)).resolves.toBeDefined();
    policyRequest.body.extra_discount++;
    await expect(require('../../../src/services/captain-edit-policy').authorize(policyRequest)).rejects.toMatchObject({status:422});
    expect(result.changes).toEqual(before.changes);
    expect(snapshotFrom([result],{currencyCode:'INR'},result.table_number).totalMinor).toBe(Math.round(total*100));
  }
});

test('combined item and discount edits conserve existing amounts across retry, reduction and replacement',async()=>{
  const input=await confirmation(),completed=await service.complete(input),id=new ObjectId(completed.destinationId),soup=new ObjectId();
  await db.collection('items').insertMany([
    {_id:sale.items[0].item_id,license,name:'Corn',tax:5,tax_type:'exclusive'},
    {_id:soup,license,name:'Soup',tax:10,tax_type:'exclusive'}
  ]);
  jest.spyOn(BaseModel,'getDb').mockResolvedValue(db);
  const apply=async(corn,soups,discount=null,type=null)=>{
    const items=[{product_id:String(sale.items[0].item_id),quantity:corn,price:50}];
    if(soups)items.push({product_id:String(soup),quantity:soups,price:20});
    const answer=await runWithRequestContext({license,currentBranch:branch,loggedUser:String(input.user._id)},()=>
      sales.updateOrderModel(String(id),items,0,'modified',type,discount,'Customer requested',null,null,null));
    expect(answer).toMatchObject({status:true});
    return db.collection('sales').findOne({_id:id});
  };
  expect((await apply(1,0,10,'amount')).sales_total).toBe(42.5);
  const combined=await apply(2,1,10,'percent');
  expect(combined.sales_total).toBe(115);
  expect(combined.tax).toBe(7);
  const retry=await apply(2,1,10,'percent');
  expect(retry.sales_total).toBe(115);
  expect(retry.changes).toEqual(combined.changes);
  const reduced=await apply(1,1);
  expect(reduced.sales_total).toBe(67.46);
  expect(reduced.tax).toBe(4.5);
  expect(require('../../../src/services/captain-transfer-discount').editorValue(reduced).extra_discount).toBe(7.04);
  const replaced=await apply(1,1,5,'amount');
  expect(replaced.sales_total).toBe(69.5);
  expect(replaced.tax).toBe(4.5);
  expect(snapshotFrom([replaced],{currencyCode:'INR'},replaced.table_number).totalMinor).toBe(6950);
  const changes=replaced.changes.flatMap(change=>change.items);
  expect(changes.filter(item=>item.process==='add').map(item=>item.item_quantity)).toEqual([1,1]);
  expect(changes.filter(item=>item.process==='cancel').map(item=>item.item_quantity)).toEqual([1]);
});


test('internal item preview matches the eventual save and performs no database writes',async()=>{
  const input=await confirmation(),completed=await service.complete(input),id=new ObjectId(completed.destinationId);
  await db.collection('items').insertOne({_id:sale.items[0].item_id,license,name:'Corn',tax:5,tax_type:'exclusive'});
  jest.spyOn(BaseModel,'getDb').mockResolvedValue(db);
  const snapshot=async()=>{
    const names=(await db.listCollections().toArray()).map(row=>row.name).sort();
    return Promise.all(names.map(async name=>[name,await db.collection(name).find({}).sort({_id:1}).toArray()]));
  };
  const before=await snapshot();
  const run=preview=>runWithRequestContext({license,currentBranch:branch,loggedUser:String(input.user._id)},()=>
    sales.updateOrderModel(String(id),[{product_id:String(sale.items[0].item_id),quantity:2,price:50}],0,'modified','amount',10,'Customer requested',null,null,null,{preview}));
  const projected=await run(true);
  expect(projected).toMatchObject({status:true,data:{total_amount:95,tax:5}});
  expect(projected.data.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(await snapshot()).toEqual(before);
  expect(await run(false)).toMatchObject({status:true});
  const saved=await db.collection('sales').findOne({_id:id});
  expect(saved.sales_total).toBe(projected.data.total_amount);
  expect(saved.tax).toBe(projected.data.tax);
  expect(saved.items).toEqual(projected.data.items);
});


test('preview cannot invoke cancellation or change seating',async()=>{
  jest.spyOn(BaseModel,'getDb').mockResolvedValue(db);
  const before=await db.collection('sales').findOne({_id:sale._id});
  for(const [status,table] of [['cancelled',null],['modified','2']]){
    const result=await runWithRequestContext({license,currentBranch:branch},()=>
      sales.updateOrderModel(String(sale._id),[],0,status,null,null,null,table,null,null,{preview:true}));
    expect(result.status).toBe(false);
  }
  expect(await db.collection('sales').findOne({_id:sale._id})).toEqual(before);
});

async function scopedItemPreview(database = db, scope = {}) {
  return sales.updateOrderModel(String(sale._id),
    [{product_id:String(sale.items[0].item_id),quantity:2,price:50}],0,
    'modified',null,null,null,null,null,null,
    {preview:true,previewContext:{db:database,branchId:branch,license,...scope}});
}
test('explicit preview scope ignores ambient database and tenant state',async()=>{
  const ambient=jest.spyOn(BaseModel,'getDb').mockRejectedValue(new Error('Wrong database'));
  const result=await runWithRequestContext({license:new ObjectId(),currentBranch:new ObjectId()},()=>scopedItemPreview());
  expect(result.status).toBe(true);
  expect(ambient).not.toHaveBeenCalled();
  expect((await scopedItemPreview(db,{branchId:new ObjectId()})).status).toBe(false);
  expect((await scopedItemPreview(db,{license:new ObjectId()})).status).toBe(false);
});
test.each([
  {items_total:99},{items_subtotal:88},{order_state:'cancelled'},
  {branch_id:new ObjectId()},{license:new ObjectId()},
  {captain_edit_until:new Date(Date.now()+60000)},
  {captain_payment_plan:null},{floor_closed_at:new Date()},
])('item preview rejects a concurrent change %j',async changed=>{
  const database={collection(name){
    const collection=db.collection(name);
    if(name!=='branches') return collection;
    return {async findOne(query){
      await db.collection('sales').updateOne({_id:sale._id},{$set:changed});
      return collection.findOne(query);
    }};
  }};
  expect(await scopedItemPreview(database)).toMatchObject({status:false,message:'order_changed'});
  expect(await db.collection('sales').findOne({_id:sale._id})).toMatchObject(changed);
});
test.each([{order_state:'pending'},{order_state:'rejected'},
  {floor_closed_at:null},{captain_edit_until:new Date(Date.now()+60000)}])(
  'item preview refuses unavailable state %j',async changed=>{
    await db.collection('sales').updateOne({_id:sale._id},{$set:changed});
    expect((await scopedItemPreview()).status).toBe(false);
  });

const editPreview = require('../../../src/services/captain-order-preview');
function previewRequest() {
  const input=req();
  input.body={order_id:String(sale._id),items:[{product_id:String(sale.items[0].item_id),quantity:2,price:50}]};
  return input;
}
test('edit preview API service returns scoped totals without writes or ambient database',async()=>{
  await db.collection('items').insertOne({_id:sale.items[0].item_id,license,name:'Corn',tax:5,tax_type:'exclusive'});
  const before=await db.collection('sales').findOne({_id:sale._id});
  const ambient=jest.spyOn(BaseModel,'getDb').mockRejectedValue(new Error('Wrong database'));
  const result=await editPreview.preview(previewRequest());
  expect(result.total_amount).toBe(105);
  expect(result.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(ambient).not.toHaveBeenCalled();
  expect(await db.collection('sales').findOne({_id:sale._id})).toEqual(before);
  expect((await db.listCollections().toArray()).map(row=>row.name).sort()).toEqual(['branches','items','sales']);
});
test.each([null,{_id:new ObjectId(),role:'staff',access:{sales:{write:false}}}])(
  'edit preview requires authenticated sales permission',async user=>{
    const input=previewRequest(); input.user=user;
    await expect(editPreview.preview(input)).rejects.toMatchObject({status:403});
  });
test.each(['branch_id','license'])('edit preview API isolates %s',async field=>{
  await db.collection('sales').updateOne({_id:sale._id},{$set:{[field]:new ObjectId()}});
  await expect(editPreview.preview(previewRequest())).rejects.toMatchObject({status:404});
});
test.each([{status:'cancelled'},{table_number:'2'},{items:[]},
  {items:[{product_id:'bad',quantity:1,price:50}]},{extra_discount:-1,extra_discount_type:'amount'},
  {extra_discount:101,extra_discount_type:'percent'},{seen_at:'yesterday'}])(
  'edit preview rejects invalid draft %j',async values=>{
    const input=previewRequest(); Object.assign(input.body,values);
    await expect(editPreview.preview(input)).rejects.toHaveProperty('status');
  });
test.each(['reduction','discount'])('preview prices %s before approval but never authorizes a save',async kind=>{
  await db.collection('items').insertOne({_id:sale.items[0].item_id,license,name:'Corn',tax:5,tax_type:'exclusive'});
  const before=await db.collection('sales').findOne({_id:sale._id});
  const input=previewRequest(); input.user.access.pos={void_sale:false,discount_apply:false};
  if(kind==='reduction') input.body.items[0].quantity=1;
  else Object.assign(input.body,{extra_discount:10,extra_discount_type:'amount'});
  // Body flags cannot bypass the ordinary save authorization.
  input.body.preview=true;
  const policy=require('../../../src/services/captain-edit-policy');
  await expect(policy.authorize(input)).rejects.toMatchObject({status:422,message:'Enter a reason for this change.'});
  expect((await editPreview.preview(input)).total_amount).toBe(kind==='reduction'?52.5:95);
  input.body.change_reason='Customer requested';
  await expect(policy.authorize(input)).rejects.toMatchObject({status:422,message:kind==='reduction'?'Manager approval required: cancellation':'Manager approval required: discount'});
  const readPolicy=await policy.authorize(input,{preview:true});
  expect(readPolicy.previewOnly).toBe(true);
  const result=await sales.updateOrderModel(String(sale._id),input.body.items,0,'modified',null,null,null,null,null,null,{editPolicy:readPolicy});
  expect(result).toMatchObject({status:false,message:'Preview cannot authorize a save.'});
  expect(await db.collection('sales').findOne({_id:sale._id})).toEqual(before);
});
test('edit preview rejects a stale handset view and disabled Captain',async()=>{
  const input=previewRequest();input.body.seen_at='2026-01-01T00:00:00Z';
  await db.collection('sales').updateOne({_id:sale._id},{$set:{updated_date:new Date('2026-02-01')}});
  await expect(editPreview.preview(input)).rejects.toMatchObject({status:409,message:'order_changed'});
  await db.collection('branches').updateOne({_id:branch},{$set:{module_captain_enable:false}});
  await expect(editPreview.preview(input)).rejects.toMatchObject({status:403});
});
