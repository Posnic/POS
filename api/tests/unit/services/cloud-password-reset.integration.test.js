'use strict';
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');
let controller;
const { passwordMatches } = require('../../../src/utils/password-match');
let memory, db;
const response = () => {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
};
beforeAll(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri('cloud-password-regression'));
  db = mongoose.connection.db;
  require('../../../src/models/base.model').database = db;
  controller = require('../../../src/controllers/users.controller');
}, 60000);
afterAll(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});
test('web reset advances the incremental user checkpoint, keeps shop data, and spends token once', async () => {
  const checkpoint = new Date(Date.now() - 10000);
  const id = new ObjectId();
  const user = {
    _id: id,
    email: 'reset@example.test',
    password: await bcrypt.hash('Before-123', 4),
    userkey: 'synthetic-test-reset',
    updated_date: checkpoint,
    expire_date: new Date(Date.now() + 60000),
    authVersion: 2,
  };
  await db.collection('users').insertOne(user);
  await db.collection('sales').insertOne({ _id: new ObjectId(), total: 105, marker: 'preserve' });
  const body = {
    forgot_key_value: user.userkey,
    update_new_password: 'After-123',
    retype_new_password: 'After-123',
  };
  const res = response();
  await controller.updateNewPassword({ body }, res);
  expect(res.json.mock.calls[0][0].type).toBe('success');
  // This is the gateway's timestamp predicate, against actual Mongo records.
  const changed = await db
    .collection('users')
    .find({ updated_date: { $gt: checkpoint } })
    .toArray();
  expect(changed).toHaveLength(1);
  expect(await passwordMatches('After-123', changed[0].password)).toBe(true);
  expect(await passwordMatches('Before-123', changed[0].password)).toBe(false);
  expect(changed[0].authVersion).toBe(3);
  expect(changed[0].expire_date).toBeUndefined();
  expect(await db.collection('sales').findOne({ marker: 'preserve' })).toMatchObject({
    total: 105,
  });
  const second = response();
  await controller.updateNewPassword({ body }, second);
  expect(second.json.mock.calls[0][0].type).not.toBe('success');
});
