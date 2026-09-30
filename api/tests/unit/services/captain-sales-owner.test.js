'use strict';
const { MongoMemoryServer } = require('mongodb-memory-server');
const { ObjectId } = require('mongodb');
const mongoose = require('mongoose');
const owner = require('../../../src/helpers/captain-sales-owner');
let server, collection;
beforeAll(async () => {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri('sales-owner'));
  collection = mongoose.connection.db.collection('sales');
}, 60000);
afterAll(async () => { await mongoose.disconnect(); await server?.stop(); });
test('Captain ownership survives cashier completion and handover without accepting online client claims', async () => {
  const captain = new ObjectId(), cashier = new ObjectId(), branch = new ObjectId(), license = new ObjectId();
  const scope = { branch_id: branch, license };
  await collection.insertMany([
    { ...scope, name: 'captain-paid', channel: 'tableside', client: { staff_id: String(captain) }, user_id: cashier, created_by_id: cashier, assigned_staff: { id: String(cashier) }, payment_status: 'Paid' },
    { ...scope, name: 'desktop-oid', user_id: captain },
    { ...scope, name: 'desktop-string', created_by_id: String(captain) },
    { ...scope, name: 'older-tableside', channel: 'tableside', user_id: captain },
    { ...scope, name: 'other-captain', channel: 'tableside', client: { staff_id: String(cashier) }, created_by_id: captain },
    { ...scope, name: 'untrusted-online', channel: 'online', client: { staff_id: String(captain) }, user_id: cashier },
    { ...scope, branch_id: new ObjectId(), name: 'other-branch', channel: 'tableside', client: { staff_id: String(captain) } },
    { ...scope, license: new ObjectId(), name: 'other-shop', user_id: captain },
  ]);
  const rows = await collection.find({ ...scope, ...owner(captain) }).toArray();
  expect(rows.map(row => row.name).sort()).toEqual(['captain-paid', 'desktop-oid', 'desktop-string', 'older-tableside']);
  const cashierRows = await collection.find({ ...scope, ...owner(cashier) }).toArray();
  expect(cashierRows.map(row => row.name).sort()).toEqual(['other-captain', 'untrusted-online']);
});
