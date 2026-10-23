const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { once } = require('events');
const { finished } = require('stream/promises');
const zlib = require('zlib');
const { MongoMemoryServer } = require('../api/node_modules/mongodb-memory-server');
const { MongoClient, ObjectId, BSON } = require('../api/node_modules/mongodb');
const { lastTouched, planDocument, fingerprint, parseArgs, validateTargets,
  canDelete, casFilter, reconcileCollection, backupDatabase, COLLECTIONS } = require('../scripts/migrate-legacy-tenant');
const license = new ObjectId();
const older = new Date('2026-07-01T00:00:00Z'), newer = new Date('2026-10-01T00:00:00Z');
const doc = (fields = {}) => ({ _id: new ObjectId('670000000000000000000001'), license, updated_date: older, ...fields });
function resolution(source, destination, keep) {
  return { ['items/' + source._id]: { source: fingerprint(source), destination: fingerprint(destination), keep } };
}
test('dry comparison is default; applies require explicit tenant and backup', () => {
  assert.equal(parseArgs([]).dry, true);
  assert.throws(() => parseArgs(['--apply']), /requires/);
  assert.throws(() => parseArgs(['--apply', '--dry']), /Choose/);
  assert.throws(() => parseArgs(['--since=2026-07-01']), /unsafe/);
  assert.equal(parseArgs(['--apply', '--only=hmfuniform', '--backup-dir=x']).dry, false);
});
test('tenant identity rejects duplicate databases, invalid IDs and traversal', () => {
  const t = { license: String(license), subdomain: 'hmf', tenantDb: 'posnic_t_hmf' };
  assert.equal(validateTargets([t], 'hmf')[0].tenantDb, 'posnic_t_hmf');
  assert.throws(() => validateTargets([t, { ...t, subdomain: 'other' }]), /repeated/);
  assert.throws(() => validateTargets([{ ...t, tenantDb: '../Web' }]), /Invalid/);
  assert.throws(() => validateTargets([{ ...t, license: 'bad' }]), /Invalid/);
});
test('missing rows preserve IDs and normalize blank optional email', () => {
  const s = doc({ email: '  ' });
  const p = planDocument(s, null, 'customers', { license });
  assert.equal(p.action, 'insert'); assert.equal(String(p.document._id), String(s._id));
  assert.equal(Object.hasOwn(p.document, 'email'), false);
});
test('blank and absent email are equal instead of restoring duplicate blanks', () => {
  assert.equal(planDocument(doc({ email: '' }), doc(), 'customers').action, 'equal');
  assert.equal(planDocument(doc({ email: null }), doc(), 'suppliers').action, 'equal');
  assert.equal(planDocument(doc({ email: '', updated_date: newer }), doc({ email: 'added-in-core@example.com' }), 'customers').action, 'update');
  assert.equal(planDocument(doc({ email: '', updated_date: newer }), doc({ email: 'added-in-core@example.com' }), 'customers').document.email, 'added-in-core@example.com');
});
test('changed shared fields without newer source timestamp are conflicts', () => {
  assert.equal(planDocument(doc({ available_quantity: 4 }), doc({ available_quantity: 8 }), 'items').reason, 'ambiguous-timestamp');
  assert.equal(planDocument(doc({ updated_date: undefined, name: 'old' }), doc({ updated_date: undefined, name: 'new' }), 'items').action, 'conflict');
});
test('newer Core data is never overwritten automatically', () => {
  assert.equal(planDocument(doc({ name: 'old' }), doc({ name: 'new', updated_date: newer }), 'items').reason, 'newer-in-destination');
});
test('newer source preserves Core-only top-level, nested and per-branch fields', () => {
  const s = doc({ updated_date: newer, access: { sales: { read: true } }, branch_access: [{ branch_id: 'one', name: 'Shop' }] });
  const d = doc({ schema_version: 2, access: { sales: { read: false }, messaging: { send_sms: false } }, branch_access: [{ branch_id: 'one', theme: 'dark' }, { branch_id: 'revoked' }] });
  const p = planDocument(s, d, 'users');
  assert.equal(p.action, 'update'); assert.equal(p.document.schema_version, 2);
  assert.equal(p.document.access.messaging.send_sms, false);
  assert.equal(p.document.access.sales.read, true);
  assert.deepEqual(p.document.branch_access, [{ branch_id: 'one', theme: 'dark', name: 'Shop' }]);
});
test('new schema fields alone never cause an update', () => {
  assert.equal(planDocument(doc({ name: 'A' }), doc({ name: 'A', new_setting: true }), 'items').action, 'equal');
});
test('a newer legacy timestamp cannot overwrite a changed Core field shape', () => {
  const s = doc({ updated_date: newer, quantity: '4', preferences: { mode: 'old' } });
  const d = doc({ quantity: 4, preferences: { mode: { version: 2 } } });
  assert.equal(planDocument(s, d, 'items').reason, 'schema-shape-change');
  const branchSource = doc({ updated_date: newer, branch_access: [{ branch_id: 'one', layout: 'legacy' }] });
  const branchCore = doc({ branch_access: [{ branch_id: 'one', layout: { version: 2 } }] });
  assert.equal(planDocument(branchSource, branchCore, 'users').reason, 'schema-shape-change');
});
test('legacy unit hex references retain Core BSON shape with scoped catalogue evidence', () => {
  const unit = new ObjectId(), other = new ObjectId();
  const s = doc({ updated_date: newer, unit_id: String(unit) });
  const d = doc({ unit_id: other });
  assert.equal(planDocument(s, d, 'items').reason, 'schema-shape-change');
  const p = planDocument(s, d, 'items', { unitIds: new Set([String(unit)]) });
  assert.equal(p.action, 'update'); assert.ok(p.document.unit_id instanceof ObjectId);
  assert.equal(String(p.document.unit_id), String(unit));
  assert.equal(planDocument(s, d, 'items', { unitIds: new Set() }).reason, 'schema-shape-change');
});
test('blank legacy unit ID preserves the valid Core reference only for the same scoped unit', () => {
  const unit = new ObjectId(), s = doc({ updated_date: newer, unit_id: '', unit: 'qty' });
  const d = doc({ unit_id: unit, unit: 'qty' });
  const opts = { unitNames: new Map([[String(unit), 'qty']]) };
  assert.equal(planDocument(s, d, 'items', opts).document.unit_id, unit);
  assert.equal(planDocument({ ...s, unit: 'Meter' }, d, 'items', opts).reason, 'schema-shape-change');
  assert.equal(planDocument(s, d, 'items', { unitNames: new Map() }).reason, 'schema-shape-change');
});
test('cross-license collision is blocked even by a resolution', () => {
  const s = doc(), d = doc({ license: new ObjectId() });
  assert.equal(planDocument(s, d, 'items', { resolutions: resolution(s, d, 'source') }).reason, 'destination-license-mismatch');
  assert.throws(() => planDocument(s, null, 'items', { license: new ObjectId() }), /mismatch/);
});
test('reviewed resolutions are bound to exact source and destination versions', () => {
  const s = doc({ available_quantity: 4 }), d = doc({ available_quantity: 8 });
  const r = resolution(s, d, 'source');
  assert.equal(planDocument(s, d, 'items', { resolutions: r }).action, 'update');
  assert.equal(planDocument({ ...s, available_quantity: 3 }, d, 'items', { resolutions: r }).reason, 'resolution-stale');
  assert.equal(planDocument(s, d, 'items', { resolutions: resolution(s, d, 'destination') }).action, 'resolved');
});
test('unsafe field names cannot enter through either insert or merge', () => {
  assert.throws(() => planDocument(doc({ bad: { '$set': 'x' } }), null, 'items'), /Unsafe/);
  assert.throws(() => planDocument(doc({ 'unsafe.path': 1 }), doc(), 'items'), /Unsafe/);
});
test('lastTouched supports legacy string dates and ignores invalid dates', () => {
  assert.equal(+lastTouched({ updated_date: 'invalid', created_date: newer.toISOString() }), +newer);
  assert.equal(lastTouched(null), null);
});
test('tombstones need matching ID/license and deletion time, preserving newer edits', () => {
  const d = doc(), tombstone = doc({ document_backup_date: newer });
  assert.equal(canDelete(d, tombstone, license), true);
  assert.equal(canDelete(doc({ updated_date: new Date('2026-11-01') }), tombstone, license), false);
  assert.equal(canDelete(d, { ...tombstone, document_backup_date: 'invalid' }, license), false);
  assert.equal(canDelete(doc({ updated_date: undefined }), { ...tombstone, document_backup_date: new Date('invalid') }, license), false);
  assert.equal(canDelete(d, { ...tombstone, _id: new ObjectId() }, license), false);
});
test('execution journals and credentials are excluded from the business copy', () => {
  for (const name of ['data_change_log', 'razorpay_mobile', 'user_sessions', 'cloud_users']) assert.equal(COLLECTIONS.includes(name), false);
});
test('real Mongo reconciliation: dry run, backup, apply, retry, CAS and tombstones', { timeout: 120000 }, async () => {
  const server = await MongoMemoryServer.create();
  const client = new MongoClient(server.getUri());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posnic-migration-'));
  let journal;
  try {
    await client.connect(); const source = client.db('legacy'), destination = client.db('tenant');
    const a = doc({ name: 'current', updated_date: newer, newValue: 9 });
    const b = doc({ _id: new ObjectId(), name: 'inserted', email: '' });
    const coreExtra = doc({ _id: new ObjectId(), name: 'Core-only' });
    const deleted = doc({ _id: new ObjectId(), name: 'deleted' });
    await source.collection('customers').insertMany([a, b]);
    await destination.collection('customers').insertMany([{ ...a, name: 'stale', updated_date: older, coreOnly: { enabled: true } }, coreExtra, deleted]);
    await source.collection('recycle_bin').insertOne({ ...deleted, document_name: 'customers', document_backup_date: newer });
    const target = { license: String(license) }, options = { dry: true, batch: 2, applyTombstones: true };
    const before = await reconcileCollection(source, destination, 'customers', target, options);
    assert.equal(before.insert, 1); assert.equal(before.update, 1); assert.equal(before.tombstoneDelete, 1);
    assert.equal(await destination.collection('customers').countDocuments(), 3);
    await backupDatabase(destination, path.join(dir, 'backup'));
    const restored = zlib.gunzipSync(fs.readFileSync(path.join(dir, 'backup', 'customers.ejson.gz'))).toString().trim().split('\n').map(l => BSON.EJSON.parse(l));
    assert.equal(restored.length, 3); assert.ok(restored[0]._id instanceof ObjectId);
    const original = await destination.collection('customers').findOne({ _id: a._id });
    await destination.collection('customers').updateOne({ _id: a._id }, { $set: { concurrent: true } });
    assert.equal((await destination.collection('customers').updateOne(casFilter(original), { $set: { name: 'lost' } })).matchedCount, 0);
    journal = fs.createWriteStream(path.join(dir, 'journal.ejsonl')); await once(journal, 'open');
    const applied = await reconcileCollection(source, destination, 'customers', target, { ...options, dry: false }, journal);
    journal.end(); await finished(journal); journal = null;
    assert.equal(applied.written, 3);
    const saved = await destination.collection('customers').findOne({ _id: a._id });
    assert.equal(saved.name, 'current'); assert.equal(saved.coreOnly.enabled, true); assert.equal(saved.concurrent, true);
    assert.ok(await destination.collection('customers').findOne({ _id: coreExtra._id }));
    assert.equal(await destination.collection('customers').findOne({ _id: deleted._id }), null);
    const repeat = await reconcileCollection(source, destination, 'customers', target, options);
    assert.equal(repeat.insert + repeat.update + repeat.conflict + repeat.tombstoneDelete, 0);
    assert.equal(await source.collection('customers').countDocuments(), 2);
    assert.equal(fs.readFileSync(path.join(dir, 'journal.ejsonl'), 'utf8').trim().split('\n').length, 3);
  } finally {
    if (journal) { journal.end(); await finished(journal).catch(() => {}); }
    await client.close(); await server.stop(); fs.rmSync(dir, { recursive: true, force: true });
  }
});
