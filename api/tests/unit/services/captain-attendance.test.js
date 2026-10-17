'use strict';
const { MongoMemoryServer } = require('mongodb-memory-server');
const { ObjectId } = require('mongodb');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
jest.mock('../../../src/services/captain-access', () => ({ fail(code, message, status = 403) {
  throw Object.assign(new Error(message), { code, status });
} }));
jest.mock('../../../src/db/tenant-context', () => ({ isMultiTenant: () => false }));
const service = require('../../../src/services/captain-attendance');
let mem, db, req;
const previousDesktop = process.env.POSNIC_DESKTOP;
beforeAll(async () => {
  mem = await MongoMemoryServer.create(); await mongoose.connect(mem.getUri('attendance')); db = mongoose.connection.db;
}, 60000);
afterAll(async () => { await mongoose.disconnect(); await mem?.stop();
  if (previousDesktop === undefined) delete process.env.POSNIC_DESKTOP; else process.env.POSNIC_DESKTOP = previousDesktop;
});
beforeEach(async () => {
  process.env.POSNIC_DESKTOP = '1'; await db.dropDatabase();
  const branchId = new ObjectId(), licenseId = new ObjectId();
  req = { db, tenantContext: { branchId, licenseId }, user: { _id: new ObjectId(), username: 'Staff' },
    socket: { remoteAddress: '::ffff:192.168.1.23' }, headers: {}, body: {} };
  await db.collection('branches').insertOne({ _id: branchId, license: licenseId });
});
async function enable() {
  await db.collection('branches').updateOne({ _id: req.tenantContext.branchId }, { $set: { captain_attendance: { enabled: true } } });
}
const start = () => ({ action: 'start', requestId: randomUUID() });
test('unset is off and only manager can opt in', async () => {
  expect((await service.current(req)).enabled).toBe(false);
  req.body = start(); await expect(service.record(req)).rejects.toMatchObject({ code: 'ATTENDANCE_DISABLED' });
  req.body = { enabled: true }; await expect(service.settings(req)).rejects.toMatchObject({ code: 'MANAGER_REQUIRED' });
  req.user.role = 'manager'; await service.settings(req);
  expect((await service.current(req)).enabled).toBe(true);
});
test('server timestamps, duplicate request recovery, end replay and no automatic finish', async () => {
  await enable(); req.body = { ...start(), clock_in: '2000-01-01' };
  const first = await service.record(req);
  expect(new Date(first.shift.clockIn).getFullYear()).toBe(new Date().getFullYear());
  expect((await service.record(req)).shift.id).toBe(first.shift.id);
  await db.collection('shifts').updateOne({}, { $set: { clock_in: new Date(Date.now() - 28 * 3600000) } });
  req.body = start(); await expect(service.record(req)).rejects.toMatchObject({ code: 'SHIFT_ALREADY_OPEN' });
  expect((await service.current(req)).shift.status).toBe('open');
  req.body = { action: 'end', shiftId: first.shift.id, requestId: randomUUID() };
  const ended = await service.record(req); const again = await service.record(req);
  expect(again.shift.clockOut).toEqual(ended.shift.clockOut);
  expect(ended.shift.workedMinutes).toBe(1680);
  expect((await db.collection('shifts').findOne({})).attendance_events).toHaveLength(2);
});
test('two phones cannot create two open shifts', async () => {
  await enable();
  const results = await Promise.allSettled([service.record({ ...req, body: start() }), service.record({ ...req, body: start() })]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(await db.collection('shifts').countDocuments({ status: 'open' })).toBe(1);
});
test('staff cannot end another staff member or branch shift', async () => {
  await enable(); req.body = start(); const result = await service.record(req);
  req.body = { action: 'end', shiftId: result.shift.id, requestId: randomUUID() };
  const original = req.user._id; req.user._id = new ObjectId();
  await expect(service.record(req)).rejects.toMatchObject({ code: 'SHIFT_NOT_FOUND' });
  req.user._id = original; req.tenantContext.branchId = new ObjectId();
  await db.collection('branches').insertOne({ _id: req.tenantContext.branchId, license: req.tenantContext.licenseId });
  await expect(service.record(req)).rejects.toMatchObject({ code: 'SHIFT_NOT_FOUND' });
});
test('disabling blocks new shifts but still allows finishing an existing one', async () => {
  await enable(); req.body = start(); const result = await service.record(req);
  await db.collection('branches').updateOne({}, { $set: { captain_attendance: { enabled: false } } });
  req.body = { action: 'end', shiftId: result.shift.id, requestId: randomUUID() };
  expect((await service.record(req)).shift.status).toBe('closed');
});
test.each(['203.0.113.1', '127.0.0.1', '::1', ''])('rejects non-LAN or proxy address %s', async ip => {
  req.socket.remoteAddress = ip;
  await expect(service.current(req)).rejects.toMatchObject({ code: 'ATTENDANCE_WIFI_REQUIRED' });
});
test('cloud private IP and forwarded Wi-Fi claims are not attendance proof', async () => {
  process.env.POSNIC_DESKTOP = '0';
  await expect(service.current(req)).rejects.toMatchObject({ code: 'ATTENDANCE_WIFI_REQUIRED' });
  process.env.POSNIC_DESKTOP = '1'; req.headers['x-forwarded-for'] = '192.168.1.10';
  await expect(service.current(req)).rejects.toMatchObject({ code: 'ATTENDANCE_WIFI_REQUIRED' });
});
