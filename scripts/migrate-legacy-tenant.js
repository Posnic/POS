#!/usr/bin/env node
'use strict';
/*
 * Bring a legacy tenant's data forward again, without undoing what has
 * happened since.
 *
 * The original migration moved shops out of the shared Main/PosnicPro database
 * into one database each on the Posnic cluster. It was written for a first
 * load into empty databases, and it is not safe to simply run again: the shops
 * have been live since, and the code has moved on. Three things in it would
 * now destroy work rather than complete it.
 *
 *   replaceOne substitutes the whole document, so any field the newer code
 *   added - till_lock_enable on a branch, item_weight_machine_based on an
 *   item, the sync agent's own bookkeeping - is deleted, because the legacy
 *   copy has never heard of it. This uses $set, so fields that exist only in
 *   the destination survive.
 *
 *   Nothing compared the two sides. A record edited in the new cluster since
 *   go-live would be overwritten by the older legacy version, silently. This
 *   compares updated_date and refuses to go backwards, reporting each such
 *   document instead.
 *
 *   Every secondary index was dropped before loading. That is reasonable
 *   against an empty database and wrong against a live one, where it makes
 *   every query slow until something recreates them. Indexes are now left
 *   alone unless the destination collection is empty.
 *
 * The source is still only ever read.
 *
 *   node scripts/migrate-legacy-tenant.js --dry
 *   node scripts/migrate-legacy-tenant.js --only=kiranastore --dry
 *   node scripts/migrate-legacy-tenant.js --only=kiranastore
 *
 * Env: SRC_MAIN, CONTROL_URI, [CONTROL_DB=Web], [TENANT_CLUSTER=atlas-1]
 */

const fs = require('fs');
const path = require('path');
const { ObjectId } = requireMongo();

function requireMongo() {
  try { return require('../api/node_modules/mongodb'); }
  catch (e) { return require('mongodb'); }
}

// Collections carrying a `license`. cloud_users is billing and user_sessions is
// stale session state, so both stay behind.
const COLLECTIONS = [
  'branches', 'cashregister', 'categories', 'customer_category', 'customers',
  'data_change_log', 'denomination', 'expenses', 'grouptax', 'invoice', 'items',
  'items_log', 'payment', 'payment_type', 'razorpay_mobile', 'receivings',
  'recycle_bin', 'registers', 'sales', 'staff_activities', 'stocklogs',
  'suppliers', 'tableorder', 'transaction', 'unit', 'users', 'variants',
];

const DATE_FIELDS = ['updated_date', 'update_date', 'created_date'];

/* The most recent timestamp a document carries, or null if it carries none. */
function lastTouched(doc) {
  if (!doc) return null;
  let newest = null;
  for (const field of DATE_FIELDS) {
    const value = doc[field];
    if (!value) continue;
    const date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) continue;
    if (!newest || date > newest) newest = date;
  }
  return newest;
}

/*
 * Whether the legacy copy should be written over what is there now.
 *
 * The rule that matters is the last one: if the destination has been touched
 * more recently than the source, somebody has worked on this record since the
 * migration and the legacy version is simply out of date. Writing it would
 * take a shop's work away, which is worse than leaving a record un-refreshed.
 *
 * An undated document is treated as safe to refresh only when the destination
 * is also undated: reference data like units and payment types carries no
 * timestamps and genuinely wants topping up, but a dated destination against
 * an undated source is a record the new system has written and the old one
 * has not.
 */
function decide(source, destination) {
  if (!destination) return { write: true, reason: 'new' };

  const src = lastTouched(source);
  const dst = lastTouched(destination);

  if (dst && src && dst > src) return { write: false, reason: 'newer-in-destination' };
  if (dst && !src) return { write: false, reason: 'newer-in-destination' };
  return { write: true, reason: 'refresh' };
}

function parseArgs(argv) {
  const arg = (name, def = null) => {
    const hit = argv.find((a) => a.startsWith('--' + name + '='));
    return hit ? hit.split('=').slice(1).join('=') : def;
  };
  return {
    dry: argv.includes('--dry'),
    only: arg('only'),
    since: arg('since') ? new Date(arg('since')) : null,
    batch: Number(process.env.BATCH || 250),
  };
}

/*
 * Copy one collection for one shop.
 *
 * Documents are examined in batches against what the destination already
 * holds, so the decision above is made per record rather than per collection.
 */
async function copyCollection(srcDb, dstDb, name, license, args, tally) {
  const src = srcDb.collection(name);
  const filter = { license };
  if (args.since) {
    filter.$or = DATE_FIELDS.map((f) => ({ [f]: { $gte: args.since } }));
  }

  const total = await src.countDocuments(filter);
  if (!total) return;
  if (!dstDb) { tally.push({ name, total, dry: true }); return; }

  const dst = dstDb.collection(name);

  // Only worth clearing indexes when there is nothing to slow down. On a live
  // collection dropping them costs every query until something rebuilds them.
  const existingCount = await dst.estimatedDocumentCount().catch(() => 0);
  if (existingCount === 0) {
    try {
      for (const i of await dst.indexes()) {
        if (i.name !== '_id_') await dst.dropIndex(i.name).catch(() => {});
      }
    } catch (e) { /* collection does not exist yet */ }
  }

  let written = 0;
  let kept = 0;
  const conflicts = [];
  let batch = [];

  const flush = async () => {
    if (!batch.length) return;

    const ids = batch.map((d) => d._id);
    const existing = await dst.find({ _id: { $in: ids } })
      .project({ _id: 1, updated_date: 1, update_date: 1, created_date: 1 })
      .toArray();
    const byId = new Map(existing.map((d) => [String(d._id), d]));

    const ops = [];
    for (const doc of batch) {
      const verdict = decide(doc, byId.get(String(doc._id)));
      if (!verdict.write) {
        kept++;
        if (conflicts.length < 5) conflicts.push(String(doc._id));
        continue;
      }
      /*
       * $set rather than a replacement, so anything the newer code has added
       * to this document stays. The legacy copy is the authority on the
       * fields it knows about and silent about the rest.
       */
      const { _id, ...fields } = doc;
      ops.push({ updateOne: { filter: { _id }, update: { $set: fields }, upsert: true } });
    }
    batch = [];
    if (!ops.length) return;

    // Shared-tier Atlas throttles under load, so transient failures are
    // retried; a genuine write error is reported and the source stays true.
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        await dst.bulkWrite(ops, { ordered: false });
        written += ops.length;
        return;
      } catch (e) {
        const bad = e.writeErrors ? e.writeErrors.length : 0;
        const transient = (e.errorLabelSet && (e.errorLabelSet.has('RetryableError')
          || e.errorLabelSet.has('SystemOverloadedError')))
          || /SSL|socket|timed out|connection/i.test(e.message || '');
        if (bad && !transient) {
          written += ops.length - bad;
          console.log('\n      ' + name + ': ' + bad + ' rejected by an index; source remains the truth');
          return;
        }
        if (attempt === 5) throw e;
        const wait = attempt * 3000;
        console.log('\n      ' + name + ': ' + e.constructor.name
          + ' on attempt ' + attempt + ', retrying in ' + (wait / 1000) + 's');
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  };

  for await (const doc of src.find(filter, { batchSize: args.batch })) {
    batch.push(doc);
    if (batch.length >= args.batch) {
      await flush();
      process.stdout.write('\r    ' + name + ': ' + written + '/' + total + '   ');
    }
  }
  await flush();
  process.stdout.write('\r    ' + name + ': ' + written + '/' + total
    + (kept ? '   (' + kept + ' left alone, newer here)' : '') + '        \n');

  tally.push({ name, total, written, kept, conflicts });
}

module.exports = { decide, lastTouched, COLLECTIONS, parseArgs };

/* ------------------------------------------------------------------ */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { MongoClient } = requireMongo();

  const SRC_MAIN = process.env.SRC_MAIN;
  const CONTROL_URI = process.env.CONTROL_URI;
  const CONTROL_DB = process.env.CONTROL_DB || 'Web';
  const TENANT_CLUSTER = process.env.TENANT_CLUSTER || 'atlas-1';

  /*
   * SRC_WEB is not needed any more.
   *
   * The original script also created the website account, the activation
   * record and the tenant entry, which is why it read the old PosnicWeb
   * database. Those exist already for a shop that is live - kiranastore is
   * serving on its own subdomain - so touching them now would only risk
   * changing a working login. This moves data and nothing else.
   */
  for (const [k, v] of Object.entries({ SRC_MAIN, CONTROL_URI })) {
    if (!v) { console.error('missing env ' + k); process.exit(1); }
  }

  const manifestPath = process.env.MANIFEST || path.join(__dirname, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('no manifest at ' + manifestPath + ' (set MANIFEST=<path>)');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    .filter((t) => !args.only || t.subdomain === args.only);
  if (!manifest.length) { console.error('nothing to do'); process.exit(1); }

  const srcMain = new MongoClient(SRC_MAIN, { maxPoolSize: 5 });
  const ctl = new MongoClient(CONTROL_URI, { maxPoolSize: 5 });
  await Promise.all([srcMain.connect(), ctl.connect()]);
  const mainDb = srcMain.db('PosnicPro');
  const control = ctl.db(CONTROL_DB);

  const clusterRec = await control.collection('clusters').findOne({ name: TENANT_CLUSTER });
  if (!clusterRec || !clusterRec.uri) {
    console.error('cluster ' + TENANT_CLUSTER + ' not registered');
    process.exit(1);
  }
  const tenantClient = new MongoClient(clusterRec.uri, { maxPoolSize: 5 });
  await tenantClient.connect();

  console.log(args.dry
    ? '\n  DRY RUN - nothing will be written\n'
    : '\n  Writing. Records newer in the destination are left alone.\n');

  const results = [];
  for (const t of manifest) {
    const license = new ObjectId(t.license);
    const tenantDb = 'posnic_t_' + t.subdomain.replace(/-/g, '');
    console.log('\n=== ' + t.company + '  ->  ' + tenantDb);

    const tally = [];
    const dstDb = args.dry ? null : tenantClient.db(tenantDb);
    for (const name of COLLECTIONS) {
      await copyCollection(mainDb, dstDb, name, license, args, tally);
    }

    const kept = tally.reduce((a, b) => a + (b.kept || 0), 0);
    if (kept) {
      console.log('    ' + kept + ' document(s) left alone because the new cluster has '
        + 'a more recent version. Nothing was lost; they simply were not refreshed.');
    }
    results.push({ company: t.company, subdomain: t.subdomain, tenantDb, tally });
  }

  const out = path.join(__dirname, '..', 'migration-report-'
    + new Date().toISOString().slice(0, 10) + '.json');
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log('\n  report: ' + out);

  await Promise.all([srcMain.close(), ctl.close(), tenantClient.close()]);
}

if (require.main === module) {
  main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
}
