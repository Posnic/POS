'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');
const library = require('../src/services/extension-private-library');
let mongo, client, db;
before(async () => { mongo = await MongoMemoryServer.create(); client = await MongoClient.connect(mongo.getUri()); });
after(async () => { await client?.close(); await mongo?.stop(); });
async function fixture() {
  db = client.db('library_' + crypto.randomBytes(6).toString('hex'));
  await library.initializeLibrary(db);
  const actor = { id: 'account-one' }, other = { id: 'account-two' }, org = 'organization-one';
  const bytes = Buffer.from('synthetic verified package bytes');
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  await db.collection('library_memberships').insertMany([
    { userId: actor.id, organizationId: org, status: 'active' },
    { userId: other.id, organizationId: 'organization-two', status: 'active' },
  ]);
  await db.collection('library_releases').insertOne({ _id: 'release-one', extensionId: 'posnic.example',
    version: '1.0.0', displayName: 'Private extension', status: 'approved', visibility: 'private', organizations: [org],
    artifacts: { package: { sha256, bytes: bytes.length }, source: { sha256, bytes: bytes.length } } });
  await db.collection('library_entitlements').insertOne({ organizationId: org, extensionId: 'posnic.example',
    status: 'active', releaseIds: ['release-one'], sourceAccess: true, maintenanceEndsAt: new Date('2020-01-01') });
  return { actor, other, org, bytes, read: async () => bytes };
}
test('private release and source downloads require membership AND exact release grant', async () => {
  const f = await fixture();
  assert.equal((await library.listReleases(db, f.actor, f.org)).length, 1);
  assert.deepEqual(await library.listReleases(db, f.other, 'organization-two'), []);
  await assert.rejects(library.listReleases(db, f.other, f.org), /unavailable/);
  const ticket = await library.issueDownload(db, f.actor, f.org, 'release-one', 'source');
  const result = await library.download(db, f.actor, ticket.token, f.read);
  assert.deepEqual(result.bytes, f.bytes);
  assert.equal(result.cacheControl, 'private, no-store');
  assert.equal((await db.collection('library_download_tickets').findOne())._id.includes(ticket.token), false);
  await assert.rejects(library.download(db, f.other, ticket.token, f.read), /unavailable/);
});
test('tickets expire and membership revocation takes effect before link expiry', async () => {
  const f = await fixture(), now = new Date('2026-10-02T00:00:00Z');
  const ticket = await library.issueDownload(db, f.actor, f.org, 'release-one', 'package', { now });
  await assert.rejects(library.download(db, f.actor, ticket.token, f.read, { now: ticket.expiresAt }), /unavailable/);
  await db.collection('library_memberships').updateOne({ userId: f.actor.id }, { $set: { status: 'revoked' } });
  await assert.rejects(library.download(db, f.actor, ticket.token, f.read, { now }), /unavailable/);
});
test('withdrawn release, revoked source grant, changed artifact and corrupted storage are denied', async () => {
  const f = await fixture();
  const ticket = await library.issueDownload(db, f.actor, f.org, 'release-one', 'source');
  await assert.rejects(library.download(db, f.actor, ticket.token, async () => Buffer.from('tampered')), /unavailable/);
  await db.collection('library_releases').updateOne({ _id: 'release-one' }, { $set: { status: 'withdrawn' } });
  await assert.rejects(library.download(db, f.actor, ticket.token, f.read), /unavailable/);
  await db.collection('library_releases').updateOne({ _id: 'release-one' }, { $set: { status: 'approved' } });
  await db.collection('library_entitlements').updateOne({ organizationId: f.org }, { $set: { sourceAccess: false } });
  await assert.rejects(library.download(db, f.actor, ticket.token, f.read), /unavailable/);
  await db.collection('library_entitlements').updateOne({ organizationId: f.org }, { $set: { sourceAccess: true } });
  await db.collection('library_releases').updateOne({ _id: 'release-one' }, { $set: { 'artifacts.source.sha256': 'a'.repeat(64) } });
  await assert.rejects(library.download(db, f.actor, ticket.token, f.read), /unavailable/);
});

test('registry HTTP boundary authenticates tickets and never caches private packages', async () => {
  const f = await fixture();
  const express = require('express'), app = express();
  const { createLibraryRouter } = require('../src/routes/extension-library.routes');
  assert.throws(() => createLibraryRouter({ db, readBlob: f.read }), /dependencies_required/);
  app.use('/library', createLibraryRouter({ db, readBlob: f.read, authenticate: (req, res, next) => {
    if (req.headers.authorization !== 'Bearer synthetic-account') return res.sendStatus(401);
    req.libraryActor = f.actor; next();
  } }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const origin = `http://127.0.0.1:${server.address().port}/library`;
    const headers = { Authorization: 'Bearer synthetic-account', 'Content-Type': 'application/json' };
    assert.equal((await fetch(origin + '/organizations/' + f.org + '/releases')).status, 401);
    const ticketResponse = await fetch(origin + '/organizations/' + f.org + '/download-tickets', {
      method: 'POST', headers, body: JSON.stringify({ releaseId: 'release-one', kind: 'source', actor: f.other }),
    });
    assert.equal(ticketResponse.status, 200);
    const ticket = await ticketResponse.json();
    const response = await fetch(origin + '/downloads', { method: 'POST', headers, body: JSON.stringify({ token: ticket.token }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), f.bytes);
    await db.collection('library_memberships').updateOne({ userId: f.actor.id }, { $set: { status: 'revoked' } });
    assert.equal((await fetch(origin + '/downloads', { method: 'POST', headers, body: JSON.stringify({ token: ticket.token }) })).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('release lookup rejects operator objects and arrays before issuing tickets', async () => {
  const f = await fixture();
  for (const releaseId of [{ $ne: null }, ['release-one'], { $regex: '.*' }, null]) {
    await assert.rejects(
      library.issueDownload(db, f.actor, f.org, releaseId, 'package'),
      /unavailable/
    );
  }
  assert.equal(await db.collection('library_download_tickets').countDocuments({}), 0);
});
