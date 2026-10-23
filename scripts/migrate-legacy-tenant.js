#!/usr/bin/env node
'use strict';
// Schema-preserving, explicitly scoped reconciliation. Source is read-only.
// Defaults to a real dry comparison against DEST_URI, not an Atlas guess.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { once } = require('events');
const { finished } = require('stream/promises');
function requireMongo() {
  try { return require('../api/node_modules/mongodb'); }
  catch (_) { return require('mongodb'); }
}
const { MongoClient, ObjectId, BSON } = requireMongo();
const EJSON = BSON.EJSON;
const COLLECTIONS = [
  'branches', 'cashregister', 'categories', 'customer_category', 'customers',
  'denomination', 'expenses', 'grouptax', 'invoice', 'items', 'items_log',
  'payment', 'payment_type', 'receivings', 'recycle_bin', 'registers', 'sales',
  'staff_activities', 'stocklogs', 'suppliers', 'tableorder', 'transaction',
  'unit', 'users', 'variants',
];
const EXCLUDED = new Set(['data_change_log', 'razorpay_mobile', 'razorpay_webhook',
  'cloud_users', 'user_sessions', 'login_check', 'license']);
const DATE_FIELDS = ['updated_date', 'update_date', 'created_date'];
const OPTIONAL_EMAIL = new Set(['customers', 'suppliers', 'users']);
function lastTouched(doc) {
  const dates = DATE_FIELDS.map(k => doc && doc[k] ? new Date(doc[k]).getTime() : NaN).filter(Number.isFinite);
  return dates.length ? new Date(Math.max(...dates)) : null;
}
function canonical(value) {
  if (value === undefined) return 'undefined';
  const sort = v => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sort(v[k])])) : v;
  return JSON.stringify(sort(EJSON.serialize(value, { relaxed: false })));
}
function same(a, b) { return canonical(a) === canonical(b); }
function isObject(v) { return !!v && Object.getPrototypeOf(v) === Object.prototype; }
function merge(source, destination) {
  if (isObject(source)) {
    const out = isObject(destination) ? { ...destination } : {};
    for (const [key, value] of Object.entries(source)) {
      if (key.startsWith('$') || key.includes('.') || ['__proto__', 'constructor', 'prototype'].includes(key)) throw Error('Unsafe document key');
      out[key] = merge(value, out[key]);
    }
    return out;
  }
  if (Array.isArray(source)) {
    const keyed = source.length && source.every(v => isObject(v) && v.branch_id != null)
      && new Set(source.map(v => String(v.branch_id))).size === source.length;
    if (keyed && Array.isArray(destination)) return source.map(v => merge(v,
      destination.find(d => d && String(d.branch_id) === String(v.branch_id))));
  }
  return source;
}
function licenseMatches(value, license) { return value != null && String(value) === String(license); }
function licenseFilter(license) { return { license: { $in: [new ObjectId(String(license)), String(license)] } }; }
function normalized(doc, collection, options = {}) {
  const result = { ...doc };
  if (OPTIONAL_EMAIL.has(collection) && (result.email == null || (typeof result.email === 'string' && !result.email.trim()))) delete result.email;
  // Legacy item editors can serialize unit references as hex strings while
  // Core retains BSON ObjectIds. Preserve Core's representation and require
  // the referenced unit to belong to this source license.
  if (collection === 'items' && options.destination?.unit_id instanceof ObjectId
    && typeof result.unit_id === 'string' && /^[a-f\d]{24}$/i.test(result.unit_id)
    && options.unitIds?.has(result.unit_id.toLowerCase())) result.unit_id = new ObjectId(result.unit_id);
  if (collection === 'items' && options.destination?.unit_id instanceof ObjectId
    && (result.unit_id === '' || result.unit_id == null)) {
    const label = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
    const unitName = options.unitNames?.get(String(options.destination.unit_id));
    if (label(result.unit) && label(result.unit) === label(options.destination.unit)
      && label(result.unit) === label(unitName)) result.unit_id = options.destination.unit_id;
  }
  return result;
}
function fingerprint(doc) { return crypto.createHash('sha256').update(canonical(doc)).digest('hex'); }
function shapeChanges(source, destination, prefix = '') {
  const changes = [];
  const kind = value => value === null ? 'null' : Array.isArray(value) ? 'array'
    : value instanceof Date ? 'date' : value && value._bsontype ? value._bsontype : typeof value;
  for (const [key, value] of Object.entries(source)) {
    if (!Object.hasOwn(destination, key) || destination[key] == null) continue;
    const field = prefix + key;
    if (kind(value) !== kind(destination[key])) changes.push(field);
    else if (isObject(value) && isObject(destination[key])) changes.push(...shapeChanges(value, destination[key], field + '.'));
    else if (Array.isArray(value) && Array.isArray(destination[key])) {
      for (const branch of value) {
        if (!isObject(branch) || branch.branch_id == null) continue;
        const prior = destination[key].find(d => isObject(d) && String(d.branch_id) === String(branch.branch_id));
        if (prior) changes.push(...shapeChanges(branch, prior, field + '[branch].'));
      }
    }
  }
  return changes;
}
function planDocument(source, destination, collection, options = {}) {
  if (!source || !source._id) throw Error('Source document needs a stable _id');
  if (options.license && !licenseMatches(source.license, options.license)) throw Error('Source license mismatch');
  if (destination && !licenseMatches(destination.license, source.license)) return { action: 'conflict', reason: 'destination-license-mismatch' };
  const clean = normalized(source, collection, { ...options, destination });
  if (!destination) return { action: 'insert', reason: 'missing', document: merge(clean) };
  // Deep merge preserves fields added by Core, including nested ACL flags and
  // per-branch options. Arrays of branches retain fields, not revoked members.
  const desired = merge(clean, destination);
  // A legacy blank is not proof that a contact added in Core should be erased.
  // Only remove an already-blank destination value; missing stays missing.
  if (OPTIONAL_EMAIL.has(collection) && !Object.hasOwn(clean, 'email')
    && (destination.email == null || (typeof destination.email === 'string' && !destination.email.trim()))) delete desired.email;
  const set = {}, unset = {};
  for (const k of Object.keys(desired)) if (k !== '_id' && !same(desired[k], destination[k])) set[k] = desired[k];
  for (const k of Object.keys(destination)) if (!Object.hasOwn(desired, k)) unset[k] = '';
  if (!Object.keys(set).length && !Object.keys(unset).length) return { action: 'equal', reason: 'equal' };
  const src = lastTouched(source), dst = lastTouched(destination);
  const resolution = options.resolutions && options.resolutions[collection + '/' + String(source._id)];
  const reviewed = resolution && resolution.source === fingerprint(source) && resolution.destination === fingerprint(destination);
  if (resolution && !reviewed) return { action: 'conflict', reason: 'resolution-stale' };
  if (reviewed && resolution.keep === 'destination') return { action: 'resolved', reason: 'reviewed-core-version' };
  if (!reviewed && shapeChanges(clean, destination).length) return { action: 'conflict', reason: 'schema-shape-change' };
  if (!reviewed && dst && (!src || dst > src)) return { action: 'conflict', reason: 'newer-in-destination' };
  if (!reviewed && (!src || !dst || +src === +dst)) return { action: 'conflict', reason: 'ambiguous-timestamp' };
  if (reviewed && resolution.keep !== 'source') return { action: 'conflict', reason: 'invalid-resolution' };
  const update = {};
  if (Object.keys(set).length) update.$set = set;
  if (Object.keys(unset).length) update.$unset = unset;
  return { action: 'update', reason: reviewed ? 'reviewed-legacy-version' : 'source-newer', update, document: desired };
}
function casFilter(doc) { return { _id: doc._id, $expr: { $eq: ['$$ROOT', { $literal: doc }] } }; }
function parseArgs(argv) {
  const value = key => { const v = argv.find(a => a.startsWith('--' + key + '=')); return v ? v.slice(key.length + 3) : null; };
  if (argv.some(a => !['--dry', '--apply', '--allow-new-database', '--apply-tombstones'].includes(a)
    && !/^--(only|manifest|report|backup-dir|resolutions)=.+$/.test(a))) throw Error('Unknown argument; --since is unsafe for undated stock edits');
  if (argv.includes('--apply') && argv.includes('--dry')) throw Error('Choose --apply or --dry');
  const result = { dry: !argv.includes('--apply'), only: value('only'),
    manifest: value('manifest') || process.env.MANIFEST || path.join(__dirname, 'manifest.json'),
    report: value('report') || path.resolve('migration-report-' + Date.now() + '.json'),
    backupDir: value('backup-dir'), resolutionsPath: value('resolutions'),
    allowNewDatabase: argv.includes('--allow-new-database'), applyTombstones: argv.includes('--apply-tombstones'),
    batch: Number(process.env.BATCH || 250) };
  if (!Number.isInteger(result.batch) || result.batch < 1 || result.batch > 1000) throw Error('BATCH must be 1..1000');
  if (!result.dry && (!result.only || !result.backupDir)) throw Error('--apply requires --only and --backup-dir');
  return result;
}
function validateTargets(manifest, only) {
  if (!Array.isArray(manifest)) throw Error('Manifest must be an array');
  const targets = manifest.filter(t => !only || t.subdomain === only).map(t => ({ ...t }));
  if (!targets.length || (only && targets.length !== 1)) throw Error('Select exactly one matching tenant');
  const databases = new Set();
  for (const t of targets) {
    if (!/^[a-f\d]{24}$/i.test(t.license || '') || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(t.subdomain || '')) throw Error('Invalid tenant identity');
    t.tenantDb = t.tenantDb || 'posnic_t_' + t.subdomain.replace(/-/g, '');
    if (!/^posnic_t_[a-z0-9_]+$/.test(t.tenantDb) || databases.has(t.tenantDb)) throw Error('Invalid or repeated tenant database');
    databases.add(t.tenantDb);
  }
  return targets;
}
async function writeLine(stream, doc) {
  if (!stream.write(EJSON.stringify(doc, { relaxed: false }) + '\n')) await once(stream, 'drain');
}
async function backupDatabase(db, directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); fs.chmodSync(directory, 0o700);
  const metadata = [];
  for (const c of await db.listCollections({}, { nameOnly: true }).toArray()) {
    if (c.name.startsWith('system.')) continue;
    if (!/^[a-zA-Z0-9_-]+$/.test(c.name)) throw Error('Unsafe backup collection name');
    const output = fs.createWriteStream(path.join(directory, c.name + '.ejson.gz'), { flags: 'wx', mode: 0o600 });
    const gzip = zlib.createGzip();
    const completion = finished(output); completion.catch(() => {});
    gzip.on('error', e => output.destroy(e)); output.on('error', e => gzip.destroy(e)); gzip.pipe(output);
    let count = 0;
    for await (const doc of db.collection(c.name).find({})) { await writeLine(gzip, doc); count++; }
    gzip.end(); await completion;
    metadata.push({ name: c.name, count, indexes: await db.collection(c.name).indexes() });
  }
  fs.writeFileSync(path.join(directory, 'metadata.ejson'), EJSON.stringify(metadata, { relaxed: false }), { flag: 'wx', mode: 0o600 });
  return metadata;
}
async function recordAndWrite({ dst, source, before, plan, journal, collection }) {
  await writeLine(journal, { collection, id: source._id, before: before || null, after: plan.document });
  // The pre-image must be on disk before the database write is issued.
  await new Promise((resolve, reject) => journal.write('', e => e ? reject(e) : resolve()));
  fs.fsyncSync(journal.fd);
  if (plan.action === 'insert') await dst.insertOne(plan.document);
  else if ((await dst.updateOne(casFilter(before), plan.update)).matchedCount !== 1) throw Error('Destination changed during reconciliation');
}
function canDelete(doc, tombstone, license) {
  if (!tombstone || !licenseMatches(tombstone.license, license) || !licenseMatches(doc.license, license)) return false;
  if (!same(doc._id, tombstone._id)) return false;
  const deletedAt = tombstone.document_backup_date instanceof Date ? tombstone.document_backup_date : null;
  const liveAt = lastTouched(doc);
  return !!deletedAt && Number.isFinite(deletedAt.getTime()) && (!liveAt || liveAt <= deletedAt);
}
async function reconcileCollection(srcDb, dstDb, name, target, args, journal) {
  const src = srcDb.collection(name), dst = dstDb.collection(name), filter = licenseFilter(target.license);
  const row = { name, source: 0, equal: 0, resolved: 0, insert: 0, update: 0, conflict: 0, written: 0, destinationOnly: 0, tombstoneDelete: 0, conflicts: [], samples: [] };
  const unitRows = name === 'items' ? await srcDb.collection('unit').find(filter, { projection: { _id: 1, name: 1 } }).toArray() : [];
  const unitIds = new Set(unitRows.map(d => String(d._id)));
  const unitNames = new Map(unitRows.map(d => [String(d._id), d.name]));
  let batch = [];
  async function flush() {
    const existing = await dst.find({ _id: { $in: batch.map(s => s._id) } }).toArray();
    const byId = new Map(existing.map(d => [String(d._id), d]));
    const fresh = args.dry ? null : new Map((await src.find({ ...filter, _id: { $in: batch.map(s => s._id) } }).toArray()).map(d => [String(d._id), d]));
    for (const source of batch) {
      const before = byId.get(String(source._id));
      const plan = planDocument(source, before, name, { resolutions: args.resolutions, license: target.license, unitIds, unitNames });
      row.source++; row[plan.action]++;
      if (plan.action === 'conflict') row.conflicts.push({ id: String(source._id), reason: plan.reason, source: fingerprint(source), destination: fingerprint(before), fields: Object.keys(source).filter(k => !same(source[k], before && before[k])) });
      if (!['equal', 'resolved'].includes(plan.action) && row.samples.length < 5) row.samples.push({ id: String(source._id), action: plan.action, reason: plan.reason });
      if (!args.dry && ['insert', 'update'].includes(plan.action)) {
        if (!same(fresh.get(String(source._id)), source)) throw Error('Source changed during reconciliation');
        await recordAndWrite({ dst, source, before, plan, journal, collection: name }); row.written++;
      }
    }
    batch = [];
  }
  for await (const source of src.find(filter, { batchSize: args.batch })) { batch.push(source); if (batch.length >= args.batch) await flush(); }
  if (batch.length) await flush();
  let dbatch = [];
  async function extra() {
    const originals = await src.find({ ...filter, _id: { $in: dbatch.map(d => d._id) } }, { projection: { _id: 1 } }).toArray();
    const ids = new Set(originals.map(d => String(d._id)));
    for (const d of dbatch) {
      if (ids.has(String(d._id))) continue;
      row.destinationOnly++;
      if (name === 'recycle_bin' || !licenseMatches(d.license, target.license)) continue;
      const tombstone = await srcDb.collection('recycle_bin').findOne({ ...filter, _id: d._id, document_name: name });
      if (!canDelete(d, tombstone, target.license)) continue;
      row.tombstoneDelete++;
      if (!args.dry && args.applyTombstones) {
        if (await src.findOne({ _id: d._id })) throw Error('Deleted source record was restored');
        await writeLine(journal, { collection: name, id: d._id, before: d, after: null, tombstone });
        await new Promise((resolve, reject) => journal.write('', e => e ? reject(e) : resolve())); fs.fsyncSync(journal.fd);
        if ((await dst.deleteOne(casFilter(d))).deletedCount !== 1) throw Error('Destination changed before tombstone application');
        row.written++;
      }
    }
    dbatch = [];
  }
  for await (const d of dst.find({}, { batchSize: args.batch })) { dbatch.push(d); if (dbatch.length >= args.batch) await extra(); }
  if (dbatch.length) await extra();
  return row;
}
async function inventory(db, license) {
  const result = [];
  for (const c of await db.listCollections({}, { nameOnly: true }).toArray()) {
    if (c.name.startsWith('system.')) continue;
    const count = await db.collection(c.name).countDocuments(licenseFilter(license));
    if (count) result.push({ name: c.name, count, mode: COLLECTIONS.includes(c.name) ? 'business-copy' : EXCLUDED.has(c.name) ? 'installation-local-excluded' : 'unclassified' });
  }
  return result;
}
async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!process.env.SRC_MAIN || !process.env.DEST_URI) throw Error('SRC_MAIN and explicit DEST_URI are required');
  const targets = validateTargets(JSON.parse(fs.readFileSync(args.manifest, 'utf8')), args.only);
  args.resolutions = args.resolutionsPath ? JSON.parse(fs.readFileSync(args.resolutionsPath, 'utf8')) : {};
  const source = new MongoClient(process.env.SRC_MAIN, { maxPoolSize: 2, serverSelectionTimeoutMS: 20000 });
  const destination = new MongoClient(process.env.DEST_URI, { maxPoolSize: 2, serverSelectionTimeoutMS: 20000 });
  const report = { startedAt: new Date().toISOString(), dry: args.dry, targets: [], status: 'running' };
  let journal, lock;
  try {
    await Promise.all([source.connect(), destination.connect()]);
    const srcDb = source.db(process.env.SOURCE_DB || 'PosnicPro');
    for (const target of targets) {
      // This tool imports the shared legacy schema, never a same-named tenant
      // database. Refuse even if URI aliases conceal an identical server.
      if (srcDb.databaseName === target.tenantDb) throw Error('Source and destination database names must differ');
      const dstDb = destination.db(target.tenantDb);
      const exists = (await dstDb.listCollections({}, { nameOnly: true }).toArray()).length > 0;
      if (!exists && !args.allowNewDatabase) throw Error('Destination absent; explicit --allow-new-database required');
      for (const name of COLLECTIONS) {
        if (await dstDb.collection(name).findOne({ license: { $exists: true, $nin: [new ObjectId(target.license), target.license] } }, { projection: { _id: 1 } })) throw Error('Destination contains another license');
      }
      const inv = await inventory(srcDb, target.license);
      const entry = { subdomain: target.subdomain, license: target.license, tenantDb: target.tenantDb, inventory: inv, before: [], verification: [] };
      report.targets.push(entry);
      if (!inv.some(c => c.name === 'branches') || !inv.some(c => c.name === 'users')) throw Error('Source tenant needs branches and users');
      if (inv.some(c => c.mode === 'unclassified')) throw Error('Unclassified source collections; review report inventory');
      if (!args.dry) {
        const root = path.resolve(args.backupDir); fs.mkdirSync(root, { recursive: true, mode: 0o700 }); fs.chmodSync(root, 0o700);
        const lockPath = path.join(root, target.tenantDb + '.lock');
        lock = { fd: fs.openSync(lockPath, 'wx', 0o600), path: lockPath };
        const dir = path.join(root, target.tenantDb + '-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex'));
        entry.backupDirectory = dir; entry.backup = await backupDatabase(dstDb, dir);
        journal = fs.createWriteStream(path.join(dir, 'writes.ejsonl'), { flags: 'wx', mode: 0o600 }); await once(journal, 'open');
      }
      for (const name of COLLECTIONS) {
        console.log(target.subdomain + ': comparing ' + name);
        entry.before.push(await reconcileCollection(srcDb, dstDb, name, target, args, journal));
      }
      if (!args.dry) {
        journal.end(); await finished(journal); journal = null;
        for (const name of COLLECTIONS) entry.verification.push(await reconcileCollection(srcDb, dstDb, name, target, { ...args, dry: true }, null));
        entry.verified = entry.verification.every(r => !r.insert && !r.update && !r.conflict && (!args.applyTombstones || !r.tombstoneDelete));
        fs.closeSync(lock.fd); fs.unlinkSync(lock.path); lock = null;
      }
    }
    report.status = report.targets.some(t => t.verified === false || (args.dry && t.before.some(r => r.conflict))) ? 'needs-review' : args.dry ? 'planned' : 'verified';
  } catch (error) {
    report.status = 'failed';
    report.error = error.code ? 'Database/file operation failed (' + String(error.code) + ')' : error.message.replace(/mongodb(?:\+srv)?:\/\/\S+/g, '[redacted]');
  } finally {
    if (journal) { journal.end(); await finished(journal).catch(() => {}); }
    if (lock) { fs.closeSync(lock.fd); fs.unlinkSync(lock.path); }
    await Promise.allSettled([source.close(), destination.close()]);
    report.finishedAt = new Date().toISOString(); fs.writeFileSync(args.report, JSON.stringify(report, null, 2), { mode: 0o600 });
  }
  console.log('Status: ' + report.status + '; report: ' + args.report);
  if (['failed', 'needs-review'].includes(report.status)) process.exitCode = 1;
  return report;
}
module.exports = { COLLECTIONS, EXCLUDED, lastTouched, canonical, same, merge, normalized, fingerprint, shapeChanges,
  planDocument, casFilter, parseArgs, validateTargets, canDelete, reconcileCollection, backupDatabase, main };
if (require.main === module) main().catch(() => { console.error('Reconciliation failed before connecting; check arguments and configuration.'); process.exitCode = 1; });
