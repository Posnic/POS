const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');
const service = require('../../../src/services/captain-branch-details');
let server, db, branch, license, user;
beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri('branch-details'));
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
  await db.collection('branches').insertOne({
    _id: branch,
    license,
    branch_name: 'Garden',
    captain_payments: { enabled: true },
  });
});
const req = (body = {}, role = 'manager') => ({
  db,
  body,
  user: { _id: user, role },
  tenantContext: { branchId: branch, licenseId: license },
});
test('only managers can update scoped branch UPI details and unrelated settings are preserved', async () => {
  await expect(service.get(req({}, 'staff'))).rejects.toThrow('Permission');
  const initial = await service.get(req());
  const result = await service.update(
    req({
      ...initial,
      branch_upi_id: 'garden@bank',
      branch_upi_name: 'Garden',
      captain_payments: { enabled: false },
      license: 'other',
    })
  );
  expect(result.branch_upi_id).toBe('garden@bank');
  expect((await db.collection('branches').findOne({ _id: branch })).captain_payments.enabled).toBe(
    true
  );
  await expect(
    service.update(req({ ...initial, branch_upi_id: 'other@bank', branch_upi_name: 'Other' }))
  ).rejects.toThrow('Settings changed');
});
test('invalid receiving details are rejected, clearing is explicit, and another tenant cannot edit', async () => {
  const initial = await service.get(req());
  await expect(
    service.update(req({ ...initial, branch_upi_id: 'upi://bad', branch_upi_name: 'Bad' }))
  ).rejects.toThrow('valid UPI');
  const current = await service.update(
    req({ ...initial, branch_upi_id: 'garden@bank', branch_upi_name: 'Garden' })
  );
  const cleared = await service.update(
    req({ ...current, branch_upi_id: '', branch_upi_name: 'Old' })
  );
  expect(cleared.branch_upi_id).toBe('');
  expect(cleared.branch_upi_name).toBe('');
  const wrong = req();
  wrong.tenantContext.licenseId = new ObjectId();
  await expect(service.get(wrong)).rejects.toThrow('Branch not found');
});
