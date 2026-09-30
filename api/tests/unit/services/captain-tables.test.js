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
  await db
    .collection('sales')
    .insertOne({
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
  await db
    .collection('sales')
    .insertOne({
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
