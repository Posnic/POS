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
  await db.collection('branches').insertOne({ _id: branch, license, captain_table_cleaning: true });
});
const req = (body = {}, role = 'manager') => ({
  db,
  body,
  user: { _id: user, role, access: { sales: { write: true } } },
  tenantContext: { branchId: branch, licenseId: license },
});

test('authenticated table discovery advertises recoverable legacy source moves', async () => {
  expect((await service.list(req({}, 'staff'))).capabilities).toEqual({
    legacySourceMove: true,
    legacyGuestUpdate: true,
    legacyTargetMerge: true,
  });
  await expect(service.list({ ...req(), user: null })).rejects.toMatchObject({ status: 403 });
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
test('closing paid orders preserves payment and stock data and honors enabled cleaning', async () => {
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

test('paid legacy and enrolled dine-in receipts do not occupy the floor', async () => {
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
  expect((await service.list(req())).tables[0].status).toBe('available');
});

test('neighbour settings use table identities and survive renaming and unrelated edits', async () => {
  const neighbour = await service.update(req({ tableorder_value: 'T2' }));
  const table = await service.update(
    req({ tableorder_value: 'T1', adjacent_table_ids: [neighbour.id, neighbour.id] })
  );
  expect(table.adjacent_table_ids).toEqual([neighbour.id]);
  await service.update(req({ ...neighbour, tableorder_value: 'T3' }));
  await service.update(req({ id: table.id, version: 0, tableorder_value: 'T1', capacity: 4 }));
  expect(
    (await service.list(req())).tables.find((row) => row.id === table.id).adjacent_table_ids
  ).toEqual([neighbour.id]);
  const cleared = await service.update(
    req({ id: table.id, version: 1, tableorder_value: 'T1', adjacent_table_ids: [] })
  );
  expect(cleared.adjacent_table_ids).toEqual([]);
});

test('neighbour settings reject self, missing, malformed and other-branch identities', async () => {
  const table = await service.update(req({ tableorder_value: 'T1' }));
  const foreign = new ObjectId();
  await db
    .collection('tableorder')
    .insertOne({ _id: foreign, branch_id: new ObjectId(), license, tableorder_value: 'T2' });
  for (const ids of [[table.id], [String(foreign)], [String(new ObjectId())], ['T2'], 'T2', null]) {
    await expect(service.update(req({ ...table, adjacent_table_ids: ids }))).rejects.toThrow();
  }
  const saved = await db.collection('tableorder').findOne({ _id: new ObjectId(table.id) });
  expect(saved.captain_table_version).toBe(0);
  expect(saved.adjacent_table_ids).toBeUndefined();
});
test('seating claims are visible on every member and block table edits and manual release', async () => {
  const seating = require('../../../src/services/seating-claims');
  const second = await service.update(
    req({ tableorder_value: 'T2', capacity: 2, max_capacity: 2 })
  );
  const first = await service.update(
    req({ tableorder_value: 'T1', capacity: 2, max_capacity: 2, adjacent_table_ids: [second.id] })
  );
  const scope = { branchId: branch, license };
  const claim = await seating.reserve(db, scope, {
    request_id: 'combined-seating-0001',
    actor: String(user),
    table_ids: [first.id, second.id],
    primary_id: first.id,
    guests: 4,
  });
  const held = (await service.list(req())).tables;
  expect(
    held.every((table) => table.status === 'held' && table.seating.primary_id === first.id)
  ).toBe(true);
  await expect(service.update(req({ ...second, capacity: 3, max_capacity: 3 }))).rejects.toThrow(
    'active seating group'
  );
  await expect(
    service.state(req({ id: second.id, version: 0, status: 'available' }))
  ).rejects.toThrow('active seating group');
  const orderId = new ObjectId();
  await seating.bind(db, scope, claim.id, String(user), String(orderId));
  await db.collection('sales').insertOne({
    _id: orderId,
    branch_id: branch,
    license,
    table_number: 'T1',
    sale_process: 'KOT',
    payment_status: 'Unpaid',
    floor_lifecycle: true,
    person_count: 4,
  });
  await db.collection('sales').updateOne({ _id: orderId }, { $set: { person_count: 3 } });
  const occupied = (await service.list(req())).tables;
  expect(occupied.every((table) => table.seating.guests === 3)).toBe(true);
  expect((await seating.find(db, scope, claim.id)).guests).toBe(4);
  expect(
    occupied.every((table) => table.status === 'occupied' && table.orders[0].id === String(orderId))
  ).toBe(true);
  await db.collection('sales').updateOne({ _id: orderId }, { $set: { payment_status: 'Paid' } });
  await service.close(
    req({
      id: first.id,
      version: 0,
      request_id: 'combined-close-0001',
      orderIds: [String(orderId)],
    })
  );
  const closed = (await service.list(req())).tables;
  expect(
    closed.every((table) => table.status === 'cleaning' && !table.seating && !table.orders.length)
  ).toBe(true);
  expect(closed.find((table) => table.id === second.id).version).toBe(1);
  await expect(
    service.state(req({ id: second.id, version: 0, status: 'available' }))
  ).rejects.toThrow('Table changed');
  await service.state(req({ id: second.id, version: 1, status: 'available' }));
});
test('interrupted group release remains retryable after the sale leaves active orders', async () => {
  const seating = require('../../../src/services/seating-claims');
  const second = await service.update(
    req({ tableorder_value: 'T2', capacity: 2, max_capacity: 2 })
  );
  const first = await service.update(
    req({ tableorder_value: 'T1', capacity: 2, max_capacity: 2, adjacent_table_ids: [second.id] })
  );
  const scope = { branchId: branch, license };
  const claim = await seating.reserve(db, scope, {
    request_id: 'combined-seating-0001',
    actor: String(user),
    table_ids: [first.id, second.id],
    primary_id: first.id,
    guests: 4,
  });
  const orderId = new ObjectId();
  await seating.bind(db, scope, claim.id, String(user), String(orderId));
  await db.collection('sales').insertOne({
    _id: orderId,
    branch_id: branch,
    license,
    table_number: 'T1',
    sale_process: 'KOT',
    payment_status: 'Paid',
    floor_lifecycle: true,
  });
  const body = {
    id: first.id,
    version: 0,
    request_id: 'combined-close-0001',
    orderIds: [String(orderId)],
  };
  const release = jest
    .spyOn(seating, 'release')
    .mockRejectedValueOnce(new Error('connection lost'));
  await expect(service.close(req(body))).rejects.toThrow('connection lost');
  release.mockRestore();
  const pending = (await service.list(req())).tables;
  expect(pending.every((table) => table.closing?.request_id === body.request_id)).toBe(true);
  await service.close(req(body));
  expect(
    (await service.list(req())).tables.every(
      (table) => table.status === 'cleaning' && !table.closing
    )
  ).toBe(true);
});

test.each(['available', 'cleaning'])(
  'close intent %s survives interruption before table write and is exposed for screen recovery',
  async (afterClose) => {
    const seating = require('../../../src/services/seating-claims');
    const table = await service.update(
      req({ tableorder_value: 'T1', capacity: 4, max_capacity: 4 })
    );
    const scope = { branchId: branch, license };
    const claim = await seating.reserve(db, scope, {
      request_id: 'seating-close-0001',
      actor: String(user),
      table_ids: [table.id],
      primary_id: table.id,
      guests: 2,
    });
    const id = new ObjectId();
    await seating.bind(db, scope, claim.id, String(user), String(id));
    await db.collection('sales').insertOne({
      _id: id,
      branch_id: branch,
      license,
      table_number: 'T1',
      seating_request_id: claim.id,
      sale_process: 'KOT',
      payment_status: 'Paid',
      floor_lifecycle: true,
    });
    const body = {
      id: table.id,
      version: 0,
      request_id: 'closing-request-0001',
      afterClose,
      orderIds: [String(id)],
    };
    const input = req(body),
      tables = db.collection('tableorder');
    input.db = {
      collection(name) {
        return name === 'tableorder'
          ? {
              findOne: (...args) => tables.findOne(...args),
              updateOne: async () => {
                throw new Error('interrupted');
              },
            }
          : db.collection(name);
      },
    };
    await expect(service.close(input)).rejects.toThrow('interrupted');
    const pending = (await service.list(req())).tables[0];
    expect(pending.closing).toEqual({
      request_id: body.request_id,
      orderIds: body.orderIds,
      afterClose,
    });
    await service.close(req({ ...body, version: pending.version }));
    const closed = (await service.list(req())).tables[0];
    expect(closed.status).toBe(afterClose);
    expect(closed.closing).toBeNull();
  }
);

test('payment change during close leaves a recoverable partial close and never frees the table', async () => {
  const { body, orderId } = await paidTable();
  const sales = db.collection('sales');
  const second = new ObjectId();
  const original = await sales.findOne({ _id: orderId });
  await sales.insertOne({ ...original, _id: second });
  body.orderIds.push(String(second));
  const input = req(body);
  let changed = false;
  input.db = {
    collection(name) {
      const collection = db.collection(name);
      if (name !== 'sales') return collection;
      return new Proxy(collection, {
        get(target, key) {
          if (key === 'updateMany')
            return async (...args) => {
              if (!changed) {
                changed = true;
                await sales.updateOne({ _id: second }, { $set: { balance: 50 } });
              }
              return sales.updateMany(...args);
            };
          const value = target[key];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    },
  };
  await expect(service.close(input)).rejects.toMatchObject({ status: 409 });
  const first = await sales.findOne({ _id: orderId });
  expect(first.floor_closed_at).toBeDefined();
  expect((await sales.findOne({ _id: second })).floor_closed_at).toBeUndefined();
  const pending = (await service.list(req())).tables[0];
  expect(pending.status).toBe('occupied');
  expect(pending.closing.request_id).toBe(body.request_id);
  await sales.updateOne({ _id: second }, { $set: { balance: 0 } });
  await service.close(req({ ...body, version: pending.version }));
  expect((await sales.findOne({ _id: orderId })).floor_closed_at).toEqual(first.floor_closed_at);
  expect((await service.list(req())).tables[0].closing).toBeNull();
});

test('the Captain seating endpoint forwards order type and confirms a retryable takeaway conversion', async () => {
  const seating = require('../../../src/services/seating-claims');
  const endpoint = require('../../../src/services/captain-seating');
  const table = await service.update(req({ tableorder_value: 'T1', capacity: 2, max_capacity: 4 }));
  const scope = { branchId: branch, license };
  const claim = await seating.reserve(db, scope, {
    request_id: 'initial-type-seat-1',
    actor: String(user),
    table_ids: [table.id],
    primary_id: table.id,
    guests: 2,
  });
  const orderId = new ObjectId();
  await seating.bind(db, scope, claim.id, String(user), String(orderId));
  await db.collection('sales').insertOne({
    _id: orderId,
    branch_id: branch,
    license,
    seating_request_id: claim.id,
    table_number: 'T1',
    dine_type: 'Dine-in',
    person_count: 2,
    sale_process: 'KOT',
    payment_status: 'Unpaid',
    items: [{ item_name: 'Soup', item_quantity: 2 }],
    sales_total: 90,
  });
  const request = {
    orderId: String(orderId),
    request_id: 'public-takeaway-0001',
    tableIds: [],
    primaryId: '',
    guests: 0,
    dineType: 'Take away',
  };
  expect(await endpoint.prepare(req(request, 'staff'))).toMatchObject({
    dineType: 'Take away',
    state: 'reserved',
  });
  const sync = jest
    .spyOn(require('../../../src/sync/outbox'), 'enqueue')
    .mockImplementation(() => {});
  try {
    expect(await endpoint.complete(req({ request_id: request.request_id }, 'staff'))).toMatchObject(
      { dineType: 'Take away', state: 'submitting', tableIds: [] }
    );
    expect(await endpoint.complete(req({ request_id: request.request_id }, 'staff'))).toMatchObject(
      { dineType: 'Take away', state: 'submitting' }
    );
  } finally {
    sync.mockRestore();
  }
  expect((await service.list(req())).tables[0]).toMatchObject({ status: 'cleaning', orders: [] });
  expect(await db.collection('sales').findOne({ _id: orderId })).toMatchObject({
    dine_type: 'Take away',
    sales_total: 90,
    items: [{ item_name: 'Soup', item_quantity: 2 }],
  });
  expect(await db.collection('print_jobs').countDocuments({})).toBe(0);
});

test('cleaning is opt-in and legacy cleaning flags do not block when disabled', async () => {
  await db
    .collection('branches')
    .updateOne({ _id: branch }, { $unset: { captain_table_cleaning: '' } });
  const row = await service.update(req({ tableorder_value: '4', capacity: 4 }));
  await db
    .collection('tableorder')
    .updateOne({ _id: new ObjectId(row.id) }, { $set: { service_state: 'cleaning' } });
  const listed = await service.list(req());
  expect(listed.cleaningEnabled).toBe(false);
  expect(listed.tables[0].status).toBe('available');
  await expect(
    service.state(req({ id: row.id, version: 0, status: 'cleaning' }))
  ).rejects.toMatchObject({ status: 409 });
  await db
    .collection('branches')
    .updateOne({ _id: branch }, { $set: { captain_table_cleaning: true } });
  expect((await service.list(req())).tables[0].status).toBe('cleaning');
});

test('cleaning is explicit and a retry cannot change the saved choice', async () => {
  const { body } = await paidTable();
  const input = { ...body, afterClose: 'cleaning' };
  expect((await service.close(req(input))).status).toBe('cleaning');
  expect((await service.close(req(input))).status).toBe('cleaning');
  await expect(service.close(req({ ...input, afterClose: 'available' }))).rejects.toThrow(
    'Table changed'
  );
});
test('invalid post-close state is rejected before closing', async () => {
  const { body } = await paidTable();
  await expect(service.close(req({ ...body, afterClose: 'occupied' }))).rejects.toThrow(
    'Choose Available or Cleaning'
  );
});

test('closing a paid table defaults to available when cleaning is unset', async () => {
  await db
    .collection('branches')
    .updateOne({ _id: branch }, { $unset: { captain_table_cleaning: '' } });
  const { body } = await paidTable();
  expect((await service.close(req(body))).status).toBe('available');
  expect((await service.close(req(body))).status).toBe('available');
});

test('staff temporary labels are normalized, retry safe and do not alter configured tables', async () => {
  const rows = await Promise.all(
    Array.from({ length: 8 }, () => service.temporary(req({ tableorder_value: ' 6a ' }, 'staff')))
  );
  expect(new Set(rows.map((row) => row.id)).size).toBe(1);
  expect(rows[0].tableorder_value).toBe('6A');
  expect(await db.collection('tableorder').countDocuments({ branch_id: branch })).toBe(1);
  const existing = await service.update(req({ tableorder_value: '6B', capacity: 4 }));
  expect((await service.temporary(req({ tableorder_value: '6b', capacity: 50 }, 'staff'))).id).toBe(
    existing.id
  );
  expect(
    (await db.collection('tableorder').findOne({ _id: new ObjectId(existing.id) })).capacity
  ).toBe(4);
  await expect(service.temporary(req({ tableorder_value: '6/A' }, 'staff'))).rejects.toThrow(
    'letters or numbers'
  );
  await expect(
    service.temporary({ ...req({ tableorder_value: '6C' }), user: { role: 'staff' } })
  ).rejects.toMatchObject({ status: 403 });
  const other = new ObjectId();
  await db.collection('branches').insertOne({ _id: other, license });
  const otherRow = await service.temporary({
    ...req({ tableorder_value: '6A' }, 'staff'),
    tenantContext: { branchId: other, licenseId: license },
  });
  expect(otherRow.id).not.toBe(rows[0].id);
});
