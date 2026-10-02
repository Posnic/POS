'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');
const { zip, signedEntries, sourceEntries, options } = require('./fixtures/signed-extension.cjs');
const { createLibraryStorage } = require('../src/services/extension-library-storage');
const { publishPrivateRelease } = require('../src/services/extension-library-publication');
const library = require('../src/services/extension-private-library');
let mongo, client;
before(async () => { mongo = await MongoMemoryServer.create(); client = await MongoClient.connect(mongo.getUri()); });
after(async () => { await client?.close(); await mongo?.stop(); });
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'posnic-publish-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const db = client.db('publish_' + crypto.randomBytes(6).toString('hex'));
  await library.initializeLibrary(db);
  const storage = await createLibraryStorage(root);
  const actor = { id: 'publisher-one', roles: ['extension-publisher'] };
  const input = { package: zip(signedEntries()), organizations: ['shop-owner'], displayName: 'Private example' };
  return { root, db, storage, actor, input, publish: (data = input, who = actor, overrides = {}) =>
    publishPrivateRelease(db, who, data, { ...options, storage, ...overrides }) };
}
test('signed private publication survives concurrent retries and requires a separate download grant', async t => {
  const f = await fixture(t);
  const results = await Promise.all(Array.from({ length: 10 }, () => f.publish()));
  assert.equal(new Set(results.map(row => row.releaseId)).size, 1);
  assert.equal(await f.db.collection('library_releases').countDocuments(), 1);
  const owner = { id: 'owner' }, id = results[0].releaseId;
  await f.db.collection('library_memberships').insertOne({ organizationId: 'shop-owner', userId: owner.id, status: 'active' });
  assert.deepEqual(await library.listReleases(f.db, owner, 'shop-owner'), []);
  await f.db.collection('library_entitlements').insertOne({ organizationId: 'shop-owner', extensionId: 'posnic.example', status: 'active', releaseIds: [id] });
  const ticket = await library.issueDownload(f.db, owner, 'shop-owner', id, 'package');
  assert.deepEqual((await library.download(f.db, owner, ticket.token, f.storage.read)).bytes, f.input.package);
  await assert.rejects(library.issueDownload(f.db, owner, 'shop-owner', id, 'source'), /unavailable/);
});
test('untrusted actor, malformed ZIP and wrong signing key cannot publish', async t => {
  const f = await fixture(t);
  await assert.rejects(f.publish(f.input, { id: 'till-admin', roles: ['manage'] }), /forbidden/);
  await assert.rejects(f.publish({ ...f.input, package: Buffer.from('invalid ZIP') }));
  await assert.rejects(f.publish(f.input, f.actor, { publicKey: crypto.generateKeyPairSync('ed25519').publicKey }));
  assert.equal(await f.db.collection('library_releases').countDocuments(), 0);
  assert.deepEqual(await fs.readdir(f.root), []);
});
test('published version cannot be replaced, audience-expanded or restored after withdrawal by retry', async t => {
  const f = await fixture(t), result = await f.publish();
  await assert.rejects(f.publish({ ...f.input, organizations: ['shop-owner', 'another-owner'] }), /conflict/);
  const different = zip(signedEntries([{ name: 'extra.txt', body: Buffer.from('different release') }]));
  await assert.rejects(f.publish({ ...f.input, package: different }), /conflict/);
  await f.db.collection('library_releases').updateOne({ _id: result.releaseId }, { $set: { status: 'withdrawn' } });
  await assert.rejects(f.publish(), /conflict/);
  const release = await f.db.collection('library_releases').findOne({ _id: result.releaseId });
  assert.equal(release.status, 'withdrawn');
  assert.deepEqual(release.organizations, ['shop-owner']);
  assert.deepEqual(await f.storage.read(release.artifacts.package.sha256), f.input.package);
});

test('signed source binds to exact runtime and needs its own revocable access grant', async t => {
  const f = await fixture(t);
  const { readExtensionArchive } = require('../src/services/extension-archive');
  const runtime = await readExtensionArchive(f.input.package, options);
  const source = zip(sourceEntries(runtime.packageDigest));
  const release = await f.publish({ ...f.input, source });
  const actor = { id: 'source-owner' };
  await f.db.collection('library_memberships').insertOne({ organizationId: 'shop-owner', userId: actor.id, status: 'active' });
  await f.db.collection('library_entitlements').insertOne({ organizationId: 'shop-owner', extensionId: release.extensionId,
    status: 'active', releaseIds: [release.releaseId], sourceAccess: false });
  await assert.rejects(library.issueDownload(f.db, actor, 'shop-owner', release.releaseId, 'source'), /unavailable/);
  await f.db.collection('library_entitlements').updateOne({ organizationId: 'shop-owner' }, { $set: { sourceAccess: true } });
  const ticket = await library.issueDownload(f.db, actor, 'shop-owner', release.releaseId, 'source');
  assert.deepEqual((await library.download(f.db, actor, ticket.token, f.storage.read)).bytes, source);
  await f.db.collection('library_entitlements').updateOne({ organizationId: 'shop-owner' }, { $set: { sourceAccess: false } });
  await assert.rejects(library.download(f.db, actor, ticket.token, f.storage.read), /unavailable/);
  await assert.rejects(readExtensionArchive(source, options));
});

test('wrong runtime binding and tampered source fail before any artifact is published', async t => {
  const f = await fixture(t);
  await assert.rejects(f.publish({ ...f.input, source: zip(sourceEntries('b'.repeat(64))) }), /source_mismatch/);
  const entries = sourceEntries('b'.repeat(64));
  entries.find(entry => entry.name === 'src/worker.js').body = Buffer.from('tampered source');
  await assert.rejects(f.publish({ ...f.input, source: zip(entries) }), /source_invalid/);
  assert.equal(await f.db.collection('library_releases').countDocuments(), 0);
  assert.deepEqual(await fs.readdir(f.root), []);
});
