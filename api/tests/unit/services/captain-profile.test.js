'use strict';
const { MongoMemoryServer } = require('mongodb-memory-server');
const { ObjectId } = require('mongodb');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const profile = require('../../../src/services/captain-profile');
const { passwordMatches } = require('../../../src/utils/password-match');
let server, db, license, branch, user;
beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri('profile'));
  db = mongoose.connection.db;
}, 60000);
afterAll(async () => {
  await mongoose.disconnect();
  await server?.stop();
});
beforeEach(async () => {
  await db.dropDatabase();
  license = new ObjectId();
  branch = new ObjectId();
  user = new ObjectId();
  await db.collection('branches').insertOne({ _id: branch, license });
  await db.collection('users').insertOne({
    _id: user,
    license,
    activate: true,
    name: 'Original',
    email: 'staff@example.test',
    password: await bcrypt.hash(Buffer.from('old-secret-123').toString('base64'), 4),
  });
});
const req = (body) => ({
  db,
  user: { _id: user },
  tenantContext: { branchId: branch, licenseId: license },
  body,
  ip: '127.0.0.1',
});
test('profile updates only the authenticated user name and never privilege fields', async () => {
  expect(await profile.get(req())).toEqual({
    id: String(user),
    name: 'Original',
    email: 'staff@example.test',
    phone: '',
  });
  await profile.update(req({ name: ' Updated ', role: 'admin', email: 'other@example.test' }));
  const saved = await db.collection('users').findOne({ _id: user });
  expect(saved.name).toBe('Updated');
  expect(saved.email).toBe('staff@example.test');
  expect(saved.role).toBeUndefined();
  await expect(profile.update(req({ name: '' }))).rejects.toThrow('Enter your name');
});
test('password change verifies current password, preserves till login compatibility and revokes old authorizations', async () => {
  await db.collection('captain_sessions').insertOne({ userId: user, license, revoked: false });
  const input = req({
    currentPassword: 'wrong',
    newPassword: 'new-secret-123',
    confirmPassword: 'new-secret-123',
  });
  await expect(profile.password(input)).rejects.toThrow('current password');
  input.body.currentPassword = 'old-secret-123';
  expect(await profile.password(input)).toEqual({ saved: true, reauthenticate: true });
  const saved = await db.collection('users').findOne({ _id: user });
  expect(await passwordMatches('new-secret-123', saved.password)).toBe(true);
  expect(
    await bcrypt.compare(Buffer.from('new-secret-123').toString('base64'), saved.password)
  ).toBe(true);
  expect(saved.authVersion).toBe(1);
  expect((await db.collection('captain_sessions').findOne({ userId: user })).revoked).toBe(true);
  const audit = await db.collection('audit_log').findOne({ event: 'captain.password.changed' });
  expect(JSON.stringify(audit)).not.toContain('secret-123');
});
test('cross-license access and mismatching new passwords are rejected', async () => {
  const request = req();
  request.tenantContext.licenseId = new ObjectId();
  await expect(profile.get(request)).rejects.toThrow();
  await expect(
    profile.password(
      req({
        currentPassword: 'old-secret-123',
        newPassword: 'new-secret-123',
        confirmPassword: 'different',
      })
    )
  ).rejects.toThrow('repeat');
});
